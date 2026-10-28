-- Optional titles and post types for top-level Community posts.
--
-- title: a short headline (1-120 characters after trimming, one line).
-- kind:  what sort of post it is: analysis, technical (technical
--        analysis), earnings, news, question or discussion.
--
-- Both are nullable: existing posts, and new posts that skip them, keep
-- working unchanged. Comments (parent_id set) never carry either; the
-- server already refuses them, and these constraints make sure.
--
-- Writes still go only through the server (service role); clients have no
-- INSERT/UPDATE grants on posts, and the existing "visible posts are public"
-- SELECT policy covers the new columns. No data is changed.
--
-- Rollback (drops only what this migration added; titles and types written
-- since are lost, the posts themselves are kept):
--   drop index if exists public.posts_kind_feed_idx;
--   alter table public.posts
--     drop constraint if exists posts_title_shape,
--     drop constraint if exists posts_kind_values,
--     drop constraint if exists posts_comment_has_no_title,
--     drop column if exists title,
--     drop column if exists kind;

alter table public.posts
  add column if not exists title text,
  add column if not exists kind text;

alter table public.posts
  add constraint posts_title_shape check (
    title is null
    or (char_length(btrim(title)) between 1 and 120 and title !~ '[\r\n]')
  ),
  add constraint posts_kind_values check (
    kind is null or kind in ('analysis', 'technical', 'earnings', 'news', 'question', 'discussion')
  ),
  add constraint posts_comment_has_no_title check (
    parent_id is null or (title is null and kind is null)
  );

-- The floor's "by type" filter: newest top-level posts of one kind.
create index if not exists posts_kind_feed_idx
  on public.posts (kind, created_at desc)
  where parent_id is null and kind is not null;

comment on column public.posts.title is 'Optional headline of a top-level post (1-120 chars, one line).';
comment on column public.posts.kind is 'Optional post type: analysis | technical | earnings | news | question | discussion.';
