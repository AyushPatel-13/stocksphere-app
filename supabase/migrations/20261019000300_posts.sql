-- StockSphere · Phase 2 · Community posts, replies, likes and reports
--
-- Requires 20261019000100_profiles.sql (every post has a profile as author).
--
-- Security model
--   * Posts are PUBLIC to read (anyone, signed in or not), except posts a
--     moderator has hidden.
--   * Users can NOT insert or edit posts directly. New posts go through the
--     app's server (/api/community/posts), which checks the author's session,
--     applies rate limits and spam rules, then writes with the service role.
--     So there is no INSERT/UPDATE policy for anon or authenticated.
--   * Authors may DELETE their own posts.
--   * Likes: a user may add/remove only their own like. Counts are kept by a
--     trigger, never written by clients.
--   * Reports: a user may file a report as themselves; nobody but the service
--     role (moderation) can read reports.
--
-- Review before applying. Safe to re-run.

-- ---------------------------------------------------------------- posts

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,

  body text not null
    constraint posts_body_length check (char_length(btrim(body)) between 1 and 1000),

  -- 'bullish' / 'bearish' / NULL (no stance). Replies never carry one.
  sentiment text
    constraint posts_sentiment_values check (sentiment in ('bullish', 'bearish')),

  -- Stocks the post is about: the board it was posted on plus any $CASHTAGS,
  -- uppercase, at most 5.
  symbols text[] not null default '{}'
    constraint posts_symbols_max check (cardinality(symbols) <= 5),

  parent_id uuid references public.posts (id) on delete cascade,

  like_count integer not null default 0 check (like_count >= 0),
  reply_count integer not null default 0 check (reply_count >= 0),

  -- Set by moderators (service role) only.
  hidden boolean not null default false,
  hidden_reason text,

  created_at timestamptz not null default now(),

  constraint posts_reply_has_no_sentiment check (parent_id is null or sentiment is null)
);

create index if not exists posts_created_idx on public.posts (created_at desc) where parent_id is null;
create index if not exists posts_symbols_idx on public.posts using gin (symbols);
create index if not exists posts_parent_idx on public.posts (parent_id, created_at);
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);

comment on table public.posts is
  'Community posts and replies. Public read (unless hidden); written only by the app server (service role); authors may delete their own.';

-- ---------------------------------------------------------------- likes

create table if not exists public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_likes_user_idx on public.post_likes (user_id);

-- ---------------------------------------------------------------- reports

create table if not exists public.post_reports (
  post_id uuid not null references public.posts (id) on delete cascade,
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reason text not null default 'spam'
    constraint post_reports_reason check (reason in ('spam', 'tips', 'abuse', 'scam', 'other')),
  created_at timestamptz not null default now(),
  primary key (post_id, reporter_id)
);

-- ---------------------------------------------------------------- counters
-- SECURITY DEFINER so the counts can be maintained even though clients have
-- no UPDATE on posts. search_path is pinned so the function cannot be hijacked.

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
    elsif tg_op = 'DELETE' and old.parent_id is not null then
      update posts set reply_count = greatest(reply_count - 1, 0) where id = old.parent_id;
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.bump_post_counts() from public, anon, authenticated;

drop trigger if exists post_likes_count on public.post_likes;
create trigger post_likes_count
  after insert or delete on public.post_likes
  for each row execute function public.bump_post_counts();

drop trigger if exists posts_reply_count on public.posts;
create trigger posts_reply_count
  after insert or delete on public.posts
  for each row execute function public.bump_post_counts();

-- ---------------------------------------------------------------- privileges

revoke all on public.posts, public.post_likes, public.post_reports from anon, authenticated;

grant select on public.posts to anon, authenticated;
grant delete on public.posts to authenticated;

grant select on public.post_likes to anon, authenticated;
grant insert (post_id, user_id), delete on public.post_likes to authenticated;

grant insert (post_id, reporter_id, reason) on public.post_reports to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_reports enable row level security;

drop policy if exists "visible posts are public" on public.posts;
create policy "visible posts are public"
  on public.posts for select
  to anon, authenticated
  using (not hidden);

drop policy if exists "authors delete their own posts" on public.posts;
create policy "authors delete their own posts"
  on public.posts for delete
  to authenticated
  using (author_id = (select auth.uid()));

drop policy if exists "likes are public" on public.post_likes;
create policy "likes are public"
  on public.post_likes for select
  to anon, authenticated
  using (true);

drop policy if exists "users like as themselves" on public.post_likes;
create policy "users like as themselves"
  on public.post_likes for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "users unlike their own likes" on public.post_likes;
create policy "users unlike their own likes"
  on public.post_likes for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users report as themselves" on public.post_reports;
create policy "users report as themselves"
  on public.post_reports for insert
  to authenticated
  with check (reporter_id = (select auth.uid()));

-- No select policy on post_reports: only the service role (moderation) reads them.
