// Phase 1 events endpoint + unit tests. Run: node tests/events.test.mjs
// Spawns real server instances (kill switch OFF, then ON without a service key,
// so nothing can ever be written anywhere) plus an in-process import for
// validation unit tests (SC_TEST_NO_LISTEN=1).
import { spawn } from 'node:child_process'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function goodEvent(overrides = {}) {
  return {
    id: randomUUID(),
    event: 'app_opened',
    anon_id: randomUUID(),
    session_id: randomUUID(),
    app_version: '1.6.0',
    reported_client_ts: new Date().toISOString(),
    ...overrides,
  }
}

async function post(port, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch { /* some responses have no JSON */ }
  return { status: res.status, json }
}

// Chunked request with NO Content-Length header.
function postChunked(port, totalBytes) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/api/events', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', reject)
    req.write('{"pad":"')
    let sent = 8
    const chunk = 'x'.repeat(256)
    const timer = setInterval(() => {
      if (sent >= totalBytes) { clearInterval(timer); req.end('"}'); return }
      req.write(chunk); sent += 256
    }, 5)
  })
}

function startServer(port, extraEnv) {
  const child = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  return child
}

// ── Phase A: kill switch OFF (default) ───────────────────────────────────────
const offServer = startServer(3101, { EVENTS_ENABLED: '' })
await sleep(2500)
{
  const r = await post(3101, goodEvent())
  check('kill switch OFF: accepted but not stored (202/disabled)', r.status === 202 && r.json?.stored === false && r.json?.reason === 'disabled')
}
offServer.kill()

// ── Phase B: kill switch ON, no service key (validation live, storage impossible) ──
const onServer = startServer(3102, { EVENTS_ENABLED: 'true', SUPABASE_SERVICE_KEY: '' })
await sleep(2500)

{ const r = await post(3102, goodEvent({ event: 'made_up_event' })); check('unknown event name rejected (400)', r.status === 400) }
{ const r = await post(3102, goodEvent({ hacker_field: 'x' })); check('unknown property REJECTED, not dropped (400)', r.status === 400 && /unknown property/.test(r.json?.error || '')) }
{ const r = await post(3102, goodEvent({ user_id: randomUUID() })); check('body-supplied user_id rejected (400)', r.status === 400) }
{ const r = await post(3102, goodEvent({ id: 'not-a-uuid' })); check('non-uuid event id rejected (400)', r.status === 400) }
{ const r = await post(3102, goodEvent({ anon_id: 'test-anon-0001' })); check('non-uuid anon_id rejected (400)', r.status === 400) }
{ const r = await post(3102, goodEvent({ session_id: 'sess-1234-not-uuid' })); check('non-uuid session_id rejected (400)', r.status === 400) }
{ const r = await post(3102, goodEvent({ app_version: 'v1.6-beta!' })); check('malformed app_version rejected (400)', r.status === 400) }
{ const r = await post(3102, goodEvent({ event: 'dish_shared', channel: 'carrier-pigeon' })); check('invalid channel enum rejected (400)', r.status === 400) }
{ const r = await post(3102, goodEvent({ event: 'ingredients_submitted', ingredient_count: 500 })); check('out-of-range ingredient_count rejected (400)', r.status === 400) }
{ const r = await post(3102, goodEvent({ event: 'voice_session_started' })); check('server-only event rejected on client endpoint (400)', r.status === 400) }
{ const r = await post(3102, goodEvent({ reported_client_ts: 'yesterday-ish' })); check('malformed client timestamp rejected (400)', r.status === 400) }
{
  const big = JSON.stringify(goodEvent()) + ' '.repeat(3000)
  const r = await post(3102, big)
  check('FIXED-LENGTH oversize rejected (413)', r.status === 413)
}
{
  const status = await postChunked(3102, 4000)
  check('CHUNKED oversize without Content-Length rejected (413)', status === 413, `got ${status}`)
}
{
  const r = await post(3102, goodEvent(), { Authorization: 'Bearer this-is-not-a-real-jwt' })
  check('invalid JWT is a hard 401, never silent-anonymous', r.status === 401, `got ${r.status}`)
}
{
  const r = await post(3102, goodEvent({ event: 'identity_linked' }))
  check('identity_linked without verified token rejected (401)', r.status === 401, `got ${r.status}`)
}
{ const r = await post(3102, goodEvent()); check('valid event with storage unconfigured returns 503 (no silent success)', r.status === 503) }
{
  let last = null
  const anon = randomUUID()
  for (let i = 0; i < 65; i++) last = await post(3102, goodEvent({ anon_id: anon }))
  check('rate limit trips within a minute (429)', last.status === 429)
}
onServer.kill()

// ── Phase C: in-process unit tests (SC_TEST_NO_LISTEN) ───────────────────────
process.env.SC_TEST_NO_LISTEN = '1'
process.env.EVENTS_ENABLED = ''
const { __test } = await import('../server.js')
{
  const ok = __test.validateEvent(
    { id: randomUUID(), event: 'voice_session_started', anon_id: randomUUID(), session_id: randomUUID(), app_version: '0.0.0' },
    null, __test.EVENT_NAMES_SERVER)
  check('server event with explicit "0.0.0" missing-version classification validates', !ok.error && ok.row.app_version === '0.0.0')
}
{
  const bad = __test.validateEvent(
    { id: randomUUID(), event: 'voice_session_started', anon_id: randomUUID(), session_id: randomUUID(), app_version: 'garbage!!' },
    null, __test.EVENT_NAMES_SERVER)
  check('server event with malformed version rejected at validation', !!bad.error)
}
{
  const ok = __test.validateEvent(
    { id: randomUUID(), event: 'voice_session_disconnected', anon_id: randomUUID(), session_id: randomUUID(), app_version: '1.6.0', turn_count: 3, duration_seconds: 120, close_code: 1006 },
    null, __test.EVENT_NAMES_SERVER)
  check('raw numeric close_code stored uninterpreted', !ok.error && ok.row.close_code === 1006)
}
{
  const bad = __test.validateEvent(
    { id: randomUUID(), event: 'voice_session_disconnected', anon_id: randomUUID(), session_id: randomUUID(), app_version: '1.6.0', close_code: 99999 },
    null, __test.EVENT_NAMES_SERVER)
  check('out-of-range close_code rejected', !!bad.error)
}

{
  const mk = (v) => __test.validateEvent(
    { id: randomUUID(), event: 'voice_session_started', anon_id: randomUUID(), session_id: randomUUID(), app_version: v },
    null, __test.EVENT_NAMES_SERVER)
  check("strict version: '1.6.0' accepted", !mk('1.6.0').error)
  check("strict version: '0.0.0' accepted (explicit unknown)", !mk('0.0.0').error)
  check("strict version: '1..' rejected", !!mk('1..').error)
  check("strict version: '1.' rejected", !!mk('1.').error)
  check("strict version: '1.6' rejected (x.y.z required)", !!mk('1.6').error)
  check('strict version: missing version rejected', !!mk(undefined).error)
}
{
  const ok = __test.validateEvent(
    { id: randomUUID(), event: 'voice_session_disconnected', anon_id: randomUUID(), session_id: randomUUID(), app_version: '1.6.0', turn_count: 2, duration_seconds: 30 },
    null, __test.EVENT_NAMES_SERVER)
  check('missing WebSocket close code stays absent/null', !ok.error && ok.row.close_code === undefined)
}
{
  const { readFileSync } = await import('node:fs')
  const sql = readFileSync('supabase/migrations/20260815180000_create_app_events.sql', 'utf8')
  check('migration: intro once-per-user unique index present', sql.includes('app_events_intro_once_per_user') && sql.includes("event = 'micheli_intro_triggered'"))
  check('migration: identity-link idempotency index present', sql.includes('app_events_identity_link_once'))
  check('migration: app_version NOT NULL with strict pattern', /app_version text not null check/.test(sql))
}

const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
