// Realtime voice client for Micheli.
// Talks to the server proxy at /ws/realtime, which bridges to OpenAI's
// current `gpt-realtime` model. Audio is PCM16 @ 24kHz both ways.

import { WS_BASE } from '../lib/apiBase'

export type VoiceStatus = 'idle' | 'connecting' | 'ready' | 'listening' | 'processing' | 'speaking'

export interface VoiceCallbacks {
  onStatus: (status: VoiceStatus) => void
  onTranscript: (text: string, role: 'user' | 'chef') => void
  onError: (message: string) => void
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

  constructor(callbacks: VoiceCallbacks) {
    this.cb = callbacks
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

  connect(accessToken?: string | null): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return
    this.ws = new WebSocket(`${WS_BASE}/ws/realtime`)
    this.cb.onStatus('connecting')
    this.ws.onopen = () => {
      // Identify the signed-in user to the server before any audio flows.
      // Guests send token: null and get an anonymous session.
      this.wsSend({ type: 'auth', token: accessToken ?? null })
      this.cb.onStatus('ready')
    }
    this.ws.onmessage = (e) => this.handleEvent(JSON.parse(e.data as string))
    this.ws.onerror = () => this.cb.onError('Connection error — refresh to reconnect.')
    this.ws.onclose = () => {
      this.stopListening()
      this.isPlayingAudio = false
      this.cb.onStatus('idle')
    }
  }

  disconnect(): void {
    this.stopListening()
    this.isPlayingAudio = false
    // Tell the server this is a deliberate goodbye, not an interruption —
    // a deliberate end closes the cook instead of resuming it next time.
    this.wsSend({ type: 'bye' })
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
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
    this.wsSend({ type: 'input_audio_buffer.clear' })
    this.wsSend({ type: 'response.create' })
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
