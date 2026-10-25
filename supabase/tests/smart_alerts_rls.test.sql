-- StockSphere · Smart alerts access-control and constraint test
--
-- Proves migrations/20261025000100_smart_alerts.sql (run after it). One
-- transaction ending in ROLLBACK: nothing is saved. Success prints
-- "ALL SMART ALERT CHECKS PASSED".

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'sa-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated', 'sa-b@example.invalid');

-- Server-side rows (as postgres): an alert and a firing for user B.
insert into public.price_alerts (id, user_id, symbol, condition, threshold)
values ('00000000-0000-4000-8000-00000000f0b1', '00000000-0000-4000-8000-0000000000f2', 'INFY', 'above', 2000);
insert into public.alert_events (alert_id, user_id, value, price, currency, source, quote_time, session_key)
values ('00000000-0000-4000-8000-00000000f0b1', '00000000-0000-4000-8000-0000000000f2', 2010, 2010, 'INR', 'Upstox', now(), 'IN:2026-10-26');

-- The same session can't be recorded twice for one alert.
do $$
begin
  insert into public.alert_events (alert_id, user_id, source, session_key)
  values ('00000000-0000-4000-8000-00000000f0b1', '00000000-0000-4000-8000-0000000000f2', 'Upstox', 'IN:2026-10-26');
  raise exception 'FAIL: one alert fired twice in a session';
exception when unique_violation then null;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);

do $$
declare
  n int;
begin
  -- New conditions user A may create.
  insert into public.price_alerts (symbol, condition, threshold, reference_price, repeat_mode) values ('TCS', 'move_pct', 5, 2600, 'every_session');
  insert into public.price_alerts (symbol, condition) values ('TCS', 'high_52w');
  insert into public.price_alerts (symbol, condition) values ('SAIL', 'fo_ban');
  insert into public.price_alerts (asset_type, symbol, condition) values ('ipo', 'CORE4', 'ipo_listed');
  -- The original four still work exactly as before.
  insert into public.price_alerts (symbol, condition, threshold) values ('TCS', 'above', 2700);

  -- Shapes the constraints refuse.
  begin
    insert into public.price_alerts (symbol, condition, threshold) values ('TCS', 'move_pct', 5);
    raise exception 'FAIL: move_pct without a reference price';
  exception when check_violation then null;
  end;
  begin
    insert into public.price_alerts (symbol, condition, threshold) values ('TCS', 'high_52w', 10);
    raise exception 'FAIL: an event condition took a threshold';
  exception when check_violation then null;
  end;
  begin
    insert into public.price_alerts (symbol, condition) values ('TCS', 'above');
    raise exception 'FAIL: a price alert without a level';
  exception when check_violation then null;
  end;
  begin
    insert into public.price_alerts (asset_type, symbol, condition) values ('crypto', 'BTC', 'fo_ban');
    raise exception 'FAIL: an F&O ban alert on a coin';
  exception when check_violation then null;
  end;
  begin
    insert into public.price_alerts (asset_type, symbol, condition, threshold) values ('ipo', 'CORE4', 'above', 100);
    raise exception 'FAIL: a price condition on an IPO alert';
  exception when check_violation then null;
  end;
  begin
    insert into public.price_alerts (asset_type, symbol, condition, repeat_mode) values ('ipo', 'CORE4', 'ipo_open', 'every_session');
    raise exception 'FAIL: a repeating IPO alert';
  exception when check_violation then null;
  end;

  -- Members can change repeat mode, but not what the checker records.
  update public.price_alerts set repeat_mode = 'once' where condition = 'move_pct';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: user A could not change repeat mode'; end if;
  begin
    update public.price_alerts set last_fired_at = now() where condition = 'move_pct';
    raise exception 'FAIL: user A wrote last_fired_at';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.price_alerts set fired_source = 'me' where condition = 'move_pct';
    raise exception 'FAIL: user A wrote fired_source';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.price_alerts set reference_price = 1 where condition = 'move_pct';
    raise exception 'FAIL: user A moved the reference price after creating the alert';
  exception when insufficient_privilege then null;
  end;

  -- Alert events: read-only, and only their own.
  select count(*) into n from public.alert_events;
  if n <> 0 then raise exception 'FAIL: user A can see user B''s alert events'; end if;
  begin
    insert into public.alert_events (alert_id, user_id, source, session_key)
    values ('00000000-0000-4000-8000-00000000f0b1', '00000000-0000-4000-8000-0000000000f1', 'fake', 'IN:x');
    raise exception 'FAIL: a user recorded an alert event';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- Anonymous visitors see nothing.
set local role anon;
do $$
begin
  perform 1 from public.alert_events;
  raise exception 'FAIL: anon can read alert events';
exception when insufficient_privilege then null;
end $$;

reset role;
select 'ALL SMART ALERT CHECKS PASSED' as result;

rollback;
