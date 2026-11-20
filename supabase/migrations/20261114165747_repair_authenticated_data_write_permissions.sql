
-- Restore least-privilege access for the application Data API.
revoke all privileges on all tables in schema public from anon;
grant usage on schema public to authenticated;

grant select, insert, update, delete on table
  public.profiles,
  public.resumes,
  public.jobs,
  public.applications,
  public.user_preferences,
  public.user_activity_events,
  public.user_insights
to authenticated;

grant select, insert on table public.execution_logs to authenticated;

-- Every exposed application table must remain protected by RLS.
alter table public.profiles enable row level security;
alter table public.resumes enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.execution_logs enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_activity_events enable row level security;
alter table public.user_insights enable row level security;

-- Profile upsert requires INSERT as well as UPDATE.
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
