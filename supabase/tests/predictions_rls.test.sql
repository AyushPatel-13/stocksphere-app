-- StockSphere · Predictions access-control and integrity test
--
-- Proves migrations/20261019000400_predictions.sql. Run in the SQL Editor
-- after the profiles and predictions migrations. One transaction ending in
-- ROLLBACK: nothing is saved. Success prints "ALL PREDICTION RLS CHECKS PASSED".

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'pred-test@example.invalid');
insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000c1', 'pred_test_c', 'Test C');

-- Server-created prediction (simulated as postgres).
insert into public.predictions (
  id, user_id, client_request_id, symbol, asset_type, direction, horizon,
  reference_price, reference_source, reference_mode, reference_quote_time,
  band_pct, expiry_sessions, estimated_expiry_at, scoring_version
) values (
  '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000c1',
  '00000000-0000-4000-8000-00000000a001', 'TCS', 'stock', 'up', '1w',
  2450, 'upstox', 'live', now(), 1.2, 5, now() + interval '7 days', 'scoring-v2-2026-10'
);

-- Integrity checks, as the server (constraints and the lock bind it too).
do $$
declare
  base_user constant uuid := '00000000-0000-4000-8000-0000000000c1';
begin
  -- A target on the wrong side of the reference price is refused.
  begin
    insert into public.predictions (user_id, client_request_id, symbol, direction, horizon, asset_type, target_price,
      reference_price, reference_source, reference_mode, reference_quote_time, band_pct, expiry_sessions, estimated_expiry_at, scoring_version)
    values (base_user, gen_random_uuid(), 'TCS', 'up', '1d', 'stock', 2400,
      2450, 'upstox', 'live', now(), 0.5, 1, now() + interval '1 day', 'v');
    raise exception 'FAIL: an "up" prediction accepted a target below the reference price';
  exception when check_violation then null;
  end;

  -- SIDEWAYS calls take no target.
  begin
    insert into public.predictions (user_id, client_request_id, symbol, direction, horizon, asset_type, target_price,
      reference_price, reference_source, reference_mode, reference_quote_time, band_pct, expiry_sessions, estimated_expiry_at, scoring_version)
    values (base_user, gen_random_uuid(), 'INFY', 'sideways', '1d', 'stock', 1500,
      1450, 'upstox', 'live', now(), 0.5, 1, now() + interval '1 day', 'v');
    raise exception 'FAIL: a SIDEWAYS prediction accepted a target';
  exception when check_violation then null;
  end;

  -- The same submission id can't create a second prediction.
  begin
    insert into public.predictions (user_id, client_request_id, symbol, direction, horizon, asset_type,
      reference_price, reference_source, reference_mode, reference_quote_time, band_pct, expiry_sessions, estimated_expiry_at, scoring_version)
    values (base_user, '00000000-0000-4000-8000-00000000a001', 'INFY', 'down', '1d', 'stock',
      1450, 'upstox', 'live', now(), 0.5, 1, now() + interval '1 day', 'v');
    raise exception 'FAIL: a duplicate client_request_id was accepted';
  exception when unique_violation then null;
  end;

  -- Crypto expires at a time, not after sessions.
  begin
    insert into public.predictions (user_id, client_request_id, symbol, direction, horizon, asset_type,
      reference_price, reference_source, reference_mode, reference_quote_time, band_pct, expiry_sessions, estimated_expiry_at, scoring_version)
    values (base_user, gen_random_uuid(), 'BTC', 'up', '1d', 'crypto',
      5000000, 'yahoo', 'live', now(), 1, 1, now() + interval '1 day', 'v');
    raise exception 'FAIL: a crypto prediction was saved with session-based expiry';
  exception when check_violation then null;
  end;

  -- A reference quote from the future is refused.
  begin
    insert into public.predictions (user_id, client_request_id, symbol, direction, horizon, asset_type,
      reference_price, reference_source, reference_mode, reference_quote_time, band_pct, expiry_sessions, estimated_expiry_at, scoring_version)
    values (base_user, gen_random_uuid(), 'INFY', 'up', '1d', 'stock',
      1450, 'upstox', 'live', now() + interval '10 minutes', 0.5, 1, now() + interval '1 day', 'v');
    raise exception 'FAIL: a reference quote time in the future was accepted';
  exception when check_violation then null;
  end;

  -- Locked after insert: even the server can't rewrite the call.
  begin
    update public.predictions set reference_price = 2000 where id = '00000000-0000-4000-8000-00000000c001';
    raise exception 'FAIL: the reference price of a saved prediction was changed';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  begin
    update public.predictions set target_price = 2600 where id = '00000000-0000-4000-8000-00000000c001';
    raise exception 'FAIL: the target of a saved prediction was changed';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- One status move out of 'open' is allowed; a second is not.
  update public.predictions set status = 'correct' where id = '00000000-0000-4000-8000-00000000c001';

  begin
    update public.predictions set status = 'incorrect' where id = '00000000-0000-4000-8000-00000000c001';
    raise exception 'FAIL: a resolved prediction changed status again';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

do $$
declare
  changed int;
begin
  begin
    insert into public.predictions (user_id, client_request_id, symbol, direction, horizon, asset_type,
      reference_price, reference_source, reference_mode, reference_quote_time, band_pct, expiry_sessions, estimated_expiry_at, scoring_version)
    values ('00000000-0000-4000-8000-0000000000c1', gen_random_uuid(), 'INFY', 'up', '1d', 'stock',
      1, 'upstox', 'live', now(), 0.5, 1, now(), 'v');
    raise exception 'FAIL: a user inserted a prediction directly';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.predictions set status = 'correct'
    where id = '00000000-0000-4000-8000-00000000c001';
    raise exception 'FAIL: a user changed their own prediction''s status';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.predictions where id = '00000000-0000-4000-8000-00000000c001';
    raise exception 'FAIL: a user deleted a prediction';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set pred_points = 9999
    where id = '00000000-0000-4000-8000-0000000000c1';
    raise exception 'FAIL: a user raised their own reputation points';
  exception when insufficient_privilege then null;
  end;

  -- Still able to edit their own public profile fields.
  update public.profiles set bio = 'value investor'
  where id = '00000000-0000-4000-8000-0000000000c1';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL: a user could not edit their own bio'; end if;

  if not exists (select 1 from public.predictions where id = '00000000-0000-4000-8000-00000000c001') then
    raise exception 'FAIL: predictions are not publicly readable';
  end if;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  if not exists (select 1 from public.predictions where symbol = 'TCS') then
    raise exception 'FAIL: anonymous visitors cannot read predictions';
  end if;
end $$;

reset role;
select 'ALL PREDICTION RLS CHECKS PASSED' as result;

rollback;
