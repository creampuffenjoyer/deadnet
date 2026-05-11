import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import RegistrationModal from './RegistrationModal'

function useCountdown(targetIso) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!targetIso) { setLabel(''); return }
    const tick = () => {
      const diff = Math.max(0, new Date(targetIso) - Date.now())
      const h = String(Math.floor(diff / 3600000)).padStart(2, '0')
      const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0')
      const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0')
      setLabel(`${h}:${m}:${s}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetIso])
  return label
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Terminal-style locked state overlay for pages that require an active event / registration.
 *
 * Props:
 *   title         — first line, e.g. "CONTRACT BOARD OFFLINE"
 *   lines         — additional static lines (for offline mode)
 *   upcoming      — upcoming event object (may be null)
 *   mode          — "offline" (default) | "not_registered" | "removed"
 *   activeEvent   — active event object (used for not_registered / removed modes)
 */
export default function OfflineLock({ title, lines = [], upcoming, mode = 'offline', activeEvent }) {
  const countdown = useCountdown(upcoming?.start_time)
  const [modalOpen, setModalOpen] = useState(false)

  // ── NOT REGISTERED state ──────────────────────────────────────────────────
  if (mode === 'not_registered' && activeEvent) {
    return (
      <div className="flex-1 flex items-center justify-center py-20 px-4">
        <div className="font-mono text-sm space-y-2 max-w-md w-full">
          <p style={{ color: '#FF4500' }}>&gt; {title} RESTRICTED</p>
          <p style={{ color: '#6B6B80' }}>&gt; You are not registered for <span style={{ color: '#F0F0F0' }}>{activeEvent.name}</span>.</p>
          <p style={{ color: '#6B6B80' }}>&gt; Enter your pass code to compete.</p>
          <div className="pt-2">
            <button
              onClick={() => setModalOpen(true)}
              className="font-mono text-xs px-3 py-1.5 border border-ember/60 text-ember hover:bg-ember/10 transition-colors rounded-sm"
            >
              [ ENTER PASS CODE ]
            </button>
          </div>
        </div>
        <RegistrationModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          event={activeEvent}
          onSuccess={() => window.location.reload()}
        />
      </div>
    )
  }

  // ── REMOVED state ─────────────────────────────────────────────────────────
  if (mode === 'removed' && activeEvent) {
    return (
      <div className="flex-1 flex items-center justify-center py-20 px-4">
        <div className="font-mono text-sm space-y-1 max-w-md w-full">
          <p style={{ color: '#FF2D2D' }}>&gt; ACCESS REVOKED</p>
          <p style={{ color: '#6B6B80' }}>&gt; You have been removed from the current event.</p>
          <p style={{ color: '#6B6B80' }}>&gt; Contact your administrator for more information.</p>
          <p style={{ color: '#6B6B80' }}>&gt;</p>
          <p style={{ color: '#6B6B80' }}>
            &gt;{' '}
            <Link to="/requests" style={{ color: '#FF4500' }}>
              Open a request →
            </Link>
          </p>
        </div>
      </div>
    )
  }

  // ── OFFLINE state (default) ───────────────────────────────────────────────
  return (
    <div className="flex-1 flex items-center justify-center py-20 px-4">
      <div className="font-mono text-sm space-y-1 max-w-md w-full" style={{ color: '#6B6B80' }}>
        <p style={{ color: '#FF4500' }}>&gt; {title}</p>
        <p>&gt; NO ACTIVE COMPETITION</p>
        {lines.map((l, i) => <p key={i}>{l}</p>)}
        <p>&gt;</p>
        {upcoming ? (
          <>
            <p>&gt; NEXT EVENT: <span style={{ color: '#F0F0F0' }}>{upcoming.name}</span></p>
            {upcoming.start_time && countdown && (
              <p>&gt; COMMENCING IN: <span style={{ color: '#00FF88' }}>{countdown}</span></p>
            )}
            {!upcoming.start_time && <p>&gt; Start time TBD.</p>}
          </>
        ) : (
          <>
            <p>&gt; Awaiting event initialization.</p>
            <p>&gt;</p>
            <p>&gt; Stand by, Operative.</p>
          </>
        )}
      </div>
    </div>
  )
}
