// Account deletion endpoint + core-procedure tests (Revision 6).
// Run: node tests/account-delete.test.mjs
// HTTP phase starts the exported Express app in-process with SUPABASE_URL=''
// (no auth/admin client and no network possible) and injects a verifier through
// an in-process-only test seam. Production contains no fake-token env path.
// Core phase drives performAccountDeletion against a FAKE db.
// No live service is ever contacted.
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function del(port, { token, body } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/api/account/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? '{}' : JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch { /* ignore */ }
  return { status: res.status, json }
}

const freshToken = (id = randomUUID()) => `test:${id}:${Date.now()}`
const staleToken = (id = randomUUID()) => `test:${id}:${Date.now() - 10 * 60 * 1000}` // 10 min old

// ── Phase A: HTTP guards (offline server) ────────────────────────────────────
process.env.SC_TEST_NO_LISTEN = '1'
process.env.SUPABASE_URL = ''
process.env.SUPABASE_ANON_KEY = ''
process.env.SUPABASE_SERVICE_KEY = ''
process.env.EVENTS_ENABLED = ''
const { app, __test } = await import('../server.js')
__test.setDeletionUserVerifier(async (token) => {
  const [prefix, id, ms] = String(token).split(':')
  if (prefix !== 'test' || !/^[0-9a-f-]{36}$/i.test(id) || !Number.isFinite(Number(ms))) return null
  return { id, amr: [{ method: 'password', timestamp: Number(ms) / 1000 }] }
})
const srv = app.listen(3111)
await sleep(100)
{
  const r = await del(3111, {})
  check('missing JWT → 401', r.status === 401)
}
{
  const r = await del(3111, { token: freshToken(), body: { user_id: randomUUID() } })
  check('body-supplied user id → 400 (never accepted)', r.status === 400)
}
{
  const r = await del(3111, { token: 'garbage.jwt.token' })
  check('invalid JWT → 401', r.status === 401)
}
{
  const r = await del(3111, { token: staleToken() })
  check('stale/refresh-only session → 403 (recent password sign-in required)', r.status === 403)
}
{
  const r = await del(3111, { token: freshToken() })
  check('recent sign-in passes reauth gate (503 only because no service key here)', r.status === 503 && r.json?.error === 'deletion not configured')
}
await new Promise((resolve) => srv.close(resolve))

// Rate limiting on its own server so counts are deterministic.
__test.resetDeleteRateLimit()
const rlSrv = app.listen(3112)
await sleep(100)
{
  const statuses = []
  for (let i = 0; i < 6; i++) statuses.push((await del(3112, { token: freshToken() })).status)
  check('rate limit: first 5 pass the limiter, 6th → 429', statuses.slice(0, 5).every((s) => s === 503) && statuses[5] === 429, statuses.join(','))
}
await new Promise((resolve) => rlSrv.close(resolve))

// ── Phase B: core deletion procedure with a fake db (in-process) ─────────────

function makeFakeDb(rows, opts = {}) {
  const calls = { deletedUsers: [], softFlags: [] }
  const db = {
    from(table) {
      if (table !== 'app_events') throw new Error('unexpected table: ' + table)
      return {
        select() {
          return {
            eq(_c, v) {
              if (opts.failCollect) return { data: null, error: { message: 'boom' } }
              return { data: rows.filter((r) => r.user_id === v).map((r) => ({ anon_id: r.anon_id })), error: null }
            },
          }
        },
        delete() {
          return {
            in(_c, vals) {
              if (opts.failAnonDelete) return { error: { message: 'boom' } }
              for (let i = rows.length - 1; i >= 0; i--) if (vals.includes(rows[i].anon_id)) rows.splice(i, 1)
              return { error: null }
            },
            eq(_c, v) {
              if (opts.failUserDelete) return { error: { message: 'boom' } }
              for (let i = rows.length - 1; i >= 0; i--) if (rows[i].user_id === v) rows.splice(i, 1)
              return { error: null }
            },
          }
        },
      }
    },
    auth: {
      admin: {
        deleteUser(id, soft) {
          if (opts.failAdmin) return { error: { message: 'boom' } }
          calls.deletedUsers.push(id)
          calls.softFlags.push(soft)
          return { error: null }
        },
      },
    },
  }
  return { db, calls }
}

const A = randomUUID(), B = randomUUID()
const a1 = randomUUID() // shared installation: A signed in here, B also used it
const b2 = randomUUID() // B's own installation

function scenarioRows() {
  return [
    { user_id: A, anon_id: a1 },      // A's attributed row
    { user_id: null, anon_id: a1 },   // anonymous row on the shared installation
    { user_id: B, anon_id: a1 },      // B's analytics on the shared installation (over-deletion approved)
    { user_id: B, anon_id: b2 },      // B's own installation — must survive
    { user_id: null, anon_id: b2 },   // anonymous row on B's installation — must survive
  ]
}

{
  const rows = scenarioRows()
  const { db, calls } = makeFakeDb(rows)
  const r = await __test.performAccountDeletion(db, A)
  check('deletion succeeds', r.ok === true)
  check('every row for A\'s installation ids removed (incl. shared-device over-deletion)', !rows.some((x) => x.anon_id === a1))
  check('User B\'s analytics on B\'s own installation survive', rows.filter((x) => x.anon_id === b2).length === 2)
  check('no row with A\'s user_id remains', !rows.some((x) => x.user_id === A))
  check('auth.admin.deleteUser called for A exactly once', calls.deletedUsers.length === 1 && calls.deletedUsers[0] === A)
  check('HARD delete used (shouldSoftDelete === false)', calls.softFlags[0] === false)

  // Retry safety: running again deletes nothing new and still succeeds.
  const before = rows.length
  const r2 = await __test.performAccountDeletion(db, A)
  check('retry is safe and idempotent (no further rows removed)', r2.ok === true && rows.length === before)
}

{
  // Admin deletion failure: analytics already gone (privacy-correct), retry succeeds.
  const rows = scenarioRows()
  const failing = makeFakeDb(rows, { failAdmin: true })
  const r = await __test.performAccountDeletion(failing.db, A)
  check('admin failure reported as retriable failure at auth step', r.ok === false && r.step === 'auth')
  check('analytics for A already removed before admin failure (privacy-correct order)', !rows.some((x) => x.anon_id === a1))
  const working = makeFakeDb(rows)
  const r2 = await __test.performAccountDeletion(working.db, A)
  check('retry after admin failure completes the deletion', r2.ok === true && working.calls.deletedUsers[0] === A)
}

{
  // Collect failure: nothing is deleted (fail before any destructive step).
  const rows = scenarioRows()
  const { db, calls } = makeFakeDb(rows, { failCollect: true })
  const r = await __test.performAccountDeletion(db, A)
  check('collect failure aborts before any deletion', r.ok === false && r.step === 'collect' && rows.length === 5 && calls.deletedUsers.length === 0)
}

{
  // Reauth window logic (pure).
  const now = Date.now()
  const amr = (method, ms) => [{ method, timestamp: ms / 1000 }]
  check('recent password AMR: just signed in → true', __test.isRecentPasswordAuth(amr('password', now - 5_000), now) === true)
  check('recent password AMR: 4m59s ago → true', __test.isRecentPasswordAuth(amr('password', now - 299_000), now) === true)
  check('stale password AMR → false', __test.isRecentPasswordAuth(amr('password', now - 360_000), now) === false)
  check('fresh token-refresh AMR is not password proof', __test.isRecentPasswordAuth(amr('token_refresh', now - 1_000), now) === false)
  check('missing/garbage AMR → false', __test.isRecentPasswordAuth(null, now) === false && __test.isRecentPasswordAuth('nope', now) === false)
  check('far-future password timestamp → false', __test.isRecentPasswordAuth(amr('password', now + 120_000), now) === false)
}

// ── Phase C: 12-month purge semantics (predicate simulation) ─────────────────
{
  const now = Date.now()
  const MONTH = 30.44 * 24 * 3600 * 1000
  const rowsP = [
    { occurred_at: now - 13 * MONTH }, // must purge
    { occurred_at: now - 12.1 * MONTH }, // must purge
    { occurred_at: now - 11.9 * MONTH }, // must keep
    { occurred_at: now - 1 * MONTH },  // must keep
    { occurred_at: now },              // must keep
  ]
  const cutoff = now - 12 * MONTH
  const kept = rowsP.filter((r) => !(r.occurred_at < cutoff))
  check('purge predicate removes >12mo rows and preserves recent rows', kept.length === 3 && kept.every((r) => r.occurred_at >= cutoff))
}

// ── Phase D: migration content checks ────────────────────────────────────────
{
  const rec = readFileSync('supabase/migrations/20260816100000_reconcile_shares_and_recipes.sql', 'utf8')
  check('migration: shares left untouched until grants/RLS policies are verified', !rec.includes('create table if not exists public.shares') && !rec.includes('alter table public.shares enable row level security'))
  check('migration: recipes FK converges to CASCADE only when different', rec.includes('recipes_user_id_fkey') && rec.includes('confdeltype') && rec.includes("is distinct from 'c'"))
  const ae = readFileSync('supabase/migrations/20260816101000_app_events_user_cascade.sql', 'utf8')
  check('migration: app_events.user_id defense-in-depth CASCADE, idempotent', ae.includes('app_events_user_id_fkey') && ae.includes('on delete cascade') && ae.includes('confdeltype'))
  const cron = readFileSync('supabase/migrations/20260816102000_enable_pg_cron_retention_purge.sql', 'utf8')
  check('migration: pg_cron enabled + named 12-month purge job', cron.includes('create extension if not exists pg_cron') && cron.includes('app_events_purge_12mo') && cron.includes("interval ''12 months''"))
  check('migration: cron job idempotent (unschedule-if-exists before schedule)', cron.includes('cron.unschedule') && cron.includes('if exists (select 1 from cron.job'))
}

// ── Phase E: service key never in client source ──────────────────────────────
{
  const offenders = []
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx|js|jsx|css|html)$/.test(f)) continue
      if (readFileSync(p, 'utf8').includes('SUPABASE_SERVICE_KEY')) offenders.push(p)
    }
  }
  walk('src')
  check('service key never referenced in client source', offenders.length === 0, offenders.join(','))
  const serverSource = readFileSync('server.js', 'utf8')
  check('production server contains no env-controlled fake-auth path', !serverSource.includes('SC_TEST_FAKE_AUTH'))
}

const passed = results.filter((r) => r.pass).length
console.log(`\n${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
