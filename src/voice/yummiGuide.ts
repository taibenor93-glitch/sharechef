export function startYummiGuide(): void {
  console.log("Yummi Guide initialized")
}

export function isVoiceSupported(): boolean {
  return typeof window !== "undefined" && !!navigator?.mediaDevices
}

export function debugStartVoice(): void {
  if (!isVoiceSupported()) {
    console.warn("Voice not supported")
    return
  }

  startYummiGuide()
}
