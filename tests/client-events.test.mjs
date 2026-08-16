// Client event delivery/retry/identity tests. Run: node tests/client-events.test.mjs
// Compiles session.ts + events.ts + apiBase.ts, then drives events via __test
// seams with a mocked fetch — no network, no storage side effects.
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const OUT = new URL('./.compiled-events/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
execSync(`npx tsc src/lib/session.ts src/lib/events.ts src/lib/apiBase.ts src/vite-env.d.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck --types vite/client`, { stdio: 'inherit' })
// Node ESM needs explicit .js extensions on relative imports (tsc keeps them bare).
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
// JWT-shaped test token whose sub is the acting account (unverified decode target).
const makeJwt = (uuid) => `h.${Buffer.from(JSON.stringify({ sub: uuid })).toString('base64url')}.s`

let n = 0
let prevEvents = null
async function freshModules() {
  // Quiesce the previous instance so its in-flight async work (dispatches,
  // persist chain) cannot bleed into the next test's fresh storage.
  if (prevEvents) {
    prevEvents.__test.setEnabled(false)
    prevEvents.__test.setPlatform(null) // events.js shares ONE cached session module — clear native override
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

function mockFetch(script) {
  // script: array of responses or 'network-error'; repeats last entry when exhausted.
  let calls = 0
  const bodies = []
  const fn = async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    const step = script[Math.min(calls++, script.length - 1)]
    if (step === 'network-error') throw new Error('offline')
    return {
      ok: step.status < 400,
      status: step.status,
      json: async () => step.json ?? null,
    }
  }
  return { fn, bodies, calls: () => calls }
}

// 1. APP_VERSION fallback is strict '0.0.0' when build metadata is absent
{
  const { events } = await freshModules()
  check("missing build metadata → APP_VERSION '0.0.0'", events.APP_VERSION === '0.0.0', events.APP_VERSION)
}

// 2. Native platform selects Capacitor Preferences, never localStorage
{
  const { session } = await freshModules()
  const prefStore = new Map()
  let getCalls = 0, setCalls = 0
  session.__setPlatformForTests({
    isNative: true,
    prefs: {
      get: async ({ key }) => { getCalls++; return { value: prefStore.get(key) ?? null } },
      set: async ({ key, value }) => { setCalls++; prefStore.set(key, value) },
    },
  })
  await session.initIdentity()
  const anon = session.getAnonId()
  check('native: Preferences storage used (get+set called)', getCalls >= 1 && setCalls === 1)
  check('native: anon id stored in Preferences, not localStorage',
    prefStore.get('sc_anon_id') === anon && globalThis.window.localStorage._raw.get('sc_anon_id') === undefined)
  check('native: id is a valid UUID', UUID_RE.test(anon))
}

// 3. Duplicate response counts as successful delivery (identity guard sets)
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  const m = mockFetch([{ status: 202, json: { stored: false, reason: 'duplicate' } }])
  events.__test.setFetch(m.fn)
  events.linkIdentityOnce('user-guard-test', 'tok')
  await sleep(50)
  check('duplicate response sets identity_linked local guard',
    globalThis.window.localStorage._raw.get('sc_evt_linked_user-guard-test') === '1')
  check('duplicate delivery leaves queue empty', events.__test.queueSize() === 0)
}

// 4. Transient failure queues the ORIGINAL event id; retry succeeds, no duplicate id
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  const m = mockFetch(['network-error', { status: 201, json: { stored: true } }])
  events.__test.setFetch(m.fn)
  events.track('dish_saved')
  await sleep(50)
  const queuedIds = events.__test.queueIds()
  check('network failure queues exactly one event', queuedIds.length === 1 && UUID_RE.test(queuedIds[0]))
  await events.__test.flush()
  await sleep(20)
  check('retry sends the ORIGINAL id (no duplicate identity)',
    m.bodies.length === 2 && m.bodies[0].id === m.bodies[1].id)
  check('successful retry drains the queue', events.__test.queueSize() === 0)
}

// 5. 429 and 5xx are retriable
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  const m = mockFetch([{ status: 429 }, { status: 503 }])
  events.__test.setFetch(m.fn)
  events.track('dish_saved')
  await sleep(50)
  check('429 queues for retry', events.__test.queueSize() === 1)
}

// 6. Validation/auth 4xx are NEVER retried
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  const m = mockFetch([{ status: 400, json: { error: 'bad' } }])
  events.__test.setFetch(m.fn)
  events.track('dish_saved')
  await sleep(50)
  check('400 is not retried', events.__test.queueSize() === 0 && m.calls() === 1)
  const m2 = mockFetch([{ status: 401, json: { error: 'auth' } }])
  events.__test.setFetch(m2.fn)
  events.track('dish_saved', undefined, 'bad-token')
  await sleep(50)
  check('401 is not retried', events.__test.queueSize() === 0 && m2.calls() === 1)
}

// 7. Queue never exceeds 50
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  const m = mockFetch(['network-error'])
  events.__test.setFetch(m.fn)
  for (let i = 0; i < 80; i++) events.track('dish_saved')
  await sleep(200)
  check('retry queue bounded at 50', events.__test.queueSize() <= 50, `size ${events.__test.queueSize()}`)
}

// 8. Kill switch prevents queueing entirely
{
  const { events } = await freshModules()
  events.__test.setEnabled(false)
  await events.__test.init()
  const m = mockFetch(['network-error'])
  events.__test.setFetch(m.fn)
  events.track('dish_saved')
  await sleep(30)
  check('kill switch OFF: nothing sent, nothing queued', m.calls() === 0 && events.__test.queueSize() === 0)
}

// 9. App events and voice-frame identity share identical ids after init
{
  const { session } = await freshModules()
  const p1 = session.initIdentity()
  const p2 = session.initIdentity() // "voice" consumer awaits the same single-flight init
  await Promise.all([p1, p2])
  const appAnon = session.getAnonId(); const appSess = session.getSessionId()
  const voiceAnon = session.getAnonId(); const voiceSess = session.getSessionId()
  check('voice + app consumers share identical anon_id and session_id',
    appAnon === voiceAnon && appSess === voiceSess && UUID_RE.test(appAnon) && UUID_RE.test(appSess))
}

// ── Persistent outbox suite ──────────────────────────────────────────────────

// 10. A queued event survives a simulated cold start (web/localStorage)
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  const m = mockFetch(['network-error'])
  events.__test.setFetch(m.fn)
  events.track('dish_saved')
  await sleep(50)
  await events.__test.persistChainDone()
  const persisted = globalThis.window.localStorage._raw.get('sc_evt_outbox')
  check('web outbox persisted to localStorage', typeof persisted === 'string' && persisted.includes('dish_saved'))
  const originalId = JSON.parse(persisted)[0].body.id
  // Simulated cold start: NEW module instance, SAME storage.
  n++
  const events2 = await import(`${pathToFileURL(`${OUT}/events.js`).href}?n=${n}`)
  events2.__test.setEnabled(true)
  await events2.__test.init()
  const m2 = mockFetch([{ status: 201, json: { stored: true } }])
  events2.__test.setFetch(m2.fn)
  await events2.__test.loadOutbox()
  await events2.__test.flush()
  await events2.__test.persistChainDone()
  check('queued event survives cold start and delivers with ORIGINAL id',
    m2.bodies.length >= 1 && m2.bodies.some((b) => b.id === originalId))
  check('delivered event removed from persistent storage',
    !(globalThis.window.localStorage._raw.get('sc_evt_outbox') || '[]').includes(originalId))
}

// 11. Native queue uses Capacitor Preferences
{
  const { events } = await freshModules()
  const prefStore = new Map()
  events.__test.setPlatform({
    isNative: true,
    prefs: {
      get: async ({ key }) => ({ value: prefStore.get(key) ?? null }),
      set: async ({ key, value }) => { prefStore.set(key, value) },
    },
  })
  events.__test.setEnabled(true)
  await events.__test.init()
  const m = mockFetch(['network-error'])
  events.__test.setFetch(m.fn)
  events.track('dish_saved')
  await sleep(50)
  await events.__test.persistChainDone()
  check('native outbox persisted via Capacitor Preferences',
    (prefStore.get('sc_evt_outbox') || '').includes('dish_saved'))
  check('native outbox NOT in localStorage',
    globalThis.window.localStorage._raw.get('sc_evt_outbox') === undefined)
}

// 12-13. No token persisted; fresh context at retry; never anonymous; ACCOUNT-BOUND
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  const userA = '11111111-1111-4111-8111-111111111111'
  const userB = '22222222-2222-4222-8222-222222222222'
  const tokenA = makeJwt(userA)
  const m = mockFetch(['network-error'])
  events.__test.setFetch(m.fn)
  events.track('dish_saved', undefined, tokenA) // User A performs the action
  await sleep(50)
  await events.__test.persistChainDone()
  const persisted = globalThis.window.localStorage._raw.get('sc_evt_outbox') || ''
  check('no token appears in persisted queue data', persisted.length > 0 && !persisted.includes(tokenA))
  check('requiredUserId (User A) persisted with the authenticated item', persisted.includes(userA))
  // No session at all: stays pending, never anonymous.
  events.setAuthContextProvider(async () => null)
  const m2 = mockFetch([{ status: 201, json: { stored: true } }])
  events.__test.setFetch(m2.fn)
  await events.__test.flush()
  check('authenticated event never sent anonymously (no send without session)', m2.calls() === 0)
  check('authenticated event kept pending while auth may return', events.__test.queueSize() === 1)
  // USER B signs in: User A's event must NOT be sent with B's token.
  events.setAuthContextProvider(async () => ({ accessToken: 'token-of-user-B', userId: userB }))
  const mB = mockFetch([{ status: 201, json: { stored: true } }])
  events.__test.setFetch(mB.fn)
  await events.__test.flush()
  check("User A's queued event is NEVER sent using User B's token", mB.calls() === 0)
  check("event stays pending while User B is signed in", events.__test.queueSize() === 1)
  // USER A returns: fresh context fetched, delivery proceeds under A only.
  events.setAuthContextProvider(async () => ({ accessToken: 'fresh-token-of-A', userId: userA }))
  let seenAuth = null
  const m3 = { calls: 0 }
  events.__test.setFetch(async (_url, init) => {
    m3.calls++
    seenAuth = init.headers.Authorization ?? null
    return { ok: true, status: 201, json: async () => ({ stored: true }) }
  })
  await events.__test.flush()
  await events.__test.persistChainDone()
  check('event delivers when User A returns, with a FRESH token', m3.calls === 1 && seenAuth === 'Bearer fresh-token-of-A')
  check('storage cleared after account-bound delivery',
    !(globalThis.window.localStorage._raw.get('sc_evt_outbox') || '').includes('dish_saved'))
}

// 13b. identity_linked cannot link the anonymous identity to the wrong account
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  const userA = '33333333-3333-4333-8333-333333333333'
  const userB = '44444444-4444-4444-8444-444444444444'
  events.__test.setFetch(mockFetch(['network-error']).fn)
  events.linkIdentityOnce(userA, makeJwt(userA))
  await sleep(50)
  await events.__test.persistChainDone()
  // User B signs in: the queued link must not deliver, and A's guard must not set.
  events.setAuthContextProvider(async () => ({ accessToken: 'token-B', userId: userB }))
  const mB = mockFetch([{ status: 201, json: { stored: true } }])
  events.__test.setFetch(mB.fn)
  await events.__test.flush()
  check('identity_linked never delivered under a different account', mB.calls() === 0)
  check('identity_linked guard NOT set after foreign-account flush',
    globalThis.window.localStorage._raw.get(`sc_evt_linked_${userA}`) === undefined)
}

// 13c. Restored authenticated item WITHOUT requiredUserId is discarded safely
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  const orphan = { body: { id: '55555555-5555-4555-8555-555555555555', event: 'dish_saved', anon_id: '66666666-6666-4666-8666-666666666666', session_id: '77777777-7777-4777-8777-777777777777', app_version: '1.6.0' }, needsAuth: true, attempts: 1 }
  globalThis.window.localStorage.setItem('sc_evt_outbox', JSON.stringify([orphan]))
  const m = mockFetch([{ status: 201, json: { stored: true } }])
  events.__test.setFetch(m.fn)
  events.setAuthContextProvider(async () => ({ accessToken: 't', userId: '99999999-9999-4999-8999-999999999999' }))
  await events.__test.loadOutbox()
  await events.__test.flush()
  check('authenticated stored item without requiredUserId discarded, never sent',
    m.calls() === 0 && events.__test.queueSize() === 0)
}

// 13d. Tampered / unexpected persisted properties are discarded
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  const bad = [
    { body: { id: '55555555-5555-4555-8555-555555555550', event: 'dish_saved', anon_id: '66666666-6666-4666-8666-666666666660', session_id: '77777777-7777-4777-8777-777777777770', app_version: '1.6.0', evil_prop: 'x' }, needsAuth: false, attempts: 1 },
    { body: { id: '55555555-5555-4555-8555-555555555551', event: 'not_an_event', anon_id: '66666666-6666-4666-8666-666666666661', session_id: '77777777-7777-4777-8777-777777777771', app_version: '1.6.0' }, needsAuth: false, attempts: 1 },
    { body: { id: '55555555-5555-4555-8555-555555555552', event: 'dish_saved', anon_id: '66666666-6666-4666-8666-666666666662', session_id: '77777777-7777-4777-8777-777777777772', app_version: '1.6.0' }, needsAuth: false, attempts: 1, stolenToken: 'abc' },
  ]
  globalThis.window.localStorage.setItem('sc_evt_outbox', JSON.stringify(bad))
  const m = mockFetch([{ status: 201, json: { stored: true } }])
  events.__test.setFetch(m.fn)
  await events.__test.loadOutbox()
  await events.__test.flush()
  check('tampered/unexpected persisted items all discarded, never sent',
    m.calls() === 0 && events.__test.queueSize() === 0)
}

// 13e. Anonymous events continue to retry WITHOUT authentication
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  events.setAuthContextProvider(async () => null) // no session at all
  events.__test.setFetch(mockFetch(['network-error']).fn)
  events.track('dish_saved') // anonymous
  await sleep(50)
  let sawAuthHeader = 'unset'
  const m = { calls: 0 }
  events.__test.setFetch(async (_url, init) => {
    m.calls++
    sawAuthHeader = init.headers.Authorization ?? null
    return { ok: true, status: 201, json: async () => ({ stored: true }) }
  })
  await events.__test.flush()
  check('anonymous event retries without authentication', m.calls === 1 && sawAuthHeader === null)
}

// 14. Duplicate delivery removes the event from persistent storage
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  events.__test.setFetch(mockFetch(['network-error']).fn)
  events.track('dish_saved')
  await sleep(50)
  events.__test.setFetch(mockFetch([{ status: 202, json: { stored: false, reason: 'duplicate' } }]).fn)
  await events.__test.flush()
  await events.__test.persistChainDone()
  check('duplicate delivery removes event from outbox storage',
    events.__test.queueSize() === 0 && !(globalThis.window.localStorage._raw.get('sc_evt_outbox') || '').includes('dish_saved'))
}

// 15. 400 during flush removes the event (never retried)
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  events.__test.setFetch(mockFetch(['network-error']).fn)
  events.track('dish_saved')
  await sleep(50)
  events.__test.setFetch(mockFetch([{ status: 400, json: { error: 'bad' } }]).fn)
  await events.__test.flush()
  await events.__test.persistChainDone()
  check('rejected (400) event removed from outbox, not retried',
    events.__test.queueSize() === 0 && (globalThis.window.localStorage._raw.get('sc_evt_outbox') || '[]') === '[]')
}

// 16. Persisted queue remains capped at 50
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  events.__test.setFetch(mockFetch(['network-error']).fn)
  for (let i = 0; i < 80; i++) events.track('dish_saved')
  await sleep(250)
  await events.__test.persistChainDone()
  const stored = JSON.parse(globalThis.window.localStorage._raw.get('sc_evt_outbox') || '[]')
  check('persisted outbox capped at 50', stored.length <= 50 && events.__test.queueSize() <= 50, `stored ${stored.length}`)
}

// 17. Concurrent writers do not lose events
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  events.__test.setFetch(mockFetch(['network-error']).fn)
  await Promise.all(Array.from({ length: 10 }, async () => events.track('dish_saved')))
  await sleep(100)
  await events.__test.persistChainDone()
  const stored = JSON.parse(globalThis.window.localStorage._raw.get('sc_evt_outbox') || '[]')
  check('concurrent enqueues all persisted (serialized writer)', stored.length === 10, `stored ${stored.length}`)
}

// 18. Kill switch OFF: no new entries, no flushing, existing queue untouched
{
  const { events } = await freshModules()
  events.__test.setEnabled(true)
  await events.__test.init()
  events.__test.setFetch(mockFetch(['network-error']).fn)
  events.track('dish_saved')
  await sleep(50)
  await events.__test.persistChainDone()
  const before = globalThis.window.localStorage._raw.get('sc_evt_outbox')
  events.__test.setEnabled(false)
  const m = mockFetch([{ status: 201, json: { stored: true } }])
  events.__test.setFetch(m.fn)
  events.track('dish_shared', { channel: 'copy' }) // must not enqueue
  await events.__test.flush() // must not send
  await sleep(30)
  const after = globalThis.window.localStorage._raw.get('sc_evt_outbox')
  check('kill switch OFF: no sends, no new entries, existing outbox untouched',
    m.calls() === 0 && after === before && (after || '').includes('dish_saved'))
}

const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
