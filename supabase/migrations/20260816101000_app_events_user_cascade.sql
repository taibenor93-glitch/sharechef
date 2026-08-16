-- Defense in depth (Revision 6, reviewer-approved): app_events.user_id becomes
-- ON DELETE CASCADE (was SET NULL). The account-deletion endpoint still deletes
-- analytics EXPLICITLY and privacy-first (all rows for the user's anon_ids,
-- including anonymous pre-login rows the cascade could never reach) — this
-- cascade is the safety net for any deletion path that bypasses the endpoint,
-- not the mechanism. Idempotent: converges only when the rule differs.
-- NOT applied to production yet.

do $$
declare
  deltype "char";
begin
  select confdeltype into deltype
  from pg_constraint
  where conname = 'app_events_user_id_fkey' and conrelid = 'public.app_events'::regclass;
  if deltype is distinct from 'c' then
    alter table public.app_events drop constraint if exists app_events_user_id_fkey;
    alter table public.app_events
      add constraint app_events_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete cascade;
  end if;
end $$;
