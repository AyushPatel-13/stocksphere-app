-- StockSphere · Notifications for new followers and reposts (Community 2.0, Stage 5)
--
-- Follows and reposts are written by members straight to Supabase (RLS
-- allows exactly their own rows), so the server never sees them happen.
-- These triggers put a notification in the existing notifications table
-- (kind 'community', shown by the navbar bell and on /alerts):
--   "@ravi started following you"   → /profile/ravi
--   "@ravi reposted your post"      → /community/post/<id>
--
-- Never for yourself (you can't follow yourself; reposting your own post
-- tells nobody). The same notification isn't repeated within 24 hours, so
-- following and unfollowing over and over can't flood anyone.
--
-- Runs as the owner (it writes another member's notification), with
-- search_path pinned, and isn't callable through /rest/v1/rpc. A failure
-- to notify never blocks the follow or repost itself.
--
-- Rollback:
--   drop trigger if exists follows_notify on public.follows;
--   drop trigger if exists reposts_notify on public.reposts;
--   drop function if exists public.notify_follow();
--   drop function if exists public.notify_repost();
--   drop function if exists public.notify_community(uuid, text, text);

create or replace function public.notify_community(p_user uuid, p_title text, p_link text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from notifications n
     where n.user_id = p_user and n.title = p_title and n.link = p_link and n.created_at > now() - interval '24 hours'
  ) then
    return;
  end if;
  insert into notifications (user_id, kind, title, link) values (p_user, 'community', left(p_title, 140), p_link);
exception when others then
  -- Telling someone is a courtesy; it must never undo the follow or repost.
  raise warning 'community notification skipped: %', sqlerrm;
end;
$$;

revoke all on function public.notify_community(uuid, text, text) from public, anon, authenticated;

create or replace function public.notify_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  handle text;
begin
  select username into handle from profiles where id = new.follower_id;
  if handle is not null and new.followee_id <> new.follower_id then
    perform notify_community(new.followee_id, '@' || handle || ' started following you', '/profile/' || handle);
  end if;
  return null;
end;
$$;

revoke all on function public.notify_follow() from public, anon, authenticated;

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify
  after insert on public.follows
  for each row execute function public.notify_follow();

create or replace function public.notify_repost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  handle text;
  owner uuid;
begin
  select author_id into owner from posts where id = new.post_id;
  select username into handle from profiles where id = new.user_id;
  if owner is not null and handle is not null and owner <> new.user_id then
    perform notify_community(owner, '@' || handle || ' reposted your post', '/community/post/' || new.post_id::text);
  end if;
  return null;
end;
$$;

revoke all on function public.notify_repost() from public, anon, authenticated;

drop trigger if exists reposts_notify on public.reposts;
create trigger reposts_notify
  after insert on public.reposts
  for each row execute function public.notify_repost();
