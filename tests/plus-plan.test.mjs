// ShareChef Plus: plan-sync endpoint tests. Run: node tests/plus-plan.test.mjs
//
// The money bug this locks down: /api/plus/sync used to answer with a plan it
// had not actually stored. profiles.plan is the gate the voice session reads,
// so a paid user whose write silently went nowhere (no profiles row yet, no
// service key configured, RLS refusal) was told "you're on Plus" and then sent
// straight back to the paywall they had just paid to get past.
//
// Runs the real Express app in-process with no Supabase and no network:
// the user verifier, the RevenueCat lookup and the plan writer are all injected
// through the same in-process seam the deletion tests use.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

process.env.SC_TEST_NO_LISTEN = '1'
process.env.SUPABASE_URL = ''
process.env.SUPABASE_ANON_KEY = ''
process.env.SUPABASE_SERVICE_KEY = ''
process.env.SUPABASE_SERVICE_ROLE_KEY = ''
process.env.EVENTS_ENABLED = ''
const { app, __test } = await import('../server.js')
const srv = app.listen(3113)
await sleep(100)

const USER = randomUUID()
async function sync(token = 'good') {
  const res = await fetch('http://127.0.0.1:3113/api/plus/sync', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  let json = null
  try { json = await res.json() } catch { /* ignore */ }
  return { status: res.status, json }
}
const verifier = async (t) => (t === 'good' ? { id: USER, email: null } : null)

// 1. No token → 401, and nothing is looked up or written.
{
  let touched = false
  __test.setPlusSeams({
    verifyUser: verifier,
    revenueCatPlan: async () => { touched = true; return 'plus' },
    planWriter: async () => { touched = true; return true },
  })
  const r = await sync(null)
  check('no token → 401', r.status === 401, `${r.status}`)
  check('no token → billing is never consulted', touched === false)
}

// 2. Happy path: RevenueCat says plus, the write lands, the client is told plus.
{
  const writes = []
  __test.setPlusSeams({
    verifyUser: verifier,
    revenueCatPlan: async () => 'plus',
    planWriter: async (userId, plan) => { writes.push({ userId, plan }); return true },
  })
  const r = await sync()
  check('stored plus → 200 {plan:"plus"}', r.status === 200 && r.json?.plan === 'plus', JSON.stringify(r.json))
  check('the plan is written for the token holder, not a body-supplied id',
    writes.length === 1 && writes[0].userId === USER && writes[0].plan === 'plus')
}

// 3. Free stays free.
{
  __test.setPlusSeams({ verifyUser: verifier, revenueCatPlan: async () => 'free', planWriter: async () => true })
  const r = await sync()
  check('no subscription → 200 {plan:"free"}', r.status === 200 && r.json?.plan === 'free', JSON.stringify(r.json))
}

// 4. THE REGRESSION: the write fails. The endpoint must NOT answer "plus".
{
  __test.setPlusSeams({ verifyUser: verifier, revenueCatPlan: async () => 'plus', planWriter: async () => false })
  const r = await sync()
  check('unstored plan → not reported as success', r.status !== 200, `${r.status}`)
  check('unstored plan → 503', r.status === 503, `${r.status}`)
  check('unstored plan → body never claims a plan', r.json?.plan === undefined, JSON.stringify(r.json))
}

// 5. Billing lookup down → 502, and nothing is written (the stored plan, whatever
//    it is, is left exactly as it was rather than being reset to free).
{
  let wrote = false
  __test.setPlusSeams({
    verifyUser: verifier,
    revenueCatPlan: async () => { throw new Error('revenuecat 503') },
    planWriter: async () => { wrote = true; return true },
  })
  const r = await sync()
  check('billing lookup failure → 502', r.status === 502, `${r.status}`)
  check('billing lookup failure never overwrites the stored plan', wrote === false)
}

__test.resetPlusSeams()
srv.close()

// ── Source guarantees ───────────────────────────────────────────────────────
{
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
  // UPSERT, not UPDATE: an update against a missing profiles row succeeds while
  // touching zero rows, which is exactly how a paid plan disappears silently.
  check('profiles.plan is written with upsert, never a bare update',
    !/from\('profiles'\)\.update\(\{ plan/.test(src) && (src.match(/upsert\(\{ id: userId, plan \}/g) || []).length === 2)
  check('the sync route only returns a plan after storePlan() succeeded',
    /if \(!\(await storePlan\(user\.id, plan, token\)\)\)/.test(src))
  // 1.6.2 shipped `plan` in loadProfile's column list before the migration ran.
  // PostgREST rejects the whole query on an unknown column (42703), so every
  // signed-in profile came back null and the celiac / kosher / allergy rules
  // silently stopped being applied. Never name columns here again.
  check('loadProfile selects * so an unmigrated column cannot disable dietary rules',
    /\.from\('profiles'\)\s*\n\s*\.select\('\*'\)/.test(src))
  check('loadProfile names no explicit profile columns',
    !/\.select\('id, gluten_free/.test(src))
  check('a missing Plus schema is reported at startup, not silently',
    /SCHEMA MISSING/.test(src) && /void checkPlusSchema\(\)/.test(src))
}
{
  const ui = readFileSync(new URL('../src/components/UpgradeSheet.tsx', import.meta.url), 'utf8')
  // A user whose payment went through must never be told they were not charged.
  const shownToUser = (ui.match(/setNote\('[^']*'\)/g) || [])
  check('"not charged" is shown on exactly one message, the pre-payment one',
    shownToUser.filter((s) => /not charged/.test(s)).length === 1, shownToUser.length + ' messages')
  check('the post-payment message tells the user the purchase went through',
    /outcome === 'pending'/.test(ui) && shownToUser.some((s) => /purchase went through/.test(s)))
  check('paywall still offers Restore Purchases, Terms and Privacy',
    /Restore Purchases/.test(ui) && /Terms of Use/.test(ui) && /Privacy Policy/.test(ui))
}
{
  const p = readFileSync(new URL('../src/lib/purchases.ts', import.meta.url), 'utf8')
  check('a resolved Apple purchase can never return the pre-payment error',
    /charged = true/.test(p) && /if \(charged\) \{/.test(p))
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
