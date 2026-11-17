-- Pinned messages, server icons, deleting your own account.

-- ───────── pinned messages ─────────
-- In a server channel only the owner pins; in a DM either person can.

alter table public.messages add column pinned_at timestamptz;

-- toggles the pin; returns the new pinned_at (null = unpinned)
create function public.toggle_pin(mid bigint) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
  result timestamptz;
begin
  select * into m from public.messages where id = mid for update;
  if not found or not public.can_access(m.channel_id, m.dm_id) then
    raise exception 'message not found';
  end if;
  if m.channel_id is not null and not exists (
    select 1 from public.channels c where c.id = m.channel_id and public.is_owner(c.server_id)
  ) then
    raise exception 'only the server owner can pin messages';
  end if;
  result := case when m.pinned_at is null then now() end;
  update public.messages set pinned_at = result where id = mid;
  return result;
end;
$$;
revoke execute on function public.toggle_pin from anon, public;
grant execute on function public.toggle_pin to authenticated;

-- ───────── server icons ─────────

alter table public.servers add column icon_url text;
grant select (icon_url) on public.servers to authenticated;

-- the owner may only use their own uploads as the icon
drop policy "owner edits server" on public.servers;
create policy "owner edits server" on public.servers for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and (icon_url is null or split_part(icon_url, '/', 1) = auth.uid()::text));

-- members can read their servers' icons (servers RLS limits the subquery to my servers)
create policy "read server icons" on storage.objects for select to authenticated using (
  bucket_id = 'uploads' and exists (select 1 from public.servers s where s.icon_url = name)
);

-- ───────── delete my account ─────────
-- Removes the auth user; everything else goes with it through "on delete cascade"
-- (profile, servers I own with their channels and messages, my messages, DMs).
-- ponytail: uploaded files stay in storage as orphans; clean the user's folder too if storage cost matters.

create function public.delete_account() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;
revoke execute on function public.delete_account from anon, public;
grant execute on function public.delete_account to authenticated;
