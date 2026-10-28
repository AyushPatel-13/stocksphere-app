-- StockSphere · Photos on Community posts
--
-- Prepared for review; NOT applied.
--
-- What it adds:
--   1. Storage bucket `community-images`: public READ (posts are public, so
--      their photos are too, on every device), 4 MB per file, JPEG/PNG/WebP
--      only. Object names are `<uploader's user id>/<random uuid>.<ext>`, so
--      they can't be guessed or listed.
--   2. No storage policies for members: anon and authenticated can't upload,
--      overwrite or delete anything in the bucket. Every upload goes through
--      the server (/api/community/images), which checks the session, the
--      file's real bytes (not its name or claimed type), its size, and the
--      member's upload limits, then stores it with the service role.
--   3. public.community_uploads: the server's record of each upload, who made
--      it and which post (if any) it belongs to. Server-only (RLS on, no
--      policies, no grants). A post can only use uploads that are the
--      author's own and not already used.
--   4. posts.images: the post's photos ([{ path, width, height, alt }], at
--      most 4), written by the server like every other post column. Top-level
--      posts only.
--
-- Orphans: an upload not used by a post within 24 hours, or whose post was
-- deleted (post_id is cleared, attached_at stays), is removed from storage
-- by the cleanup job (/api/community/images/cleanup, Bearer CRON_SECRET).
-- Composers also remove their own unused uploads when an image is taken out
-- or a draft is discarded.
--
-- No existing data changes: images starts as [] on every post.
--
-- Rollback (removes the photos' records and links; empty the bucket first in
-- the dashboard, since Storage refuses to delete a bucket with objects):
--   alter table public.posts
--     drop constraint if exists posts_images_shape,
--     drop constraint if exists posts_comment_has_no_images,
--     drop column if exists images;
--   drop table if exists public.community_uploads;
--   delete from storage.buckets where id = 'community-images';

-- ---------------------------------------------------------------- 1. bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-images', 'community-images', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- 2. uploads
create table if not exists public.community_uploads (
  path text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  mime text not null,
  bytes integer not null,
  width integer not null,
  height integer not null,
  created_at timestamptz not null default now(),
  post_id uuid references public.posts (id) on delete set null,
  attached_at timestamptz,
  constraint community_uploads_path_shape check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  constraint community_uploads_owner_folder check (split_part(path, '/', 1) = user_id::text),
  constraint community_uploads_mime check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  constraint community_uploads_bytes check (bytes > 0 and bytes <= 4194304),
  constraint community_uploads_size check (width between 1 and 20000 and height between 1 and 20000)
);

-- Limits ("uploads in the last hour", "unused uploads") and the cleanup job.
create index if not exists community_uploads_user_recent_idx on public.community_uploads (user_id, created_at desc);
create index if not exists community_uploads_unused_idx on public.community_uploads (created_at) where post_id is null;

alter table public.community_uploads enable row level security;
revoke all on public.community_uploads from anon, authenticated;

-- ---------------------------------------------------------------- 3. posts.images
alter table public.posts
  add column if not exists images jsonb not null default '[]'::jsonb;

alter table public.posts
  add constraint posts_images_shape check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 4),
  add constraint posts_comment_has_no_images check (parent_id is null or images = '[]'::jsonb);

comment on column public.posts.images is 'Photos: [{ path, width, height, alt }], at most 4; paths are objects in the community-images bucket.';
comment on table public.community_uploads is 'Server-only record of Community photo uploads: owner, size and the post using it.';
