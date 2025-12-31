const languageToLocale: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
  pt: "pt-PT",
}

function normalizeLocale(language: string): string {
  const trimmed = (language ?? "en").trim()
  if (!trimmed) return "en-US"
  if (languageToLocale[trimmed]) return languageToLocale[trimmed]
  if (trimmed.toLowerCase() === "he") return "he-IL"
  return trimmed
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
    const locale = normalizeLocale(language)
    const padded =
      text
        .replace(/(\d)(?![\d.,])/g, "$1, ")
        .replace(/([:;])\s*/g, "$1 ")
        .replace(/(\.)(?!\s)/g, ". ")
        .replace(/([!?])(?!\s)/g, "$1 ")
        .replace(/(,)(?!\s)/g, ", ")
    utterance.text = padded
    utterance.lang = locale
    utterance.rate = 0.8
    utterance.pitch = 1
    const preferredVoices = ["Samantha", "Allison", "Alex", "Victoria", "Carmit", "Adi"]

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
      const langPrefix = normalizedLocale.slice(0, 2)
      const primaryMatches = voiceList.filter((v: SpeechSynthesisVoice) =>
        (v.lang ?? "").toLowerCase().startsWith(normalizedLocale)
      )
      const partialMatches = voiceList.filter((v: SpeechSynthesisVoice) =>
        (v.lang ?? "").toLowerCase().startsWith(langPrefix)
      )
      const englishVoices = voiceList.filter((v: SpeechSynthesisVoice) =>
        (v.lang ?? "").toLowerCase().startsWith("en")
      )

      if (primaryMatches.length) {
        const preferredPrimary = primaryMatches.find((v) => preferredVoices.includes(v.name))
        return preferredPrimary ?? primaryMatches[0]
      }
      if (partialMatches.length) {
        const preferredPartial = partialMatches.find((v) => preferredVoices.includes(v.name))
        return preferredPartial ?? partialMatches[0]
      }
      // For Hebrew, avoid falling back to English voice if available; prefer first Hebrew/lang-prefix match when present.
      if (langPrefix === "he" && primaryMatches.length === 0 && partialMatches.length === 0) {
        const hebrewVoices = voiceList.filter((v: SpeechSynthesisVoice) =>
          (v.lang ?? "").toLowerCase().startsWith("he")
        )
        if (hebrewVoices.length) return hebrewVoices[0]
      }
      const preferredEnglish = englishVoices.find((v) => preferredVoices.includes(v.name))
      return preferredEnglish ?? englishVoices[0]
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
