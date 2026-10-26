-- StockSphere · Bond communities and bond mentions: integrity and access test
--
-- Proves the rules in migrations/20261027000100_bond_communities.sql. Run in
-- the Supabase SQL Editor after applying the posts, communities,
-- post_mentions and bond_communities migrations. Everything runs in one
-- transaction ending in ROLLBACK, so nothing is saved. Success prints
-- "ALL BOND COMMUNITY CHECKS PASSED"; a failure stops with the rule it broke.

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'bonds-test-a@example.invalid');

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000b1', 'bonds_test_a', 'Test B');

-- A bond (real ISIN shape; the row itself is rolled back) and an IPO.
insert into public.communities (id, type, name, isin) values
  ('00000000-0000-4000-8000-00000000b001', 'bond', 'TEST LOAN 7.18% 2033', 'IN0000000B09');
insert into public.communities (id, name, isin, upstox_ipo_id, board) values
  ('00000000-0000-4000-8000-00000000b002', 'Test Delta IPO', 'INE000D01019', 'test-delta-ipo', 'mainboard');

do $$
declare
  changed int;
begin
  -- ---------------------------------------------------------- bond shape
  begin
    insert into public.communities (type, name) values ('bond', 'No ISIN');
    raise exception 'FAIL: a bond without an ISIN was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.communities (type, name, isin, upstox_ipo_id) values ('bond', 'Bond with IPO id', 'IN0000000C08', 'some-ipo');
    raise exception 'FAIL: a bond with an IPO id was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.communities (type, name, isin, exchange, symbol) values ('bond', 'Bond with ticker', 'IN0000000D07', 'NSE', 'SBIN');
    raise exception 'FAIL: a bond with a stock ticker was saved';
  exception when check_violation then null;
  end;
  -- One community per ISIN, whatever its type.
  begin
    insert into public.communities (type, name, isin) values ('bond', 'Duplicate', 'IN0000000B09');
    raise exception 'FAIL: a second community for the same ISIN was saved';
  exception when unique_violation then null;
  end;

  -- ---------------------------------------------------------- permanence
  begin
    update public.communities set type = 'ipo' where id = '00000000-0000-4000-8000-00000000b001';
    raise exception 'FAIL: a bond community changed type';
  exception when check_violation then null;
  end;
  begin
    update public.communities set type = 'bond', upstox_ipo_id = null, board = null where id = '00000000-0000-4000-8000-00000000b002';
    raise exception 'FAIL: an IPO community became a bond';
  exception when check_violation then null;
  end;
  begin
    update public.communities set isin = 'IN0000000E06' where id = '00000000-0000-4000-8000-00000000b001';
    raise exception 'FAIL: a bond''s ISIN changed';
  exception when check_violation then null;
  end;

  -- ---------------------------------------------------------- mentions
  -- A post mentioning a bond, an IPO and a stock.
  insert into public.posts (id, author_id, body, symbols, mentions, mention_community_ids) values
    ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000b1',
     '@TEST2033 vs @Test Delta IPO vs @SBIN', '{SBIN}',
     '[{"kind":"bond","communityId":"00000000-0000-4000-8000-00000000b001","isin":"IN0000000B09","symbol":"TEST2033","name":"TEST LOAN 7.18% 2033","issuer":"Government of India","category":"government","coupon":7.18,"maturity":"2033","start":0,"end":9},
       {"kind":"ipo","communityId":"00000000-0000-4000-8000-00000000b002","ipoId":"test-delta-ipo","name":"Test Delta IPO","start":13,"end":28},
       {"kind":"instrument","id":"India:SBIN","type":"stock","symbol":"SBIN","exchange":"NSE","name":"State Bank of India","href":"/stock/SBIN","start":32,"end":37}]',
     '{00000000-0000-4000-8000-00000000b001,00000000-0000-4000-8000-00000000b002}');

  -- The bond page's filter and the floor's Bonds filter both find it.
  if not exists (select 1 from public.posts where mention_community_ids @> '{00000000-0000-4000-8000-00000000b001}') then
    raise exception 'FAIL: the bond mention is not findable by community';
  end if;
  if not exists (select 1 from public.posts where id = '00000000-0000-4000-8000-00000000c001' and mentions @> '[{"kind":"bond"}]') then
    raise exception 'FAIL: the Bonds filter does not find the post';
  end if;

  -- Old-style posts and stock/IPO-only mentions still save.
  insert into public.posts (author_id, body) values ('00000000-0000-4000-8000-0000000000b1', 'plain post');
  insert into public.posts (author_id, body, symbols, mentions) values
    ('00000000-0000-4000-8000-0000000000b1', '@SBIN only', '{SBIN}',
     '[{"kind":"instrument","id":"India:SBIN","type":"stock","symbol":"SBIN","exchange":"NSE","name":"State Bank of India","href":"/stock/SBIN","start":0,"end":5}]');

  -- A bond mention missing from mention_community_ids.
  begin
    insert into public.posts (author_id, body, mentions) values
      ('00000000-0000-4000-8000-0000000000b1', '@TEST2033',
       '[{"kind":"bond","communityId":"00000000-0000-4000-8000-00000000b001","isin":"IN0000000B09","category":"government","start":0,"end":9}]');
    raise exception 'FAIL: a bond mention without its community id was saved';
  exception when check_violation then null;
  end;

  -- A bond mention pointing at an IPO community, or at another ISIN.
  begin
    insert into public.posts (author_id, body, mentions, mention_community_ids) values
      ('00000000-0000-4000-8000-0000000000b1', '@TEST2033',
       '[{"kind":"bond","communityId":"00000000-0000-4000-8000-00000000b002","isin":"INE000D01019","category":"corporate","start":0,"end":9}]',
       '{00000000-0000-4000-8000-00000000b002}');
    raise exception 'FAIL: a bond mention of an IPO community was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.posts (author_id, body, mentions, mention_community_ids) values
      ('00000000-0000-4000-8000-0000000000b1', '@TEST2033',
       '[{"kind":"bond","communityId":"00000000-0000-4000-8000-00000000b001","isin":"IN0000000F05","category":"government","start":0,"end":9}]',
       '{00000000-0000-4000-8000-00000000b001}');
    raise exception 'FAIL: a bond mention with a different ISIN was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.posts (author_id, body, mentions, mention_community_ids) values
      ('00000000-0000-4000-8000-0000000000b1', '@TEST2033',
       '[{"kind":"bond","communityId":"00000000-0000-4000-8000-00000000b001","isin":"SBIN","category":"government","start":0,"end":9}]',
       '{00000000-0000-4000-8000-00000000b001}');
    raise exception 'FAIL: a bond mention with a ticker for an ISIN was saved';
  exception when check_violation then null;
  end;

  -- An IPO mention pointing at a bond community.
  begin
    insert into public.posts (author_id, body, mentions, mention_community_ids) values
      ('00000000-0000-4000-8000-0000000000b1', '@Test Delta IPO',
       '[{"kind":"ipo","communityId":"00000000-0000-4000-8000-00000000b001","ipoId":"test-delta-ipo","name":"x","start":0,"end":15}]',
       '{00000000-0000-4000-8000-00000000b001}');
    raise exception 'FAIL: an IPO mention of a bond community was saved';
  exception when check_violation then null;
  end;

  -- A mentioned bond can't be deleted.
  begin
    delete from public.communities where id = '00000000-0000-4000-8000-00000000b001';
    raise exception 'FAIL: a mentioned bond community was deleted';
  exception when foreign_key_violation then null;
  end;

  -- Server edit: the bond mention removed, the IPO kept.
  update public.posts set body = 'Edited: @Test Delta IPO', edited_at = now(), symbols = '{}',
    mentions = '[{"kind":"ipo","communityId":"00000000-0000-4000-8000-00000000b002","ipoId":"test-delta-ipo","name":"Test Delta IPO","start":8,"end":23}]',
    mention_community_ids = '{00000000-0000-4000-8000-00000000b002}'
  where id = '00000000-0000-4000-8000-00000000c001';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL: the server could not edit a post'; end if;
  if exists (select 1 from public.posts where mention_community_ids @> '{00000000-0000-4000-8000-00000000b001}') then
    raise exception 'FAIL: the removed bond mention is still found';
  end if;

  -- The IPO lists: its mention (now a stock community) still validates on edit.
  update public.communities set type = 'stock', exchange = 'NSE', symbol = 'DELTA', listed_at = now()
  where id = '00000000-0000-4000-8000-00000000b002';
  update public.posts set body = 'Edited: @Test Delta IPO!' where id = '00000000-0000-4000-8000-00000000c001';
end $$;

-- ---------------------------------------------------------------- signed-in member
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);

do $$
begin
  -- Members read bond communities but can't create or change them.
  if not exists (select 1 from public.communities where id = '00000000-0000-4000-8000-00000000b001' and type = 'bond') then
    raise exception 'FAIL: bond communities are not readable';
  end if;
  begin
    insert into public.communities (type, name, isin) values ('bond', 'Made up', 'IN0000000G04');
    raise exception 'FAIL: a member created a bond community';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.communities set name = 'Renamed' where id = '00000000-0000-4000-8000-00000000b001';
    raise exception 'FAIL: a member renamed a bond community';
  exception when insufficient_privilege then null;
  end;
  -- …nor write mentions directly.
  begin
    insert into public.posts (author_id, body, mentions, mention_community_ids) values
      ('00000000-0000-4000-8000-0000000000b1', '@TEST2033',
       '[{"kind":"bond","communityId":"00000000-0000-4000-8000-00000000b001","isin":"IN0000000B09","category":"government","start":0,"end":9}]',
       '{00000000-0000-4000-8000-00000000b001}');
    raise exception 'FAIL: a member inserted a bond mention directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------- anonymous visitor
reset role;
set local role anon;

do $$
begin
  if not exists (select 1 from public.communities where id = '00000000-0000-4000-8000-00000000b001') then
    raise exception 'FAIL: anonymous visitors can''t read bond communities';
  end if;
  begin
    insert into public.communities (type, name, isin) values ('bond', 'Made up', 'IN0000000H03');
    raise exception 'FAIL: an anonymous visitor created a bond community';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'ALL BOND COMMUNITY CHECKS PASSED' as result;

rollback;
