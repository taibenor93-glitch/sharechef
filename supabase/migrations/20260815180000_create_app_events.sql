-- Phase 1 funnel analytics: app_events (revision 5, review-approved).
-- Typed columns only; anon_id/session_id are true UUID columns — free text is
-- structurally impossible at the database boundary, matching server validation.
-- RLS enabled with NO policies: anon/authenticated roles have zero access.
-- Only the server (service-role key) can insert. Clients never touch this table.
-- Application to production approved with both kill switches OFF (database validation phase).

create table public.app_events (
  id uuid primary key,
  event text not null check (event in (
    'app_opened',
    'account_created',
    'identity_linked',
    'micheli_intro_triggered',
    'ingredients_submitted',
    'dish_proposed',
    'dish_saved',
    'dish_shared',
    'voice_session_started',
    'voice_session_ended',
    'voice_session_disconnected',
    'voice_session_resumed'
  )),
  anon_id uuid not null,
  user_id uuid references auth.users (id) on delete set null,
  session_id uuid not null,
  app_version text not null check (app_version ~ '^\d{1,3}\.\d{1,3}\.\d{1,4}$'), -- strict x.y.z; '0.0.0' = explicit unknown
  ingredient_count integer check (ingredient_count between 0 and 99),
  turn_count integer check (turn_count between 0 and 999),
  duration_seconds integer check (duration_seconds between 0 and 86400),
  channel text check (channel in ('native','whatsapp','x','facebook','copy','linkedin','instagram','tiktok')),
  close_code integer check (close_code between 0 and 4999),
  occurred_at timestamptz not null default now(),
  reported_client_ts timestamptz
);

comment on table public.app_events is
  'Phase 1 funnel analytics. Insert-only via server (service role). No client access. No content data by schema design. micheli_intro_triggered marks the intro instruction being issued, not verified audio completion. close_code stores the raw WebSocket close code without interpretation.';

create index app_events_event_time_idx on public.app_events (event, occurred_at);
create index app_events_user_idx on public.app_events (user_id) where user_id is not null;
create index app_events_anon_idx on public.app_events (anon_id);

-- identity_linked idempotency at the database level: one link per (anon, user),
-- regardless of client retries or lost local guards.
create unique index app_events_identity_link_once
  on public.app_events (anon_id, user_id)
  where event = 'identity_linked';

-- micheli_intro_triggered can occur at most once per authenticated user, ever.
create unique index app_events_intro_once_per_user
  on public.app_events (user_id)
  where event = 'micheli_intro_triggered' and user_id is not null;

alter table public.app_events enable row level security;
-- Deliberately no policies: service role bypasses RLS; anon/authenticated are locked out entirely.
