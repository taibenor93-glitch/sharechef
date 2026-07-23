-- Migration: Add dietary columns to the pre-existing profiles table
-- (profiles already existed with id/email/created_at only, unrelated to this feature
-- and confirmed unused elsewhere in the codebase before this migration)
alter table public.profiles
  add column if not exists gluten_free boolean not null default false,
  add column if not exists dairy_free boolean not null default false,
  add column if not exists kosher boolean not null default false,
  add column if not exists celiac boolean not null default false,
  add column if not exists allergies text[] not null default '{}',
  add column if not exists updated_at timestamptz not null default now();
