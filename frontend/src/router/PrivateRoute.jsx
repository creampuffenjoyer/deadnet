import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Redirects to /login if the user is not authenticated
export default function PrivateRoute() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/" replace />
  return <Outlet />
}
