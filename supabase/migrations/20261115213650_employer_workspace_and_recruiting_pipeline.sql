begin;

create table if not exists public.employer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_name text not null,
  company_website text,
  company_description text,
  contact_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employer_jobs (
  id uuid primary key default gen_random_uuid(),
  employer_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  department text,
  description text not null default '',
  location text,
  employment_type text not null default 'full_time',
  workplace_type text not null default 'hybrid' check (workplace_type in ('onsite','hybrid','remote')),
  salary_range text,
  status text not null default 'draft' check (status in ('draft','published','paused','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employer_jobs_owner_created_idx on public.employer_jobs(employer_user_id, created_at desc);
create index if not exists employer_jobs_public_idx on public.employer_jobs(status, created_at desc);

create table if not exists public.employer_applications (
  id uuid primary key default gen_random_uuid(),
  employer_user_id uuid not null references auth.users(id) on delete cascade,
  employer_job_id uuid not null references public.employer_jobs(id) on delete cascade,
  candidate_user_id uuid not null references auth.users(id) on delete cascade,
  cover_letter text,
  status text not null default 'new' check (status in ('new','reviewing','interview','offer','rejected','hired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employer_job_id, candidate_user_id)
);

alter table public.employer_profiles enable row level security;
alter table public.employer_jobs enable row level security;
alter table public.employer_applications enable row level security;

create policy employer_profiles_select_own on public.employer_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy employer_profiles_insert_own on public.employer_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy employer_profiles_update_own on public.employer_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy employer_jobs_select_owner_or_published on public.employer_jobs for select to authenticated using (employer_user_id = (select auth.uid()) or status = 'published');
create policy employer_jobs_insert_owner on public.employer_jobs for insert to authenticated with check (employer_user_id = (select auth.uid()));
create policy employer_jobs_update_owner on public.employer_jobs for update to authenticated using (employer_user_id = (select auth.uid())) with check (employer_user_id = (select auth.uid()));
create policy employer_jobs_delete_owner on public.employer_jobs for delete to authenticated using (employer_user_id = (select auth.uid()));

create policy employer_applications_select_participant on public.employer_applications for select to authenticated using (employer_user_id = (select auth.uid()) or candidate_user_id = (select auth.uid()));
create policy employer_applications_insert_candidate on public.employer_applications for insert to authenticated with check (candidate_user_id = (select auth.uid()) and exists (select 1 from public.employer_jobs j where j.id = employer_job_id and j.status = 'published' and j.employer_user_id = employer_user_id));
create policy employer_applications_update_employer on public.employer_applications for update to authenticated using (employer_user_id = (select auth.uid())) with check (employer_user_id = (select auth.uid()));

grant select, insert, update on public.employer_profiles to authenticated;
grant select, insert, update, delete on public.employer_jobs to authenticated;
grant select, insert, update on public.employer_applications to authenticated;

commit;
