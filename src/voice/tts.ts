export function speak(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const synth = (window as any).speechSynthesis
    if (!synth) {
      console.warn("TTS not supported")
      resolve()
      return
    }

    synth.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.text = text
  utterance.lang = "en-US"
  utterance.rate = 0.92
  utterance.pitch = 1
  const preferredVoices = ["Samantha", "Allison", "Alex", "Victoria"]

  const cleanup = () => {
    utterance.onend = null
    utterance.onerror = null
    synth.onvoiceschanged = null
    }

    utterance.onend = () => {
      cleanup()
      resolve()
    }

    utterance.onerror = (event) => {
      cleanup()
      reject(event instanceof Error ? event : new Error(String(event?.error ?? event)))
    }

  const voices = synth.getVoices?.() ?? []

  const pickVoice = (voiceList: SpeechSynthesisVoice[]) => {
    const enUsVoices = voiceList.filter((v: SpeechSynthesisVoice) => v.lang === "en-US")
    const preferred = enUsVoices.find((v) => preferredVoices.includes(v.name))
    return preferred ?? enUsVoices[0]
  }

  if (!voices.length) {
    synth.onvoiceschanged = () => {
      const refreshedVoices = synth.getVoices?.() ?? []
      const refreshedVoice = pickVoice(refreshedVoices)
      if (refreshedVoice) {
        utterance.voice = refreshedVoice
      }
      synth.speak(utterance)
    }
    return
  }

  const voice = pickVoice(voices)
  if (voice) {
    utterance.voice = voice
  }

    synth.speak(utterance)
  })
}
