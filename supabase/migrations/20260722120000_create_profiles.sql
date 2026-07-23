-- Migration: Add profiles table for dietary restrictions and allergies
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  gluten_free boolean not null default false,
  dairy_free boolean not null default false,
  kosher boolean not null default false,
  celiac boolean not null default false,
  allergies text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());
