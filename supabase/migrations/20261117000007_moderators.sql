-- Moderators: the owner can make members moderators. A moderator deletes and pins any message in
-- the server's channels, manages channels and kicks regular members. Only the owner renames the
-- server, changes its icon and invite code, deletes it, and promotes or demotes moderators.

alter table public.members add column role text not null default 'member' check (role in ('member', 'mod'));

-- owner or moderator of the server (security definer, like is_owner, so policies on members do not recurse)
create function public.is_mod(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_owner(sid) or exists (
    select 1 from public.members where server_id = sid and user_id = auth.uid() and role = 'mod'
  );
$$;
grant execute on function public.is_mod to authenticated;

-- only the owner changes roles, and only the role column
revoke update on public.members from authenticated, anon;
grant update (role) on public.members to authenticated;
create policy "owner sets roles" on public.members for update to authenticated
  using (public.is_owner(server_id)) with check (public.is_owner(server_id));

-- leaving, or being removed: the owner removes anyone, a moderator removes regular members only
drop policy "leave server" on public.members;
create policy "leave server" on public.members for delete to authenticated using (
  user_id = auth.uid()
  or public.is_owner(server_id)
  or (
    public.is_mod(server_id) and role = 'member'
    and not exists (select 1 from public.servers s where s.id = server_id and s.owner_id = user_id)
  )
);

-- channels: moderators manage them too
drop policy "owner adds channels" on public.channels;
drop policy "owner edits channels" on public.channels;
drop policy "owner deletes channels" on public.channels;
create policy "mods add channels" on public.channels for insert to authenticated with check (public.is_mod(server_id));
create policy "mods edit channels" on public.channels for update to authenticated using (public.is_mod(server_id));
create policy "mods delete channels" on public.channels for delete to authenticated using (public.is_mod(server_id));

-- messages: moderators delete anyone's message in the server's channels
drop policy "owner deletes messages" on public.messages;
create policy "mods delete messages" on public.messages for delete to authenticated
  using (channel_id is not null and exists (
    select 1 from public.channels c where c.id = channel_id and public.is_mod(c.server_id)
  ));

-- pins: moderators pin in channels (either person still pins in a DM)
create or replace function public.toggle_pin(mid bigint) returns timestamptz
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
    select 1 from public.channels c where c.id = m.channel_id and public.is_mod(c.server_id)
  ) then
    raise exception 'only the owner or a moderator can pin messages';
  end if;
  result := case when m.pinned_at is null then now() end;
  update public.messages set pinned_at = result where id = mid;
  return result;
end;
$$;
