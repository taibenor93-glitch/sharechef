import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { authed, loading } = useAuth()
  if (loading) return null
  if (!authed) return <Navigate to="/login" replace />
  return <>{children}</>
}
