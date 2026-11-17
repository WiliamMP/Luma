-- Profiles, message edits, replies, reactions, typing indicator, owner moderation.
-- Applied automatically by .github/workflows/migrate.yml (supabase db push).

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

-- ───────── reactions ─────────
-- Kept on the message as {"👍": ["<user id>", ...]}, so they travel with the message's own
-- Realtime UPDATE events (RLS-filtered) and need no extra table or subscription.

alter table public.messages add column reactions jsonb not null default '{}' check (jsonb_typeof(reactions) = 'object');

-- clients insert only these columns; reactions/edited_at keep their defaults, so nobody can
-- forge reactions or an "(editado)" mark (or plant a value that breaks other people's app)
revoke insert on public.messages from authenticated, anon;
grant insert (channel_id, dm_id, content, attachment_url, reply_to) on public.messages to authenticated;

-- toggles my reaction; returns the message's new reactions
create function public.toggle_reaction(mid bigint, emoji text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid text := auth.uid()::text;
  cur jsonb;
  users jsonb;
  result jsonb;
begin
  -- same list as QUICK_EMOJI in src/components/Chat.tsx
  if emoji is null or not emoji = any (array['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀']) then
    raise exception 'invalid emoji';
  end if;
  select m.reactions into cur from public.messages m
    where m.id = mid and public.can_access(m.channel_id, m.dm_id) for update;
  if not found then raise exception 'message not found'; end if;

  users := coalesce(cur -> emoji, '[]'::jsonb);
  if users ? uid then
    users := users - uid;
  else
    if not (cur ? emoji) and (select count(*) from jsonb_object_keys(cur)) >= 20 then
      raise exception 'too many reactions';
    end if;
    users := users || to_jsonb(uid);
  end if;

  result := case when jsonb_array_length(users) = 0 then cur - emoji else jsonb_set(cur, array[emoji], users) end;
  update public.messages set reactions = result where id = mid;
  return result;
end;
$$;
revoke execute on function public.toggle_reaction from anon, public;
grant execute on function public.toggle_reaction to authenticated;

-- ───────── moderation ─────────
-- the server owner can delete any message in the server's channels (authors still delete their own)

create policy "owner deletes messages" on public.messages for delete to authenticated
  using (channel_id is not null and exists (
    select 1 from public.channels c where c.id = channel_id and public.is_owner(c.server_id)
  ));
