-- Migration: Micheli Cares (parent check-ins when a teen cooks).
--
-- How it fits together:
--   1. The teen makes a short code on their phone (cares_link_codes, 10 minutes).
--   2. The parent types it on theirs; cares_redeem_code() links the two accounts.
--   3. The parent's phone saves its push address (cares_push_tokens).
--   4. When the teen tells Micheli the stove is on or off, the server reads the
--      links and tokens with the service role and sends the check-in.
--
-- Every table cascades from auth.users, so account deletion removes it all.
-- Additive only: nothing existing is altered or dropped.

-- ── Push addresses (one row per device of a parent) ─────────────────────────
create table if not exists public.cares_push_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null check (char_length(token) between 32 and 200),
  platform text not null default 'ios' check (platform in ('ios')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.cares_push_tokens enable row level security;

drop policy if exists "cares_push_tokens_select_own" on public.cares_push_tokens;
create policy "cares_push_tokens_select_own"
on public.cares_push_tokens for select
using (user_id = auth.uid());

drop policy if exists "cares_push_tokens_insert_own" on public.cares_push_tokens;
create policy "cares_push_tokens_insert_own"
on public.cares_push_tokens for insert
with check (user_id = auth.uid());

drop policy if exists "cares_push_tokens_update_own" on public.cares_push_tokens;
create policy "cares_push_tokens_update_own"
on public.cares_push_tokens for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "cares_push_tokens_delete_own" on public.cares_push_tokens;
create policy "cares_push_tokens_delete_own"
on public.cares_push_tokens for delete
using (user_id = auth.uid());

-- ── Parent ↔ teen links ─────────────────────────────────────────────────────
-- Rows are only ever created by cares_redeem_code() below (no insert policy).
-- Either side can see the link and either side can remove it.
create table if not exists public.cares_links (
  parent_id uuid not null references auth.users(id) on delete cascade,
  teen_id uuid not null references auth.users(id) on delete cascade,
  teen_name text not null check (char_length(teen_name) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (parent_id, teen_id),
  check (parent_id <> teen_id)
);

create index if not exists cares_links_teen_idx on public.cares_links (teen_id);

alter table public.cares_links enable row level security;

drop policy if exists "cares_links_select_either" on public.cares_links;
create policy "cares_links_select_either"
on public.cares_links for select
using (parent_id = auth.uid() or teen_id = auth.uid());

drop policy if exists "cares_links_delete_either" on public.cares_links;
create policy "cares_links_delete_either"
on public.cares_links for delete
using (parent_id = auth.uid() or teen_id = auth.uid());

-- ── Short-lived link codes (one live code per teen) ─────────────────────────
-- 6 characters from a 32-character alphabet (about a billion combinations,
-- no I/O/0/1 to misread) that expire after 10 minutes. Only the teen who made
-- a code can read it.
create table if not exists public.cares_link_codes (
  teen_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  teen_name text not null check (char_length(teen_name) between 1 and 40),
  expires_at timestamptz not null
);

alter table public.cares_link_codes enable row level security;

drop policy if exists "cares_link_codes_select_own" on public.cares_link_codes;
create policy "cares_link_codes_select_own"
on public.cares_link_codes for select
using (teen_id = auth.uid());

drop policy if exists "cares_link_codes_insert_own" on public.cares_link_codes;
create policy "cares_link_codes_insert_own"
on public.cares_link_codes for insert
with check (teen_id = auth.uid() and expires_at <= now() + interval '15 minutes');

drop policy if exists "cares_link_codes_update_own" on public.cares_link_codes;
create policy "cares_link_codes_update_own"
on public.cares_link_codes for update
using (teen_id = auth.uid())
with check (teen_id = auth.uid() and expires_at <= now() + interval '15 minutes');

drop policy if exists "cares_link_codes_delete_own" on public.cares_link_codes;
create policy "cares_link_codes_delete_own"
on public.cares_link_codes for delete
using (teen_id = auth.uid());

-- ── Redeem a code (called by the parent's app) ──────────────────────────────
-- Returns the teen's first name on success, null for a wrong or expired code.
-- SECURITY DEFINER so the parent can match a code they cannot read directly.
-- A code works once: it is removed as soon as it links.
create or replace function public.cares_redeem_code(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid := auth.uid();
  v_row public.cares_link_codes%rowtype;
begin
  if v_parent is null then
    raise exception 'sign in required';
  end if;

  select * into v_row
  from public.cares_link_codes
  where code = upper(trim(p_code)) and expires_at > now()
  for update;

  if not found then
    return null;
  end if;

  if v_row.teen_id = v_parent then
    raise exception 'use this code on your parent''s phone, not your own';
  end if;

  insert into public.cares_links (parent_id, teen_id, teen_name)
  values (v_parent, v_row.teen_id, v_row.teen_name)
  on conflict (parent_id, teen_id) do update set teen_name = excluded.teen_name;

  delete from public.cares_link_codes where teen_id = v_row.teen_id;

  return v_row.teen_name;
end;
$$;

revoke all on function public.cares_redeem_code(text) from public;
-- Supabase grants new functions to anon directly, so revoke that too: only
-- signed-in parents may redeem a code.
revoke execute on function public.cares_redeem_code(text) from anon;
grant execute on function public.cares_redeem_code(text) to authenticated;
