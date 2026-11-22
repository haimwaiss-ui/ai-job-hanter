-- Per-user, atomic rate limits for expensive provider-backed API routes.
-- The caller cannot choose a user ID, quota, or window duration.
begin;

create table private.user_api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (bucket in ('job_scan', 'gmail_scan')),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket)
);

alter table private.user_api_rate_limits enable row level security;

-- The table is only accessed by the SECURITY DEFINER RPC below.
revoke all on table private.user_api_rate_limits
  from public, anon, authenticated, service_role;

create or replace function public.consume_user_api_rate_limit(p_bucket text)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_window_seconds integer;
  v_limit integer;
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Quotas are server-owned constants. A caller cannot lower the window or
  -- increase the quota by passing additional RPC arguments.
  case p_bucket
    when 'job_scan' then
      v_limit := 3;
      v_window_seconds := 60;
    when 'gmail_scan' then
      v_limit := 2;
      v_window_seconds := 60;
    else
      raise exception 'Unsupported rate limit bucket' using errcode = '22023';
  end case;

  -- A single row per user/bucket keeps storage bounded. The upsert is atomic,
  -- so simultaneous requests cannot all pass the final available slot.
  insert into private.user_api_rate_limits as limits (
    user_id, bucket, window_started_at, request_count, updated_at
  )
  values (v_user_id, p_bucket, v_now, 1, v_now)
  on conflict (user_id, bucket) do update
  set
    window_started_at = case
      when limits.window_started_at + make_interval(secs => v_window_seconds) <= v_now
        then v_now
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at + make_interval(secs => v_window_seconds) <= v_now
        then 1
      else limits.request_count + 1
    end,
    updated_at = v_now
  returning request_count, window_started_at
    into v_request_count, v_window_started_at;

  return query
    select
      v_request_count <= v_limit,
      greatest(
        1,
        ceil(extract(epoch from (
          v_window_started_at + make_interval(secs => v_window_seconds) - v_now
        )))::integer
      );
end;
$function$;

revoke all on function public.consume_user_api_rate_limit(text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_user_api_rate_limit(text)
  to authenticated;

comment on table private.user_api_rate_limits is
  'Private atomic per-user API rate-limit counters. Access only through consume_user_api_rate_limit().';
comment on function public.consume_user_api_rate_limit(text) is
  'Atomically consumes a fixed server-defined quota for the authenticated user; does not accept a caller-supplied tenant ID or quota.';

commit;
