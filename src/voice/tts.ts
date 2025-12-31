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
    const localeInput = normalizeLocale(language)
    const locale = localeInput.toLowerCase().startsWith("he") ? "he-IL" : localeInput
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

    const pickVoice = (voiceList: SpeechSynthesisVoice[]) => {
      const normalizedLocale = locale.toLowerCase()
      const langPrefix = normalizedLocale.slice(0, 2)
      const hebrewVoices = voiceList.filter((v: SpeechSynthesisVoice) =>
        (v.lang ?? "").toLowerCase().startsWith("he")
      )
      const hePrimary =
        hebrewVoices.find((v) => (v.lang ?? "").toLowerCase() === "he-il") ??
        hebrewVoices.find((v) => (v.lang ?? "").toLowerCase().startsWith("he-il"))
      const primaryMatches = voiceList.filter((v: SpeechSynthesisVoice) =>
        (v.lang ?? "").toLowerCase().startsWith(normalizedLocale)
      )
      const partialMatches = voiceList.filter((v: SpeechSynthesisVoice) =>
        (v.lang ?? "").toLowerCase().startsWith(langPrefix)
      )
      const englishVoices = voiceList.filter((v: SpeechSynthesisVoice) =>
        (v.lang ?? "").toLowerCase().startsWith("en")
      )

      if (langPrefix === "he") {
        if (hePrimary) return hePrimary
        if (hebrewVoices.length) return hebrewVoices[0]
      }

      if (primaryMatches.length) {
        const preferredPrimary = primaryMatches.find((v) => preferredVoices.includes(v.name))
        return preferredPrimary ?? primaryMatches[0]
      }
      if (partialMatches.length) {
        const preferredPartial = partialMatches.find((v) => preferredVoices.includes(v.name))
        return preferredPartial ?? partialMatches[0]
      }
      const preferredEnglish = englishVoices.find((v) => preferredVoices.includes(v.name))
      return preferredEnglish ?? englishVoices[0]
    }

    const speakWithVoices = () => {
      const voices = synth.getVoices?.() ?? []
      const voice = pickVoice(voices)
      if (voice) {
        utterance.voice = voice
      }
      if (locale.toLowerCase().startsWith("he") && voice) {
        console.log("TTS voice (he):", voice.name, voice.lang)
      }
      synth.speak(utterance)
    }

    if (!synth.getVoices?.()?.length) {
      synth.onvoiceschanged = () => {
        synth.onvoiceschanged = null
        speakWithVoices()
      }
      return
    }

    speakWithVoices()
  })
}
