# SHARECHEF PHASE 1 ANALYTICS — REVISION 6
# Account Deletion + Retention — Local Implementation Report

Date: 2026-08-16, America/New_York
LOCAL ONLY: no production SQL run, nothing pushed or deployed, no Railway changes, analytics switches OFF, App Store Connect untouched, privacy policy NOT published.

## What was built

### 1. In-app deletion flow — `src/pages/Preferences.tsx`
A "Delete account" danger zone under Preferences. Flow: explanation of exactly what is removed (account, saved recipes, Micheli's memory, cooking sessions, shares, associated usage analytics; irreversible) → password re-entry → explicit confirmation checkbox → destructive button. Clear working / success / failure states, including distinct messages for wrong password, rate-limit, and server failure ("Your account was NOT deleted").

Reauthentication: the client calls `supabase.auth.signInWithPassword({ email, password })` directly against Supabase — **the password never touches the ShareChef server.** The fresh sign-in updates `last_sign_in_at`, which the server independently verifies.

After server-confirmed deletion the client immediately: purges account-bound outbox entries (`purgeAccountLocal`), rotates installation identity (`resetIdentity` — fresh `anon_id` + `session_id`, persisted to Capacitor Preferences on native / localStorage on web), signs out (`supabase.auth.signOut()` — the deleted JWT is erased locally because Supabase warns it can remain technically valid until expiry), and navigates to the signed-out entry screen.

### 2. Server endpoint — `server.js` → `POST /api/account/delete`
- 401 for missing or invalid JWT.
- 400 for ANY body field — the target account derives exclusively from the verified token; a body-supplied user id is rejected outright.
- 403 unless `last_sign_in_at` (from Supabase-verified user data) is within a **5-minute documented window** — a silently refreshed JWT keeps its old `last_sign_in_at` and cannot delete.
- 429 via per-IP rate limiting (5/hour, per-process best-effort like `/api/events`).
- 1 KB body limit with clean JSON error handling; responses carry no secrets or database internals; logs carry step names only — never ids, tokens, or passwords.
- Service-role client (`adminClient()`) is lazy, server-side only, independent of the analytics kill switch, and null-safe: without `SUPABASE_SERVICE_KEY` the endpoint returns 503 and deletes nothing.
- TEST-ONLY seam `SC_TEST_FAKE_AUTH=1` (never set in production) lets the test suite exercise every guard offline.

### 3. Permanent server-side deletion — `performAccountDeletion(db, userId)`
1. Collect every `anon_id` attributed to the verified user.
2. Privacy-first purge (reviewer-approved): delete ALL `app_events` rows for those installation ids — including a shared household member's analytics on the same installation — then any remaining rows with the user's `user_id` (retry safety net).
3. `auth.admin.deleteUser(userId, false)` — **hard delete, never soft.** Verified production CASCADEs then remove profiles, recipes, shares, cook_sessions, micheli_memory.

Retry-safe and idempotent: re-running removes nothing new; a failure after the analytics purge is the privacy-correct failure mode and the admin step retries cleanly. Other users' functional data is structurally unreachable (keyed by their own user_id).

### 4. Local cleanup — `src/lib/events.ts` + `src/lib/session.ts`
- `purgeAccountLocal(userId)`: removes queued analytics bound to the deleted account, clears its `sc_evt_linked_<id>` guard, leaves other accounts' and anonymous items untouched, awaits persistence before sign-out, and runs **regardless of the kill switch** (privacy cleanup, not analytics).
- `resetIdentity()`: fresh `anon_id` persisted through the platform seam (Preferences on native, localStorage on web) + session rotation — the deleted account's server-linked identifier can never reappear.

### 5. Repository schema reconciliation (migrations written, NOT applied)
- `20260816100000_reconcile_shares_and_recipes.sql` — captures the production `shares` table 1:1 (`create table if not exists`, user FK CASCADE) and converges `recipes.user_id` to CASCADE only when the rule differs (production already has it; pure no-op there).
- `20260816101000_app_events_user_cascade.sql` — defense in depth: `app_events.user_id` SET NULL → CASCADE, idempotent; explicit anon-id purge remains the mechanism.

### 6. Twelve-month retention (migration written, NOT applied)
- `20260816102000_enable_pg_cron_retention_purge.sql` — `create extension if not exists pg_cron` (verified available: 1.6.4, not yet installed) + named daily job `app_events_purge_12mo` (04:17 UTC) deleting `app_events` older than 12 months. Idempotent: unschedule-if-exists before schedule — rerunning can never create duplicates.

### 7. Tests — 43 new, all green; full suite 131/131
- `tests/account-delete.test.mjs` (29/29): 401 missing/invalid JWT; 400 body-supplied user id; 403 stale/refresh-only session; recent reauth passes; 429 rate limit; full fake-db deletion (A's rows + shared-device over-deletion removed, B's own-installation analytics and functional data survive, hard-delete flag `false` asserted); retry idempotence; admin-failure retry; collect-failure aborts before any deletion; reauth window math; 12-month purge predicate (old removed, recent kept); all four migration content + idempotency checks; service key absent from all client source.
- `tests/account-local.test.mjs` (14/14): account-bound outbox purge (A removed; B + anonymous survive; storage reflects it); guard cleared for A only; purge works with kill switch OFF; anon/session rotation with persistence; native Preferences path (localStorage never touched); invalid-id no-op.
- Regression: session 18/18, client-events 38/38, events 32/32 — the original 88 all pass unchanged.
- No test contacts any live service: HTTP phases run against a spawned server with `SUPABASE_URL=''` (no auth/admin client can exist) and offline fake tokens; deletion logic runs against an in-memory fake db.

## Files changed (targeted; no git add performed)

Modified: `server.js` (+126/−1), `src/lib/events.ts` (+18), `src/lib/session.ts` (+19), `src/pages/Preferences.tsx` (+133/−1)
New: 3 migrations, 2 test files, `PRIVACY-POLICY-1.6-DRAFT.html` (draft only — publish gate: deletion feature live)

## Status lines

MIGRATION STATUS: NOT APPLIED
PRIVACY POLICY STATUS: DRAFT ONLY (`PRIVACY-POLICY-1.6-DRAFT.html`)
RAILWAY STATUS: UNCHANGED
DEPLOYMENT STATUS: NOT DEPLOYED
TYPE-CHECK: `tsc -b` clean
PRODUCTION BUILD: run on Tai's Mac (sandbox lacks the platform bundler binary) — result recorded in fix-log
SECRET SCAN: no `SUPABASE_SERVICE_KEY` / `service_role` reference anywhere in client source (test-enforced from now on)
