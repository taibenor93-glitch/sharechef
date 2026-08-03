import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/Login'
import { SignupPage } from './pages/Signup'
import { ResetPasswordPage } from './pages/ResetPassword'
import { HomePage } from './pages/Home'
import { SavedListPage } from './pages/SavedList'
import { SavedDetailPage } from './pages/SavedDetail'
import { PreferencesPage } from './pages/Preferences'
import { AboutPage } from './pages/About'
import { FAQPage } from './pages/FAQ'
import { PricingPage } from './pages/Pricing'

export default function App() {
  const { authed, session, loading } = useAuth()

  if (loading) {
    return (
      <div className="boot">
        <div className="boot-mark">ShareChef</div>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <Routes>
      {/* Guest mode used to trap people: it counted as "authed", so /login and
          /signup bounced straight back home and the only way in was a nav button
          that sits under the phone status bar. Only a REAL session redirects now —
          a guest can always reach the sign-in page by URL or by any link. */}
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/signup" element={session ? <Navigate to="/" replace /> : <SignupPage />} />
      <Route path="/reset" element={<ResetPasswordPage />} />
      <Route element={<Layout />}>
        <Route path="/about" element={<AboutPage />} />
        <Route path="/faq" element={<FAQPage />} />
        <Route path="/pricing" element={<PricingPage />} />
      </Route>
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/saved" element={<SavedListPage />} />
        <Route path="/saved/:id" element={<SavedDetailPage />} />
        <Route path="/preferences" element={<PreferencesPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
