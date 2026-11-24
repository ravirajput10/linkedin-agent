import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { EmptyState, LoadingState } from '@/components/ui'

/**
 * Gates the application shell.
 *
 * These guards are a navigation convenience, not the security boundary: every
 * endpoint enforces the same rules server-side, so a user who edits their way
 * past one of these still gets a 401 or 403 from the API.
 */
export function RequireAuth() {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  if (loading) return <LoadingState label="Checking your session…" />
  if (!isAuthenticated) {
    // Remember where they were headed so sign-in can send them back.
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <Outlet />
}

export function RequireAdmin() {
  const { isAdmin, loading } = useAuth()

  if (loading) return <LoadingState label="Checking your session…" />
  if (!isAdmin) {
    return (
      <EmptyState
        title="Administrators only"
        description="This area manages every account on the system. Ask an administrator if you need access."
      />
    )
  }
  return <Outlet />
}

/** Keeps a signed-in user off the sign-in and registration screens. */
export function RequireAnonymous() {
  const { isAuthenticated, loading } = useAuth()

  if (loading) return <LoadingState label="Checking your session…" />
  if (isAuthenticated) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
