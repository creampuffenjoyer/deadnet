import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import client from '../../api/client'

const POLL_MS = 30_000

function fmt(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Modal helpers
// ---------------------------------------------------------------------------

function ModalOverlay({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-4">
      <div
        className="relative w-full max-w-lg rounded-sm flex flex-col"
        style={{
          background: '#0D0A0A',
          border: '1px solid rgba(255,45,45,0.5)',
          maxHeight: '90vh',
        }}
      >
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-4 font-mono text-xs text-ghost hover:text-danger transition-colors"
          >
            ✕
          </button>
        )}
        {children}
      </div>
    </div>
  )
}

function ModalHeader({ cc, timeLeft, halted }) {
  const isPanic = timeLeft < 300 && timeLeft > 0
  return (
    <div className="px-6 py-4 border-b" style={{ borderColor: 'rgba(255,45,45,0.3)' }}>
      <p className="font-mono text-xs text-danger tracking-widest animate-pulse mb-1">
        [ CC ] EMERGENCY CONTRACT
      </p>
      <h2 className="font-mono font-bold text-lg text-bone tracking-widest mb-2">{cc.title}</h2>
      <p
        className="font-mono text-sm font-bold tracking-widest"
        style={{ color: halted ? '#6B6B80' : isPanic ? '#FF2D2D' : '#FF6B00' }}
      >
        SIGNAL EXPIRES IN: {halted ? '—:— DISRUPTED' : fmt(timeLeft)}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CC Modal
// ---------------------------------------------------------------------------

function fmt_size(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function CCModal({ cc, timeLeft, halted, onClose, onClaimed }) {
  const [flag, setFlag] = useState('')
  const [phase, setPhase] = useState('input') // input|submitting|wrong|locked|revealing|revealed
  const [wrongMsg, setWrongMsg] = useState('')
  const [bcAwarded, setBcAwarded] = useState(0)
  const [displayBc, setDisplayBc] = useState(0)
  const [showClose, setShowClose] = useState(false)
  const [attemptsLeft, setAttemptsLeft] = useState(
    (cc.max_attempts || 5) - (cc.current_user_attempts || 0)
  )
  const [downloading, setDownloading] = useState(false)
  const [dlMsg, setDlMsg] = useState('')
  const inputRef = useRef()

  async function handleDownload() {
    setDownloading(true)
    setDlMsg('')
    try {
      const res = await client.get(`/corrupted-contracts/${cc.id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = cc.attachment_filename || 'challenge_file'
      a.click()
      URL.revokeObjectURL(url)
      setDlMsg('FILE RETRIEVED')
      setTimeout(() => setDlMsg(''), 2000)
    } catch {
      setDlMsg('DOWNLOAD FAILED')
      setTimeout(() => setDlMsg(''), 2000)
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => { inputRef.current?.focus() }, [])

  async function submit() {
    if (!flag.trim() || phase === 'submitting') return
    setPhase('submitting')
    try {
      const res = await client.post(`/corrupted-contracts/${cc.id}/claim`, { flag: flag.trim() })
      const data = res.data
      if (data.correct) {
        setBcAwarded(data.bc_awarded)
        let cur = 0
        const target = data.bc_awarded
        const steps = 24
        const inc = Math.max(1, Math.ceil(target / steps))
        setPhase('revealing')
        const iv = setInterval(() => {
          cur = Math.min(cur + inc, target)
          setDisplayBc(cur)
          if (cur >= target) {
            clearInterval(iv)
            setDisplayBc(target)
            setTimeout(() => {
              setPhase('revealed')
              setTimeout(() => setShowClose(true), 2000)
            }, 300)
          }
        }, 55)
        onClaimed(data.bc_awarded)
      } else {
        const rem = data.attempts_remaining ?? (attemptsLeft - 1)
        setAttemptsLeft(rem)
        if (data.locked || rem <= 0) {
          setPhase('locked')
        } else {
          setWrongMsg(`INVALID FLAG — ${rem} ATTEMPT${rem !== 1 ? 'S' : ''} REMAINING`)
          setPhase('wrong')
          setTimeout(() => { setPhase('input'); setFlag('') }, 2000)
        }
      }
    } catch (e) {
      const detail = e.response?.data?.detail
      if (
        detail === 'COMPETITION_HALTED' ||
        detail === 'COMPETITION_ENDED' ||
        detail === 'COMPETITION_NOT_STARTED'
      ) {
        setWrongMsg('SIGNAL DISRUPTED — COMPETITION NOT ACTIVE')
        setPhase('wrong')
        setTimeout(() => setPhase('input'), 3000)
      } else if (detail === 'CC_ALREADY_CLAIMED') {
        setPhase('locked')
        setWrongMsg('SIGNAL ALREADY EXTRACTED BY ANOTHER OPERATIVE')
      } else if (detail === 'TOO_MANY_ATTEMPTS') {
        setWrongMsg('RATE LIMIT — WAIT BEFORE RETRYING')
        setPhase('wrong')
        setTimeout(() => setPhase('input'), 3000)
      } else if (detail === 'CC_NOT_ACTIVE') {
        setWrongMsg('EMERGENCY CONTRACT NO LONGER ACTIVE')
        setPhase('wrong')
        setTimeout(() => setPhase('input'), 3000)
      } else if (detail === 'CC_EXPIRED') {
        setWrongMsg('SIGNAL EXPIRED')
        setPhase('wrong')
        setTimeout(() => setPhase('input'), 3000)
      } else {
        setWrongMsg(typeof detail === 'string' ? detail : 'TRANSMISSION FAILED — TRY AGAIN')
        setPhase('wrong')
        setTimeout(() => setPhase('input'), 2500)
      }
    }
  }

  // Already claimed this CC — locked view
  if (cc.current_user_claimed) {
    return (
      <ModalOverlay onClose={onClose}>
        <ModalHeader cc={cc} timeLeft={timeLeft} halted={halted} />
        <div className="px-6 py-8 space-y-2">
          <p className="font-mono text-xs text-success tracking-widest">&gt; SIGNAL SECURED</p>
          <p className="font-mono text-xs text-ghost tracking-widest">&gt; YOU EXTRACTED THIS CONTRACT</p>
          {cc.current_user_bc != null && (
            <p className="font-mono text-xs text-ember tracking-widest mt-3">
              &gt; Your extraction: <span className="font-bold">{cc.current_user_bc} BC</span>
            </p>
          )}
        </div>
        <div className="px-6 pb-6">
          <button
            onClick={onClose}
            className="w-full font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-4 py-2 rounded-sm tracking-widest transition-all"
          >
            [ CLOSE ]
          </button>
        </div>
      </ModalOverlay>
    )
  }

  // Reveal phases
  if (phase === 'revealing' || phase === 'revealed') {
    const isJackpot = bcAwarded === 500
    return (
      <ModalOverlay onClose={phase === 'revealed' && showClose ? onClose : null}>
        {phase === 'revealed' && isJackpot && (
          <div
            className="fixed inset-0 pointer-events-none"
            style={{ boxShadow: 'inset 0 0 100px rgba(255,69,0,0.4)', zIndex: 49 }}
          />
        )}
        <div className="px-6 py-12 text-center">
          {phase === 'revealing' && (
            <p className="font-mono text-xs text-ghost tracking-widest mb-4 animate-pulse">
              EXTRACTING SIGNAL...
            </p>
          )}
          <div
            className="font-mono font-bold tracking-widest transition-all duration-500"
            style={{
              fontSize: phase === 'revealed' ? '5rem' : '3rem',
              color: '#FF4500',
              textShadow: phase === 'revealed' ? '0 0 40px rgba(255,69,0,0.7)' : 'none',
              lineHeight: 1,
            }}
          >
            {displayBc}
          </div>
          <p className="font-mono text-sm text-ghost tracking-widest mt-3 mb-6">BC SECURED</p>

          {phase === 'revealed' && isJackpot && (
            <p className="font-mono text-sm text-ember tracking-widest font-bold animate-pulse mb-4">
              MAXIMUM SIGNAL — 500 BC SECURED
            </p>
          )}
          {showClose && (
            <button
              onClick={onClose}
              className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-6 py-2 rounded-sm tracking-widest transition-all"
            >
              [ RETURN TO DEADNET ]
            </button>
          )}
        </div>
      </ModalOverlay>
    )
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalHeader cc={cc} timeLeft={timeLeft} halted={halted} />
      <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
        <span className="font-mono text-[10px] text-ghost border border-ghost/20 px-2 py-0.5 rounded-sm tracking-widest">
          {cc.category}
        </span>

        {cc.description && (
          <p className="font-mono text-xs text-bone/80 leading-relaxed whitespace-pre-wrap">{cc.description}</p>
        )}

        {/* File attachment download */}
        {cc.has_attachment && (
          <div
            className="rounded-sm px-3 py-3"
            style={{ background: '#0E0E1A', borderLeft: '2px solid #FF6B00', border: '1px solid #2A2A42', borderLeftWidth: '2px', borderLeftColor: '#FF6B00' }}
          >
            <p className="font-mono text-[10px] text-ghost/60 tracking-widest mb-1">CHALLENGE FILE</p>
            <p className="font-mono text-xs text-bone/70 mb-2">
              {cc.attachment_filename} {cc.attachment_size ? `— ${fmt_size(cc.attachment_size)}` : ''}
            </p>
            {timeLeft <= 0 || halted ? (
              <p className="font-mono text-xs text-danger tracking-widest">SIGNAL LOST — FILE UNAVAILABLE</p>
            ) : (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="font-mono text-xs px-3 py-1.5 rounded-sm tracking-widest transition-all disabled:opacity-50"
                style={{ border: '1px solid rgba(255,107,0,0.6)', color: '#FF6B00', background: 'rgba(255,107,0,0.08)' }}
              >
                {downloading ? 'RETRIEVING FILE...' : dlMsg || '[ DOWNLOAD FILE ]'}
              </button>
            )}
          </div>
        )}

        <div
          className="rounded-sm px-3 py-2 flex items-center gap-2"
          style={{ background: 'rgba(255,45,45,0.07)', border: '1px solid rgba(255,45,45,0.25)' }}
        >
          <span className="font-mono text-xs text-danger/70 tracking-widest">BC REWARD:</span>
          <span className="font-mono text-sm text-danger font-bold">???</span>
        </div>

        <div>
          <input
            ref={inputRef}
            className="w-full bg-void border rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none transition-colors"
            style={{
              borderColor: phase === 'wrong' ? '#FF2D2D' : 'rgba(107,107,128,0.3)',
            }}
            placeholder="FLAG{...}"
            value={flag}
            onChange={e => setFlag(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            disabled={phase === 'submitting' || phase === 'locked'}
          />
        </div>

        <div className="flex items-center justify-between min-h-[16px]">
          <span className="font-mono text-[10px] text-ghost tracking-widest">
            ATTEMPTS: {(cc.max_attempts || 5) - attemptsLeft} / {cc.max_attempts || 5}
          </span>
          {phase === 'wrong' && (
            <span className="font-mono text-[10px] text-danger tracking-widest">{wrongMsg}</span>
          )}
        </div>

        {phase === 'locked' && (
          <div className="rounded-sm px-3 py-2" style={{ border: '1px solid rgba(255,45,45,0.3)' }}>
            <p className="font-mono text-xs text-danger tracking-widest">
              {wrongMsg || 'SIGNAL LOCKED — MAX ATTEMPTS REACHED'}
            </p>
          </div>
        )}
      </div>

      {phase !== 'locked' && (
        <div className="px-6 pb-6">
          <button
            onClick={submit}
            disabled={phase === 'submitting' || !flag.trim() || timeLeft <= 0 || halted}
            className="w-full font-mono text-xs py-2.5 rounded-sm tracking-widest transition-all disabled:opacity-40"
            style={{
              background: 'rgba(255,45,45,0.15)',
              border: '1px solid rgba(255,45,45,0.6)',
              color: '#FF2D2D',
            }}
          >
            {phase === 'submitting' ? 'TRANSMITTING...' : '[ CLAIM CONTRACT ]'}
          </button>
        </div>
      )}
    </ModalOverlay>
  )
}

// ---------------------------------------------------------------------------
// Inner banner (hooks live here, role check done by outer wrapper)
// ---------------------------------------------------------------------------

function CCBannerInner() {
  const [cc, setCC] = useState(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [halted, setHalted] = useState(false)
  const [justClaimed, setJustClaimed] = useState(null)
  const timerRef = useRef(null)
  const ccIdRef = useRef(null)

  async function fetchCC() {
    try {
      const res = await client.get('/corrupted-contracts/active')
      const data = res.data
      setCC(data)
      if (data) {
        if (ccIdRef.current !== data.id) {
          ccIdRef.current = data.id
          setTimeLeft(data.time_remaining_seconds)
          setJustClaimed(null)
          setHalted(false)
        }
      } else {
        ccIdRef.current = null
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchCC()
    const id = setInterval(fetchCC, POLL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!cc || halted) return
    timerRef.current = setInterval(() => {
      setTimeLeft(t => Math.max(0, t - 1))
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [cc?.id, halted])

  function handleClaimed(bc) {
    setJustClaimed(bc)
    setModalOpen(false)
    fetchCC()
  }

  const isPanic      = timeLeft < 300 && timeLeft > 0
  const userClaimed  = cc?.current_user_claimed || justClaimed !== null
  const claimedBc    = justClaimed ?? cc?.current_user_bc
  const recentClosed = cc?.is_recently_closed
  const winner       = cc?.claimed_by_username

  // Show banner when: CC is active OR recently closed
  const showBanner = !!cc

  return (
    <>
      <AnimatePresence>
        {showBanner && (
          <motion.div
            key="cc-banner"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            style={{ overflow: 'hidden' }}
          >
            {/* ── User just claimed this CC ── */}
            {userClaimed && (
              <div
                className="px-4 py-2 flex items-center gap-3"
                style={{
                  background: 'rgba(0,255,136,0.06)',
                  borderBottom: '1px solid rgba(0,255,136,0.25)',
                  borderLeft: '3px solid #00FF88',
                }}
              >
                <span className="font-mono text-xs tracking-widest" style={{ color: '#00FF88' }}>
                  EMERGENCY CONTRACT CLAIMED — {claimedBc} BC SECURED
                </span>
              </div>
            )}

            {/* ── Recently closed — someone else won ── */}
            {!userClaimed && recentClosed && winner && (
              <div
                className="px-4 py-2 flex items-center gap-3 flex-wrap"
                style={{
                  background: 'rgba(107,107,128,0.06)',
                  borderBottom: '1px solid rgba(107,107,128,0.2)',
                  borderLeft: '3px solid #6B6B80',
                }}
              >
                <span className="font-mono text-xs text-ghost tracking-widest">
                  EMERGENCY CONTRACT SEIZED —
                </span>
                <span className="font-mono text-xs text-bone font-bold tracking-widest">{winner}</span>
                <span className="font-mono text-xs text-ghost tracking-widest">EXTRACTED THE SIGNAL</span>
                <span className="font-mono text-xs text-ghost/40 tracking-widest ml-2">— TRY AGAIN NEXT TIME</span>
              </div>
            )}

            {/* ── Recently closed — no one claimed (expired) ── */}
            {!userClaimed && recentClosed && !winner && (
              <div
                className="px-4 py-2 flex items-center gap-3"
                style={{
                  background: 'rgba(107,107,128,0.04)',
                  borderBottom: '1px solid rgba(107,107,128,0.15)',
                  borderLeft: '3px solid #6B6B80',
                }}
              >
                <span className="font-mono text-xs text-ghost/50 tracking-widest">
                  EMERGENCY CONTRACT EXPIRED — SIGNAL LOST — NO EXTRACTION MADE
                </span>
              </div>
            )}

            {/* ── Active CC ── */}
            {!recentClosed && (
              <div
                className="px-4 py-2 flex items-center justify-between flex-wrap gap-2"
                style={{
                  background: '#1A0A0A',
                  borderBottom: '1px solid rgba(255,45,45,0.3)',
                  borderLeft: '3px solid #FF2D2D',
                  animation: isPanic ? 'ccPanic 0.7s steps(1) infinite' : undefined,
                }}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-xs text-danger tracking-widest font-bold">
                    EMERGENCY CONTRACT
                  </span>
                  <span className="font-mono text-xs text-bone tracking-widest">{cc.title}</span>
                  {cc.has_attachment && (
                    <span className="font-mono text-[10px] text-ghost/50 tracking-widest">[ FILE ATTACHED ]</span>
                  )}
                  {winner && (
                    <span className="font-mono text-[10px] tracking-widest" style={{ color: '#00FF88' }}>
                      SEIZED BY {winner}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span
                    className="font-mono text-xs font-bold tracking-widest"
                    style={{ color: isPanic ? '#FF2D2D' : '#FF6B00' }}
                  >
                    TIMER: {fmt(timeLeft)}
                  </span>
                  <span className="font-mono text-xs text-ghost/60 tracking-widest">BC: ???</span>
                  {winner ? (
                    <span className="font-mono text-[10px] text-ghost/40 tracking-widest px-2">
                      SIGNAL EXTRACTED
                    </span>
                  ) : (
                    <button
                      onClick={() => setModalOpen(true)}
                      className="font-mono text-xs px-3 py-1 rounded-sm tracking-widest transition-all"
                      style={{
                        border: '1px solid rgba(255,45,45,0.6)',
                        color: '#FF2D2D',
                        background: 'rgba(255,45,45,0.1)',
                      }}
                    >
                      [ ACCESS ]
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {modalOpen && cc && (
        <CCModal
          cc={cc}
          timeLeft={timeLeft}
          halted={halted}
          onClose={() => setModalOpen(false)}
          onClaimed={handleClaimed}
        />
      )}

      <style>{`
        @keyframes ccPanic {
          0%   { border-left-color: #FF2D2D; background: #1A0A0A; }
          50%  { border-left-color: #FF6B00; background: #200A0A; }
          100% { border-left-color: #FF2D2D; background: #1A0A0A; }
        }
      `}</style>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main export — role guard
// ---------------------------------------------------------------------------

export default function CCBanner() {
  const { user } = useAuth()
  if (!user || user.role !== 'OPERATIVE') return null
  return <CCBannerInner />
}
