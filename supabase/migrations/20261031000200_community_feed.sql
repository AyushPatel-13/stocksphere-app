-- StockSphere · Ranked community feeds (Community 2.0, M4)
--
-- Prepared for review; NOT applied. Needs, in order:
--   20261029000100_post_titles_and_kinds (posts.kind)
--   20261031000100_post_votes            (posts.score, post_votes)
--
-- community_feed(...) returns one page of top-level post ids in rank order;
-- the app then reads those posts with its normal select (one more query,
-- never one per post). It runs as the caller (SECURITY INVOKER), so RLS
-- still decides what's visible: hidden posts never rank.
--
-- One scoring model per sort:
--   new        newest first
--   top        score (up - down votes), within p_since if given
--   discussed  comment_count (every depth), within p_since if given
--   hot        Reddit's: sign(score)·log10(max(|score|,1)) + epoch/45000,
--              i.e. 10x the votes ≈ 12.5 hours newer. Posts by p_boost_authors
--              or about p_boost_symbols get +1 (For You: people you follow
--              and stocks you watch rank as if ~12.5 h newer).
--   trending   engagement in the last 24 h (up-votes + likes + 2 × comments
--              made in that window) on posts from the last 72 h; posts with
--              none are left out rather than padded.
--
-- Filters (all optional): p_any_authors / p_any_symbols / p_any_community
-- keep posts matching ANY of them (Following: people + watched stocks; a
-- stock board: its symbols + its community). p_sentiment, p_kind and
-- p_exchange (a verified instrument mention on that exchange) narrow further.
--
-- Pages: p_limit is capped at 50 and p_offset at 1000.
--
-- Rollback:
--   drop function if exists public.community_feed(text, timestamptz, uuid[], text[], uuid, uuid[], text[], text, text, text, integer, integer);
--   drop index if exists public.posts_discussed_idx;

create index if not exists posts_discussed_idx
  on public.posts (comment_count desc, created_at desc)
  where parent_id is null;

create or replace function public.community_feed(
  p_sort text,
  p_since timestamptz default null,
  p_any_authors uuid[] default null,
  p_any_symbols text[] default null,
  p_any_community uuid default null,
  p_boost_authors uuid[] default null,
  p_boost_symbols text[] default null,
  p_sentiment text default null,
  p_kind text default null,
  p_exchange text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (post_id uuid, post_rank double precision)
language sql
stable
security invoker
set search_path = public
as $$
  with candidates as (
    select p.id, p.created_at, p.score, p.comment_count, p.author_id, p.symbols
      from posts p
     where p.parent_id is null
       and (p_since is null or p.created_at >= p_since)
       and (p_sort <> 'trending' or p.created_at >= now() - interval '72 hours')
       and (p_sentiment is null or p.sentiment = p_sentiment)
       and (p_kind is null or p.kind = p_kind)
       and (p_exchange is null or p.mentions @> jsonb_build_array(jsonb_build_object('kind', 'instrument', 'exchange', p_exchange)))
       and (
         (p_any_authors is null and p_any_symbols is null and p_any_community is null)
         or p.author_id = any (p_any_authors)
         or p.symbols && p_any_symbols
         or p.community_id = p_any_community
         or p.mention_community_ids @> array[p_any_community]
       )
  ),
  engagement as (
    select c.id,
           (select count(*) from post_votes v where v.post_id = c.id and v.value = 1 and v.updated_at >= now() - interval '24 hours')
         + (select count(*) from post_likes l where l.post_id = c.id and l.created_at >= now() - interval '24 hours')
         + 2 * (select count(*) from posts r where r.root_id = c.id and r.created_at >= now() - interval '24 hours') as recent
      from candidates c
     where p_sort = 'trending'
  ),
  ranked as (
    select c.id,
           c.created_at,
           e.recent,
           case p_sort
             when 'new' then extract(epoch from c.created_at)::double precision
             when 'top' then c.score::double precision
             when 'discussed' then c.comment_count::double precision
             when 'trending' then coalesce(e.recent, 0)::double precision
             else sign(c.score::double precision) * log(greatest(abs(c.score), 1)::double precision)
                  + extract(epoch from c.created_at)::double precision / 45000.0
                  + case when c.author_id = any (p_boost_authors) or c.symbols && p_boost_symbols then 1.0 else 0.0 end
           end as rank
      from candidates c
      left join engagement e on e.id = c.id
  )
  select r.id, r.rank
    from ranked r
   where p_sort <> 'trending' or r.recent > 0
   order by r.rank desc, r.created_at desc, r.id desc
   limit least(greatest(p_limit, 1), 50)
  offset least(greatest(p_offset, 0), 1000);
$$;

revoke all on function public.community_feed(text, timestamptz, uuid[], text[], uuid, uuid[], text[], text, text, text, integer, integer) from public;
grant execute on function public.community_feed(text, timestamptz, uuid[], text[], uuid, uuid[], text[], text, text, text, integer, integer) to anon, authenticated, service_role;
