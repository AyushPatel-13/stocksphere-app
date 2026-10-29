-- StockSphere · Thesis Tracker (Five features, stage B)
--
-- theses: one member's investment thesis on one listing. Identity (symbol,
--   exchange, currency) is resolved by the server; the reference price is
--   read by the server when the thesis is published, the same way as a
--   prediction's entry price.
-- thesis_versions: the content. Append-only: an edit is a new version, and a
--   database trigger refuses any UPDATE or DELETE, so a published version can
--   never be rewritten after the outcome is known.
-- thesis_status_log: every status change, written by a trigger.
--
-- Lifecycle: draft → published → closed. While a draft, only the author can
-- see it. Publishing records published_version (the first public version)
-- and freezes the reference price; versions before it stay private.
--
-- Locks (trigger theses_lock): author, symbol, exchange and created_at never
-- change; the reference price and published_* are written once, at publish;
-- status only moves forward; a deleted thesis stays deleted (soft delete, so
-- outcomes are kept).
--
-- Access: clients can only SELECT, under RLS. Every write goes through the
-- server (service role), which checks the author's session.
--
-- No existing data changes.
--
-- Rollback (drops only what this migration added; theses are lost):
--   drop table if exists public.thesis_status_log;
--   drop table if exists public.thesis_versions;
--   drop table if exists public.theses;
--   drop function if exists public.theses_lock();
--   drop function if exists public.thesis_versions_immutable();
--   drop function if exists public.theses_log_status();

-- ---------------------------------------------------------------- 1. theses
create table if not exists public.theses (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9&.^-]{1,20}$'),
  exchange text not null check (exchange in ('NSE', 'BSE', 'US')),
  currency text check (currency in ('INR', 'USD')),
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  current_version integer not null default 1 check (current_version >= 1),
  published_version integer check (published_version >= 1),
  published_at timestamptz,
  reference_price numeric check (reference_price > 0),
  reference_source text check (reference_source in ('upstox', 'yahoo')),
  reference_mode text check (reference_mode in ('live', 'from_close')),
  reference_quote_time timestamptz,
  closed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint theses_published_fields check (
    (status = 'draft' and published_at is null and published_version is null and reference_price is null)
    or (status <> 'draft' and published_at is not null and published_version is not null and reference_price is not null
        and reference_source is not null and reference_mode is not null and reference_quote_time is not null)
  ),
  constraint theses_closed_fields check ((status = 'closed') = (closed_at is not null))
);

create index if not exists theses_symbol_idx on public.theses (symbol, published_at desc) where status <> 'draft' and deleted_at is null;
create index if not exists theses_author_idx on public.theses (author_id, created_at desc);

-- ---------------------------------------------------------------- 2. versions
create table if not exists public.thesis_versions (
  thesis_id uuid not null references public.theses (id) on delete cascade,
  version integer not null check (version >= 1),
  title text not null check (char_length(title) between 3 and 120),
  summary text not null check (char_length(summary) between 10 and 4000),
  stance text not null check (stance in ('bullish', 'bearish', 'neutral')),
  target_date date not null,
  target_price numeric check (target_price > 0),
  assumptions text not null default '' check (char_length(assumptions) <= 2000),
  catalysts text not null default '' check (char_length(catalysts) <= 2000),
  risks text not null default '' check (char_length(risks) <= 2000),
  counterarguments text not null default '' check (char_length(counterarguments) <= 2000),
  invalidation text not null default '' check (char_length(invalidation) <= 1000),
  -- [{ "label": text, "url": "https://…" }], at most 10; checked by the server.
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 10),
  created_at timestamptz not null default now(),
  primary key (thesis_id, version)
);

create or replace function public.thesis_versions_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'thesis versions are append-only';
end;
$$;

revoke all on function public.thesis_versions_immutable() from public, anon, authenticated;

drop trigger if exists thesis_versions_immutable on public.thesis_versions;
create trigger thesis_versions_immutable
  before update or delete on public.thesis_versions
  for each row execute function public.thesis_versions_immutable();

-- ---------------------------------------------------------------- 3. locks
create or replace function public.theses_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.author_id <> old.author_id or new.symbol <> old.symbol or new.exchange <> old.exchange
     or new.created_at <> old.created_at or new.currency is distinct from old.currency then
    raise exception 'a thesis''s author and listing can''t change';
  end if;
  if old.status <> 'draft' and (
       new.published_at is distinct from old.published_at
       or new.published_version is distinct from old.published_version
       or new.reference_price is distinct from old.reference_price
       or new.reference_source is distinct from old.reference_source
       or new.reference_mode is distinct from old.reference_mode
       or new.reference_quote_time is distinct from old.reference_quote_time) then
    raise exception 'a published thesis''s reference is frozen';
  end if;
  if not ((old.status = new.status)
          or (old.status = 'draft' and new.status = 'published')
          or (old.status = 'published' and new.status = 'closed')) then
    raise exception 'thesis status can only move forward';
  end if;
  if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
    raise exception 'a deleted thesis stays deleted';
  end if;
  if new.current_version < old.current_version then
    raise exception 'versions only go up';
  end if;
  return new;
end;
$$;

revoke all on function public.theses_lock() from public, anon, authenticated;

drop trigger if exists theses_lock on public.theses;
create trigger theses_lock
  before update on public.theses
  for each row execute function public.theses_lock();

-- ---------------------------------------------------------------- 4. status log
create table if not exists public.thesis_status_log (
  id bigint generated always as identity primary key,
  thesis_id uuid not null references public.theses (id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_at timestamptz not null default now()
);

create index if not exists thesis_status_log_thesis_idx on public.thesis_status_log (thesis_id, changed_at);

create or replace function public.theses_log_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into thesis_status_log (thesis_id, from_status, to_status) values (new.id, null, new.status);
  elsif new.status <> old.status then
    insert into thesis_status_log (thesis_id, from_status, to_status) values (new.id, old.status, new.status);
  end if;
  return null;
end;
$$;

revoke all on function public.theses_log_status() from public, anon, authenticated;

drop trigger if exists theses_log_status on public.theses;
create trigger theses_log_status
  after insert or update on public.theses
  for each row execute function public.theses_log_status();

-- ---------------------------------------------------------------- 5. access
revoke all on public.theses, public.thesis_versions, public.thesis_status_log from anon, authenticated;
grant select on public.theses, public.thesis_versions, public.thesis_status_log to anon, authenticated;

alter table public.theses enable row level security;
alter table public.thesis_versions enable row level security;
alter table public.thesis_status_log enable row level security;

drop policy if exists "published theses are public; drafts are the author's" on public.theses;
create policy "published theses are public; drafts are the author's"
  on public.theses for select
  using ((status <> 'draft' and deleted_at is null) or author_id = (select auth.uid()));

-- Public versions are those from publishing on; earlier drafts stay the author's.
drop policy if exists "versions follow their thesis" on public.thesis_versions;
create policy "versions follow their thesis"
  on public.thesis_versions for select
  using (exists (
    select 1 from public.theses t
    where t.id = thesis_id
      and ((t.status <> 'draft' and t.deleted_at is null and version >= t.published_version) or t.author_id = (select auth.uid()))
  ));

drop policy if exists "status log follows its thesis" on public.thesis_status_log;
create policy "status log follows its thesis"
  on public.thesis_status_log for select
  using (exists (
    select 1 from public.theses t
    where t.id = thesis_id and ((t.status <> 'draft' and t.deleted_at is null) or t.author_id = (select auth.uid()))
  ));
