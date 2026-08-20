// Analytics identity + session boundaries. KILL SWITCH lives in events.ts.
//
// anon_id — persistent per-installation UUID. Web: localStorage, which is
//   RESETTABLE BROWSER STORAGE (cleared by the user or the OS under pressure) —
//   NOT guaranteed installation identity; a wipe reads as a new install.
//   Native (Capacitor): Preferences plugin storage, which survives WKWebView
//   data eviction. Initialized once via initIdentity().
// session_id — rotates on every genuine cold launch (new JS context), and on
//   foreground return after >= 30 minutes of inactivity. Foreground return
//   before 30 minutes keeps the session. Reads are pure: only touchActivity()
//   and rotation write the activity clock.
//
// Failure rules: if storage is unavailable, IDs fall back to stable,
// runtime-unique in-memory UUIDs (valid v4, regenerated per launch). Stored
// values are validated as UUIDs before reuse. Clock reversal beyond tolerance
// rotates the session rather than trusting a corrupted window. Cross-tab
// concurrent initialization converges by re-reading after write and adopting
// the stored winner.
const ANON_KEY = 'sc_anon_id';
const SESSION_KEY = 'sc_evt_session';
const LAST_ACTIVE_KEY = 'sc_evt_last_active';
const INACTIVITY_MS = 30 * 60 * 1000; // 30 min: > in-cook pauses, < next-meal returns
const CLOCK_REVERSAL_TOLERANCE_MS = 2 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function makeUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID)
        return crypto.randomUUID();
    // RFC 4122 v4 shape without crypto.randomUUID (older WebViews).
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues)
        crypto.getRandomValues(bytes);
    else
        for (let i = 0; i < 16; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}
export function isUuid(v) {
    return typeof v === 'string' && UUID_RE.test(v);
}
// In-memory state: authoritative within this JS context. Stable runtime-unique
// fallbacks when storage fails; single-flight init guard against concurrent calls.
let memAnonId = null;
let memSessionId = null;
let initialized = false;
let initPromise = null;
function lsGet(key) {
    try {
        return window.localStorage.getItem(key);
    }
    catch {
        return null;
    }
}
function lsSet(key, value) {
    try {
        window.localStorage.setItem(key, value);
        return true;
    }
    catch {
        return false;
    }
}
let platformOverride = null;
export function __setPlatformForTests(o) { platformOverride = o; }
async function detectNative() {
    if (platformOverride)
        return platformOverride.isNative;
    try {
        // Official API, loaded lazily so web bundles and tests stay independent.
        const { Capacitor } = await import('@capacitor/core');
        return typeof Capacitor?.isNativePlatform === 'function' ? Capacitor.isNativePlatform() : false;
    }
    catch {
        return false;
    }
}
async function nativePrefs() {
    if (platformOverride)
        return platformOverride.prefs;
    const { Preferences } = await import('@capacitor/preferences');
    return Preferences;
}
async function loadOrCreateAnonId() {
    if (await detectNative()) {
        try {
            const Preferences = await nativePrefs();
            const { value } = await Preferences.get({ key: ANON_KEY });
            if (isUuid(value))
                return value;
            const fresh = makeUuid();
            await Preferences.set({ key: ANON_KEY, value: fresh });
            const { value: winner } = await Preferences.get({ key: ANON_KEY }); // converge on concurrent init
            return isUuid(winner) ? winner : fresh;
        }
        catch { /* fall through to web storage */ }
    }
    const stored = lsGet(ANON_KEY);
    if (isUuid(stored))
        return stored;
    const fresh = makeUuid();
    if (lsSet(ANON_KEY, fresh)) {
        const winner = lsGet(ANON_KEY); // another tab may have won the race
        if (isUuid(winner))
            return winner;
    }
    return fresh; // storage unavailable: stable for this runtime only
}
function rotateSession(now) {
    const fresh = makeUuid();
    memSessionId = fresh;
    if (lsSet(SESSION_KEY, fresh)) {
        lsSet(LAST_ACTIVE_KEY, String(now));
        const winner = lsGet(SESSION_KEY);
        if (isUuid(winner))
            memSessionId = winner;
    }
    return memSessionId;
}
/** One-time async identity init. Single-flight: concurrent callers share it.
 *  A genuine cold launch (fresh JS context) ALWAYS rotates the session. */
export function initIdentity() {
    if (initPromise)
        return initPromise;
    initPromise = (async () => {
        memAnonId = await loadOrCreateAnonId();
        rotateSession(Date.now());
        initialized = true;
    })();
    return initPromise;
}
export function identityReady() { return initialized; }
export function getAnonId() {
    if (!memAnonId)
        memAnonId = makeUuid(); // pre-init fallback: runtime-unique
    return memAnonId;
}
/** Pure read: never writes the activity clock. */
export function getSessionId() {
    if (!memSessionId)
        memSessionId = makeUuid();
    return memSessionId;
}
/** Explicit activity marker — the ONLY writer of the activity clock outside rotation. */
export function touchActivity() {
    lsSet(LAST_ACTIVE_KEY, String(Date.now()));
}
/** Async key-value storage for the analytics outbox: Capacitor Preferences on
 *  native, localStorage on web (same platform seam as identity storage). */
export async function kvGet(key) {
    if (await detectNative()) {
        try {
            const p = await nativePrefs();
            const { value } = await p.get({ key });
            return value ?? null;
        }
        catch { /* fall through */ }
    }
    return lsGet(key);
}
export async function kvSet(key, value) {
    if (await detectNative()) {
        try {
            const p = await nativePrefs();
            await p.set({ key, value });
            return true;
        }
        catch { /* fall through */ }
    }
    return lsSet(key, value);
}
/** Account-deletion reset: forget this installation's identity entirely.
 *  The old anon_id is server-linked to the deleted account, so it must never
 *  reappear — a fresh anon_id AND session_id are generated and persisted
 *  (Capacitor Preferences on native, localStorage on web). Runs regardless of
 *  the analytics kill switch: this is privacy cleanup, not analytics. */
export async function resetIdentity() {
    const fresh = makeUuid();
    memAnonId = fresh;
    if (await detectNative()) {
        try {
            const p = await nativePrefs();
            await p.set({ key: ANON_KEY, value: fresh });
        }
        catch {
            lsSet(ANON_KEY, fresh);
        }
    }
    else {
        lsSet(ANON_KEY, fresh);
    }
    rotateSession(Date.now());
}
/** Foreground-return boundary: keeps the session before 30 idle minutes,
 *  rotates after, and rotates on clock reversal beyond tolerance.
 *  Returns true when a new session began. */
export function resumeBoundary(now = Date.now()) {
    const stored = lsGet(SESSION_KEY);
    const rawLast = lsGet(LAST_ACTIVE_KEY);
    const last = Number(rawLast);
    if (!isUuid(stored)) {
        rotateSession(now);
        return true;
    }
    if (rawLast === null || !Number.isFinite(last)) {
        rotateSession(now);
        return true;
    } // malformed clock: rotate, never guess
    if (last > now + CLOCK_REVERSAL_TOLERANCE_MS) {
        rotateSession(now);
        return true;
    } // clock went backward
    if (now - last > INACTIVITY_MS) {
        rotateSession(now);
        return true;
    }
    memSessionId = stored;
    lsSet(LAST_ACTIVE_KEY, String(now)); // a retained foreground return IS activity
    return false;
}
