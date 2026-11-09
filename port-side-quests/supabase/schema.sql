-- Port Side Quests shared journal: database setup (version 3, November 8, 2026)
--
-- Paste the whole file into Supabase > SQL Editor and press Run, once.
-- Works on a brand-new project, and on a project where an older Port Side Quests
-- script was run. SAFETY: it first counts saved trips and entries; if any exist it
-- stops with an error and changes nothing, so journal data is never erased.
--
-- Design
--   * each traveler signs in with their own email (one-time code)
--   * a trip is private: only its members can see its entries and photos
--   * invitations are 64 random characters made on the phone; only a hash is stored;
--     they expire after 14 days and the owner can replace or turn them off
--   * the owner can remove members or delete the trip; members can leave
--   * authors can edit their note or delete their entry; the owner can delete any entry
--   * up to 3 photos per entry in a private bucket, at "trip-id/entry-id-N.jpg"

begin;   -- all or nothing: any error undoes everything below

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- 1. Refuse to run over real data ---------------------------------------------
do $$
declare t text; n bigint;
begin
  foreach t in array array['public.quest_entries','public.quest_groups','public.quest_trips'] loop
    if to_regclass(t) is not null then
      execute 'select count(*) from ' || t into n;
      if n > 0 then
        raise exception 'Stopped: % already holds % row(s). Nothing was changed.', t, n;
      end if;
    end if;
  end loop;
end $$;

-- 2. Remove earlier, empty versions ---------------------------------------------
drop policy if exists "quest photos read members"  on storage.objects;
drop policy if exists "quest photos upload member" on storage.objects;
drop policy if exists "member reads trip photos"   on storage.objects;
drop policy if exists "member uploads own photos"  on storage.objects;
drop policy if exists "photo owner can delete"     on storage.objects;
drop policy if exists "quest photo read"           on storage.objects;
drop policy if exists "quest photo upload"         on storage.objects;
drop policy if exists "quest photo delete"         on storage.objects;
drop table if exists public.quest_entries, public.quest_members, public.quest_groups, public.quest_trips cascade;
drop function if exists public.quest_create_group(text);
drop function if exists public.quest_join_group(uuid, text);
drop function if exists public.quest_create_trip(text, text);
drop function if exists public.quest_create_trip(text, text, text);
drop function if exists public.quest_join_trip(text);
drop function if exists public.quest_join_trip(text, text);
drop function if exists public.quest_new_invite(uuid, text);
drop function if exists public.quest_stop_invite(uuid);
drop function if exists public.quest_list_members(uuid);
drop function if exists public.quest_remove_member(uuid, uuid);
drop function if exists public.quest_leave_trip(uuid);
drop function if exists public.quest_delete_trip(uuid);
drop function if exists public.quest_set_name(uuid, text);
drop function if exists public.quest_is_member(uuid) cascade;
drop function if exists public.quest_is_owner(uuid) cascade;
drop function if exists public.quest_path_trip(text) cascade;

-- 3. Tables -----------------------------------------------------------------------
create table public.quest_trips (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(name) between 1 and 100),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  invite_hash       text unique,               -- null means invitations are turned off
  invite_expires_at timestamptz,
  created_at        timestamptz not null default now()
);
create table public.quest_members (
  trip_id      uuid not null references public.quest_trips(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  joined_at    timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index quest_members_user on public.quest_members(user_id);
create table public.quest_entries (
  id          uuid primary key,
  trip_id     uuid not null references public.quest_trips(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  theme       text not null check (theme in ('waterfront','taste','mechanism','story','other')),
  title       text not null check (char_length(title) between 1 and 200),
  kind        text not null default '' check (char_length(kind) <= 60),
  port        text not null default '' check (char_length(port) <= 200),
  port_id     text not null default '' check (char_length(port_id) <= 100),
  note        text not null default '' check (char_length(note) <= 5000),
  photo_paths text[] not null default '{}',
  found_at    timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  check (photo_paths <@ array[trip_id::text || '/' || id::text || '-1.jpg',
                              trip_id::text || '/' || id::text || '-2.jpg',
                              trip_id::text || '/' || id::text || '-3.jpg'])
);
create index quest_entries_trip_found on public.quest_entries(trip_id, found_at desc);

-- Signed-in users only. Trips and members change only through the checked functions.
revoke all on public.quest_trips, public.quest_members, public.quest_entries from anon, authenticated;
grant select on public.quest_trips, public.quest_members to authenticated;
grant select, insert, delete on public.quest_entries to authenticated;
grant update (note) on public.quest_entries to authenticated;

-- 4. Helper checks ------------------------------------------------------------------
create function public.quest_is_member(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.quest_members m where m.trip_id = p_trip and m.user_id = (select auth.uid()));
$$;
create function public.quest_is_owner(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.quest_trips t where t.id = p_trip and t.owner_id = (select auth.uid()));
$$;
-- "trip-id/entry-id-1.jpg" -> trip id (null if the path is malformed)
create function public.quest_path_trip(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end;
$$;

-- 5. Row level security ----------------------------------------------------------------
alter table public.quest_trips   enable row level security;
alter table public.quest_members enable row level security;
alter table public.quest_entries enable row level security;
create policy "member sees trip"         on public.quest_trips   for select to authenticated using (public.quest_is_member(id));
create policy "member sees participants" on public.quest_members for select to authenticated using (public.quest_is_member(trip_id));
create policy "member sees entries"      on public.quest_entries for select to authenticated using (public.quest_is_member(trip_id));
create policy "member adds own entry"    on public.quest_entries for insert to authenticated
  with check (public.quest_is_member(trip_id) and author_id = (select auth.uid()));
create policy "author edits own note"    on public.quest_entries for update to authenticated
  using (public.quest_is_member(trip_id) and author_id = (select auth.uid()))
  with check (public.quest_is_member(trip_id) and author_id = (select auth.uid()));
create policy "author or owner deletes entry" on public.quest_entries for delete to authenticated
  using (public.quest_is_member(trip_id) and (author_id = (select auth.uid()) or public.quest_is_owner(trip_id)));

-- 6. Trips, invitations and members -----------------------------------------------------
create function public.quest_create_trip(p_name text, p_code text, p_display text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if char_length(trim(p_name)) not between 1 and 100 or p_code !~ '^[a-f0-9]{64}$' then raise exception 'Invalid trip details'; end if;
  if (select count(*) from public.quest_trips where owner_id = auth.uid()) >= 25 then raise exception 'Trip limit reached (25)'; end if;
  insert into public.quest_trips(name, owner_id, invite_hash, invite_expires_at)
    values (trim(p_name), auth.uid(), encode(extensions.digest(p_code, 'sha256'), 'hex'), now() + interval '14 days')
    returning id into t;
  insert into public.quest_members(trip_id, user_id, display_name) values (t, auth.uid(), left(trim(coalesce(p_display, '')), 40));
  return t;
end $$;

create function public.quest_join_trip(p_code text, p_display text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_code !~ '^[a-f0-9]{64}$' then raise exception 'That invitation code is not valid'; end if;
  select id into t from public.quest_trips
    where invite_hash = encode(extensions.digest(p_code, 'sha256'), 'hex') and invite_expires_at > now();
  if t is null then raise exception 'That invitation is not valid, has expired or was turned off'; end if;
  if (select count(*) from public.quest_members where trip_id = t) >= 20 then raise exception 'This trip is full (20 people)'; end if;
  insert into public.quest_members(trip_id, user_id, display_name) values (t, auth.uid(), left(trim(coalesce(p_display, '')), 40))
    on conflict (trip_id, user_id) do nothing;
  return t;
end $$;

create function public.quest_set_name(p_trip uuid, p_display text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.quest_members set display_name = left(trim(coalesce(p_display, '')), 40)
    where trip_id = p_trip and user_id = auth.uid();
end $$;

-- The owner replaces the invitation; the old one stops working at once
create function public.quest_new_invite(p_trip uuid, p_code text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare e timestamptz := now() + interval '14 days';
begin
  if not public.quest_is_owner(p_trip) then raise exception 'Only the trip owner can change invitations'; end if;
  if p_code !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation'; end if;
  update public.quest_trips set invite_hash = encode(extensions.digest(p_code, 'sha256'), 'hex'), invite_expires_at = e where id = p_trip;
  return e;
end $$;

create function public.quest_stop_invite(p_trip uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.quest_is_owner(p_trip) then raise exception 'Only the trip owner can change invitations'; end if;
  update public.quest_trips set invite_hash = null, invite_expires_at = null where id = p_trip;
end $$;

-- Members see each other's name and email so the owner knows whom they are removing
create function public.quest_list_members(p_trip uuid)
returns table(user_id uuid, display_name text, email text, joined_at timestamptz, is_owner boolean, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.quest_is_member(p_trip) then raise exception 'Not a member of this trip'; end if;
  return query
    select m.user_id, m.display_name, u.email::text, m.joined_at, (t.owner_id = m.user_id), (m.user_id = auth.uid())
    from public.quest_members m
    join public.quest_trips t on t.id = m.trip_id
    join auth.users u on u.id = m.user_id
    where m.trip_id = p_trip
    order by (t.owner_id = m.user_id) desc, m.joined_at;
end $$;

create function public.quest_remove_member(p_trip uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.quest_is_owner(p_trip) then raise exception 'Only the trip owner can remove people'; end if;
  if p_user = auth.uid() then raise exception 'The owner cannot remove themself; delete the trip instead'; end if;
  delete from public.quest_members where trip_id = p_trip and user_id = p_user;
end $$;

create function public.quest_leave_trip(p_trip uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.quest_is_owner(p_trip) then raise exception 'The owner cannot leave; delete the trip instead'; end if;
  delete from public.quest_members where trip_id = p_trip and user_id = auth.uid();
end $$;

-- The app deletes the trip's photos through the Storage API first, then calls this
create function public.quest_delete_trip(p_trip uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.quest_is_owner(p_trip) then raise exception 'Only the trip owner can delete the trip'; end if;
  delete from public.quest_trips where id = p_trip;
end $$;

revoke all on function public.quest_is_member(uuid), public.quest_is_owner(uuid), public.quest_path_trip(text),
  public.quest_create_trip(text, text, text), public.quest_join_trip(text, text), public.quest_set_name(uuid, text),
  public.quest_new_invite(uuid, text), public.quest_stop_invite(uuid), public.quest_list_members(uuid),
  public.quest_remove_member(uuid, uuid), public.quest_leave_trip(uuid), public.quest_delete_trip(uuid) from public, anon;
grant execute on function public.quest_is_member(uuid), public.quest_is_owner(uuid), public.quest_path_trip(text),
  public.quest_create_trip(text, text, text), public.quest_join_trip(text, text), public.quest_set_name(uuid, text),
  public.quest_new_invite(uuid, text), public.quest_stop_invite(uuid), public.quest_list_members(uuid),
  public.quest_remove_member(uuid, uuid), public.quest_leave_trip(uuid), public.quest_delete_trip(uuid) to authenticated;

-- 7. Private photo storage -----------------------------------------------------------------
-- Delete photos only through the app or the Storage page, never with SQL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quest-photos', 'quest-photos', false, 5000000, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 5000000, allowed_mime_types = array['image/jpeg'];

create policy "quest photo read" on storage.objects for select to authenticated
  using (bucket_id = 'quest-photos' and public.quest_is_member(public.quest_path_trip(name)));
create policy "quest photo upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'quest-photos' and public.quest_is_member(public.quest_path_trip(name))
              and owner_id = (select auth.uid()::text) and storage.extension(name) = 'jpg');
create policy "quest photo delete" on storage.objects for delete to authenticated
  using (bucket_id = 'quest-photos' and public.quest_is_member(public.quest_path_trip(name))
         and (owner_id = (select auth.uid()::text) or public.quest_is_owner(public.quest_path_trip(name))));

commit;

-- Done: the results pane should say "Success. No rows returned".
