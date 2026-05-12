import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import client from '../../api/client'
import GoingMaintenanceScreen from './GoingMaintenanceScreen'
import MaintenanceScreen from './MaintenanceScreen'

const EXEMPT_PATHS = ['/verify-email', '/reset-password', '/admin/activate']

export default function MaintenanceGate({ children }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [maintenance, setMaintenance] = useState(null)
  const [showTransition, setShowTransition] = useState(false)
  const prevRef = useRef(null)

  useEffect(() => {
    const check = async () => {
      try {
        const r = await client.get('/public/settings')
        const isOn = !!r.data.maintenance_mode
        setMaintenance(prev => {
          // If flipping on while running → trigger transition screen
          if (prev === false && isOn) setShowTransition(true)
          prevRef.current = isOn
          return isOn
        })
      } catch {
        setMaintenance(prev => prev ?? false)
      }
    }

    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [])

  if (maintenance === null) return null

  const isArchitect = user?.role === 'ARCHITECT'
  const isExemptPath = EXEMPT_PATHS.some(p => pathname.startsWith(p)) || pathname.startsWith('/architect')

  if (maintenance && !isArchitect && !isExemptPath) {
    if (showTransition) {
      return <GoingMaintenanceScreen onComplete={() => setShowTransition(false)} />
    }
    return <MaintenanceScreen />
  }

  return children
}
