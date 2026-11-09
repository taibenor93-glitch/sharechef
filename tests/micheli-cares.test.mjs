// Micheli Cares tests: parent check-ins when a teen cooks.
// Run: node tests/micheli-cares.test.mjs
//
// No Supabase, no Apple, no network: links, tokens, the Apple sender and the
// clock are all injected fakes. Covers the honest wording, the Apple token
// format, de-duplication, the 5-minute safety net, and failure handling.

import crypto from 'node:crypto'
import {
  caresMessage,
  cleanName,
  buildApnsJwt,
  normalizeP8,
  apnsConfigFromEnv,
  createApnsSender,
  createCares,
  caresInstruction,
  HEAT_AND_SAFETY_PROMPT,
  CARES_TOOL,
  SAFETY_NET_MS,
} from '../micheli-cares.js'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const quietLog = { warn() {}, error() {} }

// ── Wording: only what the teen told Micheli, never "the stove is safe" ──────
{
  const on = caresMessage('on', 'Maya')
  const off = caresMessage('off', 'Maya')
  const un = caresMessage('unconfirmed', 'Maya')
  check('title is Micheli Cares', on.title === 'Micheli Cares 💛')
  check('on names the teen', on.body.includes('Maya') && on.body.includes('stove on'))
  check('off says the teen SAID it is off', off.body.includes('said the stove is off'))
  check('unconfirmed asks for a call', un.body.includes("hasn't confirmed") && un.body.includes('call'))
  const all = [on.body, off.body, un.body].join(' ').toLowerCase()
  check('no message claims the stove is safe', !all.includes('is safe') && !all.includes('you can relax'))
  check('blank name falls back', cleanName('   ') === 'Your teen')
  check('control characters stripped', cleanName('Ma\nya') === 'Maya')
  check('long names cut to 40', cleanName('x'.repeat(80)).length === 40)
  let threw = false
  try { caresMessage('maybe', 'Maya') } catch { threw = true }
  check('unknown kind refused', threw)
}

// ── Micheli's instructions ──────────────────────────────────────────────────
{
  check('heat coaching covers too hot', HEAT_AND_SAFETY_PROMPT.includes('too hot'))
  check('heat coaching covers too low', HEAT_AND_SAFETY_PROMPT.includes('turn it up a little'))
  check('emergency: no water on grease fire', HEAT_AND_SAFETY_PROMPT.includes('never use water'))
  check('emergency: call 911', HEAT_AND_SAFETY_PROMPT.includes('911'))
  check('cares: never claim to know', caresInstruction().includes('Never say you know the stove is off'))
  check('cares: carried "on" mentioned only when true',
    caresInstruction(true).includes('may still be on') && !caresInstruction(false).includes('may still be on'))
  check('tool accepts only on/off', JSON.stringify(CARES_TOOL.parameters.properties.status.enum) === '["on","off"]')
}

// ── Apple token (JWT) ───────────────────────────────────────────────────────
{
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const jwt = buildApnsJwt({ keyId: 'KEYID12345', teamId: 'TEAMID1234', keyP8: p8, nowSec: 1794236400 })
  const [h, c, s] = jwt.split('.')
  const header = JSON.parse(Buffer.from(h, 'base64url').toString())
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
  check('jwt header ES256 + kid', header.alg === 'ES256' && header.kid === 'KEYID12345')
  check('jwt claims iss + iat', claims.iss === 'TEAMID1234' && claims.iat === 1794236400)
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))
  check('jwt signature verifies (raw 64-byte form)', ok && Buffer.from(s, 'base64url').length === 64)
  const escaped = p8.replace(/\n/g, '\\n')
  check('p8 stored with \\n still works', normalizeP8(escaped) === p8.trim())
  check('config needs all three keys', apnsConfigFromEnv({ APNS_KEY_ID: 'a', APNS_TEAM_ID: 'b' }) === null)
  const cfg = apnsConfigFromEnv({ APNS_KEY_ID: ' a ', APNS_TEAM_ID: 'b', APNS_KEY_P8: p8 })
  check('config trims and defaults bundle id', cfg.keyId === 'a' && cfg.bundleId === 'com.sharechef.app')

  // Sender: production first, sandbox only on BadDeviceToken.
  const hosts = []
  let headersSeen = null
  const send = createApnsSender(cfg, {
    post: async (host, path, headers, body) => {
      hosts.push(host)
      headersSeen = headers
      const payload = JSON.parse(body)
      if (!payload.aps?.alert?.title || payload.aps.sound !== 'default') return { status: 500, reason: 'bad payload' }
      if (path.endsWith('/devtoken') && host === 'api.push.apple.com') return { status: 400, reason: 'BadDeviceToken' }
      return { status: 200, reason: '' }
    },
  })
  const r1 = await send('apptoken', caresMessage('on', 'Maya'))
  check('App Store token sends to production only', r1.ok && hosts.join() === 'api.push.apple.com')
  check('push headers right', headersSeen['apns-topic'] === 'com.sharechef.app' && headersSeen['apns-push-type'] === 'alert' && headersSeen.authorization.startsWith('bearer '))
  hosts.length = 0
  const r2 = await send('devtoken', caresMessage('on', 'Maya'))
  check('Xcode token falls back to sandbox', r2.ok && hosts.join() === 'api.push.apple.com,api.sandbox.push.apple.com')
}

// ── The check-in service ────────────────────────────────────────────────────
function harness({ parents = [{ parentId: 'p1', teenName: 'Maya' }], tokens = [{ userId: 'p1', token: 't1' }], sendOk = true, noSend = false } = {}) {
  const sent = []
  const timers = []
  let clock = Date.parse('2026-11-09T15:00:00Z')
  const cares = createCares({
    loadParents: async () => parents,
    loadTokens: async () => tokens,
    send: noSend ? null : async (token, msg) => { sent.push({ token, body: msg.body }); return sendOk ? { ok: true, status: 200 } : { ok: false, status: 403, reason: 'InvalidProviderToken' } },
    log: quietLog,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t },
    clearTimer: (t) => { t.cleared = true },
    now: () => clock,
  })
  return { cares, sent, timers, advanceDays: (d) => { clock += d * 86400000 } }
}

{
  const { cares, sent } = harness()
  const out = await cares.checkIn('teen', 'on')
  check('"on" sends one check-in', sent.length === 1 && sent[0].body.includes('Maya'))
  check('Micheli told it was sent', out.includes('got a check-in'))
  const again = await cares.checkIn('teen', 'on')
  check('repeated "on" not re-sent', sent.length === 1 && again.includes('already knows'))
  await cares.checkIn('teen', 'off')
  check('"off" sends the done check-in', sent.length === 2 && sent[1].body.includes('said the stove is off'))
  const bad = await cares.checkIn('teen', 'hot')
  check('anything but on/off refused', sent.length === 2 && bad.includes('Only'))
}

{
  const { cares, sent, timers } = harness()
  await cares.checkIn('teen', 'on')
  check('safety net starts when cook ends with stove on', cares.sessionEnded('teen') === true && timers.length === 1 && timers[0].ms === SAFETY_NET_MS)
  timers[0].fn()
  await new Promise((r) => setImmediate(r))
  check('safety net sends "not confirmed" after 5 min', sent.length === 2 && sent[1].body.includes("hasn't confirmed"))
}

{
  const { cares, sent, timers } = harness()
  await cares.checkIn('teen', 'on')
  cares.sessionEnded('teen')
  check('teen comes back: resumed with stove on', cares.sessionStarted('teen') === 'resumed-on' && timers[0].cleared)
  await cares.checkIn('teen', 'off')
  check('then "off" sends normally', sent.length === 2 && sent[1].body.includes('said the stove is off'))
  check('no safety net after "off"', cares.sessionEnded('teen') === false)
}

{
  const { cares, sent } = harness()
  await cares.checkIn('teen', 'off')
  cares.sessionEnded('teen')
  check('fresh session forgets yesterday', cares.sessionStarted('teen') === 'fresh')
  await cares.checkIn('teen', 'off')
  check('so a new "off" is sent again', sent.length === 2)
}

{
  const { cares, sent } = harness({ sendOk: false })
  const out = await cares.checkIn('teen', 'on')
  check('Apple refusal: Micheli does not claim it was sent', sent.length === 1 && out.includes('could not reach'))
}
{
  const { cares } = harness({ noSend: true })
  const out = await cares.checkIn('teen', 'on')
  check('no Apple keys: honest fallback', out.includes('could not reach'))
}
{
  const { cares, sent } = harness({ parents: [] })
  await cares.checkIn('teen', 'on')
  check('unlinked teen: nothing sent', sent.length === 0)
}
{
  const { cares, sent } = harness({
    parents: [{ parentId: 'p1', teenName: 'Maya' }, { parentId: 'p2', teenName: 'Maya' }],
    tokens: [{ userId: 'p1', token: 'a' }, { userId: 'p1', token: 'b' }, { userId: 'p2', token: 'c' }],
  })
  await cares.checkIn('teen', 'on')
  check('two parents, three phones: all three buzz', sent.length === 3)
}
{
  const throwing = createCares({
    loadParents: async () => [{ parentId: 'p1', teenName: 'Maya' }],
    loadTokens: async () => [{ userId: 'p1', token: 't' }],
    send: async () => { throw new Error('bad key') },
    log: quietLog,
  })
  const out = await throwing.checkIn('teen', 'on')
  check('mistyped key never crashes the cook', out.includes('could not reach'))
}
{
  const { cares, sent, advanceDays } = harness()
  for (let i = 0; i < 40; i++) await cares.checkIn('teen', i % 2 ? 'off' : 'on')
  check('daily cap stops runaway check-ins', sent.length === 30, `sent ${sent.length}`)
  advanceDays(1)
  cares.sessionStarted('teen')
  await cares.checkIn('teen', 'on')
  check('cap resets the next day', sent.length === 31)
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
