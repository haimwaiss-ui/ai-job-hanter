-- Read-only schema assertion for tenant-safe application foreign keys.
-- Run against an isolated Supabase database with the normal migration history applied.
do $$
declare
  job_definition text;
  resume_definition text;
begin
  select pg_get_constraintdef(oid)
    into job_definition
  from pg_constraint
  where conrelid = 'public.applications'::regclass
    and conname = 'applications_job_fk'
    and contype = 'f';

  select pg_get_constraintdef(oid)
    into resume_definition
  from pg_constraint
  where conrelid = 'public.applications'::regclass
    and conname = 'applications_resume_fk'
    and contype = 'f';

  if job_definition is null
    or job_definition not like 'FOREIGN KEY (user_id, job_id) REFERENCES jobs(user_id, id)%' then
    raise exception 'applications_job_fk is not tenant-safe: %', coalesce(job_definition, '<missing>');
  end if;

  if resume_definition is null
    or resume_definition not like 'FOREIGN KEY (user_id, resume_id) REFERENCES resumes(user_id, id)%' then
    raise exception 'applications_resume_fk is not tenant-safe: %', coalesce(resume_definition, '<missing>');
  end if;
end;
$$;
