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

-- A server-created reply bumps the parent's reply count; deleting it lowers it.
do $$
begin
  insert into public.posts (id, author_id, body, parent_id) values
    ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000000b1', 'agree', '00000000-0000-4000-8000-00000000a001');
  if (select reply_count from public.posts where id = '00000000-0000-4000-8000-00000000a001') <> 1 then
    raise exception 'FAIL: reply was not counted';
  end if;
  delete from public.posts where id = '00000000-0000-4000-8000-00000000b001';
  if (select reply_count from public.posts where id = '00000000-0000-4000-8000-00000000a001') <> 0 then
    raise exception 'FAIL: deleted reply was not uncounted';
  end if;

  -- Replies never carry a sentiment.
  begin
    insert into public.posts (author_id, body, sentiment, parent_id) values
      ('00000000-0000-4000-8000-0000000000b1', 'x', 'bullish', '00000000-0000-4000-8000-00000000a001');
    raise exception 'FAIL: a reply was saved with a sentiment';
  exception when check_violation then null;
  end;
end $$;

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

  -- B can report as themselves (an error here is a real failure, not a pass).
  insert into public.post_reports (post_id, reason) values ('00000000-0000-4000-8000-00000000a001', 'spam');

  -- B cannot report on behalf of A.
  begin
    insert into public.post_reports (post_id, reporter_id, reason)
    values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000a1', 'spam');
    raise exception 'FAIL: user B reported as user A';
  exception when insufficient_privilege then null;
  end;

  -- B cannot read reports: SELECT is not granted, or no row is visible.
  -- Only this one statement may fail with insufficient_privilege; a
  -- permission error anywhere else in this block is a real failure.
  begin
    if exists (select 1 from public.post_reports) then
      raise exception 'FAIL: reports are readable by users';
    end if;
  exception when insufficient_privilege then null;
  end;

  -- B can unlike their own like; the trigger brings the count back down.
  delete from public.post_likes where post_id = '00000000-0000-4000-8000-00000000a001';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL: user B could not unlike'; end if;
  if (select like_count from public.posts where id = '00000000-0000-4000-8000-00000000a001') <> 0 then
    raise exception 'FAIL: unlike was not counted';
  end if;
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
