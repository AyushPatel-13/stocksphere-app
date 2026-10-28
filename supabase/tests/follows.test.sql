-- StockSphere · Follows: integrity and access test
--
-- Proves the rules in migrations/20261030000100_follows.sql. Run after
-- applying it. Everything runs in one transaction ending in ROLLBACK, so
-- nothing is saved. Success prints "ALL FOLLOW CHECKS PASSED"; a failure
-- stops with the rule it broke.

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'follows-test-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'follows-test-b@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a3', 'authenticated', 'authenticated', 'follows-test-c@example.invalid');

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000a1', 'follows_test_a', 'A'),
  ('00000000-0000-4000-8000-0000000000a2', 'follows_test_b', 'B'),
  ('00000000-0000-4000-8000-0000000000a3', 'follows_test_c', 'C');

-- ---------------------------------------------------------------- member A
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
do $$
declare
  rejected boolean;
begin
  -- A follows B and C.
  insert into public.follows (follower_id, followee_id) values
    ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2'),
    ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a3');

  -- Twice is one follow.
  rejected := false;
  begin
    insert into public.follows (follower_id, followee_id) values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2');
  exception when unique_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member followed someone twice'; end if;

  -- Not yourself.
  rejected := false;
  begin
    insert into public.follows (follower_id, followee_id) values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member followed themselves'; end if;

  -- Not on someone else's behalf.
  rejected := false;
  begin
    insert into public.follows (follower_id, followee_id) values ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member followed on someone else''s behalf'; end if;

  -- Counts can't be written by hand.
  rejected := false;
  begin
    update public.profiles set follower_count = 1000 where id = '00000000-0000-4000-8000-0000000000a1';
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member set their own follower count'; end if;
end $$;
reset role;

do $$
begin
  if (select following_count from public.profiles where id = '00000000-0000-4000-8000-0000000000a1') <> 2
     or (select follower_count from public.profiles where id = '00000000-0000-4000-8000-0000000000a2') <> 1
     or (select follower_count from public.profiles where id = '00000000-0000-4000-8000-0000000000a3') <> 1 then
    raise exception 'FAIL: follow counts are wrong after following';
  end if;
end $$;

-- ---------------------------------------------------------------- member B
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated"}';
do $$
declare
  changed int;
begin
  -- B can't remove A's follow.
  delete from public.follows where follower_id = '00000000-0000-4000-8000-0000000000a1';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: a member removed someone else''s follow'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------- A unfollows C
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}';
delete from public.follows
 where follower_id = '00000000-0000-4000-8000-0000000000a1' and followee_id = '00000000-0000-4000-8000-0000000000a3';
reset role;

do $$
begin
  if (select following_count from public.profiles where id = '00000000-0000-4000-8000-0000000000a1') <> 1
     or (select follower_count from public.profiles where id = '00000000-0000-4000-8000-0000000000a3') <> 0 then
    raise exception 'FAIL: follow counts are wrong after unfollowing';
  end if;
end $$;

-- ---------------------------------------------------------------- visitors
set local role anon;
do $$
declare
  rejected boolean := false;
begin
  if not exists (select 1 from public.follows where followee_id = '00000000-0000-4000-8000-0000000000a2') then
    raise exception 'FAIL: visitors can''t see who follows whom';
  end if;
  begin
    insert into public.follows (follower_id, followee_id) values ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a2');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a visitor followed someone'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------- deleting a profile removes its follows
delete from public.profiles where id = '00000000-0000-4000-8000-0000000000a2';
do $$
begin
  if exists (select 1 from public.follows where followee_id = '00000000-0000-4000-8000-0000000000a2') then
    raise exception 'FAIL: a deleted profile kept its follows';
  end if;
  if (select following_count from public.profiles where id = '00000000-0000-4000-8000-0000000000a1') <> 0 then
    raise exception 'FAIL: counts weren''t updated when a followed profile was deleted';
  end if;
end $$;

select 'ALL FOLLOW CHECKS PASSED' as result;

rollback;
