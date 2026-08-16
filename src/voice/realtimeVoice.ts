// Realtime voice client for Micheli.
// Talks to the server proxy at /ws/realtime, which bridges to OpenAI's
// current `gpt-realtime` model. Audio is PCM16 @ 24kHz both ways.

import { WS_BASE } from '../lib/apiBase'
import { getAnonId, getSessionId, initIdentity } from '../lib/session'
import { APP_VERSION, voiceActivity } from '../lib/events'

// Phase 1 events: identity + app version ride the auth frame ONLY when
// analytics is enabled, so a disabled build sends no persistent identifier.
const EVENTS_ON = import.meta.env.VITE_EVENTS_ENABLED === 'true'

export type VoiceStatus = 'idle' | 'connecting' | 'ready' | 'listening' | 'processing' | 'speaking'

export interface VoiceCallbacks {
  onStatus: (status: VoiceStatus) => void
  onTranscript: (text: string, role: 'user' | 'chef') => void
  onError: (message: string) => void
  /** What the SERVER decided about this session — the truth, not what the app assumed. */
  onSession?: (info: { auth: 'user' | 'guest'; language: string }) => void
}

export class RealtimeVoice {
  private ws: WebSocket | null = null
  private audioCtx: AudioContext | null = null
  private playbackCtx: AudioContext | null = null
  private micStream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private processorNode: AudioWorkletNode | null = null
  private isPlayingAudio = false
  private nextPlayTime = 0
  private isListening = false
  private pendingTranscript = ''
  private cb: VoiceCallbacks
  // Reconnect-after-drop: iOS loves to kill background sockets mid-cook.
  // A fresh token is fetched on every (re)connect, and the server briefs
  // Micheli on where the cook was, so a drop heals instead of restarting.
  private getToken: (() => Promise<string | null>) | null = null
  private getLanguage: (() => string | null) | null = null
  private intentionalEnd = false
  private reconnectAttempts = 0
  private reconnectTimer: number | null = null
  private hasStartedConversation = false // true once a real greeting/resume has actually fired
  private guestId: string
  // Screen Wake Lock: keeps the display on during an active cook so iOS never
  // freezes the page mid-recipe. Auto-released by the OS when the page hides;
  // re-acquired on return via visibilitychange. No-op on browsers without it.
  private wakeLock: { release: () => Promise<void> } | null = null
  private onVisibilityChange: (() => void) | null = null

  constructor(callbacks: VoiceCallbacks) {
    this.cb = callbacks
    this.guestId = this.loadOrCreateGuestId()
  }

  // A guest's cook-state resume key. sessionStorage-scoped — this tab, this page
  // load only. Never crosses tabs, never survives the tab closing, carries no
  // identity of its own.
  private loadOrCreateGuestId(): string {
    try {
      const existing = window.sessionStorage.getItem('sc_guest_id')
      if (existing) return existing
      const fresh = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `g-${Date.now()}-${Math.random().toString(36).slice(2)}`
      window.sessionStorage.setItem('sc_guest_id', fresh)
      return fresh
    } catch {
      return `g-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
  }

  /**
   * Keep the screen awake while a cook is active. Zero-touch depends on it:
   * a locked screen freezes the page, kills the socket, and breaks the flow.
   * Safe everywhere — browsers without the API (or a hidden page) just skip it.
   */
  private async acquireWakeLock(): Promise<void> {
    const wl = (navigator as any).wakeLock
    if (!wl || document.visibilityState !== 'visible') return
    try {
      this.wakeLock = await wl.request('screen')
    } catch {
      /* denied (low battery, etc.) — session still works, just without the lock */
    }
    if (!this.onVisibilityChange) {
      // The OS silently drops the lock whenever the page hides; take it back
      // the moment the user returns, for as long as the session is alive.
      this.onVisibilityChange = () => {
        if (document.visibilityState === 'visible' && !this.intentionalEnd) {
          void this.acquireWakeLock()
        }
      }
      document.addEventListener('visibilitychange', this.onVisibilityChange)
    }
  }

  private releaseWakeLock(): void {
    if (this.onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
      this.onVisibilityChange = null
    }
    if (this.wakeLock) {
      void this.wakeLock.release().catch(() => {})
      this.wakeLock = null
    }
  }

  /** Must be called inside a user gesture — unlocks AudioContext on iOS/Safari. */
  async unlockAudio(): Promise<void> {
    if (!this.playbackCtx) {
      this.playbackCtx = new (
        (window as any).AudioContext || (window as any).webkitAudioContext
      )({ sampleRate: 24000 })
    }
    if (this.playbackCtx!.state === 'suspended') await this.playbackCtx!.resume()
  }

  connect(
    tokenOrProvider?: string | null | (() => Promise<string | null>),
    languageProvider?: () => string | null
  ): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return
    this.getToken =
      typeof tokenOrProvider === 'function'
        ? tokenOrProvider
        : () => Promise.resolve(tokenOrProvider ?? null)
    this.getLanguage = languageProvider ?? null
    this.intentionalEnd = false
    this.reconnectAttempts = 0
    this.hasStartedConversation = false
    void this.acquireWakeLock()
    this.openSocket()
  }

  private openSocket(): void {
    this.ws = new WebSocket(`${WS_BASE}/ws/realtime`)
    this.cb.onStatus('connecting')
    this.ws.onopen = async () => {
      // Identify the signed-in user to the server before any audio flows.
      // Guests send token: null and get an anonymous session, tracked by a
      // stable guestId so a guest can resume too. The token is fetched fresh on
      // every (re)connect so it can never be stale.
      const token = this.getToken ? await this.getToken() : null
      const language = this.getLanguage ? this.getLanguage() : null
      // Analytics identity must be settled BEFORE any identifier leaves the
      // device — voice and app events from one launch share the same ids.
      if (EVENTS_ON) { try { await initIdentity() } catch { /* identity optional */ } }
      const isReconnectAttempt = this.reconnectAttempts > 0
      // Only tell the server "treat this as a real interrupted cook" once a
      // conversation had actually started — otherwise a blip during the very
      // first handshake would wrongly skip a first-time user's introduction.
      const isReconnect = isReconnectAttempt && this.hasStartedConversation
      // Set once, by hand, in your own browser devtools only:
      //   localStorage.setItem('sc_voice_test_token', '<the VOICE_TEST_TOKEN value>')
      // Never read from a bundled env var — that would ship it to every visitor.
      let testToken: string | null = null
      try { testToken = window.localStorage.getItem('sc_voice_test_token') } catch { /* ignore */ }
      this.wsSend({
        type: 'auth', token, language, guestId: this.guestId, isReconnect, testToken,
        ...(EVENTS_ON ? { anonId: getAnonId(), sessionId: getSessionId(), appVersion: APP_VERSION } : {}),
      })
      if (EVENTS_ON) voiceActivity() // session stays alive while cooking starts
      this.reconnectAttempts = 0
      this.cb.onStatus('ready')
      if (isReconnectAttempt) {
        // The server already decided what's true to say — grounded resume, an
        // honest "we got disconnected," or a first greeting. Just ask for it.
        this.triggerResume()
        this.startListening()
      }
    }
    this.ws.onmessage = (e) => {
      try {
        this.handleEvent(JSON.parse(e.data as string))
      } catch {
        /* never let one bad frame kill the session */
      }
    }
    this.ws.onerror = () => {
      /* the close handler that always follows decides whether to reconnect */
    }
    this.ws.onclose = () => {
      this.stopListening()
      this.isPlayingAudio = false
      if (!this.intentionalEnd && this.reconnectAttempts < 3) {
        this.reconnectAttempts++
        this.cb.onStatus('connecting')
        this.reconnectTimer = window.setTimeout(
          () => this.openSocket(),
          800 * this.reconnectAttempts
        )
        return
      }
      if (!this.intentionalEnd) {
        this.cb.onError('The connection dropped. Tap the mic — Micheli will pick up where you were.')
      }
      this.cb.onStatus('idle')
    }
  }

  disconnect(): void {
    this.intentionalEnd = true
    voiceActivity() // deliberate end is the last activity marker of the session
    this.releaseWakeLock()
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopListening()
    this.isPlayingAudio = false
    // Tell the server this is a deliberate goodbye, not an interruption —
    // a deliberate end closes the cook instead of resuming it next time.
    this.wsSend({ type: 'end_session' })
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close(1000)
      this.ws = null
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop())
      this.micStream = null
    }
    // Close audio contexts so their memory is fully reclaimed between sessions.
    if (this.audioCtx) { this.audioCtx.close().catch(() => {}); this.audioCtx = null }
    if (this.playbackCtx) { this.playbackCtx.close().catch(() => {}); this.playbackCtx = null }
    this.cb.onStatus('idle')
  }

  triggerGreeting(): void {
    this.hasStartedConversation = true
    this.wsSend({ type: 'input_audio_buffer.clear' })
    this.wsSend({ type: 'response.create' })
  }

  /**
   * Reconnect after an unexpected drop. The server already knows — from real
   * cook state, or its absence — what's true to say: a grounded resume, an
   * honest "we got disconnected, what were we cooking," or a first greeting.
   * This must never add a claim of its own; that override is exactly what let
   * Micheli invent a dish once the real state didn't survive a drop.
   */
  triggerResume(): void {
    this.triggerGreeting()
  }

  async startListening(): Promise<void> {
    if (this.isListening) return
    try {
      if (!this.micStream) {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        })
      }
      if (!this.audioCtx) {
        this.audioCtx = new (
          (window as any).AudioContext || (window as any).webkitAudioContext
        )()
        await this.audioCtx!.audioWorklet.addModule('/audio-processor.js')
      }
      if (this.audioCtx!.state === 'suspended') await this.audioCtx!.resume()

      this.sourceNode = this.audioCtx!.createMediaStreamSource(this.micStream!)
      this.processorNode = new AudioWorkletNode(this.audioCtx!, 'pcm-audio-processor', {
        processorOptions: { inputRate: this.audioCtx!.sampleRate },
      })
      this.processorNode.port.onmessage = (event) => this.onAudioChunk(event.data as ArrayBuffer)
      this.sourceNode.connect(this.processorNode)
      this.processorNode.connect(this.audioCtx!.destination)

      this.isListening = true
      this.cb.onStatus('listening')
    } catch (err: any) {
      console.error('startListening failed:', err?.name, err?.message)
      const friendly = err?.name === 'NotAllowedError'
        ? 'Micheli needs microphone access. Enable it in Settings > ShareChef > Microphone.'
        : 'Voice is unavailable right now. Tap the mic to try again.'
      this.cb.onError(friendly)
      this.cb.onStatus('ready')
    }
  }

  stopListening(): void {
    this.isListening = false
    if (this.processorNode) {
      this.processorNode.port.onmessage = null
      this.processorNode.disconnect()
      this.processorNode = null
    }
    // Disconnect the mic source node every cycle — otherwise a new one leaks on
    // each listen turn and iOS eventually jetsam-kills the app for memory.
    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
  }

  stopAudio(): void {
    this.isPlayingAudio = false
    this.wsSend({ type: 'response.cancel' })
    this.wsSend({ type: 'input_audio_buffer.clear' })
    this.cb.onStatus('ready')
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private handleEvent(msg: Record<string, any>): void {
    switch (msg.type) {
      // Server's verdict on who this session belongs to.
      case 'sc.session':
        this.cb.onSession?.({ auth: msg.auth === 'user' ? 'user' : 'guest', language: String(msg.language ?? '') })
        break
      // Assistant audio (gpt-realtime GA event name)
      case 'response.output_audio.delta':
        this.queueAudio(msg.delta as string)
        break
      // Assistant spoken transcript
      case 'response.output_audio_transcript.delta':
        this.pendingTranscript += (msg.delta as string) ?? ''
        break
      case 'response.output_audio_transcript.done':
        if (this.pendingTranscript.trim()) {
          this.cb.onTranscript(this.pendingTranscript.trim(), 'chef')
          this.pendingTranscript = ''
        }
        break
      // User's own speech, transcribed
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof msg.transcript === 'string' && msg.transcript.trim()) {
          this.cb.onTranscript(msg.transcript.trim(), 'user')
        }
        break
      case 'input_audio_buffer.speech_started':
        if (!this.isPlayingAudio) this.cb.onStatus('listening')
        break
      case 'response.created':
        this.cb.onStatus('processing')
        break
      case 'response.done': {
        voiceActivity() // completed turn: low-frequency lifecycle point, not the audio loop
        const remaining = this.playbackCtx
          ? Math.max(0, (this.nextPlayTime - this.playbackCtx.currentTime) * 1000) + 150
          : 150
        setTimeout(() => {
          this.isPlayingAudio = false
          if (this.playbackCtx) this.startListening()
        }, remaining)
        break
      }
      case 'error':
        this.cb.onError((msg.error as any)?.message || 'Realtime API error')
        this.cb.onStatus('ready')
        break
    }
  }

  private onAudioChunk(buf: ArrayBuffer): void {
    if (!this.isListening) return
    this.wsSend({ type: 'input_audio_buffer.append', audio: this.toBase64(buf) })
  }

  private queueAudio(base64: string): void {
    if (!this.playbackCtx || !base64) return
    if (!this.isPlayingAudio) {
      this.isPlayingAudio = true
      this.nextPlayTime = this.playbackCtx.currentTime + 0.15
      this.stopListening() // mute mic while Micheli speaks — avoids echo with server VAD
      this.cb.onStatus('speaking')
    }
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const samples = new Float32Array(bytes.length / 2)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768
    const buffer = this.playbackCtx.createBuffer(1, samples.length, 24000)
    buffer.getChannelData(0).set(samples)
    const node = this.playbackCtx.createBufferSource()
    node.buffer = buffer
    node.connect(this.playbackCtx.destination)
    const startAt = Math.max(this.nextPlayTime, this.playbackCtx.currentTime + 0.05)
    node.start(startAt)
    this.nextPlayTime = startAt + buffer.duration
  }

  private wsSend(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private toBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  }
}
