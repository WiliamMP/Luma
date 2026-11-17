-- Profiles, message edits and replies, moderation. Run after 004_private_voice.sql:
-- Supabase > SQL Editor > paste > Run. Run it before installing the app version that uses it
-- (older versions ignore the new columns).

-- ───────── profiles: status line and "about me", live updates ─────────

alter table public.profiles
  add column status text not null default '' check (char_length(status) <= 60),
  add column bio text not null default '' check (char_length(bio) <= 190);

-- name/avatar/status changes reach everyone on screen right away
alter publication supabase_realtime add table public.profiles;
