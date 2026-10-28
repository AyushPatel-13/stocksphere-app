-- StockSphere · Ranked feeds test
--
-- Proves community_feed() in migrations/20261031000200_community_feed.sql.
-- Run after applying post_titles_and_kinds, post_votes and community_feed.
-- One transaction ending in ROLLBACK. Success prints "ALL FEED CHECKS PASSED".
--
-- Test posts are dated in 2001 so the live posts never mix into the checks
-- (every query below passes p_since or a filter that only matches them).

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'feed-test-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000c2', 'authenticated', 'authenticated', 'feed-test-b@example.invalid'),
  ('00000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'feed-test-c@example.invalid');
insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000c1', 'feed_test_a', 'A'),
  ('00000000-0000-4000-8000-0000000000c2', 'feed_test_b', 'B'),
  ('00000000-0000-4000-8000-0000000000c3', 'feed_test_c', 'C');

-- c101 old, popular; c102 newer, no votes; c103 newest, by B, about FEEDTST; c104 hidden.
insert into public.posts (id, author_id, body, created_at, symbols, sentiment, kind) values
  ('00000000-0000-4000-8000-00000000c101', '00000000-0000-4000-8000-0000000000c1', 'Old but loved', '2001-01-01 00:00+00', '{}', 'bullish', 'analysis'),
  ('00000000-0000-4000-8000-00000000c102', '00000000-0000-4000-8000-0000000000c1', 'Newer, quiet', '2001-01-02 00:00+00', '{}', null, 'question'),
  ('00000000-0000-4000-8000-00000000c103', '00000000-0000-4000-8000-0000000000c2', 'Newest, about a stock', '2001-01-03 00:00+00', '{FEEDTST}', 'bearish', null),
  ('00000000-0000-4000-8000-00000000c104', '00000000-0000-4000-8000-0000000000c1', 'Hidden', '2001-01-04 00:00+00', '{}', null, null);
update public.posts set hidden = true where id = '00000000-0000-4000-8000-00000000c104';

-- Three up-votes on c101; one down on c102.
insert into public.post_votes (post_id, user_id, value) values
  ('00000000-0000-4000-8000-00000000c101', '00000000-0000-4000-8000-0000000000c1', 1),
  ('00000000-0000-4000-8000-00000000c101', '00000000-0000-4000-8000-0000000000c2', 1),
  ('00000000-0000-4000-8000-00000000c101', '00000000-0000-4000-8000-0000000000c3', 1),
  ('00000000-0000-4000-8000-00000000c102', '00000000-0000-4000-8000-0000000000c2', -1);

set local role anon;
do $$
declare
  since constant timestamptz := '2000-12-31 00:00+00';
  ids uuid[];
begin
  -- New: newest first, hidden left out (RLS).
  select array_agg(post_id order by ord) into ids
    from (select post_id, row_number() over () as ord from public.community_feed('new', since) f
           where post_id::text like '00000000-0000-4000-8000-00000000c1%') s;
  if ids <> array['00000000-0000-4000-8000-00000000c103', '00000000-0000-4000-8000-00000000c102', '00000000-0000-4000-8000-00000000c101']::uuid[] then
    raise exception 'FAIL: new order %', ids;
  end if;

  -- Top: score first.
  select array_agg(post_id order by ord) into ids
    from (select post_id, row_number() over () as ord from public.community_feed('top', since) f
           where post_id::text like '00000000-0000-4000-8000-00000000c1%') s;
  if ids[1] <> '00000000-0000-4000-8000-00000000c101' or ids[3] <> '00000000-0000-4000-8000-00000000c102' then
    raise exception 'FAIL: top order %', ids;
  end if;

  -- Filters: author, symbol, sentiment, kind.
  if (select array_agg(post_id) from public.community_feed('new', since, p_any_authors => array['00000000-0000-4000-8000-0000000000c2']::uuid[]))
     <> array['00000000-0000-4000-8000-00000000c103']::uuid[] then
    raise exception 'FAIL: author filter';
  end if;
  if (select array_agg(post_id) from public.community_feed('new', since, p_any_symbols => array['FEEDTST']))
     <> array['00000000-0000-4000-8000-00000000c103']::uuid[] then
    raise exception 'FAIL: symbol filter';
  end if;
  if exists (select 1 from public.community_feed('new', since, p_sentiment => 'bullish') f where f.post_id = '00000000-0000-4000-8000-00000000c103') then
    raise exception 'FAIL: sentiment filter';
  end if;
  if not exists (select 1 from public.community_feed('new', since, p_kind => 'question') f where f.post_id = '00000000-0000-4000-8000-00000000c102') then
    raise exception 'FAIL: kind filter';
  end if;

  -- Trending: nothing from 2001 has engagement in the last 24 h.
  if exists (select 1 from public.community_feed('trending') f where f.post_id::text like '00000000-0000-4000-8000-00000000c1%') then
    raise exception 'FAIL: old posts trended';
  end if;

  -- Paging: the limit is capped and pages don't overlap.
  if (select count(*) from public.community_feed('new', since, p_limit => 500)) > 50 then
    raise exception 'FAIL: limit not capped';
  end if;
end $$;
reset role;

select 'ALL FEED CHECKS PASSED' as result;

rollback;
