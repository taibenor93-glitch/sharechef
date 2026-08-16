# ShareChef Phase 1 Analytics — Revision 7 Correction

Status: local correction package only. Nothing has been pushed, deployed, enabled, or applied to production.

## Corrected blockers

1. Account deletion now suspends analytics and waits for in-flight deliveries before the server-side purge begins.
2. Local cleanup removes every queued event carrying the retired installation ID, including anonymous and shared-device events, plus every event bound to the deleted account.
3. All identity-link guards are cleared when the installation identity rotates, preventing stale guards from blocking future links.
4. The environment-controlled fake-authentication path was removed from production server code. Tests now inject an offline verifier in-process.
5. Recent reauthentication uses the verified JWT's password `amr` timestamp, not account-wide `last_sign_in_at`.
6. Client logout uses explicit local scope after deletion.
7. A lost/ambiguous deletion response retires local identifiers and signs the user out, preventing old analytics from being resurrected. The user can sign back in to verify whether the account still exists.
8. The repository migration no longer creates or enables RLS on `shares` without the verified production grants and policies.

## Files corrected

- `server.js`
- `src/lib/events.ts`
- `src/pages/Preferences.tsx`
- `supabase/migrations/20260816100000_reconcile_shares_and_recipes.sql`
- `tests/account-delete.test.mjs`
- `tests/account-local.test.mjs`

`src/lib/session.ts`, the app-events cascade migration, and the retention cron migration required no correction in this pass and remain included in the full code package.

## Verification completed here

- JavaScript syntax checks passed for `server.js`, `tests/account-delete.test.mjs`, and `tests/account-local.test.mjs`.
- Static scan confirms production server code contains no `SC_TEST_FAKE_AUTH` path.
- Static scan confirms the unsafe `shares` creation/RLS statements are absent from the reconciliation migration.

## Verification still required in the real ShareChef repository

After applying the patch on Tai's Mac:

1. Run `node tests/account-delete.test.mjs`.
2. Run `node tests/account-local.test.mjs`.
3. Run the original session, client-events, and events suites.
4. Run the production build.
5. Confirm all analytics switches remain OFF.
6. Do not apply migrations, push, or deploy.

The production `shares` grants, RLS enabled state, and policies still require a metadata-only audit before a complete baseline migration can be written.
