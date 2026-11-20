begin;

create table if not exists public.worker_provisioning_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lock_token uuid not null,
  lease_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.worker_provisioning_locks enable row level security;
revoke all privileges on public.worker_provisioning_locks from public, anon, authenticated;
grant all privileges on public.worker_provisioning_locks to service_role;
grant usage on schema public to service_role;

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
  released boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Trusted service role required' using errcode = '42501';
  end if;

  if p_user_id is null or p_lock_token is null then
    raise exception 'Invalid worker provisioning lock request' using errcode = '22023';
  end if;

  delete from public.worker_provisioning_locks
  where user_id = p_user_id
    and lock_token = p_lock_token
  returning true into released;

  return coalesce(released, false);
end;
$$;

revoke all on function public.acquire_worker_provisioning_lock(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.release_worker_provisioning_lock(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.acquire_worker_provisioning_lock(uuid, uuid, integer)
  to service_role;
grant execute on function public.release_worker_provisioning_lock(uuid, uuid)
  to service_role;

comment on table public.worker_provisioning_locks is
  'Short-lived per-user leases serializing trusted worker-session provisioning; no browser role has access.';
comment on function public.acquire_worker_provisioning_lock(uuid, uuid, integer) is
  'Acquires an expiring worker-provisioning lease. Executable only with the Supabase service_role JWT.';
comment on function public.release_worker_provisioning_lock(uuid, uuid) is
  'Releases only the matching worker-provisioning lease token. Executable only with the Supabase service_role JWT.';

commit;
