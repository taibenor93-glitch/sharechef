export function startListening(onText: (text: string) => void): any {
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

  if (!SpeechRecognition) {
    console.warn("SpeechRecognition not supported")
    return undefined
  }

  const recognition = new SpeechRecognition()
  recognition.lang = "en-US"
  recognition.continuous = false
  recognition.interimResults = false

  recognition.onresult = (event: any) => {
    const transcript = Array.from(event.results)
      .flatMap((result) => Array.from(result))
      .filter((alt) => alt.isFinal)
      .map((alt) => alt.transcript)
      .join(" ")
      .trim()

    if (transcript) {
      onText(transcript)
    }
  }

  recognition.onerror = (event: any) => {
    console.warn((event && event.error) ?? event)
  }

  return recognition
}
