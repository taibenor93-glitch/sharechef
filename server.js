import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import OpenAI from 'openai'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const app = express()
const server = createServer(app)
const PORT = process.env.PORT || 3000

app.use(cors())

// ── Phase 1 funnel events endpoint ───────────────────────────────────────────
// Registered BEFORE the global body parser so its own 2 KB limit is the real
// boundary: express.json({limit}) rejects oversized bodies — fixed-length AND
// chunked — during parsing, before any event processing runs.
app.post('/api/events', express.json({ limit: '2kb' }), async (req, res) => {
  try {
    if (!EVENTS_ENABLED) return res.status(202).json({ stored: false, reason: 'disabled' })

    // Authenticated user id comes exclusively from a verified JWT. A supplied
    // but invalid token is a hard 401 — never silently downgraded to anonymous.
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    let verifiedUserId = null
    if (token) {
      const u = await verifyUser(token)
      if (!u) return res.status(401).json({ error: 'invalid token' })
      verifiedUserId = u.id
    }
    // identity_linked is meaningless without a verified account.
    if (req.body?.event === 'identity_linked' && !verifiedUserId) {
      return res.status(401).json({ error: 'identity_linked requires a verified token' })
    }

    const checked = validateEvent(req.body, verifiedUserId, EVENT_NAMES_CLIENT)
    if (checked.error) return res.status(400).json({ error: checked.error })

    const rlKey = checked.row.anon_id || req.ip || 'unknown'
    if (rateLimited(rlKey)) return res.status(429).json({ error: 'rate limited' })

    const result = await recordEvent(checked.row)
    if (result.reason === 'not-configured') return res.status(503).json({ error: 'events not configured' })
    if (result.reason === 'error') return res.status(503).json({ error: 'storage error, retry' }) // honest retriable signal
    return res.status(result.stored ? 201 : 202).json(result)
  } catch (err) {
    console.error('[events] endpoint error:', err.message)
    return res.status(500).json({ error: 'internal' })
  }
})
// Body-parser errors on this route (oversize, malformed JSON) → clean JSON status.
app.use('/api/events', (err, _req, res, _next) => {
  const status = err?.type === 'entity.too.large' ? 413 : err?.status || 400
  res.status(status).json({ error: status === 413 ? 'payload too large' : 'bad request' })
})

// ── Account deletion (Revision 6) ────────────────────────────────────────────
// PERMANENT, privacy-first account deletion. Requires a RECENT password method
// entry in the verified JWT's `amr` claim. Refreshing a session can issue a new
// token but does not turn the original authentication method timestamp into a
// new password proof.
// The password itself goes only from the client to Supabase auth; this server
// never sees, accepts, or logs it.
// Analytics removal is explicit and privacy-first (reviewer-approved): every
// app_events row carrying ANY of the user's installation ids is removed — even
// rows another household member generated on a shared installation. Functional
// data of other users is never touched (it is keyed by their own user_id).
// Hard delete only (shouldSoftDelete=false); production CASCADE FKs then remove
// profiles, recipes, shares, cook_sessions, micheli_memory in one step.
const REAUTH_WINDOW_MS = 5 * 60 * 1000 // 5 min: narrow, documented reauth window
const DELETE_MAX_PER_HOUR = 5
const deleteBuckets = new Map() // ip → { hourStart, count } (per-process, best-effort)
function deleteRateLimited(key) {
  const now = Date.now()
  let b = deleteBuckets.get(key)
  if (!b || now - b.hourStart > 3600_000) { b = { hourStart: now, count: 0 }; deleteBuckets.set(key, b) }
  b.count++
  if (deleteBuckets.size > 5000) deleteBuckets.clear() // memory ceiling
  return b.count > DELETE_MAX_PER_HOUR
}

// Supabase JWT `amr` timestamps are epoch seconds. Require a password entry in
// the narrow window; account-wide last_sign_in_at is not sufficient because a
// login on another device could otherwise authorize this token.
function isRecentPasswordAuth(amr, now = Date.now()) {
  if (!Array.isArray(amr)) return false
  return amr.some((entry) => {
    if (!entry || entry.method !== 'password' || !Number.isFinite(entry.timestamp)) return false
    const t = Number(entry.timestamp) * 1000
    if (t > now + 60_000) return false
    return now - t <= REAUTH_WINDOW_MS
  })
}

// Admin client (service-role) — created lazily, server-side only. Independent of
// the analytics kill switch: deletion must work even with analytics OFF.
let adminDb = null
function adminClient() {
  if (!process.env.SUPABASE_SERVICE_KEY || !process.env.SUPABASE_URL) return null
  if (!adminDb) {
    adminDb = createSupabaseClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })
  }
  return adminDb
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token).split('.')
    if (parts.length !== 3) return null
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch { return null }
}

// Verify the token with Supabase first, then read its signed claims. There is
// deliberately no environment-controlled fake-token path in production code.
async function verifyUserForDeletion(token) {
  if (!supabaseAuth || !token) return null
  try {
    const { data, error } = await supabaseAuth.auth.getUser(token)
    if (error || !data?.user) return null
    const claims = decodeJwtPayload(token)
    if (!claims || claims.sub !== data.user.id) return null
    return { id: data.user.id, amr: claims.amr }
  } catch { return null }
}

// In-process dependency seam for offline tests. It is unreachable over HTTP
// and cannot be activated by a production environment variable.
let deletionUserVerifier = verifyUserForDeletion

// Core deletion, separated for direct testing with a fake db. Idempotent and
// retry-safe: re-running any step removes nothing new; after a partial failure
// the retry is safe because analytics disappearing first is the privacy-correct
// failure mode. Never touches another user's functional data.
async function performAccountDeletion(db, userId) {
  // 1) Collect every installation id ever attributed to this user.
  const { data: rows, error: selErr } = await db.from('app_events').select('anon_id').eq('user_id', userId)
  if (selErr) return { ok: false, step: 'collect' }
  const anonIds = [...new Set((rows || []).map((r) => r?.anon_id).filter(Boolean))]
  // 2) Privacy-first purge: all rows for those installations (over-deletion of a
  //    shared household member's analytics is approved), then any remaining rows
  //    carrying the user_id (retry safety net — normally covered by step 2a).
  if (anonIds.length > 0) {
    const { error } = await db.from('app_events').delete().in('anon_id', anonIds)
    if (error) return { ok: false, step: 'analytics-anon' }
  }
  const { error: delUserErr } = await db.from('app_events').delete().eq('user_id', userId)
  if (delUserErr) return { ok: false, step: 'analytics-user' }
  // 3) HARD delete of the auth user (shouldSoftDelete=false — never soft).
  //    Production ON DELETE CASCADE removes all functional data atomically.
  const { error: adminErr } = await db.auth.admin.deleteUser(userId, false)
  if (adminErr) return { ok: false, step: 'auth' }
  return { ok: true }
}

app.post('/api/account/delete', express.json({ limit: '1kb' }), async (req, res) => {
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return res.status(401).json({ error: 'authentication required' })
    // Strict validation: NO body fields accepted, ever. The target account comes
    // ONLY from the verified token — a body-supplied user id is an instant 400.
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      return res.status(400).json({ error: 'no body fields accepted' })
    }
    if (deleteRateLimited(req.ip || 'unknown')) return res.status(429).json({ error: 'rate limited' })
    const user = await deletionUserVerifier(token)
    if (!user) return res.status(401).json({ error: 'invalid token' })
    if (!isRecentPasswordAuth(user.amr)) {
      return res.status(403).json({ error: 'recent sign-in required' })
    }
    const db = adminClient()
    if (!db) return res.status(503).json({ error: 'deletion not configured' })
    const result = await performAccountDeletion(db, user.id)
    if (!result.ok) {
      console.error('[account] deletion failed at step:', result.step) // step name only — no ids, no secrets
      return res.status(503).json({ error: 'deletion failed, retry' })
    }
    return res.status(200).json({ deleted: true })
  } catch (err) {
    console.error('[account] endpoint error:', err.message)
    return res.status(500).json({ error: 'internal' })
  }
})
// Body-parser errors on this route → clean JSON status.
app.use('/api/account/delete', (err, _req, res, _next) => {
  const status = err?.type === 'entity.too.large' ? 413 : err?.status || 400
  res.status(status).json({ error: status === 413 ? 'payload too large' : 'bad request' })
})

app.use(express.json())

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Current OpenAI realtime model (the older gpt-4o-realtime-preview was retired).
const REALTIME_MODEL = 'gpt-realtime'
const REALTIME_VOICE = 'shimmer'
// Test sessions only (never real users) — gated by VOICE_TEST_TOKEN below.
const REALTIME_MODEL_TEST = 'gpt-realtime-2.1-mini'
function realtimeUrlFor(model) {
  return `wss://api.openai.com/v1/realtime?model=${model}`
}

// ── Phase 1 funnel events ────────────────────────────────────────────────────
// KILL SWITCH: EVENTS_ENABLED must be exactly 'true' (default OFF).
// Inserts use the service-role key (SUPABASE_SERVICE_KEY) so the table needs no
// RLS policies — clients have zero direct access. Server-generated events call
// recordEvent() directly (no HTTP loopback). All validation is REJECT-based:
// unknown properties fail the whole request, nothing is silently dropped.
const EVENTS_ENABLED = process.env.EVENTS_ENABLED === 'true'
const EVENT_NAMES_CLIENT = new Set([
  'app_opened', 'account_created', 'identity_linked',
  'ingredients_submitted', 'dish_proposed', 'dish_saved', 'dish_shared',
])
const EVENT_NAMES_SERVER = new Set([
  'micheli_intro_triggered', // intro instruction issued — NOT verified audio completion
  'voice_session_started', 'voice_session_ended',
  'voice_session_disconnected', 'voice_session_resumed',
])
const EVENT_PROPS = { // event → allowed optional typed props beyond the standard set
  app_opened: {}, account_created: {}, identity_linked: {},
  ingredients_submitted: { ingredient_count: 'int' },
  dish_proposed: { ingredient_count: 'int' },
  dish_saved: {}, dish_shared: { channel: 'channel' },
  micheli_intro_triggered: {},
  voice_session_started: {},
  voice_session_ended: { turn_count: 'int', duration_seconds: 'int' },
  voice_session_disconnected: { turn_count: 'int', duration_seconds: 'int', close_code: 'int' },
  voice_session_resumed: {},
}
const INT_BOUNDS = { ingredient_count: 99, turn_count: 999, duration_seconds: 86400, close_code: 4999 }
const CHANNELS = new Set(['native', 'whatsapp', 'x', 'facebook', 'copy', 'linkedin', 'instagram', 'tiktok'])
const STANDARD_KEYS = new Set(['id', 'event', 'anon_id', 'session_id', 'app_version', 'reported_client_ts'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const seenEventIds = new Set() // best-effort in-memory dedupe; DB unique index is authoritative

let eventsDb = null
function eventsClient() {
  if (!EVENTS_ENABLED || !process.env.SUPABASE_SERVICE_KEY || !process.env.SUPABASE_URL) return null
  if (!eventsDb) {
    eventsDb = createSupabaseClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })
  }
  return eventsDb
}

// Best-effort rate limiting (documented: per-process, resets on restart, not a
// guaranteed global limit across replicas). anon_id-keyed with an IP fallback.
const rateBuckets = new Map() // key → { minStart, minCount, dayStart, dayCount }
function rateLimited(key) {
  const now = Date.now()
  let b = rateBuckets.get(key)
  if (!b) { b = { minStart: now, minCount: 0, dayStart: now, dayCount: 0 }; rateBuckets.set(key, b) }
  if (now - b.minStart > 60_000) { b.minStart = now; b.minCount = 0 }
  if (now - b.dayStart > 86_400_000) { b.dayStart = now; b.dayCount = 0 }
  b.minCount++; b.dayCount++
  if (rateBuckets.size > 5000) rateBuckets.clear() // memory ceiling
  return b.minCount > 60 || b.dayCount > 1000
}

// Validates one event object. Returns { error } or { row } ready for insert.
// verifiedUserId comes ONLY from a server-verified JWT — never from the body.
function validateEvent(raw, verifiedUserId, allowedNames) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'body must be an object' }
  const allowedProps = EVENT_PROPS[raw.event]
  if (typeof raw.event !== 'string' || !allowedNames.has(raw.event) || !allowedProps) return { error: 'unknown event' }
  for (const key of Object.keys(raw)) {
    if (!STANDARD_KEYS.has(key) && !(key in allowedProps)) return { error: `unknown property: ${key}` } // REJECT, never drop
  }
  if (typeof raw.id !== 'string' || !UUID_RE.test(raw.id)) return { error: 'id must be a uuid' }
  if (typeof raw.anon_id !== 'string' || !UUID_RE.test(raw.anon_id)) return { error: 'anon_id must be a uuid' }
  if (typeof raw.session_id !== 'string' || !UUID_RE.test(raw.session_id)) return { error: 'session_id must be a uuid' }
  // Strict x.y.z, REQUIRED ('0.0.0' is the explicit unknown-version classification).
  if (typeof raw.app_version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(raw.app_version)) return { error: 'bad app_version' }
  let clientTs = null
  if (raw.reported_client_ts !== undefined) {
    if (typeof raw.reported_client_ts !== 'string' || isNaN(Date.parse(raw.reported_client_ts))) return { error: 'bad reported_client_ts' }
    clientTs = new Date(raw.reported_client_ts).toISOString()
  }
  const row = {
    id: raw.id.toLowerCase(),
    event: raw.event,
    anon_id: raw.anon_id.toLowerCase(),
    user_id: verifiedUserId || null,
    session_id: raw.session_id.toLowerCase(),
    app_version: raw.app_version,
    reported_client_ts: clientTs,
    // occurred_at: DB default now() — server-authoritative, never client-supplied
  }
  for (const [key, kind] of Object.entries(allowedProps)) {
    const v = raw[key]
    if (v === undefined) continue
    if (kind === 'int') {
      if (!Number.isInteger(v) || v < 0 || v > INT_BOUNDS[key]) return { error: `bad ${key}` }
      row[key] = v
    } else if (kind === 'channel') {
      if (!CHANNELS.has(v)) return { error: 'bad channel' }
      row.channel = v
    }
  }
  return { row }
}

// Shared internal event service: both the HTTP endpoint and server-side emits
// land here. Never makes HTTP calls back to our own endpoint.
async function recordEvent(row) {
  if (!EVENTS_ENABLED) return { stored: false, reason: 'disabled' }
  if (seenEventIds.has(row.id)) return { stored: false, reason: 'duplicate' }
  const db = eventsClient()
  if (!db) return { stored: false, reason: 'not-configured' }
  const { error } = await db.from('app_events').insert(row)
  if (error) {
    // Transient failures must stay retryable: the id enters the dedupe set ONLY
    // on success or on a confirmed database duplicate. The DB primary key is
    // always the deduplication authority.
    if (String(error.code) === '23505') {
      seenEventIds.add(row.id)
      return { stored: false, reason: 'duplicate' }
    }
    console.error('[events] insert failed:', error.message)
    return { stored: false, reason: 'error' }
  }
  seenEventIds.add(row.id)
  if (seenEventIds.size > 10000) seenEventIds.clear()
  return { stored: true }
}

// Server-emitted events (voice lifecycle, intro). Fire-and-forget by callers.
// Identity must be valid UUIDs from a 1.6+ client's auth frame; appVersion is
// the client-reported build version ('0.0' = explicit "instrumented client with
// missing/invalid version" classification — never silently invented).
function emitServerEvent(event, anonId, sessionId, userId, appVersion, props = {}) {
  if (!EVENTS_ENABLED) return
  if (!UUID_RE.test(String(anonId)) || !UUID_RE.test(String(sessionId))) return // no valid identity → no event
  const raw = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : null,
    event, anon_id: anonId, session_id: sessionId,
    app_version: /^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(String(appVersion)) ? appVersion : '0.0.0',
    ...props,
  }
  if (!raw.id) return
  const checked = validateEvent(raw, userId, EVENT_NAMES_SERVER)
  if (checked.error) { console.error('[events] server emit invalid:', event, checked.error); return }
  void recordEvent(checked.row)
}

const MICHELI_PROMPT = `You are Micheli, the warm, accomplished voice of ShareChef AI — a personal cooking companion. You are a woman in your forties with the easy confidence of a seasoned chef and the warmth of someone who genuinely loves feeding people. Your American voice is soft, friendly, and quietly inspiring. You make people feel capable, never judged.

Identity: If anyone asks who you are, say you are Micheli, their cooking companion. Your name is pronounced "mee-SHELL-ee" — always say it exactly that way. Never argue about or correct how the user says your name. Never confuse your own name with the user's name.

How you speak: Talk like a real person standing in a kitchen — natural, flowing, never robotic. No bullet points, no numbered lists, no formatting of any kind. Keep every reply short: two to four spoken sentences.

Language: Speak the session language you are given below. If the user speaks a full clear sentence in a different language, or asks you in any words to change language, switch immediately and follow the user — the language the user is actually speaking right now is always the highest authority, above the session language, above anything you remember, and above any earlier conversation. Ignore single foreign words, accents, unclear audio, and background noise — a language change needs a full clear sentence or an explicit request. Hebrew and Arabic can sound similar to you: if the user speaks Hebrew, always reply in Hebrew and never in Arabic. Only use Arabic if the user is clearly speaking Arabic. Never talk about language or mention switching.

Stay grounded: You can only know what the user tells you in words. You cannot see, hear the room, or observe the kitchen. Never describe or comment on sounds, sights, or anything happening around them — only respond to what they actually say. If what you heard is garbled, incomplete, or sounds like background noise rather than something deliberately said to you, never act on it or build on it — warmly ask them to say it again. Never invent or assume ingredients the user did not name in this conversation.

How you cook with them: Work only with the ingredients the user already has. Never suggest buying anything. Ask one question at a time. Guide one step at a time and wait for them to confirm before moving on. Celebrate small wins naturally — "Perfect, that's exactly right."`

// ── Session language ────────────────────────────────────────────────────────
// Deterministic order: the user's explicit pick (sent by the app) wins; else a
// pick saved on their profile; else the device language from Accept-Language;
// else English. Memory and resumed conversations never decide language.
const LANGUAGE_BY_CODE = {
  en: 'English', es: 'Spanish', fr: 'French', it: 'Italian', de: 'German',
  pt: 'Portuguese', he: 'Hebrew', iw: 'Hebrew', hi: 'Hindi', zh: 'Mandarin',
  ar: 'Arabic', ja: 'Japanese',
}
const KNOWN_LANGUAGES = new Set(Object.values(LANGUAGE_BY_CODE))

// Reverse map, for telling the transcriber which language to expect. Without it
// English speech was being written out in Hebrew letters on screen.
const CODE_BY_LANGUAGE = {
  English: 'en', Spanish: 'es', French: 'fr', Italian: 'it', German: 'de',
  Portuguese: 'pt', Hebrew: 'he', Hindi: 'hi', Mandarin: 'zh',
  Arabic: 'ar', Japanese: 'ja',
}

function languageFromHeader(req) {
  const header = req.headers['accept-language']
  if (!header) return null
  const code = String(header).split(',')[0].trim().toLowerCase().split('-')[0]
  return LANGUAGE_BY_CODE[code] || null
}

function languageInstruction(lang) {
  return `\n\nSession language: ${lang}. This comes from the user's own settings. Open the conversation in ${lang} and speak ${lang}, including every greeting and welcome-back. This setting outranks any language you remember about this user and any language an earlier or resumed conversation was in. Only the user's live speech outranks it, as described above.`
}

// Opening line depends on whether this user has met Micheli before.
// First-timers (and guests, who can't be recognized) get the full introduction;
// everyone else gets a welcome back with no reintroduction.
function greetingInstruction(profile, lang) {
  if (profile && profile.has_met_micheli) {
    return `\n\nBegin this conversation with one short warm welcome-back in ${lang}, asking what ingredients they have today. Never introduce yourself or explain who you are — this user already knows you well.`
  }
  return `\n\nBegin this conversation by introducing yourself in ${lang} with exactly this meaning, spoken naturally in ${lang} (use these exact words when the language is English): "Hello, I'm Micheli, your personal chef. What's in your kitchen tonight?"`
}

// Marks that the user has now met Micheli (their own row, via their own token — RLS applies).
async function markMet(token, profile) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token || !profile || profile.has_met_micheli) return
  try {
    const client = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    await client.from('profiles').update({ has_met_micheli: true }).eq('id', profile.id)
  } catch (err) {
    console.error('[profile] markMet failed:', err.message)
  }
}

// ── Cook-session resume ──────────────────────────────────────────────────────
// While a signed-in user cooks, the proxy keeps the final transcript lines and
// periodically saves the tail to their cook_sessions row (their own token, RLS).
// If they reconnect within the window (phone locked, app switched), Micheli is
// briefed on where they were and continues instead of starting over.
const RESUME_WINDOW_MS = 20 * 60 * 1000 // 20 min — covers a locked phone mid-cook; old builds that can't send "end_session" stop resurrecting dead sessions

function tokenClient(token) {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

async function loadCookState(token) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token) return null
  try {
    const { data, error } = await tokenClient(token)
      .from('cook_sessions')
      .select('lines, updated_at, language')
      .maybeSingle()
    if (error || !data || !data.updated_at) return null
    if (Date.now() - new Date(data.updated_at).getTime() > RESUME_WINDOW_MS) return null
    if (!Array.isArray(data.lines) || data.lines.length === 0) return null
    return data
  } catch (err) {
    console.error('[cook] load failed:', err.message)
    return null
  }
}

// A deliberate "End session" closes the cook: empty lines mean nothing to resume.
async function clearCookState(token, userId) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token || !userId) return
  try {
    await tokenClient(token).from('cook_sessions').upsert({
      user_id: userId,
      lines: [],
      language: null,
      updated_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[cook] clear failed:', err.message)
  }
}

async function saveCookState(token, userId, lines, language) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token || !userId || lines.length === 0) return
  try {
    await tokenClient(token).from('cook_sessions').upsert({
      user_id: userId,
      lines,
      language: language || null,
      updated_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[cook] save failed:', err.message)
  }
}

// ── Guest cook-session resume (in-memory — guests have no auth.uid(), so the
// RLS-scoped cook_sessions table can never hold their state; that's by design,
// not a bug). Keyed by a random id the client keeps in sessionStorage for the
// tab's life. Lost on a server restart — same as any OpenAI Realtime session
// losing its own history on any drop, so that's an acceptable ceiling.
const GUEST_COOK_CAP = 300
const guestCookState = new Map() // guestId -> { lines, language, updatedAt }

function loadGuestCookState(guestId) {
  if (!guestId) return null
  const entry = guestCookState.get(guestId)
  if (!entry) return null
  if (Date.now() - entry.updatedAt > RESUME_WINDOW_MS) {
    guestCookState.delete(guestId)
    return null
  }
  if (!Array.isArray(entry.lines) || entry.lines.length === 0) return null
  return { lines: entry.lines, updated_at: new Date(entry.updatedAt).toISOString(), language: entry.language || null }
}

function saveGuestCookState(guestId, lines, language) {
  if (!guestId || lines.length === 0) return
  if (!guestCookState.has(guestId) && guestCookState.size >= GUEST_COOK_CAP) {
    const oldest = [...guestCookState.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]
    if (oldest) guestCookState.delete(oldest[0])
  }
  guestCookState.set(guestId, { lines, updatedAt: Date.now(), language: language || null })
}

function clearGuestCookState(guestId) {
  if (!guestId) return
  guestCookState.delete(guestId)
}

function resumeInstruction(cookState) {
  if (!cookState) return ''
  const convo = cookState.lines
    .map((l) => `${l.who === 'user' ? 'User' : 'You'}: ${l.text}`)
    .join('\n')
  return `\n\nEarlier today you were already cooking with this user, then the conversation was interrupted. The last things said were:\n${convo}\n\nInstead of any other opening, begin by warmly picking up where you left off — in one short sentence remind them exactly where you were (the dish and the step), then continue guiding from there. If that earlier conversation clearly shows the dish was finished, ignore it and instead say, in the session language, a line with exactly this meaning: "Welcome back! What ingredients are we working with today?" Never reintroduce yourself, never say your own name, and never say hello as if meeting them — you are mid-conversation with someone you know. Speak in the session language given above, even if that earlier conversation happened in a different language — and if the user now speaks a different language in full clear sentences, follow the user. Say the welcome-back line in the session language too.`
}

// A reconnect happened (client-confirmed a real conversation was already under
// way), but there is no cookState to resume — expired, never saved in time, or
// this server restarted. Never let Micheli claim a dish, ingredient, or step
// that isn't backed by real state above; ask instead of inventing one.
function droppedReconnectInstruction(lang) {
  return `\n\nThe connection just dropped and reconnected, but you have no record of what was being cooked before — do not guess, invent, or name any dish, ingredient, or step. In one short sentence in ${lang}, acknowledge you lost the connection and ask what they were cooking, or what they have to cook with. Never reintroduce yourself or say your own name — they already know you, you just don't have this cook's details.`
}

// ── Long-term memory ─────────────────────────────────────────────────────────
// After each meaningful voice session, the transcript is distilled into a short
// rolling summary per user (micheli_memory, own token, RLS). Next session, the
// summary is folded into Micheli's instructions so she remembers them over time.
async function loadMemory(token) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token) return null
  try {
    const { data, error } = await tokenClient(token)
      .from('micheli_memory')
      .select('summary')
      .maybeSingle()
    if (error || !data || !data.summary || !data.summary.trim()) return null
    return data.summary.trim()
  } catch (err) {
    console.error('[memory] load failed:', err.message)
    return null
  }
}

function memoryInstruction(summary) {
  if (!summary) return ''
  return `\n\nWhat you remember about this user from cooking together before: ${summary} Use it the way a good friend would — naturally, and only when relevant. Never recite it, and never mention "memory," "notes," or stored information. What you remember is strictly the past — never treat a remembered dish, ingredient, or plan as tonight's cooking. Today's ingredients are only the ones the user names in this conversation; if they have not named any yet, ask what they have. If anything in it conflicts with the dietary rules above, the dietary rules always win. Never address the user by any name unless they clearly introduced themselves by that name — a wrong name is far worse than no name, so when in doubt use no name at all. If this memory mentions a language the user speaks or cooks in, ignore it completely — memory never decides language.`
}

async function summarizeAndSaveMemory(token, userId, oldSummary, lines) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token || !userId) return
  if (!Array.isArray(lines) || lines.length < 4) return // too little happened to remember
  try {
    const convo = lines
      .map((l) => `${l.who === 'user' ? 'User' : 'Micheli'}: ${l.text}`)
      .join('\n')
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            "You maintain the private memory of Micheli, a personal chef AI, about one specific user. Merge the existing memory with today's cooking conversation into ONE updated memory. Under 120 words, plain prose, third person. Refer to them ONLY as \"the user\" — NEVER invent, guess, or infer a name. Record a name ONLY if the user clearly and explicitly introduced themselves (\"my name is...\" / \"I'm <name>\"); the conversation comes from speech recognition and often garbles words, so when in any doubt, record no name — and if the existing memory contains a name today's conversation doesn't support, drop it. Keep durable facts: who they cook for, tastes and dislikes, skill level, kitchen equipment, dishes cooked together and how they turned out, and open threads (things they want to try). Drop small talk, step-by-step details, and anything one-off. Never record which language the user speaks or cooks in — language is a live setting, not a memory; if the existing memory mentions a language, drop that mention. If the existing memory says something today's conversation contradicts, prefer today's.",
        },
        {
          role: 'user',
          content: `Existing memory:\n${oldSummary || '(none)'}\n\nToday's conversation:\n${convo}`,
        },
      ],
    })
    const summary = completion.choices[0]?.message?.content?.trim()
    if (!summary) return
    await tokenClient(token).from('micheli_memory').upsert({
      user_id: userId,
      summary: summary.slice(0, 1500),
      updated_at: new Date().toISOString(),
    })
    console.log(`[memory] updated for user ${userId}`)
  } catch (err) {
    console.error('[memory] update failed:', err.message)
  }
}

// ── Recipe generation ────────────────────────────────────────────────────────
app.post('/api/recipe/generate', async (req, res) => {
  const { ingredients, language } = req.body || {}
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'ingredients array required' })
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured' })
  }
  const lang = typeof language === 'string' && language.trim() ? language.trim() : 'English'

  // Optional signed-in context: apply the user's dietary rules if a valid token came along.
  let profileRules = ''
  const authHeader = req.headers.authorization || ''
  const userToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (userToken) {
    const reqUser = await verifyUser(userToken)
    if (reqUser) profileRules = dietaryRules(await loadProfile(userToken))
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are Micheli, a warm professional chef. Create ONE realistic recipe using ONLY the provided ingredients (you may assume basic staples: salt, pepper, oil, water). Never require buying additional main ingredients. Write everything in ${lang}.${profileRules}
Return STRICT JSON in exactly this shape:
{
  "title": "string",
  "description": "one warm inviting sentence",
  "ingredients": ["item with a rough quantity"],
  "steps": ["full sentence step, no numbering"],
  "cook_time_minutes": 25,
  "servings": 2,
  "tags": ["short", "lowercase", "tags"],
  "tip": "one concise helpful sentence"
}`,
        },
        { role: 'user', content: `Ingredients: ${ingredients.join(', ')}` },
      ],
    })

    const raw = JSON.parse(completion.choices[0].message.content || '{}')
    const toInt = (v) => {
      const n = parseInt(v, 10)
      return Number.isFinite(n) ? n : null
    }
    res.json({
      title: String(raw.title || 'A simple dish'),
      description: String(raw.description || ''),
      ingredients: Array.isArray(raw.ingredients) ? raw.ingredients.map(String) : [],
      steps: Array.isArray(raw.steps) ? raw.steps.map(String) : [],
      cook_time_minutes: toInt(raw.cook_time_minutes),
      servings: toInt(raw.servings),
      tags: Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 5) : [],
      tip: String(raw.tip || ''),
    })
  } catch (err) {
    console.error('[recipe] error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', model: REALTIME_MODEL, voice: REALTIME_VOICE, apiKey: Boolean(process.env.OPENAI_API_KEY) })
)

// ── Temporary QA text chat: Micheli in text mode ─────────────────────────────
// Protected by TEST_CHAT_TOKEN (set only in Railway Variables). If the variable
// is not set, this endpoint is disabled entirely. Remove this block when QA ends.
const qaSessions = new Map()
let qaMessagesToday = 0
let qaCountDay = ''

app.post('/api/test/chat', async (req, res) => {
  const secret = process.env.TEST_CHAT_TOKEN
  if (!secret) return res.status(403).json({ error: 'QA chat disabled' })
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.body?.token || '')
  if (token !== secret) return res.status(401).json({ error: 'invalid token' })

  const { session_id, message } = req.body || {}
  if (!session_id || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'session_id and message required' })
  }

  const day = new Date().toISOString().slice(0, 10)
  if (day !== qaCountDay) { qaCountDay = day; qaMessagesToday = 0 }
  if (qaMessagesToday >= 400) return res.status(429).json({ error: 'daily test limit reached' })
  qaMessagesToday++

  if (!qaSessions.has(session_id)) {
    if (qaSessions.size >= 60) {
      const oldest = [...qaSessions.entries()].sort((a, b) => a[1].last - b[1].last)[0]
      if (oldest) qaSessions.delete(oldest[0])
    }
    qaSessions.set(session_id, { messages: [], last: Date.now() })
  }
  const sess = qaSessions.get(session_id)
  sess.last = Date.now()
  sess.messages.push({ role: 'user', content: message.trim().slice(0, 2000) })
  if (sess.messages.length > 40) sess.messages.splice(0, sess.messages.length - 40)

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            MICHELI_PROMPT +
            '\n\nNote: this is a text conversation for testing. Reply in plain text with the same warm spoken style, two to four sentences.',
        },
        ...sess.messages,
      ],
    })
    const reply = completion.choices[0]?.message?.content?.trim() || ''
    sess.messages.push({ role: 'assistant', content: reply })
    res.json({ reply, session_id, turns: sess.messages.length })
  } catch (err) {
    console.error('[qa-chat] error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// ── Supabase auth verification (server-side) ─────────────────────────────────
// Uses the anon key only — it can verify a user's JWT but grants no admin power;
// all data access stays behind Row Level Security. No service-role key on this server.
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const supabaseAuth =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    : null
if (!supabaseAuth) {
  console.warn('[auth] SUPABASE_URL / SUPABASE_ANON_KEY not set — voice sessions will all run as guest.')
}

async function verifyUser(token) {
  if (!supabaseAuth || !token) return null
  try {
    const { data, error } = await supabaseAuth.auth.getUser(token)
    if (error || !data?.user) return null
    return { id: data.user.id, email: data.user.email ?? null }
  } catch (err) {
    console.error('[auth] verify failed:', err.message)
    return null
  }
}

// Reads the user's own profiles row using THEIR token, so Row Level Security
// applies exactly as it does in the app. Returns null on any failure.
async function loadProfile(token) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token) return null
  try {
    const client = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await client
      .from('profiles')
      .select('id, gluten_free, dairy_free, kosher, celiac, allergies, has_met_micheli, language')
      .maybeSingle()
    if (error || !data) return null
    return data
  } catch (err) {
    console.error('[profile] load failed:', err.message)
    return null
  }
}

// Turns a profiles row into hard dietary rules appended to Micheli's prompt.
// Returns '' when the user has no restrictions set.
function dietaryRules(profile) {
  if (!profile) return ''
  const rules = []
  if (profile.kosher) {
    rules.push(
      'The user keeps kosher. Never combine meat or poultry with any dairy (milk, butter, cream, cheese, yogurt) in the same dish or suggestion. Never suggest pork, shellfish, or any non-kosher ingredient. If they have both meat and dairy on hand, cook with one and leave the other out entirely.'
    )
  }
  if (profile.celiac) {
    rules.push(
      'The user has celiac disease. Strictly exclude wheat, barley, rye, and anything containing gluten — including hidden sources like regular soy sauce, regular flour, breadcrumbs, and most pasta. When a staple commonly contains gluten, say so and offer the safe alternative.'
    )
  } else if (profile.gluten_free) {
    rules.push(
      'The user eats gluten-free. Exclude wheat, barley, rye, and gluten-containing ingredients, including hidden sources like regular soy sauce and breadcrumbs.'
    )
  }
  if (profile.dairy_free) {
    rules.push(
      'The user does not eat dairy. Exclude milk, butter, cream, cheese, yogurt, and all dairy-derived ingredients.'
    )
  }
  const allergies = Array.isArray(profile.allergies) ? profile.allergies.filter(Boolean) : []
  if (allergies.length > 0) {
    rules.push(
      `The user is allergic to: ${allergies.join(', ')}. Treat every allergy as severe — never include these ingredients or anything derived from them, and warn if a suggested staple might contain them.`
    )
  }
  if (rules.length === 0) return ''
  return (
    '\n\nDietary rules for this user — these are absolute and unbreakable, more important than any other instruction about food: ' +
    rules.join(' ') +
    ' You already know these preferences, so never ask the user about them — just quietly cook within them.'
  )
}

// ── OpenAI Realtime WebSocket proxy ──────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws/realtime' })

wss.on('connection', (browserWs, req) => {
  console.log(`[WS] Browser connected from ${req.socket.remoteAddress}`)

  if (!process.env.OPENAI_API_KEY) {
    browserWs.send(JSON.stringify({ type: 'error', error: { message: 'OPENAI_API_KEY not set on server.' } }))
    browserWs.close(1011, 'Missing API key')
    return
  }

  let openaiWs = null
  let sessionReady = false
  let started = false
  let authInFlight = false
  let user = null // null = guest
  let profile = null // dietary profile row, null for guests / no restrictions
  let authToken = null // the user's own token — used for their profile + cook-session rows
  let cookState = null // interrupted-cook tail from a recent session, if any
  let memory = null // long-term summary of past sessions, if any
  let intentionalEnd = false // user tapped "End session" — close the cook, don't resume it
  let clientLanguage = null // explicit language pick sent by the app, if any
  let guestId = null // client-generated id for this guest's resume slot, if any
  let isReconnect = false // true only when the client confirms this is its automatic drop-recovery path, not a fresh start
  let sessionLanguage = null // set once decided, so a later flush can persist it
  let activeModel = REALTIME_MODEL // overridden to REALTIME_MODEL_TEST only by a verified VOICE_TEST_TOKEN match
  let isTestSession = false
  // Phase 1 events: identity comes from the auth frame of 1.6+ clients; older
  // clients send none and produce no events. Turns count only non-empty,
  // completed chef responses (incremented where the transcript is captured).
  let evtAnonId = null
  let evtSessionId = null
  let evtAppVersion = null
  let evtVoiceStartMs = null
  let evtTurnCount = 0
  const evtDuration = () => (evtVoiceStartMs ? Math.min(86400, Math.max(0, Math.round((Date.now() - evtVoiceStartMs) / 1000))) : 0)
  const headerLanguage = languageFromHeader(req)
  const pending = []

  // Live transcript of this session (final lines only), used for resume-after-lock.
  const transcript = []
  let linesSinceFlush = 0
  const flushCookState = () => {
    if (transcript.length === 0) return
    linesSinceFlush = 0
    if (authToken && user) saveCookState(authToken, user.id, transcript.slice(-14), sessionLanguage)
    else if (guestId) saveGuestCookState(guestId, transcript.slice(-14), sessionLanguage)
  }

  const startOpenAI = () => {
    if (started) return
    started = true
    let openaiHeartbeat = null

    openaiWs = new WebSocket(realtimeUrlFor(activeModel), {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  })

  openaiWs.on('open', () => {
    console.log(`[WS] Connected to OpenAI Realtime (${activeModel}, voice=${REALTIME_VOICE}, user=${user ? user.id : 'guest'}${isTestSession ? ', TEST MODEL' : ''})`)
    const profileLanguage =
      profile && typeof profile.language === 'string' && KNOWN_LANGUAGES.has(profile.language)
        ? profile.language : null
    const resumedLanguage =
      cookState && typeof cookState.language === 'string' && KNOWN_LANGUAGES.has(cookState.language)
        ? cookState.language : null
    sessionLanguage = resumedLanguage || clientLanguage || profileLanguage || headerLanguage || 'English'
    console.log(`[WS] session language: ${sessionLanguage} (resumed=${resumedLanguage || '—'}, pick=${clientLanguage || '—'}, profile=${profileLanguage || '—'}, device=${headerLanguage || '—'})`)
    // NOTE (2026-08-04): the server used to push an `sc.session` status frame to
    // the browser here, and a `language` hint into the transcriber below. Both
    // are held back while we test whether they caused the audio breakup Tai
    // reported on the App Store build (1.4, frozen 2026-07-27), which has never
    // seen either. Everything else about the language fix stays in place.
    openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['audio'],
        instructions:
          MICHELI_PROMPT +
          languageInstruction(sessionLanguage) +
          dietaryRules(profile) +
          memoryInstruction(memory) +
          (cookState
            ? resumeInstruction(cookState)
            : isReconnect
              ? droppedReconnectInstruction(sessionLanguage)
              : greetingInstruction(profile, sessionLanguage)),
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            turn_detection: {
              type: 'server_vad',
              // 0.6 -> 0.7 (2026-08-18): quiet-mic hiss was triggering the VAD,
              // feeding near-silence to the transcriber, which hallucinated
              // phantom phrases ("Hello world"/Arabic) that Micheli answered.
              threshold: 0.7,
              prefix_padding_ms: 300,
              silence_duration_ms: 1500,
              create_response: true,
              interrupt_response: true,
            },
            // Same fix: strip room noise before voice detection sees it.
            noise_reduction: { type: 'near_field' },
            // Language hint re-enabled 2026-08-20: without it, accented English
            // was transcribed phonetically in Hebrew letters on screen. Held
            // back 08-04 over an unconfirmed 1.4-build audio-breakup suspicion;
            // 1.5 is live now. Rollback: remove the `language` field.
            transcription: {
              model: 'gpt-4o-transcribe',
              language: CODE_BY_LANGUAGE[sessionLanguage] || 'en',
            },
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
            voice: REALTIME_VOICE,
          },
        },
      },
    }))
    sessionReady = true
    for (const msg of pending) {
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.send(msg)
    }
    pending.length = 0
    // From the next session on, this user gets "Welcome back" instead of the intro.
    // Phase 1 events: intro instruction issued for a first-time authed user.
    // Named micheli_intro_TRIGGERED deliberately — the server cannot verify the
    // audio finished playing, so no completion is claimed (guest limitation:
    // guests have no profile row and produce no intro event).
    if (profile && !profile.has_met_micheli) {
      emitServerEvent('micheli_intro_triggered', evtAnonId, evtSessionId, user ? user.id : null, evtAppVersion)
    }
    markMet(authToken, profile)
    evtVoiceStartMs = Date.now()
    evtTurnCount = 0
    emitServerEvent(isReconnect ? 'voice_session_resumed' : 'voice_session_started', evtAnonId, evtSessionId, user ? user.id : null, evtAppVersion)

    // ── OpenAI-leg keep-alive (ping only, never terminate) ───────────────────
    // Generate periodic traffic so idle proxies don't drop the upstream socket.
    // No missed-pong kill on this side by design — only OpenAI or the browser
    // close ends this leg.
    openaiHeartbeat = setInterval(() => {
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) openaiWs.ping()
    }, 25000)
  })

  openaiWs.on('message', (data, isBinary) => {
    if (browserWs.readyState === WebSocket.OPEN) browserWs.send(data, { binary: isBinary })
    // Capture final transcript lines for resume-after-lock (signed-in users and tracked guests).
    // Only frames that can carry a finished transcript are parsed — audio deltas are not.
    if (user || guestId) {
      const head = data.toString('utf8', 0, 200)
      if (
        head.includes('output_audio_transcript.done') ||
        head.includes('input_audio_transcription.completed')
      ) {
        try {
          const msg = JSON.parse(data.toString('utf8'))
          let line = null
          if (msg.type === 'response.output_audio_transcript.done' && msg.transcript) {
            line = { who: 'chef', text: String(msg.transcript).slice(0, 500) }
          } else if (
            msg.type === 'conversation.item.input_audio_transcription.completed' &&
            msg.transcript
          ) {
            line = { who: 'user', text: String(msg.transcript).slice(0, 500) }
          }
          if (line && line.text.trim()) {
            // Phase 1 events: a chef turn counts ONLY here — a completed response
            // with a non-empty transcript. Empty/canceled/malformed responses never land.
            if (line.who === 'chef') evtTurnCount++
            transcript.push(line)
            if (transcript.length > 40) transcript.splice(0, transcript.length - 40)
            if (++linesSinceFlush >= 4) flushCookState()
          }
        } catch { /* never let transcript capture break the audio stream */ }
      }
    }
  })

  openaiWs.on('error', (err) => {
    console.error('[WS] OpenAI error:', err.message)
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: 'error', error: { message: `OpenAI error: ${err.message}` } }))
    }
  })

  openaiWs.on('close', (code) => {
    console.log(`[WS] OpenAI closed: ${code}`)
    if (openaiHeartbeat) { clearInterval(openaiHeartbeat); openaiHeartbeat = null }
    if (browserWs.readyState === WebSocket.OPEN) browserWs.close(1000)
  })
  } // end startOpenAI

  // Auth handshake: the FIRST browser frame may be { type: 'auth', token }.
  // Older app builds never send it — their first frame starts a guest session.
  // A client that connects but sends nothing still gets a session after 4s.
  const authTimer = setTimeout(() => {
    if (!started && !authInFlight) startOpenAI()
  }, 4000)

  browserWs.on('message', async (data) => {
    // OpenAI's realtime API accepts ONLY text (JSON) frames — never binary.
    // ws delivers frames as Buffers, so coerce to a string and always send as text,
    // including queued frames replayed after the session opens.
    const text = typeof data === 'string' ? data : data.toString('utf8')

    // A tiny "end_session" frame marks a deliberate End-session tap; never forward it.
    // Clear the cook state right here, on receipt — waiting for the close event to
    // check a flag races the frame against the socket teardown on flaky mobile
    // connections, and a lost race left stale state for the next session to resume.
    if (text.length < 60 && text.includes('"end_session"')) {
      try {
        if (JSON.parse(text).type === 'end_session') {
          intentionalEnd = true
          if (user && authToken) clearCookState(authToken, user.id)
          else if (guestId) clearGuestCookState(guestId)
          return
        }
      } catch { /* fall through — treat as a normal frame */ }
    }

    if (!started) {
      if (authInFlight) { pending.push(text); return } // frames racing the token check
      let parsed = null
      try { parsed = JSON.parse(text) } catch { /* not JSON — treat as normal frame */ }
      if (parsed && parsed.type === 'auth') {
        if (typeof parsed.language === 'string' && KNOWN_LANGUAGES.has(parsed.language.trim())) {
          clientLanguage = parsed.language.trim()
        }
        isReconnect = parsed.isReconnect === true
        // Phase 1 events identity (1.6+ clients only; UUIDs re-validated on emit).
        if (typeof parsed.anonId === 'string') evtAnonId = parsed.anonId
        if (typeof parsed.sessionId === 'string') evtSessionId = parsed.sessionId
        if (typeof parsed.appVersion === 'string') evtAppVersion = parsed.appVersion
        const voiceTestToken = process.env.VOICE_TEST_TOKEN
        if (voiceTestToken && typeof parsed.testToken === 'string' && parsed.testToken === voiceTestToken) {
          activeModel = REALTIME_MODEL_TEST
          isTestSession = true
        }
        authInFlight = true
        clearTimeout(authTimer)
        user = await verifyUser(parsed.token)
        if (user) {
          authToken = parsed.token
          ;[profile, cookState, memory] = await Promise.all([
            loadProfile(parsed.token),
            loadCookState(parsed.token),
            loadMemory(parsed.token),
          ])
        } else if (typeof parsed.guestId === 'string' && parsed.guestId.length >= 8 && parsed.guestId.length <= 100) {
          guestId = parsed.guestId
          cookState = loadGuestCookState(guestId)
        }
        console.log(`[WS] auth: ${user ? `user ${user.id}` : guestId ? 'guest (tracked)' : 'guest'}${profile ? ' (profile loaded)' : ''}${cookState ? ' (resuming cook)' : ''}${memory ? ' (memory loaded)' : ''}${isReconnect ? ' (reconnect)' : ''}${isTestSession ? ' (TEST MODEL)' : ''}`)
        authInFlight = false
        startOpenAI()
        return // the auth frame itself is never forwarded to OpenAI
      }
      // Old client: first frame is a normal realtime event — start as guest.
      clearTimeout(authTimer)
      startOpenAI()
      pending.push(text)
      return
    }

    if (sessionReady && openaiWs && openaiWs.readyState === WebSocket.OPEN) openaiWs.send(text)
    else pending.push(text)
  })

  // ── Browser-leg heartbeat ──────────────────────────────────────────────────
  // Railway idle-closes a quiet WebSocket (~60s → 1005). Ping every 25s; if two
  // pings go unanswered the leg is dead — terminate so the close handler below
  // (flush cook state, close the OpenAI leg) runs cleanly.
  let browserMissedPongs = 0
  browserWs.on('pong', () => { browserMissedPongs = 0 })
  const browserHeartbeat = setInterval(() => {
    if (browserWs.readyState !== WebSocket.OPEN) return
    if (browserMissedPongs >= 2) {
      console.log('[WS] Browser leg unresponsive (2 missed pongs) — terminating')
      browserWs.terminate()
      return
    }
    browserMissedPongs++
    browserWs.ping()
  }, 25000)

  browserWs.on('close', (code) => {
    console.log(`[WS] Browser disconnected: ${code}`)
    // Phase 1 events: deliberate goodbye vs disconnect. The raw numeric close
    // code is stored as-is — no interpretation, no invented reasons.
    if (evtVoiceStartMs) {
      const props = { turn_count: Math.min(999, evtTurnCount), duration_seconds: evtDuration() }
      if (intentionalEnd) {
        emitServerEvent('voice_session_ended', evtAnonId, evtSessionId, user ? user.id : null, evtAppVersion, props)
      } else {
        // Raw code stored ONLY when the socket supplied a valid one; never invented.
        if (Number.isInteger(code) && code >= 0 && code <= 4999) props.close_code = code
        emitServerEvent('voice_session_disconnected', evtAnonId, evtSessionId, user ? user.id : null, evtAppVersion, props)
      }
      evtVoiceStartMs = null
    }
    clearTimeout(authTimer)
    clearInterval(browserHeartbeat)
    if (!intentionalEnd) {
      flushCookState() // phone locked / app switched — save where they were
    } // else: cook state was already cleared when the end_session frame arrived
    // Either way, distill this session into long-term memory (fire and forget).
    if (user && authToken) summarizeAndSaveMemory(authToken, user.id, memory, transcript.slice())
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) openaiWs.close(1000)
  })

  browserWs.on('error', (err) => console.error('[WS] Browser error:', err.message))
})

// ── Static (Vite build) ──────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'dist')))
app.get('*', (_req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')))

if (!process.env.SC_TEST_NO_LISTEN) {
  server.listen(PORT, () => {
    console.log(`\n  ShareChef AI  →  http://localhost:${PORT}`)
    console.log(`  Realtime WS   →  /ws/realtime  (${REALTIME_MODEL}, ${REALTIME_VOICE})`)
    console.log(`  API key       →  ${process.env.OPENAI_API_KEY ? '✓ configured' : '✗ MISSING'}\n`)
  })
}

// Test-only surface (harmless in production; used by tests/ with SC_TEST_NO_LISTEN=1).
export const __test = {
  validateEvent,
  EVENT_NAMES_CLIENT,
  EVENT_NAMES_SERVER,
  emitServerEvent,
  performAccountDeletion,
  isRecentPasswordAuth,
  setDeletionUserVerifier(fn) { deletionUserVerifier = fn },
  resetDeletionUserVerifier() { deletionUserVerifier = verifyUserForDeletion },
  resetDeleteRateLimit() { deleteBuckets.clear() },
}
