export function startListening(onText: (text: string) => void): any {
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

  if (!SpeechRecognition) {
    console.warn("SpeechRecognition not supported")
    return undefined
  }

  const recognition = new SpeechRecognition()
  recognition.lang = "en-US"
  recognition.continuous = true
  recognition.interimResults = true

  recognition.onresult = (event: any) => {
    const transcript = Array.from(event.results as Iterable<SpeechRecognitionResult>)
      .filter((result: any) => result.isFinal)
      .map((result: any) => (result[0] as any).transcript)
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