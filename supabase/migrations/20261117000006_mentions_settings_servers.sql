-- Mention counts in the unread badges, settings that follow the account, live server name/icon.

-- ───────── unread_counts(): also count messages that @mention me ─────────
-- Same rule as mentions() in src/format.tsx: "@name" not glued to a word before it, and not
-- followed by a letter/digit or by ".x" (so "valeu @will." counts but "@will.dev" does not).

drop function public.unread_counts();
create function public.unread_counts() returns table (target uuid, server_id uuid, unread bigint, mentions bigint)
language sql stable security invoker set search_path = '' as $$
  with me as (
    select '(^|[^\w.])@' || regexp_replace(p.username, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '(?!\w|\.\w)' as pattern
    from public.profiles p
    where p.id = auth.uid()
  )
  select coalesce(m.channel_id, m.dm_id), c.server_id, count(*),
         count(*) filter (where m.content ~* (select pattern from me))
  from public.messages m
  left join public.channels c on c.id = m.channel_id
  left join public.reads r on r.user_id = auth.uid() and r.target = coalesce(m.channel_id, m.dm_id)
  where m.author_id <> auth.uid() and m.id > coalesce(r.last_id, 0)
  group by 1, 2;
$$;
revoke execute on function public.unread_counts from anon, public;
grant execute on function public.unread_counts to authenticated;

-- ───────── settings that follow the account ─────────
-- One JSON object per user: muted servers, chosen status, per-person volumes.
-- (The microphone stays per device: device ids mean nothing on another computer.)

create table public.settings (
  user_id uuid primary key default auth.uid() references public.profiles on delete cascade,
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object' and octet_length(data::text) < 65536),
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
create policy "own settings" on public.settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────── servers in Realtime ─────────
-- Rename / new icon reach members right away. servers has column-level SELECT grants;
-- Realtime only sends the columns the subscriber may select (invite_code stays hidden).

alter publication supabase_realtime add table public.servers;
