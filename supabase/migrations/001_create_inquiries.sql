-- LUMEN migration 001: contact inquiries + administrator allow-list, with row-level security.
-- Run once in the Supabase SQL Editor (or `supabase db push`). Safe to read in full before running.
--
-- Security model:
--   * The public website NEVER talks to the database directly. Visitors submit through the
--     Netlify Function `submit-inquiry`, which uses the service-role key (server-side only).
--   * The `anon` role (anyone with the public API key) has NO access to either table.
--   * The `authenticated` role has access only if the user is listed in `admin_users`.
--   * Nobody except the service role / SQL editor can add administrators.

-- ---------------------------------------------------------------- inquiries
create table public.inquiries (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  email         text        not null,
  project_type  text        not null,
  message       text        not null,
  status        text        not null default 'new',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint inquiries_name_length         check (char_length(btrim(name))    between 1 and 100),
  constraint inquiries_email_length        check (char_length(email)          between 3 and 254),
  constraint inquiries_email_format        check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint inquiries_project_type_valid  check (project_type in ('residential','hospitality','commercial','other')),
  constraint inquiries_message_length      check (char_length(btrim(message)) between 1 and 5000),
  constraint inquiries_status_valid        check (status in ('new','in_progress','responded','archived'))
);

comment on table public.inquiries is 'Contact-form inquiries. Personal data: name, email, free-text message. Apply the retention period from the Privacy Policy.';

-- Dashboard list (filter by status, newest first) and plain newest-first.
create index inquiries_status_created_idx on public.inquiries (status, created_at desc);
create index inquiries_created_idx        on public.inquiries (created_at desc);
-- Finding a person's records quickly for access / correction / deletion requests.
create index inquiries_email_lower_idx    on public.inquiries (lower(email));

-- Keep updated_at honest on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger inquiries_set_updated_at
  before update on public.inquiries
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------- admin_users
create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text        not null default 'admin' check (role in ('admin')),
  created_at timestamptz not null default now()
);

comment on table public.admin_users is 'Allow-list of Supabase Auth users who may manage inquiries. Rows are added only by the project owner (SQL editor / service role).';

-- Helper used by the policies. SECURITY DEFINER so it can read admin_users regardless of the caller;
-- it only answers "is the CURRENT user an admin?" and so leaks nothing about others.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------- privileges + row-level security
alter table public.inquiries   enable row level security;
alter table public.admin_users enable row level security;

-- Supabase grants new tables to anon/authenticated by default. Remove that first.
revoke all on public.inquiries   from anon, authenticated;
revoke all on public.admin_users from anon, authenticated;

-- inquiries: admins may read, and may change ONLY the status column. No insert/delete via the API:
-- inserts come from the server function (service role); deletion is a deliberate manual/retention task.
grant select          on public.inquiries to authenticated;
grant update (status) on public.inquiries to authenticated;

create policy inquiries_admin_select on public.inquiries
  for select to authenticated
  using ((select public.is_admin()));

create policy inquiries_admin_update on public.inquiries
  for update to authenticated
  using       ((select public.is_admin()))
  with check  ((select public.is_admin()));

-- admin_users: a signed-in user may see only their own membership row. There are NO insert/update/
-- delete grants or policies, so nobody can self-assign admin rights through the API.
grant select on public.admin_users to authenticated;

create policy admin_users_select_self on public.admin_users
  for select to authenticated
  using (user_id = (select auth.uid()));

-- The service role (used only inside Netlify Functions) bypasses RLS by design; every function
-- re-checks the caller's admin membership itself. See README "Security model".
