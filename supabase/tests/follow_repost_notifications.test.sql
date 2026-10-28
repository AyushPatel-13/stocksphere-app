-- StockSphere · Follow and repost notifications test
--
-- Proves migrations/20261101000200_follow_repost_notifications.sql. One
-- transaction ending in ROLLBACK. Success prints
-- "ALL FOLLOW AND REPOST NOTIFICATION CHECKS PASSED".

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000f7', 'authenticated', 'authenticated', 'notify-test-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000f8', 'authenticated', 'authenticated', 'notify-test-b@example.invalid');
insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000f7', 'notify_test_a', 'A'),
  ('00000000-0000-4000-8000-0000000000f8', 'notify_test_b', 'B');
insert into public.posts (id, author_id, body) values
  ('00000000-0000-4000-8000-00000000f700', '00000000-0000-4000-8000-0000000000f7', 'A''s post');

-- B follows A, unfollows, follows again: one notification.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f8", "role": "authenticated"}';
insert into public.follows (follower_id, followee_id) values ('00000000-0000-4000-8000-0000000000f8', '00000000-0000-4000-8000-0000000000f7');
delete from public.follows where follower_id = '00000000-0000-4000-8000-0000000000f8';
insert into public.follows (follower_id, followee_id) values ('00000000-0000-4000-8000-0000000000f8', '00000000-0000-4000-8000-0000000000f7');
-- B reposts A's post.
insert into public.reposts (user_id, post_id) values ('00000000-0000-4000-8000-0000000000f8', '00000000-0000-4000-8000-00000000f700');
reset role;

-- A reposts their own post: tells nobody.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f7", "role": "authenticated"}';
insert into public.reposts (user_id, post_id) values ('00000000-0000-4000-8000-0000000000f7', '00000000-0000-4000-8000-00000000f700');
reset role;

do $$
begin
  if (select count(*) from public.notifications where user_id = '00000000-0000-4000-8000-0000000000f7' and title = '@notify_test_b started following you' and link = '/profile/notify_test_b') <> 1 then
    raise exception 'FAIL: follow notification missing or repeated';
  end if;
  if (select count(*) from public.notifications where user_id = '00000000-0000-4000-8000-0000000000f7' and title = '@notify_test_b reposted your post' and link = '/community/post/00000000-0000-4000-8000-00000000f700') <> 1 then
    raise exception 'FAIL: repost notification missing';
  end if;
  if exists (select 1 from public.notifications where user_id = '00000000-0000-4000-8000-0000000000f7' and title like '@notify_test_a%') then
    raise exception 'FAIL: a member was notified about their own repost';
  end if;
  if exists (select 1 from public.notifications where user_id = '00000000-0000-4000-8000-0000000000f8') then
    raise exception 'FAIL: the actor was notified';
  end if;
end $$;

-- Members still can't call the helper themselves.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000f8", "role": "authenticated"}';
do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.notify_community('00000000-0000-4000-8000-0000000000f7', 'spam', '/');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member could write someone else''s notification'; end if;
end $$;
reset role;

select 'ALL FOLLOW AND REPOST NOTIFICATION CHECKS PASSED' as result;

rollback;
