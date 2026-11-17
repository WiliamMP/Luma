-- Moderators: the owner can make members moderators. A moderator pins messages, deletes messages
-- of regular members, creates and renames channels and kicks regular members. Only the owner
-- deletes channels (that deletes their history), renames the server, changes its icon and invite
-- code, deletes it, and promotes or demotes moderators.

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

-- channels: moderators create and rename them; deleting (and its history) stays with the owner
drop policy "owner adds channels" on public.channels;
drop policy "owner edits channels" on public.channels;
create policy "mods add channels" on public.channels for insert to authenticated with check (public.is_mod(server_id));
create policy "mods edit channels" on public.channels for update to authenticated using (public.is_mod(server_id));

-- messages in the server's channels: the owner deletes any; a moderator deletes those of anyone who
-- is neither the owner nor a moderator (people already kicked included)
drop policy "owner deletes messages" on public.messages;
create policy "mods delete messages" on public.messages for delete to authenticated
  using (channel_id is not null and exists (
    select 1 from public.channels c
    where c.id = messages.channel_id
      and (
        public.is_owner(c.server_id)
        or (
          public.is_mod(c.server_id)
          and not exists (select 1 from public.servers s where s.id = c.server_id and s.owner_id = messages.author_id)
          and not exists (select 1 from public.members am where am.server_id = c.server_id and am.user_id = messages.author_id and am.role = 'mod')
        )
      )
  ));

-- editing or deleting my own messages needs access to where they are: someone kicked from a
-- server (or who left a group) can no longer rewrite what they said there
drop policy "edit own messages" on public.messages;
create policy "edit own messages" on public.messages for update to authenticated
  using (author_id = auth.uid() and public.can_access(channel_id, dm_id))
  with check (author_id = auth.uid());
drop policy "delete own messages" on public.messages;
create policy "delete own messages" on public.messages for delete to authenticated
  using (author_id = auth.uid() and public.can_access(channel_id, dm_id));

-- members leaves Realtime: DELETE events skip RLS, so every client was told who was kicked from
-- which server. A change in members now "touches" the servers row instead, whose UPDATE events
-- only reach that server's members.
-- ponytail: someone kicked gets no event (they are no longer a member); their app notices on its next load
alter publication supabase_realtime drop table public.members;

create function public.touch_server() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.servers set name = name where id = old.server_id;
  else
    update public.servers set name = name where id = new.server_id;
  end if;
  return null;
end;
$$;
create trigger members_touch_server after insert or update or delete on public.members
  for each row execute function public.touch_server();

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
