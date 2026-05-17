import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'
import { usePlatformFormat } from '../hooks/usePlatformFormat'
import Button from './ui/Button'
import Badge from './ui/Badge'

const RARITY_ACCENT = {
  COMMON: 'border-common-glow/50',
  RARE: 'border-rare-glow/60 shadow-[0_0_30px_rgba(74,158,255,0.1)]',
  CLASSIFIED: 'border-classified-glow/60 shadow-[0_0_30px_rgba(255,45,45,0.12)]',
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'])
const isImageAtt = (att) => IMAGE_EXTS.has((att.original || '').split('.').pop().toLowerCase())

function toUtcDate(isoStr) {
  if (!isoStr) return null
  const s = isoStr.endsWith('Z') || isoStr.match(/[+-]\d{2}:\d{2}$/) ? isoStr : isoStr + 'Z'
  return new Date(s)
}

function formatCountdown(secs) {
  if (secs === null || secs === undefined || secs < 0) return null
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// Countdown hook that fires onExpire exactly once when timer first hits 0
function useDecayCountdown(nextDecayAt, onExpire) {
  const [secs, setSecs] = useState(null)
  const firedRef = useRef(false)
  const callbackRef = useRef(onExpire)
  callbackRef.current = onExpire

  useEffect(() => {
    if (!nextDecayAt) {
      setSecs(null)
      firedRef.current = false
      return
    }
    firedRef.current = false
    const target = toUtcDate(nextDecayAt)

    const tick = () => {
      const remaining = Math.max(0, Math.floor((target - Date.now()) / 1000))
      setSecs(remaining)
      if (remaining === 0 && !firedRef.current) {
        firedRef.current = true
        callbackRef.current?.()
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [nextDecayAt])

  return secs
}

export default function ContractModal({ contract, onClose, onClaimed, isReadOnly = false, onBookmark }) {
  const { user, setUser } = useAuth()
  const { max_flag_attempts } = usePlatformFormat()
  const [detail, setDetail] = useState(null)
  const [flag, setFlag] = useState('')
  const [status, setStatus] = useState(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [imgBlobUrls, setImgBlobUrls] = useState({})
  const [decayFlash, setDecayFlash] = useState(false)
  const [solversOpen, setSolversOpen] = useState(false)
  const [solvers, setSolvers] = useState(null)
  const [solversLoading, setSolversLoading] = useState(false)

  const isOperative = user?.role === 'OPERATIVE'
  const myAttempts = detail?.my_attempt_count ?? 0
  const maxAttempts = detail?.max_attempts ?? 0
  const attemptsExhausted = maxAttempts > 0 && myAttempts >= maxAttempts

  const fetchDetail = useCallback(() => {
    client.get(`/contracts/${contract.id}`).then(r => setDetail(r.data)).catch(() => {})
  }, [contract?.id])

  useEffect(() => {
    if (!contract) return
    setFlag('')
    setStatus(null)
    setStatusMsg('')
    setDetail(null)
    setImgBlobUrls({})
    setDecayFlash(false)
    setSolversOpen(false)
    setSolvers(null)
    fetchDetail()
  }, [contract?.id])

  const handleToggleSolvers = useCallback(() => {
    setSolversOpen(prev => {
      const next = !prev
      if (next && solvers === null && !solversLoading) {
        setSolversLoading(true)
        client.get(`/contracts/${contract.id}/solvers`)
          .then(r => setSolvers(r.data))
          .catch(() => setSolvers([]))
          .finally(() => setSolversLoading(false))
      }
      return next
    })
  }, [contract?.id, solvers, solversLoading])

  // Fetch image attachments as authenticated blobs for inline display
  useEffect(() => {
    const atts = (detail || contract)?.attachments || []
    const imgs = atts.filter(isImageAtt)
    if (!imgs.length) return

    const revoke = {}
    Promise.all(
      imgs.map(async (att) => {
        try {
          const res = await client.get(`/files/${att.stored}`, { responseType: 'blob' })
          revoke[att.stored] = URL.createObjectURL(res.data)
        } catch {}
      })
    ).then(() => setImgBlobUrls({ ...revoke }))

    return () => { Object.values(revoke).forEach(u => URL.revokeObjectURL(u)) }
  }, [detail?.attachments])

  // Fire when decay triggers while modal is open
  const handleModalDecay = useCallback(() => {
    setDecayFlash(true)
    fetchDetail()
    setTimeout(() => setDecayFlash(false), 2000)
  }, [fetchDetail])

  const c = detail || contract
  const nextDecayAtStr = detail?.next_decay_at ?? null
  const secsLeft = useDecayCountdown(nextDecayAtStr, handleModalDecay)

  const decayMode = c?.decay_mode
  const currentBc = c?.current_bc_value
  const baseBc    = c?.base_bc_value
  const nextBc    = c?.next_decay_bc
  const atFloor   = decayMode === 'TIME_BASED'
    && c?.next_decay_at === null
    && c?.next_decay_bc === null
    && currentBc < baseBc

  const handleClaim = async (e) => {
    e.preventDefault()
    if (!flag.trim()) return
    setSubmitting(true)
    setStatus(null)
    try {
      const { data } = await client.post(`/contracts/${contract.id}/claim`, { flag: flag.trim() })
      setStatus('success')
      setStatusMsg(
        data.is_first_blood
          ? `CONTRACT SEIZED — +${data.bc_earned} BC — FIRST BLOOD`
          : `CONTRACT CLAIMED — +${data.bc_earned} BC`
      )
      // Sync BC total and clearance into AuthContext so navbar/dashboard update immediately
      client.get('/auth/me').then(r => {
        localStorage.setItem('deadnet_user', JSON.stringify(r.data))
        setUser(r.data)
      }).catch(() => {})
      onClaimed?.()
    } catch (err) {
      const errDetail = err?.response?.data?.detail
      if (errDetail === 'INVALID_FLAG') {
        fetchDetail()
        setStatus('error')
        setStatusMsg('Invalid flag. Try again.')
      } else if (errDetail === 'ALREADY_CLAIMED') {
        setStatus('already'); setStatusMsg('You already claimed this contract.')
      } else if (errDetail === 'MAX_ATTEMPTS_REACHED') {
        setStatus('locked'); setStatusMsg('MAX ATTEMPTS REACHED — CONTRACT LOCKED')
        fetchDetail()
      } else if (errDetail === 'COMPETITION_NOT_STARTED') {
        setStatus('error'); setStatusMsg('Competition has not started yet.')
      } else if (errDetail === 'COMPETITION_ENDED') {
        setStatus('error'); setStatusMsg('Competition is over. Submissions are closed.')
      } else if (errDetail === 'COMPETITION_HALTED') {
        setStatus('error'); setStatusMsg('Competition is temporarily halted. Stand by.')
      } else if (errDetail === 'NO_ACTIVE_EVENT') {
        setStatus('error'); setStatusMsg('No active competition. Submissions are closed.')
      } else if (errDetail === 'NOT_REGISTERED') {
        setStatus('error'); setStatusMsg('You are not registered for this event.')
      } else if (errDetail === 'EVENT_ENDED') {
        setStatus('error'); setStatusMsg('This event has ended. Submissions are closed.')
      } else if (err?.response?.status === 429) {
        setStatus('rate'); setStatusMsg('Too many attempts. Wait 60 seconds.')
      } else {
        setStatus('error'); setStatusMsg('Submission failed. Try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!contract) return null

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 overflow-y-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <div className="fixed inset-0 bg-void/85 backdrop-blur-sm" onClick={onClose} />

        {/* Panel */}
        <motion.div
          className={`relative z-10 bg-abyss border rounded-sm w-full max-w-2xl mb-8 ${RARITY_ACCENT[c.rarity]}`}
          initial={{ scale: 0.96, y: 12, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.96, y: 12, opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-6 py-4 border-b border-ghost/20">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge label={c.rarity} type="rarity" />
                <span className="font-mono text-xs text-ghost tracking-widest">{c.category}</span>
                {c.is_first_blood_taken && (
                  <span className="font-mono text-xs text-ember border border-ember/40 px-2 py-0.5 rounded-sm tracking-widest">
                    CONTRACT SEIZED
                  </span>
                )}
              </div>
              <h2 className="font-ui font-bold text-xl text-bone">{c.title}</h2>
              {detail?.created_by_username && (
                <span className="font-mono text-[10px] text-ghost tracking-widest">
                  BY: {detail.created_by_username}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-ghost hover:text-bone font-mono text-xl leading-none ml-4 mt-1 transition-colors"
            >
              ×
            </button>
          </div>

          {/* BC value + decay info */}
          <div className="px-6 py-3 border-b border-ghost/10">
            <div className="flex items-start justify-between gap-4">
              <div>
                {/* VALUE DECREASED flash */}
                {decayFlash && (
                  <div className="font-mono text-[10px] text-danger tracking-widest mb-1 animate-pulse">
                    ⚠ VALUE DECREASED
                  </div>
                )}

                {/* BC value */}
                <span
                  className={`font-mono font-bold text-2xl transition-colors duration-300 ${decayFlash ? 'text-danger' : 'text-ember'}`}
                >
                  {decayMode === 'OFF'
                    ? `FIXED VALUE: ${currentBc} BC`
                    : `CURRENT VALUE: ${currentBc} BC`
                  }
                </span>

                {/* Decay status line */}
                {decayMode === 'TIME_BASED' && (
                  <div className="mt-1 font-mono text-xs text-ghost">
                    {atFloor ? (
                      <span>FLOOR REACHED — value will not decrease</span>
                    ) : nextBc && secsLeft !== null && secsLeft > 0 ? (
                      <span>
                        NEXT DROP:{' '}
                        <span className="text-bone">{nextBc} BC</span>
                        {' '}in{' '}
                        <span className="text-bone">{formatCountdown(secsLeft)}</span>
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Solver count — clickable to expand history */}
              <button
                onClick={handleToggleSolvers}
                className="font-mono text-xs text-ghost hover:text-bone shrink-0 flex items-center gap-1.5 transition-colors"
              >
                {c.claim_count} OPERATIVE{c.claim_count !== 1 ? 'S' : ''} CLAIMED
                <span className="text-[10px] opacity-60">{solversOpen ? '▲' : '▼'}</span>
              </button>
            </div>

            {/* Solver history dropdown */}
            {solversOpen && (
              <div className="mt-3 border border-ghost/15 rounded-sm bg-void/40 overflow-hidden max-h-48 overflow-y-auto">
                {solversLoading ? (
                  <div className="px-3 py-2 font-mono text-[11px] text-ghost animate-pulse tracking-widest">
                    LOADING...
                  </div>
                ) : !solvers || solvers.length === 0 ? (
                  <div className="px-3 py-2 font-mono text-[11px] text-ghost tracking-widest">
                    NO SOLVERS YET
                  </div>
                ) : (
                  <div className="divide-y divide-ghost/10">
                    {solvers.map((s, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2">
                        <span className={`font-mono text-[10px] w-5 text-center shrink-0 ${i === 0 ? 'text-ember font-bold' : 'text-ghost'}`}>
                          {i + 1}
                        </span>
                        {s.is_first_blood && (
                          <span className="font-mono text-[9px] text-ember border border-ember/40 px-1.5 py-0.5 rounded-sm tracking-widest shrink-0">
                            1ST
                          </span>
                        )}
                        <span className={`font-mono text-xs flex-1 ${i === 0 ? 'text-bone font-bold' : 'text-ghost'}`}>
                          {s.username}
                        </span>
                        <span className="font-mono text-[10px] text-ember shrink-0">+{s.bc_earned} BC</span>
                        <span className="font-mono text-[10px] text-ghost shrink-0">
                          {new Date(s.claimed_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Working on this */}
          {(contract?.team_working?.length > 0 || (isOperative && !c.is_claimed_by_me && !isReadOnly)) && (
            <div className="px-6 py-3 border-b border-ghost/10 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                {contract?.team_working?.length > 0 ? (
                  <>
                    <span className="font-mono text-[10px] text-flare/60 tracking-widest shrink-0">WORKING:</span>
                    {contract.team_working.map(u => (
                      <span key={u} className="font-mono text-xs font-bold text-flare">{u}</span>
                    ))}
                  </>
                ) : (
                  <span className="font-mono text-[10px] text-ghost/40 tracking-widest">
                    NO TEAMMATES WORKING ON THIS
                  </span>
                )}
              </div>
              {isOperative && !c.is_claimed_by_me && !isReadOnly && (
                <button
                  onClick={() => onBookmark?.(contract)}
                  className={`shrink-0 font-mono text-xs border px-3 py-1.5 rounded-sm tracking-widest transition-all ${
                    contract?.my_assignment_id
                      ? 'border-flare/60 bg-flare/10 text-flare'
                      : 'border-ghost/30 text-ghost hover:border-flare/40 hover:text-flare'
                  }`}
                >
                  {contract?.my_assignment_id ? "◈ I'M WORKING ON THIS" : '◇ MARK AS WORKING'}
                </button>
              )}
            </div>
          )}

          {/* Description */}
          <div className="px-6 py-5 border-b border-ghost/10">
            {detail ? (
              <div className="prose prose-invert prose-sm max-w-none font-mono text-sm text-ghost leading-relaxed
                prose-headings:text-bone prose-headings:font-ui prose-headings:font-bold
                prose-code:bg-void prose-code:text-ember prose-code:px-1 prose-code:rounded
                prose-pre:bg-void prose-pre:border prose-pre:border-ghost/20
                prose-blockquote:border-l-ember prose-blockquote:text-ghost prose-strong:text-bone">
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{detail.description}</ReactMarkdown>
              </div>
            ) : (
              <div className="font-mono text-xs text-ghost animate-pulse">LOADING BRIEFING...</div>
            )}
          </div>

          {/* Inline contract images */}
          {Object.keys(imgBlobUrls).length > 0 && (
            <div className="px-6 py-4 border-b border-ghost/10 space-y-3">
              {(c.attachments || []).filter(isImageAtt).map((att) =>
                imgBlobUrls[att.stored] ? (
                  <img
                    key={att.stored}
                    src={imgBlobUrls[att.stored]}
                    alt={att.original}
                    className="max-w-full rounded-sm border border-ghost/20"
                  />
                ) : null
              )}
            </div>
          )}

          {/* Attachments */}
          {c.attachments?.length > 0 && (
            <div className="px-6 py-4 border-b border-ghost/10">
              <p className="font-mono text-xs text-ghost tracking-widest mb-2">ATTACHMENTS</p>
              <div className="flex flex-wrap gap-2">
                {c.attachments.map((att, i) => (
                  <button
                    key={i}
                    onClick={async () => {
                      try {
                        const res = await client.get(`/files/${att.stored}`, { responseType: 'blob' })
                        const url = URL.createObjectURL(res.data)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = att.original
                        a.click()
                        URL.revokeObjectURL(url)
                      } catch {}
                    }}
                    className="font-mono text-xs text-rare-glow border border-rare-glow/40 hover:border-rare-glow px-3 py-1.5 rounded-sm transition-all"
                  >
                    ↓ {att.original}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Intel Drops link */}
          <div className="px-6 py-3 border-b border-ghost/10 flex items-center justify-between">
            <span className="font-mono text-xs text-ghost tracking-widest">INTEL DROPS AVAILABLE</span>
            <Link
              to={`/intel?contract=${c.id}`}
              onClick={onClose}
              className="font-mono text-xs text-ember hover:text-flare border border-ember/30 hover:border-ember px-3 py-1.5 rounded-sm transition-all"
            >
              [ VISIT THE BROKER ]
            </Link>
          </div>

          {/* Claim form */}
          <div className="px-6 py-5">
            {c.is_claimed_by_me ? (
              <div className="border border-success/30 bg-success/5 rounded-sm px-4 py-3 text-center">
                <span className="font-mono text-sm text-success font-bold tracking-widest">
                  ✓ CONTRACT CLOSED — ALREADY CLAIMED
                </span>
              </div>
            ) : isReadOnly ? (
              <div className="border border-ghost/20 rounded-sm px-4 py-3 text-center">
                <span className="font-mono text-xs text-ghost tracking-widest">
                  ⚠ COMPETITION CLOSED — SUBMISSIONS DISABLED
                </span>
              </div>
            ) : attemptsExhausted ? (
              <div className="border border-danger/40 bg-danger/10 rounded-sm px-4 py-3 text-center">
                <span className="font-mono text-sm text-danger font-bold tracking-widest">
                  ⛔ MAX ATTEMPTS REACHED — CONTRACT LOCKED
                </span>
              </div>
            ) : isOperative ? (
              <form onSubmit={handleClaim} className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="font-mono text-xs text-ghost tracking-widest">FLAG</label>
                  {maxAttempts > 0 && (
                    <span className="font-mono text-xs text-ghost tracking-widest">
                      ATTEMPTS:{' '}
                      <span className={myAttempts >= maxAttempts * 0.8 ? 'text-danger' : 'text-bone'}>
                        {myAttempts}
                      </span>
                      {' / '}{maxAttempts}
                    </span>
                  )}
                  {maxAttempts === 0 && myAttempts > 0 && (
                    <span className="font-mono text-xs text-ghost tracking-widest">
                      ATTEMPTS: <span className="text-bone">{myAttempts}</span>
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-2.5 font-mono text-sm text-bone placeholder-ghost/40 outline-none transition-all"
                    value={flag}
                    onChange={e => setFlag(e.target.value)}
                    disabled={submitting || status === 'locked'}
                    autoComplete="off"
                  />
                  <Button type="submit" loading={submitting} disabled={!flag.trim() || status === 'locked'}>
                    [ CLAIM ]
                  </Button>
                </div>

                {status && (
                  <div className={`border rounded-sm px-4 py-2 font-mono text-xs tracking-wide ${
                    status === 'success'
                      ? 'border-success/40 bg-success/10 text-success'
                      : status === 'locked'
                      ? 'border-danger/40 bg-danger/10 text-danger'
                      : 'border-danger/40 bg-danger/10 text-danger'
                  }`}>
                    {status === 'success' ? '✓ ' : '⚠ '}{statusMsg}
                  </div>
                )}
              </form>
            ) : (
              <div className="border border-ghost/20 rounded-sm px-4 py-3 text-center">
                <span className="font-mono text-xs text-ghost tracking-widest">[ VIEW ONLY ]</span>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
