begin;
select plan(15);

insert into auth.users (id, email)
values
  ('e1000000-0000-4000-8000-000000000001', 'worker-provision-a@example.invalid'),
  ('e1000000-0000-4000-8000-000000000002', 'worker-provision-b@example.invalid')
on conflict (id) do nothing;

insert into public.worker_provisioning_locks (
  user_id, lock_token, lease_until
)
values (
  'e1000000-0000-4000-8000-000000000002',
  'e3000000-0000-4000-8000-000000000002',
  now() + interval '5 minutes'
)
on conflict (user_id) do nothing;

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","worker":true,"session_id":"e2000000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;

select ok(
  public.acquire_worker_provisioning_lock(
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    300
  ),
  'authenticated user can acquire only its own provisioning lease'
);
select ok(
  not public.acquire_worker_provisioning_lock(
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000003',
    300
  ),
  'a second concurrent lease for the same user is rejected'
);
select ok(
  public.renew_worker_provisioning_lock(
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    300
  ),
  'only the matching lease token can renew the lease'
);
select ok(
  (select count(*) = 1 from public.worker_provisioning_locks),
  'RLS hides another user provisioning lock'
);
select ok(
  public.release_worker_provisioning_lock(
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001'
  ),
  'lease owner can release its lock'
);
select ok(
  not public.release_worker_provisioning_lock(
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000003'
  ),
  'a mismatched lock token cannot release a lease'
);

insert into public.worker_sessions (
  user_id, token_vault_ref, auth_session_id, revoked_at, provisioned_at
)
values (
  'e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  null,
  null
)
on conflict (user_id) do update
set token_vault_ref = excluded.token_vault_ref,
    auth_session_id = excluded.auth_session_id,
    revoked_at = null,
    provisioned_at = null;

select ok(
  not (public.custom_access_token_hook(jsonb_build_object(
    'user_id', 'e1000000-0000-4000-8000-000000000001',
    'claims', jsonb_build_object('session_id', 'e2000000-0000-4000-8000-000000000001')
  )) -> 'claims' ? 'worker'),
  'Auth hook does not issue worker claim before vault provisioning completes'
);

select ok(public.complete_worker_provisioning(), 'current user can complete provisioning for its exact session');
select ok(not public.complete_worker_provisioning(), 'provisioning completion is one-way');
select ok(
  (select provisioned_at is not null
   from public.worker_sessions
   where user_id = 'e1000000-0000-4000-8000-000000000001'),
  'provisioned_at is set only for the current tenant session'
);
select ok(
  (select worker_enabled from public.worker_current_context()),
  'worker context becomes active only after provisioning completes'
);
select ok(
  (public.custom_access_token_hook(jsonb_build_object(
    'user_id', 'e1000000-0000-4000-8000-000000000001',
    'claims', jsonb_build_object('session_id', 'e2000000-0000-4000-8000-000000000001')
  )) -> 'claims' ->> 'worker') = 'true',
  'Auth hook issues worker claim only after provisioning is complete'
);
select ok(
  public.claim_worker_operation(
    'scraper-queue',
    repeat('a', 64),
    'e5000000-0000-4000-8000-000000000001'
  ),
  'operation claim resolves the private active-session helper'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.acquire_worker_provisioning_lock(uuid,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated can execute the user-scoped lock RPC'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.acquire_worker_provisioning_lock(uuid,uuid,integer)',
    'EXECUTE'
  ),
  'service role cannot use the provisioning lock RPC'
);

reset role;
select * from finish();
rollback;
