begin;
drop view if exists public.employer_applicant_profiles;
create or replace function public.get_employer_applicant_profiles()
returns table (
  application_id uuid,
  employer_user_id uuid,
  employer_job_id uuid,
  candidate_user_id uuid,
  cover_letter text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  full_name text,
  headline text,
  candidate_location text,
  skills text[],
  job_title text,
  job_department text,
  job_location text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    ea.id,
    ea.employer_user_id,
    ea.employer_job_id,
    ea.candidate_user_id,
    ea.cover_letter,
    ea.status,
    ea.created_at,
    ea.updated_at,
    p.full_name,
    p.headline,
    p.location,
    p.skills,
    j.title,
    j.department,
    j.location
  from public.employer_applications ea
  join public.profiles p on p.user_id = ea.candidate_user_id
  join public.employer_jobs j on j.id = ea.employer_job_id
  where ea.employer_user_id = auth.uid();
$function$;
revoke all on function public.get_employer_applicant_profiles() from public, anon;
grant execute on function public.get_employer_applicant_profiles() to authenticated;
commit;
