import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Spinner } from './ui'

/**
 * Route guard.
 *
 * This is a UX gate only - real authorization is enforced by Row Level Security
 * in PostgreSQL. Hiding a screen here does NOT make the underlying data safe;
 * the RLS policies do that.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner label="Sessiya tekshirilmoqda…" />

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}

/** Sends authenticated users away from /login and /signup. */
export function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) return <Spinner label="Yuklanmoqda…" />
  if (session) return <Navigate to="/" replace />

  return <>{children}</>
}
