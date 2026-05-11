import { useEffect, useState } from 'react'
import client from '../api/client'

/**
 * Fetches /events/active and returns the current event status.
 * { active: event|null, upcoming: event|null, loading: bool }
 * Polls every 60s to pick up lifecycle changes.
 */
export function useEventStatus() {
  const [status, setStatus] = useState({ active: null, upcoming: null, loading: true })

  useEffect(() => {
    let mounted = true
    async function fetch() {
      try {
        const r = await client.get('/events/active')
        if (mounted) setStatus({ active: r.data.active, upcoming: r.data.upcoming, loading: false })
      } catch {
        if (mounted) setStatus({ active: null, upcoming: null, loading: false })
      }
    }
    fetch()
    const id = setInterval(fetch, 60000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  return status
}
