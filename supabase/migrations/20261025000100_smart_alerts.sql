-- StockSphere · Smart alerts (Stage B of SMART_ALERTS_PLAN.md)
--
-- NOT APPLIED. Written for review; apply only with the owner's approval.
--
-- What it adds to public.price_alerts:
--
--   conditions   move_pct   moves X% either way from reference_price (the price
--                           when the alert was set)
--                high_52w   makes a new 52-week high      (no threshold)
--                low_52w    makes a new 52-week low       (no threshold)
--                fo_ban     enters NSE's F&O ban list      (no threshold)
--                ipo_open   the IPO opens for bidding      (asset_type 'ipo')
--                ipo_listed the IPO lists on the exchange  (asset_type 'ipo')
--   repeat_mode  'once' (today's behaviour: fires, then 'triggered') or
--                'every_session' (stays active, notifies at most once per
--                trading session, tracked by last_fired_at)
--   fired_*      what the last firing was based on: source and the exchange's
--                quote time, so a notification can always be traced to a price
--
-- and a new table public.alert_events: one row per firing (owner-read,
-- server-write), so history and de-duplication don't hang on one status column.
--
-- Members can still only create, pause, edit and delete their own alerts. The
-- server-owned columns (status → triggered, triggered_*, last_fired_at,
-- fired_*, last_checked_at) stay out of the column grants, so a member can't
-- write them. Existing rows are unchanged: every new column is nullable or
-- defaulted, and the old four conditions keep their exact threshold rules.
--
-- Rollback (drops the new conditions' alerts first, so the old checks fit):
--   delete from public.price_alerts where condition not in ('above','below','day_up','day_down') or asset_type = 'ipo';
--   drop table if exists public.alert_events;
--   alter table public.price_alerts
--     drop constraint if exists price_alerts_condition,
--     drop constraint if exists price_alerts_threshold,
--     drop constraint if exists price_alerts_asset_type,
--     drop constraint if exists price_alerts_reference,
--     drop constraint if exists price_alerts_repeat,
--     drop column if exists reference_price, drop column if exists repeat_mode,
--     drop column if exists last_fired_at, drop column if exists fired_source,
--     drop column if exists fired_quote_time;
--   then re-add the three original checks from 20261020000200_alerts.sql and
--   `alter column threshold set not null`.
--
-- Safe to re-run.

begin;

alter table public.price_alerts
  add column if not exists reference_price numeric,
  add column if not exists repeat_mode text not null default 'once',
  add column if not exists last_fired_at timestamptz,
  add column if not exists fired_source text,
  add column if not exists fired_quote_time timestamptz;

-- Event conditions (52-week, F&O ban, IPO) have no level to cross.
alter table public.price_alerts alter column threshold drop not null;

alter table public.price_alerts
  drop constraint if exists price_alerts_asset_type,
  drop constraint if exists price_alerts_condition,
  drop constraint if exists price_alerts_threshold,
  drop constraint if exists price_alerts_reference,
  drop constraint if exists price_alerts_repeat,
  drop constraint if exists price_alerts_fired_source;

alter table public.price_alerts
  add constraint price_alerts_asset_type
    check (asset_type in ('stock', 'index', 'etf', 'crypto', 'ipo')),
  add constraint price_alerts_condition
    check (
      condition in ('above', 'below', 'day_up', 'day_down', 'move_pct', 'high_52w', 'low_52w', 'fo_ban', 'ipo_open', 'ipo_listed')
      -- IPO conditions go with IPO alerts only, and IPO alerts have no others.
      and ((asset_type = 'ipo') = (condition in ('ipo_open', 'ipo_listed')))
      -- The F&O ban list is Indian stocks only.
      and (condition <> 'fo_ban' or asset_type = 'stock')
    ),
  add constraint price_alerts_threshold
    check (
      case
        when condition in ('above', 'below') then threshold is not null and threshold > 0
        when condition in ('day_up', 'day_down', 'move_pct') then threshold is not null and threshold > 0 and threshold <= 100
        else threshold is null
      end
    ),
  add constraint price_alerts_reference
    check ((condition = 'move_pct') = (reference_price is not null) and (reference_price is null or reference_price > 0)),
  add constraint price_alerts_repeat
    check (repeat_mode in ('once', 'every_session') and (repeat_mode = 'once' or condition not in ('ipo_open', 'ipo_listed'))),
  add constraint price_alerts_fired_source
    check (fired_source is null or char_length(fired_source) <= 40);

-- Members may now set the reference price and repeat mode when creating, and
-- change repeat mode later. Everything the checker writes stays server-only.
grant insert (asset_type, symbol, condition, threshold, note, reference_price, repeat_mode) on public.price_alerts to authenticated;
grant update (status, threshold, note, repeat_mode) on public.price_alerts to authenticated;

create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.price_alerts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  fired_at timestamptz not null default now(),
  -- The number the rule matched (a price, a % move) and the price behind it.
  value numeric,
  price numeric,
  currency text constraint alert_events_currency check (currency is null or currency ~ '^[A-Z]{3}$'),
  source text not null constraint alert_events_source_length check (char_length(source) between 1 and 40),
  quote_time timestamptz,
  -- One firing per alert per session key (e.g. 'IN:2026-10-26'), so two
  -- overlapping runs can't both record it.
  session_key text not null constraint alert_events_session_key_length check (char_length(session_key) between 1 and 40),
  constraint alert_events_once_per_session unique (alert_id, session_key)
);

create index if not exists alert_events_user_idx on public.alert_events (user_id, fired_at desc);

revoke all on public.alert_events from anon, authenticated;
grant select on public.alert_events to authenticated;

alter table public.alert_events enable row level security;

drop policy if exists "own alert events: read" on public.alert_events;
create policy "own alert events: read" on public.alert_events
  for select to authenticated using (user_id = (select auth.uid()));

commit;
