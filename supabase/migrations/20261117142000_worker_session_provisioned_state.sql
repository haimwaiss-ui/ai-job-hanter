-- Keep worker sessions non-runnable until the refreshed token is safely vaulted.
begin;

alter table public.worker_sessions
  add column if not exists provisioned_at timestamptz;

grant select (provisioned_at)
  on public.worker_sessions to authenticated;

create or replace function public.is_active_worker_session()
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select
    auth.uid() is not null
    and coalesce((auth.jwt() ->> 'worker')::boolean, false)
    and exists (
      select 1
      from public.worker_sessions as ws
      where ws.user_id = auth.uid()
        and ws.auth_session_id::text = nullif(auth.jwt() ->> 'session_id', '')
        and ws.revoked_at is null
        and ws.provisioned_at is not null
    );
$$;

revoke all on function public.is_active_worker_session()
  from public, anon, authenticated;
grant execute on function public.is_active_worker_session()
  to authenticated;

comment on column public.worker_sessions.provisioned_at is
  'Set only after the dedicated Auth session has been refreshed, verified, and its rotated tokens have been written to the private token vault.';

commit;
