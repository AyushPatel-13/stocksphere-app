-- StockSphere · Reposts, quote posts and bookmarks (Community 2.0, M3)
--
-- Prepared for review; NOT applied.
--
-- reposts (user_id, post_id): a member shares a top-level post to their
--   followers, once (the primary key). It's a reference, not a copy: no
--   empty posts, and the original's text, votes and comments stay its own.
--   posts.repost_count is kept by a trigger.
-- posts.quote_of: a quote post is an ordinary post (the quoter's own text,
--   rules, rate limits) that points at the post it quotes. If the original
--   is deleted the link clears (the quote stays, as a plain post); if a
--   moderator hides it, the quote shows "original unavailable".
--   Written only by the server, which checks the quoted post is visible and
--   top-level, like every other post column.
-- bookmarks (user_id, post_id): private saves. Only the member can see,
--   add or remove their own; nobody else, not even counts.
--
-- Access:
--   * reposts are public (like likes); members repost and undo only as
--     themselves, only posts they can see, never comments or deleted ones;
--   * bookmarks are owner-only for every action;
--   * clients can't write repost_count or quote_of (no UPDATE/INSERT grant
--     on posts; posts are written by the server).
--
-- No existing data changes: counts start at 0, quote_of is null.
--
-- Rollback (drops only what this migration added; reposts, quotes' links
-- and bookmarks made since are lost):
--   drop trigger if exists reposts_count on public.reposts;
--   drop function if exists public.bump_repost_count();
--   drop table if exists public.reposts;
--   drop table if exists public.bookmarks;
--   drop index if exists public.posts_quote_of_idx;
--   alter table public.posts
--     drop constraint if exists posts_quote_not_self,
--     drop column if exists quote_of,
--     drop column if exists repost_count;

-- ---------------------------------------------------------------- 1. reposts
create table if not exists public.reposts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- "Who reposted this" and a profile's Reposts tab, newest first.
create index if not exists reposts_post_idx on public.reposts (post_id);
create index if not exists reposts_user_recent_idx on public.reposts (user_id, created_at desc);

alter table public.posts
  add column if not exists repost_count integer not null default 0 check (repost_count >= 0);

create or replace function public.bump_repost_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update posts set repost_count = repost_count + 1 where id = new.post_id;
  else
    update posts set repost_count = greatest(repost_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;

revoke all on function public.bump_repost_count() from public, anon, authenticated;

drop trigger if exists reposts_count on public.reposts;
create trigger reposts_count
  after insert or delete on public.reposts
  for each row execute function public.bump_repost_count();

revoke all on public.reposts from anon, authenticated;
grant select on public.reposts to anon, authenticated;
grant insert (user_id, post_id), delete on public.reposts to authenticated;

alter table public.reposts enable row level security;

drop policy if exists "reposts are public" on public.reposts;
create policy "reposts are public"
  on public.reposts for select
  using (true);

-- The posts subquery runs under the member's own RLS, so a hidden post isn't found.
drop policy if exists "members repost as themselves" on public.reposts;
create policy "members repost as themselves"
  on public.reposts for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and p.parent_id is null and p.deleted_at is null)
  );

drop policy if exists "members undo their own reposts" on public.reposts;
create policy "members undo their own reposts"
  on public.reposts for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- 2. quote posts
alter table public.posts
  add column if not exists quote_of uuid references public.posts (id) on delete set null;

alter table public.posts
  add constraint posts_quote_not_self check (quote_of is distinct from id);

-- "Quotes of this post".
create index if not exists posts_quote_of_idx on public.posts (quote_of) where quote_of is not null;

-- ---------------------------------------------------------------- 3. bookmarks
create table if not exists public.bookmarks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists bookmarks_user_recent_idx on public.bookmarks (user_id, created_at desc);

revoke all on public.bookmarks from anon, authenticated;
grant select, delete on public.bookmarks to authenticated;
grant insert (user_id, post_id) on public.bookmarks to authenticated;

alter table public.bookmarks enable row level security;

drop policy if exists "members see their own bookmarks" on public.bookmarks;
create policy "members see their own bookmarks"
  on public.bookmarks for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "members bookmark as themselves" on public.bookmarks;
create policy "members bookmark as themselves"
  on public.bookmarks for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and p.deleted_at is null)
  );

drop policy if exists "members remove their own bookmarks" on public.bookmarks;
create policy "members remove their own bookmarks"
  on public.bookmarks for delete
  to authenticated
  using (user_id = (select auth.uid()));
