begin;
select plan(14);

select ok(
  (select public = false from storage.buckets where id = 'resumes'),
  'resume bucket is private'
);
select ok(
  exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='resume_objects_select_own' and cmd='SELECT'),
  'resume object reads are owner-scoped'
);
select ok(
  exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='resume_objects_insert_own' and cmd='INSERT'),
  'resume object inserts are owner-scoped'
);
select ok(
  exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='resume_objects_delete_own' and cmd='DELETE'),
  'resume object deletion is owner-scoped'
);
select ok(
  not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='resume_objects_update_own'),
  'resume object replacement is disabled'
);
select ok(
  not has_table_privilege('authenticated','public.profiles','INSERT'),
  'authenticated cannot create profiles directly'
);
select ok(
  has_column_privilege('authenticated','public.profiles','full_name','UPDATE'),
  'authenticated can update allowed profile fields'
);
select ok(
  not has_column_privilege('authenticated','public.profiles','email','UPDATE'),
  'authenticated cannot update profile email'
);
select ok(
  not has_column_privilege('authenticated','public.resumes','parsed_text','UPDATE'),
  'authenticated cannot update server-parsed resume content'
);
select ok(
  not has_column_privilege('authenticated','public.applications','status','INSERT'),
  'authenticated cannot choose application status at creation'
);
select ok(
  not has_table_privilege('authenticated','public.worker_sessions','INSERT'),
  'authenticated cannot self-register a worker session'
);
select ok(
  not has_table_privilege('authenticated','public.worker_sessions','UPDATE'),
  'authenticated cannot modify worker session registration'
);
select ok(
  not has_table_privilege('authenticated','public.worker_sessions','DELETE'),
  'authenticated cannot revoke or delete worker session rows directly'
);
select ok(
  (select relrowsecurity from pg_class where oid='public.worker_operations'::regclass),
  'worker operations enforce row-level security'
);

select * from finish();
rollback;
