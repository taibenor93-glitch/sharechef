-- 2026-09-14: paid plans + monthly cook counting.
-- Additive only: deletes nothing, changes no existing rows.

-- Which plan a signed-in user is on ('free' or 'plus').
alter table public.profiles
  add column if not exists plan text not null default 'free';

-- One row per fresh cook (resumes and reconnects are never re-counted).
create table if not exists public.cooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  guest_id text,
  started_at timestamptz not null default now()
);

create index if not exists cooks_user_month on public.cooks (user_id, started_at);
create index if not exists cooks_guest_month on public.cooks (guest_id, started_at);

-- Locked down on purpose: only the server (service key) touches this table.
alter table public.cooks enable row level security;
