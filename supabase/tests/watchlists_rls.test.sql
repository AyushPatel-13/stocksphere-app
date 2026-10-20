-- StockSphere · Named watchlists access-control test
--
-- Proves migrations/20261020000100_watchlists.sql. Run in the SQL Editor after
-- that migration. One transaction ending in ROLLBACK: nothing is saved.
-- Success prints "ALL WATCHLIST CHECKS PASSED".

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated', 'wl-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000d2', 'authenticated', 'authenticated', 'wl-b@example.invalid');

insert into public.watchlists (id, user_id, name, position) values
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-0000000000d1', 'My Watchlist', 0),
  ('00000000-0000-4000-8000-00000000d0b1', '00000000-0000-4000-8000-0000000000d2', 'My Watchlist', 0);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);

do $$
declare
  n int;
begin
  -- Sees only their own lists.
  select count(*) into n from public.watchlists;
  if n <> 1 then raise exception 'FAIL: user A sees % lists, expected 1', n; end if;

  -- Can create, rename and delete their own list.
  insert into public.watchlists (name, position) values ('IT stocks', 1);
  update public.watchlists set name = 'Tech' where name = 'IT stocks';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: user A could not rename their list'; end if;

  -- Can't create a list for someone else.
  begin
    insert into public.watchlists (user_id, name) values ('00000000-0000-4000-8000-0000000000d2', 'Sneaky');
    raise exception 'FAIL: user A created a list owned by user B';
  exception when insufficient_privilege then null;
  end;

  -- Can't rename or delete user B's list (RLS hides it: 0 rows touched).
  update public.watchlists set name = 'Hacked' where id = '00000000-0000-4000-8000-00000000d0b1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A renamed user B''s list'; end if;

  delete from public.watchlists where id = '00000000-0000-4000-8000-00000000d0b1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A deleted user B''s list'; end if;

  -- Duplicate names (case-insensitive) are refused.
  begin
    insert into public.watchlists (name, position) values ('tech', 2);
    raise exception 'FAIL: a duplicate list name was accepted';
  exception when unique_violation then null;
  end;
end $$;

reset role;

-- The ownership trigger: a row can't be attached to another user's list,
-- even by a role that bypasses RLS.
do $$
begin
  begin
    insert into public.watchlist (user_id, symbol, watchlist_id)
    values ('00000000-0000-4000-8000-0000000000d1', 'TCS', '00000000-0000-4000-8000-00000000d0b1');
    raise exception 'FAIL: a row was attached to another user''s list';
  exception when insufficient_privilege then null;
  end;

  insert into public.watchlist (user_id, symbol, watchlist_id)
  values ('00000000-0000-4000-8000-0000000000d1', 'TCS', '00000000-0000-4000-8000-00000000d0a1');
end $$;

select 'ALL WATCHLIST CHECKS PASSED' as result;

rollback;
