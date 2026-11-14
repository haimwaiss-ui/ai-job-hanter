-- AI Job Hunter: BullMQ worker infrastructure
-- Additive migration. Preserves tenant composite FKs, private Storage and existing RLS.
begin;

alter table public.applications
  add column if not exists manual_assist_resume_storage_path text;

create table if not exists public.worker_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_vault_ref uuid not null unique,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.worker_sessions enable row level security;

drop policy if exists worker_sessions_select_own on public.worker_sessions;
create policy worker_sessions_select_own
  on public.worker_sessions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists worker_sessions_insert_own on public.worker_sessions;
create policy worker_sessions_insert_own
  on public.worker_sessions for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists worker_sessions_update_own on public.worker_sessions;
create policy worker_sessions_update_own
  on public.worker_sessions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists worker_sessions_delete_own on public.worker_sessions;
create policy worker_sessions_delete_own
  on public.worker_sessions for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.worker_sessions to authenticated;
grant usage on schema public to supabase_auth_admin;
grant select on public.worker_sessions to supabase_auth_admin;

create table if not exists public.worker_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  queue_name text not null check (
    queue_name in ('scraper-queue', 'ai-processing-queue', 'submission-queue')
  ),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  operation_id uuid not null,
  status text not null default 'running' check (
    status in ('running', 'retrying', 'completed', 'failed', 'manual_assist')
  ),
  attempt_count integer not null default 1 check (attempt_count between 1 and 20),
  lease_until timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, queue_name, idempotency_key)
);
create index if not exists worker_operations_user_status_idx
  on public.worker_operations(user_id, status, updated_at desc);
alter table public.worker_operations enable row level security;

drop policy if exists worker_operations_select_worker on public.worker_operations;
create policy worker_operations_select_worker
  on public.worker_operations for select to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'worker')::boolean, false)
  );

drop policy if exists worker_operations_insert_worker on public.worker_operations;
create policy worker_operations_insert_worker
  on public.worker_operations for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'worker')::boolean, false)
  );

drop policy if exists worker_operations_update_worker on public.worker_operations;
create policy worker_operations_update_worker
  on public.worker_operations for update to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'worker')::boolean, false)
  )
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'worker')::boolean, false)
  );

grant select, insert on public.worker_operations to authenticated;
grant update (
  operation_id, status, attempt_count, lease_until,
  last_error_code, last_error_message, updated_at, completed_at
) on public.worker_operations to authenticated;

-- Supabase Auth calls this hook when issuing or refreshing a JWT.
-- The worker claim is derived from a tenant-owned registration row, never
-- from user-editable user_metadata or queue data.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  event_user_id uuid := nullif(event -> 'user' ->> 'id', '')::uuid;
begin
  if event_user_id is not null and exists (
    select 1
    from public.worker_sessions as ws
    where ws.user_id = event_user_id
      and ws.revoked_at is null
  ) then
    claims := jsonb_set(claims, '{worker}', 'true'::jsonb, true);
  else
    claims := claims - 'worker';
  end if;

  return jsonb_set(event, '{claims}', claims, true);
end;
$$;

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Worker-side proof of the identity and claim actually seen by Postgres.
create or replace function public.worker_current_context()
returns table(user_id uuid, worker_enabled boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    auth.uid(),
    coalesce((auth.jwt() ->> 'worker')::boolean, false);
$$;
grant execute on function public.worker_current_context() to authenticated;

-- Atomic tenant-scoped claim. A retry of the same BullMQ operation can reclaim
-- its own lease; a different duplicate cannot run while the lease is active.
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
    or coalesce((auth.jwt() ->> 'worker')::boolean, false) is not true then
    raise exception 'Worker JWT required' using errcode = '42501';
  end if;

  if p_queue_name not in ('scraper-queue', 'ai-processing-queue', 'submission-queue')
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
grant execute on function public.claim_worker_operation(text, text, uuid) to authenticated;

-- Application writes are limited to the authenticated tenant and worker claim.
drop policy if exists applications_update_worker on public.applications;
create policy applications_update_worker
  on public.applications for update to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'worker')::boolean, false)
  )
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'worker')::boolean, false)
  );

grant update (
  status, retry_count, last_error, manual_assist_required,
  manual_assist_url, manual_assist_resume_storage_path,
  tailored_resume_storage_path, updated_at
) on public.applications to authenticated;

comment on table public.worker_sessions is
  'Stores only an opaque token-vault reference. Access and refresh tokens live outside Postgres.';
comment on table public.worker_operations is
  'Tenant-scoped idempotency and lease state for BullMQ jobs. No credentials or raw external page content.';
comment on column public.applications.manual_assist_resume_storage_path is
  'Private Storage object path for the PDF a user can download for manual application; never a public URL.';

commit;
