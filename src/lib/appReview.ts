// In-app rating prompt after the 3rd finished cook with Micheli.
// iPhone side: ios/App/App/AppReviewPlugin.swift
// Apple decides whether the prompt actually shows (at most 3 times a year,
// never in TestFlight). We ask once, after the 3rd cook on this device.
import { Capacitor, registerPlugin } from '@capacitor/core'

interface AppReviewPlugin {
  request(): Promise<{ asked: boolean }>
}

const AppReviewNative = registerPlugin<AppReviewPlugin>('AppReview')

const COUNT_KEY = 'sc.finishedCooks'
const ASKED_KEY = 'sc.reviewAsked'
export const ASK_AFTER_COOKS = 3

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable: skip */ }
}

// Call once per finished cook. Never throws, never blocks the cook.
export async function noteFinishedCook(): Promise<void> {
  const count = (Number(read(COUNT_KEY)) || 0) + 1
  write(COUNT_KEY, String(count))
  if (count < ASK_AFTER_COOKS || read(ASKED_KEY) === '1') return
  if (!Capacitor.isNativePlatform()) return
  write(ASKED_KEY, '1')
  try {
    await AppReviewNative.request()
  } catch { /* older build without the plugin: nothing to show */ }
}
