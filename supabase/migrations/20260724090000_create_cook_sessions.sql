-- Migration: per-user interrupted-cook state for resume-after-lock.
-- One row per user; overwritten as they cook. RLS: owner only.
create table if not exists public.cook_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lines jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

alter table public.cook_sessions enable row level security;

drop policy if exists "cook_sessions_select_own" on public.cook_sessions;
create policy "cook_sessions_select_own"
on public.cook_sessions for select
using (user_id = auth.uid());

drop policy if exists "cook_sessions_insert_own" on public.cook_sessions;
create policy "cook_sessions_insert_own"
on public.cook_sessions for insert
with check (user_id = auth.uid());

drop policy if exists "cook_sessions_update_own" on public.cook_sessions;
create policy "cook_sessions_update_own"
on public.cook_sessions for update
using (user_id = auth.uid())
with check (user_id = auth.uid());
