import { useEffect, useRef, useCallback } from 'react'

const IDLE_MS = 30 * 60 * 1000      // 30 min → auto logout
const WARN_MS = 25 * 60 * 1000      // 25 min → show warning

const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']

export function useIdleTimeout({ onWarn, onLogout, enabled }) {
  const warnTimer  = useRef(null)
  const logoutTimer = useRef(null)

  const clear = useCallback(() => {
    clearTimeout(warnTimer.current)
    clearTimeout(logoutTimer.current)
  }, [])

  const reset = useCallback(() => {
    if (!enabled) return
    clear()
    warnTimer.current  = setTimeout(onWarn,   WARN_MS)
    logoutTimer.current = setTimeout(onLogout, IDLE_MS)
  }, [enabled, clear, onWarn, onLogout])

  useEffect(() => {
    if (!enabled) { clear(); return }

    reset()
    EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }))
    return () => {
      clear()
      EVENTS.forEach(e => window.removeEventListener(e, reset))
    }
  }, [enabled, reset, clear])
}
