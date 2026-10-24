-- StockSphere · Communities access-control and identity test
--
-- Proves the rules in migrations/20261024000200_communities.sql. Run in the
-- Supabase SQL Editor after applying the profiles, posts and communities
-- migrations. Everything runs in one transaction ending in ROLLBACK, so
-- nothing is saved. Success prints "ALL COMMUNITIES CHECKS PASSED"; a failure
-- stops with the rule it broke.

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'communities-test-a@example.invalid');

insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000c1', 'communities_test_a', 'Test C');

-- Communities are created by the server (service role) — simulated as postgres.
insert into public.communities (id, name, isin, upstox_ipo_id, board) values
  ('00000000-0000-4000-8000-00000000c001', 'Test Alpha IPO', 'INE000T01019', 'test-alpha-ipo', 'mainboard'),
  ('00000000-0000-4000-8000-00000000c002', 'Test Beta IPO', null, 'test-beta-ipo', 'sme');

insert into public.posts (id, author_id, body, community_id) values
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000000c1', 'Applying for Alpha', '00000000-0000-4000-8000-00000000c001');

do $$
begin
  -- Same ISIN or same IPO id twice: refused (no duplicate communities).
  begin
    insert into public.communities (name, isin, upstox_ipo_id) values ('dup', 'INE000T01019', 'other-ipo');
    raise exception 'FAIL: two communities share an ISIN';
  exception when unique_violation then null;
  end;
  begin
    insert into public.communities (name, upstox_ipo_id) values ('dup', 'test-alpha-ipo');
    raise exception 'FAIL: two communities share an IPO id';
  exception when unique_violation then null;
  end;

  -- A community needs a key; an IPO community can't carry a ticker.
  begin
    insert into public.communities (name) values ('no key');
    raise exception 'FAIL: a community without any key was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.communities (name, upstox_ipo_id, exchange, symbol) values ('x', 'x-ipo', 'NSE', 'X');
    raise exception 'FAIL: an IPO community was saved with a ticker';
  exception when check_violation then null;
  end;

  -- A stock community needs an ISIN.
  begin
    update public.communities set type = 'stock', exchange = 'NSE', symbol = 'BETA', listed_at = now()
    where id = '00000000-0000-4000-8000-00000000c002';
    raise exception 'FAIL: a community was listed without an ISIN';
  exception when check_violation then null;
  end;

  -- Reply inherits the parent's community, whatever was sent.
  insert into public.posts (id, author_id, body, parent_id, community_id) values
    ('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-0000000000c1', 'me too',
     '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c002');
  if (select community_id from public.posts where id = '00000000-0000-4000-8000-00000000d002')
     is distinct from '00000000-0000-4000-8000-00000000c001' then
    raise exception 'FAIL: a reply did not inherit its parent''s community';
  end if;

  -- Listing: the same row gains exchange + symbol; its posts stay attached.
  update public.communities set type = 'stock', exchange = 'NSE', symbol = 'ALPHA', listed_at = now()
  where id = '00000000-0000-4000-8000-00000000c001';
  if (select count(*) from public.posts where community_id = '00000000-0000-4000-8000-00000000c001') <> 2 then
    raise exception 'FAIL: posts moved when the community listed';
  end if;

  -- Re-running the same link is a no-op.
  update public.communities set type = 'stock', exchange = 'NSE', symbol = 'ALPHA'
  where id = '00000000-0000-4000-8000-00000000c001';

  -- Once listed, the link can't be changed or undone.
  begin
    update public.communities set symbol = 'OTHER' where id = '00000000-0000-4000-8000-00000000c001';
    raise exception 'FAIL: a listed community was re-attached';
  exception when check_violation then null;
  end;
  begin
    update public.communities set type = 'ipo', exchange = null, symbol = null, listed_at = null
    where id = '00000000-0000-4000-8000-00000000c001';
    raise exception 'FAIL: a listing was undone';
  exception when check_violation then null;
  end;
  begin
    update public.communities set isin = 'INE000T01027' where id = '00000000-0000-4000-8000-00000000c001';
    raise exception 'FAIL: an ISIN was changed';
  exception when check_violation then null;
  end;

  -- No second community can claim the same ticker.
  update public.communities set isin = 'INE000T01035' where id = '00000000-0000-4000-8000-00000000c002';
  begin
    update public.communities set type = 'stock', exchange = 'NSE', symbol = 'ALPHA', listed_at = now()
    where id = '00000000-0000-4000-8000-00000000c002';
    raise exception 'FAIL: two communities share a ticker';
  exception when unique_violation then null;
  end;

  insert into public.community_listing_checks (community_id, status) values
    ('00000000-0000-4000-8000-00000000c002', 'failed');
end $$;

-- ---------------------------------------------------------------- signed-in member
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.communities) < 2 then
    raise exception 'FAIL: communities are not readable';
  end if;

  begin
    insert into public.communities (name, upstox_ipo_id) values ('mine', 'member-ipo');
    raise exception 'FAIL: a member created a community';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.communities set name = 'renamed' where id = '00000000-0000-4000-8000-00000000c002';
    raise exception 'FAIL: a member edited a community';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.communities where id = '00000000-0000-4000-8000-00000000c002';
    raise exception 'FAIL: a member deleted a community';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.community_listing_checks;
    raise exception 'FAIL: listing checks are readable by members';
  exception when insufficient_privilege then null;
  end;

  -- Members still can't write posts directly, so can't pick a community.
  begin
    insert into public.posts (author_id, body, community_id)
    values ('00000000-0000-4000-8000-0000000000c1', 'direct', '00000000-0000-4000-8000-00000000c002');
    raise exception 'FAIL: a member inserted a post directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------- anonymous
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  if not exists (select 1 from public.communities where upstox_ipo_id = 'test-alpha-ipo') then
    raise exception 'FAIL: communities are not public';
  end if;

  begin
    insert into public.communities (name, upstox_ipo_id) values ('anon', 'anon-ipo');
    raise exception 'FAIL: an anonymous visitor created a community';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.community_listing_checks;
    raise exception 'FAIL: listing checks are readable anonymously';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'ALL COMMUNITIES CHECKS PASSED' as result;

rollback;
