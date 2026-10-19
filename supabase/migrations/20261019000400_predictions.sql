-- StockSphere · Phase 2b · Price predictions, scoring and reputation
--
-- Requires 20261019000100_profiles.sql.
--
-- Fairness rules, enforced here rather than trusted to the app:
--   * Predictions are written ONLY by the app server (service role), which
--     records the entry price itself from live data. Users cannot insert,
--     edit or delete predictions — a losing call cannot be hidden.
--   * Resolution (exit price, outcome, points) is also server-only.
--   * Everyone can read every prediction: a track record is public.
--   * The reputation counters on profiles (pred_*) are maintained by the
--     server and are not writable by users (the column grants from the
--     profiles migration only allow username/display_name/avatar_url/bio).
--
-- Review before applying. Safe to re-run.

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,

  asset_type text not null default 'stock'
    constraint predictions_asset_type check (asset_type in ('stock', 'index', 'etf', 'crypto')),
  symbol text not null
    constraint predictions_symbol_format check (symbol ~ '^[A-Z0-9][A-Z0-9.&-]{0,19}$'),

  direction text not null
    constraint predictions_direction check (direction in ('up', 'down')),
  horizon text not null
    constraint predictions_horizon check (horizon in ('1d', '1w', '1m')),

  -- Optional price target; must sit on the predicted side of the entry price.
  target_price numeric check (target_price is null or target_price > 0),

  entry_price numeric not null check (entry_price > 0),
  currency text,

  created_at timestamptz not null default now(),
  resolves_at timestamptz not null,

  status text not null default 'open'
    constraint predictions_status check (status in ('open', 'won', 'lost', 'void')),
  exit_price numeric check (exit_price is null or exit_price > 0),
  resolved_at timestamptz,
  points integer not null default 0 check (points >= 0),

  note text constraint predictions_note_length check (note is null or char_length(note) <= 280),

  constraint predictions_target_side check (
    target_price is null
    or (direction = 'up' and target_price > entry_price)
    or (direction = 'down' and target_price < entry_price)
  ),
  constraint predictions_resolved_consistent check (
    (status = 'open' and exit_price is null and resolved_at is null)
    or (status <> 'open' and resolved_at is not null)
  )
);

create index if not exists predictions_user_idx on public.predictions (user_id, created_at desc);
create index if not exists predictions_due_idx on public.predictions (resolves_at) where status = 'open';
create index if not exists predictions_symbol_idx on public.predictions (symbol, created_at desc);

comment on table public.predictions is
  'Members'' price predictions. Public read; written and resolved only by the app server; never editable or deletable by users.';

-- Reputation counters shown next to members'' names (badges are derived from
-- these in the app). Server-maintained.
alter table public.profiles
  add column if not exists pred_resolved integer not null default 0,
  add column if not exists pred_wins integer not null default 0,
  add column if not exists pred_points integer not null default 0;

-- ---------------------------------------------------------------- privileges

revoke all on public.predictions from anon, authenticated;
grant select on public.predictions to anon, authenticated;

-- Profiles: re-assert that users may only write their own public fields.
-- (pred_* columns are deliberately not in this list.)
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_url, bio) on public.profiles to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.predictions enable row level security;

drop policy if exists "predictions are public" on public.predictions;
create policy "predictions are public"
  on public.predictions for select
  to anon, authenticated
  using (true);

-- No insert / update / delete policies: only the service role writes.
