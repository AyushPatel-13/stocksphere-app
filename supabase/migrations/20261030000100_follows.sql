-- StockSphere · Follows
--
-- Members follow other members. Prepared for review; NOT applied.
--
-- follows (follower_id → followee_id): one row per follow, keyed by the
-- pair, so following twice is impossible. Nobody can follow themselves.
-- Both sides are profiles; deleting a profile removes its follows.
--
-- profiles.follower_count / following_count: kept by a trigger, the same
-- pattern as posts.like_count, so a profile shows its counts without
-- counting rows on every view. Clients can't write them: authenticated only
-- has UPDATE on avatar_url, bio, display_name and username.
--
-- Access, as for likes:
--   * anyone can read who follows whom (profiles and likes are public too);
--   * a signed-in member can follow and unfollow only as themselves;
--   * nobody can update a follow row; there is nothing to update.
--
-- No existing data changes: the counts start at 0 because no follows exist yet.
--
-- Rollback (drops only what this migration added; follows made since are lost):
--   drop trigger if exists follows_count on public.follows;
--   drop function if exists public.bump_follow_counts();
--   drop table if exists public.follows;
--   alter table public.profiles
--     drop constraint if exists profiles_follower_count_check,
--     drop constraint if exists profiles_following_count_check,
--     drop column if exists follower_count,
--     drop column if exists following_count;

-- ---------------------------------------------------------------- 1. table
create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);

-- "Who follows X", newest first (the primary key already serves "whom X follows").
create index if not exists follows_followee_idx on public.follows (followee_id, created_at desc);

-- ---------------------------------------------------------------- 2. counts
alter table public.profiles
  add column if not exists follower_count integer not null default 0,
  add column if not exists following_count integer not null default 0;

alter table public.profiles
  add constraint profiles_follower_count_check check (follower_count >= 0),
  add constraint profiles_following_count_check check (following_count >= 0);

-- Runs as the owner so it can update both profiles; search_path is pinned
-- so it can't be hijacked, and it isn't callable through /rest/v1/rpc.
create or replace function public.bump_follow_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update profiles set follower_count = follower_count + 1 where id = new.followee_id;
    update profiles set following_count = following_count + 1 where id = new.follower_id;
  else
    update profiles set follower_count = greatest(follower_count - 1, 0) where id = old.followee_id;
    update profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
  end if;
  return null;
end;
$$;

revoke all on function public.bump_follow_counts() from public, anon, authenticated;

drop trigger if exists follows_count on public.follows;
create trigger follows_count
  after insert or delete on public.follows
  for each row execute function public.bump_follow_counts();

-- ---------------------------------------------------------------- 3. access
revoke all on public.follows from anon, authenticated;
grant select on public.follows to anon, authenticated;
grant insert (follower_id, followee_id), delete on public.follows to authenticated;

alter table public.follows enable row level security;

drop policy if exists "follows are public" on public.follows;
create policy "follows are public"
  on public.follows for select
  using (true);

drop policy if exists "members follow as themselves" on public.follows;
create policy "members follow as themselves"
  on public.follows for insert
  to authenticated
  with check (follower_id = (select auth.uid()));

drop policy if exists "members unfollow as themselves" on public.follows;
create policy "members unfollow as themselves"
  on public.follows for delete
  to authenticated
  using (follower_id = (select auth.uid()));
