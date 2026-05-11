import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import client from '../api/client'
import NotFound from './NotFound'

const CHAR_DELAY = 28
const LINE_PAUSE = 120
const MAX_ATTEMPTS = 5

// ---------------------------------------------------------------------------
// Typewriter hook — starts only when lines array is non-empty
// ---------------------------------------------------------------------------
function useTypewriter(lines) {
  const [displayed, setDisplayed] = useState([])
  const [done, setDone] = useState(false)
  const cancelled = useRef(false)

  useEffect(() => {
    if (lines.length === 0) return
    cancelled.current = false
    setDisplayed([])
    setDone(false)
    let lineIdx = 0
    let charIdx = 0

    function tick() {
      if (cancelled.current) return
      if (lineIdx >= lines.length) {
        setDone(true)
        return
      }
      const currentLine = lines[lineIdx]
      if (charIdx <= currentLine.length) {
        setDisplayed(prev => {
          const next = [...prev]
          next[lineIdx] = currentLine.slice(0, charIdx)
          return next
        })
        charIdx++
        setTimeout(tick, CHAR_DELAY)
      } else {
        lineIdx++
        charIdx = 0
        setTimeout(tick, LINE_PAUSE)
      }
    }
    tick()
    return () => { cancelled.current = true }
  }, [lines.join('|')]) // eslint-disable-line

  return { displayed, done }
}

// ---------------------------------------------------------------------------
// VO1D Contract Card
// ---------------------------------------------------------------------------
function VoidCard({ contract, onClaim }) {
  const [glitch, setGlitch] = useState(false)

  return (
    <div
      onMouseEnter={() => setGlitch(true)}
      onMouseLeave={() => setGlitch(false)}
      className="relative border rounded-sm p-5 select-none"
      style={{
        borderColor: glitch ? 'rgba(232,232,240,0.7)' : 'rgba(232,232,240,0.25)',
        background: glitch ? 'rgba(232,232,240,0.03)' : 'transparent',
        transform: glitch
          ? `translateX(${(Math.random() - 0.5) * 4}px) skewX(${(Math.random() - 0.5) * 1.5}deg)`
          : 'none',
        transition: glitch ? 'none' : 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* V01D tag + bc value */}
      <div className="flex items-center justify-between mb-3">
        <span
          className="font-mono text-[10px] px-2 py-0.5 tracking-widest"
          style={{
            background: '#080810',
            color: '#E8E8F0',
            border: '1px solid rgba(232,232,240,0.5)',
            animation: 'voidStatic 3s steps(1) infinite',
          }}
        >
          [ V01D ]
        </span>
        <span className="font-mono text-sm font-bold" style={{ color: '#FF4500' }}>
          500 BC
        </span>
      </div>

      {/* Title */}
      <h3 className="font-mono font-bold text-base mb-2" style={{ color: '#E8E8F0' }}>
        {contract.title}
      </h3>

      {/* Description */}
      <pre
        className="font-mono text-xs leading-relaxed whitespace-pre-wrap mb-4"
        style={{ color: 'rgba(232,232,240,0.55)' }}
      >
        {contract.description}
      </pre>

      {/* CTA row */}
      {contract.is_claimed ? (
        <div
          className="font-mono text-[10px] tracking-widest px-3 py-1.5 w-fit"
          style={{ border: '1px solid rgba(0,255,136,0.4)', color: '#00FF88' }}
        >
          [ CONTRACT CLAIMED ]
        </div>
      ) : contract.locked ? (
        <div
          className="font-mono text-[10px] tracking-widest px-3 py-1.5 w-fit"
          style={{
            border: '1px solid rgba(232,232,240,0.1)',
            color: 'rgba(232,232,240,0.3)',
            background: 'rgba(232,232,240,0.05)',
          }}
        >
          [ SIGNAL LOST ]
        </div>
      ) : (
        <button
          onClick={() => onClaim(contract)}
          className="font-mono text-xs tracking-widest px-4 py-1.5 transition-all"
          style={{
            border: '1px solid rgba(232,232,240,0.3)',
            color: '#E8E8F0',
            background: 'transparent',
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'rgba(232,232,240,0.8)'
            e.currentTarget.style.background = 'rgba(232,232,240,0.07)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'rgba(232,232,240,0.3)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          [ CLAIM CONTRACT ]
        </button>
      )}

    </div>
  )
}

// ---------------------------------------------------------------------------
// Claim modal — custom VO1D styling (NOT shared Modal component)
// ---------------------------------------------------------------------------
function VoidClaimModal({ contract, onClose, onSuccess, onAttemptUpdate }) {
  const [flag, setFlag] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [shake, setShake] = useState(false)
  const [attempts, setAttempts] = useState(contract.attempts || 0)

  const locked = attempts >= MAX_ATTEMPTS && !success

  // Close on Escape (but not during success auto-close)
  useEffect(() => {
    function handler(e) {
      if (e.key === 'Escape' && !success) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [success, onClose])

  async function submit() {
    if (!flag.trim() || loading || locked || success) return
    setLoading(true)
    setError('')
    try {
      await client.post(`/v01d/contracts/${contract.id}/claim`, { flag: flag.trim() })
      setSuccess(true)
      // Auto-close and refresh contracts after 2 seconds
      setTimeout(() => onSuccess(), 2000)
    } catch (e) {
      const data = e.response?.data || {}
      const newAttempts = typeof data.attempts === 'number' ? data.attempts : attempts + 1
      setAttempts(newAttempts)
      onAttemptUpdate(contract.id, newAttempts)
      setError('INCORRECT — SIGNAL REJECTED')
      setFlag('')
      setShake(true)
      setTimeout(() => setShake(false), 600)
    } finally {
      setLoading(false)
    }
  }

  // Border color: green on success, red on error, white normally
  const topBorderColor = success ? '#00FF88' : error ? '#FF2D2D' : '#E8E8F0'

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop — not clickable during success auto-close */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(8,8,16,0.92)' }}
        onClick={success ? undefined : onClose}
      />

      {/* Panel */}
      <div
        className="relative z-10 w-full max-w-lg overflow-hidden"
        style={{
          background: '#080810',
          borderTop: `3px solid ${topBorderColor}`,
          borderLeft: '1px solid rgba(232,232,240,0.15)',
          borderRight: '1px solid rgba(232,232,240,0.15)',
          borderBottom: '1px solid rgba(232,232,240,0.15)',
          transition: 'border-top-color 0.35s ease',
        }}
      >
        {/* Heavy scanlines overlay */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.22) 2px, rgba(0,0,0,0.22) 4px)',
          }}
        />

        {/* Content */}
        <div className="relative z-10 p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <p
                className="font-mono text-[10px] tracking-widest mb-1"
                style={{ color: 'rgba(232,232,240,0.4)' }}
              >
                [ V01D CONTRACT ]
              </p>
              <h3 className="font-mono font-bold text-base" style={{ color: '#E8E8F0' }}>
                {contract.title}
              </h3>
            </div>
            <span className="font-mono text-sm font-bold mt-1" style={{ color: '#FF4500' }}>
              500 BC
            </span>
          </div>

          {/* ── Success state ── */}
          {success && (
            <div className="py-8 text-center space-y-3">
              <p
                className="font-mono text-[10px] tracking-[0.3em]"
                style={{ color: '#00FF88' }}
              >
                [ BOUNTY CLAIMED ]
              </p>
              <p className="font-mono text-sm" style={{ color: '#00FF88' }}>
                BOUNTY CLAIMED — 500 BC CREDITED TO VOID WALLET
              </p>
            </div>
          )}

          {/* ── Form state ── */}
          {!success && (
            <div className="space-y-4">
              {/* Flag input */}
              <div>
                <input
                  autoFocus
                  disabled={locked}
                  className={`w-full bg-transparent border font-mono text-sm px-3 py-2.5 outline-none${shake ? ' void-shake' : ''}`}
                  style={{
                    borderColor: shake ? '#FF2D2D' : 'rgba(232,232,240,0.2)',
                    color: '#E8E8F0',
                    caretColor: '#FF4500',
                    opacity: locked ? 0.4 : 1,
                    transition: 'border-color 0.2s',
                    cursor: locked ? 'not-allowed' : 'text',
                  }}
                  placeholder={locked ? 'SIGNAL LOST' : ''}
                  value={flag}
                  onChange={e => !locked && setFlag(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  onFocus={e => {
                    if (!shake && !locked) e.target.style.borderColor = 'rgba(232,232,240,0.6)'
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = shake ? '#FF2D2D' : 'rgba(232,232,240,0.2)'
                  }}
                />
                {error && (
                  <p
                    className="font-mono text-[11px] mt-1.5"
                    style={{ color: '#FF2D2D' }}
                  >
                    {error}
                  </p>
                )}
              </div>

              {/* Lock message — only shown when exhausted */}
              {locked && (
                <p
                  className="font-mono text-[11px] tracking-widest"
                  style={{ color: '#FF2D2D' }}
                >
                  VOID CONTRACT LOCKED — SIGNAL LOST
                </p>
              )}

              {/* Buttons */}
              <div className="flex items-center gap-3 pt-1">
                {locked ? (
                  <div
                    className="font-mono text-xs tracking-widest px-5 py-2"
                    style={{
                      background: 'rgba(232,232,240,0.06)',
                      color: 'rgba(232,232,240,0.25)',
                      border: '1px solid rgba(232,232,240,0.1)',
                    }}
                  >
                    [ SIGNAL LOST ]
                  </div>
                ) : (
                  <button
                    onClick={submit}
                    disabled={loading}
                    className="font-mono text-xs tracking-widest px-5 py-2 transition-all disabled:opacity-60"
                    style={{
                      background: '#E8E8F0',
                      color: '#080810',
                      border: '1px solid #E8E8F0',
                      cursor: loading ? 'wait' : 'pointer',
                      fontWeight: '700',
                    }}
                  >
                    {loading ? 'VERIFYING...' : '[ CLAIM CONTRACT ]'}
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="font-mono text-xs tracking-widest px-4 py-2"
                  style={{ color: 'rgba(232,232,240,0.4)', cursor: 'pointer' }}
                >
                  [ ABORT ]
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Signal lost — shown for 3s before redirecting to NotFound
// ---------------------------------------------------------------------------
function SignalLostScreen() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
         style={{ background: '#080810' }}>
      <div className="font-mono text-sm" style={{ color: '#FF4500' }}>
        <p>&gt; SIGNAL LOST — RECONNECT REQUIRED</p>
        <p className="mt-2 text-xs" style={{ color: '#6B6B80' }}>
          returning to the void...
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// VoidBoard page
// ---------------------------------------------------------------------------
export default function VoidBoard() {
  const [authorized, setAuthorized] = useState(null) // null=checking, true=ok, false=denied
  const [signalLost, setSignalLost] = useState(false)
  const [contracts, setContracts] = useState(null) // null = loading
  const [claimTarget, setClaimTarget] = useState(null)

  // Mount check — verify session gate before showing anything
  useEffect(() => {
    client.get('/v01d/verify')
      .then(() => setAuthorized(true))
      .catch(() => setAuthorized(false))
  }, [])

  // 5-min refresh interval — only runs while authorized
  useEffect(() => {
    if (!authorized) return
    const id = setInterval(() => {
      client.get('/v01d/verify').catch(() => {
        setSignalLost(true)
        setTimeout(() => setAuthorized(false), 3000)
      })
    }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [authorized])

  // Fetch contracts — only after session is verified
  useEffect(() => {
    if (!authorized) return
    client.get('/v01d/contracts')
      .then(r => setContracts(r.data))
      .catch(() => setContracts([]))
  }, [authorized])

  // Typewriter only starts after contracts have loaded
  const typingLines = contracts !== null
    ? [
        '> CONNECTION ESTABLISHED',
        '> LOCATION: UNKNOWN',
        '> YOU FOUND THE VOID.',
        '> EVERYONE IS WATCHING.',
        `> ${contracts.length} CONTRACT${contracts.length !== 1 ? 'S' : ''} AVAILABLE. CLAIM WHAT YOU CAN.`,
      ]
    : []

  const { displayed, done: typingDone } = useTypewriter(typingLines)

  function handleClaimSuccess() {
    setClaimTarget(null)
    client.get('/v01d/contracts').then(r => setContracts(r.data)).catch(() => {})
  }

  function handleAttemptUpdate(contractId, newAttempts) {
    setContracts(prev =>
      prev
        ? prev.map(c =>
            c.id === contractId
              ? { ...c, attempts: newAttempts, locked: newAttempts >= MAX_ATTEMPTS }
              : c
          )
        : prev
    )
    // Keep modal target in sync so the modal's counter stays accurate
    setClaimTarget(prev =>
      prev && prev.id === contractId
        ? { ...prev, attempts: newAttempts, locked: newAttempts >= MAX_ATTEMPTS }
        : prev
    )
  }

  if (authorized === null) return null
  if (signalLost) return <SignalLostScreen />
  if (!authorized) return <NotFound />

  return (
    <div
      className="min-h-screen flex flex-col relative"
      style={{ background: '#080810' }}
    >
      {/* Scanlines */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)',
        }}
      />

      <div className="relative z-10 max-w-3xl mx-auto w-full px-6 py-12 flex-1">

        {/* Typewriter opening sequence */}
        {!typingDone && (
          <div className="mb-10 space-y-1">
            {displayed.map((line, i) => (
              <p
                key={i}
                className="font-mono text-sm leading-7"
                style={{ color: '#FF4500' }}
              >
                {line}
                {i === displayed.length - 1 && (
                  <span className="animate-pulse ml-1">█</span>
                )}
              </p>
            ))}
          </div>
        )}

        {/* Contract cards — shown once typing finishes */}
        {typingDone && (
          <div className="space-y-4">
            {contracts.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
              >
                <VoidCard contract={c} onClaim={setClaimTarget} />
              </motion.div>
            ))}
            {contracts.length === 0 && (
              <p className="font-mono text-sm" style={{ color: 'rgba(232,232,240,0.35)' }}>
                no contracts in the void.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Return link */}
      <div className="relative z-10 text-center pb-8">
        <a
          href="/contracts"
          className="font-mono text-[11px] tracking-widest"
          style={{ color: '#6B6B85' }}
        >
          [ RETURN TO DEADNET ]
        </a>
      </div>

      {/* Claim modal — rendered outside the scrollable area so it always covers full viewport */}
      {claimTarget && (
        <VoidClaimModal
          contract={claimTarget}
          onClose={() => setClaimTarget(null)}
          onSuccess={handleClaimSuccess}
          onAttemptUpdate={handleAttemptUpdate}
        />
      )}

      <style>{`
        @keyframes voidStatic {
          0%   { opacity: 1; }
          88%  { opacity: 1; }
          90%  { opacity: 0.3; }
          92%  { opacity: 1; }
          96%  { opacity: 0.5; }
          100% { opacity: 1; }
        }
        @keyframes voidShake {
          0%, 100% { transform: translateX(0); }
          15%       { transform: translateX(-5px); }
          30%       { transform: translateX(5px); }
          45%       { transform: translateX(-4px); }
          60%       { transform: translateX(4px); }
          75%       { transform: translateX(-2px); }
          90%       { transform: translateX(2px); }
        }
        .void-shake {
          animation: voidShake 0.55s ease-in-out;
        }
      `}</style>
    </div>
  )
}
