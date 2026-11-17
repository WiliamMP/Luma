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

-- new group with me and the given usernames (unknown names are skipped); returns its id
create function public.create_group(name text, usernames text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare did uuid;
begin
  if coalesce(array_length(usernames, 1), 0) > 9 then raise exception 'Um grupo tem no máximo 10 pessoas'; end if;
  insert into public.dms (name) values (trim(create_group.name)) returning id into did;
  insert into public.dm_members (dm_id, user_id)
    select did, auth.uid()
    union
    select did, p.id from public.profiles p where lower(p.username) = any (select lower(u) from unnest(usernames) u);
  if (select count(*) from public.dm_members where dm_id = did) < 2 then
    raise exception 'Nenhum dos nomes foi encontrado';
  end if;
  return did;
end;
$$;

-- someone in the group adds another person by username
-- (parameter `who`, not `username`: that would be ambiguous with profiles.username below)
create function public.add_to_group(did uuid, who text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not exists (select 1 from public.dms d where d.id = did and d.name is not null) or not public.in_dm(did) then
    raise exception 'Grupo não encontrado';
  end if;
  if (select count(*) from public.dm_members where dm_id = did) >= 10 then raise exception 'Um grupo tem no máximo 10 pessoas'; end if;
  select p.id into uid from public.profiles p where lower(p.username) = lower(trim(who));
  if uid is null then raise exception 'Usuário não encontrado'; end if;
  insert into public.dm_members (dm_id, user_id) values (did, uid) on conflict do nothing;
  update public.dms set name = name where id = did; -- live update for everyone in the group, the new person included
end;
$$;

create function public.leave_group(did uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.dm_members where dm_id = did and user_id = auth.uid();
  update public.dms set name = name where id = did and name is not null; -- the others see me leave
$$;

revoke execute on function public.create_group, public.add_to_group, public.leave_group from anon, public;
grant execute on function public.create_group, public.add_to_group, public.leave_group to authenticated;
