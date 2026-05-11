import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ROLE_HOME = {
  ADMIN: '/admin/dashboard',
  CONTRACTOR: '/contractor/dashboard',
  HANDLER: '/handler/dashboard',
  OPERATIVE: '/operative/dashboard',
}

// Renders children only if the user has one of the required roles.
// Otherwise redirects to their own dashboard (not a 404).
export default function RoleRoute({ roles, children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) {
    return <Navigate to={ROLE_HOME[user.role] || '/'} replace />
  }
  return children
}

export { ROLE_HOME }
