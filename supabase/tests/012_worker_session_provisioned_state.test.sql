begin;
select plan(5);

insert into auth.users (id, email)
values (
  'f3000000-0000-4000-8000-000000000001',
  'worker-provisioned-state@example.invalid'
)
on conflict (id) do nothing;

insert into public.worker_sessions (
  user_id, token_vault_ref, auth_session_id, revoked_at, provisioned_at
)
values (
  'f3000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000001',
  null,
  null
)
on conflict (user_id) do update
set token_vault_ref = excluded.token_vault_ref,
    auth_session_id = excluded.auth_session_id,
    revoked_at = null,
    provisioned_at = null;

select set_config(
  'request.jwt.claims',
  '{"sub":"f3000000-0000-4000-8000-000000000001","role":"authenticated","worker":true,"session_id":"f5000000-0000-4000-8000-000000000001"}',
  true
);

select ok(
  not public.is_active_worker_session(),
  'worker token is denied while provisioning is incomplete'
);

update public.worker_sessions
set provisioned_at = now()
where user_id = 'f3000000-0000-4000-8000-000000000001';

select ok(
  public.is_active_worker_session(),
  'worker token is accepted after vault storage is marked complete'
);

update public.worker_sessions
set revoked_at = now()
where user_id = 'f3000000-0000-4000-8000-000000000001';

select ok(
  not public.is_active_worker_session(),
  'revocation denies a previously provisioned worker token'
);

select ok(
  has_column_privilege('authenticated', 'public.worker_sessions', 'provisioned_at', 'SELECT'),
  'authenticated owners can read provisioning status'
);
select ok(
  not has_column_privilege('authenticated', 'public.worker_sessions', 'provisioned_at', 'UPDATE'),
  'authenticated users cannot mark their own worker session provisioned'
);

select * from finish();
rollback;
