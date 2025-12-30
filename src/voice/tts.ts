export function speak(text: string): void {
  const synth = (window as any).speechSynthesis
  if (!synth) {
    console.warn("TTS not supported")
    return
  }

  synth.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.text = text
  utterance.lang = "en-US"
  utterance.rate = 1
  utterance.pitch = 1
  const voices = synth.getVoices?.() ?? []

  if (!voices.length) {
    synth.onvoiceschanged = () => {
      const refreshedVoices = synth.getVoices?.() ?? []
      const refreshedVoice = refreshedVoices.find((v: SpeechSynthesisVoice) => v.lang === "en-US")
      if (refreshedVoice) {
        utterance.voice = refreshedVoice
      }
      synth.speak(utterance)
    }
    return
  }

  const voice = voices.find((v: SpeechSynthesisVoice) => v.lang === "en-US")
  if (voice) {
    utterance.voice = voice
  }

  synth.speak(utterance)
}
