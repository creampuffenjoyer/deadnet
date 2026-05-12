import { useEffect, useState } from 'react'
import client from '../api/client'

/**
 * Fetches the current user's registration status for a specific event.
 * Returns { registered, status, registeredAt, registeredBy, loading }
 * status: "ACTIVE" | "REMOVED" | null
 */
export function useMyRegistration(eventId) {
  const [state, setState] = useState({ registered: false, status: null, registeredAt: null, registeredBy: null, loading: true })

  useEffect(() => {
    if (!eventId) {
      setState({ registered: false, status: null, registeredAt: null, registeredBy: null, loading: false })
      return
    }
    // Reset to loading so ContractBoard doesn't flash "not_registered" while the fetch is in-flight
    setState(prev => ({ ...prev, loading: true }))
    let mounted = true
    client.get(`/events/${eventId}/registration/me`)
      .then(r => {
        if (mounted) setState({
          registered: r.data.registered,
          status: r.data.status,
          registeredAt: r.data.registered_at,
          registeredBy: r.data.registered_by,
          loading: false,
        })
      })
      .catch(() => {
        if (mounted) setState({ registered: false, status: null, registeredAt: null, registeredBy: null, loading: false })
      })
    return () => { mounted = false }
  }, [eventId])

  return state
}
