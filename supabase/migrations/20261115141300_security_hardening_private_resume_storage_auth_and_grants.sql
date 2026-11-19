
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf'];

drop policy if exists "resume_objects_select_own" on storage.objects;
drop policy if exists "resume_objects_insert_own" on storage.objects;
drop policy if exists "resume_objects_update_own" on storage.objects;
drop policy if exists "resume_objects_delete_own" on storage.objects;

create policy "resume_objects_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'resumes'
  and name ~ (
    '^' || (select auth.uid())::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$'
  )
);

create policy "resume_objects_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'resumes'
  and name ~ (
    '^' || (select auth.uid())::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$'
  )
);

-- Immutable object keys: upload with a new UUID and upsert=false.
-- No direct object deletion until a server workflow can coordinate metadata and storage.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    new.email,
    left(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''), 160)
  )
  on conflict (user_id) do update
    set email = excluded.email;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.handle_new_auth_user();

insert into public.profiles (user_id, email, full_name)
select
  u.id,
  u.email,
  left(nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''), 160)
from auth.users as u
on conflict (user_id) do nothing;

alter table public.resumes
  drop constraint if exists resumes_storage_path_canonical_check;
alter table public.resumes
  add constraint resumes_storage_path_canonical_check
  check (
    storage_bucket = 'resumes'
    and storage_path ~ (
      '^' || user_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$'
    )
    and mime_type = 'application/pdf'
    and (file_size_bytes is null or file_size_bytes between 1 and 10485760)
  );

create unique index if not exists resumes_user_storage_path_uidx
  on public.resumes(user_id, storage_path);

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

grant usage on schema public to authenticated;

grant select on
  public.profiles, public.resumes, public.jobs, public.applications,
  public.execution_logs, public.user_preferences, public.user_activity_events,
  public.user_insights
to authenticated;

grant update (
  full_name, phone, location, linkedin_url, portfolio_url, headline,
  professional_summary, skills, preferred_locations,
  preferred_employment_types, min_salary, salary_currency,
  remote_preference, onboarding_completed, updated_at
) on public.profiles to authenticated;

grant insert (
  user_id, name, storage_bucket, storage_path, original_filename,
  mime_type, file_size_bytes
) on public.resumes to authenticated;
grant update (name, is_default, updated_at) on public.resumes to authenticated;

grant insert (
  user_id, external_id, source, source_url, company_name, company_website,
  title, description, location, country_code, employment_type, remote,
  salary_min, salary_max, salary_currency, required_skills, preferred_skills,
  experience_level, application_url, published_at, expires_at,
  pre_filter_score, pre_filter_passed, pre_filter_reasons, raw_metadata,
  is_active, scraped_at
) on public.jobs to authenticated;
grant update (
  external_id, source, source_url, company_name, company_website,
  title, description, location, country_code, employment_type, remote,
  salary_min, salary_max, salary_currency, required_skills, preferred_skills,
  experience_level, application_url, published_at, expires_at,
  pre_filter_score, pre_filter_passed, pre_filter_reasons, raw_metadata,
  is_active, scraped_at, updated_at
) on public.jobs to authenticated;

grant insert (user_id, job_id, resume_id, notes)
on public.applications to authenticated;
grant update (
  status, match_score, match_reasons, ai_analysis, tailored_resume_storage_path,
  cover_letter, submission_method, external_application_id, applied_at,
  last_status_sync_at, retry_count, last_error, manual_assist_required,
  manual_assist_url, notes, updated_at
) on public.applications to authenticated;

grant insert (
  user_id, application_id, job_id, execution_type, status, service_name,
  operation, attempt_number, duration_ms, error_code, error_message,
  fallback_reason, metadata
) on public.execution_logs to authenticated;

grant insert (
  user_id, scan_frequency, scan_time, timezone, scan_enabled, scan_sources,
  submission_mode, min_match_score, auto_submit_enabled, require_approval,
  updated_at
) on public.user_preferences to authenticated;
grant update (
  scan_frequency, scan_time, timezone, scan_enabled, scan_sources,
  submission_mode, min_match_score, auto_submit_enabled, require_approval,
  updated_at
) on public.user_preferences to authenticated;

grant insert (user_id, event_type, entity_type, entity_id, payload)
on public.user_activity_events to authenticated;

grant insert (
  user_id, learned_preferences, next_best_actions, confidence, generated_at
) on public.user_insights to authenticated;
grant update (
  learned_preferences, next_best_actions, confidence, generated_at
) on public.user_insights to authenticated;

commit;
