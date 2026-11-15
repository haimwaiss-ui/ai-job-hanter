begin;
drop policy if exists profiles_select_own_or_employer_applicant on public.profiles;
drop policy if exists profiles_select_employer_applicants on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated
using (user_id = (select auth.uid()));

create or replace view public.employer_applicant_profiles
with (security_barrier = true)
as
select
  ea.id as application_id,
  ea.employer_user_id,
  ea.employer_job_id,
  ea.candidate_user_id,
  ea.cover_letter,
  ea.status,
  ea.created_at,
  ea.updated_at,
  p.full_name,
  p.headline,
  p.location as candidate_location,
  p.skills,
  j.title as job_title,
  j.department as job_department,
  j.location as job_location
from public.employer_applications ea
join public.profiles p on p.user_id = ea.candidate_user_id
join public.employer_jobs j on j.id = ea.employer_job_id
where ea.employer_user_id = (select auth.uid());

grant select on public.employer_applicant_profiles to authenticated;
commit;