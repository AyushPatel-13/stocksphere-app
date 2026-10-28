-- StockSphere · Votes: integrity and access test
--
-- Proves the rules in migrations/20261031000100_post_votes.sql. Run after
-- applying it. One transaction ending in ROLLBACK, so nothing is saved.
-- Success prints "ALL VOTE CHECKS PASSED".

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'votes-test-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'votes-test-b@example.invalid');

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000b1', 'votes_test_a', 'A'),
  ('00000000-0000-4000-8000-0000000000b2', 'votes_test_b', 'B');

insert into public.posts (id, author_id, body) values
  ('00000000-0000-4000-8000-00000000b100', '00000000-0000-4000-8000-0000000000b1', 'Votable post'),
  ('00000000-0000-4000-8000-00000000b200', '00000000-0000-4000-8000-0000000000b1', 'Hidden post');
update public.posts set hidden = true where id = '00000000-0000-4000-8000-00000000b200';

-- ---------------------------------------------------------------- member A
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated"}';
do $$
declare
  rejected boolean;
begin
  insert into public.post_votes (post_id, user_id, value) values ('00000000-0000-4000-8000-00000000b100', '00000000-0000-4000-8000-0000000000b1', 1);

  -- One vote per member per post.
  rejected := false;
  begin
    insert into public.post_votes (post_id, user_id, value) values ('00000000-0000-4000-8000-00000000b100', '00000000-0000-4000-8000-0000000000b1', 1);
  exception when unique_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member voted twice'; end if;

  -- Only +1 or -1.
  rejected := false;
  begin
    insert into public.post_votes (post_id, user_id, value) values ('00000000-0000-4000-8000-00000000b100', '00000000-0000-4000-8000-0000000000b1', 5);
  exception when check_violation or unique_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a vote of 5 was accepted'; end if;

  -- Not on someone else's behalf.
  rejected := false;
  begin
    insert into public.post_votes (post_id, user_id, value) values ('00000000-0000-4000-8000-00000000b100', '00000000-0000-4000-8000-0000000000b2', 1);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member voted as someone else'; end if;

  -- Not on a hidden post.
  rejected := false;
  begin
    insert into public.post_votes (post_id, user_id, value) values ('00000000-0000-4000-8000-00000000b200', '00000000-0000-4000-8000-0000000000b1', 1);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member voted on a hidden post'; end if;

  -- Scores can't be written by hand.
  rejected := false;
  begin
    update public.posts set up_count = 999 where id = '00000000-0000-4000-8000-00000000b100';
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member set a vote count'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------- member B: down, then changes to up, then removes
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b2", "role": "authenticated"}';
insert into public.post_votes (post_id, user_id, value) values ('00000000-0000-4000-8000-00000000b100', '00000000-0000-4000-8000-0000000000b2', -1);
reset role;

do $$
begin
  if (select row(up_count, down_count, score)::text from public.posts where id = '00000000-0000-4000-8000-00000000b100') <> '(1,1,0)' then
    raise exception 'FAIL: counts after an up and a down vote';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b2", "role": "authenticated"}';
update public.post_votes set value = 1 where post_id = '00000000-0000-4000-8000-00000000b100' and user_id = '00000000-0000-4000-8000-0000000000b2';
do $$
declare
  changed int;
begin
  -- B can't change or remove A's vote.
  update public.post_votes set value = -1 where user_id = '00000000-0000-4000-8000-0000000000b1';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: a member changed someone else''s vote'; end if;
  delete from public.post_votes where user_id = '00000000-0000-4000-8000-0000000000b1';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: a member removed someone else''s vote'; end if;
end $$;
reset role;

do $$
begin
  if (select row(up_count, down_count, score)::text from public.posts where id = '00000000-0000-4000-8000-00000000b100') <> '(2,0,2)' then
    raise exception 'FAIL: counts after changing a vote';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b2", "role": "authenticated"}';
delete from public.post_votes where post_id = '00000000-0000-4000-8000-00000000b100' and user_id = '00000000-0000-4000-8000-0000000000b2';
reset role;

do $$
begin
  if (select row(up_count, down_count, score)::text from public.posts where id = '00000000-0000-4000-8000-00000000b100') <> '(1,0,1)' then
    raise exception 'FAIL: counts after removing a vote';
  end if;
end $$;

-- ---------------------------------------------------------------- visitors
set local role anon;
do $$
declare
  rejected boolean := false;
begin
  if (select count(*) from public.post_votes where post_id = '00000000-0000-4000-8000-00000000b100') <> 1 then
    raise exception 'FAIL: visitors can''t read votes';
  end if;
  begin
    insert into public.post_votes (post_id, user_id, value) values ('00000000-0000-4000-8000-00000000b100', '00000000-0000-4000-8000-0000000000b2', 1);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a visitor voted'; end if;
end $$;
reset role;

-- Deleting a post removes its votes.
delete from public.posts where id = '00000000-0000-4000-8000-00000000b100';
do $$
begin
  if exists (select 1 from public.post_votes where post_id = '00000000-0000-4000-8000-00000000b100') then
    raise exception 'FAIL: a deleted post kept its votes';
  end if;
end $$;

select 'ALL VOTE CHECKS PASSED' as result;

rollback;
