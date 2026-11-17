-- Unread badges. Run after schema.sql: Supabase > SQL Editor > paste > Run.

-- last message each user has seen, per channel or DM (target = channel id or dm id)
create table public.reads (
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  target uuid not null,
  last_id bigint not null default 0,
  primary key (user_id, target)
);
alter table public.reads enable row level security;
create policy "own reads" on public.reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- greatest(): an old tab marking an older message never moves the read marker back
create function public.mark_read(t uuid, mid bigint) returns void
language sql security invoker set search_path = '' as $$
  insert into public.reads (user_id, target, last_id) values (auth.uid(), t, mid)
  on conflict (user_id, target) do update set last_id = greatest(public.reads.last_id, excluded.last_id);
$$;

-- security invoker: messages RLS limits the count to channels/DMs the caller can read.
-- server_id is null for DMs.
-- ponytail: counts by scanning unread messages, fine for small servers. Keep a counter table if this gets slow.
create function public.unread_counts() returns table (target uuid, server_id uuid, unread bigint)
language sql stable security invoker set search_path = '' as $$
  select coalesce(m.channel_id, m.dm_id), c.server_id, count(*)
  from public.messages m
  left join public.channels c on c.id = m.channel_id
  left join public.reads r on r.user_id = auth.uid() and r.target = coalesce(m.channel_id, m.dm_id)
  where m.author_id <> auth.uid() and m.id > coalesce(r.last_id, 0)
  group by 1, 2;
$$;

revoke execute on function public.mark_read, public.unread_counts from anon, public;
grant execute on function public.mark_read, public.unread_counts to authenticated;
