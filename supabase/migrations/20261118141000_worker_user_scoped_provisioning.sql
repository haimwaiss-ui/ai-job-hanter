-- Keep worker-session provisioning in a trusted control plane.
-- Authenticated users may inspect their own opaque vault reference but cannot
-- create, activate, rotate, or revoke worker sessions themselves.
begin;

alter table public.worker_sessions enable row level security;
revoke all privileges on public.worker_sessions
  from public, anon, authenticated, service_role;
grant select (user_id, token_vault_ref, revoked_at, provisioned_at)
  on public.worker_sessions to authenticated;
grant select, insert, update, delete on public.worker_sessions to service_role;

drop policy if exists worker_sessions_insert_own_session on public.worker_sessions;
drop policy if exists worker_sessions_update_own_session on public.worker_sessions;
drop policy if exists worker_sessions_select_own on public.worker_sessions;
create policy worker_sessions_select_own
  on public.worker_sessions for select to authenticated
  using (user_id = (select auth.uid()));

-- Provisioning leases remain private to the trusted CLI. Browser roles have
-- neither table privileges nor RLS policies on this table.
alter table public.worker_provisioning_locks enable row level security;
revoke all privileges on public.worker_provisioning_locks
  from public, anon, authenticated, service_role;
grant select, insert, update, delete
  on public.worker_provisioning_locks to service_role;

drop policy if exists worker_provisioning_locks_select_own on public.worker_provisioning_locks;
drop policy if exists worker_provisioning_locks_insert_own on public.worker_provisioning_locks;
drop policy if exists worker_provisioning_locks_update_own on public.worker_provisioning_locks;
drop policy if exists worker_provisioning_locks_delete_own on public.worker_provisioning_locks;

create or replace function public.acquire_worker_provisioning_lock(
  p_user_id uuid,
  p_lock_token uuid,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  acquired boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Trusted service role required' using errcode = '42501';
  end if;

  if p_user_id is null
    or p_lock_token is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 600 then
    raise exception 'Invalid worker provisioning lock request' using errcode = '22023';
  end if;

  insert into public.worker_provisioning_locks (
    user_id, lock_token, lease_until, created_at, updated_at
  )
  values (
    p_user_id, p_lock_token, now() + make_interval(secs => p_lease_seconds), now(), now()
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
security definer
set search_path = ''
set row_security = off
as $$
declare
  changed_rows integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Trusted service role required' using errcode = '42501';
  end if;

  if p_user_id is null
    or p_lock_token is null
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 600 then
    raise exception 'Invalid worker provisioning lease renewal' using errcode = '22023';
  end if;

  update public.worker_provisioning_locks
  set lease_until = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where user_id = p_user_id
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
security definer
set search_path = ''
set row_security = off
as $$
declare
  deleted_rows integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Trusted service role required' using errcode = '42501';
  end if;

  if p_user_id is null or p_lock_token is null then
    raise exception 'Invalid worker provisioning lock request' using errcode = '22023';
  end if;

  delete from public.worker_provisioning_locks
  where user_id = p_user_id
    and lock_token = p_lock_token;

  get diagnostics deleted_rows = row_count;
  return deleted_rows = 1;
end;
$$;

revoke all on function public.acquire_worker_provisioning_lock(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.renew_worker_provisioning_lock(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.release_worker_provisioning_lock(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.acquire_worker_provisioning_lock(uuid, uuid, integer)
  to service_role;
grant execute on function public.renew_worker_provisioning_lock(uuid, uuid, integer)
  to service_role;
grant execute on function public.release_worker_provisioning_lock(uuid, uuid)
  to service_role;

-- Remove the draft's user-callable activation RPC. Only the trusted CLI may
-- set provisioned_at, and only after the initial AWS secret has been written.
drop function if exists public.complete_worker_provisioning();

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

comment on table public.worker_sessions is
  'User-scoped provisioning. Authenticated users may manage only their own session row when the signed JWT session_id matches; tokens are stored only in AWS Secrets Manager.';
comment on table public.worker_provisioning_locks is
  'Short-lived per-user provisioning leases. Authenticated access is constrained by SECURITY INVOKER RPCs and owner-only RLS policies.';
comment on function public.acquire_worker_provisioning_lock(uuid, uuid, integer) is
  'Acquires an expiring lease only for auth.uid(); SECURITY INVOKER and RLS enforce tenant ownership.';
comment on function public.renew_worker_provisioning_lock(uuid, uuid, integer) is
  'Renews only the caller's matching unexpired provisioning lease under RLS.';
comment on function public.release_worker_provisioning_lock(uuid, uuid) is
  'Releases only the caller's matching provisioning lease token under RLS.';

commit;
