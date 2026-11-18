begin;
select plan(17);

insert into auth.users (id, email)
values
  ('e1000000-0000-4000-8000-000000000001', 'worker-provision-a@example.invalid'),
  ('e1000000-0000-4000-8000-000000000002', 'worker-provision-b@example.invalid')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e2000000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;

select ok(
  not has_table_privilege('authenticated', 'public.worker_sessions', 'INSERT'),
  'authenticated users cannot create worker sessions'
);
select ok(
  not has_table_privilege('authenticated', 'public.worker_sessions', 'UPDATE'),
  'authenticated users cannot rotate or activate worker sessions'
);
select ok(
  has_column_privilege('authenticated', 'public.worker_sessions', 'user_id', 'SELECT')
  and not has_column_privilege('authenticated', 'public.worker_sessions', 'auth_session_id', 'SELECT'),
  'authenticated users can read only the minimal worker-session identity fields'
);
select ok(
  not has_table_privilege('authenticated', 'public.worker_provisioning_locks', 'SELECT'),
  'authenticated users cannot inspect provisioning locks'
);
select ok(
  not has_function_privilege('authenticated', 'public.acquire_worker_provisioning_lock(uuid,uuid,integer)', 'EXECUTE'),
  'authenticated users cannot acquire provisioning locks'
);
select ok(
  not has_function_privilege('authenticated', 'public.renew_worker_provisioning_lock(uuid,uuid,integer)', 'EXECUTE'),
  'authenticated users cannot renew provisioning locks'
);
select ok(
  to_regprocedure('public.complete_worker_provisioning()') is null,
  'there is no user-callable activation RPC'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
set local role service_role;

select ok(
  public.acquire_worker_provisioning_lock(
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    300
  ),
  'trusted service role can acquire a provisioning lease'
);
select ok(
  public.renew_worker_provisioning_lock(
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    300
  ),
  'trusted service role can renew its matching lease'
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
    provisioned_at = null,
    updated_at = now();

select ok(
  not (public.custom_access_token_hook(jsonb_build_object(
    'user_id', 'e1000000-0000-4000-8000-000000000001',
    'claims', jsonb_build_object('session_id', 'e2000000-0000-4000-8000-000000000001')
  )) -> 'claims' ? 'worker'),
  'Auth hook withholds the worker claim until the vault write is confirmed'
);

update public.worker_sessions
set provisioned_at = now()
where user_id = 'e1000000-0000-4000-8000-000000000001'
  and auth_session_id = 'e2000000-0000-4000-8000-000000000001';

select ok(
  (select provisioned_at is not null
   from public.worker_sessions
   where user_id = 'e1000000-0000-4000-8000-000000000001'),
  'only the trusted control plane marks the session provisioned'
);
select ok(
  (public.custom_access_token_hook(jsonb_build_object(
    'user_id', 'e1000000-0000-4000-8000-000000000001',
    'claims', jsonb_build_object('session_id', 'e2000000-0000-4000-8000-000000000001')
  )) -> 'claims' ->> 'worker') = 'true',
  'Auth hook issues the worker claim only after provisioning completes'
);

reset role;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","worker":true,"session_id":"e2000000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;

select ok(
  (select worker_enabled from public.worker_current_context()),
  'the exact provisioned Auth session is recognized as a worker'
);
select is(
  (select count(*)::integer from public.worker_sessions where user_id = 'e1000000-0000-4000-8000-000000000001'),
  1,
  'the owner can read its own worker-session row'
);

reset role;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"e2000000-0000-4000-8000-000000000002"}',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.worker_sessions where user_id = 'e1000000-0000-4000-8000-000000000001'),
  0,
  'another tenant cannot read the worker-session row'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select ok(
  public.release_worker_provisioning_lock(
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001'
  ),
  'trusted service role can release its matching lease'
);

reset role;
select * from finish();
rollback;
