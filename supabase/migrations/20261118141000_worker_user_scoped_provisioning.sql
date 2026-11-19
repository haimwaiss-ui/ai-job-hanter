-- Complete user-scoped worker provisioning.
-- No service-role client or privileged database RPC is used by the worker or provisioner.
-- The dedicated Auth session is bound to auth.uid() and auth.jwt()->>'session_id'.
-- Worker credentials remain in AWS Secrets Manager; Redis stores only the opaque vault ref.
begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter table public.worker_sessions
  add column if not exists provisioned_at timestamptz;

alter table public.worker_sessions enable row level security;
revoke all privileges on table public.worker_sessions
  from public, anon, authenticated, service_role;
grant select (user_id, token_vault_ref, auth_session_id, revoked_at, provisioned_at)
  on public.worker_sessions to authenticated;
grant insert (user_id, token_vault_ref, auth_session_id, revoked_at, provisioned_at, updated_at)
  on public.worker_sessions to authenticated;
grant update (token_vault_ref, auth_session_id, revoked_at, provisioned_at, updated_at)
  on public.worker_sessions to authenticated;

drop policy if exists worker_sessions_select_own on public.worker_sessions;
create policy worker_sessions_select_own
  on public.worker_sessions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists worker_sessions_insert_own_session on public.worker_sessions;
create policy worker_sessions_insert_own_session
  on public.worker_sessions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and auth_session_id::text = nullif((select auth.jwt() ->> 'session_id'), '')
  );

drop policy if exists worker_sessions_update_own_session on public.worker_sessions;
create policy worker_sessions_update_own_session
  on public.worker_sessions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and auth_session_id::text = nullif((select auth.jwt() ->> 'session_id'), '')
  );

create table if not exists public.worker_provisioning_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lock_token uuid not null,
  lease_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.worker_provisioning_locks enable row level security;
revoke all privileges on table public.worker_provisioning_locks
  from public, anon, authenticated, service_role;
grant select, insert, update, delete
  on public.worker_provisioning_locks to authenticated;

drop policy if exists worker_provisioning_locks_select_own on public.worker_provisioning_locks;
create policy worker_provisioning_locks_select_own
  on public.worker_provisioning_locks for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists worker_provisioning_locks_insert_own on public.worker_provisioning_locks;
create policy worker_provisioning_locks_insert_own
  on public.worker_provisioning_locks for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists worker_provisioning_locks_update_own on public.worker_provisioning_locks;
create policy worker_provisioning_locks_update_own
  on public.worker_provisioning_locks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists worker_provisioning_locks_delete_own on public.worker_provisioning_locks;
create policy worker_provisioning_locks_delete_own
  on public.worker_provisioning_locks for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.acquire_worker_provisioning_lock(
  p_user_id uuid,
  p_lock_token uuid,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  acquired boolean;
begin
  if current_user_id is null or p_user_id is distinct from current_user_id then
    raise exception 'Provisioning lock must belong to auth.uid()' using errcode = '42501';
  end if;

  if p_lock_token is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 600 then
    raise exception 'Invalid worker provisioning lock request' using errcode = '22023';
  end if;

  insert into public.worker_provisioning_locks (
    user_id, lock_token, lease_until, created_at, updated_at
  )
  values (
    current_user_id, p_lock_token, now() + make_interval(secs => p_lease_seconds), now(), now()
  )
  on conflict (user_id) do update
    set lock_token = excluded.lock_token,
        lease_until = excluded.lease_until,
        updated_at = now()
    where public.worker_provisioning_locks.lease_until < now()
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

create or replace function public.renew_worker_provisioning_lock(
  p_user_id uuid,
  p_lock_token uuid,
  p_lease_seconds integer default 300
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
  if current_user_id is null or p_user_id is distinct from current_user_id then
    raise exception 'Provisioning lock must belong to auth.uid()' using errcode = '42501';
  end if;

  if p_lock_token is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 600 then
    raise exception 'Invalid worker provisioning lease renewal' using errcode = '22023';
  end if;

  update public.worker_provisioning_locks
  set lease_until = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where user_id = current_user_id
    and lock_token = p_lock_token
    and lease_until > now();

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

create or replace function public.release_worker_provisioning_lock(
  p_user_id uuid,
  p_lock_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  deleted_rows integer := 0;
begin
  if current_user_id is null or p_user_id is distinct from current_user_id then
    raise exception 'Provisioning lock must belong to auth.uid()' using errcode = '42501';
  end if;

  if p_lock_token is null then
    raise exception 'Invalid worker provisioning lock request' using errcode = '22023';
  end if;

  delete from public.worker_provisioning_locks
  where user_id = current_user_id
    and lock_token = p_lock_token;

  get diagnostics deleted_rows = row_count;
  return deleted_rows = 1;
end;
$$;

create or replace function public.complete_worker_provisioning()
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  changed_rows integer := 0;
begin
  if current_user_id is null or current_session_id is null then
    raise exception 'Authenticated worker session required' using errcode = '42501';
  end if;

  update public.worker_sessions
  set provisioned_at = now(),
      updated_at = now()
  where user_id = current_user_id
    and auth_session_id = current_session_id
    and revoked_at is null;

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.acquire_worker_provisioning_lock(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.renew_worker_provisioning_lock(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.release_worker_provisioning_lock(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_worker_provisioning()
  from public, anon, authenticated, service_role;
grant execute on function public.acquire_worker_provisioning_lock(uuid, uuid, integer)
  to authenticated;
grant execute on function public.renew_worker_provisioning_lock(uuid, uuid, integer)
  to authenticated;
grant execute on function public.release_worker_provisioning_lock(uuid, uuid)
  to authenticated;
grant execute on function public.complete_worker_provisioning()
  to authenticated;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  event_user_id uuid := nullif(event ->> 'user_id', '')::uuid;
  event_session_id uuid := nullif(event -> 'claims' ->> 'session_id', '')::uuid;
begin
  if event_user_id is not null
     and event_session_id is not null
     and exists (
       select 1
       from public.worker_sessions as ws
       where ws.user_id = event_user_id
         and ws.auth_session_id = event_session_id
         and ws.revoked_at is null
         and ws.provisioned_at is not null
     ) then
    claims := jsonb_set(claims, '{worker}', 'true'::jsonb, true);
  else
    claims := claims - 'worker';
  end if;

  return jsonb_set(event, '{claims}', claims, true);
end;
$$;

revoke all on function public.custom_access_token_hook(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.custom_access_token_hook(jsonb)
  to supabase_auth_admin;

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

drop policy if exists execution_logs_insert_worker on public.execution_logs;
create policy execution_logs_insert_worker
  on public.execution_logs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select private.is_active_worker_session())
  );

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

comment on table public.worker_sessions is
  'User-scoped worker registration. Only the dedicated Auth session matching JWT session_id may register or activate its own opaque vault reference.';
comment on table public.worker_provisioning_locks is
  'RLS-scoped, per-user provisioning lease. No service-role table grant is used.';
comment on function public.complete_worker_provisioning() is
  'Activates only the caller-owned worker session matching auth.uid() and JWT session_id.';
comment on function public.claim_worker_operation(text, text, uuid) is
  'Claims idempotent worker operations under the authenticated user and active worker-session RLS boundary.';

commit;
