-- StockSphere · Profiles access-control test
--
-- Proves the rules in migrations/20261019000100_profiles.sql against the real
-- database. Run it in the Supabase SQL Editor AFTER applying that migration.
--
-- It is safe to run on production: everything happens inside one transaction
-- that ends in ROLLBACK, so the two throwaway users and their profiles are
-- never saved. A failing check stops the script with an error naming the rule;
-- if it reaches the end you will see "ALL PROFILE RLS CHECKS PASSED".

begin;

-- Two throwaway auth users (rolled back at the end).
insert into auth.users (id, aud, role, email)
values
  ('00000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'rls-test-a@example.invalid'),
  ('00000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'rls-test-b@example.invalid');

-- ---------------------------------------------------------------- user A
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

-- A can create their own profile.
insert into public.profiles (id, username, display_name)
values ('00000000-0000-4000-8000-00000000000a', 'rls_test_a', 'Test A');

do $$
begin
  -- A cannot create a profile for B.
  begin
    insert into public.profiles (id, username, display_name)
    values ('00000000-0000-4000-8000-00000000000b', 'rls_test_spoof', 'Spoof');
    raise exception 'FAIL: user A created a profile for user B';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- A cannot make themselves a moderator (role is not a writable column).
  begin
    update public.profiles set role = 'admin'
    where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: user A changed their own role';
  exception when insufficient_privilege then null;
  end;

  -- A cannot take a reserved handle.
  begin
    update public.profiles set username = 'sebi'
    where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: user A took a reserved handle';
  exception when check_violation then null;
  end;

  -- A cannot use an invalid handle.
  begin
    update public.profiles set username = 'Bad Handle!'
    where id = '00000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: user A saved an invalid handle';
  exception when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------- user B
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

insert into public.profiles (id, username, display_name)
values ('00000000-0000-4000-8000-00000000000b', 'rls_test_b', 'Test B');

do $$
declare
  changed int;
begin
  -- B cannot edit A's profile: the update matches no rows.
  update public.profiles set display_name = 'hacked'
  where id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: user B edited user A''s profile';
  end if;

  -- B cannot delete A's profile (no delete policy).
  delete from public.profiles where id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: user B deleted user A''s profile';
  end if;

  -- B cannot steal A's handle (unique).
  begin
    update public.profiles set username = 'rls_test_a'
    where id = '00000000-0000-4000-8000-00000000000b';
    raise exception 'FAIL: two profiles share a handle';
  exception when unique_violation then null;
  end;

  -- B can still read A's public profile.
  if not exists (select 1 from public.profiles where username = 'rls_test_a') then
    raise exception 'FAIL: public profiles are not readable';
  end if;
end $$;

-- ---------------------------------------------------------------- anonymous
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  if not exists (select 1 from public.profiles where username = 'rls_test_b') then
    raise exception 'FAIL: anonymous visitors cannot read public profiles';
  end if;

  begin
    insert into public.profiles (id, username, display_name)
    values (gen_random_uuid(), 'rls_test_anon', 'Anon');
    raise exception 'FAIL: an anonymous visitor created a profile';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'ALL PROFILE RLS CHECKS PASSED' as result;

rollback;
