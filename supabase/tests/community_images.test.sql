-- StockSphere · Community photos: integrity and access test
--
-- Proves migrations/20261102000100_community_images.sql. One transaction
-- ending in ROLLBACK, so nothing is saved. Success prints
-- "ALL COMMUNITY IMAGE CHECKS PASSED".

begin;

do $$
begin
  if not exists (
    select 1 from storage.buckets
     where id = 'community-images' and public and file_size_limit = 4194304
       and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp'] and cardinality(allowed_mime_types) = 3
  ) then
    raise exception 'FAIL: bucket missing or misconfigured';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and (qual like '%community-images%' or with_check like '%community-images%')) then
    raise exception 'FAIL: a storage policy lets clients write community images';
  end if;
end $$;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000a9', 'authenticated', 'authenticated', 'images-test-a@example.invalid');
insert into public.profiles (id, username, display_name) values
  ('00000000-0000-4000-8000-0000000000a9', 'images_test_a', 'A');

do $$
declare
  rejected boolean;
begin
  -- A valid upload record, in the uploader's own folder.
  insert into public.community_uploads (path, user_id, mime, bytes, width, height) values
    ('00000000-0000-4000-8000-0000000000a9/11111111-1111-4111-8111-111111111111.jpg', '00000000-0000-4000-8000-0000000000a9', 'image/jpeg', 1000, 800, 600);

  -- Someone else's folder.
  rejected := false;
  begin
    insert into public.community_uploads (path, user_id, mime, bytes, width, height) values
      ('99999999-9999-4999-8999-999999999999/22222222-2222-4222-8222-222222222222.jpg', '00000000-0000-4000-8000-0000000000a9', 'image/jpeg', 1000, 800, 600);
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: an upload was recorded in another member''s folder'; end if;

  -- Wrong type, too big, odd names.
  rejected := false;
  begin
    insert into public.community_uploads (path, user_id, mime, bytes, width, height) values
      ('00000000-0000-4000-8000-0000000000a9/33333333-3333-4333-8333-333333333333.gif', '00000000-0000-4000-8000-0000000000a9', 'image/gif', 1000, 10, 10);
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a GIF was accepted'; end if;

  rejected := false;
  begin
    insert into public.community_uploads (path, user_id, mime, bytes, width, height) values
      ('00000000-0000-4000-8000-0000000000a9/44444444-4444-4444-8444-444444444444.png', '00000000-0000-4000-8000-0000000000a9', 'image/png', 4194305, 10, 10);
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a file over 4 MB was accepted'; end if;

  rejected := false;
  begin
    insert into public.community_uploads (path, user_id, mime, bytes, width, height) values
      ('00000000-0000-4000-8000-0000000000a9/../evil.png', '00000000-0000-4000-8000-0000000000a9', 'image/png', 10, 10, 10);
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a path outside the naming scheme was accepted'; end if;

  -- Posts: at most 4 images, none on comments.
  insert into public.posts (id, author_id, body, images) values
    ('00000000-0000-4000-8000-00000000a900', '00000000-0000-4000-8000-0000000000a9', 'With a photo',
     '[{"path":"00000000-0000-4000-8000-0000000000a9/11111111-1111-4111-8111-111111111111.jpg","width":800,"height":600,"alt":""}]');

  rejected := false;
  begin
    insert into public.posts (author_id, body, images) values
      ('00000000-0000-4000-8000-0000000000a9', 'Too many', '[{},{},{},{},{}]');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: five images were accepted'; end if;

  rejected := false;
  begin
    insert into public.posts (author_id, body, parent_id, images) values
      ('00000000-0000-4000-8000-0000000000a9', 'A comment', '00000000-0000-4000-8000-00000000a900', '[{}]');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a comment took an image'; end if;

  -- Deleting the post detaches its upload (for the cleanup job) instead of losing the record.
  update public.community_uploads set post_id = '00000000-0000-4000-8000-00000000a900', attached_at = now()
   where path = '00000000-0000-4000-8000-0000000000a9/11111111-1111-4111-8111-111111111111.jpg';
  delete from public.posts where id = '00000000-0000-4000-8000-00000000a900';
  if not exists (
    select 1 from public.community_uploads
     where path = '00000000-0000-4000-8000-0000000000a9/11111111-1111-4111-8111-111111111111.jpg' and post_id is null and attached_at is not null
  ) then
    raise exception 'FAIL: a deleted post''s upload wasn''t left for cleanup';
  end if;
end $$;

-- Members and visitors can't touch upload records.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a9", "role": "authenticated"}';
do $$
declare
  rejected boolean := false;
begin
  begin
    perform 1 from public.community_uploads;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a member could read upload records'; end if;
end $$;
reset role;

set local role anon;
do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.community_uploads (path, user_id, mime, bytes, width, height) values
      ('00000000-0000-4000-8000-0000000000a9/55555555-5555-4555-8555-555555555555.jpg', '00000000-0000-4000-8000-0000000000a9', 'image/jpeg', 10, 10, 10);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a visitor could record an upload'; end if;
end $$;
reset role;

select 'ALL COMMUNITY IMAGE CHECKS PASSED' as result;

rollback;
