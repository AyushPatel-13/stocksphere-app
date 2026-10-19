-- StockSphere · Predictions access-control test
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
insert into public.predictions (id, user_id, symbol, direction, horizon, entry_price, resolves_at)
values ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000c1',
        'TCS', 'up', '1w', 2450, now() + interval '7 days');

-- A target on the wrong side of the entry price is refused.
do $$
begin
  begin
    insert into public.predictions (user_id, symbol, direction, horizon, entry_price, target_price, resolves_at)
    values ('00000000-0000-4000-8000-0000000000c1', 'TCS', 'up', '1d', 2450, 2400, now() + interval '1 day');
    raise exception 'FAIL: an "up" prediction accepted a target below entry';
  exception when check_violation then null;
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
    insert into public.predictions (user_id, symbol, direction, horizon, entry_price, resolves_at)
    values ('00000000-0000-4000-8000-0000000000c1', 'INFY', 'up', '1d', 1, now());
    raise exception 'FAIL: a user inserted a prediction directly';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.predictions set status = 'won', points = 100
    where id = '00000000-0000-4000-8000-00000000c001';
    raise exception 'FAIL: a user marked their own prediction as won';
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
