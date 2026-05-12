import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import client from '../../api/client'

/**
 * Registration modal — prompts for XXXX-XXXX-XXXX pass code.
 * Props: isOpen, onClose, event ({ id, name }), onSuccess (optional cb)
 */
export default function RegistrationModal({ isOpen, onClose, event, onSuccess }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const inputRef = useRef(null)

  const [key, setKey] = useState('')
  const [phase, setPhase] = useState('idle') // idle | loading | success | error | rate_limited
  const [errorMsg, setErrorMsg] = useState('')
  const [successLines, setSuccessLines] = useState([])
  const [shake, setShake] = useState(false)
  const [ttlMsg, setTtlMsg] = useState('')

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setKey('')
      setPhase('idle')
      setErrorMsg('')
      setSuccessLines([])
      setShake(false)
      setTtlMsg('')
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  function formatKey(raw) {
    // Strip dashes, uppercase, max 12 alphanum chars
    const stripped = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
    const parts = [stripped.slice(0, 4), stripped.slice(4, 8), stripped.slice(8, 12)].filter(Boolean)
    return parts.join('-')
  }

  function handleKeyInput(e) {
    const formatted = formatKey(e.target.value)
    setKey(formatted)
    setErrorMsg('')
    setPhase('idle')
  }

  const canSubmit = key.replace(/-/g, '').length === 12

  async function handleSubmit() {
    if (!canSubmit || phase === 'loading') return
    setPhase('loading')
    try {
      await client.post(`/events/${event.id}/validate-key`, { key })
      setSuccessLines([
        '> PASS CODE ACCEPTED',
        '> REGISTRATION CONFIRMED',
        `> WELCOME TO ${event.name.toUpperCase()}, ${user?.username?.toUpperCase() || 'OPERATIVE'}`,
        '> Redirecting to competition...',
      ])
      setPhase('success')
      if (onSuccess) onSuccess()
      setTimeout(() => {
        onClose()
        if (!onSuccess) navigate('/contracts')
      }, 2200)
    } catch (err) {
      const detail = err.response?.data?.detail || ''
      if (detail.startsWith('TOO_MANY_ATTEMPTS')) {
        const ttl = parseInt(detail.split('|')[1] || '600', 10)
        const mins = Math.ceil(ttl / 60)
        setTtlMsg(`Wait ${mins} minute${mins !== 1 ? 's' : ''} before retrying.`)
        setPhase('rate_limited')
      } else if (detail === 'ALREADY_REGISTERED') {
        setErrorMsg('You are already registered for this event.')
        setPhase('error')
      } else if (detail === 'REGISTRATION_REVOKED') {
        setErrorMsg('Your access to this event has been revoked. Contact your administrator.')
        setPhase('error')
      } else if (detail === 'EMAIL_DOMAIN_RESTRICTED') {
        setErrorMsg('Your email is not eligible for this event. Contact your administrator.')
        setPhase('error')
      } else if (detail === 'EMAIL_NOT_VERIFIED') {
        setErrorMsg('Your account email is not verified. Check your inbox or ask an administrator to verify you.')
        setPhase('error')
      } else if (detail === 'Account suspended') {
        setErrorMsg('Your account has been suspended. Contact your administrator.')
        setPhase('error')
      } else if (detail === 'EVENT_NOT_ACTIVE') {
        setErrorMsg('This event has not been activated yet. Ask your administrator to start the event.')
        setPhase('error')
      } else if (detail.startsWith('Only Operatives can register')) {
        setErrorMsg('Only Operative accounts can register with a pass code.')
        setPhase('error')
      } else if (detail.startsWith('NO_ORG')) {
        setErrorMsg('Your account must belong to an organization to register for this event.')
        setPhase('error')
      } else {
        setErrorMsg('INVALID PASS CODE')
        setPhase('error')
        setShake(true)
        setKey('')
        setTimeout(() => setShake(false), 600)
      }
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSubmit()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(8,8,16,0.92)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-sm border border-ghost/30 rounded-sm"
        style={{ background: '#12121A' }}
      >
        {/* Header */}
        <div className="border-b border-ghost/10 px-5 py-3 flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] text-ghost tracking-widest">EVENT REGISTRATION</p>
            <p className="font-mono text-xs text-ember tracking-widest font-bold mt-0.5">
              {event?.name?.toUpperCase()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-ghost hover:text-danger text-xs tracking-widest"
          >
            [ × ]
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          {/* Terminal intro */}
          {phase !== 'success' && (
            <div className="font-mono text-xs space-y-0.5" style={{ color: '#6B6B80' }}>
              <p>&gt; IDENTITY VERIFIED: <span className="text-bone">{user?.username}</span></p>
              <p>&gt; EVENT: <span className="text-bone">{event?.name?.toUpperCase()}</span></p>
              <p>&gt; ENTER PASS CODE TO REGISTER</p>
            </div>
          )}

          {/* Success output */}
          {phase === 'success' && (
            <div className="font-mono text-xs space-y-0.5">
              {successLines.map((l, i) => (
                <p key={i} style={{ color: i === 0 ? '#00FF88' : i < 3 ? '#F0F0F0' : '#6B6B80' }}>{l}</p>
              ))}
            </div>
          )}

          {/* Rate limited */}
          {phase === 'rate_limited' && (
            <div className="font-mono text-xs space-y-0.5" style={{ color: '#FF2D2D' }}>
              <p>&gt; TOO MANY ATTEMPTS</p>
              <p>&gt; {ttlMsg}</p>
            </div>
          )}

          {/* Input + error */}
          {phase !== 'success' && phase !== 'rate_limited' && (
            <>
              <div className={`transition-transform ${shake ? 'animate-[shake_0.3s_ease]' : ''}`}>
                <input
                  ref={inputRef}
                  type="text"
                  value={key}
                  onChange={handleKeyInput}
                  onKeyDown={handleKeyDown}
                  placeholder="XXXX-XXXX-XXXX"
                  maxLength={14}
                  className="w-full font-mono text-xl text-center tracking-[0.3em] bg-void border border-ghost/30 focus:border-ember focus:outline-none rounded-sm py-3 px-4 text-bone placeholder-ghost/40 transition-colors"
                  style={{ letterSpacing: '0.3em' }}
                />
              </div>

              {errorMsg && (
                <div className="font-mono text-xs space-y-0.5" style={{ color: '#FF2D2D' }}>
                  <p>&gt; {errorMsg}</p>
                  {errorMsg === 'INVALID PASS CODE' && (
                    <p style={{ color: '#6B6B80' }}>&gt; Verify your code and try again.</p>
                  )}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={!canSubmit || phase === 'loading'}
                className="w-full font-mono text-xs tracking-widest py-2.5 rounded-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: canSubmit ? '#FF4500' : 'transparent',
                  color: canSubmit ? '#000' : '#6B6B80',
                  border: canSubmit ? '1px solid #FF4500' : '1px solid #6B6B80',
                }}
              >
                {phase === 'loading' ? '[ VERIFYING... ]' : '[ REGISTER ]'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
