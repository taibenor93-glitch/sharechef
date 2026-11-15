// Siri: the two things you can ask for by voice before the app is even open.
//
//   "Hey Siri, cook with Micheli"            → opens a cook
//   "Hey Siri, ask Micheli what I can make"  → Siri asks "With what?", then the
//                                              app opens with those ingredients
//
// iPhone side: ios/App/App/MicheliSiriIntents.swift (what Siri runs) and
// ios/App/App/MicheliSiriPlugin.swift (hands the request to this file).
//
// SECURITY: the request arrives through a native plugin, never through a
// sharechef:// link. A link can be fired by any web page or app, and "start a
// cook" opens the microphone — so that must not be reachable from a URL.
// The spoken ingredients are still treated as untrusted text: they are cut
// down to plain words by parseSiriIngredients() and only ever fill the
// ingredient chips. Nothing here is sent anywhere or run.

export type SiriAction =
  | { kind: 'cook' }
  | { kind: 'make'; ingredients: string[] }

export const SIRI_MAX_SPOKEN_LENGTH = 300
export const SIRI_MAX_INGREDIENTS = 12
export const SIRI_MAX_INGREDIENT_LENGTH = 40

// How long a request waits to be picked up. Long enough to cover a cold start,
// short enough that it cannot fire later out of nowhere.
export const SIRI_ACTION_TTL_MS = 60_000

/**
 * Turn what Siri heard ("chicken and rice", "Eggs, spinach & feta") into the
 * ingredient list. Always returns plain lowercase words; never throws.
 */
export function parseSiriIngredients(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  let spoken = raw
  if (spoken.length > SIRI_MAX_SPOKEN_LENGTH) {
    // Cut at the limit, then back to the last whole word, so a word sliced in
    // half ("ric") never shows up as an ingredient.
    spoken = spoken.slice(0, SIRI_MAX_SPOKEN_LENGTH).replace(/[^\s,&]*$/, '')
  }
  const cleaned = spoken
    .toLowerCase()
    // Keep letters (any language), digits, spaces, hyphens, apostrophes and the
    // separators we split on. Everything else becomes a space.
    .replace(/[^\p{L}\p{M}\p{N}\s,&'’-]/gu, ' ')
    .replace(/\s+/g, ' ')

  const out: string[] = []
  for (const part of cleaned.split(/,|&|\band\b|\bplus\b/)) {
    const item = part
      .trim()
      .replace(/^(?:some|a|an|the)\s+/, '')
      .replace(/^['’-]+|['’-]+$/g, '')
      .trim()
    if (!item || item.length > SIRI_MAX_INGREDIENT_LENGTH) continue
    if (!/[\p{L}]/u.test(item)) continue // "2", "-" and the like are not food
    if (out.includes(item)) continue
    out.push(item)
    if (out.length >= SIRI_MAX_INGREDIENTS) break
  }
  return out
}

/**
 * Read what the native plugin handed over. Returns null for anything that is
 * not one of the two known requests — null means "do nothing".
 */
export function parseSiriAction(raw: unknown): SiriAction | null {
  if (!raw || typeof raw !== 'object') return null
  const { action, ingredients } = raw as { action?: unknown; ingredients?: unknown }
  if (action === 'cook') return { kind: 'cook' }
  if (action === 'make') {
    const list = parseSiriIngredients(ingredients)
    // Siri heard nothing usable: opening the app is still the right outcome,
    // but there is nothing to fill in.
    return list.length > 0 ? { kind: 'make', ingredients: list } : null
  }
  return null
}

// ── Inbox ────────────────────────────────────────────────────────────────────
// Siri can fire while the user is on any screen, or before the app has drawn
// anything. The request waits here until the home screen picks it up.

export interface SiriInbox {
  put(action: SiriAction): void
  /** Returns the waiting request once, then forgets it. Null when none (or expired). */
  take(): SiriAction | null
  /** Called whenever a new request arrives. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void
}

export function createSiriInbox(now: () => number = () => Date.now()): SiriInbox {
  let pending: { action: SiriAction; at: number } | null = null
  const listeners = new Set<() => void>()
  return {
    put(action) {
      pending = { action, at: now() }
      for (const l of [...listeners]) l()
    },
    take() {
      const p = pending
      pending = null
      if (!p || now() - p.at > SIRI_ACTION_TTL_MS) return null
      return p.action
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export const siriInbox = createSiriInbox()

// ── Wiring ───────────────────────────────────────────────────────────────────
// Kept out of the React hook so a fake plugin can drive it in tests
// (tests/siri.test.mjs), same pattern as src/lib/deepLink.ts.

/** The slice of the native MicheliSiri plugin we use. */
export interface SiriSource {
  addListener(eventName: 'siriAction', listener: () => void): Promise<{ remove: () => void }>
  takePending(): Promise<{ action?: string; ingredients?: string }>
}

/**
 * Start collecting Siri requests from the native side. `deliver` is called once
 * per valid request. Returns a cleanup.
 */
export function startSiriRouting(source: SiriSource, deliver: (action: SiriAction) => void): () => void {
  let cancelled = false
  let removeListener: (() => void) | undefined

  const collect = () => {
    source
      .takePending()
      .then((raw) => {
        if (cancelled) return
        const action = parseSiriAction(raw)
        if (action) deliver(action)
      })
      .catch(() => {
        /* plugin unavailable (older app build, or a plain browser) */
      })
  }

  // Requests that arrive while the app is already running.
  source
    .addListener('siriAction', collect)
    .then((handle) => {
      if (cancelled) handle.remove()
      else removeListener = () => handle.remove()
    })
    .catch(() => {
      /* plugin unavailable */
    })

  // The request that cold-started the app, made before anything was listening.
  collect()

  return () => {
    cancelled = true
    removeListener?.()
  }
}
