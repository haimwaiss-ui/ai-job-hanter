alter table public.employer_applications
  add constraint employer_applications_candidate_profile_fk
  foreign key (candidate_user_id) references public.profiles(user_id) on delete cascade not valid;
alter table public.employer_applications validate constraint employer_applications_candidate_profile_fk;
drop policy if exists profiles_select_employer_applicants on public.profiles;
create policy profiles_select_employer_applicants on public.profiles
for select to authenticated
using (
  exists (
    select 1 from public.employer_applications ea
    where ea.candidate_user_id = profiles.user_id
      and ea.employer_user_id = (select auth.uid())
  )
);