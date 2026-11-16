-- Keep the SECURITY DEFINER worker-session predicate out of the exposed public API schema.
-- The function remains callable by authenticated database requests for RLS evaluation,
-- but the private schema must not be added to Supabase's exposed API schemas.
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
    );
$$;

revoke all on function private.is_active_worker_session()
  from public, anon;
grant execute on function private.is_active_worker_session()
  to authenticated;

comment on function private.is_active_worker_session() is
  'Private RLS predicate: true only for the authenticated user and exact active worker Auth session.';

create or replace function public.worker_current_context()
returns table(user_id uuid, worker_enabled boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.uid(), private.is_active_worker_session();
$$;

revoke all on function public.worker_current_context()
  from public, anon, authenticated;
grant execute on function public.worker_current_context()
  to authenticated;

drop policy if exists worker_operations_select_worker on public.worker_operations;
create policy worker_operations_select_worker
  on public.worker_operations for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  );

drop policy if exists worker_operations_insert_worker on public.worker_operations;
create policy worker_operations_insert_worker
  on public.worker_operations for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  );

drop policy if exists worker_operations_update_worker on public.worker_operations;
create policy worker_operations_update_worker
  on public.worker_operations for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  )
  with check (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  );

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
  from public, anon, authenticated;
grant execute on function public.claim_worker_operation(text, text, uuid)
  to authenticated;

drop policy if exists applications_update_worker on public.applications;
create policy applications_update_worker
  on public.applications for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  )
  with check (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  );

drop function if exists public.is_active_worker_session();

comment on schema private is
  'Non-exposed implementation helpers used by RLS policies and invoker functions.';

commit;
