-- Private uploads.
-- Update the app to v0.3.1+ BEFORE running this: older versions expect public URLs and show broken images afterwards.
--
-- The bucket stops being public. messages.attachment_url and profiles.avatar_url now hold the
-- storage path ("<user id>/<uuid>-<name>") and the app asks for a signed URL (valid 1 h) to show it.
-- Who can read a file:
--   - its uploader;
--   - anyone who can read a message that has it attached (messages RLS: channel members / DM pair);
--   - any logged-in user, if it is someone's avatar.

update storage.buckets set public = false where id = 'uploads';

-- full public URLs -> paths
update public.messages set attachment_url = regexp_replace(attachment_url, '^.*/object/public/uploads/', '')
  where attachment_url like '%/object/public/uploads/%';
update public.profiles set avatar_url = regexp_replace(avatar_url, '^.*/object/public/uploads/', '')
  where avatar_url like '%/object/public/uploads/%';

-- the storage policy below looks messages up by path
create index messages_attachment_idx on public.messages (attachment_url) where attachment_url is not null;

-- the policy subqueries run as the caller, so messages RLS decides which attachments are visible
create policy "read own, attached and avatar files" on storage.objects for select to authenticated using (
  bucket_id = 'uploads' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.messages m where m.attachment_url = name)
    or exists (select 1 from public.profiles p where p.avatar_url = name)
  )
);

-- only your own files can be attached / used as avatar; otherwise pasting someone else's
-- path into a message or a profile would make that file readable
drop policy "send messages" on public.messages;
create policy "send messages" on public.messages for insert to authenticated
  with check (
    author_id = auth.uid() and public.can_access(channel_id, dm_id)
    and (attachment_url is null or split_part(attachment_url, '/', 1) = auth.uid()::text)
  );

drop policy "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and (avatar_url is null or split_part(avatar_url, '/', 1) = auth.uid()::text));
