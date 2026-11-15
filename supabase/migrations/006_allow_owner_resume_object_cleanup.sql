-- Applied to the connected Supabase project as version 20261115141530.
begin;

drop policy if exists "resume_objects_delete_own" on storage.objects;
create policy "resume_objects_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'resumes'
  and name ~ (
    '^' || (select auth.uid())::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$'
  )
);

grant delete on public.resumes to authenticated;

comment on policy "resume_objects_delete_own" on storage.objects is
  'Allows a signed-in user to delete only their own canonical private resume PDF object.';

commit;
