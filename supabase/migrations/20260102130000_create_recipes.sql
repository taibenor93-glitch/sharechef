-- Enable extension for UUIDs if needed
create extension if not exists pgcrypto;

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text not null,
  description text,
  ingredients jsonb not null,
  steps jsonb not null,
  cook_time_minutes int,
  servings int,
  tags text[],
  created_at timestamptz not null default now()
);

alter table public.recipes enable row level security;

-- RLS Policies: only the owner (auth.uid()) can CRUD their rows.
drop policy if exists "recipes_select_own" on public.recipes;
create policy "recipes_select_own"
on public.recipes for select
using (user_id = auth.uid());

drop policy if exists "recipes_insert_own" on public.recipes;
create policy "recipes_insert_own"
on public.recipes for insert
with check (user_id = auth.uid());

drop policy if exists "recipes_update_own" on public.recipes;
create policy "recipes_update_own"
on public.recipes for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "recipes_delete_own" on public.recipes;
create policy "recipes_delete_own"
on public.recipes for delete
using (user_id = auth.uid());
