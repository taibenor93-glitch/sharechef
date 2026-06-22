class PCMAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this._inputRate = (options.processorOptions && options.processorOptions.inputRate) || sampleRate || 44100
    this._targetRate = 24000
    this._ratio = this._inputRate / this._targetRate
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true

    const float32 = input[0]
    const outputLength = Math.floor(float32.length / this._ratio)
    if (outputLength === 0) return true

    const int16 = new Int16Array(outputLength)
    for (let i = 0; i < outputLength; i++) {
      const srcIdx = i * this._ratio
      const floor = Math.floor(srcIdx)
      const frac = srcIdx - floor
      const s0 = float32[floor] || 0
      const s1 = float32[floor + 1] !== undefined ? float32[floor + 1] : s0
      const sample = s0 + (s1 - s0) * frac
      const clamped = Math.max(-1, Math.min(1, sample))
      int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    }

    this.port.postMessage(int16.buffer, [int16.buffer])
    return true
  }
}

registerProcessor('pcm-audio-processor', PCMAudioProcessor)
