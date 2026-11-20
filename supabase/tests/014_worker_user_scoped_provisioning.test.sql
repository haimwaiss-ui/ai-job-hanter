begin;
select plan(25);

insert into auth.users (id, email)
values
  ('e1000000-0000-4000-8000-000000000001', 'worker-provision-a@example.invalid'),
  ('e1000000-0000-4000-8000-000000000002', 'worker-provision-b@example.invalid')
on conflict (id) do nothing;

-- User A obtains a dedicated Auth session and may lock only its own provisioning.
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e2000000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;

select ok(
  public.acquire_worker_provisioning_lock(
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    300
  ),
  'a user can acquire a provisioning lease for auth.uid()'
);
select ok(
  public.renew_worker_provisioning_lock(
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    300
  ),
  'a user can renew only its matching provisioning lease'
);

select lives_ok(
  $$
    insert into public.worker_sessions (
      user_id, token_vault_ref, auth_session_id, revoked_at, provisioned_at, updated_at
    )
    values (
      'e1000000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000001',
      null,
      null,
      now()
    )
  $$,
  'a dedicated Auth session can register only its own worker session'
);

reset role;
set local role supabase_auth_admin;
select ok(
  not (
    public.custom_access_token_hook(jsonb_build_object(
      'user_id', 'e1000000-0000-4000-8000-000000000001',
      'claims', jsonb_build_object('session_id', 'e2000000-0000-4000-8000-000000000001')
    )) -> 'claims' ? 'worker'
  ),
  'the Auth hook withholds worker=true until provisioning is completed'
);

reset role;
set local role authenticated;
select ok(
  public.complete_worker_provisioning(),
  'the matching dedicated session can complete its own provisioning'
);

reset role;
set local role supabase_auth_admin;
select ok(
  (
    public.custom_access_token_hook(jsonb_build_object(
      'user_id', 'e1000000-0000-4000-8000-000000000001',
      'claims', jsonb_build_object('session_id', 'e2000000-0000-4000-8000-000000000001')
    )) -> 'claims' ->> 'worker'
  ) = 'true',
  'the Auth hook issues worker=true only for the provisioned matching session'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","worker":true,"session_id":"e2000000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;

select ok(
  (select worker_enabled from public.worker_current_context()),
  'Postgres confirms the active worker session for auth.uid()'
);
select ok(
  public.claim_worker_operation(
    'scraper-queue',
    repeat('a', 64),
    'e5000000-0000-4000-8000-000000000001'
  ),
  'the worker can claim an operation in its own tenant'
);
select ok(
  not public.claim_worker_operation(
    'scraper-queue',
    repeat('a', 64),
    'e5000000-0000-4000-8000-000000000002'
  ),
  'a duplicate idempotency key cannot be claimed by a different operation'
);

select lives_ok(
  $$
    insert into public.execution_logs (
      user_id, execution_type, status, service_name, operation, attempt_number, metadata
    )
    values (
      'e1000000-0000-4000-8000-000000000001',
      'scraping',
      'running',
      'bullmq-worker',
      'scraper-queue',
      1,
      '{}'::jsonb
    )
  $$,
  'the active user-scoped worker can write its own execution log'
);

select ok(
  not has_table_privilege('service_role', 'public.worker_sessions', 'INSERT'),
  'service_role has no direct INSERT privilege on worker_sessions'
);
select ok(
  not has_table_privilege('service_role', 'public.worker_provisioning_locks', 'INSERT'),
  'service_role has no direct INSERT privilege on provisioning locks'
);
select ok(
  not has_table_privilege('service_role', 'public.worker_operations', 'INSERT'),
  'service_role has no direct INSERT privilege on worker_operations'
);
select ok(
  not has_table_privilege('service_role', 'public.execution_logs', 'INSERT'),
  'service_role has no direct INSERT privilege on execution_logs'
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
  (select count(*)::integer from public.worker_sessions
   where user_id = 'e1000000-0000-4000-8000-000000000001'),
  0,
  'another tenant cannot read the first user worker-session row'
);
select is(
  (select count(*)::integer from public.worker_provisioning_locks
   where user_id = 'e1000000-0000-4000-8000-000000000001'),
  0,
  'another tenant cannot read the first user provisioning lease'
);
select is(
  (select count(*)::integer from public.worker_operations
   where user_id = 'e1000000-0000-4000-8000-000000000001'),
  0,
  'another tenant cannot read the first user worker operation'
);
select is(
  (select count(*)::integer from public.execution_logs
   where user_id = 'e1000000-0000-4000-8000-000000000001'),
  0,
  'another tenant cannot read the first user execution log'
);
select throws_ok(
  $$select public.acquire_worker_provisioning_lock(
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000002',
    300
  )$$,
  '42501',
  'a user cannot acquire another tenant provisioning lease'
);
select throws_ok(
  $$select public.claim_worker_operation(
    'scraper-queue',
    repeat('b', 64),
    'e5000000-0000-4000-8000-000000000003'
  )$$,
  '42501',
  'a user without an active worker session cannot claim operations'
);
select throws_ok(
  $$
    insert into public.worker_operations (
      user_id, queue_name, idempotency_key, operation_id, status, attempt_count, lease_until
    )
    values (
      'e1000000-0000-4000-8000-000000000001',
      'scraper-queue',
      repeat('c', 64),
      'e5000000-0000-4000-8000-000000000004',
      'running',
      1,
      now() + interval '10 minutes'
    )
  $$,
  '42501',
  'a user cannot insert a worker operation for another tenant'
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
  public.release_worker_provisioning_lock(
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001'
  ),
  'the user can release its own matching provisioning lease'
);

update public.worker_sessions
set revoked_at = now(), updated_at = now()
where user_id = 'e1000000-0000-4000-8000-000000000001';

select ok(
  not (select worker_enabled from public.worker_current_context()),
  'worker access is revoked immediately when the session row is revoked'
);
select throws_ok(
  $$select public.claim_worker_operation(
    'scraper-queue',
    repeat('a', 64),
    'e5000000-0000-4000-8000-000000000005'
  )$$,
  '42501',
  'a revoked worker session cannot claim another operation'
);
select throws_ok(
  $$
    insert into public.execution_logs (
      user_id, execution_type, status, service_name, operation, attempt_number, metadata
    )
    values (
      'e1000000-0000-4000-8000-000000000001',
      'scraping',
      'failed',
      'bullmq-worker',
      'scraper-queue',
      2,
      '{}'::jsonb
    )
  $$,
  '42501',
  'a revoked worker session cannot write execution logs'
);

reset role;
select * from finish();
rollback;
