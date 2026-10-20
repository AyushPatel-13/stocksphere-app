-- StockSphere · Alerts, notifications and preferences access-control test
--
-- Proves migrations/20261020000200_alerts.sql. One transaction ending in
-- ROLLBACK: nothing is saved. Success prints "ALL ALERT CHECKS PASSED".

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'al-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated', 'al-b@example.invalid');

-- Server-side rows (as postgres): one alert and one notification for user B.
insert into public.price_alerts (id, user_id, symbol, condition, threshold)
values ('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-0000000000e2', 'INFY', 'above', 2000);
insert into public.notifications (id, user_id, kind, title, link)
values ('00000000-0000-4000-8000-00000000e0b2', '00000000-0000-4000-8000-0000000000e2', 'price_alert', 'Alert: INFY', '/stock/INFY');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);

do $$
declare
  n int;
begin
  -- User A creates, pauses and deletes their own alert.
  insert into public.price_alerts (symbol, condition, threshold) values ('TCS', 'above', 2600);
  update public.price_alerts set status = 'paused' where symbol = 'TCS';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: user A could not pause their alert'; end if;

  -- ...but can't mark it triggered (policy) or write the trigger fields (grants).
  begin
    update public.price_alerts set status = 'triggered' where symbol = 'TCS';
    raise exception 'FAIL: user A marked their own alert triggered';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    update public.price_alerts set triggered_value = 1 where symbol = 'TCS';
    raise exception 'FAIL: user A wrote triggered_value';
  exception when insufficient_privilege then null;
  end;

  -- User B's alert and notification are invisible to A.
  select count(*) into n from public.price_alerts where user_id = '00000000-0000-4000-8000-0000000000e2';
  if n <> 0 then raise exception 'FAIL: user A can see user B''s alerts'; end if;
  select count(*) into n from public.notifications;
  if n <> 0 then raise exception 'FAIL: user A can see user B''s notifications'; end if;

  -- Users can't create notifications.
  begin
    insert into public.notifications (user_id, kind, title) values ('00000000-0000-4000-8000-0000000000e1', 'system', 'fake');
    raise exception 'FAIL: a user created a notification';
  exception when insufficient_privilege then null;
  end;

  -- Preferences: own row only.
  insert into public.user_preferences (news_region) values ('us');
  begin
    insert into public.user_preferences (user_id, news_region) values ('00000000-0000-4000-8000-0000000000e2', 'us');
    raise exception 'FAIL: user A wrote user B''s preferences';
  exception when insufficient_privilege then null;
  end;

  delete from public.price_alerts where symbol = 'TCS';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: user A could not delete their alert'; end if;
end $$;

reset role;
select 'ALL ALERT CHECKS PASSED' as result;

rollback;
