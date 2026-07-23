-- Migration: long-term per-user memory for Micheli.
-- One rolling summary per user, updated after each meaningful voice session.
create table if not exists public.micheli_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  summary text not null,
  updated_at timestamptz not null default now()
);

alter table public.micheli_memory enable row level security;

drop policy if exists "micheli_memory_select_own" on public.micheli_memory;
create policy "micheli_memory_select_own"
on public.micheli_memory for select
using (user_id = auth.uid());

drop policy if exists "micheli_memory_insert_own" on public.micheli_memory;
create policy "micheli_memory_insert_own"
on public.micheli_memory for insert
with check (user_id = auth.uid());

drop policy if exists "micheli_memory_update_own" on public.micheli_memory;
create policy "micheli_memory_update_own"
on public.micheli_memory for update
using (user_id = auth.uid())
with check (user_id = auth.uid());
