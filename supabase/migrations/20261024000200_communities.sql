-- StockSphere · Communities: one stable identity per company, IPO → stock
--
-- Requires 20261019000300_posts.sql.
--
-- Why
--   Until now a post belonged to a stock only through posts.symbols (the board
--   it was written on plus $CASHTAGS). An IPO has no verified ticker yet, so it
--   can't have a board that way. A community gives the company a stable id
--   from the day its IPO appears; when the issue lists and its ISIN maps to an
--   NSE/BSE instrument, the SAME row gains exchange + symbol. Posts keep their
--   community_id, so nothing is copied or rewritten.
--
-- Shape
--   communities                 public read; written only by the app server
--     type        'ipo' until linked, then 'stock' (permanent)
--     isin        the stable entity key (unique); null only while Upstox has
--                 not published one for an upcoming issue
--     upstox_ipo_id  the IPO the community was created for (unique); the
--                 /community/ipo/<id> URL resolves through it forever
--     exchange, symbol   set once, by the listing service, from an ISIN match
--   community_listing_checks    server only (no client access at all): the
--                 listing service's last result per community, for retries
--   posts.community_id          nullable; old posts keep NULL and stay on
--                 their boards through posts.symbols exactly as before
--
-- Security model
--   * anon/authenticated may SELECT communities; nobody but the service role
--     may write them. There is no user id column, so none can be supplied.
--   * community_listing_checks: RLS on, no grants, no policies.
--   * posts are still inserted only by the server, so clients can't choose a
--     post's community either. Existing posts policies are unchanged.
--   * A trigger makes a listing permanent: once type = 'stock', the type,
--     ISIN, exchange and symbol can't change, and an ISIN, once set, can't be
--     changed or cleared. That is the last guard against a wrong re-attachment.
--
-- No existing row is changed. Every step is guarded and safe to re-run.
-- Review before applying. Rollback notes at the bottom.

begin;

-- ---------------------------------------------------------------- communities

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),

  type text not null default 'ipo'
    constraint communities_type_values check (type in ('ipo', 'stock')),

  name text not null
    constraint communities_name_length check (char_length(btrim(name)) between 1 and 200),

  isin text
    constraint communities_isin_format check (isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),

  upstox_ipo_id text
    constraint communities_ipo_id_format check (upstox_ipo_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$'),

  board text
    constraint communities_board_values check (board in ('mainboard', 'sme')),

  exchange text
    constraint communities_exchange_values check (exchange in ('NSE', 'BSE')),

  symbol text
    constraint communities_symbol_format check (symbol ~ '^[A-Z0-9][A-Z0-9.&-]{0,19}$'),

  listed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An IPO community has no ticker; a stock community has a verified one,
  -- found from its ISIN.
  constraint communities_type_shape check (
    (type = 'ipo' and exchange is null and symbol is null and listed_at is null)
    or (type = 'stock' and exchange is not null and symbol is not null and isin is not null and listed_at is not null)
  ),
  -- Every community is reachable by at least one stable key.
  constraint communities_has_key check (isin is not null or upstox_ipo_id is not null)
);

create unique index if not exists communities_isin_key on public.communities (isin) where isin is not null;
create unique index if not exists communities_ipo_id_key on public.communities (upstox_ipo_id) where upstox_ipo_id is not null;
-- One community per listed instrument: a second IPO can never claim a ticker.
create unique index if not exists communities_listing_key on public.communities (exchange, symbol) where symbol is not null;
create index if not exists communities_pending_idx on public.communities (created_at) where type = 'ipo';

comment on table public.communities is
  'One community per company, keyed by ISIN. Starts as an IPO community; the listing service links it to its verified NSE/BSE symbol. Public read; written only by the app server.';

-- ---------------------------------------------------------------- permanence

create or replace function public.guard_community_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.isin is not null and new.isin is distinct from old.isin then
    raise exception 'A community''s ISIN can''t change once set' using errcode = 'check_violation';
  end if;
  if old.type = 'stock' and (
       new.type <> 'stock'
       or new.exchange is distinct from old.exchange
       or new.symbol is distinct from old.symbol
       or new.listed_at is distinct from old.listed_at
     ) then
    raise exception 'A listed community stays linked to its stock' using errcode = 'check_violation';
  end if;
  if old.upstox_ipo_id is not null and new.upstox_ipo_id is distinct from old.upstox_ipo_id then
    raise exception 'A community''s IPO id can''t change once set' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.guard_community_identity() from public, anon, authenticated;

drop trigger if exists communities_guard_identity on public.communities;
create trigger communities_guard_identity
  before update on public.communities
  for each row execute function public.guard_community_identity();

-- ---------------------------------------------------------------- listing checks

create table if not exists public.community_listing_checks (
  community_id uuid primary key references public.communities (id) on delete cascade,
  -- waiting:  not listed yet (by verified data)       → checked again later
  -- linked:   exchange + symbol attached              → never checked again
  -- failed:   Upstox unavailable / no ISIN match yet  → retried with backoff
  -- conflict: data disagrees (ISIN changed, ticker taken, several matches)
  --           → retried daily, never attached until the data agrees
  status text not null
    constraint community_listing_checks_status check (status in ('waiting', 'linked', 'failed', 'conflict')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  last_checked_at timestamptz not null default now(),
  next_check_at timestamptz not null default now()
);

create index if not exists community_listing_checks_due_idx
  on public.community_listing_checks (next_check_at) where status <> 'linked';

comment on table public.community_listing_checks is
  'Listing service results per community, for retries. Service role only.';

-- ---------------------------------------------------------------- posts

alter table public.posts add column if not exists community_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'posts_community_id_fkey' and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_community_id_fkey
      foreign key (community_id) references public.communities (id) on delete restrict;
  end if;
end $$;

create index if not exists posts_community_idx
  on public.posts (community_id, created_at desc) where community_id is not null;

comment on column public.posts.community_id is
  'The community the post was written in (IPO or linked stock). NULL for posts that belong to boards only through symbols.';

-- A reply always lives in its parent's community, whatever the writer sent.
create or replace function public.posts_inherit_community()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_id is not null then
    select p.community_id into new.community_id from posts p where p.id = new.parent_id;
  end if;
  return new;
end;
$$;

revoke all on function public.posts_inherit_community() from public, anon, authenticated;

drop trigger if exists posts_inherit_community on public.posts;
create trigger posts_inherit_community
  before insert on public.posts
  for each row execute function public.posts_inherit_community();

-- ---------------------------------------------------------------- privileges

revoke all on public.communities, public.community_listing_checks from anon, authenticated;
grant select on public.communities to anon, authenticated;

alter table public.communities enable row level security;
alter table public.community_listing_checks enable row level security;

drop policy if exists "communities are public" on public.communities;
create policy "communities are public"
  on public.communities for select
  to anon, authenticated
  using (true);

-- No policies on community_listing_checks: only the service role reads or writes it.

commit;

-- Rollback (no existing data involved; posts written into communities lose
-- their link, so run only before anyone has posted in one):
--   alter table public.posts drop constraint if exists posts_community_id_fkey;
--   drop index if exists public.posts_community_idx;
--   alter table public.posts drop column if exists community_id;
--   drop table if exists public.community_listing_checks;
--   drop table if exists public.communities;
--   drop trigger if exists posts_inherit_community on public.posts;
--   drop function if exists public.posts_inherit_community();
--   drop function if exists public.guard_community_identity();
