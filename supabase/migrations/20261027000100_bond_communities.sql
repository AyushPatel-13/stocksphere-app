-- StockSphere · Bonds as communities, and @mentions of bonds on posts
--
-- Requires 20261024000200_communities.sql and 20261026000100_post_mentions.sql.
--
-- Why
--   Members can now tag an individual listed bond with @ (a G-Sec, an SDL, a
--   T-bill, a Sovereign Gold Bond, a corporate bond). A bond needs a stable
--   identity the way an IPO does, so it gets a row in the SAME communities
--   table — type 'bond', keyed by the bond's own ISIN — and posts reference
--   it through the existing posts.mentions / posts.mention_community_ids.
--   No new posts table, no copies: a bond's page reads the posts that
--   mention it with the indexed filter IPO communities already use.
--
-- Identity
--   A bond community is its ISIN and nothing else: never an issuer's stock
--   ticker (one issuer has many bonds), never an exchange symbol. It has no
--   upstox_ipo_id, board, exchange, symbol or listed_at, and it never changes
--   type — an IPO/stock community can't become a bond or the reverse. The
--   app server creates it only after finding the ISIN in the NSE/BSE listing.
--
-- Mentions
--   {"kind":"bond","communityId":"<uuid>","isin":"IN0020230085","symbol":"718GS2033",
--    "name":"GOI LOAN 7.18% 2033","issuer":"Government of India","category":"government",
--    "coupon":7.18,"maturity":"2033","start":0,"end":10}
--   identity is communityId + isin (checked against the community row);
--   the rest is the verified exchange record at the time of writing.
--   mention_community_ids now mirrors the IPO AND bond mentions.
--
-- Also: an IPO mention must point at an IPO/stock community and a bond
-- mention at a bond community with the same ISIN; a GIN index on mentions
-- serves the community floor's Stocks / IPOs / Bonds filter.
--
-- Security model (unchanged): anon/authenticated may only SELECT
-- communities and posts; every write is the service role, after the server's
-- checks. No existing row is changed. Every step is guarded and safe to
-- re-run. Rollback notes at the bottom.

begin;

-- ---------------------------------------------------------------- communities

alter table public.communities drop constraint if exists communities_type_values;
alter table public.communities add constraint communities_type_values
  check (type in ('ipo', 'stock', 'bond'));

alter table public.communities drop constraint if exists communities_type_shape;
alter table public.communities add constraint communities_type_shape check (
  (type = 'ipo' and exchange is null and symbol is null and listed_at is null)
  or (type = 'stock' and exchange is not null and symbol is not null and isin is not null and listed_at is not null)
  or (type = 'bond' and isin is not null and upstox_ipo_id is null and board is null
      and exchange is null and symbol is null and listed_at is null)
);

comment on table public.communities is
  'Stable identities posts point at. ipo → stock: one per company, keyed by ISIN, linked to its NSE/BSE symbol by the listing service. bond: one per listed bond, keyed by the bond''s own ISIN. Public read; written only by the app server.';

-- The permanence rules, plus: a bond stays a bond, and nothing becomes one.
create or replace function public.guard_community_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.isin is not null and new.isin is distinct from old.isin then
    raise exception 'A community''s ISIN can''t change once set' using errcode = 'check_violation';
  end if;
  if (old.type = 'bond') <> (new.type = 'bond') then
    raise exception 'A bond community stays a bond, and other communities can''t become one' using errcode = 'check_violation';
  end if;
  if old.type = 'stock' and (
       new.type <> 'stock'
       or new.exchange is distinct from old.exchange
       or new.symbol is distinct from old.symbol
       or new.listed_at is distinct from old.listed_at
     ) then
    raise exception 'A listed community stays linked to its stock' using errcode = 'check_violation';
  end if;
  if old.upstox_ipo_id is not null and new.upstox_ipo_id is distinct from old.upstox_ipo_id then
    raise exception 'A community''s IPO id can''t change once set' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.guard_community_identity() from public, anon, authenticated;

-- ---------------------------------------------------------------- mentions

comment on column public.posts.mentions is
  'Verified @mentions of instruments, IPOs and bonds, written by the app server. Display fields are a snapshot; identity is id / communityId (+ isin for bonds).';
comment on column public.posts.mention_community_ids is
  'IPO and bond communities the post mentions (mirrors mentions[kind in (ipo, bond)].communityId), for indexed feed filters.';

create or replace function public.check_post_mentions()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  from_json uuid[];
begin
  select coalesce(array_agg(distinct (m ->> 'communityId')::uuid), '{}')
    into from_json
    from jsonb_array_elements(new.mentions) m
   where m ->> 'kind' in ('ipo', 'bond');

  if not (from_json <@ new.mention_community_ids and new.mention_community_ids <@ from_json) then
    raise exception 'mention_community_ids must match the IPO and bond mentions' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from unnest(new.mention_community_ids) as mentioned(cid)
    where not exists (select 1 from communities c where c.id = mentioned.cid)
  ) then
    raise exception 'A mentioned community does not exist' using errcode = 'foreign_key_violation';
  end if;

  if exists (
    select 1 from jsonb_array_elements(new.mentions) m
    where coalesce(m ->> 'kind', '') not in ('instrument', 'ipo', 'bond')
       or jsonb_typeof(m -> 'start') <> 'number'
       or jsonb_typeof(m -> 'end') <> 'number'
       or (m ->> 'start')::int < 0
       or (m ->> 'end')::int <= (m ->> 'start')::int
       or (m ->> 'end')::int > char_length(new.body)
       or (m ->> 'kind' = 'instrument' and coalesce(m ->> 'id', '') = '')
       or (m ->> 'kind' = 'bond' and coalesce(m ->> 'isin', '') !~ '^IN[A-Z0-9]{9}[0-9]$')
  ) then
    raise exception 'A mention is malformed' using errcode = 'check_violation';
  end if;

  -- Each mention points at the right kind of community: an IPO mention at an
  -- IPO (or its listed stock), a bond mention at that bond (same ISIN).
  if exists (
    select 1
      from jsonb_array_elements(new.mentions) m
      join communities c on c.id = (m ->> 'communityId')::uuid
     where (m ->> 'kind' = 'ipo' and c.type not in ('ipo', 'stock'))
        or (m ->> 'kind' = 'bond' and (c.type <> 'bond' or c.isin is distinct from m ->> 'isin'))
  ) then
    raise exception 'A mention points at the wrong community' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.check_post_mentions() from public, anon, authenticated;
-- The posts_check_mentions trigger already calls this function; it is unchanged.

-- The Stocks / IPOs / Bonds filter: mentions @> '[{"kind":"bond"}]'.
create index if not exists posts_mentions_idx
  on public.posts using gin (mentions jsonb_path_ops);

commit;

-- Rollback (bond mentions written since are lost on the delete; posts are kept):
--   update public.posts set mentions = coalesce((select jsonb_agg(m) from jsonb_array_elements(mentions) m where m ->> 'kind' <> 'bond'), '[]'),
--     mention_community_ids = array(select unnest(mention_community_ids) except select id from public.communities where type = 'bond')
--     where mentions @> '[{"kind":"bond"}]';
--   delete from public.communities where type = 'bond';
--   drop index if exists public.posts_mentions_idx;
--   then re-run 20261024000200_communities.sql's guard function and constraints
--   and 20261026000100_post_mentions.sql's check_post_mentions().
