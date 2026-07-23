-- Migration: track whether a user has heard Micheli's introduction.
-- First voice session: full intro. Every session after: "Welcome back" — no reintroduction.
alter table public.profiles
  add column if not exists has_met_micheli boolean not null default false;
