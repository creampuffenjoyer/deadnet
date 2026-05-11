import { useAuth } from '../context/AuthContext'
import NotFound from '../pages/NotFound'

/**
 * Renders children only when the current user is the Architect.
 * Returns the 404 page for everyone else — route existence is not disclosed.
 */
export default function ArchitectRoute({ children }) {
  const { user } = useAuth()
  if (user?.role !== 'ARCHITECT') return <NotFound />
  return children
}
