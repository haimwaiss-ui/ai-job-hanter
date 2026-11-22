-- Repair worker RPCs after moving the session guard into the private schema.
-- These functions run with the caller's authenticated JWT and rely on RLS.
begin;

create or replace function public.worker_current_context()
returns table(user_id uuid, worker_enabled boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    auth.uid(),
    coalesce(private.is_active_worker_session(), false);
$$;

revoke all on function public.worker_current_context()
  from public, anon, authenticated, service_role;
grant execute on function public.worker_current_context()
  to authenticated;

create or replace function public.claim_worker_operation(
  p_queue_name text,
  p_idempotency_key text,
  p_operation_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  changed_rows integer := 0;
begin
  if current_user_id is null
    or private.is_active_worker_session() is not true then
    raise exception 'Active worker session required' using errcode = '42501';
  end if;

  if p_queue_name is null
    or p_queue_name not in ('scraper-queue', 'ai-processing-queue', 'submission-queue')
    or p_idempotency_key is null
    or p_idempotency_key !~ '^[a-f0-9]{64}$'
    or p_operation_id is null then
    raise exception 'Invalid worker operation claim' using errcode = '22023';
  end if;

  insert into public.worker_operations (
    user_id, queue_name, idempotency_key, operation_id,
    status, attempt_count, lease_until
  )
  values (
    current_user_id, p_queue_name, p_idempotency_key, p_operation_id,
    'running', 1, now() + interval '10 minutes'
  )
  on conflict (user_id, queue_name, idempotency_key) do nothing;

  if found then
    return true;
  end if;

  update public.worker_operations
  set
    operation_id = p_operation_id,
    status = 'running',
    attempt_count = attempt_count + 1,
    lease_until = now() + interval '10 minutes',
    updated_at = now(),
    last_error_code = null,
    last_error_message = null
  where user_id = current_user_id
    and queue_name = p_queue_name
    and idempotency_key = p_idempotency_key
    and status not in ('completed', 'manual_assist')
    and (
      operation_id = p_operation_id
      or status <> 'running'
      or lease_until < now()
    );

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.claim_worker_operation(text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_worker_operation(text, text, uuid)
  to authenticated;

comment on function public.worker_current_context() is
  'Returns the current auth.uid() and whether the current JWT belongs to an active, provisioned worker session.';
comment on function public.claim_worker_operation(text, text, uuid) is
  'Tenant-scoped idempotency claim. SECURITY INVOKER; validates the current worker JWT and relies on RLS.';

commit;
