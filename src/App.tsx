import * as React from "react"
import { Routes, Route } from "react-router-dom"
import { HomePage, type HomePageHandle } from "./pages/Home"
import { NavBar } from "./components/NavBar"
import { RealtimeVoice } from "./voice/realtimeVoice"

export default function App(): JSX.Element {
  const homeRef = React.useRef<HomePageHandle>(null)
  const voiceRef = React.useRef<RealtimeVoice | null>(null)
  const [active, setActive] = React.useState(false)

  const handleVoiceToggle = async () => {
    if (active) {
      voiceRef.current?.disconnect()
      voiceRef.current = null
      setActive(false)
      return
    }

    const voice = new RealtimeVoice({
      onStatus: (s) => console.log('[voice]', s),
      onTranscript: (text, role) => console.log(`[${role}]`, text),
      onError: (msg) => console.error('[voice error]', msg),
    })
    voiceRef.current = voice

    await voice.unlockAudio()
    voice.connect()
    setActive(true)
  }

  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/" element={<HomePage ref={homeRef} />} />
      </Routes>
      <button onClick={handleVoiceToggle}>
        {active ? 'DEV: Stop Voice' : 'DEV: Start Voice'}
      </button>
    </>
  )
}
