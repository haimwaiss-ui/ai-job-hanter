-- AI Job Hunter Phase 1 schema
-- Apply this migration before 002_security_foundation.sql.
create extension if not exists pgcrypto;

do $$ begin
  create type public.employment_type as enum ('full_time','part_time','contract','freelance','internship','temporary','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.application_status as enum ('discovered','analyzing','matched','pending_approval','approved','generating_resume','ready_to_submit','submitting','submitted','interviewing','offer_received','rejected','withdrawn','manual_assist','failed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.execution_type as enum ('scraping','pre_filtering','ai_matching','resume_generation','pdf_generation','email_submission','form_submission','manual_assist','status_sync','system');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.execution_status as enum ('pending','running','success','failed','fallback','retrying');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  location text,
  linkedin_url text,
  portfolio_url text,
  headline text,
  professional_summary text,
  skills text[] not null default '{}',
  preferred_locations text[] not null default '{}',
  preferred_employment_types public.employment_type[] not null default '{}',
  min_salary numeric,
  salary_currency varchar(3),
  remote_preference boolean,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  storage_bucket text not null default 'resumes',
  storage_path text not null,
  original_filename text,
  mime_type text not null default 'application/pdf',
  file_size_bytes bigint,
  parsed_text text,
  parsed_data jsonb not null default '{}'::jsonb,
  skills text[] not null default '{}',
  is_default boolean not null default false,
  is_ai_generated boolean not null default false,
  source_resume_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,id),
  constraint resumes_source_fk foreign key(user_id,source_resume_id) references public.resumes(user_id,id) on delete no action
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_id text,
  source text not null default 'manual',
  source_url text not null default '',
  company_name text not null,
  company_website text,
  title text not null,
  description text,
  location text,
  country_code text,
  employment_type public.employment_type,
  remote boolean not null default false,
  salary_min numeric,
  salary_max numeric,
  salary_currency varchar(3),
  required_skills text[] not null default '{}',
  preferred_skills text[] not null default '{}',
  experience_level text,
  application_url text,
  published_at timestamptz,
  expires_at timestamptz,
  pre_filter_score numeric,
  pre_filter_passed boolean not null default false,
  pre_filter_reasons jsonb not null default '[]'::jsonb,
  raw_metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  scraped_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,id)
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null,
  resume_id uuid,
  status public.application_status not null default 'discovered',
  match_score numeric,
  match_reasons jsonb not null default '[]'::jsonb,
  ai_analysis jsonb not null default '{}'::jsonb,
  tailored_resume_storage_path text,
  cover_letter text,
  submission_method text,
  external_application_id text,
  applied_at timestamptz,
  last_status_sync_at timestamptz,
  retry_count integer not null default 0,
  last_error text,
  manual_assist_required boolean not null default false,
  manual_assist_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_job_fk foreign key(user_id,job_id) references public.jobs(user_id,id) on delete no action,
  constraint applications_resume_fk foreign key(user_id,resume_id) references public.resumes(user_id,id) on delete no action
);

create table if not exists public.execution_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid,
  job_id uuid,
  execution_type public.execution_type not null,
  status public.execution_status not null default 'pending',
  service_name text,
  operation text,
  attempt_number integer not null default 1,
  duration_ms integer,
  error_code text,
  error_message text,
  fallback_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint execution_logs_application_fk foreign key(user_id,application_id) references public.applications(user_id,id) on delete no action,
  constraint execution_logs_job_fk foreign key(user_id,job_id) references public.jobs(user_id,id) on delete no action
);

create index if not exists resumes_user_created_idx on public.resumes(user_id,created_at desc);
create index if not exists jobs_user_created_idx on public.jobs(user_id,created_at desc);
create index if not exists applications_user_status_idx on public.applications(user_id,status,created_at desc);
create index if not exists execution_logs_user_created_idx on public.execution_logs(user_id,created_at desc);

alter table public.profiles enable row level security;
alter table public.resumes enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.execution_logs enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists resumes_select_own on public.resumes;
create policy resumes_select_own on public.resumes for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists resumes_insert_own on public.resumes;
create policy resumes_insert_own on public.resumes for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists resumes_update_own on public.resumes;
create policy resumes_update_own on public.resumes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists resumes_delete_own on public.resumes;
create policy resumes_delete_own on public.resumes for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists jobs_select_own on public.jobs;
create policy jobs_select_own on public.jobs for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists applications_select_own on public.applications;
create policy applications_select_own on public.applications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists applications_insert_own on public.applications;
create policy applications_insert_own on public.applications for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists execution_logs_select_own on public.execution_logs;
create policy execution_logs_select_own on public.execution_logs for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists execution_logs_insert_worker on public.execution_logs;
create policy execution_logs_insert_worker on public.execution_logs for insert to authenticated
with check (user_id = (select auth.uid()) and coalesce((auth.jwt() ->> 'worker')::boolean,false));

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.resumes to authenticated;
grant select on public.jobs to authenticated;
grant select, insert on public.applications to authenticated;
grant select, insert on public.execution_logs to authenticated;

