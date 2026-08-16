// Phase 1 funnel events — client emitter (revision 5: account-bound persistent outbox).
// KILL SWITCH: VITE_EVENTS_ENABLED must be exactly 'true' or nothing is sent OR
// queued. Fire-and-forget; never throws; never blocks UI or the audio path.
// App version comes from build metadata (__APP_VERSION__ = package.json version).
//
// Delivery semantics: a server "duplicate" response means the event already
// exists — that IS successful delivery. Transient failures (network, 429, 5xx)
// go to a bounded PERSISTENT outbox (max 50, max 5 attempts each, original
// event UUID preserved so retries can never double-count). Validation/auth 4xx
// are never retried. The queue flushes on app start and on foreground return.

import { API_BASE } from './apiBase'
import {
  getAnonId, getSessionId, touchActivity, initIdentity, identityReady,
  resumeBoundary, makeUuid, kvGet, kvSet, __setPlatformForTests,
} from './session'

function flag(name: 'VITE_EVENTS_ENABLED' | 'VITE_EVENTS_DEBUG'): boolean {
  try { return import.meta.env[name] === 'true' } catch { return false }
}
let ENABLED = flag('VITE_EVENTS_ENABLED')
const DEBUG = flag('VITE_EVENTS_DEBUG')
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && /^\d+\.\d+\.\d+$/.test(__APP_VERSION__) ? __APP_VERSION__ : '0.0.0'

type EventName =
  | 'app_opened'
  | 'account_created'
  | 'identity_linked'
  | 'ingredients_submitted'
  | 'dish_proposed'
  | 'dish_saved'
  | 'dish_shared'

const ALLOWED_PROPS: Record<EventName, string[]> = {
  app_opened: [],
  account_created: [],
  identity_linked: [],
  ingredients_submitted: ['ingredient_count'],
  dish_proposed: ['ingredient_count'],
  dish_saved: [],
  dish_shared: ['channel'],
}

type EventBody = Record<string, unknown>
// Persistent outbox item. NEVER contains a token. needsAuth marks that delivery
// requires a fresh session token AT FLUSH TIME, and requiredUserId binds the
// event to the account that performed the action: it can only ever be delivered
// under that exact account, never reassigned. guardKey (identity_linked only)
// must match requiredUserId and is set only after delivery under that account.
type QueueItem = { body: EventBody; needsAuth: boolean; attempts: number; requiredUserId?: string; guardKey?: string }

const OUTBOX_KEY = 'sc_evt_outbox'
const MAX_QUEUE = 50
const MAX_ATTEMPTS = 5
let retryQueue: QueueItem[] = []
let outboxLoaded = false
let flushing = false
// Serialized persistence: concurrent writers append to this chain so no write
// overwrites another within this context (cross-tab remains last-writer-wins,
// documented as best-effort like the rest of web storage).
let persistChain: Promise<void> = Promise.resolve()

// Authentication-context provider, registered by the app shell. Returns the
// CURRENT session's token AND user id at flush time. Tokens are NEVER persisted.
export type AuthContext = { accessToken: string; userId: string } | null
let authContextProvider: () => Promise<AuthContext> = async () => null
export function setAuthContextProvider(fn: () => Promise<AuthContext>): void { authContextProvider = fn }

// Derives the acting account from the token used AT CREATION TIME (JWT `sub`).
// Unverified decode is fine here: it only BINDS the retry; the server re-verifies
// the actual token on every delivery.
function userIdFromToken(token: string | null): string | null {
  try {
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    const sub = payload?.sub
    return typeof sub === 'string' && UUID_RE.test(sub) ? sub.toLowerCase() : null
  } catch { return null }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const APP_VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/
const ITEM_KEYS = new Set(['body', 'needsAuth', 'attempts', 'requiredUserId', 'guardKey'])
const BODY_STANDARD_KEYS = new Set(['id', 'event', 'anon_id', 'session_id', 'app_version', 'reported_client_ts'])

// Full validation of every RESTORED queue item — tampered, unexpected, or
// account-unbound entries are rejected safely and never sent.
function sanitizeItem(raw: unknown): QueueItem | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  for (const k of Object.keys(raw)) if (!ITEM_KEYS.has(k)) return null // no token, no unexpected fields
  const it = raw as Partial<QueueItem>
  if (typeof it.needsAuth !== 'boolean') return null
  if (!Number.isInteger(it.attempts) || (it.attempts as number) < 0 || (it.attempts as number) > MAX_ATTEMPTS) return null
  const body = it.body
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const event = (body as EventBody).event
  if (typeof event !== 'string' || !(event in ALLOWED_PROPS)) return null // approved client events only
  const allowed = ALLOWED_PROPS[event as EventName]
  for (const k of Object.keys(body)) {
    if (!BODY_STANDARD_KEYS.has(k) && !allowed.includes(k)) return null // approved properties only
  }
  const b = body as Record<string, unknown>
  if (!UUID_RE.test(String(b.id)) || !UUID_RE.test(String(b.anon_id)) || !UUID_RE.test(String(b.session_id))) return null
  if (!APP_VERSION_RE.test(String(b.app_version))) return null
  let requiredUserId: string | undefined
  if (it.needsAuth) {
    if (!UUID_RE.test(String(it.requiredUserId))) return null // authenticated items MUST carry a valid account binding
    requiredUserId = String(it.requiredUserId).toLowerCase()
  }
  let guardKey: string | undefined
  if (it.guardKey !== undefined) {
    // identity_linked guard must be bound to the exact required account.
    if (typeof it.guardKey !== 'string' || !requiredUserId || it.guardKey !== `sc_evt_linked_${requiredUserId}`) return null
    guardKey = it.guardKey
  }
  return { body: body as EventBody, needsAuth: it.needsAuth, attempts: it.attempts as number, requiredUserId, guardKey }
}

async function loadOutbox(): Promise<void> {
  if (outboxLoaded) return
  outboxLoaded = true
  try {
    const raw = await kvGet(OUTBOX_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const items = parsed.map(sanitizeItem).filter((i): i is QueueItem => i !== null)
      // Merge storage + memory, deduped by event UUID (memory copy wins) — a
      // persisted twin of an in-memory item must never double-send.
      const seen = new Set(retryQueue.map((i) => String(i.body.id)))
      retryQueue = items.filter((i) => !seen.has(String(i.body.id))).concat(retryQueue).slice(0, MAX_QUEUE)
    }
  } catch { /* corrupted outbox: start clean */ }
}

function persistOutbox(): void {
  persistChain = persistChain.then(async () => {
    try { await kvSet(OUTBOX_KEY, JSON.stringify(retryQueue.slice(0, MAX_QUEUE))) } catch { /* ignore */ }
  })
}

// Events fired before async identity init completes are held (bounded), then
// flushed with the settled identity — identifiers never leave pre-init.
const preInitQueue: Array<() => void> = []

let fetchImpl: typeof fetch = (...args) => fetch(...args)

type SendResult = 'delivered' | 'retriable' | 'rejected'
async function sendOnce(body: EventBody, authToken: string | null): Promise<SendResult> {
  try {
    const res = await fetchImpl(`${API_BASE}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(body),
      keepalive: true,
    })
    if (res.status === 429 || res.status >= 500) return 'retriable'
    if (!res.ok) return 'rejected' // validation/auth 4xx: never retried
    const json = await res.json().catch(() => null)
    if (json?.stored === true) return 'delivered'
    if (json?.reason === 'duplicate') return 'delivered' // already in the database
    return 'rejected' // e.g. kill switch off server-side: no retry loop
  } catch {
    return 'retriable' // network failure
  }
}

function enqueueRetry(item: QueueItem): void {
  if (!ENABLED) return // kill switch OFF: no new entries (existing storage untouched)
  if (retryQueue.length >= MAX_QUEUE) return // bounded: drop, never grow
  retryQueue.push(item)
  persistOutbox()
}

function setGuard(guardKey?: string): void {
  if (!guardKey) return
  try { window.localStorage.setItem(guardKey, '1') } catch { /* ignore */ }
}

async function flushRetryQueue(): Promise<void> {
  if (!ENABLED || flushing) return // kill switch OFF: never flushes, queue left as-is
  flushing = true
  try {
    await loadOutbox()
    const batch = retryQueue; retryQueue = []
    for (const item of batch) {
      let token: string | null = null
      if (item.needsAuth) {
        let ctx: AuthContext = null
        try { ctx = await authContextProvider() } catch { ctx = null } // fresh context at flush time, never persisted
        // Delivery requires BOTH a valid token AND the exact original account.
        // A different signed-in account must never receive this event: keep it
        // pending (within the attempt policy) until the original account
        // returns — events are never reassigned.
        if (!ctx || !ctx.accessToken || ctx.userId?.toLowerCase() !== item.requiredUserId) {
          if (item.attempts + 1 < MAX_ATTEMPTS) retryQueue.push({ ...item, attempts: item.attempts + 1 })
          continue
        }
        token = ctx.accessToken
      }
      const result = await sendOnce(item.body, token) // same UUID: retries can never duplicate
      if (result === 'delivered') setGuard(item.guardKey)
      else if (result === 'retriable' && item.attempts + 1 < MAX_ATTEMPTS) {
        retryQueue.push({ ...item, attempts: item.attempts + 1 })
      } // delivered / duplicate / rejected / exhausted: removed from storage below
    }
  } finally {
    persistOutbox() // storage reflects survivors only
    flushing = false
  }
}

function dispatch(body: EventBody, authToken: string | null, needsAuth: boolean, requiredUserId?: string, guardKey?: string): void {
  void sendOnce(body, authToken).then((result) => {
    if (result === 'delivered') setGuard(guardKey)
    else if (result === 'retriable') {
      // Authenticated events without a resolvable acting account are never
      // queued: a retry that can't be account-bound must not exist.
      if (needsAuth && !requiredUserId) return
      enqueueRetry({ body, needsAuth, attempts: 1, requiredUserId, guardKey })
    }
  })
}

function buildBody(event: EventName, props?: { ingredient_count?: number; channel?: string }): EventBody {
  const body: EventBody = {
    id: makeUuid(),
    event,
    anon_id: getAnonId(),
    session_id: getSessionId(),
    app_version: APP_VERSION,
    reported_client_ts: new Date().toISOString(),
  }
  for (const key of ALLOWED_PROPS[event]) {
    const v = props?.[key as keyof typeof props]
    if (v !== undefined) body[key] = v
  }
  return body
}

export function track(event: EventName, props?: { ingredient_count?: number; channel?: string }, authToken?: string | null): void {
  try {
    if (!ENABLED) { if (DEBUG) console.log('[events:off]', event, props); return }
    if (!ALLOWED_PROPS[event]) return
    const emit = () => {
      const body = buildBody(event, props)
      if (DEBUG) console.log('[events]', body)
      touchActivity()
      // If the original call was authenticated, retries must stay authenticated
      // AND stay bound to the account that performed the action (JWT sub).
      dispatch(body, authToken ?? null, !!authToken, userIdFromToken(authToken ?? null) ?? undefined)
    }
    if (!identityReady()) {
      if (preInitQueue.length < 20) preInitQueue.push(emit)
      return
    }
    emit()
  } catch { /* analytics must never break the app */ }
}

/** Cold start: init identity (rotates session), emit app_opened, then load the
 *  PERSISTED outbox and flush — queued events genuinely survive termination. */
export function startAnalyticsSession(): void {
  if (!ENABLED) return
  void initIdentity().then(async () => {
    track('app_opened')
    for (const emit of preInitQueue.splice(0)) emit()
    await loadOutbox()
    void flushRetryQueue()
  }).catch(() => { /* ignore */ })
}

/** Foreground return: rotate past the inactivity window; retained sessions
 *  still register activity (handled inside resumeBoundary); flush retries. */
export function foregroundBoundary(): void {
  if (!ENABLED || !identityReady()) return
  if (resumeBoundary()) track('app_opened')
  void flushRetryQueue()
}

/** Voice lifecycle activity marker — called at low-frequency lifecycle points
 *  (connect, completed turns, deliberate end), NEVER from the audio loop. */
export function voiceActivity(): void {
  if (!ENABLED) return
  touchActivity()
}

/** identity_linked requires a verified JWT (server enforces 401). The local
 *  once-guard is set only after confirmed delivery — where a database
 *  "duplicate" IS confirmation. DB unique (anon,user) index backs it all. */
export function linkIdentityOnce(userId: string, authToken: string | null): void {
  try {
    if (!ENABLED || !userId || !authToken) return
    const guard = `sc_evt_linked_${userId.toLowerCase()}`
    let already: string | null = null
    try { already = window.localStorage.getItem(guard) } catch { /* ignore */ }
    if (already) return
    const run = () => {
      const body = buildBody('identity_linked')
      // identity_linked binds to its EXPLICIT original user id: it can only
      // deliver under that account, and its guard can only be set by that
      // delivery — the anonymous identity can never link to the wrong account.
      dispatch(body, authToken, true, userId.toLowerCase(), guard)
    }
    if (identityReady()) run()
    else if (preInitQueue.length < 20) preInitQueue.push(run)
  } catch { /* ignore */ }
}

/** Account-deletion local purge: remove every queued analytics item bound to
 *  the deleted account and clear its identity-link guard. Runs REGARDLESS of
 *  the kill switch — this is privacy cleanup, not analytics. Anonymous queue
 *  items are left alone (they belong to the installation, whose identity is
 *  rotated separately by session.resetIdentity()). */
export async function purgeAccountLocal(userId: string): Promise<void> {
  try {
    const uid = String(userId).toLowerCase()
    if (!UUID_RE.test(uid)) return
    await loadOutbox()
    retryQueue = retryQueue.filter((i) => i.requiredUserId !== uid)
    persistOutbox()
    await persistChain // storage settled before the caller signs out
    try { window.localStorage.removeItem(`sc_evt_linked_${uid}`) } catch { /* ignore */ }
  } catch { /* cleanup must never throw */ }
}

// ── Test seams (production-harmless) ─────────────────────────────────────────
export const __test = {
  init: initIdentity, // same single-flight promise this module's emitters observe
  setPlatform: __setPlatformForTests, // this module's session instance
  setEnabled(v: boolean) { ENABLED = v },
  setFetch(f: typeof fetch) { fetchImpl = f },
  queueSize() { return retryQueue.length },
  queueIds() { return retryQueue.map((i) => i.body.id) },
  queueRequired() { return retryQueue.map((i) => i.requiredUserId ?? null) },
  clearQueue() { retryQueue.length = 0 },
  flush: flushRetryQueue,
  loadOutbox,
  persistChainDone: () => persistChain,
  dispatch,
  buildBody,
}
