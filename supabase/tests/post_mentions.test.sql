-- StockSphere · Post mentions integrity and access test
--
-- Proves the rules in migrations/20261026000100_post_mentions.sql. Run in the
-- Supabase SQL Editor after applying the posts, communities and post_mentions
-- migrations. Everything runs in one transaction ending in ROLLBACK, so
-- nothing is saved. Success prints "ALL POST MENTIONS CHECKS PASSED"; a
-- failure stops with the rule it broke.

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'mentions-test-a@example.invalid');

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000e1', 'mentions_test_a', 'Test M');

insert into public.communities (id, name, isin, upstox_ipo_id, board) values
  ('00000000-0000-4000-8000-00000000e001', 'Test Gamma IPO', 'INE000G01011', 'test-gamma-ipo', 'mainboard');

do $$
declare
  changed int;
begin
  -- Old-style posts still insert: no mentions, empty defaults.
  insert into public.posts (id, author_id, body) values
    ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000000e1', 'plain post');
  if (select mentions from public.posts where id = '00000000-0000-4000-8000-00000000f001') <> '[]'::jsonb
     or (select cardinality(mention_community_ids) from public.posts where id = '00000000-0000-4000-8000-00000000f001') <> 0 then
    raise exception 'FAIL: an old-style post got mentions';
  end if;

  -- A valid post mentioning an IPO and a stock.
  insert into public.posts (id, author_id, body, symbols, mentions, mention_community_ids) values
    ('00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-0000000000e1',
     '@Test Gamma IPO vs @SBIN', '{SBIN}',
     '[{"kind":"ipo","communityId":"00000000-0000-4000-8000-00000000e001","ipoId":"test-gamma-ipo","name":"Test Gamma IPO","start":0,"end":15},
       {"kind":"instrument","id":"India:SBIN","type":"stock","symbol":"SBIN","exchange":"NSE","name":"State Bank of India","href":"/stock/SBIN","start":19,"end":24}]',
     '{00000000-0000-4000-8000-00000000e001}');

  -- Found by the IPO's indexed filter.
  if not exists (select 1 from public.posts where mention_community_ids @> '{00000000-0000-4000-8000-00000000e001}') then
    raise exception 'FAIL: the IPO mention is not findable';
  end if;

  -- A community that doesn't exist.
  begin
    insert into public.posts (author_id, body, mentions, mention_community_ids) values
      ('00000000-0000-4000-8000-0000000000e1', '@Ghost IPO',
       '[{"kind":"ipo","communityId":"00000000-0000-4000-8000-00000000eeee","ipoId":"ghost","name":"Ghost","start":0,"end":10}]',
       '{00000000-0000-4000-8000-00000000eeee}');
    raise exception 'FAIL: a mention of a missing community was saved';
  exception when foreign_key_violation then null;
  end;

  -- The array must match the IPO mentions, both ways.
  begin
    insert into public.posts (author_id, body, mentions, mention_community_ids) values
      ('00000000-0000-4000-8000-0000000000e1', 'no mention here', '[]', '{00000000-0000-4000-8000-00000000e001}');
    raise exception 'FAIL: a community id without a mention was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.posts (author_id, body, mentions) values
      ('00000000-0000-4000-8000-0000000000e1', '@Test Gamma IPO',
       '[{"kind":"ipo","communityId":"00000000-0000-4000-8000-00000000e001","ipoId":"test-gamma-ipo","name":"x","start":0,"end":15}]');
    raise exception 'FAIL: an IPO mention without its community id was saved';
  exception when check_violation then null;
  end;

  -- Positions must fall inside the body; kinds must be known; max 5.
  begin
    insert into public.posts (author_id, body, mentions) values
      ('00000000-0000-4000-8000-0000000000e1', 'short',
       '[{"kind":"instrument","id":"India:SBIN","start":0,"end":50}]');
    raise exception 'FAIL: a mention outside the body was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.posts (author_id, body, mentions) values
      ('00000000-0000-4000-8000-0000000000e1', '@x here', '[{"kind":"user","start":0,"end":2}]');
    raise exception 'FAIL: an unknown mention kind was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.posts (author_id, body, mentions) values
      ('00000000-0000-4000-8000-0000000000e1', '@x here', '[{"start":0,"end":2}]');
    raise exception 'FAIL: a mention without a kind was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.posts (author_id, body, mentions) values
      ('00000000-0000-4000-8000-0000000000e1', '@a @b @c @d @e @f',
       '[{"kind":"instrument","id":"a","start":0,"end":2},{"kind":"instrument","id":"b","start":3,"end":5},
         {"kind":"instrument","id":"c","start":6,"end":8},{"kind":"instrument","id":"d","start":9,"end":11},
         {"kind":"instrument","id":"e","start":12,"end":14},{"kind":"instrument","id":"f","start":15,"end":17}]');
    raise exception 'FAIL: six mentions were saved';
  exception when check_violation then null;
  end;

  -- A mentioned community can't be deleted.
  begin
    delete from public.communities where id = '00000000-0000-4000-8000-00000000e001';
    raise exception 'FAIL: a mentioned community was deleted';
  exception when foreign_key_violation then null;
  end;

  -- Listing keeps the reference: the same community id, now a stock.
  update public.communities set type = 'stock', exchange = 'NSE', symbol = 'GAMMA', listed_at = now()
  where id = '00000000-0000-4000-8000-00000000e001';
  if not exists (select 1 from public.posts where mention_community_ids @> '{00000000-0000-4000-8000-00000000e001}') then
    raise exception 'FAIL: listing broke the IPO mention';
  end if;

  -- Server edit: new body and mentions, edited_at set.
  update public.posts set body = 'Edited: @SBIN only', symbols = '{SBIN}', edited_at = now(),
    mentions = '[{"kind":"instrument","id":"India:SBIN","type":"stock","symbol":"SBIN","exchange":"NSE","name":"State Bank of India","href":"/stock/SBIN","start":8,"end":13}]',
    mention_community_ids = '{}'
  where id = '00000000-0000-4000-8000-00000000f002';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL: the server could not edit a post'; end if;

  -- An edit can't leave a mention pointing past the new body.
  begin
    update public.posts set body = 'x' where id = '00000000-0000-4000-8000-00000000f002';
    raise exception 'FAIL: an edit left a mention outside the body';
  exception when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------- signed-in member
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);

do $$
begin
  -- Members read mentions but can't write them, even on their own post.
  if not exists (select 1 from public.posts where id = '00000000-0000-4000-8000-00000000f002' and jsonb_array_length(mentions) = 1) then
    raise exception 'FAIL: mentions are not readable';
  end if;
  begin
    update public.posts set mentions = '[]' where id = '00000000-0000-4000-8000-00000000f002';
    raise exception 'FAIL: a member edited mentions directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.posts (author_id, body, mentions, mention_community_ids) values
      ('00000000-0000-4000-8000-0000000000e1', '@Test Gamma IPO',
       '[{"kind":"ipo","communityId":"00000000-0000-4000-8000-00000000e001","ipoId":"test-gamma-ipo","name":"x","start":0,"end":15}]',
       '{00000000-0000-4000-8000-00000000e001}');
    raise exception 'FAIL: a member inserted a post with mentions directly';
  exception when insufficient_privilege then null;
  end;

  -- Deleting your own post removes its mentions with it.
  delete from public.posts where id = '00000000-0000-4000-8000-00000000f002';
  if exists (select 1 from public.posts where id = '00000000-0000-4000-8000-00000000f002') then
    raise exception 'FAIL: an author could not delete their post';
  end if;
end $$;

reset role;
select 'ALL POST MENTIONS CHECKS PASSED' as result;

rollback;
