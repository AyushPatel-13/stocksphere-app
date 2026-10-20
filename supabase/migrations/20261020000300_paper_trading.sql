-- StockSphere · Paper trading (virtual money only)
--
-- Every member gets a virtual account (₹10,00,000 and $10,000 to start).
-- Orders are filled by the app server at the price IT reads from market data
-- during market hours — the browser never supplies a price — through one
-- database function that locks the account, checks cash or holdings, records
-- the trade and moves the cash in a single transaction.
--
--   paper_accounts  virtual cash per member (server-maintained)
--   paper_trades    the immutable trade ledger; positions and P&L are derived
--                   from it, so they can always be re-checked
--
-- No real money, orders or brokers are involved anywhere.
--
-- Review before applying. Safe to re-run.

create table if not exists public.paper_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  cash_inr numeric not null default 1000000 check (cash_inr >= 0),
  cash_usd numeric not null default 10000 check (cash_usd >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.paper_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_request_id uuid not null,
  asset_type text not null
    constraint paper_trades_asset_type check (asset_type in ('stock', 'etf', 'crypto')),
  symbol text not null
    constraint paper_trades_symbol_format check (symbol ~ '^[A-Z0-9][A-Z0-9.&-]{0,19}$'),
  side text not null constraint paper_trades_side check (side in ('buy', 'sell')),
  quantity numeric not null check (quantity > 0),
  price numeric not null check (price > 0),
  currency text not null constraint paper_trades_currency check (currency in ('INR', 'USD')),
  price_source text not null,
  price_time timestamptz not null,
  executed_at timestamptz not null default now(),
  constraint paper_trades_request_unique unique (user_id, client_request_id)
);

create index if not exists paper_trades_user_idx on public.paper_trades (user_id, executed_at desc);

-- The ledger is append-only, for every role.
create or replace function public.paper_trades_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'paper trades are immutable';
end;
$$;

drop trigger if exists paper_trades_immutable on public.paper_trades;
create trigger paper_trades_immutable
  before update or delete on public.paper_trades
  for each row execute function public.paper_trades_immutable();

-- ---------------------------------------------------------------- order execution

create or replace function public.paper_place_trade(
  p_user uuid,
  p_request uuid,
  p_asset_type text,
  p_symbol text,
  p_side text,
  p_quantity numeric,
  p_price numeric,
  p_currency text,
  p_price_source text,
  p_price_time timestamptz
)
returns table (trade_id uuid, outcome text, cash_after numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash numeric;
  v_held numeric;
  v_cost numeric := round(p_quantity * p_price, 4);
  v_existing uuid;
  v_trade uuid;
begin
  if p_currency not in ('INR', 'USD') then raise exception 'bad currency'; end if;

  insert into paper_accounts (user_id) values (p_user) on conflict (user_id) do nothing;

  -- One order at a time per account.
  if p_currency = 'INR' then
    select cash_inr into v_cash from paper_accounts where user_id = p_user for update;
  else
    select cash_usd into v_cash from paper_accounts where user_id = p_user for update;
  end if;

  -- A retried submit returns the trade it already made.
  select id into v_existing from paper_trades where user_id = p_user and client_request_id = p_request;
  if v_existing is not null then
    return query select v_existing, 'replayed'::text, v_cash;
    return;
  end if;

  if p_side = 'buy' then
    if v_cost > v_cash then
      return query select null::uuid, 'insufficient_cash'::text, v_cash;
      return;
    end if;
    v_cash := v_cash - v_cost;
  else
    select coalesce(sum(case when side = 'buy' then quantity else -quantity end), 0) into v_held
    from paper_trades
    where user_id = p_user and asset_type = p_asset_type and symbol = p_symbol;
    if p_quantity > v_held then
      return query select null::uuid, 'insufficient_holding'::text, v_cash;
      return;
    end if;
    v_cash := v_cash + v_cost;
  end if;

  insert into paper_trades (user_id, client_request_id, asset_type, symbol, side, quantity, price, currency, price_source, price_time)
  values (p_user, p_request, p_asset_type, p_symbol, p_side, p_quantity, p_price, p_currency, p_price_source, p_price_time)
  returning id into v_trade;

  if p_currency = 'INR' then
    update paper_accounts set cash_inr = v_cash where user_id = p_user;
  else
    update paper_accounts set cash_usd = v_cash where user_id = p_user;
  end if;

  return query select v_trade, 'filled'::text, v_cash;
end;
$$;

revoke all on function public.paper_place_trade(uuid, uuid, text, text, text, numeric, numeric, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.paper_place_trade(uuid, uuid, text, text, text, numeric, numeric, text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------- privileges and RLS

revoke all on public.paper_accounts from anon, authenticated;
grant select on public.paper_accounts to authenticated;
revoke all on public.paper_trades from anon, authenticated;
grant select on public.paper_trades to authenticated;

alter table public.paper_accounts enable row level security;
drop policy if exists "own paper account" on public.paper_accounts;
create policy "own paper account" on public.paper_accounts
  for select to authenticated using (user_id = auth.uid());

alter table public.paper_trades enable row level security;
drop policy if exists "own paper trades" on public.paper_trades;
create policy "own paper trades" on public.paper_trades
  for select to authenticated using (user_id = auth.uid());

-- No insert/update/delete policies: only paper_place_trade (server) writes.
