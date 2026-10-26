-- StockSphere · Threaded comments: replies to replies, at any depth
--
-- Requires 20261019000300_posts.sql, 20261024000200_communities.sql and
-- 20261026000100_post_mentions.sql.
--
-- Why
--   Comments are already rows in public.posts: a top-level post has
--   parent_id NULL, a comment has parent_id = the post it answers. Until now
--   the app only allowed one level (a reply to a reply was refused). This
--   lets a comment answer another comment, Reddit-style, without a second
--   comment system: parent_id stays the DIRECT parent, and a new root_id
--   names the top-level post the whole thread belongs to.
--
-- What changes
--   posts.root_id        the thread's top-level post (NULL on a top-level
--                        post). Set by the database from the parent, never
--                        from the client, so a reply can't land in another
--                        post's thread. Backfilled for existing replies.
--   posts.comment_count  on a top-level post: every comment in its thread,
--                        at any depth (reply_count stays "direct replies"
--                        on every row, as before). Kept by the counter trigger.
--   posts.deleted_at     a comment deleted while others replied to it stays
--                        as a "[deleted]" placeholder so their replies keep
--                        their context; a comment nobody answered is removed
--                        as before. Deleting a top-level post still removes
--                        its whole thread (unchanged).
--   posts_root_idx       loads a thread in one indexed query.
--
-- Integrity
--   * parent_id and root_id can't change once set, and a post can't be its
--     own parent — with the parent existing before its child, no cycle can
--     form.
--   * (parent_id IS NULL) = (root_id IS NULL), checked.
--   * A reply's community is still its parent's (posts_inherit_community).
--
-- Security model (unchanged): anon/authenticated may only SELECT posts and
-- DELETE their own; every insert/edit is the app server (service role) after
-- its checks. No comment id, like, report or body is changed by this
-- migration except root_id / comment_count being filled in. Safe to re-run.
-- Rollback notes at the bottom.

begin;

-- ---------------------------------------------------------------- columns

alter table public.posts add column if not exists root_id uuid references public.posts (id) on delete cascade;
alter table public.posts add column if not exists comment_count integer not null default 0;
alter table public.posts add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_comment_count_check' and conrelid = 'public.posts'::regclass) then
    alter table public.posts add constraint posts_comment_count_check check (comment_count >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'posts_not_own_parent' and conrelid = 'public.posts'::regclass) then
    alter table public.posts add constraint posts_not_own_parent check (parent_id is distinct from id and root_id is distinct from id);
  end if;
end $$;

comment on column public.posts.parent_id is
  'The post or comment this one directly answers. NULL for a top-level post.';
comment on column public.posts.root_id is
  'The top-level post this comment''s thread belongs to (NULL for a top-level post). Set by the database from the parent.';
comment on column public.posts.comment_count is
  'On a top-level post: comments in its thread at any depth. reply_count counts direct replies only.';
comment on column public.posts.deleted_at is
  'Set when a comment with replies was deleted: it stays as a "[deleted]" placeholder so the replies keep their place.';

-- ---------------------------------------------------------------- backfill
-- Existing replies are one level deep; the recursive walk also covers any
-- deeper row, so every comment gets its real top-level post.

with recursive chain as (
  select id, id as root from public.posts where parent_id is null
  union all
  select p.id, chain.root from public.posts p join chain on p.parent_id = chain.id
)
update public.posts p
   set root_id = chain.root
  from chain
 where p.id = chain.id and p.parent_id is not null and p.root_id is distinct from chain.root;

update public.posts p
   set comment_count = (select count(*) from public.posts c where c.root_id = p.id)
 where p.parent_id is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_root_matches_parent' and conrelid = 'public.posts'::regclass) then
    alter table public.posts add constraint posts_root_matches_parent check ((parent_id is null) = (root_id is null));
  end if;
end $$;

create index if not exists posts_root_idx on public.posts (root_id, created_at) where root_id is not null;

-- ---------------------------------------------------------------- thread placement
-- A comment's thread is its parent's, whatever the writer sent.

create or replace function public.posts_place_in_thread()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent record;
begin
  if tg_op = 'UPDATE' then
    if new.parent_id is distinct from old.parent_id or new.root_id is distinct from old.root_id then
      raise exception 'A comment can''t move to another parent or thread' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.parent_id is null then
    new.root_id := null;
    return new;
  end if;

  select p.id, p.root_id into parent from posts p where p.id = new.parent_id;
  if not found then
    raise exception 'The comment being answered does not exist' using errcode = 'foreign_key_violation';
  end if;
  new.root_id := coalesce(parent.root_id, parent.id);
  return new;
end;
$$;

revoke all on function public.posts_place_in_thread() from public, anon, authenticated;

drop trigger if exists posts_place_in_thread on public.posts;
create trigger posts_place_in_thread
  before insert or update of parent_id, root_id on public.posts
  for each row execute function public.posts_place_in_thread();

-- ---------------------------------------------------------------- counters
-- As before, plus the top-level post's comment_count.

create or replace function public.bump_post_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'post_likes' then
    if tg_op = 'INSERT' then
      update posts set like_count = like_count + 1 where id = new.post_id;
    else
      update posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
    end if;
  elsif tg_table_name = 'posts' then
    if tg_op = 'INSERT' and new.parent_id is not null then
      update posts set reply_count = reply_count + 1 where id = new.parent_id;
      update posts set comment_count = comment_count + 1 where id = new.root_id;
    elsif tg_op = 'DELETE' and old.parent_id is not null then
      update posts set reply_count = greatest(reply_count - 1, 0) where id = old.parent_id;
      update posts set comment_count = greatest(comment_count - 1, 0) where id = old.root_id;
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.bump_post_counts() from public, anon, authenticated;

-- ---------------------------------------------------------------- deleting a comment
-- A comment others replied to becomes a placeholder instead of taking their
-- replies with it: the text, mentions and symbols are erased, the row (and
-- its place in the thread) stays. While the thread itself is being deleted
-- (its top-level post is gone) everything is removed as before.
-- SECURITY DEFINER because members may delete but not update; it only
-- touches the row whose delete RLS already allowed.

create or replace function public.posts_keep_answered_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.root_id is not null
     and exists (select 1 from posts where id = old.root_id)
     and exists (select 1 from posts where parent_id = old.id) then
    update posts
       set body = '[deleted]', mentions = '[]', mention_community_ids = '{}', symbols = '{}', deleted_at = coalesce(deleted_at, now())
     where id = old.id;
    return null;
  end if;
  return old;
end;
$$;

revoke all on function public.posts_keep_answered_comment() from public, anon, authenticated;

drop trigger if exists posts_keep_answered_comment on public.posts;
create trigger posts_keep_answered_comment
  before delete on public.posts
  for each row execute function public.posts_keep_answered_comment();

commit;

-- Rollback (threads deeper than one level lose their nesting; nothing else is lost):
--   drop trigger if exists posts_keep_answered_comment on public.posts;
--   drop function if exists public.posts_keep_answered_comment();
--   drop trigger if exists posts_place_in_thread on public.posts;
--   drop function if exists public.posts_place_in_thread();
--   -- deeper replies hang off the top-level post again, so the old one-level UI shows them:
--   update public.posts set parent_id = root_id where root_id is not null and parent_id <> root_id;
--   -- then re-run 20261019000300_posts.sql's bump_post_counts() and:
--   alter table public.posts drop constraint if exists posts_root_matches_parent,
--     drop constraint if exists posts_not_own_parent, drop constraint if exists posts_comment_count_check;
--   drop index if exists public.posts_root_idx;
--   alter table public.posts drop column if exists comment_count, drop column if exists root_id;
--   -- deleted_at: placeholders keep body '[deleted]'; drop the column once that is acceptable:
--   alter table public.posts drop column if exists deleted_at;
--   (re-count reply_count afterwards: update posts p set reply_count = (select count(*) from posts c where c.parent_id = p.id);)
