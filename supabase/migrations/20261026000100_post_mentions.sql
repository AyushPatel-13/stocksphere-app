-- StockSphere · Structured @mentions of stocks and IPOs on posts, and post edits
--
-- Requires 20261019000300_posts.sql and 20261024000200_communities.sql.
--
-- Why
--   A post could only be tied to an IPO by being written in that IPO's
--   community (posts.community_id), and to a stock through posts.symbols. A
--   post such as "should i trust this ipo ?" written on the main feed names
--   nothing the app can resolve, and "@SBI" was rendered as a profile link.
--   Members now pick the stock or IPO from an @ autocomplete; the server
--   verifies each pick against real records and stores the reference here.
--
-- Shape (all on posts — one canonical row, no copies, no join table)
--   mentions               jsonb array, at most 5. Each element is written by
--                          the server only:
--                            {"kind":"instrument","id":"India:SBIN","type":"stock",
--                             "symbol":"SBIN","exchange":"NSE","name":"…","href":"/stock/SBIN",
--                             "start":12,"end":17}
--                            {"kind":"ipo","communityId":"<uuid>","ipoId":"…","name":"…",
--                             "start":0,"end":21}
--                          name/symbol/href are a display snapshot; identity is
--                          id (instrument) or communityId (IPO). start/end are
--                          the mention's position in body.
--   mention_community_ids  uuid[] of the IPO communities mentioned, so an IPO's
--                          feed (and, after listing, its stock's board) can
--                          find the post with one indexed filter. A trigger
--                          checks every id is a real community and that the
--                          array matches the jsonb.
--   edited_at              set by the server when an author edits a post.
--   Instrument mentions also add the board symbol to posts.symbols (the
--   existing mechanism), so stock boards list them without any change.
--
-- Security model (unchanged): clients still have no INSERT/UPDATE on posts;
-- mentions are written only by the app server after verification. A
-- community referenced by a mention can't be deleted.
--
-- Existing rows get '[]' / '{}' / NULL — nothing is inferred for old posts.
-- Every step is guarded and safe to re-run. Rollback notes at the bottom.

begin;

-- ---------------------------------------------------------------- columns

alter table public.posts add column if not exists mentions jsonb not null default '[]'::jsonb;
alter table public.posts add column if not exists mention_community_ids uuid[] not null default '{}';
alter table public.posts add column if not exists edited_at timestamptz;

alter table public.posts drop constraint if exists posts_mentions_shape;
alter table public.posts add constraint posts_mentions_shape
  check (jsonb_typeof(mentions) = 'array' and jsonb_array_length(mentions) <= 5);

alter table public.posts drop constraint if exists posts_mention_communities_max;
alter table public.posts add constraint posts_mention_communities_max
  check (cardinality(mention_community_ids) <= 5);

-- Only posts that mention an IPO are indexed.
create index if not exists posts_mention_communities_idx
  on public.posts using gin (mention_community_ids) where cardinality(mention_community_ids) > 0;

comment on column public.posts.mentions is
  'Verified @mentions of instruments and IPOs, written by the app server. Display fields are a snapshot; identity is id / communityId.';
comment on column public.posts.mention_community_ids is
  'IPO communities the post mentions (mirrors mentions[kind=ipo].communityId), for indexed feed filters.';

-- ---------------------------------------------------------------- integrity

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
   where m ->> 'kind' = 'ipo';

  if not (from_json <@ new.mention_community_ids and new.mention_community_ids <@ from_json) then
    raise exception 'mention_community_ids must match the IPO mentions' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from unnest(new.mention_community_ids) as mentioned(cid)
    where not exists (select 1 from communities c where c.id = mentioned.cid)
  ) then
    raise exception 'A mentioned community does not exist' using errcode = 'foreign_key_violation';
  end if;

  if exists (
    select 1 from jsonb_array_elements(new.mentions) m
    where coalesce(m ->> 'kind', '') not in ('instrument', 'ipo')
       or jsonb_typeof(m -> 'start') <> 'number'
       or jsonb_typeof(m -> 'end') <> 'number'
       or (m ->> 'start')::int < 0
       or (m ->> 'end')::int <= (m ->> 'start')::int
       or (m ->> 'end')::int > char_length(new.body)
       or (m ->> 'kind' = 'instrument' and coalesce(m ->> 'id', '') = '')
  ) then
    raise exception 'A mention is malformed' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.check_post_mentions() from public, anon, authenticated;

drop trigger if exists posts_check_mentions on public.posts;
create trigger posts_check_mentions
  before insert or update of mentions, mention_community_ids, body on public.posts
  for each row execute function public.check_post_mentions();

-- A community someone mentioned stays (it is never deleted in normal use;
-- this keeps the references whole if anyone tries).
create or replace function public.protect_mentioned_communities()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from posts p where p.mention_community_ids @> array[old.id]) then
    raise exception 'Community % is mentioned by posts', old.id using errcode = 'foreign_key_violation';
  end if;
  return old;
end;
$$;

revoke all on function public.protect_mentioned_communities() from public, anon, authenticated;

drop trigger if exists communities_protect_mentions on public.communities;
create trigger communities_protect_mentions
  before delete on public.communities
  for each row execute function public.protect_mentioned_communities();

-- Privileges are unchanged: SELECT on posts already covers the new columns
-- for anon/authenticated; nobody but the service role can write them.

commit;

-- Rollback (mentions written since are lost; posts themselves are kept):
--   drop trigger if exists communities_protect_mentions on public.communities;
--   drop function if exists public.protect_mentioned_communities();
--   drop trigger if exists posts_check_mentions on public.posts;
--   drop function if exists public.check_post_mentions();
--   drop index if exists public.posts_mention_communities_idx;
--   alter table public.posts drop constraint if exists posts_mentions_shape,
--     drop constraint if exists posts_mention_communities_max,
--     drop column if exists mentions, drop column if exists mention_community_ids,
--     drop column if exists edited_at;
