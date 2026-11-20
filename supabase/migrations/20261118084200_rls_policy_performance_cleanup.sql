-- Remove redundant RLS work and cache JWT lookup once per statement.
begin;

-- applications_update_worker is a strict subset of applications_update_own:
-- both are scoped to auth.uid(), while the latter already permits the same row
-- updates. Removing the duplicate does not widen or narrow effective access.
drop policy if exists applications_update_worker on public.applications;

drop policy if exists execution_logs_insert_worker on public.execution_logs;
create policy execution_logs_insert_worker
  on public.execution_logs
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce(((select auth.jwt()) ->> 'worker')::boolean, false)
  );

commit;
