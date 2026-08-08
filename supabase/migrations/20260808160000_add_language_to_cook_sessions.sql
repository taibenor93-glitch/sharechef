-- Migration: persist the session's established language alongside cook state,
-- so a reconnect reuses it instead of recomputing from pick/profile/device,
-- which could in principle drift between the original connection and a resume.
alter table public.cook_sessions add column if not exists language text;
