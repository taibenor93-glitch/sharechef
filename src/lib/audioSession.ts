// iPhone only: tells iOS the cook's microphone is finished (native
// AudioSessionPlugin, ios/App/App/AudioSessionPlugin.swift). Without it the web
// view keeps its capture alive after every track is stopped, and the orange
// mic dot stays lit. Safe to call any number of times; a no-op off iOS.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { diag } from './diag'

interface AudioSessionPlugin {
  release(): Promise<{ before: string; after: string; sessionDeactivated: boolean; sessionError: string }>
  state(): Promise<{ mic: string }>
}

export const AudioSession = registerPlugin<AudioSessionPlugin>('AudioSession')

/** The web view's mic capture as iOS sees it: 'active', 'muted' or 'none'. */
export async function nativeMicState(): Promise<string> {
  if (Capacitor.getPlatform() !== 'ios') return 'n/a'
  try { return (await AudioSession.state()).mic } catch { return 'error' }
}

export async function releaseNativeAudio(): Promise<void> {
  if (Capacitor.getPlatform() !== 'ios') return
  try {
    const r = await AudioSession.release()
    // Logged under the existing release_mic report so the server needs no change.
    diag('release_mic', {
      native: true,
      before: r.before,
      after: r.after,
      sessionOff: r.sessionDeactivated,
      sessionError: (r.sessionError || '').slice(0, 120),
    })
  } catch (e) {
    diag('release_mic', { native: true, failed: true, message: (e instanceof Error ? e.message : String(e)).slice(0, 120) })
  }
}
