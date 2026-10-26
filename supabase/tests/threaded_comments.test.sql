-- StockSphere · Threaded comments: integrity and access test
--
-- Proves the rules in migrations/20261028000100_threaded_comments.sql. Run in
-- the Supabase SQL Editor after applying it. Everything runs in one
-- transaction ending in ROLLBACK, so nothing is saved. Success prints
-- "ALL THREADED COMMENT CHECKS PASSED"; a failure stops with the rule it broke.

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated', 'threads-test-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000d2', 'authenticated', 'authenticated', 'threads-test-b@example.invalid');

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000d1', 'threads_test_a', 'Test A'),
  ('00000000-0000-4000-8000-0000000000d2', 'threads_test_b', 'Test B');

-- Post "Should I trust this IPO?"
--   A "I think so."                      (d101)
--     B "Why do you think so?"           (d102)
--       A "Because of the fundamentals." (d103)
--   C "I disagree."                      (d104, top-level comment)
-- And another post (d200) with a comment (d201).
insert into public.posts (id, author_id, body) values
  ('00000000-0000-4000-8000-00000000d100', '00000000-0000-4000-8000-0000000000d1', 'Should I trust this IPO?'),
  ('00000000-0000-4000-8000-00000000d200', '00000000-0000-4000-8000-0000000000d2', 'Another post');

do $$
declare
  changed int;
begin
  -- The client never sets root_id: the database does, from the parent.
  insert into public.posts (id, author_id, body, parent_id, root_id) values
    ('00000000-0000-4000-8000-00000000d101', '00000000-0000-4000-8000-0000000000d1', 'I think so.', '00000000-0000-4000-8000-00000000d100', '00000000-0000-4000-8000-00000000d200');
  insert into public.posts (id, author_id, body, parent_id) values
    ('00000000-0000-4000-8000-00000000d102', '00000000-0000-4000-8000-0000000000d2', 'Why do you think so?', '00000000-0000-4000-8000-00000000d101');
  insert into public.posts (id, author_id, body, parent_id) values
    ('00000000-0000-4000-8000-00000000d103', '00000000-0000-4000-8000-0000000000d1', 'Because of the company''s fundamentals.', '00000000-0000-4000-8000-00000000d102');
  insert into public.posts (id, author_id, body, parent_id) values
    ('00000000-0000-4000-8000-00000000d104', '00000000-0000-4000-8000-0000000000d2', 'I disagree.', '00000000-0000-4000-8000-00000000d100'),
    ('00000000-0000-4000-8000-00000000d201', '00000000-0000-4000-8000-0000000000d1', 'On the other post', '00000000-0000-4000-8000-00000000d200');

  if exists (
    select 1 from public.posts
     where id in ('00000000-0000-4000-8000-00000000d101', '00000000-0000-4000-8000-00000000d102',
                  '00000000-0000-4000-8000-00000000d103', '00000000-0000-4000-8000-00000000d104')
       and root_id is distinct from '00000000-0000-4000-8000-00000000d100'
  ) then
    raise exception 'FAIL: a comment is not in its own post''s thread';
  end if;
  if (select parent_id from public.posts where id = '00000000-0000-4000-8000-00000000d103') <> '00000000-0000-4000-8000-00000000d102' then
    raise exception 'FAIL: a reply to a reply lost its direct parent';
  end if;
  if (select root_id from public.posts where id = '00000000-0000-4000-8000-00000000d100') is not null then
    raise exception 'FAIL: a top-level post has a root';
  end if;

  -- Counts: 4 comments in the thread, 2 direct replies on the post, 1 on each of A and B.
  if (select comment_count from public.posts where id = '00000000-0000-4000-8000-00000000d100') <> 4
     or (select reply_count from public.posts where id = '00000000-0000-4000-8000-00000000d100') <> 2
     or (select reply_count from public.posts where id = '00000000-0000-4000-8000-00000000d101') <> 1
     or (select reply_count from public.posts where id = '00000000-0000-4000-8000-00000000d102') <> 1 then
    raise exception 'FAIL: thread counts are wrong';
  end if;

  -- One indexed query loads the whole thread, oldest first.
  if (select count(*) from public.posts where root_id = '00000000-0000-4000-8000-00000000d100') <> 4 then
    raise exception 'FAIL: the thread query misses comments';
  end if;

  -- ------------------------------------------------------------ invalid links
  begin
    insert into public.posts (author_id, body, parent_id) values
      ('00000000-0000-4000-8000-0000000000d1', 'to nowhere', '00000000-0000-4000-8000-00000000dfff');
    raise exception 'FAIL: a reply to a missing comment was saved';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.posts (id, author_id, body, parent_id) values
      ('00000000-0000-4000-8000-00000000d1ff', '00000000-0000-4000-8000-0000000000d1', 'my own parent', '00000000-0000-4000-8000-00000000d1ff');
    raise exception 'FAIL: a post that is its own parent was saved';
  exception when foreign_key_violation or check_violation then null;
  end;
  -- No moving a comment: not to another post, not under its own reply (a cycle).
  begin
    update public.posts set parent_id = '00000000-0000-4000-8000-00000000d201' where id = '00000000-0000-4000-8000-00000000d101';
    raise exception 'FAIL: a comment moved to another post';
  exception when check_violation then null;
  end;
  begin
    update public.posts set parent_id = '00000000-0000-4000-8000-00000000d103' where id = '00000000-0000-4000-8000-00000000d101';
    raise exception 'FAIL: a comment moved under its own reply';
  exception when check_violation then null;
  end;
  begin
    update public.posts set root_id = '00000000-0000-4000-8000-00000000d200' where id = '00000000-0000-4000-8000-00000000d104';
    raise exception 'FAIL: a comment changed thread';
  exception when check_violation then null;
  end;
  begin
    update public.posts set parent_id = '00000000-0000-4000-8000-00000000d100' where id = '00000000-0000-4000-8000-00000000d200';
    raise exception 'FAIL: a top-level post became a comment';
  exception when check_violation then null;
  end;

  -- Replies never take a stance (unchanged rule), at any depth.
  begin
    insert into public.posts (author_id, body, parent_id, sentiment) values
      ('00000000-0000-4000-8000-0000000000d1', 'bullish reply', '00000000-0000-4000-8000-00000000d102', 'bullish');
    raise exception 'FAIL: a nested reply carried a sentiment';
  exception when check_violation then null;
  end;

  -- The server can still edit a nested comment's text.
  update public.posts set body = 'Because of the fundamentals.', edited_at = now() where id = '00000000-0000-4000-8000-00000000d103';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL: a nested comment could not be edited'; end if;
end $$;

-- Likes on comments and replies.
insert into public.post_likes (post_id, user_id) values
  ('00000000-0000-4000-8000-00000000d102', '00000000-0000-4000-8000-0000000000d1'),
  ('00000000-0000-4000-8000-00000000d103', '00000000-0000-4000-8000-0000000000d2');

-- ---------------------------------------------------------------- members
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);

do $$
declare
  changed int;
begin
  -- Members can't write comments directly (only the app server does).
  begin
    insert into public.posts (author_id, body, parent_id) values
      ('00000000-0000-4000-8000-0000000000d1', 'direct', '00000000-0000-4000-8000-00000000d102');
    raise exception 'FAIL: a member inserted a reply directly';
  exception when insufficient_privilege then null;
  end;

  -- Someone else's comment: nothing deleted.
  delete from public.posts where id = '00000000-0000-4000-8000-00000000d102';
  get diagnostics changed = row_count;
  if changed <> 0 or not exists (select 1 from public.posts where id = '00000000-0000-4000-8000-00000000d102' and deleted_at is null) then
    raise exception 'FAIL: a member deleted someone else''s comment';
  end if;

  -- Their own comment that others answered: a placeholder, replies kept.
  delete from public.posts where id = '00000000-0000-4000-8000-00000000d101';
  if not exists (select 1 from public.posts where id = '00000000-0000-4000-8000-00000000d101' and deleted_at is not null and body = '[deleted]') then
    raise exception 'FAIL: an answered comment was not kept as a placeholder';
  end if;
  if (select count(*) from public.posts where root_id = '00000000-0000-4000-8000-00000000d100') <> 4 then
    raise exception 'FAIL: deleting an answered comment removed replies';
  end if;

  -- Their own comment nobody answered: removed, counts follow, likes go with it.
  delete from public.posts where id = '00000000-0000-4000-8000-00000000d103';
  if exists (select 1 from public.posts where id = '00000000-0000-4000-8000-00000000d103') then
    raise exception 'FAIL: an unanswered comment was not deleted';
  end if;
end $$;

reset role;

do $$
begin
  if (select comment_count from public.posts where id = '00000000-0000-4000-8000-00000000d100') <> 3
     or (select reply_count from public.posts where id = '00000000-0000-4000-8000-00000000d102') <> 0 then
    raise exception 'FAIL: counts did not follow the delete';
  end if;
  if (select like_count from public.posts where id = '00000000-0000-4000-8000-00000000d102') <> 1 then
    raise exception 'FAIL: a comment''s like was lost';
  end if;

  -- Deleting the post removes its whole thread, placeholder included.
  delete from public.posts where id = '00000000-0000-4000-8000-00000000d100';
  if exists (select 1 from public.posts where root_id = '00000000-0000-4000-8000-00000000d100' or id = '00000000-0000-4000-8000-00000000d101') then
    raise exception 'FAIL: deleting a post left comments behind';
  end if;
  if not exists (select 1 from public.posts where id = '00000000-0000-4000-8000-00000000d201') then
    raise exception 'FAIL: deleting a post removed another post''s comments';
  end if;
end $$;

-- ---------------------------------------------------------------- visitors
set local role anon;
do $$
begin
  if not exists (select 1 from public.posts where id = '00000000-0000-4000-8000-00000000d201' and root_id = '00000000-0000-4000-8000-00000000d200') then
    raise exception 'FAIL: anonymous visitors can''t read threads';
  end if;
end $$;
reset role;

select 'ALL THREADED COMMENT CHECKS PASSED' as result;

rollback;
