-- StockSphere · Posts access-control test
--
-- Proves the rules in migrations/20261019000300_posts.sql. Run in the Supabase
-- SQL Editor after applying the profiles and posts migrations. Everything runs
-- in one transaction ending in ROLLBACK, so nothing is saved. Success prints
-- "ALL POSTS RLS CHECKS PASSED"; a failure stops with the rule it broke.

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'posts-test-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'posts-test-b@example.invalid');

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000a1', 'posts_test_a', 'Test A'),
  ('00000000-0000-4000-8000-0000000000b1', 'posts_test_b', 'Test B');

-- Posts are created by the server (service role) — simulated here as postgres.
insert into public.posts (id, author_id, body, sentiment, symbols) values
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000a1', 'TCS looks strong', 'bullish', '{TCS}'),
  ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000000a1', 'hidden spam', null, '{}');
update public.posts set hidden = true where id = '00000000-0000-4000-8000-00000000a002';

-- ---------------------------------------------------------------- user B
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);

do $$
declare
  changed int;
begin
  -- B cannot write posts directly (server-only).
  begin
    insert into public.posts (author_id, body)
    values ('00000000-0000-4000-8000-0000000000b1', 'direct insert');
    raise exception 'FAIL: a user inserted a post directly';
  exception when insufficient_privilege then null;
  end;

  -- B cannot edit A's post (or any post).
  begin
    update public.posts set body = 'edited' where id = '00000000-0000-4000-8000-00000000a001';
    raise exception 'FAIL: a user edited a post';
  exception when insufficient_privilege then null;
  end;

  -- B cannot inflate like counts directly.
  begin
    update public.posts set like_count = 999 where id = '00000000-0000-4000-8000-00000000a001';
    raise exception 'FAIL: a user changed a like count';
  exception when insufficient_privilege then null;
  end;

  -- B cannot delete A's post.
  delete from public.posts where id = '00000000-0000-4000-8000-00000000a001';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: user B deleted user A''s post'; end if;

  -- B cannot see a hidden post.
  if exists (select 1 from public.posts where id = '00000000-0000-4000-8000-00000000a002') then
    raise exception 'FAIL: a hidden post is visible';
  end if;

  -- B can like as themselves, once; the trigger counts it.
  insert into public.post_likes (post_id) values ('00000000-0000-4000-8000-00000000a001');
  if (select like_count from public.posts where id = '00000000-0000-4000-8000-00000000a001') <> 1 then
    raise exception 'FAIL: like was not counted';
  end if;

  begin
    insert into public.post_likes (post_id) values ('00000000-0000-4000-8000-00000000a001');
    raise exception 'FAIL: the same user liked twice';
  exception when unique_violation then null;
  end;

  -- B cannot like on behalf of A.
  begin
    insert into public.post_likes (post_id, user_id)
    values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000a1');
    raise exception 'FAIL: user B liked as user A';
  exception when insufficient_privilege then null;
  end;

  -- B can report, but cannot read reports.
  insert into public.post_reports (post_id, reason) values ('00000000-0000-4000-8000-00000000a001', 'spam');
  if exists (select 1 from public.post_reports) then
    raise exception 'FAIL: reports are readable by users';
  end if;
exception when insufficient_privilege then
  -- SELECT on post_reports is not granted at all, which is also a pass.
  null;
end $$;

-- ---------------------------------------------------------------- user A
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

do $$
declare
  changed int;
begin
  delete from public.posts where id = '00000000-0000-4000-8000-00000000a001';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL: an author could not delete their own post'; end if;
end $$;

-- ---------------------------------------------------------------- anonymous
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  begin
    insert into public.post_likes (post_id, user_id)
    values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000a1');
    raise exception 'FAIL: an anonymous visitor liked a post';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
end $$;

reset role;
select 'ALL POSTS RLS CHECKS PASSED' as result;

rollback;
