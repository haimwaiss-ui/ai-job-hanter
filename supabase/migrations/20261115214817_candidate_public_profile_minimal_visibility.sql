begin;
create table if not exists public.candidate_public_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  headline text,
  location text,
  skills text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.candidate_public_profiles enable row level security;
drop policy if exists candidate_public_profiles_select_visible on public.candidate_public_profiles;
create policy candidate_public_profiles_select_visible on public.candidate_public_profiles
for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.employer_applications ea
    where ea.candidate_user_id = candidate_public_profiles.user_id
      and ea.employer_user_id = (select auth.uid())
  )
);
grant select on public.candidate_public_profiles to authenticated;

create schema if not exists private;
create or replace function private.sync_candidate_public_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into public.candidate_public_profiles(user_id, full_name, headline, location, skills, updated_at)
  values (new.user_id, new.full_name, new.headline, new.location, coalesce(new.skills, '{}'::text[]), now())
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    headline = excluded.headline,
    location = excluded.location,
    skills = excluded.skills,
    updated_at = now();
  return new;
end;
$function$;
revoke all on function private.sync_candidate_public_profile() from public, anon, authenticated;
drop trigger if exists sync_candidate_public_profile on public.profiles;
create trigger sync_candidate_public_profile
after insert or update of full_name, headline, location, skills
on public.profiles
for each row execute function private.sync_candidate_public_profile();

insert into public.candidate_public_profiles(user_id, full_name, headline, location, skills, updated_at)
select user_id, full_name, headline, location, coalesce(skills, '{}'::text[]), now()
from public.profiles
on conflict (user_id) do update set
  full_name = excluded.full_name,
  headline = excluded.headline,
  location = excluded.location,
  skills = excluded.skills,
  updated_at = now();

alter table public.employer_applications
  add constraint employer_applications_candidate_public_profile_fk
  foreign key (candidate_user_id) references public.candidate_public_profiles(user_id) on delete cascade not valid;
alter table public.employer_applications validate constraint employer_applications_candidate_public_profile_fk;

drop function if exists public.get_employer_applicant_profiles();
commit;
