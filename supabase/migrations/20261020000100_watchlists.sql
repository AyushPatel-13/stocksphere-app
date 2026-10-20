-- StockSphere · Multiple named watchlists
--
-- Adds named lists on top of the existing `watchlist` table (user_id, symbol)
-- without changing or deleting any existing row:
--
--   * new table `watchlists` (id, user_id, name, position)
--   * new nullable column `watchlist.watchlist_id`
--   * every member who already has watchlist rows gets one list named
--     "My Watchlist", and their rows are pointed at it
--
-- Rows with no watchlist_id (e.g. added by an older client) show in the
-- member's first list, so nothing can disappear.
--
-- The existing RLS policies on `watchlist` are NOT changed (they are still
-- awaiting review). A trigger makes sure a row can only be attached to a list
-- owned by the same user, whatever those policies allow.
--
-- Rollback (loses only list names, never symbols):
--   drop trigger if exists watchlist_list_owner on public.watchlist;
--   drop function if exists public.watchlist_list_owner();
--   alter table public.watchlist drop column if exists watchlist_id;
--   drop table if exists public.watchlists;
--
-- Review before applying. Safe to re-run.

create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null
    constraint watchlists_name_length check (char_length(btrim(name)) between 1 and 40),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists watchlists_user_name_idx
  on public.watchlists (user_id, lower(btrim(name)));
create index if not exists watchlists_user_position_idx
  on public.watchlists (user_id, position);

alter table public.watchlist
  add column if not exists watchlist_id uuid references public.watchlists (id) on delete cascade;

create index if not exists watchlist_list_idx on public.watchlist (watchlist_id);

-- ---------------------------------------------------------------- backfill

insert into public.watchlists (user_id, name, position)
select distinct w.user_id, 'My Watchlist', 0
from public.watchlist w
where w.user_id is not null
  and exists (select 1 from auth.users u where u.id = w.user_id)
  and not exists (select 1 from public.watchlists l where l.user_id = w.user_id);

update public.watchlist w
set watchlist_id = l.id
from public.watchlists l
where w.watchlist_id is null
  and l.user_id = w.user_id
  and l.position = 0;

-- One symbol once per list — only when no existing duplicates would block it.
do $$
begin
  if not exists (
    select 1 from public.watchlist
    where watchlist_id is not null
    group by watchlist_id, symbol having count(*) > 1
  ) then
    create unique index if not exists watchlist_list_symbol_idx
      on public.watchlist (watchlist_id, symbol);
  else
    raise notice 'Duplicate symbols exist inside a list; unique index not created. Review them, then re-run.';
  end if;
end $$;

-- ---------------------------------------------------------------- ownership

create or replace function public.watchlist_list_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.watchlist_id is not null and not exists (
    select 1 from public.watchlists l where l.id = new.watchlist_id and l.user_id = new.user_id
  ) then
    raise exception 'watchlist % does not belong to this user', new.watchlist_id
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists watchlist_list_owner on public.watchlist;
create trigger watchlist_list_owner
  before insert or update of watchlist_id, user_id on public.watchlist
  for each row execute function public.watchlist_list_owner();

-- ---------------------------------------------------------------- privileges and RLS

revoke all on public.watchlists from anon;
grant select, insert, update, delete on public.watchlists to authenticated;

alter table public.watchlists enable row level security;

drop policy if exists "own watchlists: read" on public.watchlists;
create policy "own watchlists: read"
  on public.watchlists for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "own watchlists: create" on public.watchlists;
create policy "own watchlists: create"
  on public.watchlists for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "own watchlists: rename" on public.watchlists;
create policy "own watchlists: rename"
  on public.watchlists for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own watchlists: delete" on public.watchlists;
create policy "own watchlists: delete"
  on public.watchlists for delete to authenticated
  using (user_id = auth.uid());
