// Free-cook time limit tests. Run: node tests/cook-time-limit.test.mjs
//
// Free users get FREE_COOK_MAX_MINUTES per cook, with a spoken warning at
// FREE_COOK_WARN_MINUTES. At the limit Micheli says the final message (stove
// reminder + Plus), in the user's language, and only then does the session end.
// The clock belongs to the cook: reconnecting or resuming never resets it.
// Plus users and verified test sessions are never limited.
//
// Runs the real /ws/realtime handler against a fake OpenAI. Minutes are scaled
// down to milliseconds through a test-only seam; no network, no Supabase.
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
process.env.VOICE_TEST_TOKEN = 'test-token-xyz'
const { __test } = await import('../server.js')

// The real constants, as approved.
check('FREE_COOK_MAX_MINUTES is 25', __test.FREE_COOK_MAX_MINUTES === 25)
check('FREE_COOK_WARN_MINUTES is 20', __test.FREE_COOK_WARN_MINUTES === 20)

// Scale: 1 "minute" = 20ms, so warn at 400ms, end at 500ms.
const MIN = 20
__test.setCookTimeScale(MIN)

// ── Fake OpenAI ──────────────────────────────────────────────────────────────
let fake = null // per-test record
const fakeOpenAI = new WebSocketServer({ port: 3131 })
fakeOpenAI.on('connection', (ws) => {
  fake.connections++
  let first = true
  ws.on('message', (d) => {
    const msg = JSON.parse(d.toString())
    if (first) { first = false; fake.sessionUpdate = msg; void fake.script(ws); return }
    if (msg.type === 'response.create') {
      fake.responses.push({ at: Date.now(), instructions: msg.response?.instructions || '' })
      const id = `resp_${fake.responses.length}`
      ws.send(JSON.stringify({ type: 'response.created', response: { id } }))
      setTimeout(() => ws.send(JSON.stringify({ type: 'response.done', response: { id } })), fake.responseMs)
      return
    }
    fake.forwarded.push(msg)
  })
})
const say = (ws, who, text) => ws.send(JSON.stringify(
  who === 'chef'
    ? { type: 'response.output_audio_transcript.done', transcript: text }
    : { type: 'conversation.item.input_audio_transcription.completed', transcript: text }
))

// ── World ────────────────────────────────────────────────────────────────────
let cooks = []
let plan = 'free'
let cookState = null
function reset({ script = async (ws) => { say(ws, 'user', 'I have rice') }, responseMs = 20 } = {}) {
  cooks = []; plan = 'free'; cookState = null
  fake = { connections: 0, responses: [], forwarded: [], sessionUpdate: null, script, responseMs }
}
__test.setVoiceSeams({
  verifyUser: async (token) => (token ? { id: `user-${token}`, email: null } : null),
  loadProfile: async (token) => ({ id: `user-${token}`, plan, has_met_micheli: true, language: null }),
  loadCookState: async () => cookState,
  loadMemory: async () => null,
  hasRecentCook: async (userId) => cooks.some((c) => c.userId === userId && Date.now() - c.at < 10 * 60 * 1000),
  monthlyCookCount: async (userId) => cooks.filter((c) => c.userId === userId).length,
  recordCook: async (userId) => { cooks.push({ userId, at: Date.now() }) },
  lastCookStart: async (userId) => {
    const mine = cooks.filter((c) => c.userId === userId)
    return mine.length ? mine[mine.length - 1].at : null
  },
  realtimeUrl: () => 'ws://127.0.0.1:3131',
})
const srv = __test.server.listen(3130)
await sleep(50)

async function openSession({ token = 'a', isReconnect = false, language = null, testToken = null } = {}) {
  const ws = new WebSocket('ws://127.0.0.1:3130/ws/realtime')
  const got = []
  ws.on('message', (d) => { try { got.push({ at: Date.now(), ...JSON.parse(d.toString()) }) } catch { /* audio */ } })
  await new Promise((r) => ws.once('open', r))
  ws.send(JSON.stringify({ type: 'auth', token, isReconnect, language, testToken }))
  return { ws, got }
}
const has = (got, type) => got.find((m) => m.type === type)

// 1. A full free cook: warning, then final message, then a clean end.
{
  reset()
  const cookSessionWrites = []
  __test.setDataClients({
    token: () => null,
    service: () => ({ from: (table) => ({ upsert: async (row) => { cookSessionWrites.push({ table, row }); return { error: null } } }) }),
  })
  const t0 = Date.now()
  const { ws, got } = await openSession()
  await sleep(26 * MIN + 150)
  const [warn, final] = fake.responses
  check('the 20 minute warning is spoken', warn && /5 minutes left on your free cook/i.test(warn.instructions), warn?.instructions)
  check('...at about 20 minutes', warn && Math.abs(warn.at - t0 - 20 * MIN) < 3 * MIN, warn && `${warn.at - t0}ms`)
  check('the final message is spoken at about 25 minutes', final && Math.abs(final.at - t0 - 25 * MIN) < 3 * MIN, final && `${final.at - t0}ms`)
  check('...with the exact wording', final && final.instructions.includes(
    "You've reached the free cook time limit. Please check your stove. Upgrade to ShareChef Plus for unlimited cooking time."))
  const end = has(got, 'sc.time_limit')
  const done = got.filter((m) => m.type === 'response.done').pop()
  check('the app is told the cook is over', !!end)
  check('...only AFTER Micheli finished the final message', end && done && end.at >= done.at)
  ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: 'AAAA' }))
  await sleep(60)
  check('after the final message, the mic no longer reaches Micheli',
    !fake.forwarded.some((m) => m.type === 'input_audio_buffer.append'))
  ws.close(); await sleep(50)
  check('the server closes the cook itself (it can never be resumed)',
    cookSessionWrites.some((w) => w.table === 'cook_sessions' && Array.isArray(w.row.lines) && w.row.lines.length === 0))
  check('...and does not save it again when the connection closes',
    !cookSessionWrites.some((w) => w.table === 'cook_sessions' && w.row.lines.length > 0))
  __test.resetDataClients()
}

// 2. Spoken in the user's language.
{
  reset()
  const { ws } = await openSession({ language: 'Spanish' })
  await sleep(21 * MIN + 100)
  check('the warning is spoken in the user\'s language', fake.responses[0] && /Spanish/.test(fake.responses[0].instructions),
    fake.responses[0]?.instructions)
  ws.close(); await sleep(50)
}

// 3. Plus users are never limited.
{
  reset()
  plan = 'plus'
  const { ws, got } = await openSession()
  await sleep(27 * MIN)
  check('a Plus user hears no warning and no limit', fake.responses.length === 0 && !has(got, 'sc.time_limit'))
  ws.close(); await sleep(50)
}

// 4. Verified test sessions are never limited.
{
  reset()
  const { ws, got } = await openSession({ testToken: 'test-token-xyz' })
  await sleep(27 * MIN)
  check('a test session is never limited', fake.responses.length === 0 && !has(got, 'sc.time_limit'))
  ws.close(); await sleep(50)
}

// 5. The clock belongs to the cook: a reconnect 22 "minutes" in keeps the time used.
{
  reset()
  cooks = [{ userId: 'user-a', at: Date.now() - 22 * MIN }]
  const t0 = Date.now()
  const { ws, got } = await openSession({ isReconnect: true })
  await sleep(5 * MIN + 150)
  const final = fake.responses.find((r) => /time limit/i.test(r.instructions))
  check('a reconnect does not reset the clock (ends ~3 minutes later, not 25)',
    final && final.at - t0 < 5 * MIN, final ? `${final.at - t0}ms` : 'no final message')
  check('...and no second warning after the warning time has passed',
    !fake.responses.some((r) => /5 minutes left/i.test(r.instructions)))
  check('...and the app is told the cook is over', !!has(got, 'sc.time_limit'))
  ws.close(); await sleep(50)
}

// 6. Resuming a saved cook past the limit ends it right away, with the message.
{
  reset()
  cooks = [{ userId: 'user-a', at: Date.now() - 30 * MIN }]
  cookState = { lines: [{ who: 'user', text: 'rice' }], updated_at: new Date().toISOString(), language: null }
  const { ws, got } = await openSession()
  await sleep(150)
  check('resuming a cook that is already over time ends it right away with the message',
    fake.responses.some((r) => /time limit/i.test(r.instructions)) && !!has(got, 'sc.time_limit'))
  ws.close(); await sleep(50)
}

// 7. Coming back after the limit was already delivered: no second message, no OpenAI cost.
{
  // continue the world from test 6: that cook is now time-limited
  fake = { ...fake, connections: 0, responses: [] }
  const { ws, got } = await openSession({ isReconnect: true })
  await sleep(150)
  check('a reconnect after the limit gets the upgrade screen straight away', !!has(got, 'sc.time_limit'))
  check('...without contacting OpenAI again', fake.connections === 0, `${fake.connections} connections`)
  ws.close(); await sleep(50)
}

// 8. If Micheli is mid-sentence at the limit, the final message waits for her to finish.
{
  reset({
    script: async (ws) => {
      say(ws, 'user', 'I have rice')
      await sleep(24 * MIN)
      ws.send(JSON.stringify({ type: 'response.created', response: { id: 'busy' } }))
      await sleep(3 * MIN)
      ws.send(JSON.stringify({ type: 'response.done', response: { id: 'busy' } }))
    },
  })
  const t0 = Date.now()
  const { ws } = await openSession()
  await sleep(29 * MIN)
  const final = fake.responses.find((r) => /time limit/i.test(r.instructions))
  check('the final message never interrupts Micheli mid-answer', final && final.at - t0 >= 27 * MIN,
    final ? `${final.at - t0}ms` : 'no final message')
  ws.close(); await sleep(50)
}

// 9. The clock starts at the cook, not at the connection: no speech, no clock.
{
  reset({ script: async () => {} })
  const { ws, got } = await openSession()
  await sleep(27 * MIN)
  check('a session where the user never spoke has no clock running',
    fake.responses.length === 0 && !has(got, 'sc.time_limit'))
  ws.close(); await sleep(50)
}

__test.resetCookTimeScale()
__test.resetVoiceSeams()
srv.close()
fakeOpenAI.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
