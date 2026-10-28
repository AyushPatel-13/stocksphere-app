-- StockSphere · Reposts, quotes and bookmarks: integrity and access test
--
-- Proves the rules in migrations/20261101000100_reposts_quotes_bookmarks.sql.
-- Run after applying it. One transaction ending in ROLLBACK, so nothing is
-- saved. Success prints "ALL REPOST AND BOOKMARK CHECKS PASSED".

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000d7', 'authenticated', 'authenticated', 'reposts-test-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000d8', 'authenticated', 'authenticated', 'reposts-test-b@example.invalid');
insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000d7', 'reposts_test_a', 'A'),
  ('00000000-0000-4000-8000-0000000000d8', 'reposts_test_b', 'B');

insert into public.posts (id, author_id, body) values
  ('00000000-0000-4000-8000-00000000d700', '00000000-0000-4000-8000-0000000000d7', 'Original post'),
  ('00000000-0000-4000-8000-00000000d710', '00000000-0000-4000-8000-0000000000d7', 'Hidden post');
insert into public.posts (id, author_id, body, parent_id) values
  ('00000000-0000-4000-8000-00000000d701', '00000000-0000-4000-8000-0000000000d8', 'A comment', '00000000-0000-4000-8000-00000000d700');
update public.posts set hidden = true where id = '00000000-0000-4000-8000-00000000d710';

-- ---------------------------------------------------------------- member B
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d8", "role": "authenticated"}';
do $$
declare
  rejected boolean;
begin
  insert into public.reposts (user_id, post_id) values ('00000000-0000-4000-8000-0000000000d8', '00000000-0000-4000-8000-00000000d700');

  rejected := false;
  begin
    insert into public.reposts (user_id, post_id) values ('00000000-0000-4000-8000-0000000000d8', '00000000-0000-4000-8000-00000000d700');
  exception when unique_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member reposted twice'; end if;

  rejected := false;
  begin
    insert into public.reposts (user_id, post_id) values ('00000000-0000-4000-8000-0000000000d7', '00000000-0000-4000-8000-00000000d700');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member reposted as someone else'; end if;

  rejected := false;
  begin
    insert into public.reposts (user_id, post_id) values ('00000000-0000-4000-8000-0000000000d8', '00000000-0000-4000-8000-00000000d701');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a comment was reposted'; end if;

  rejected := false;
  begin
    insert into public.reposts (user_id, post_id) values ('00000000-0000-4000-8000-0000000000d8', '00000000-0000-4000-8000-00000000d710');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a hidden post was reposted'; end if;

  -- Bookmarks: own only.
  insert into public.bookmarks (user_id, post_id) values ('00000000-0000-4000-8000-0000000000d8', '00000000-0000-4000-8000-00000000d700');
  rejected := false;
  begin
    insert into public.bookmarks (user_id, post_id) values ('00000000-0000-4000-8000-0000000000d7', '00000000-0000-4000-8000-00000000d700');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member bookmarked as someone else'; end if;

  -- Clients can't write repost counts or quote links.
  rejected := false;
  begin
    update public.posts set repost_count = 50 where id = '00000000-0000-4000-8000-00000000d700';
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member set a repost count'; end if;
end $$;
reset role;

do $$
begin
  if (select repost_count from public.posts where id = '00000000-0000-4000-8000-00000000d700') <> 1 then
    raise exception 'FAIL: repost_count after a repost';
  end if;
end $$;

-- ---------------------------------------------------------------- member A can't see B's bookmarks, or undo B's repost
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d7", "role": "authenticated"}';
do $$
declare
  changed int;
begin
  if exists (select 1 from public.bookmarks) then
    raise exception 'FAIL: a member saw someone else''s bookmarks';
  end if;
  delete from public.reposts where user_id = '00000000-0000-4000-8000-0000000000d8';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: a member undid someone else''s repost'; end if;
  delete from public.bookmarks where user_id = '00000000-0000-4000-8000-0000000000d8';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: a member removed someone else''s bookmark'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------- visitors
set local role anon;
do $$
declare
  rejected boolean := false;
begin
  if not exists (select 1 from public.reposts where post_id = '00000000-0000-4000-8000-00000000d700') then
    raise exception 'FAIL: visitors can''t see reposts';
  end if;
  begin
    perform 1 from public.bookmarks;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: visitors can read bookmarks'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------- B undoes the repost
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000d8", "role": "authenticated"}';
delete from public.reposts where user_id = '00000000-0000-4000-8000-0000000000d8' and post_id = '00000000-0000-4000-8000-00000000d700';
reset role;

do $$
begin
  if (select repost_count from public.posts where id = '00000000-0000-4000-8000-00000000d700') <> 0 then
    raise exception 'FAIL: repost_count after undoing';
  end if;
end $$;

-- ---------------------------------------------------------------- quotes (written by the server)
insert into public.posts (id, author_id, body, quote_of) values
  ('00000000-0000-4000-8000-00000000d720', '00000000-0000-4000-8000-0000000000d8', 'Quoting this', '00000000-0000-4000-8000-00000000d700');
do $$
declare
  rejected boolean := false;
begin
  begin
    update public.posts set quote_of = id where id = '00000000-0000-4000-8000-00000000d720';
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a post quoted itself'; end if;
end $$;

-- Deleting the original clears the link; the quote stays.
delete from public.posts where id = '00000000-0000-4000-8000-00000000d700';
do $$
begin
  if (select quote_of from public.posts where id = '00000000-0000-4000-8000-00000000d720') is not null then
    raise exception 'FAIL: a quote kept a link to a deleted post';
  end if;
  if exists (select 1 from public.bookmarks where post_id = '00000000-0000-4000-8000-00000000d700') then
    raise exception 'FAIL: a deleted post kept its bookmarks';
  end if;
end $$;

select 'ALL REPOST AND BOOKMARK CHECKS PASSED' as result;

rollback;
