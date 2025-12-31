const languageToLocale: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
  pt: "pt-PT",
}

export function speak(text: string, language = "en"): Promise<void> {
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
    const locale = languageToLocale[language] ?? "en-US"
    utterance.lang = locale
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
      const normalizedLocale = locale.toLowerCase()
      const matchesLocale = voiceList.filter((v: SpeechSynthesisVoice) =>
        (v.lang ?? "").toLowerCase().startsWith(normalizedLocale.slice(0, 2))
      )
      if (language === "en") {
        const preferred = matchesLocale.find((v) => preferredVoices.includes(v.name))
        return preferred ?? matchesLocale[0]
      }
      return matchesLocale[0]
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
