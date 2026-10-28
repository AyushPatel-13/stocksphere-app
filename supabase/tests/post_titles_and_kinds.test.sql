-- StockSphere · Post titles and types: integrity and access test
--
-- Proves the rules in migrations/20261029000100_post_titles_and_kinds.sql.
-- Run after applying it. Everything runs in one transaction ending in
-- ROLLBACK, so nothing is saved. Success prints
-- "ALL POST TITLE CHECKS PASSED"; a failure stops with the rule it broke.

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'titles-test-a@example.invalid');

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000e1', 'titles_test_a', 'Test A');

do $$
declare
  rejected boolean;
begin
  -- A titled, typed post; an untitled, untyped one (as every post was before).
  insert into public.posts (id, author_id, body, title, kind) values
    ('00000000-0000-4000-8000-00000000e100', '00000000-0000-4000-8000-0000000000e1', 'Margins look stretched.', 'Is TCS overvalued?', 'question');
  insert into public.posts (id, author_id, body) values
    ('00000000-0000-4000-8000-00000000e200', '00000000-0000-4000-8000-0000000000e1', 'Plain post');

  if (select kind from public.posts where id = '00000000-0000-4000-8000-00000000e100') <> 'question' then
    raise exception 'FAIL: a post type was not stored';
  end if;

  -- Unknown type.
  rejected := false;
  begin
    insert into public.posts (author_id, body, kind) values ('00000000-0000-4000-8000-0000000000e1', 'x', 'tip');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: an unknown post type was accepted'; end if;

  -- Blank, multi-line and over-long titles.
  rejected := false;
  begin
    insert into public.posts (author_id, body, title) values ('00000000-0000-4000-8000-0000000000e1', 'x', '   ');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a blank title was accepted'; end if;

  rejected := false;
  begin
    insert into public.posts (author_id, body, title) values ('00000000-0000-4000-8000-0000000000e1', 'x', E'two\nlines');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a multi-line title was accepted'; end if;

  rejected := false;
  begin
    insert into public.posts (author_id, body, title) values ('00000000-0000-4000-8000-0000000000e1', 'x', repeat('a', 121));
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a 121-character title was accepted'; end if;

  -- Comments carry neither.
  rejected := false;
  begin
    insert into public.posts (author_id, body, parent_id, title) values
      ('00000000-0000-4000-8000-0000000000e1', 'reply', '00000000-0000-4000-8000-00000000e100', 'A titled reply');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a comment took a title'; end if;

  rejected := false;
  begin
    insert into public.posts (author_id, body, parent_id, kind) values
      ('00000000-0000-4000-8000-0000000000e1', 'reply', '00000000-0000-4000-8000-00000000e100', 'analysis');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a comment took a post type'; end if;

  -- A plain comment still works, and the thread counts still move.
  insert into public.posts (author_id, body, parent_id) values
    ('00000000-0000-4000-8000-0000000000e1', 'A plain reply', '00000000-0000-4000-8000-00000000e100');
  if (select comment_count from public.posts where id = '00000000-0000-4000-8000-00000000e100') <> 1 then
    raise exception 'FAIL: comment counts stopped working';
  end if;
end $$;

-- ---------------------------------------------------------------- visitors
set local role anon;
do $$
begin
  if not exists (select 1 from public.posts where id = '00000000-0000-4000-8000-00000000e100' and title = 'Is TCS overvalued?') then
    raise exception 'FAIL: visitors can''t read titles';
  end if;
  begin
    update public.posts set title = 'Hijacked' where id = '00000000-0000-4000-8000-00000000e100';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- members
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000e1", "role": "authenticated"}';
do $$
declare
  rejected boolean := false;
begin
  -- Even the author can't write titles directly: every write goes through the server's checks.
  begin
    update public.posts set title = 'Edited around the server' where id = '00000000-0000-4000-8000-00000000e100';
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected and exists (select 1 from public.posts where id = '00000000-0000-4000-8000-00000000e100' and title = 'Edited around the server') then
    raise exception 'FAIL: a member updated a title directly';
  end if;
end $$;
reset role;

do $$
begin
  if (select title from public.posts where id = '00000000-0000-4000-8000-00000000e100') <> 'Is TCS overvalued?' then
    raise exception 'FAIL: a title changed without the server';
  end if;
end $$;

select 'ALL POST TITLE CHECKS PASSED' as result;

rollback;
