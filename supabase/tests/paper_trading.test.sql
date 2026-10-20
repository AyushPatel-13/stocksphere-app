-- StockSphere · Paper trading integrity and access-control test
--
-- Proves migrations/20261020000300_paper_trading.sql. One transaction ending
-- in ROLLBACK: nothing is saved. Success prints "ALL PAPER TRADING CHECKS PASSED".

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'pt-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated', 'pt-b@example.invalid');

do $$
declare
  r record;
  user_a constant uuid := '00000000-0000-4000-8000-0000000000f1';
begin
  -- Buy 10 TCS at 100: fills, cash drops by 1,000.
  select * into r from public.paper_place_trade(user_a, '00000000-0000-4000-8000-0000000f0001', 'stock', 'TCS', 'buy', 10, 100, 'INR', 'upstox', now());
  if r.outcome <> 'filled' or r.cash_after <> 999000 then raise exception 'FAIL: buy outcome % cash %', r.outcome, r.cash_after; end if;

  -- The same request again: replayed, no second trade.
  select * into r from public.paper_place_trade(user_a, '00000000-0000-4000-8000-0000000f0001', 'stock', 'TCS', 'buy', 10, 100, 'INR', 'upstox', now());
  if r.outcome <> 'replayed' then raise exception 'FAIL: retry was not replayed'; end if;
  if (select count(*) from public.paper_trades where user_id = user_a) <> 1 then raise exception 'FAIL: retry created a second trade'; end if;

  -- Selling more than held is refused.
  select * into r from public.paper_place_trade(user_a, '00000000-0000-4000-8000-0000000f0002', 'stock', 'TCS', 'sell', 11, 100, 'INR', 'upstox', now());
  if r.outcome <> 'insufficient_holding' then raise exception 'FAIL: oversell was not refused'; end if;

  -- Spending more than the cash is refused.
  select * into r from public.paper_place_trade(user_a, '00000000-0000-4000-8000-0000000f0003', 'stock', 'INFY', 'buy', 1, 2000000, 'INR', 'upstox', now());
  if r.outcome <> 'insufficient_cash' then raise exception 'FAIL: overspend was not refused'; end if;

  -- The ledger is immutable, even for the server.
  begin
    update public.paper_trades set price = 1 where user_id = user_a;
    raise exception 'FAIL: a paper trade was edited';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);

do $$
begin
  -- User B can't see A's account or trades, can't trade directly, can't call the fill function.
  if exists (select 1 from public.paper_trades) then raise exception 'FAIL: user B sees user A''s trades'; end if;
  if exists (select 1 from public.paper_accounts) then raise exception 'FAIL: user B sees user A''s account'; end if;

  begin
    insert into public.paper_trades (user_id, client_request_id, asset_type, symbol, side, quantity, price, currency, price_source, price_time)
    values ('00000000-0000-4000-8000-0000000000f2', gen_random_uuid(), 'stock', 'TCS', 'buy', 1, 1, 'INR', 'x', now());
    raise exception 'FAIL: a user inserted a trade directly';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.paper_place_trade('00000000-0000-4000-8000-0000000000f2', gen_random_uuid(), 'stock', 'TCS', 'buy', 1, 0.01, 'INR', 'x', now());
    raise exception 'FAIL: a user called paper_place_trade with their own price';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'ALL PAPER TRADING CHECKS PASSED' as result;

rollback;
