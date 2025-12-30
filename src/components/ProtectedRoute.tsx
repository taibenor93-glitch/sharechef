import { Navigate } from 'react-router-dom'
import { useSession } from '../hooks/useSession'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession()

  if (loading) {
    return (
      <div className="container">
        <div className="card">Loading…</div>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  return <>{children}</>
}
