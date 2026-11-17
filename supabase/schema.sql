-- Luma database. Paste the whole file into Supabase > SQL Editor > Run (once, on an empty project).

-- ───────── tables ─────────

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null unique check (char_length(username) between 2 and 32),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 64),
  owner_id uuid not null references public.profiles on delete cascade,
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_at timestamptz not null default now()
);

create table public.members (
  server_id uuid references public.servers on delete cascade,
  user_id uuid references public.profiles on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers on delete cascade,
  name text not null check (char_length(name) between 1 and 64),
  kind text not null default 'text' check (kind in ('text', 'voice')),
  created_at timestamptz not null default now()
);

-- one row per pair of users, user_a < user_b so the pair is stored once
create table public.dms (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles on delete cascade,
  user_b uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);

create table public.messages (
  id bigint generated always as identity primary key,
  channel_id uuid references public.channels on delete cascade,
  dm_id uuid references public.dms on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles on delete cascade,
  content text not null default '' check (char_length(content) <= 4000),
  attachment_url text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(channel_id, dm_id) = 1)
);
create index on public.messages (channel_id, created_at desc);
create index on public.messages (dm_id, created_at desc);

-- ───────── helpers (security definer so policies do not recurse into members' own policy) ─────────

create function public.is_member(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where server_id = sid and user_id = auth.uid());
$$;

create function public.is_owner(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.servers where id = sid and owner_id = auth.uid());
$$;

create function public.can_access(cid uuid, did uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when cid is not null then exists (
      select 1 from public.channels c join public.members m on m.server_id = c.server_id
      where c.id = cid and c.kind = 'text' and m.user_id = auth.uid())
    else exists (select 1 from public.dms d where d.id = did and auth.uid() in (d.user_a, d.user_b))
  end;
$$;

-- ───────── row level security ─────────

alter table public.profiles enable row level security;
alter table public.servers enable row level security;
alter table public.members enable row level security;
alter table public.channels enable row level security;
alter table public.dms enable row level security;
alter table public.messages enable row level security;

create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "members see server" on public.servers for select to authenticated using (public.is_member(id));
create policy "owner edits server" on public.servers for update to authenticated using (owner_id = auth.uid());
create policy "owner deletes server" on public.servers for delete to authenticated using (owner_id = auth.uid());

create policy "members see members" on public.members for select to authenticated using (public.is_member(server_id));
create policy "leave server" on public.members for delete to authenticated
  using (user_id = auth.uid() or public.is_owner(server_id));

create policy "members see channels" on public.channels for select to authenticated using (public.is_member(server_id));
create policy "owner adds channels" on public.channels for insert to authenticated with check (public.is_owner(server_id));
create policy "owner edits channels" on public.channels for update to authenticated using (public.is_owner(server_id));
create policy "owner deletes channels" on public.channels for delete to authenticated using (public.is_owner(server_id));

create policy "see own dms" on public.dms for select to authenticated using (auth.uid() in (user_a, user_b));

create policy "read messages" on public.messages for select to authenticated using (public.can_access(channel_id, dm_id));
create policy "send messages" on public.messages for insert to authenticated
  with check (author_id = auth.uid() and public.can_access(channel_id, dm_id));
create policy "delete own messages" on public.messages for delete to authenticated using (author_id = auth.uid());

-- ───────── signup: create the profile ─────────

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uname text := left(regexp_replace(coalesce(nullif(new.raw_user_meta_data->>'username', ''),
                                            split_part(new.email, '@', 1)), '[^a-zA-Z0-9_.]', '', 'g'), 27);
begin
  if char_length(uname) < 2 then uname := 'user'; end if;
  if exists (select 1 from public.profiles where username = uname) then
    uname := uname || '_' || substr(new.id::text, 1, 4);
  end if;
  insert into public.profiles (id, username) values (new.id, uname);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────── actions the client calls with supabase.rpc() ─────────

create function public.create_server(server_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  insert into public.servers (name, owner_id) values (server_name, auth.uid()) returning id into sid;
  insert into public.members (server_id, user_id) values (sid, auth.uid());
  insert into public.channels (server_id, name, kind) values (sid, 'geral', 'text'), (sid, 'Geral', 'voice');
  return sid;
end;
$$;

create function public.join_server(code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select id into sid from public.servers where invite_code = lower(trim(code));
  if sid is null then raise exception 'Convite inválido'; end if;
  insert into public.members (server_id, user_id) values (sid, auth.uid()) on conflict do nothing;
  return sid;
end;
$$;

-- invite code is only visible through this, so non-members cannot list codes
create function public.get_invite(sid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select invite_code from public.servers where id = sid and public.is_member(sid);
$$;

create function public.open_dm(other uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a uuid := least(auth.uid(), other); b uuid := greatest(auth.uid(), other); did uuid;
begin
  if other = auth.uid() then raise exception 'Não dá para abrir DM consigo mesmo'; end if;
  insert into public.dms (user_a, user_b) values (a, b) on conflict (user_a, user_b) do nothing;
  select id into did from public.dms where user_a = a and user_b = b;
  return did;
end;
$$;

revoke execute on function public.create_server, public.join_server, public.get_invite, public.open_dm from anon, public;
grant execute on function public.create_server, public.join_server, public.get_invite, public.open_dm to authenticated;

-- hide invite_code from plain selects (get_invite above is the way to read it)
-- (a column revoke does nothing while the table-level grant exists, so swap the grant for a column list)
revoke select on public.servers from authenticated, anon;
grant select (id, name, owner_id, created_at) on public.servers to authenticated;

-- ───────── realtime ─────────

alter publication supabase_realtime add table public.messages, public.channels, public.members, public.dms;

-- ───────── storage: avatars and chat attachments ─────────

-- created public here; 003_private_uploads.sql makes it private (signed URLs + read policy)
insert into storage.buckets (id, name, public, file_size_limit) values ('uploads', 'uploads', true, 26214400);

create policy "upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
