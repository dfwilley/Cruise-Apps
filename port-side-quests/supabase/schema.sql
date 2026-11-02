-- Run in a NEW Supabase project's SQL editor. Requires Supabase Auth (email enabled).
create extension if not exists pgcrypto;
create table public.quest_groups (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 1 and 100),
 code_hash text not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.quest_members (
 group_id uuid not null references public.quest_groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(group_id,user_id)
);
create table public.quest_entries (
 id uuid primary key,
 group_id uuid not null references public.quest_groups(id) on delete cascade,
 author_id uuid not null references auth.users(id),
 title text not null check(length(title) between 1 and 200),
 port text not null default '',
 port_id text not null default '',
 kind text not null default 'detail',
 note text not null default '' check(length(note)<=5000),
 happened_at timestamptz not null default now(),
 photo_path text,
 created_at timestamptz not null default now(),
 check(photo_path is null or (photo_path like group_id::text || '/' || id::text || '/%'))
);
create index quest_entries_group_date on public.quest_entries(group_id,happened_at desc);
create index quest_members_user on public.quest_members(user_id);
create or replace function public.quest_is_member(p_group uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
 select exists(select 1 from public.quest_members m where m.group_id=p_group and m.user_id=(select auth.uid()))
$$;
revoke all on function public.quest_is_member(uuid) from public;
grant execute on function public.quest_is_member(uuid) to authenticated;
create or replace function public.quest_create_group(p_name text)
returns table(group_id uuid, invite_code text)
language plpgsql security definer set search_path = public, extensions as $$
declare gid uuid; code text;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if length(trim(p_name)) not between 1 and 100 then raise exception 'Invalid name'; end if;
 code := encode(gen_random_bytes(16),'hex');
 insert into public.quest_groups(name,code_hash,created_by)
 values(trim(p_name),encode(digest(code,'sha256'),'hex'),auth.uid()) returning id into gid;
 insert into public.quest_members(group_id,user_id) values(gid,auth.uid());
 return query select gid,code;
end $$;
create or replace function public.quest_join_group(p_group uuid,p_code text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if length(p_code) <> 32 or not exists (
  select 1 from public.quest_groups g where g.id=p_group
  and g.code_hash=encode(digest(lower(p_code),'sha256'),'hex')
 ) then raise exception 'Invalid invitation'; end if;
 insert into public.quest_members(group_id,user_id)
 values(p_group,auth.uid()) on conflict do nothing;
 return true;
end $$;
revoke all on function public.quest_create_group(text),public.quest_join_group(uuid,text) from public;
grant execute on function public.quest_create_group(text),public.quest_join_group(uuid,text) to authenticated;
alter table public.quest_groups enable row level security;
alter table public.quest_members enable row level security;
alter table public.quest_entries enable row level security;
create policy "group read members" on public.quest_groups for select to authenticated using(public.quest_is_member(id));
create policy "member read own groups" on public.quest_members for select to authenticated using(user_id=(select auth.uid()));
create policy "entry read members" on public.quest_entries for select to authenticated using(public.quest_is_member(group_id));
create policy "entry insert as member" on public.quest_entries for insert to authenticated with check(author_id=(select auth.uid()) and public.quest_is_member(group_id));
create policy "entry delete by author" on public.quest_entries for delete to authenticated using(author_id=(select auth.uid()) and public.quest_is_member(group_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('quest-photos','quest-photos',false,5242880,array['image/jpeg']) on conflict(id) do nothing;
create policy "quest photos read members" on storage.objects for select to authenticated
 using(bucket_id='quest-photos' and public.quest_is_member((split_part(name,'/',1))::uuid));
create policy "quest photos upload member" on storage.objects for insert to authenticated
 with check(bucket_id='quest-photos'
 and public.quest_is_member((split_part(name,'/',1))::uuid)
 and exists(select 1 from public.quest_entries e
  where e.id=(split_part(name,'/',2))::uuid and e.group_id=(split_part(name,'/',1))::uuid
  and e.author_id=(select auth.uid())));
-- No public photo access. Author uploads after creating the entry, then updates photo_path:
create policy "author update own entry" on public.quest_entries for update to authenticated
 using(author_id=(select auth.uid()) and public.quest_is_member(group_id))
 with check(author_id=(select auth.uid()) and public.quest_is_member(group_id));
