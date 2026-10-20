-- StockSphere · Price alerts, in-app notifications and user preferences
--
-- Requires 20261019000100_profiles.sql (for nothing but convention; the
-- tables reference auth.users directly).
--
--   price_alerts       a member's own alert rules. Members create, pause and
--                      delete their own; only the app server (service role)
--                      marks one triggered and records the price that did it.
--   notifications      in-app messages. Only the server creates them; a
--                      member can read theirs and mark them read.
--   user_preferences   per-member settings, read and written by the member.
--
-- Review before applying. Safe to re-run.

-- ---------------------------------------------------------------- price alerts

create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  asset_type text not null default 'stock'
    constraint price_alerts_asset_type check (asset_type in ('stock', 'index', 'etf', 'crypto')),
  symbol text not null
    constraint price_alerts_symbol_format check (symbol ~ '^[A-Z0-9][A-Z0-9.&-]{0,19}$'),
  -- above / below: the price crosses `threshold`.
  -- day_up / day_down: the day's move reaches `threshold` percent.
  condition text not null
    constraint price_alerts_condition check (condition in ('above', 'below', 'day_up', 'day_down')),
  threshold numeric not null
    constraint price_alerts_threshold check (threshold > 0 and (condition in ('above', 'below') or threshold <= 100)),
  note text constraint price_alerts_note_length check (note is null or char_length(note) <= 140),
  status text not null default 'active'
    constraint price_alerts_status check (status in ('active', 'paused', 'triggered')),
  created_at timestamptz not null default now(),
  triggered_at timestamptz,
  triggered_value numeric,
  last_checked_at timestamptz
);

create index if not exists price_alerts_user_idx on public.price_alerts (user_id, created_at desc);
create index if not exists price_alerts_active_idx on public.price_alerts (symbol) where status = 'active';

-- ---------------------------------------------------------------- notifications

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null
    constraint notifications_kind check (kind in ('price_alert', 'prediction', 'community', 'system')),
  title text not null constraint notifications_title_length check (char_length(title) between 1 and 140),
  body text constraint notifications_body_length check (body is null or char_length(body) <= 500),
  link text constraint notifications_link_local check (link is null or link ~ '^/[A-Za-z0-9/_.%&=?-]*$'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------- preferences

create table if not exists public.user_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  news_region text not null default 'india'
    constraint user_preferences_news_region check (news_region in ('india', 'us')),
  crypto_currency text not null default 'INR'
    constraint user_preferences_crypto_currency check (crypto_currency in ('INR', 'USD')),
  alert_notifications boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- privileges

revoke all on public.price_alerts from anon, authenticated;
grant select, delete on public.price_alerts to authenticated;
grant insert (asset_type, symbol, condition, threshold, note) on public.price_alerts to authenticated;
-- Members can pause/resume (status) and edit the rule; never the trigger fields.
grant update (status, threshold, note) on public.price_alerts to authenticated;

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

revoke all on public.user_preferences from anon, authenticated;
grant select, insert, update on public.user_preferences to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.price_alerts enable row level security;

drop policy if exists "own alerts: read" on public.price_alerts;
create policy "own alerts: read" on public.price_alerts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "own alerts: create" on public.price_alerts;
create policy "own alerts: create" on public.price_alerts
  for insert to authenticated with check (user_id = auth.uid() and status = 'active');

-- A member may pause or resume, not mark their own alert triggered.
drop policy if exists "own alerts: edit" on public.price_alerts;
create policy "own alerts: edit" on public.price_alerts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and status in ('active', 'paused'));

drop policy if exists "own alerts: delete" on public.price_alerts;
create policy "own alerts: delete" on public.price_alerts
  for delete to authenticated using (user_id = auth.uid());

alter table public.notifications enable row level security;

drop policy if exists "own notifications: read" on public.notifications;
create policy "own notifications: read" on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "own notifications: mark read" on public.notifications;
create policy "own notifications: mark read" on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.user_preferences enable row level security;

drop policy if exists "own preferences: read" on public.user_preferences;
create policy "own preferences: read" on public.user_preferences
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "own preferences: create" on public.user_preferences;
create policy "own preferences: create" on public.user_preferences
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "own preferences: update" on public.user_preferences;
create policy "own preferences: update" on public.user_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
