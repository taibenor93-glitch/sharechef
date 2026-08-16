-- 12-month analytics retention (Revision 6, reviewer-approved). Enables pg_cron
-- (available on the instance, verified 2026-08-16, not yet installed) and
-- schedules a named daily purge of app_events rows older than 12 months.
-- Idempotent: rerunning cannot create duplicate jobs — any existing job with
-- this name is unscheduled first, then scheduled exactly once.
-- NOT applied to production yet.

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'app_events_purge_12mo') then
    perform cron.unschedule('app_events_purge_12mo');
  end if;
  perform cron.schedule(
    'app_events_purge_12mo',
    '17 4 * * *', -- daily 04:17 UTC, off the top-of-hour load spike
    'delete from public.app_events where occurred_at < now() - interval ''12 months'''
  );
end $$;
