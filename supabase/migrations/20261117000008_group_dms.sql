-- Group DMs: a dms row with a name and no user_a/user_b; its people are in dm_members.
-- One-to-one DMs keep user_a/user_b (and the unique pair), so open_dm() is unchanged.

alter table public.dms
  alter column user_a drop not null,
  alter column user_b drop not null,
  add column name text check (char_length(name) between 1 and 64),
  -- a row is either a 1:1 DM (both users) or a group (a name, no users)
  add constraint dm_kind check ((user_a is not null and user_b is not null and name is null) or (user_a is null and user_b is null and name is not null));

create table public.dm_members (
  dm_id uuid not null references public.dms on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (dm_id, user_id)
);
alter table public.dm_members enable row level security;

-- am I in this DM (1:1 or group)? security definer so dm_members policies do not recurse
create function public.in_dm(did uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dms d where d.id = did and auth.uid() in (d.user_a, d.user_b))
      or exists (select 1 from public.dm_members m where m.dm_id = did and m.user_id = auth.uid());
$$;
grant execute on function public.in_dm to authenticated;

create policy "see my group's people" on public.dm_members for select to authenticated using (public.in_dm(dm_id));
-- joining and leaving happen only through create_group() / add_to_group() / leave_group().
-- dm_members is not in Realtime on purpose: DELETE events skip RLS and would tell every client who
-- left which group. Instead those functions "touch" the dms row, whose UPDATE events are RLS-filtered.

drop policy "see own dms" on public.dms;
create policy "see own dms" on public.dms for select to authenticated using (public.in_dm(id));

-- messages, pins, reactions and unread counts all go through can_access()
create or replace function public.can_access(cid uuid, did uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when cid is not null then exists (
      select 1 from public.channels c join public.members m on m.server_id = c.server_id
      where c.id = cid and c.kind = 'text' and m.user_id = auth.uid())
    else public.in_dm(did)
  end;
$$;

create or replace function public.can_type(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.channels c
    where 'typing:' || c.id::text = topic and c.kind = 'text' and public.is_member(c.server_id)
  ) or exists (
    select 1 from public.dms d
    where 'typing:' || d.id::text = topic and public.in_dm(d.id)
  );
$$;

-- a username -> user id; usernames are unique only case-sensitively, so an exact match wins
create function public.find_user(who text) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where lower(p.username) = lower(trim(who)) order by (p.username = trim(who)) desc limit 1;
$$;

-- can I put this person in a group? Only people I already share a server or a 1:1 DM with,
-- so strangers cannot be dropped into groups by username
create function public.knows(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid = auth.uid()
      or exists (select 1 from public.members a join public.members b on b.server_id = a.server_id where a.user_id = auth.uid() and b.user_id = uid)
      or exists (select 1 from public.dms d where (d.user_a = auth.uid() and d.user_b = uid) or (d.user_b = auth.uid() and d.user_a = uid));
$$;

-- new group with me and the given usernames (unknown names and people I do not know are skipped); returns its id
create function public.create_group(name text, usernames text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare did uuid;
begin
  if coalesce(array_length(usernames, 1), 0) > 9 then raise exception 'Um grupo tem no máximo 10 pessoas'; end if;
  if trim(create_group.name) = '' then raise exception 'Dê um nome ao grupo'; end if;
  insert into public.dms (name) values (trim(create_group.name)) returning id into did;
  insert into public.dm_members (dm_id, user_id)
    select did, auth.uid()
    union
    select did, u.id from (select public.find_user(x) as id from unnest(usernames) x) u
    where u.id is not null and public.knows(u.id);
  if (select count(*) from public.dm_members where dm_id = did) < 2 then
    raise exception 'Ninguém encontrado: só dá para adicionar quem está num servidor ou numa DM com você';
  end if;
  return did;
end;
$$;

-- someone in the group adds another person they know, by username
-- (parameter `who`, not `username`: that would be ambiguous with profiles.username)
create function public.add_to_group(did uuid, who text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  -- the lock makes two adds at the same time count one after the other
  perform 1 from public.dms d where d.id = did and d.name is not null for update;
  if not found or not public.in_dm(did) then raise exception 'Grupo não encontrado'; end if;
  uid := public.find_user(who);
  if uid is null or not public.knows(uid) then
    raise exception 'Usuário não encontrado (só dá para adicionar quem está num servidor ou numa DM com você)';
  end if;
  if exists (select 1 from public.dm_members where dm_id = did and user_id = uid) then return; end if;
  if (select count(*) from public.dm_members where dm_id = did) >= 10 then raise exception 'Um grupo tem no máximo 10 pessoas'; end if;
  insert into public.dm_members (dm_id, user_id) values (did, uid);
  update public.dms set name = name where id = did; -- live update for everyone in the group, the new person included
end;
$$;

-- leave; the last one out deletes the group with its messages
create function public.leave_group(did uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.dm_members where dm_id = did and user_id = auth.uid();
  if not exists (select 1 from public.dm_members where dm_id = did) then
    delete from public.dms where id = did and name is not null;
  else
    update public.dms set name = name where id = did and name is not null; -- the others see me leave
  end if;
end;
$$;

revoke execute on function public.create_group, public.add_to_group, public.leave_group, public.find_user, public.knows from anon, public;
grant execute on function public.create_group, public.add_to_group, public.leave_group to authenticated;
