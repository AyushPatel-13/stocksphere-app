-- StockSphere · Saved screens access-control test
--
-- Proves migrations/20261114000100_saved_screens.sql. Run after applying it.
-- One transaction ending in ROLLBACK, so nothing is saved.
-- Success prints "ALL SAVED SCREEN CHECKS PASSED".

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'screens-test-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated', 'screens-test-b@example.invalid');

-- ---------------------------------------------------------------- member B saves one
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}';
insert into public.saved_screens (name, criteria) values ('B''s screen', '{"maxPe": 15}');
reset role;

-- ---------------------------------------------------------------- member A
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}';
do $$
declare
  rejected boolean;
  changed int;
begin
  insert into public.saved_screens (name, criteria) values ('Low P/E banks', '{"maxPe": 15, "sector": "Financial Services"}');

  -- A sees only their own screen.
  if (select count(*) from public.saved_screens) <> 1 then
    raise exception 'FAIL: a member can see someone else''s saved screens';
  end if;
  if (select user_id from public.saved_screens) <> '00000000-0000-4000-8000-0000000000f1' then
    raise exception 'FAIL: a screen wasn''t saved under its author';
  end if;

  -- The same name again (any case or spacing) is refused: the app replaces instead.
  rejected := false;
  begin
    insert into public.saved_screens (name, criteria) values ('  low p/e BANKS ', '{}');
  exception when unique_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: two screens with the same name'; end if;

  -- Not on someone else's behalf (user_id can't even be set).
  rejected := false;
  begin
    insert into public.saved_screens (user_id, name, criteria) values ('00000000-0000-4000-8000-0000000000f2', 'Planted', '{}');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member saved a screen as someone else'; end if;

  -- Only a small JSON object, with a real name.
  rejected := false;
  begin
    insert into public.saved_screens (name, criteria) values ('Array', '[1,2,3]');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: criteria that isn''t an object was accepted'; end if;
  rejected := false;
  begin
    insert into public.saved_screens (name, criteria) values ('Huge', jsonb_build_object('x', repeat('y', 5000)));
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: oversized criteria were accepted'; end if;
  rejected := false;
  begin
    insert into public.saved_screens (name, criteria) values ('   ', '{}');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a blank name was accepted'; end if;

  -- B's screen can't be changed or removed.
  update public.saved_screens set name = 'Hijacked' where name = 'B''s screen';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: a member renamed someone else''s screen'; end if;
  delete from public.saved_screens where name = 'B''s screen';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: a member removed someone else''s screen'; end if;

  -- Ten at most.
  for i in 2..10 loop
    insert into public.saved_screens (name, criteria) values ('Screen ' || i, '{}');
  end loop;
  rejected := false;
  begin
    insert into public.saved_screens (name, criteria) values ('Screen 11', '{}');
  exception when sqlstate 'P0001' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: an eleventh screen was saved'; end if;

  -- Their own can be renamed and removed, which frees a slot.
  update public.saved_screens set name = 'Cheap banks' where name = 'Low P/E banks';
  delete from public.saved_screens where name = 'Screen 2';
  insert into public.saved_screens (name, criteria) values ('Screen 11', '{}');
end $$;
reset role;

-- ---------------------------------------------------------------- visitors
set local role anon;
do $$
declare
  rejected boolean := false;
begin
  begin
    perform 1 from public.saved_screens;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a visitor can read saved screens'; end if;
end $$;
reset role;

-- B's screen is untouched, and deleting an account removes its screens.
select set_config('request.jwt.claims', '', true);
do $$
begin
  if (select count(*) from public.saved_screens where user_id = '00000000-0000-4000-8000-0000000000f2' and name = 'B''s screen') <> 1 then
    raise exception 'FAIL: member B''s screen was changed';
  end if;
  delete from auth.users where id = '00000000-0000-4000-8000-0000000000f1';
  if exists (select 1 from public.saved_screens where user_id = '00000000-0000-4000-8000-0000000000f1') then
    raise exception 'FAIL: a deleted account kept its saved screens';
  end if;
end $$;

select 'ALL SAVED SCREEN CHECKS PASSED' as result;

rollback;
