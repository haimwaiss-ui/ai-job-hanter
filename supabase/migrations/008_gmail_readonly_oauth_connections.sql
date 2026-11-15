begin;
create table if not exists public.gmail_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  refresh_token_tag text not null,
  scopes text[] not null default array['https://www.googleapis.com/auth/gmail.readonly']::text[],
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.gmail_connections enable row level security;
create policy gmail_connections_select_own on public.gmail_connections for select to authenticated using (user_id = (select auth.uid()));
create policy gmail_connections_insert_own on public.gmail_connections for insert to authenticated with check (user_id = (select auth.uid()));
create policy gmail_connections_update_own on public.gmail_connections for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy gmail_connections_delete_own on public.gmail_connections for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.gmail_connections to authenticated;
commit;