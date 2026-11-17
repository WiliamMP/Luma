-- Profiles, message edits and replies, moderation. Run after 004_private_voice.sql:
-- Supabase > SQL Editor > paste > Run. Run it before installing the app version that uses it
-- (older versions ignore the new columns).

-- ───────── profiles: status line and "about me", live updates ─────────

alter table public.profiles
  add column status text not null default '' check (char_length(status) <= 60),
  add column bio text not null default '' check (char_length(bio) <= 190);

-- name/avatar/status changes reach everyone on screen right away
alter publication supabase_realtime add table public.profiles;

-- ───────── messages: edit and reply ─────────

alter table public.messages
  add column edited_at timestamptz,
  add column reply_to bigint references public.messages on delete set null;

-- authors change only the text of their own messages; edited_at is stamped by the database
revoke update on public.messages from authenticated, anon;
grant update (content) on public.messages to authenticated;
create policy "edit own messages" on public.messages for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

create function public.stamp_edit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.content is distinct from old.content then new.edited_at := now(); end if;
  return new;
end;
$$;
create trigger messages_stamp_edit before update on public.messages
  for each row execute function public.stamp_edit();

-- ───────── typing indicator ─────────
-- "typing:<channel or dm id>" is a private Realtime broadcast topic: only people who can read
-- that channel/DM can listen or send on it.

create function public.can_type(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.channels c
    where 'typing:' || c.id::text = topic and c.kind = 'text' and public.is_member(c.server_id)
  ) or exists (
    select 1 from public.dms d
    where 'typing:' || d.id::text = topic and auth.uid() in (d.user_a, d.user_b)
  );
$$;
grant execute on function public.can_type to authenticated;

create policy "typing receive" on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.can_type(realtime.topic()));

create policy "typing send" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and public.can_type(realtime.topic()));
