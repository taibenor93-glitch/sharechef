// Owner-only diagnostics for the iPhone mic / Record button investigation.
// Sends small, flat reports to POST /api/diag, which only logs them as
// "[diag]" lines on the server. No audio, transcripts, tokens or user text ever
// leave the device here: only counts, states, error names and sample rates.
// Off for everyone except the owner allowlist (same list as the Record button).
import { API_BASE } from './apiBase'
import { canUseRecordingMode } from './recordingMode'

type DiagValue = string | number | boolean | null
export type DiagData = Record<string, DiagValue>

let enabled = false
let seq = 0
const launchId = Math.random().toString(36).slice(2, 8)

/** Called with the signed-in user id; diagnostics stay off unless it's an owner. */
export function setDiagUser(userId: string | null): void {
  enabled = canUseRecordingMode(userId)
}

export function diagOn(): boolean {
  return enabled
}

/** Fire-and-forget. Never throws, never blocks the caller. */
export function diag(event: string, data: DiagData = {}): void {
  if (!enabled) return
  const body = JSON.stringify({ event, launch: launchId, seq: ++seq, t: Math.round(performance.now()), ...data })
  try {
    void fetch(`${API_BASE}/api/diag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* diagnostics must never affect the app */
  }
}

// Every microphone stream the app has ever opened in this launch, so we can
// count how many are still live (that is what keeps the iOS mic dot lit).
const streams: MediaStream[] = []

export function trackStream(stream: MediaStream): void {
  streams.push(stream)
}

export function liveMicTracks(): number {
  let live = 0
  for (const s of streams) for (const t of s.getAudioTracks()) if (t.readyState === 'live') live++
  return live
}

export function streamsOpened(): number {
  return streams.length
}
