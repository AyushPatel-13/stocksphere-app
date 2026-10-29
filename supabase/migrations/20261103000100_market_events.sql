-- StockSphere · Market events (Five features, stage A2)
--
-- market_events: announcements read from public exchange feeds, each linked
-- to the exact listing it is about, or stored as unmapped with the reason.
--   source   'nse_corporate_actions' | 'nse_board_meetings'
--   kind     dividend, buyback, split, bonus, rights, other (corporate
--            actions); results, board_meeting (board meetings)
--   symbol / isin   set only when mapping_status = 'mapped' (exact match
--            against NSE's equity list, lib/markets/nseEvents.ts)
--   raw_hash sha-256 of the source item; re-ingesting the same item is a
--            no-op (unique), so polling never creates duplicates.
--
-- Access: anyone can read; only the server (service role) writes. Clients get
-- SELECT and nothing else.
--
-- No existing data changes.
--
-- Rollback (drops only what this migration added; ingested events are lost):
--   drop table if exists public.market_events;

create table if not exists public.market_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('nse_corporate_actions', 'nse_board_meetings')),
  kind text not null check (kind in ('dividend', 'buyback', 'split', 'bonus', 'rights', 'other', 'results', 'board_meeting')),
  company_name text not null check (char_length(company_name) between 1 and 200),
  mapping_status text not null check (mapping_status in ('mapped', 'unmapped')),
  unmapped_reason text check (unmapped_reason in ('not_listed', 'ambiguous', 'conflict')),
  symbol text check (symbol ~ '^[A-Z0-9&.-]{1,20}$'),
  isin text check (isin ~ '^IN[A-Z0-9]{9}[0-9]$'),
  exchange text not null default 'NSE' check (exchange in ('NSE')),
  purpose text not null default '' check (char_length(purpose) <= 500),
  event_date date,
  record_date date,
  published_at timestamptz,
  source_url text not null check (source_url ~ '^https://[a-z0-9.-]+\.nseindia\.com/'),
  fetched_at timestamptz not null default now(),
  raw_hash text not null unique check (raw_hash ~ '^[0-9a-f]{64}$'),
  constraint market_events_mapping check (
    (mapping_status = 'mapped' and symbol is not null and isin is not null and unmapped_reason is null)
    or (mapping_status = 'unmapped' and symbol is null and isin is null and unmapped_reason is not null)
  )
);

-- A stock's events by date, and the calendar by date.
create index if not exists market_events_symbol_date_idx on public.market_events (symbol, event_date) where symbol is not null;
create index if not exists market_events_date_idx on public.market_events (event_date);

revoke all on public.market_events from anon, authenticated;
grant select on public.market_events to anon, authenticated;

alter table public.market_events enable row level security;

drop policy if exists "market events are public" on public.market_events;
create policy "market events are public"
  on public.market_events for select
  using (true);
