-- Private voice signalling.
-- Run it BEFORE publishing the app version that uses private voice channels: without these
-- policies that version cannot join a voice room. Older versions keep signalling on the public
-- topic, so old and new versions do not hear each other (the app only connects peers that
-- announce the same voice protocol version in presence).
--
-- Voice rooms exchange WebRTC offers/answers on the Realtime broadcast topic "voice:<channel id>".
-- As a private channel, Realtime checks these policies on realtime.messages: only members of the
-- server that owns the voice channel can listen to or send on its topic.

create function public.can_join_voice(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.channels c
    where 'voice:' || c.id::text = topic and c.kind = 'voice' and public.is_member(c.server_id)
  );
$$;
grant execute on function public.can_join_voice to authenticated;

create policy "voice members receive signals" on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.can_join_voice(realtime.topic()));

create policy "voice members send signals" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and public.can_join_voice(realtime.topic()));
