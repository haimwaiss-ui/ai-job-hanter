begin;
select plan(13);

insert into auth.users (id, email)
values (
  'e1000000-0000-4000-8000-000000000001',
  'worker-session-revocation@example.invalid'
)
on conflict (id) do nothing;

insert into public.worker_sessions (
  user_id, token_vault_ref, auth_session_id, revoked_at
)
values (
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  null
)
on conflict (user_id) do update
set token_vault_ref = excluded.token_vault_ref,
    auth_session_id = excluded.auth_session_id,
    revoked_at = null;

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","worker":true,"session_id":"e2000000-0000-4000-8000-000000000001"}',
  true
);

select ok(public.is_active_worker_session(), 'matching active worker session is accepted');
select ok(
  (select worker_enabled from public.worker_current_context()),
  'worker context reports an active matching session'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","worker":true,"session_id":"e2000000-0000-4000-8000-000000000002"}',
  true
);
select ok(not public.is_active_worker_session(), 'a different Auth session is rejected');

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","worker":true,"session_id":"e2000000-0000-4000-8000-000000000001"}',
  true
);
update public.worker_sessions
set revoked_at = now()
where user_id = 'e1000000-0000-4000-8000-000000000001';

select ok(not public.is_active_worker_session(), 'revocation invalidates an unexpired worker JWT');
select ok(
  not (select worker_enabled from public.worker_current_context()),
  'worker context denies a revoked session'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.is_active_worker_session()'::regprocedure),
  'active-session check is security definer'
);
select ok(
  has_function_privilege('authenticated', 'public.is_active_worker_session()', 'EXECUTE'),
  'authenticated can evaluate the active-session check'
);
select ok(
  not has_function_privilege('anon', 'public.is_active_worker_session()', 'EXECUTE'),
  'anonymous users cannot execute the active-session check'
);
select ok(
  (select pg_get_expr(polqual, polrelid) ilike '%is_active_worker_session%'
   from pg_policy where polname = 'worker_operations_select_worker'),
  'worker operation reads re-check the active session'
);
select ok(
  (select pg_get_expr(polwithcheck, polrelid) ilike '%is_active_worker_session%'
   from pg_policy where polname = 'worker_operations_insert_worker'),
  'worker operation inserts re-check the active session'
);
select ok(
  (select pg_get_expr(polqual, polrelid) ilike '%is_active_worker_session%'
   and pg_get_expr(polwithcheck, polrelid) ilike '%is_active_worker_session%'
   from pg_policy where polname = 'worker_operations_update_worker'),
  'worker operation updates re-check the active session'
);
select ok(
  (select pg_get_expr(polqual, polrelid) ilike '%is_active_worker_session%'
   and pg_get_expr(polwithcheck, polrelid) ilike '%is_active_worker_session%'
   from pg_policy where polname = 'applications_update_worker'),
  'worker application updates re-check the active session'
);
select ok(
  pg_get_functiondef('public.claim_worker_operation(text,text,uuid)'::regprocedure)
    ilike '%is_active_worker_session%',
  'atomic operation claims require an active worker session'
);

select * from finish();
rollback;
