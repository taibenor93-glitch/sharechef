// Micheli Cares: parent check-ins when a teen cooks with Micheli.
//
// What it does, plainly:
//   - The teen tells Micheli "the stove is on" or "the stove is off".
//   - Micheli calls the stove_check_in tool (see CARES_TOOL below).
//   - This module sends the linked parent(s) a push notification through Apple.
//   - Safety net: if a cook ends while the last thing the teen said was "on",
//     the parent gets a "not confirmed off" check-in after 5 minutes, unless
//     the teen reports "off" first (in this session or a new one).
//
// Honesty rule: Micheli cannot see the stove. Every message says what the
// teen TOLD Micheli, never that the stove "is" safe.
//
// Built on Node's own http2 + crypto, so it adds no packages.
//
// Railway variables it reads (all four are needed for check-ins to send):
//   APNS_KEY_ID     the Key ID shown on Apple's Keys page
//   APNS_TEAM_ID    the Team ID shown on Apple's Membership page
//   APNS_KEY_P8     the full text of the AuthKey_XXXX.p8 file
//   APNS_BUNDLE_ID  optional, defaults to com.sharechef.app

import http2 from 'node:http2'
import crypto from 'node:crypto'

export const SAFETY_NET_MS = 5 * 60 * 1000
const JWT_REFRESH_MS = 50 * 60 * 1000 // Apple accepts a token for up to 60 minutes
const DAILY_CAP_PER_TEEN = 30 // runaway guard; a real cook sends a handful

// ── What Micheli is told ────────────────────────────────────────────────────

// Heat coaching and the emergency rule apply to every cook, teen or not.
export const HEAT_AND_SAFETY_PROMPT = `

Heat: You cannot sense the stove, so coach heat from what they tell you. Name a burner setting for each step (low, medium, or medium-high). When heat matters, ask what they see or hear. A soft, steady sizzle is right. Loud popping, smoke, or a burning smell means it is too hot: tell them to turn it down a little, or slide the pan off the burner for a moment. No sizzle after a minute, or onions still pale after five minutes, means turn it up a little.

Safety comes before the recipe: If they mention fire, flames, smoke that will not stop, a burn, or anything that sounds dangerous, stop talking about the food and calmly say: turn off the burner and step back. For a grease or pan fire, never use water; cover it with a lid or a baking sheet only if it is safe to reach. If the fire is not out right away, or anyone is hurt, leave the kitchen and call 911 or the local emergency number. For a small burn, cool it under cool running water.`

// Added only when the signed-in cook is linked to a parent through Micheli Cares.
export function caresInstruction(stoveStillOn = false) {
  const carried = stoveStillOn
    ? ' Earlier in this cook they said the stove is on and have not said it is off yet, so it may still be on.'
    : ''
  return `

Micheli Cares is on for this cook: their parent gets a check-in when the stove goes on and when it goes off. When the user tells you they turned a burner, the stove, or the oven on, call stove_check_in with status "on". When they tell you it is off, call stove_check_in with status "off". Call it only for what they actually said, never on a guess. When they say they are done, or the meal is ready, and they turned the stove on earlier but have not said it is off, ask them to turn it off and tell you before you say goodbye. Never say you know the stove is off; you only know what they tell you. Check in about the heat a little more often than usual, and keep it warm and encouraging, never nagging.${carried}`
}

export const CARES_TOOL = {
  type: 'function',
  name: 'stove_check_in',
  description:
    "Let the cook's parent know the stove was turned on or off, based only on what the cook just told you.",
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['on', 'off'],
        description: 'What the cook said: they turned the stove on, or they turned it off.',
      },
    },
    required: ['status'],
  },
}

// ── What the parent reads ───────────────────────────────────────────────────

export function cleanName(raw) {
  const name = String(raw || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40)
  return name || 'Your teen'
}

export function caresMessage(kind, teenName) {
  const name = cleanName(teenName)
  const title = 'Micheli Cares 💛'
  if (kind === 'on') return { title, body: `${name} is cooking with Micheli and turned the stove on.` }
  if (kind === 'off') return { title, body: `${name} just finished a home cooked meal with Micheli and said the stove is off. 💛` }
  if (kind === 'unconfirmed') return { title, body: `${name} finished cooking but hasn't confirmed the stove is off. Give ${name} a quick call.` }
  throw new Error(`unknown check-in kind: ${kind}`)
}

// ── Apple push (APNs) ───────────────────────────────────────────────────────

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

// Railway may store the .p8 text with literal "\n" instead of line breaks.
export function normalizeP8(raw) {
  return String(raw || '').replace(/\\n/g, '\n').trim()
}

export function buildApnsJwt({ keyId, teamId, keyP8, nowSec }) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }))
  const claims = b64url(JSON.stringify({ iss: teamId, iat: nowSec }))
  const signingInput = `${header}.${claims}`
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: normalizeP8(keyP8),
    dsaEncoding: 'ieee-p1363', // JWT wants raw r||s, not DER
  })
  return `${signingInput}.${b64url(sig)}`
}

export function apnsConfigFromEnv(env) {
  const cfg = {
    keyId: (env.APNS_KEY_ID || '').trim(),
    teamId: (env.APNS_TEAM_ID || '').trim(),
    keyP8: env.APNS_KEY_P8 || '',
    bundleId: (env.APNS_BUNDLE_ID || 'com.sharechef.app').trim(),
  }
  return cfg.keyId && cfg.teamId && cfg.keyP8 ? cfg : null
}

// One HTTP/2 request to Apple. Resolves { status, reason }; never rejects.
function http2Post(host, path, headers, body, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let done = false
    const finish = (r) => { if (!done) { done = true; resolve(r) } }
    let client
    try {
      client = http2.connect(`https://${host}`)
    } catch (err) {
      return finish({ status: 0, reason: err.message })
    }
    client.on('error', (err) => finish({ status: 0, reason: err.message }))
    const req = client.request({ ':method': 'POST', ':path': path, ...headers })
    let status = 0
    let data = ''
    req.setEncoding('utf8')
    req.on('response', (h) => { status = Number(h[':status']) || 0 })
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      let reason = ''
      try { reason = data ? JSON.parse(data).reason || '' : '' } catch { reason = data.slice(0, 100) }
      finish({ status, reason })
      client.close()
    })
    req.on('error', (err) => { finish({ status: 0, reason: err.message }); client.close() })
    req.setTimeout(timeoutMs, () => { finish({ status: 0, reason: 'timeout' }); req.close(); client.close() })
    req.end(body)
  })
}

export function createApnsSender(cfg, { post = http2Post, now = () => Date.now() } = {}) {
  let jwt = null
  let jwtMadeAt = 0
  const bearer = () => {
    if (!jwt || now() - jwtMadeAt > JWT_REFRESH_MS) {
      jwt = buildApnsJwt({ keyId: cfg.keyId, teamId: cfg.teamId, keyP8: cfg.keyP8, nowSec: Math.floor(now() / 1000) })
      jwtMadeAt = now()
    }
    return jwt
  }
  return async function send(deviceToken, { title, body }) {
    const payload = JSON.stringify({ aps: { alert: { title, body }, sound: 'default' } })
    const headers = {
      authorization: `bearer ${bearer()}`,
      'apns-topic': cfg.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    }
    const path = `/3/device/${deviceToken}`
    // App Store / TestFlight phones use Apple's production server; phones running
    // a build straight from Xcode use the sandbox. The token says which, so try
    // production first and fall back once if Apple says the token is not its.
    let res = await post('api.push.apple.com', path, headers, payload)
    if (res.status === 400 && res.reason === 'BadDeviceToken') {
      res = await post('api.sandbox.push.apple.com', path, headers, payload)
    }
    return { ok: res.status === 200, status: res.status, reason: res.reason }
  }
}

// ── The check-in service ────────────────────────────────────────────────────
//
// deps:
//   loadParents(teenId)  -> [{ parentId, teenName }]  (service-role read of cares_links)
//   loadTokens(parentIds) -> [{ userId, token }]       (service-role read of cares_push_tokens)
//   send(token, message)  -> { ok, status, reason }    (null when Apple keys are missing)
export function createCares({
  loadParents,
  loadTokens,
  send,
  log = console,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => Date.now(),
}) {
  const pendingSafety = new Map() // teenId -> timer
  const lastStatus = new Map() // teenId -> 'on' | 'off'
  const daily = new Map() // teenId -> { day, count }

  function underCap(teenId) {
    const day = new Date(now()).toISOString().slice(0, 10)
    const entry = daily.get(teenId)
    if (!entry || entry.day !== day) { daily.set(teenId, { day, count: 1 }); return true }
    if (entry.count >= DAILY_CAP_PER_TEEN) return false
    entry.count++
    return true
  }

  async function notify(teenId, kind) {
    if (!send) { log.warn('[cares] Apple push keys not set; check-in not sent'); return { sent: 0 } }
    if (!underCap(teenId)) { log.warn('[cares] daily cap reached; check-in not sent'); return { sent: 0 } }
    let parents = []
    try { parents = (await loadParents(teenId)) || [] } catch (err) { log.error('[cares] parents lookup failed:', err.message); return { sent: 0 } }
    if (parents.length === 0) return { sent: 0 }
    let tokens = []
    try { tokens = (await loadTokens(parents.map((p) => p.parentId))) || [] } catch (err) { log.error('[cares] token lookup failed:', err.message); return { sent: 0 } }
    const nameFor = new Map(parents.map((p) => [p.parentId, p.teenName]))
    let sent = 0
    await Promise.all(tokens.map(async ({ userId, token }) => {
      let res
      try {
        res = await send(token, caresMessage(kind, nameFor.get(userId)))
      } catch (err) {
        res = { ok: false, status: 0, reason: err.message } // e.g. a mistyped APNS_KEY_P8
      }
      if (res.ok) sent++
      // Ids and tokens stay out of the logs; Apple's reason is enough to debug.
      else log.error(`[cares] Apple refused a check-in: ${res.status} ${res.reason || ''}`.trim())
    }))
    return { sent }
  }

  function cancelSafetyNet(teenId) {
    const t = pendingSafety.get(teenId)
    if (t) { clearTimer(t); pendingSafety.delete(teenId) }
  }

  // Micheli called stove_check_in. Returns the text handed back to Micheli.
  async function checkIn(teenId, status) {
    if (status !== 'on' && status !== 'off') return 'Only "on" or "off" can be shared.'
    cancelSafetyNet(teenId)
    if (lastStatus.get(teenId) === status) {
      return status === 'on'
        ? 'Their parent already knows the stove is on. Keep cooking.'
        : 'Their parent already knows the stove is off.'
    }
    lastStatus.set(teenId, status)
    const { sent } = await notify(teenId, status)
    if (sent === 0) {
      return 'The check-in could not reach their parent right now. Do not tell the cook it was sent; keep cooking safely.'
    }
    return status === 'on'
      ? 'Their parent got a check-in that the stove is on. Do not dwell on it; keep cooking.'
      : 'Their parent got a check-in that the stove is off. You can say a warm goodbye when they are ready.'
  }

  // A voice session opened for a linked teen. A pending safety net is paused
  // (they are back, often after the phone locked mid-cook) and "on" is kept,
  // so it restarts if this session also ends without an "off". With nothing
  // pending, any status left from an earlier day is forgotten.
  function sessionStarted(teenId) {
    if (pendingSafety.has(teenId)) { cancelSafetyNet(teenId); return 'resumed-on' }
    lastStatus.delete(teenId)
    return 'fresh'
  }

  // The voice session closed. If the last word was "on", start the safety net.
  function sessionEnded(teenId) {
    if (lastStatus.get(teenId) !== 'on') return false
    cancelSafetyNet(teenId)
    const t = setTimer(() => {
      pendingSafety.delete(teenId)
      if (lastStatus.get(teenId) !== 'on') return
      lastStatus.delete(teenId)
      void notify(teenId, 'unconfirmed')
    }, SAFETY_NET_MS)
    if (t && typeof t.unref === 'function') t.unref()
    pendingSafety.set(teenId, t)
    return true
  }

  return { checkIn, sessionStarted, sessionEnded, _pendingSafety: pendingSafety, _lastStatus: lastStatus }
}
