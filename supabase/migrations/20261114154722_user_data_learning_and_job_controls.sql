
begin;

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  scan_frequency text not null default 'daily' check (scan_frequency in ('daily','weekly','monthly')),
  scan_time time not null default '08:00',
  timezone text not null default 'Asia/Jerusalem',
  scan_enabled boolean not null default false,
  scan_sources text[] not null default array['manual']::text[],
  submission_mode text not null default 'approval' check (submission_mode in ('manual','approval','automatic')),
  min_match_score integer not null default 85 check (min_match_score between 0 and 100),
  auto_submit_enabled boolean not null default false,
  require_approval boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('profile_updated','job_added','job_opened','job_saved','job_dismissed','job_search','resume_uploaded','application_created','application_status_changed','scan_requested','preference_updated')),
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists user_activity_events_user_created_idx
  on public.user_activity_events(user_id, created_at desc);
create index if not exists user_activity_events_user_type_idx
  on public.user_activity_events(user_id, event_type, created_at desc);

create table if not exists public.user_insights (
  user_id uuid primary key references auth.users(id) on delete cascade,
  learned_preferences jsonb not null default '{}'::jsonb,
  next_best_actions jsonb not null default '[]'::jsonb,
  confidence numeric not null default 0 check (confidence between 0 and 1),
  generated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
alter table public.user_activity_events enable row level security;
alter table public.user_insights enable row level security;

drop policy if exists user_preferences_select_own on public.user_preferences;
create policy user_preferences_select_own on public.user_preferences
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists user_preferences_insert_own on public.user_preferences;
create policy user_preferences_insert_own on public.user_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists user_preferences_update_own on public.user_preferences;
create policy user_preferences_update_own on public.user_preferences
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists user_activity_select_own on public.user_activity_events;
create policy user_activity_select_own on public.user_activity_events
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists user_activity_insert_own on public.user_activity_events;
create policy user_activity_insert_own on public.user_activity_events
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists user_activity_delete_own on public.user_activity_events;
create policy user_activity_delete_own on public.user_activity_events
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists user_insights_select_own on public.user_insights;
create policy user_insights_select_own on public.user_insights
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists user_insights_insert_own on public.user_insights;
create policy user_insights_insert_own on public.user_insights
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists user_insights_update_own on public.user_insights;
create policy user_insights_update_own on public.user_insights
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update on public.user_preferences to authenticated;
grant select, insert, delete on public.user_activity_events to authenticated;
grant select, insert, update on public.user_insights to authenticated;

drop policy if exists jobs_insert_worker on public.jobs;
drop policy if exists jobs_insert_own on public.jobs;
create policy jobs_insert_own on public.jobs for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists jobs_update_own on public.jobs;
create policy jobs_update_own on public.jobs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists jobs_delete_own on public.jobs;
create policy jobs_delete_own on public.jobs for delete to authenticated
  using (user_id = (select auth.uid()));
grant update (external_id, source, source_url, company_name, company_website, title,
  description, location, country_code, employment_type, remote, salary_min, salary_max,
  salary_currency, required_skills, preferred_skills, experience_level, application_url,
  published_at, expires_at, pre_filter_score, pre_filter_passed, pre_filter_reasons,
  raw_metadata, is_active, scraped_at) on public.jobs to authenticated;
grant delete on public.jobs to authenticated;

drop policy if exists applications_update_own on public.applications;
create policy applications_update_own on public.applications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant update (status, match_score, match_reasons, ai_analysis, cover_letter,
  submission_method, external_application_id, applied_at, last_status_sync_at,
  retry_count, last_error, manual_assist_required, manual_assist_url, notes)
  on public.applications to authenticated;

commit;
