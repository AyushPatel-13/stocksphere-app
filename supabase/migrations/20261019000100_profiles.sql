-- StockSphere · Phase 1 · Profiles and unique @handles
--
-- One row per signed-in user, holding the public identity the community sees:
-- a unique lowercase @handle, a display name, an avatar and a short bio.
--
-- Security model
--   * Anyone (signed in or not) may READ profiles: they are public by design,
--     like StockTwits profiles. No private data lives in this table — email
--     stays in auth.users and is never copied here.
--   * A user may INSERT exactly one row, for themselves, and may UPDATE only
--     their own row.
--   * `role` and `created_at` are NOT writable by users at all (column-level
--     grants below), so nobody can make themselves a moderator. Roles are
--     changed only from the SQL Editor / service role.
--   * No DELETE for users; deleting the auth user cascades the profile.
--
-- Review before applying. Apply in the Supabase SQL Editor (or `supabase db
-- push` once the CLI is set up). It is safe to re-run: every object is created
-- with IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS.

create table if not exists public.profiles (
  id uuid primary key default auth.uid()
    references auth.users (id) on delete cascade,

  -- 3–20 characters, lowercase letters, digits and underscore, starting with a
  -- letter. Stored lowercase so "@Ayush" and "@ayush" can never both exist.
  username text not null unique
    constraint profiles_username_format
      check (username ~ '^[a-z][a-z0-9_]{2,19}$'),

  display_name text not null
    constraint profiles_display_name_length
      check (char_length(btrim(display_name)) between 1 and 50),

  avatar_url text
    constraint profiles_avatar_url_https
      check (avatar_url is null or avatar_url ~ '^https://'),

  bio text not null default ''
    constraint profiles_bio_length check (char_length(bio) <= 160),

  role text not null default 'user'
    constraint profiles_role_values check (role in ('user', 'moderator', 'admin')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Public community identity: one row per auth user. Readable by everyone; writable only by its owner (role excluded).';

-- Handles that would let someone impersonate the platform, an exchange or a
-- regulator. Checked in the database so the rule cannot be bypassed from a
-- client; the app checks the same list first for a friendlier message.
create or replace function public.is_reserved_username(name text)
returns boolean
language sql
immutable
as $$
  select lower(name) = any (array[
    'admin', 'administrator', 'root', 'system', 'support', 'help', 'official',
    'moderator', 'mod', 'staff', 'team', 'security', 'stocksphere',
    'stocksphere_official', 'api', 'login', 'logout', 'signup', 'settings',
    'explore', 'portfolio', 'watchlist', 'community', 'onboarding', 'profile',
    'sebi', 'nse', 'bse', 'nseindia', 'bseindia', 'rbi', 'nsdl', 'cdsl',
    'upstox', 'zerodha', 'groww', 'angelone', 'stocktwits'
  ]);
$$;

alter table public.profiles
  drop constraint if exists profiles_username_not_reserved;
alter table public.profiles
  add constraint profiles_username_not_reserved
    check (not public.is_reserved_username(username));

-- Keep updated_at honest without trusting the client.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing, then grant only what each role needs.
-- ---------------------------------------------------------------------------

revoke all on public.profiles from anon, authenticated;

grant select on public.profiles to anon, authenticated;

-- Users may write these columns only. `id` is included for INSERT so the
-- policy below can check it; `role`, `created_at` and `updated_at` are not.
grant insert (id, username, display_name, avatar_url, bio)
  on public.profiles to authenticated;
grant update (username, display_name, avatar_url, bio)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public"
  on public.profiles for select
  to anon, authenticated
  using (true);

drop policy if exists "users create their own profile" on public.profiles;
create policy "users create their own profile"
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No delete policy: users cannot delete profiles; removing the auth user
-- cascades.
