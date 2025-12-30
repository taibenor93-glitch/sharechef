import * as React from "react"
import { Routes, Route } from "react-router-dom"
import { HomePage, type HomePageHandle } from "./pages/Home"
import { NavBar } from "./components/NavBar"
import { debugStartVoice } from "./voice/yummiGuide"
import { startListening } from "./voice/speech"

export default function App(): JSX.Element {
  const homeRef = React.useRef<HomePageHandle>(null)

  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/" element={<HomePage ref={homeRef} />} />
      </Routes>
      <button
        onClick={() => {
          debugStartVoice()
          const recognition = startListening(async (text) => {
            console.log("HEARD:", text)
            const list = text
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 3)

            homeRef.current?.setIngredientsFromVoice?.(list)
            await homeRef.current?.optimizeWithList?.(list)
          })
          recognition?.start?.()
        }}
      >
        DEV: Start Voice
      </button>
    </>
  )
}
