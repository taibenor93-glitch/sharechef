// Session identity tests. Run: node tests/session.test.mjs
// Compiles src/lib/session.ts with tsc, then imports a FRESH module instance per
// scenario (query-string import) with a mocked window/localStorage per context —
// each fresh import models a genuine cold launch (new JS context).
import { execSync } from 'node:child_process'
import { mkdirSync, cpSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const OUT = new URL('./.compiled/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
execSync(`npx tsc src/lib/session.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck`, { stdio: 'inherit' })
const MOD = pathToFileURL(`${OUT}/session.js`).href

const results = []
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// A mock browser storage shared across "launches" (same device) unless replaced.
function makeStorage(broken = false) {
  const store = new Map()
  return {
    getItem: (k) => { if (broken) throw new Error('storage denied'); return store.has(k) ? store.get(k) : null },
    setItem: (k, v) => { if (broken) throw new Error('storage denied'); store.set(k, String(v)) },
    removeItem: (k) => store.delete(k),
    _raw: store,
  }
}

let importCount = 0
async function coldLaunch(storage) {
  globalThis.window = { localStorage: storage }
  return await import(`${MOD}?launch=${++importCount}`) // fresh module = fresh JS context
}

// 1. UUID validity of generator
{
  const storage = makeStorage()
  const s = await coldLaunch(storage)
  check('makeUuid produces valid v4 UUIDs', UUID_RE.test(s.makeUuid()) && s.makeUuid() !== s.makeUuid())
}

// 2. Cold launch always rotates the session; anon id persists across launches
{
  const storage = makeStorage()
  const s1 = await coldLaunch(storage)
  await s1.initIdentity()
  const anon1 = s1.getAnonId(); const sess1 = s1.getSessionId()
  const s2 = await coldLaunch(storage) // same device, new context
  await s2.initIdentity()
  check('cold launch: anon id persists', s2.getAnonId() === anon1)
  check('cold launch: session ALWAYS rotates', s2.getSessionId() !== sess1)
  check('ids are valid UUIDs', UUID_RE.test(anon1) && UUID_RE.test(sess1))
}

// 3. Same-session repeated access is stable and pure (no activity writes)
{
  const storage = makeStorage()
  const s = await coldLaunch(storage)
  await s.initIdentity()
  const before = storage._raw.get('sc_evt_last_active')
  const a = s.getSessionId(); const b = s.getSessionId()
  const after = storage._raw.get('sc_evt_last_active')
  check('repeated getSessionId is stable', a === b)
  check('getters never write the activity clock', before === after)
}

// 4. Foreground before 30 minutes keeps the session
{
  const storage = makeStorage()
  const s = await coldLaunch(storage)
  await s.initIdentity()
  const sess = s.getSessionId()
  storage.setItem('sc_evt_last_active', String(Date.now() - 5 * 60 * 1000)) // 5 min ago
  const rotated = s.resumeBoundary()
  check('foreground <30min keeps session', rotated === false && s.getSessionId() === sess)
}

// 5. Foreground after 30 minutes rotates
{
  const storage = makeStorage()
  const s = await coldLaunch(storage)
  await s.initIdentity()
  const sess = s.getSessionId()
  storage.setItem('sc_evt_last_active', String(Date.now() - 31 * 60 * 1000))
  const rotated = s.resumeBoundary()
  check('foreground >30min rotates session', rotated === true && s.getSessionId() !== sess && UUID_RE.test(s.getSessionId()))
}

// 6. Storage failure → stable runtime-unique valid UUIDs, no constants
{
  const s = await coldLaunch(makeStorage(true))
  await s.initIdentity()
  const a1 = s.getAnonId(); const a2 = s.getAnonId()
  check('storage failure: anon id is a valid UUID', UUID_RE.test(a1))
  check('storage failure: id stable within runtime', a1 === a2)
  const sB = await coldLaunch(makeStorage(true))
  await sB.initIdentity()
  check('storage failure: runtime-unique across launches (no constant fallback)', sB.getAnonId() !== a1)
}

// 7. Malformed stored IDs are rejected and regenerated
{
  const storage = makeStorage()
  storage.setItem('sc_anon_id', 'not-a-uuid-at-all')
  storage.setItem('sc_evt_session', 'g-12345-junk')
  const s = await coldLaunch(storage)
  await s.initIdentity()
  check('malformed stored anon id regenerated as UUID', UUID_RE.test(s.getAnonId()))
  check('malformed stored session id regenerated as UUID', UUID_RE.test(s.getSessionId()))
}

// 7b. Retained foreground return still registers activity
{
  const storage = makeStorage()
  const s = await coldLaunch(storage)
  await s.initIdentity()
  const stale = String(Date.now() - 5 * 60 * 1000)
  storage.setItem('sc_evt_last_active', stale)
  const rotated = s.resumeBoundary()
  const updated = storage._raw.get('sc_evt_last_active')
  check('retained foreground updates the activity clock', rotated === false && updated !== stale && Number(updated) > Number(stale))
}

// 7c. Malformed / non-finite activity timestamps rotate the session
{
  const storage = makeStorage()
  const s = await coldLaunch(storage)
  await s.initIdentity()
  const sess = s.getSessionId()
  storage.setItem('sc_evt_last_active', 'definitely-not-a-number')
  const rotated = s.resumeBoundary()
  check('malformed activity timestamp rotates session', rotated === true && s.getSessionId() !== sess)
  const s2sess = s.getSessionId()
  storage.setItem('sc_evt_last_active', 'Infinity')
  const rotated2 = s.resumeBoundary()
  check('non-finite activity timestamp rotates session', rotated2 === true && s.getSessionId() !== s2sess)
}

// 8. Clock reversal beyond tolerance rotates
{
  const storage = makeStorage()
  const s = await coldLaunch(storage)
  await s.initIdentity()
  const sess = s.getSessionId()
  storage.setItem('sc_evt_last_active', String(Date.now() + 10 * 60 * 1000)) // clock went backward 10 min
  const rotated = s.resumeBoundary()
  check('clock reversal rotates session', rotated === true && s.getSessionId() !== sess)
}

// 9. Concurrent initialization is single-flight
{
  const storage = makeStorage()
  const s = await coldLaunch(storage)
  const [,] = await Promise.all([s.initIdentity(), s.initIdentity(), s.initIdentity()])
  const anons = new Set([s.getAnonId(), s.getAnonId()])
  check('concurrent initIdentity yields one identity', anons.size === 1 && storage._raw.get('sc_anon_id') === s.getAnonId())
}

const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
