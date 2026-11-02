-- Run in a dedicated Supabase project SQL editor. Do not put service_role keys in the site.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.quest_trips (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(name) between 1 and 100),
 owner_id uuid not null references auth.users(id),
 invite_hash text not null unique,
 created_at timestamptz not null default now()
);
create table if not exists public.quest_members (
 trip_id uuid not null references public.quest_trips(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(trip_id,user_id)
);
create table if not exists public.quest_entries (
 id uuid primary key,
 trip_id uuid not null references public.quest_trips(id) on delete cascade,
 author_id uuid not null references auth.users(id),
 title text not null check(char_length(title)<=200),
 port text not null check(char_length(port)<=200),
 port_id text not null default '',
 type text not null default 'detail',
 note text not null default '' check(char_length(note)<=5000),
 photo_path text,
 created_at timestamptz not null default now()
);
create index if not exists quest_entries_trip_created on public.quest_entries(trip_id,created_at desc);
create or replace function public.quest_is_member(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.quest_members m where m.trip_id=p_trip and m.user_id=(select auth.uid()));
$$;
revoke all on function public.quest_is_member(uuid) from public;
grant execute on function public.quest_is_member(uuid) to authenticated;
alter table public.quest_trips enable row level security;
alter table public.quest_members enable row level security;
alter table public.quest_entries enable row level security;
create policy "member sees trip" on public.quest_trips for select to authenticated using (public.quest_is_member(id));
create policy "member sees participants" on public.quest_members for select to authenticated using (public.quest_is_member(trip_id));
create policy "member sees entries" on public.quest_entries for select to authenticated using (public.quest_is_member(trip_id));
create policy "member adds own entry" on public.quest_entries for insert to authenticated with check (public.quest_is_member(trip_id) and author_id=(select auth.uid()) and (photo_path is null or photo_path like trip_id::text || '/%'));
create policy "author deletes entry" on public.quest_entries for delete to authenticated using (public.quest_is_member(trip_id) and author_id=(select auth.uid()));
-- The invite is a long random secret; only its SHA-256 hash is stored.
create or replace function public.quest_create_trip(p_name text, p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if char_length(trim(p_name)) not between 1 and 100 or p_code !~ '^[a-f0-9]{64}$' then raise exception 'Invalid trip details'; end if;
 insert into public.quest_trips(name,owner_id,invite_hash) values(trim(p_name),auth.uid(),encode(extensions.digest(p_code,'sha256'),'hex')) returning id into t;
 insert into public.quest_members(trip_id,user_id) values(t,auth.uid());
 return t;
end;$$;
create or replace function public.quest_join_trip(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if p_code !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation'; end if;
 select id into t from public.quest_trips where invite_hash=encode(extensions.digest(p_code,'sha256'),'hex');
 if t is null then raise exception 'Invalid invitation'; end if;
 insert into public.quest_members(trip_id,user_id) values(t,auth.uid()) on conflict do nothing;
 return t;
end;$$;
revoke all on function public.quest_create_trip(text,text) from public;
revoke all on function public.quest_join_trip(text) from public;
grant execute on function public.quest_create_trip(text,text),public.quest_join_trip(text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('quest-photos','quest-photos',false,5000000,array['image/jpeg']) on conflict(id) do nothing;
create policy "member reads trip photos" on storage.objects for select to authenticated
using(bucket_id='quest-photos' and public.quest_is_member((split_part(name,'/',1))::uuid));
create policy "member uploads own photos" on storage.objects for insert to authenticated
with check(bucket_id='quest-photos' and public.quest_is_member((split_part(name,'/',1))::uuid)
 and owner_id=(select auth.uid()::text) and storage.extension(name)='jpg');
create policy "photo owner can delete" on storage.objects for delete to authenticated
using(bucket_id='quest-photos' and public.quest_is_member((split_part(name,'/',1))::uuid) and owner_id=(select auth.uid()::text));
-- Enable quest_entries in Supabase Realtime publication through dashboard if desired.
