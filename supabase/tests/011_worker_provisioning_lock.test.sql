begin;
select plan(9);

insert into auth.users (id, email)
values (
  'f1000000-0000-4000-8000-000000000001',
  'worker-provisioning-lock@example.invalid'
)
on conflict (id) do nothing;

select set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"f1000000-0000-4000-8000-000000000001"}',
  true
);

select ok(
  public.acquire_worker_provisioning_lock(
    'f1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000001',
    300
  ),
  'trusted service role acquires a new provisioning lease'
);
select ok(
  not public.acquire_worker_provisioning_lock(
    'f1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000002',
    300
  ),
  'a second provisioner cannot steal an unexpired lease'
);
select ok(
  not public.release_worker_provisioning_lock(
    'f1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000002'
  ),
  'a different lock token cannot release the lease'
);
select ok(
  public.release_worker_provisioning_lock(
    'f1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000001'
  ),
  'the matching lock token releases the lease'
);
select ok(
  public.acquire_worker_provisioning_lock(
    'f1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000003',
    300
  ),
  'a new provisioner can acquire after release'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"f1000000-0000-4000-8000-000000000001"}',
  true
);
select throws_ok(
  $$select public.acquire_worker_provisioning_lock(
    'f1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000004',
    300
  )$$,
  '42501',
  'Trusted service role required',
  'authenticated users cannot acquire provisioning leases'
);
select ok(
  not has_table_privilege('authenticated', 'public.worker_provisioning_locks', 'SELECT'),
  'authenticated users cannot read provisioning lock rows'
);
select ok(
  not has_function_privilege('authenticated', 'public.acquire_worker_provisioning_lock(uuid,uuid,integer)', 'EXECUTE'),
  'authenticated users cannot execute the lock function'
);
select ok(
  has_function_privilege('service_role', 'public.acquire_worker_provisioning_lock(uuid,uuid,integer)', 'EXECUTE'),
  'service role can execute the lock function'
);

select * from finish();
rollback;
