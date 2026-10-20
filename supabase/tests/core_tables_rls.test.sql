-- StockSphere · Watchlist / portfolio / activity access test
--
-- Proves migrations/20261020000600_harden_core_tables.sql. One transaction
-- ending in ROLLBACK: nothing is saved. Success prints "ALL CORE TABLE CHECKS PASSED".

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000c7', 'authenticated', 'authenticated', 'core-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000c8', 'authenticated', 'authenticated', 'core-b@example.invalid');

-- User B's private rows (as postgres).
insert into public.watchlist (user_id, symbol) values ('00000000-0000-4000-8000-0000000000c8', 'INFY');
insert into public.portfolio (user_id, symbol, quantity, buy_price) values ('00000000-0000-4000-8000-0000000000c8', 'INFY', 5, 1100);
insert into public.activity (user_id, action) values ('00000000-0000-4000-8000-0000000000c8', 'test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c7","role":"authenticated"}', true);

do $$
declare
  n int;
begin
  -- A's own rows: user_id comes from the session by default.
  insert into public.watchlist (symbol) values ('TCS');
  insert into public.portfolio (symbol, quantity, buy_price) values ('TCS', 2, 2400);
  if (select user_id from public.watchlist where symbol = 'TCS') <> '00000000-0000-4000-8000-0000000000c7' then
    raise exception 'FAIL: watchlist user_id did not default to the signed-in user';
  end if;

  -- A can't see, change or delete B's rows.
  select count(*) into n from public.watchlist where user_id = '00000000-0000-4000-8000-0000000000c8';
  if n <> 0 then raise exception 'FAIL: user A sees user B''s watchlist'; end if;
  select count(*) into n from public.portfolio where user_id = '00000000-0000-4000-8000-0000000000c8';
  if n <> 0 then raise exception 'FAIL: user A sees user B''s holdings'; end if;
  select count(*) into n from public.activity where user_id = '00000000-0000-4000-8000-0000000000c8';
  if n <> 0 then raise exception 'FAIL: user A sees user B''s activity'; end if;

  update public.portfolio set quantity = 999 where user_id = '00000000-0000-4000-8000-0000000000c8';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A changed user B''s holding'; end if;

  delete from public.watchlist where user_id = '00000000-0000-4000-8000-0000000000c8';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A deleted user B''s watchlist'; end if;

  -- A can't write rows for B.
  begin
    insert into public.watchlist (user_id, symbol) values ('00000000-0000-4000-8000-0000000000c8', 'HACK');
    raise exception 'FAIL: user A added to user B''s watchlist';
  exception when insufficient_privilege then null;
  end;

  -- Nonsense holdings are refused.
  begin
    insert into public.portfolio (symbol, quantity, buy_price) values ('TCS', -1, 2400);
    raise exception 'FAIL: a negative quantity was saved';
  exception when check_violation then null;
  end;

  -- No TRUNCATE for users.
  begin
    truncate public.watchlist;
    raise exception 'FAIL: a user truncated the watchlist';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  begin
    perform 1 from public.watchlist limit 1;
    raise exception 'FAIL: signed-out visitors can query the watchlist table';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.portfolio (user_id, symbol, quantity, buy_price) values ('00000000-0000-4000-8000-0000000000c8', 'X', 1, 1);
    raise exception 'FAIL: signed-out visitors can write holdings';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- Deleting an account removes its private rows (cascade).
delete from auth.users where id = '00000000-0000-4000-8000-0000000000c8';
do $$
begin
  if exists (select 1 from public.watchlist where user_id = '00000000-0000-4000-8000-0000000000c8')
     or exists (select 1 from public.portfolio where user_id = '00000000-0000-4000-8000-0000000000c8') then
    raise exception 'FAIL: deleting an account left its private rows behind';
  end if;
end $$;

select 'ALL CORE TABLE CHECKS PASSED' as result;

rollback;
