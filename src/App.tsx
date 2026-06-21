import * as React from "react"
import { Routes, Route, Navigate } from "react-router-dom"
import { HomePage, type HomePageHandle } from "./pages/Home"
import { LoginPage } from "./pages/Login"
import { SignupPage } from "./pages/Signup"
import { SavedListPage } from "./pages/SavedList"
import { SavedDetailPage } from "./pages/SavedDetail"
import { ProtectedRoute } from "./components/ProtectedRoute"
import { NavBar } from "./components/NavBar"
import { debugStartVoice } from "./voice/micheliGuide"
import { startListening } from "./voice/speech"

export default function App(): JSX.Element {
  const homeRef = React.useRef<HomePageHandle>(null)

  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/" element={<HomePage ref={homeRef} />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/saved" element={<ProtectedRoute><SavedListPage /></ProtectedRoute>} />
        <Route path="/saved/:id" element={<ProtectedRoute><SavedDetailPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
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
              .slice(0, 4)

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
