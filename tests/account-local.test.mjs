// Client-side account-deletion cleanup tests (Revision 6).
// Run: node tests/account-local.test.mjs
// Compiles session.ts + events.ts + apiBase.ts (same harness as
// client-events.test.mjs) and proves the local reset contract: account-bound
// outbox purge, guard clearing, anon/session rotation, kill-switch independence.
// No network, no real storage.
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const OUT = new URL('./.compiled-local/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
execSync(`npx tsc src/lib/session.ts src/lib/events.ts src/lib/apiBase.ts src/vite-env.d.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck --types vite/client`, { stdio: 'inherit' })
for (const f of readdirSync(OUT).filter((f) => f.endsWith('.js'))) {
  const p = `${OUT}/${f}`
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\/[^']+)'/g, (m, spec) => spec.endsWith('.js') ? m : `from '${spec}.js'`))
}

const results = []
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function makeStorage() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _raw: store,
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const makeJwt = (uuid) => `h.${Buffer.from(JSON.stringify({ sub: uuid })).toString('base64url')}.s`

let n = 0
let prevEvents = null
async function freshModules() {
  if (prevEvents) {
    prevEvents.__test.setEnabled(false)
    prevEvents.__test.setPlatform(null)
    prevEvents.__test.clearQueue()
    prevEvents.__test.setFetch(async () => ({ ok: true, status: 201, json: async () => ({ stored: true }) }))
    await prevEvents.__test.persistChainDone()
    await sleep(30)
  }
  globalThis.window = { localStorage: makeStorage(), location: { protocol: 'https:', host: 'test.local' } }
  globalThis.location = globalThis.window.location
  n++
  const session = await import(`${pathToFileURL(`${OUT}/session.js`).href}?n=${n}`)
  const events = await import(`${pathToFileURL(`${OUT}/events.js`).href}?n=${n}`)
  prevEvents = events
  return { session, events }
}

const failFetch = async () => ({ ok: false, status: 500, json: async () => null })

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

// 1. purgeAccountLocal removes ONLY the deleted account's queued items
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  events.__test.setFetch(failFetch) // everything retriable → lands in the outbox
  events.__test.dispatch(events.__test.buildBody('dish_saved'), makeJwt(A), true, A)
  events.__test.dispatch(events.__test.buildBody('dish_saved'), makeJwt(B), true, B)
  events.__test.dispatch(events.__test.buildBody('app_opened'), null, false)
  await sleep(60)
  await events.__test.persistChainDone()
  check('setup: three items queued (A, B, anonymous)', events.__test.queueSize() === 3)
  await events.purgeAccountLocal(A)
  const required = events.__test.queueRequired()
  check('A\'s account-bound items removed', !required.includes(A))
  check('B\'s account-bound item survives', required.includes(B))
  check('anonymous item survives', required.includes(null))
  const stored = JSON.parse(globalThis.window.localStorage.getItem('sc_evt_outbox') ?? '[]')
  check('persisted outbox reflects the purge', Array.isArray(stored) && stored.length === 2 && !stored.some((i) => i.requiredUserId === A))
}

// 2. Identity-link guard cleared for the deleted account only
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  globalThis.window.localStorage.setItem(`sc_evt_linked_${A}`, '1')
  globalThis.window.localStorage.setItem(`sc_evt_linked_${B}`, '1')
  await events.purgeAccountLocal(A)
  check('deleted account\'s identity-link guard cleared', globalThis.window.localStorage.getItem(`sc_evt_linked_${A}`) === null)
  check('other account\'s guard untouched', globalThis.window.localStorage.getItem(`sc_evt_linked_${B}`) === '1')
}

// 3. Purge works with the kill switch OFF (privacy cleanup is unconditional)
{
  const { events } = await freshModules()
  events.__test.setEnabled(false)
  // Pre-existing persisted outbox from an earlier enabled run:
  const item = (uid) => ({
    body: { id: crypto.randomUUID(), event: 'dish_saved', anon_id: crypto.randomUUID(), session_id: crypto.randomUUID(), app_version: '1.6.0' },
    needsAuth: true, attempts: 1, requiredUserId: uid,
  })
  globalThis.window.localStorage.setItem('sc_evt_outbox', JSON.stringify([item(A), item(B)]))
  await events.purgeAccountLocal(A)
  const stored = JSON.parse(globalThis.window.localStorage.getItem('sc_evt_outbox') ?? '[]')
  check('kill switch OFF: purge still removes the deleted account\'s stored items', stored.length === 1 && stored[0].requiredUserId === B)
}

// 4. resetIdentity rotates anon_id AND session_id, and persists the new anon id
{
  const { session } = await freshModules()
  await session.initIdentity()
  const anonBefore = session.getAnonId()
  const sessBefore = session.getSessionId()
  await session.resetIdentity()
  const anonAfter = session.getAnonId()
  const sessAfter = session.getSessionId()
  check('anon_id rotated to a fresh valid UUID', anonAfter !== anonBefore && UUID_RE.test(anonAfter))
  check('session_id rotated to a fresh valid UUID', sessAfter !== sessBefore && UUID_RE.test(sessAfter))
  check('new anon_id persisted to storage', globalThis.window.localStorage.getItem('sc_anon_id') === anonAfter)
}

// 5. resetIdentity persists via Capacitor Preferences on native (never localStorage)
{
  const { session } = await freshModules()
  const prefStore = new Map()
  session.__setPlatformForTests({
    isNative: true,
    prefs: {
      get: async ({ key }) => ({ value: prefStore.get(key) ?? null }),
      set: async ({ key, value }) => { prefStore.set(key, value) },
    },
  })
  await session.initIdentity()
  const before = session.getAnonId()
  await session.resetIdentity()
  const after = session.getAnonId()
  check('native: rotated anon_id stored in Preferences', prefStore.get('sc_anon_id') === after && after !== before)
  check('native: localStorage never received the anon id', globalThis.window.localStorage._raw.get('sc_anon_id') === undefined)
}

// 6. Invalid user id is a safe no-op
{
  const { events } = await freshModules()
  globalThis.window.localStorage.setItem('sc_evt_outbox', JSON.stringify([{ body: { id: crypto.randomUUID(), event: 'dish_saved', anon_id: crypto.randomUUID(), session_id: crypto.randomUUID(), app_version: '1.6.0' }, needsAuth: true, attempts: 1, requiredUserId: A }]))
  await events.purgeAccountLocal('not-a-uuid')
  const stored = JSON.parse(globalThis.window.localStorage.getItem('sc_evt_outbox') ?? '[]')
  check('purge with invalid id changes nothing', stored.length === 1)
}

const passed = results.filter((r) => r.pass).length
console.log(`\n${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
