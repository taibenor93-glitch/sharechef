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
  private processorNode: AudioWorkletNode | null = null
  private isPlayingAudio = false
  private nextPlayTime = 0
  private isListening = false
  private pendingTranscript = ''
  private cb: VoiceCallbacks

  constructor(callbacks: VoiceCallbacks) {
    this.cb = callbacks
  }

  /** Must be called inside a user gesture — unlocks AudioContext on iOS. */
  async unlockAudio(): Promise<void> {
    if (!this.playbackCtx) {
      this.playbackCtx = new (
        (window as any).AudioContext || (window as any).webkitAudioContext
      )({ sampleRate: 24000 })
    }
    if (this.playbackCtx!.state === 'suspended') await this.playbackCtx!.resume()
  }

  connect(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    this.ws = new WebSocket(`${protocol}//${location.host}/ws/realtime`)
    this.cb.onStatus('connecting')
    this.ws.onopen = () => this.cb.onStatus('ready')
    this.ws.onmessage = (e) => this.handleEvent(JSON.parse(e.data as string))
    this.ws.onerror = () => this.cb.onError('Connection error — refresh to reconnect.')
    this.ws.onclose = () => {
      this.stopListening()
      this.audioQueue = []
      this.isPlayingAudio = false
      this.cb.onStatus('idle')
    }
  }

  disconnect(): void {
    this.stopListening()
    this.audioQueue = []
    this.isPlayingAudio = false
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null }
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
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      }
      if (!this.audioCtx) {
        this.audioCtx = new (
          (window as any).AudioContext || (window as any).webkitAudioContext
        )()
        await this.audioCtx!.audioWorklet.addModule('/audio-processor.js')
      }
      if (this.audioCtx!.state === 'suspended') await this.audioCtx!.resume()

      const source = this.audioCtx!.createMediaStreamSource(this.micStream!)
      this.processorNode = new AudioWorkletNode(this.audioCtx!, 'pcm-audio-processor', { processorOptions: { inputRate: this.audioCtx!.sampleRate } })
      this.processorNode.port.onmessage = (event) => this.onAudioChunk(event.data as ArrayBuffer)
      source.connect(this.processorNode)
      this.processorNode.connect(this.audioCtx!.destination)

      this.isListening = true
      this.isTalking = false
      this.cb.onStatus('listening')
    } catch {
      this.cb.onError('Mic access denied. Please allow microphone in your browser settings.')
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
  }

  stopAudio(): void {
    this.audioQueue = []
    this.isPlayingAudio = false
    this.wsSend({ type: 'response.cancel' })
    this.wsSend({ type: 'input_audio_buffer.clear' })
    this.cb.onStatus('ready')
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private handleEvent(msg: Record<string, any>): void {
    switch (msg.type) {
      case 'response.audio.delta':
        this.queueAudio(msg.delta as string)
        break
      case 'response.audio_transcript.delta':
        this.pendingTranscript += msg.delta as string
        break
      case 'response.audio_transcript.done':
        if (this.pendingTranscript) {
          this.cb.onTranscript(this.pendingTranscript, 'chef')
          this.pendingTranscript = ''
        }
        break
      case 'response.done': {
        // Wait for scheduled audio to finish, then resume streaming mic
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
    // Server VAD: just stream audio — OpenAI detects turns automatically
    this.wsSend({ type: 'input_audio_buffer.append', audio: this.toBase64(buf) })
  }

  private queueAudio(base64: string): void {
    if (!this.playbackCtx) return
    if (!this.isPlayingAudio) {
      this.isPlayingAudio = true
      this.nextPlayTime = this.playbackCtx.currentTime
      this.cb.onStatus('speaking')
    }
    // Gapless: schedule each chunk to start exactly when the previous ends
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const samples = new Float32Array(bytes.length / 2)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768
    const buffer = this.playbackCtx.createBuffer(1, samples.length, 24000)
    buffer.getChannelData(0).set(samples)
    const source = this.playbackCtx.createBufferSource()
    source.buffer = buffer
    source.connect(this.playbackCtx.destination)
    source.start(this.nextPlayTime)
    this.nextPlayTime += buffer.duration
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
