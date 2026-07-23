import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/Login'
import { SignupPage } from './pages/Signup'
import { HomePage } from './pages/Home'
import { SavedListPage } from './pages/SavedList'
import { SavedDetailPage } from './pages/SavedDetail'
import { PreferencesPage } from './pages/Preferences'
import { AboutPage } from './pages/About'
import { FAQPage } from './pages/FAQ'
import { PricingPage } from './pages/Pricing'

export default function App() {
  const { authed, loading } = useAuth()

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
      <Route path="/login" element={authed ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/signup" element={authed ? <Navigate to="/" replace /> : <SignupPage />} />
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
