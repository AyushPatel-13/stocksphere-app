-- StockSphere · Saved screener screens that follow the account
--
-- Prepared for review; NOT applied. Needs nothing but auth.users.
--
-- Screener screens were kept in one browser's localStorage, so a screen saved
-- on a laptop wasn't there on a phone. This adds:
--
--   saved_screens (id, user_id, name, criteria jsonb, created_at)
--
-- A member reads, adds, renames and removes only their own screens (RLS on
-- every operation), at most 10 of them, each a small JSON object. The app
-- validates the criteria again when it loads them (normaliseCriteria), so
-- nothing stored here is trusted as-is.
--
-- Until this is applied the screener keeps saving to the browser and says so.
--
-- Rollback (loses saved screens only):
--   drop table if exists public.saved_screens;
--   drop function if exists public.saved_screens_limit();

begin;

create table if not exists public.saved_screens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null
    constraint saved_screens_name_length check (char_length(btrim(name)) between 1 and 40),
  criteria jsonb not null
    constraint saved_screens_criteria_shape check (jsonb_typeof(criteria) = 'object' and pg_column_size(criteria) <= 2000),
  created_at timestamptz not null default now()
);

-- One screen per name per member; saving under an existing name replaces it.
create unique index if not exists saved_screens_user_name_idx
  on public.saved_screens (user_id, lower(btrim(name)));

-- ---------------------------------------------------------------- 10 per member
create or replace function public.saved_screens_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from saved_screens where user_id = new.user_id) >= 10 then
    raise exception 'You can keep up to 10 saved screens. Remove one first.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.saved_screens_limit() from public, anon, authenticated;

drop trigger if exists saved_screens_limit on public.saved_screens;
create trigger saved_screens_limit
  before insert on public.saved_screens
  for each row execute function public.saved_screens_limit();

-- ---------------------------------------------------------------- access
revoke all on public.saved_screens from public, anon, authenticated;
grant select, delete on public.saved_screens to authenticated;
grant insert (name, criteria) on public.saved_screens to authenticated;
grant update (name, criteria) on public.saved_screens to authenticated;

alter table public.saved_screens enable row level security;

drop policy if exists "own saved screens: read" on public.saved_screens;
create policy "own saved screens: read"
  on public.saved_screens for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "own saved screens: add" on public.saved_screens;
create policy "own saved screens: add"
  on public.saved_screens for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "own saved screens: change" on public.saved_screens;
create policy "own saved screens: change"
  on public.saved_screens for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own saved screens: remove" on public.saved_screens;
create policy "own saved screens: remove"
  on public.saved_screens for delete
  to authenticated
  using (user_id = (select auth.uid()));

commit;
