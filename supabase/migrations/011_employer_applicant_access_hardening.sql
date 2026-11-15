begin;
create index if not exists employer_applications_candidate_user_idx on public.employer_applications(candidate_user_id);
create index if not exists employer_applications_employer_user_idx on public.employer_applications(employer_user_id);
revoke update on public.employer_applications from authenticated;
grant update (status, updated_at) on public.employer_applications to authenticated;
drop policy if exists profiles_select_employer_applicants on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own_or_employer_applicant on public.profiles
for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.employer_applications ea
    where ea.candidate_user_id = profiles.user_id
      and ea.employer_user_id = (select auth.uid())
  )
);
commit;