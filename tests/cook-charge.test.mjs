// Free-cook charging tests. Run: node tests/cook-charge.test.mjs
//
// Why this exists (Nov 8 2026): a free user's 3rd cook was charged the moment
// her phone connected. The connection then failed over and over for 16 minutes,
// Micheli never said a word, and when she came back she hit the paywall having
// never used that cook. A cook must be charged only once the user has actually
// talked with Micheli, never for a session that failed or that nobody used.
//
// Runs the real server's /ws/realtime handler in-process. OpenAI is a local fake
// WebSocket server; the cooks table, user check and profile are injected seams.
// No Supabase, no OpenAI, no network.
import { WebSocket, WebSocketServer } from 'ws'
import { setTimeout as sleep } from 'node:timers/promises'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

process.env.SC_TEST_NO_LISTEN = '1'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-dummy'
process.env.SUPABASE_URL = ''
process.env.SUPABASE_ANON_KEY = ''
process.env.SUPABASE_SERVICE_KEY = ''
process.env.SUPABASE_SERVICE_ROLE_KEY = ''
process.env.EVENTS_ENABLED = ''
const { __test } = await import('../server.js')

// ── Fake OpenAI realtime ─────────────────────────────────────────────────────
// Each test sets `openaiScript` to decide what "OpenAI" does once a session opens.
let openaiScript = async () => {}
let openaiConnections = 0
const fakeOpenAI = new WebSocketServer({ port: 3121 })
fakeOpenAI.on('connection', (ws) => {
  openaiConnections++
  ws.once('message', () => { void openaiScript(ws) }) // first frame is session.update
})
const say = (ws, who, text) => ws.send(JSON.stringify(
  who === 'chef'
    ? { type: 'response.output_audio_transcript.done', transcript: text }
    : { type: 'conversation.item.input_audio_transcription.completed', transcript: text }
))

// ── Fake cooks table + identity ──────────────────────────────────────────────
const SAME_COOK_WINDOW_MS = 10 * 60 * 1000
let cooks = []          // { userId, at }
let now = Date.now()
let plan = 'free'
let cookState = null
function resetWorld() {
  cooks = []; now = Date.now(); plan = 'free'; cookState = null; openaiConnections = 0
  openaiScript = async () => {}
}
__test.setVoiceSeams({
  verifyUser: async (token) => (token ? { id: `user-${token}`, email: null } : null),
  loadProfile: async (token) => ({ id: `user-${token}`, plan, has_met_micheli: true }),
  loadCookState: async () => cookState,
  loadMemory: async () => null,
  hasRecentCook: async (userId) => cooks.some((c) => c.userId === userId && now - c.at < SAME_COOK_WINDOW_MS),
  monthlyCookCount: async (userId) => cooks.filter((c) => c.userId === userId).length,
  recordCook: async (userId) => { cooks.push({ userId, at: now }) },
  realtimeUrl: () => 'ws://127.0.0.1:3121',
})

const srv = __test.server.listen(3120)
await sleep(50)

/** Opens a browser-side session. Resolves with the socket and every frame it got. */
async function openSession({ token = 'a', isReconnect = false } = {}) {
  const ws = new WebSocket('ws://127.0.0.1:3120/ws/realtime')
  const got = []
  ws.on('message', (d) => { try { got.push(JSON.parse(d.toString())) } catch { /* audio */ } })
  await new Promise((r) => ws.once('open', r))
  ws.send(JSON.stringify({ type: 'auth', token, isReconnect }))
  return { ws, got }
}
const closed = (ws) => new Promise((r) => (ws.readyState === WebSocket.CLOSED ? r() : ws.once('close', r)))

// 1. THE NOV 8 BUG: OpenAI dies right after the session opens. Nobody spoke.
{
  resetWorld()
  openaiScript = async (ws) => { await sleep(30); ws.close() }
  const { ws } = await openSession()
  await closed(ws)
  await sleep(50)
  check('a session that dies before anyone speaks charges no cook', cooks.length === 0, `${cooks.length} charged`)
}

// 2. Micheli greets, the user never answers, the user leaves.
{
  resetWorld()
  openaiScript = async (ws) => { say(ws, 'chef', 'Hi! What are we cooking?') }
  const { ws } = await openSession()
  await sleep(150)
  ws.close()
  await sleep(100)
  check('a greeting the user never answers charges no cook', cooks.length === 0, `${cooks.length} charged`)
}

// 3. A real cook: the user talks with Micheli.
{
  resetWorld()
  openaiScript = async (ws) => {
    say(ws, 'chef', 'Hi! What are we cooking?')
    await sleep(30); say(ws, 'user', 'I have rice and two eggs')
    await sleep(30); say(ws, 'chef', 'Egg fried rice it is.')
    await sleep(30); say(ws, 'user', 'Great, what first?')
  }
  const { ws } = await openSession()
  await sleep(300)
  check('a real conversation charges exactly one cook', cooks.length === 1, `${cooks.length} charged`)
  ws.close()
  await sleep(50)
}

// 4. Two quick sessions for the same meal (a restart) are one cook, not two.
{
  resetWorld()
  openaiScript = async (ws) => { await sleep(20); say(ws, 'user', 'Next step?') }
  const a = await openSession()
  await sleep(150)
  a.ws.close(); await sleep(50)
  const b = await openSession()
  await sleep(150)
  b.ws.close(); await sleep(50)
  check('a restart within 10 minutes is the same cook', cooks.length === 1, `${cooks.length} charged`)
}

// 5. Two sessions that open at the same moment and both get used: still one cook.
{
  resetWorld()
  openaiScript = async (ws) => { await sleep(80); say(ws, 'user', 'Hello?') }
  const [a, b] = await Promise.all([openSession(), openSession()])
  await sleep(300)
  check('two overlapping sessions for one person charge one cook', cooks.length === 1, `${cooks.length} charged`)
  a.ws.close(); b.ws.close(); await sleep(50)
}

// 6. Out of free cooks: blocked before any OpenAI cost.
{
  resetWorld()
  now = Date.now()
  cooks = [1, 2, 3].map(() => ({ userId: 'user-a', at: now - 60 * 60 * 1000 }))
  const { ws, got } = await openSession()
  await closed(ws)
  check('a free user with 3 cooks used gets the paywall', got.some((m) => m.type === 'sc.limit' && m.used === 3))
  check('...and OpenAI is never contacted', openaiConnections === 0, `${openaiConnections} connections`)
  check('...and no 4th cook is charged', cooks.length === 3)
}

// 7. Automatic reconnect mid-cook never charges.
{
  resetWorld()
  openaiScript = async (ws) => { say(ws, 'user', 'Still here') }
  const { ws } = await openSession({ isReconnect: true })
  await sleep(150)
  check('an automatic reconnect charges no cook', cooks.length === 0, `${cooks.length} charged`)
  ws.close(); await sleep(50)
}

// 8. Resuming a saved cook never charges.
{
  resetWorld()
  cookState = { lines: [{ who: 'user', text: 'rice' }], updated_at: new Date().toISOString(), language: null }
  openaiScript = async (ws) => { say(ws, 'user', 'Where were we?') }
  const { ws } = await openSession()
  await sleep(150)
  check('resuming a saved cook charges no cook', cooks.length === 0, `${cooks.length} charged`)
  ws.close(); await sleep(50)
}

// 9. Plus users are never blocked, however many cooks they have.
//    (Plus cooks are still recorded, as before: that is usage history, not a charge.)
{
  resetWorld()
  plan = 'plus'
  cooks = [1, 2, 3, 4].map(() => ({ userId: 'user-a', at: Date.now() - 60 * 60 * 1000 }))
  openaiScript = async (ws) => { say(ws, 'user', 'Hi') }
  const { ws, got } = await openSession()
  await sleep(150)
  check('a Plus user is never blocked', !got.some((m) => m.type === 'sc.limit') && openaiConnections === 1)
  ws.close(); await sleep(50)
}

__test.resetVoiceSeams()
srv.close()
fakeOpenAI.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
