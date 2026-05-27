export function startShareChefAI(): void {
  console.log("ShareChef AI initialized")
}

export function isVoiceSupported(): boolean {
  return typeof window !== "undefined" && !!navigator?.mediaDevices
}

export function debugStartVoice(): void {
  if (!isVoiceSupported()) {
    console.warn("Voice not supported")
    return
  }

  startShareChefAI()
}
