begin;
create index if not exists applications_user_job_idx on public.applications(user_id,job_id);
create index if not exists applications_user_resume_idx on public.applications(user_id,resume_id);
create index if not exists execution_logs_user_application_idx on public.execution_logs(user_id,application_id);
create index if not exists execution_logs_user_job_idx on public.execution_logs(user_id,job_id);
create index if not exists resumes_user_source_idx on public.resumes(user_id,source_resume_id);
commit;
