// Microphone lifecycle tests for the realtime voice client.
// Run: node tests/voice-mic.test.mjs
//
// Why this exists: stopListening() deliberately KEEPS the MediaStream alive
// between turns (re-acquiring it every turn is slow and flickers the iOS
// recording indicator). That makes releaseMic() the only thing that actually
// hands the microphone back, so every path that ends a session has to call it.
// A missed path leaves iOS's recording indicator lit, and the mic held open,
// while the UI says "Tap to talk to Micheli".
//
// Compiles the real client and drives it against fake WebSocket / AudioContext /
// getUserMedia. No network, no audio hardware.
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const OUT = new URL('./.compiled-voice/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
execSync(
  `npx tsc src/voice/realtimeVoice.ts src/lib/apiBase.ts src/lib/session.ts src/lib/events.ts src/vite-env.d.ts ` +
  `--outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck --types vite/client`,
  { stdio: 'inherit' }
)
function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? jsFiles(`${dir}/${e.name}`) : e.name.endsWith('.js') ? [`${dir}/${e.name}`] : []
  )
}
for (const p of jsFiles(OUT)) {
  let src = readFileSync(p, 'utf8')
  // Node ESM needs explicit .js extensions on relative imports (tsc keeps them bare).
  src = src.replace(/from '(\.[^']+)'/g, (m, spec) => (spec.endsWith('.js') ? m : `from '${spec}.js'`))
  // Vite replaces import.meta.env at build time; Node has no such object.
  src = src.replace(/import\.meta\.env/g, '(globalThis.__viteEnv ?? {})')
  writeFileSync(p, src)
}

const results = []
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Fakes ────────────────────────────────────────────────────────────────────
const tracks = []           // every mic track ever handed out
let sockets = []            // every socket ever opened

class FakeTrack {
  constructor() { this.stopped = false; tracks.push(this) }
  stop() { this.stopped = true }
}
class FakeStream {
  constructor() { this._tracks = [new FakeTrack()] }
  getTracks() { return this._tracks }
}
class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  constructor() {
    this.readyState = FakeWebSocket.OPEN
    this.sent = []
    this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null
    sockets.push(this)
    queueMicrotask(() => {
      // __socketDead models a connection that can no longer be established at
      // all (server down, no network) — it closes without ever opening, so the
      // client's reconnect budget actually runs out.
      if (globalThis.__socketDead) { this.readyState = FakeWebSocket.CLOSED; this.onclose && this.onclose(); return }
      this.onopen && this.onopen()
    })
  }
  send(d) { this.sent.push(d) }
  close() { this.readyState = FakeWebSocket.CLOSED; if (this.onclose) this.onclose() }
  // Simulate the server/network dropping the leg (no local close() call).
  drop() { this.readyState = FakeWebSocket.CLOSED; if (this.onclose) this.onclose() }
  emit(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }) }
}
class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.closed = false
    this.audioWorklet = { addModule: async () => { if (globalThis.__workletFails) throw new Error('worklet boom') } } }
  async resume() { this.state = 'running' }
  async close() { this.closed = true }
  createMediaStreamSource() { return { connect() {}, disconnect() {} } }
  createBuffer() { return { getChannelData: () => new Float32Array(0), duration: 0 } }
  createBufferSource() { return { connect() {}, start() {}, buffer: null } }
  get destination() { return {} }
}
class FakeAudioWorkletNode {
  constructor() { this.port = { onmessage: null } }
  connect() {} disconnect() {}
}

function installGlobals() {
  globalThis.__viteEnv = { VITE_EVENTS_ENABLED: 'false' }
  globalThis.__workletFails = false
  const storage = new Map()
  globalThis.window = {
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    location: { protocol: 'https:', host: 'test.local' },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    AudioContext: FakeAudioContext,
  }
  globalThis.location = globalThis.window.location
  globalThis.WebSocket = FakeWebSocket
  globalThis.AudioWorkletNode = FakeAudioWorkletNode
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  // Node 24 exposes navigator as a getter-only global; redefine it.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => {
      if (globalThis.__micFails) { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e }
      return new FakeStream()
    } } },
  })
}
installGlobals()

const { RealtimeVoice } = await import(pathToFileURL(`${OUT}/voice/realtimeVoice.js`).href)

const liveTracks = () => tracks.filter((t) => !t.stopped).length

/** Fresh client with an open socket and the mic actually running. */
async function startedClient() {
  sockets = []
  tracks.length = 0
  const seen = { status: [], limit: null, errors: [] }
  const v = new RealtimeVoice({
    onStatus: (s) => seen.status.push(s),
    onTranscript: () => {},
    onError: (m) => seen.errors.push(m),
    onLimit: (i) => { seen.limit = i },
  })
  await v.unlockAudio()
  v.connect(async () => null, () => null)
  await sleep(10)
  await v.startListening()
  await sleep(10)
  return { v, seen, socket: sockets[sockets.length - 1] }
}

// 0. Baseline: starting a session really does open a mic track.
{
  const { v } = await startedClient()
  check('starting a session opens exactly one live mic track', tracks.length === 1 && liveTracks() === 1,
    `${tracks.length} opened / ${liveTracks()} live`)
  v.disconnect()
}

// 1. Deliberate end.
{
  const { v } = await startedClient()
  v.disconnect()
  await sleep(10)
  check('disconnect() releases the microphone', liveTracks() === 0, `${liveTracks()} still live`)
}

// 2. Free-plan limit: the server ends the cook mid-session.
{
  const { v, socket, seen } = await startedClient()
  socket.emit({ type: 'sc.limit', used: 3, limit: 3 })
  await sleep(10)
  check('sc.limit releases the microphone', liveTracks() === 0, `${liveTracks()} still live`)
  check('sc.limit still surfaces the paywall', seen.limit && seen.limit.limit === 3)
  v.disconnect()
}

// 3. THE REGRESSION: connection dropped for good. The client gives up after
//    3 reconnect attempts, tells the user to tap the mic again — and used to
//    leave the microphone open the whole time.
{
  const { seen } = await startedClient()
  globalThis.__socketDead = true
  sockets[sockets.length - 1].drop()
  // Reconnect budget is 3 attempts at 800/1600/2400ms of backoff.
  await sleep(5200)
  globalThis.__socketDead = false
  check('a permanently dropped connection releases the microphone', liveTracks() === 0, `${liveTracks()} still live`)
  check('the user is told the connection dropped', seen.errors.some((m) => /connection dropped/i.test(m)))
  check('final status is idle', seen.status[seen.status.length - 1] === 'idle', seen.status.join(','))
}

// 4. Mic acquired, audio graph failed: never hold a mic with no session behind it.
{
  sockets = []; tracks.length = 0
  globalThis.__workletFails = true
  const seen = { errors: [] }
  const v = new RealtimeVoice({
    onStatus: () => {}, onTranscript: () => {},
    onError: (m) => seen.errors.push(m),
  })
  await v.unlockAudio()
  v.connect(async () => null, () => null)
  await sleep(10)
  await v.startListening()
  await sleep(10)
  globalThis.__workletFails = false
  check('a failed audio-graph start releases the microphone', tracks.length === 1 && liveTracks() === 0,
    `${tracks.length} opened / ${liveTracks()} live`)
  check('a failed start still reports an error', seen.errors.length === 1, seen.errors.join('|'))
  v.disconnect()
}

// 5. A reconnect that SUCCEEDS keeps the mic warm (no permission re-prompt, no
//    gap mid-recipe). This is the behaviour the fix must not break.
{
  const { v } = await startedClient()
  const before = tracks.length
  sockets[sockets.length - 1].drop()
  await sleep(900)                  // first backoff is 800ms
  check('a recoverable drop keeps the mic stream (no re-acquire)',
    tracks.length === before && liveTracks() === 1, `${tracks.length} opened / ${liveTracks()} live`)
  v.disconnect()
  await sleep(10)
  check('...and the mic is still released once the user really ends it', liveTracks() === 0)
}

// ── Source guarantee: every session-ending path goes through releaseMic() ────
{
  const src = readFileSync(new URL('../src/voice/realtimeVoice.ts', import.meta.url), 'utf8')
  const stopsTracks = /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/g
  check('mic tracks are stopped in exactly one place (releaseMic)',
    (src.match(stopsTracks) || []).length === 1)
  check('releaseMic is private to the client', /private releaseMic\(\): void/.test(src))
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
