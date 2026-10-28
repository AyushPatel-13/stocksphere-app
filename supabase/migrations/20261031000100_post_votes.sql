-- StockSphere · Up/down votes on posts and comments (Community 2.0, M2)
--
-- Prepared for review; NOT applied.
--
-- post_votes (post_id, user_id, value): one vote per member per post or
-- comment (the primary key). value is +1 (up) or -1 (down). Changing a vote
-- updates the row; removing it deletes the row.
--
-- posts.up_count / down_count are kept by a trigger, the same pattern as
-- like_count. posts.score is up - down, a generated column, so it can't
-- drift. Votes are the ranking signal (Hot, Top). Likes stay what they are
-- and don't affect ranking.
--
-- Access, as for likes:
--   * anyone can read votes (scores are public, like likes);
--   * a signed-in member can vote, change or remove only their own vote,
--     and only on a post they can see (hidden posts and deleted-comment
--     placeholders can't be voted on);
--   * clients can't write the counts: authenticated has no UPDATE on posts.
--
-- No existing data changes: every count starts at 0.
--
-- Rollback (drops only what this migration added; votes cast since are lost):
--   drop trigger if exists post_votes_count on public.post_votes;
--   drop function if exists public.bump_vote_counts();
--   drop table if exists public.post_votes;
--   drop index if exists public.posts_score_idx;
--   alter table public.posts
--     drop column if exists score,
--     drop column if exists up_count,
--     drop column if exists down_count;

-- ---------------------------------------------------------------- 1. table
create table if not exists public.post_votes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  value smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, user_id),
  constraint post_votes_value check (value in (-1, 1))
);

-- "My votes on these posts", and recent votes (Trending, in the feed migration).
create index if not exists post_votes_user_idx on public.post_votes (user_id);
create index if not exists post_votes_recent_idx on public.post_votes (updated_at desc);

-- ---------------------------------------------------------------- 2. counts
alter table public.posts
  add column if not exists up_count integer not null default 0 check (up_count >= 0),
  add column if not exists down_count integer not null default 0 check (down_count >= 0);

alter table public.posts
  add column if not exists score integer generated always as (up_count - down_count) stored;

-- Top: highest score first, newest breaking ties (top-level posts).
create index if not exists posts_score_idx on public.posts (score desc, created_at desc) where parent_id is null;

-- Runs as the owner so it can update the post; search_path is pinned and it
-- isn't callable through /rest/v1/rpc.
create or replace function public.bump_vote_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update posts
       set up_count = greatest(up_count - (old.value = 1)::int, 0),
           down_count = greatest(down_count - (old.value = -1)::int, 0)
     where id = old.post_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update posts
       set up_count = up_count + (new.value = 1)::int,
           down_count = down_count + (new.value = -1)::int
     where id = new.post_id;
  end if;
  return null;
end;
$$;

revoke all on function public.bump_vote_counts() from public, anon, authenticated;

drop trigger if exists post_votes_count on public.post_votes;
create trigger post_votes_count
  after insert or delete or update of value on public.post_votes
  for each row execute function public.bump_vote_counts();

-- A changed vote records when it changed (Trending counts recent votes).
create or replace function public.touch_vote()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_vote() from public, anon, authenticated;

drop trigger if exists post_votes_touch on public.post_votes;
create trigger post_votes_touch
  before update on public.post_votes
  for each row execute function public.touch_vote();

-- ---------------------------------------------------------------- 3. access
revoke all on public.post_votes from anon, authenticated;
grant select on public.post_votes to anon, authenticated;
grant insert (post_id, user_id, value), update (value), delete on public.post_votes to authenticated;

alter table public.post_votes enable row level security;

drop policy if exists "votes are public" on public.post_votes;
create policy "votes are public"
  on public.post_votes for select
  using (true);

-- The posts subquery runs under the voter's own RLS, so a hidden post isn't found.
drop policy if exists "members vote as themselves" on public.post_votes;
create policy "members vote as themselves"
  on public.post_votes for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and p.deleted_at is null)
  );

drop policy if exists "members change their own vote" on public.post_votes;
create policy "members change their own vote"
  on public.post_votes for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "members remove their own vote" on public.post_votes;
create policy "members remove their own vote"
  on public.post_votes for delete
  to authenticated
  using (user_id = (select auth.uid()));
