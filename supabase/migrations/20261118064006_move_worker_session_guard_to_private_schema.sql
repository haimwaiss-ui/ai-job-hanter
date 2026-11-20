-- Keep worker-session authorization helpers out of the PostgREST-exposed public schema.
-- The helper remains executable by authenticated users only because RLS policies invoke it.
begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_active_worker_session()
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

revoke all on function private.is_active_worker_session() from public, anon;
grant execute on function private.is_active_worker_session() to authenticated;

drop policy if exists applications_update_worker on public.applications;
create policy applications_update_worker
  on public.applications
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  )
  with check (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  );

drop policy if exists worker_operations_insert_worker on public.worker_operations;
create policy worker_operations_insert_worker
  on public.worker_operations
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  );

drop policy if exists worker_operations_select_worker on public.worker_operations;
create policy worker_operations_select_worker
  on public.worker_operations
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  );

drop policy if exists worker_operations_update_worker on public.worker_operations;
create policy worker_operations_update_worker
  on public.worker_operations
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  )
  with check (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  );

drop function public.is_active_worker_session();

comment on function private.is_active_worker_session() is
  'Private RLS helper: validates the current user, worker JWT claim, exact Auth session, revocation state, and completed token-vault provisioning.';

commit;
