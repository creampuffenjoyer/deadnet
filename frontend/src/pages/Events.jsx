import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Navbar from '../components/ui/Navbar'
import Footer from '../components/ui/Footer'
import Modal from '../components/ui/Modal'
import NotFound from './NotFound'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'

// ── constants ────────────────────────────────────────────────────────────────

export const ALL_CTF_CATEGORIES = [
  'Web', 'Cryptography', 'Forensics', 'Pwn', 'Misc', 'OSINT',
  'Reverse Engineering', 'SQL Injection', 'Steganography', 'Network',
  'Mobile', 'Cloud', 'Blockchain', 'Hardware', 'Binary Exploitation', 'Social Engineering',
]

// Category picker — multi-select pill grid
function CategoryPicker({ selected, onChange }) {
  function toggle(cat) {
    onChange(
      selected.includes(cat)
        ? selected.filter(c => c !== cat)
        : [...selected, cat]
    )
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="font-mono text-xs text-ghost uppercase tracking-widest">
          Allowed Categories
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => onChange([...ALL_CTF_CATEGORIES])}
            className="font-mono text-[9px] text-ghost/60 hover:text-bone transition-colors">ALL</button>
          <span className="font-mono text-[9px] text-ghost/30">|</span>
          <button type="button" onClick={() => onChange([])}
            className="font-mono text-[9px] text-ghost/60 hover:text-bone transition-colors">NONE</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ALL_CTF_CATEGORIES.map(cat => {
          const on = selected.includes(cat)
          return (
            <button
              key={cat}
              type="button"
              onClick={() => toggle(cat)}
              className={`font-mono text-[10px] px-2 py-1 rounded-sm border tracking-wide transition-colors ${
                on
                  ? 'border-ember text-ember bg-ember/10'
                  : 'border-ghost/20 text-ghost/50 hover:border-ghost/50 hover:text-ghost'
              }`}
            >
              {cat}
            </button>
          )
        })}
      </div>
      {selected.length === 0 && (
        <p className="font-mono text-[10px] text-ghost/40 mt-1">All categories allowed when none selected.</p>
      )}
      {selected.length > 0 && selected.length < ALL_CTF_CATEGORIES.length && (
        <p className="font-mono text-[10px] text-ghost/40 mt-1">{selected.length} of {ALL_CTF_CATEGORIES.length} categories enabled.</p>
      )}
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function fmtShort(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

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

// ── Toggle component ─────────────────────────────────────────────────────────

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors border ${
        value ? 'bg-ember/20 border-ember' : 'bg-void border-ghost/30'
      }`}
    >
      <span className={`inline-block h-4 w-4 rounded-full transition-transform ${
        value ? 'translate-x-6 bg-ember' : 'translate-x-1 bg-ghost'
      }`} />
    </button>
  )
}

// ── Per-event decay override form ─────────────────────────────────────────────

const DECAY_TIER_DEFAULTS = { h1: '1.0', p1: '90', h2: '2.0', p2: '75', h3: '3.0', p3: '60', floor: '50' }

function validateDecayTiers(v) {
  const [t1h, t2h, t3h, t1p, t2p, t3p, fp] = [
    parseFloat(v.h1), parseFloat(v.h2), parseFloat(v.h3),
    parseInt(v.p1),   parseInt(v.p2),   parseInt(v.p3),   parseInt(v.floor),
  ]
  const e = []
  if (isNaN(t1h) || t1h <= 0) e.push('Tier 1 hours must be > 0')
  if (isNaN(t2h) || t2h <= 0) e.push('Tier 2 hours must be > 0')
  if (isNaN(t3h) || t3h <= 0) e.push('Tier 3 hours must be > 0')
  if (!isNaN(t1h) && !isNaN(t2h) && t2h <= t1h) e.push('Tier 2 must be after Tier 1')
  if (!isNaN(t2h) && !isNaN(t3h) && t3h <= t2h) e.push('Tier 3 must be after Tier 2')
  if (!isNaN(t1p) && !isNaN(t2p) && t1p <= t2p) e.push('Tier 1% must be greater than Tier 2%')
  if (!isNaN(t2p) && !isNaN(t3p) && t2p <= t3p) e.push('Tier 2% must be greater than Tier 3%')
  if (!isNaN(t3p) && !isNaN(fp) && fp > t3p) e.push('Floor must not exceed Tier 3%')
  if (isNaN(fp) || fp < 1) e.push('Floor must be at least 1%')
  return e
}

function DecayOverrideForm({ decay, onChange }) {
  // decay = { enabled, mode, h1, p1, h2, p2, h3, p3, floor }
  const inputCls = 'bg-void border border-ghost/20 rounded-sm px-2 py-1 font-mono text-xs text-bone focus:outline-none focus:border-ember text-center'
  const errors = decay.enabled ? validateDecayTiers(decay) : []

  return (
    <div className="border border-ghost/20 rounded-sm p-4 space-y-4">
      {/* Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs text-ghost tracking-widest">DECAY SETTINGS (OPTIONAL)</p>
          <p className="font-mono text-[10px] text-ghost/50 mt-0.5">Override platform decay settings for this event</p>
        </div>
        <Toggle value={decay.enabled} onChange={v => onChange({ ...decay, enabled: v })} />
      </div>

      {/* Override config */}
      {decay.enabled && (
        <div className="space-y-4 pt-1 border-t border-ghost/10">
          {/* Mode */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'TIME_BASED', label: 'TIME-BASED' },
              { value: 'OFF',        label: 'NO DECAY' },
            ].map(opt => {
              const active = decay.mode === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ ...decay, mode: opt.value })}
                  className="text-left px-3 py-2 border rounded-sm transition-all flex items-center gap-2"
                  style={active
                    ? { borderColor: '#FF4500', background: 'rgba(255,69,0,0.08)' }
                    : { borderColor: 'rgba(107,107,128,0.2)' }
                  }
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border-2 shrink-0"
                    style={active
                      ? { borderColor: '#FF4500', background: '#FF4500' }
                      : { borderColor: 'rgba(107,107,128,0.4)' }
                    }
                  />
                  <span className={`font-mono text-[10px] font-bold tracking-widest ${active ? 'text-bone' : 'text-ghost'}`}>
                    {opt.label}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Tier rows — only when TIME_BASED */}
          {decay.mode === 'TIME_BASED' && (
            <div className="space-y-2">
              {[
                { n: 1, hk: 'h1', pk: 'p1' },
                { n: 2, hk: 'h2', pk: 'p2' },
                { n: 3, hk: 'h3', pk: 'p3' },
              ].map(({ n, hk, pk }) => (
                <div key={n} className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10px] text-ghost tracking-widest w-8">T{n}</span>
                  <span className="font-mono text-[10px] text-ghost/50">After</span>
                  <input type="number" step="0.5" min="0.1" className={`w-14 ${inputCls}`}
                    value={decay[hk] ?? ''} onChange={e => onChange({ ...decay, [hk]: e.target.value })} />
                  <span className="font-mono text-[10px] text-ghost/50">hr →</span>
                  <input type="number" step="1" min="1" max="99" className={`w-12 ${inputCls}`}
                    value={decay[pk] ?? ''} onChange={e => onChange({ ...decay, [pk]: e.target.value })} />
                  <span className="font-mono text-[10px] text-ghost/50">% BC</span>
                </div>
              ))}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] text-ghost tracking-widest w-8">FL</span>
                <span className="font-mono text-[10px] text-ghost/50">Min:</span>
                <input type="number" step="1" min="1" max="99" className={`w-12 ${inputCls}`}
                  value={decay.floor ?? ''} onChange={e => onChange({ ...decay, floor: e.target.value })} />
                <span className="font-mono text-[10px] text-ghost/50">%</span>
              </div>
              {errors.length > 0 && (
                <div className="space-y-0.5 pt-1">
                  {errors.map((err, i) => (
                    <p key={i} className="font-mono text-[10px] text-danger">⚠ {err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Build API payload for decay override from form state
function decayPayload(decay) {
  if (!decay.enabled) return { clear_decay_overrides: true }
  if (decay.mode === 'OFF') return { decay_mode_override: 'OFF' }
  return {
    decay_mode_override: 'TIME_BASED',
    decay_tier_1_hours_override:   parseFloat(decay.h1) || null,
    decay_tier_1_percent_override: parseInt(decay.p1)   || null,
    decay_tier_2_hours_override:   parseFloat(decay.h2) || null,
    decay_tier_2_percent_override: parseInt(decay.p2)   || null,
    decay_tier_3_hours_override:   parseFloat(decay.h3) || null,
    decay_tier_3_percent_override: parseInt(decay.p3)   || null,
    decay_floor_percent_override:  parseInt(decay.floor) || null,
  }
}

// ── Event type badge ─────────────────────────────────────────────────────────

function MajorBadge() {
  return (
    <span className="font-mono text-[10px] border border-ember/60 text-ember px-2 py-0.5 rounded-sm tracking-widest shrink-0">
      MAJOR EVENT
    </span>
  )
}

function LocalBadge() {
  return (
    <span className="font-mono text-[10px] border border-ghost/40 text-ghost px-2 py-0.5 rounded-sm tracking-widest shrink-0">
      LOCAL
    </span>
  )
}

// ── Current Event Card ────────────────────────────────────────────────────────

function UpcomingCard({ event, onStart, onEdit, onRefresh, loading }) {
  const isMajor = event.event_type === 'MAJOR'
  return (
    <div className="border border-[#FF6B00]/60 bg-abyss rounded-sm p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="font-mono text-xs border border-[#FF6B00] text-[#FF6B00] px-2 py-0.5 rounded-sm">
              UPCOMING
            </span>
            {isMajor ? <MajorBadge /> : <LocalBadge />}
            <span className="font-mono font-bold text-bone text-base truncate">{event.name}</span>
          </div>
          <div className="font-mono text-xs text-ghost space-y-1">
            <p>Starts: {fmt(event.start_time)}</p>
            <p>Ends:&nbsp;&nbsp;{fmt(event.end_time)}</p>
            <p className="flex items-center gap-2">
              Registration:{' '}
              <span className={event.registration_open ? 'text-[#00FF88]' : 'text-danger'}>
                {event.registration_open ? 'OPEN' : 'CLOSED'}
              </span>
              {event.participant_count != null && (
                <span className="text-ghost">• {event.participant_count} registered</span>
              )}
            </p>
            {event.decay_mode_override && (
              <p className="text-ghost/50 text-[10px]">
                Decay: <span className="text-ghost">{event.decay_mode_override === 'OFF' ? 'OFF (override)' : 'TIME-BASED (override)'}</span>
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={onStart}
          disabled={loading}
          className="font-mono text-xs px-3 py-1.5 bg-ember text-void hover:bg-flare transition-colors disabled:opacity-50 rounded-sm"
        >
          [ COMMENCE HACKING ]
        </button>
        <button
          onClick={onEdit}
          className="font-mono text-xs px-3 py-1.5 border border-ghost/40 text-ghost hover:text-bone hover:border-bone/40 transition-colors rounded-sm"
        >
          [ EDIT EVENT ]
        </button>
      </div>
      <RegistrationKeySection event={event} onRefresh={onRefresh} />
    </div>
  )
}

function ActiveCard({ event, onHalt, onClose, onManage, onFreezeToggle, boardFrozen, onRefresh, loading }) {
  const countdown = useCountdown(event.end_time)
  const isMajor = event.event_type === 'MAJOR'
  return (
    <div className="border border-[#00FF88]/60 bg-abyss rounded-sm p-5 relative overflow-hidden">
      {/* pulse border animation */}
      <div className="absolute inset-0 rounded-sm border border-[#00FF88]/20 animate-pulse pointer-events-none" />
      <div className="flex items-start justify-between gap-4 relative">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="font-mono text-xs border border-[#00FF88] text-[#00FF88] px-2 py-0.5 rounded-sm flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00FF88] animate-pulse inline-block" />
              LIVE
            </span>
            {isMajor ? <MajorBadge /> : <LocalBadge />}
            <span className="font-mono font-bold text-bone text-base truncate">{event.name}</span>
          </div>
          <div className="font-mono text-xs text-ghost space-y-1">
            <p>Started: {fmt(event.start_time)}</p>
            {event.end_time && (
              <p>Ends in: <span className="text-[#00FF88] font-bold">{countdown || '—'}</span></p>
            )}
            {event.participant_count != null && (
              <p>Participants: {event.participant_count} registered</p>
            )}
            {event.decay_mode_override && (
              <p className="text-ghost/50 text-[10px]">
                Decay: <span className="text-ghost">{event.decay_mode_override === 'OFF' ? 'OFF (override)' : 'TIME-BASED (override)'}</span>
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4 relative">
        <button
          onClick={onHalt}
          disabled={loading}
          className="font-mono text-xs px-3 py-1.5 border border-danger/60 text-danger hover:bg-danger/10 transition-colors disabled:opacity-50 rounded-sm"
        >
          [ HALT OPERATIONS ]
        </button>
        <button
          onClick={onClose}
          disabled={loading}
          className="font-mono text-xs px-3 py-1.5 border border-ghost/40 text-ghost hover:text-bone hover:border-bone/40 transition-colors disabled:opacity-50 rounded-sm"
        >
          [ CLOSE EVENT ]
        </button>
        <button
          onClick={onFreezeToggle}
          disabled={loading}
          className="font-mono text-xs px-3 py-1.5 border border-ghost/40 text-ghost hover:text-bone hover:border-bone/40 transition-colors disabled:opacity-50 rounded-sm"
        >
          {boardFrozen ? '[ UNFREEZE BOUNTY BOARD ]' : '[ FREEZE BOUNTY BOARD ]'}
        </button>
        <button
          onClick={onManage}
          className="font-mono text-xs px-3 py-1.5 border border-ember/40 text-ember hover:bg-ember/10 transition-colors rounded-sm"
        >
          [ MANAGE ]
        </button>
      </div>
      <RegistrationKeySection event={event} onRefresh={onRefresh} />
    </div>
  )
}

function ClosedCard({ event, onArchive, onExport, loading }) {
  const winner = event.top_player
  const isMajor = event.event_type === 'MAJOR'
  return (
    <div className="border border-ghost/40 bg-abyss rounded-sm p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="font-mono text-xs border border-ghost/50 text-ghost px-2 py-0.5 rounded-sm">
              CLOSED
            </span>
            {isMajor ? <MajorBadge /> : <LocalBadge />}
            <span className="font-mono font-bold text-bone text-base truncate">{event.name}</span>
          </div>
          <div className="font-mono text-xs text-ghost space-y-1">
            <p>Ended: {fmt(event.end_time || event.closed_at)}</p>
            <p>
              Participants: {event.participant_count ?? '—'}
              {winner && <span> • Leader: <span className="text-ember">{winner}</span></span>}
            </p>
            <p className="flex items-center gap-1 text-[#FF6B00]">
              <span>⚠</span> Pending archive
            </p>
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={onArchive}
          disabled={loading}
          className="font-mono text-xs px-3 py-1.5 bg-ember text-void hover:bg-flare transition-colors disabled:opacity-50 rounded-sm"
        >
          [ ARCHIVE EVENT ]
        </button>
        <button
          onClick={onExport}
          disabled={loading}
          className="font-mono text-xs px-3 py-1.5 border border-ghost/40 text-ghost hover:text-bone hover:border-bone/40 transition-colors disabled:opacity-50 rounded-sm"
        >
          [ EXPORT RESULTS ]
        </button>
      </div>
    </div>
  )
}

// ── Registration Key Section ──────────────────────────────────────────────────

function RegistrationKeySection({ event, onRefresh }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [regenConfirm, setRegenConfirm] = useState(false)
  const [regenLoading, setRegenLoading] = useState(false)
  const [regenError, setRegenError] = useState('')
  const [domain, setDomain] = useState(event.email_domain_restriction || '')
  const [domainSaving, setDomainSaving] = useState(false)

  // Participant invite code (MAJOR events only)
  const [inviteRevealed, setInviteRevealed] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [inviteRegenConfirm, setInviteRegenConfirm] = useState(false)
  const [inviteRegenLoading, setInviteRegenLoading] = useState(false)
  const [inviteRegenError, setInviteRegenError] = useState('')

  const isMajor = event.event_type === 'MAJOR'

  const maskedKey = event.registration_key
    ? event.registration_key.replace(/[A-Z0-9]/g, '•')
    : '—'
  const displayKey = revealed ? (event.registration_key || '—') : maskedKey

  const maskedInvite = event.major_event_invite_code
    ? event.major_event_invite_code.replace(/[A-Z0-9]/g, '•')
    : '—'
  const displayInvite = inviteRevealed ? (event.major_event_invite_code || '—') : maskedInvite

  function copy() {
    if (!event.registration_key) return
    navigator.clipboard.writeText(event.registration_key).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function copyInvite() {
    if (!event.major_event_invite_code) return
    navigator.clipboard.writeText(event.major_event_invite_code).catch(() => {})
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2000)
  }

  async function regen() {
    setRegenLoading(true)
    setRegenError('')
    try {
      await client.post(`/events/${event.id}/regenerate-key`)
      setRegenConfirm(false)
      setRevealed(false)
      onRefresh()
    } catch (err) {
      const d = err.response?.data?.detail || ''
      if (d === 'KEY_REGEN_LIMIT_REACHED') {
        setRegenError('Regeneration limit reached (max 5 per event).')
      } else {
        setRegenError(d || 'Failed to regenerate key.')
      }
    } finally {
      setRegenLoading(false)
    }
  }

  async function regenInvite() {
    setInviteRegenLoading(true)
    setInviteRegenError('')
    try {
      await client.post(`/events/${event.id}/regenerate-major-invite`)
      setInviteRegenConfirm(false)
      setInviteRevealed(false)
      onRefresh()
    } catch (err) {
      setInviteRegenError(err.response?.data?.detail || 'Failed to regenerate invite code.')
    } finally {
      setInviteRegenLoading(false)
    }
  }

  async function saveDomain() {
    setDomainSaving(true)
    try {
      await client.patch(`/events/${event.id}`, {
        email_domain_restriction: domain.trim() || null,
      })
      onRefresh()
    } catch { /* ignore */ }
    finally { setDomainSaving(false) }
  }

  return (
    <div className="mt-5 border-t border-ghost/20 pt-4 space-y-3">
      <p className="font-mono text-[10px] text-ghost tracking-widest">REGISTRATION KEY</p>

      {event.status === 'UPCOMING' && (
        <p className="font-mono text-[10px] text-flare/80 bg-flare/5 border border-flare/20 rounded-sm px-2 py-1.5">
          ⚠ This key will not work until the event is activated via [ COMMENCE HACKING ]
        </p>
      )}

      {/* Key display row */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm tracking-[0.2em] text-bone bg-void border border-ghost/20 rounded-sm px-3 py-1.5 flex-1 min-w-0 truncate">
          {displayKey}
        </span>
        <button
          onClick={() => setRevealed(v => !v)}
          title={revealed ? 'Hide key' : 'Show key'}
          className="font-mono text-xs border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 px-2.5 py-1.5 rounded-sm transition-colors"
        >
          {revealed ? '[ ◉ ]' : '[ ○ ]'}
        </button>
        <button
          onClick={copy}
          className="font-mono text-xs border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 px-2.5 py-1.5 rounded-sm transition-colors whitespace-nowrap"
        >
          {copied ? '[ COPIED ✓ ]' : '[ COPY ]'}
        </button>
      </div>

      {/* Regenerate */}
      {!regenConfirm ? (
        <button
          onClick={() => setRegenConfirm(true)}
          className="font-mono text-xs text-ghost/60 hover:text-ghost transition-colors"
        >
          [ REGENERATE KEY ]
        </button>
      ) : (
        <div className="border border-danger/30 bg-danger/5 rounded-sm p-3 space-y-2">
          <p className="font-mono text-xs text-ghost">
            Regenerating invalidates the current key immediately.
            Already registered participants are not affected.
          </p>
          {regenError && <p className="font-mono text-xs text-danger">{regenError}</p>}
          <div className="flex gap-2">
            <button
              onClick={regen}
              disabled={regenLoading}
              className="font-mono text-xs px-3 py-1 bg-danger text-void hover:opacity-90 transition-opacity disabled:opacity-50 rounded-sm"
            >
              {regenLoading ? 'REGENERATING...' : '[ CONFIRM ]'}
            </button>
            <button
              onClick={() => { setRegenConfirm(false); setRegenError('') }}
              className="font-mono text-xs px-3 py-1 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm"
            >
              [ ABORT ]
            </button>
          </div>
        </div>
      )}

      {/* Email domain restriction */}
      <div>
        <p className="font-mono text-[10px] text-ghost tracking-widest mb-1.5">
          EMAIL RESTRICTION <span className="text-ghost/40">(optional)</span>
        </p>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-void border border-ghost/30 rounded-sm px-3 py-1.5 font-mono text-xs text-bone focus:border-ember focus:outline-none placeholder-ghost/30"
            placeholder="school.edu.ph"
            value={domain}
            onChange={e => setDomain(e.target.value)}
          />
          <button
            onClick={saveDomain}
            disabled={domainSaving}
            className="font-mono text-xs border border-ghost/40 text-ghost hover:text-bone hover:border-ghost/60 px-3 py-1.5 rounded-sm transition-colors disabled:opacity-50"
          >
            {domainSaving ? 'SAVING...' : '[ SAVE ]'}
          </button>
        </div>
        <p className="font-mono text-[10px] text-ghost/50 mt-1">
          Only emails ending in this domain can register. Leave empty for no restriction.
        </p>
      </div>

      {/* Participant invite code — MAJOR events only */}
      {isMajor && (
        <div className="border-t border-ghost/20 pt-3 space-y-2">
          <div>
            <p className="font-mono text-[10px] text-ghost tracking-widest">PARTICIPANT INVITE CODE</p>
            <p className="font-mono text-[10px] text-ghost/50 mt-0.5">
              Share with other org Admins to let them join as participants (no contractor lending).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-sm tracking-[0.2em] text-flare bg-void border border-ghost/20 rounded-sm px-3 py-1.5 flex-1 min-w-0 truncate">
              {displayInvite}
            </span>
            <button
              onClick={() => setInviteRevealed(v => !v)}
              title={inviteRevealed ? 'Hide code' : 'Show code'}
              className="font-mono text-xs border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 px-2.5 py-1.5 rounded-sm transition-colors"
            >
              {inviteRevealed ? '[ ◉ ]' : '[ ○ ]'}
            </button>
            <button
              onClick={copyInvite}
              className="font-mono text-xs border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 px-2.5 py-1.5 rounded-sm transition-colors whitespace-nowrap"
            >
              {inviteCopied ? '[ COPIED ✓ ]' : '[ COPY ]'}
            </button>
          </div>

          {!inviteRegenConfirm ? (
            <button
              onClick={() => setInviteRegenConfirm(true)}
              className="font-mono text-xs text-ghost/60 hover:text-ghost transition-colors"
            >
              [ REGENERATE INVITE CODE ]
            </button>
          ) : (
            <div className="border border-danger/30 bg-danger/5 rounded-sm p-3 space-y-2">
              <p className="font-mono text-xs text-ghost">
                Regenerating invalidates the current invite code. Organizations that haven't joined yet will need the new code.
              </p>
              {inviteRegenError && <p className="font-mono text-xs text-danger">{inviteRegenError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={regenInvite}
                  disabled={inviteRegenLoading}
                  className="font-mono text-xs px-3 py-1 bg-danger text-void hover:opacity-90 transition-opacity disabled:opacity-50 rounded-sm"
                >
                  {inviteRegenLoading ? 'REGENERATING...' : '[ CONFIRM ]'}
                </button>
                <button
                  onClick={() => { setInviteRegenConfirm(false); setInviteRegenError('') }}
                  className="font-mono text-xs px-3 py-1 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm"
                >
                  [ ABORT ]
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Participants Panel ─────────────────────────────────────────────────────────

function ParticipantsPanel({ event }) {
  const [participants, setParticipants] = useState([])
  const [filter, setFilter] = useState('ACTIVE')
  const [loading, setLoading] = useState(true)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [removeReason, setRemoveReason] = useState('')
  const [removeLoading, setRemoveLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await client.get(`/events/${event.id}/registrations`, { params: { status: filter, limit: 200 } })
      setParticipants(r.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filter, event.id])

  async function handleRemove() {
    if (!removeTarget || removeReason.length < 10) return
    setRemoveLoading(true)
    try {
      await client.delete(`/events/${event.id}/registrations/${removeTarget.user_id}`, {
        data: { reason: removeReason }
      })
      setRemoveTarget(null)
      setRemoveReason('')
      load()
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to remove participant')
    } finally {
      setRemoveLoading(false)
    }
  }

  async function handleAdd(userId) {
    try {
      await client.post(`/events/${event.id}/registrations`, { user_id: userId })
      setAddOpen(false)
      load()
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to add participant')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-0">
          {['ACTIVE', 'REMOVED'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`font-mono text-[10px] px-3 py-1 border-b-2 transition-colors ${
                filter === f ? 'border-ember text-ember' : 'border-transparent text-ghost hover:text-bone'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {filter === 'ACTIVE' && (
          <button
            onClick={() => setAddOpen(true)}
            className="font-mono text-xs border border-ember/50 text-ember hover:bg-ember/10 px-3 py-1 rounded-sm transition-colors"
          >
            [ + ADD ]
          </button>
        )}
      </div>

      {loading ? (
        <p className="font-mono text-xs text-ghost animate-pulse">Loading...</p>
      ) : participants.length === 0 ? (
        <p className="font-mono text-xs text-ghost/40">No {filter.toLowerCase()} participants.</p>
      ) : (
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {participants.map((p, i) => (
            <div key={p.user_id} className="flex items-center gap-3 py-1.5 border-b border-ghost/10">
              <span className="font-mono text-xs text-ghost/50 w-6 shrink-0">{i + 1}</span>
              <span className="font-mono text-xs text-bone flex-1 min-w-0 truncate">{p.callsign}</span>
              <span className="font-mono text-xs text-ghost shrink-0">
                {p.registered_by === 'ADMIN' ? 'admin' : fmt(p.registered_at)?.split(' at')[0]}
              </span>
              <span className="font-mono text-xs text-ember shrink-0 w-16 text-right">{p.bc_earned} BC</span>
              {filter === 'ACTIVE' && (
                <button
                  onClick={() => { setRemoveTarget(p); setRemoveReason('') }}
                  className="font-mono text-xs text-ghost/50 hover:text-danger transition-colors shrink-0"
                >
                  [ × ]
                </button>
              )}
              {filter === 'REMOVED' && (
                <span className="font-mono text-[10px] text-ghost/40 shrink-0 max-w-[120px] truncate" title={p.removal_reason}>
                  {p.removal_reason}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Remove confirm */}
      {removeTarget && (
        <div className="border border-danger/40 bg-danger/5 rounded-sm p-3 space-y-2">
          <p className="font-mono text-xs text-bone">
            Remove <span className="text-danger">{removeTarget.callsign}</span>?
          </p>
          <p className="font-mono text-[10px] text-ghost">
            This will wipe their BC, remove them from rankings and their team.
          </p>
          <textarea
            className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:border-danger focus:outline-none resize-none"
            placeholder="Reason (min 10 characters)"
            rows={2}
            value={removeReason}
            onChange={e => setRemoveReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={handleRemove}
              disabled={removeReason.length < 10 || removeLoading}
              className="font-mono text-xs px-3 py-1 bg-danger text-void hover:opacity-90 transition-opacity disabled:opacity-40 rounded-sm"
            >
              {removeLoading ? 'REMOVING...' : '[ CONFIRM REMOVE ]'}
            </button>
            <button
              onClick={() => setRemoveTarget(null)}
              className="font-mono text-xs px-3 py-1 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm"
            >
              [ ABORT ]
            </button>
          </div>
        </div>
      )}

      {/* Add participant modal */}
      {addOpen && <AddParticipantModal onClose={() => setAddOpen(false)} onAdd={handleAdd} event={event} />}
    </div>
  )
}

function AddParticipantModal({ onClose, onAdd, event }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!search.trim()) { setResults([]); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await client.get('/admin/users', { params: { role: 'OPERATIVE', limit: 20 } })
        const q = search.toLowerCase()
        setResults(
          r.data.filter(u =>
            (u.username?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)) &&
            u.is_verified
          ).slice(0, 10)
        )
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(8,8,16,0.9)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm border border-ghost/30 rounded-sm" style={{ background: '#12121A' }}>
        <div className="border-b border-ghost/10 px-4 py-3 flex items-center justify-between">
          <p className="font-mono text-[10px] text-ghost tracking-widest">ADD PARTICIPANT</p>
          <button onClick={onClose} className="font-mono text-ghost hover:text-danger text-xs">[ × ]</button>
        </div>
        <div className="p-4 space-y-3">
          <input
            autoFocus
            className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:border-ember focus:outline-none placeholder-ghost/30"
            placeholder="Search callsign or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {searching && <p className="font-mono text-xs text-ghost animate-pulse">Searching...</p>}
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {results.map(u => (
              <button
                key={u.id}
                onClick={() => onAdd(u.id)}
                className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 border border-ghost/20 hover:border-ember/50 rounded-sm transition-colors"
              >
                <div>
                  <p className="font-mono text-xs text-bone">{u.username}</p>
                  <p className="font-mono text-[10px] text-ghost">{u.email}</p>
                </div>
                <span className="font-mono text-[10px] text-ember">[ ADD ]</span>
              </button>
            ))}
            {!searching && search && results.length === 0 && (
              <p className="font-mono text-xs text-ghost/40">No matching Operatives found.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Create Event Modal ────────────────────────────────────────────────────────

function CreateEventModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', description: '', start_time: '', end_time: '', registration_open: true,
  })
  const [decay, setDecay] = useState({ enabled: false, mode: 'TIME_BASED', ...DECAY_TIER_DEFAULTS })
  const [allowedCategories, setAllowedCategories] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setForm({ name: '', description: '', start_time: '', end_time: '', registration_open: true })
    setDecay({ enabled: false, mode: 'TIME_BASED', ...DECAY_TIER_DEFAULTS })
    setAllowedCategories([])
    setError('')
  }

  async function submit(e) {
    e.preventDefault()
    if (decay.enabled && decay.mode === 'TIME_BASED' && validateDecayTiers(decay).length > 0) {
      setError('Fix decay tier errors before saving.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        start_time: form.start_time ? new Date(form.start_time).toISOString() : null,
        end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
        registration_open: form.registration_open,
        allowed_categories: allowedCategories.length > 0 ? allowedCategories : null,
        ...(decay.enabled ? decayPayload(decay) : {}),
      }
      await client.post('/events', payload)
      reset()
      onCreated()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create event')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} title="CREATE NEW EVENT" className="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">
            Event Name <span className="text-danger">*</span>
          </label>
          <input
            className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:border-ember focus:outline-none placeholder-ghost/40"
            placeholder="e.g. CCS Week CTF 2026"
            maxLength={100}
            required
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">
            Description <span className="text-ghost/50">(optional)</span>
          </label>
          <textarea
            className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:border-ember focus:outline-none placeholder-ghost/40 resize-none"
            placeholder="Brief description shown to Operatives"
            maxLength={300}
            rows={3}
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">Start Time</label>
            <input
              type="datetime-local"
              className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:border-ember focus:outline-none"
              value={form.start_time}
              onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
            />
            <p className="font-mono text-xs text-ghost/60 mt-1">Leave empty to start manually</p>
          </div>
          <div>
            <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">End Time</label>
            <input
              type="datetime-local"
              className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:border-ember focus:outline-none"
              value={form.end_time}
              onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
            />
            <p className="font-mono text-xs text-ghost/60 mt-1">Leave empty to close manually</p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs text-ghost uppercase tracking-widest">Registration</p>
            <p className="font-mono text-xs text-ghost/60 mt-0.5">Controls whether Operatives can register</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`font-mono text-xs ${form.registration_open ? 'text-[#00FF88]' : 'text-ghost'}`}>
              {form.registration_open ? 'OPEN' : 'CLOSED'}
            </span>
            <Toggle value={form.registration_open} onChange={v => setForm(f => ({ ...f, registration_open: v }))} />
          </div>
        </div>
        <DecayOverrideForm decay={decay} onChange={setDecay} />
        <CategoryPicker selected={allowedCategories} onChange={setAllowedCategories} />
        {error && <p className="font-mono text-xs text-danger">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={loading || !form.name.trim()}
            className="font-mono text-xs px-4 py-2 bg-ember text-void hover:bg-flare transition-colors disabled:opacity-50 rounded-sm flex-1"
          >
            {loading ? 'CREATING...' : '[ CREATE EVENT ]'}
          </button>
          <button
            type="button"
            onClick={() => { reset(); onClose() }}
            className="font-mono text-xs px-4 py-2 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm"
          >
            [ CANCEL ]
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Create Event Type Picker Modal ────────────────────────────────────────────

function CreateEventTypePicker({ open, onClose, onPickLocal, onPickPartnership }) {
  return (
    <Modal open={open} onClose={onClose} title="CREATE EVENT" className="max-w-sm">
      <p className="font-mono text-xs text-ghost mb-5">
        Select the type of event you want to host.
      </p>
      <div className="space-y-3">
        {/* LOCAL */}
        <button
          type="button"
          onClick={onPickLocal}
          className="w-full text-left border border-ghost/30 hover:border-ember/60 bg-void hover:bg-ember/5 rounded-sm p-4 transition-all group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-xs font-bold text-bone tracking-widest group-hover:text-ember transition-colors">
              LOCAL EVENT
            </span>
            <span className="font-mono text-[10px] border border-ghost/30 text-ghost px-2 py-0.5 rounded-sm">LOCAL</span>
          </div>
          <p className="font-mono text-[10px] text-ghost/70 leading-relaxed">
            A self-contained competition run by your organization. You create and manage all challenges, and your operatives compete internally.
          </p>
        </button>

        {/* PARTNERSHIP */}
        <button
          type="button"
          onClick={onPickPartnership}
          className="w-full text-left border border-ghost/30 hover:border-flare/60 bg-void hover:bg-flare/5 rounded-sm p-4 transition-all group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-xs font-bold text-bone tracking-widest group-hover:text-flare transition-colors">
              PARTNERSHIP EVENT
            </span>
            <span className="font-mono text-[10px] border border-ember/40 text-ember px-2 py-0.5 rounded-sm">MAJOR</span>
          </div>
          <p className="font-mono text-[10px] text-ghost/70 leading-relaxed">
            A cross-organization competition. Partner orgs can contribute contractors to create challenges. A shareable invite code lets other orgs join as participants.
          </p>
        </button>
      </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={onClose}
          className="w-full font-mono text-xs px-4 py-2 border border-ghost/30 text-ghost hover:text-bone transition-colors rounded-sm"
        >
          [ CANCEL ]
        </button>
      </div>
    </Modal>
  )
}

// ── Create Major Event Modal ──────────────────────────────────────────────────

function CreateMajorEventModal({ open, onClose, onCreated, userRole }) {
  const isArchitect = userRole === 'ARCHITECT'
  const [allOrgs, setAllOrgs] = useState([])
  const [form, setForm] = useState({
    name: '', description: '', start_time: '', end_time: '', host_org_id: '',
  })
  const [selectedPartners, setSelectedPartners] = useState([]) // array of org ids
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [createdEvent, setCreatedEvent] = useState(null) // { name, invite_code, id }

  useEffect(() => {
    if (!open) return
    // Fetch active orgs for partner picker (public endpoint, no auth needed)
    client.get('/public/organizations').then(r => setAllOrgs(r.data)).catch(() => {})
  }, [open])

  function reset() {
    setForm({ name: '', description: '', start_time: '', end_time: '', host_org_id: '' })
    setSelectedPartners([])
    setError('')
    setCreatedEvent(null)
  }

  function togglePartner(orgId) {
    setSelectedPartners(prev =>
      prev.includes(orgId) ? prev.filter(id => id !== orgId) : [...prev, orgId]
    )
  }

  // Orgs available for partner selection (exclude host)
  const hostOrgId = isArchitect ? parseInt(form.host_org_id) : null
  const partnerCandidates = allOrgs.filter(o => o.id !== hostOrgId)

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Event name is required.'); return }
    if (isArchitect && !form.host_org_id) { setError('Select a host organization.'); return }
    setError('')
    setLoading(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        start_time: form.start_time ? new Date(form.start_time).toISOString() : null,
        end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
      }
      if (isArchitect && form.host_org_id) payload.host_org_id = parseInt(form.host_org_id)
      const r = await client.post('/events/major', payload)
      const eventId = r.data.id

      // Add selected partner orgs directly
      if (selectedPartners.length > 0) {
        await Promise.allSettled(
          selectedPartners.map(orgId =>
            client.post(`/events/${eventId}/add-partner`, { org_id: orgId })
          )
        )
      }

      setCreatedEvent({
        id: eventId,
        name: r.data.name,
        invite_code: r.data.major_event_invite_code,
        partner_count: selectedPartners.length,
      })
      onCreated()
    } catch (err) {
      const d = err.response?.data?.detail || ''
      if (d.includes('already hosting')) {
        setError('Your organization is already hosting an active Major Event.')
      } else {
        setError(d || 'Failed to create Major Event.')
      }
    } finally {
      setLoading(false)
    }
  }

  function handleDone() { reset(); onClose() }

  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} title="HOST A MAJOR EVENT" className="max-w-lg">
      {!createdEvent ? (
        <>
          <p className="font-mono text-xs text-ghost mb-5">
            A partnership competition across multiple organizations.
          </p>
          <form onSubmit={submit} className="space-y-4">
            {isArchitect && (
              <div>
                <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">
                  Host Organization <span className="text-danger">*</span>
                </label>
                <select
                  className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:border-ember focus:outline-none"
                  value={form.host_org_id}
                  onChange={e => { setForm(f => ({ ...f, host_org_id: e.target.value })); setSelectedPartners([]) }}
                  required
                >
                  <option value="">— Select organization —</option>
                  {allOrgs.map(o => (
                    <option key={o.id} value={o.id}>{o.name} ({o.org_code})</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">
                Event Name <span className="text-danger">*</span>
              </label>
              <input
                className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:border-ember focus:outline-none placeholder-ghost/40"
                placeholder='e.g. "Regional CTF Championship 2026"'
                maxLength={100}
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">
                Description <span className="text-ghost/50">(optional)</span>
              </label>
              <textarea
                className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:border-ember focus:outline-none placeholder-ghost/40 resize-none"
                maxLength={300}
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">Start Time</label>
                <input
                  type="datetime-local"
                  className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:border-ember focus:outline-none"
                  value={form.start_time}
                  onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
                />
                <p className="font-mono text-xs text-ghost/60 mt-1">Leave empty to start manually</p>
              </div>
              <div>
                <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">End Time</label>
                <input
                  type="datetime-local"
                  className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:border-ember focus:outline-none"
                  value={form.end_time}
                  onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
                />
              </div>
            </div>

            {/* Partner org picker */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <label className="font-mono text-xs text-ghost uppercase tracking-widest">
                    Partner Organizations
                  </label>
                  <p className="font-mono text-[10px] text-ghost/50 mt-0.5">
                    Partners can lend contractors to create challenges. {selectedPartners.length > 0 && `${selectedPartners.length} selected.`}
                  </p>
                </div>
                {selectedPartners.length > 0 && (
                  <button type="button" onClick={() => setSelectedPartners([])}
                    className="font-mono text-[10px] text-ghost/50 hover:text-ghost transition-colors">
                    CLEAR
                  </button>
                )}
              </div>
              {partnerCandidates.length === 0 ? (
                <p className="font-mono text-[10px] text-ghost/40 border border-ghost/20 rounded-sm px-3 py-2">
                  {isArchitect && !form.host_org_id ? 'Select a host org first.' : 'No other active organizations available.'}
                </p>
              ) : (
                <div className="border border-ghost/20 rounded-sm divide-y divide-ghost/10 max-h-40 overflow-y-auto">
                  {partnerCandidates.map(org => {
                    const selected = selectedPartners.includes(org.id)
                    return (
                      <button
                        key={org.id}
                        type="button"
                        onClick={() => togglePartner(org.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
                          selected ? 'bg-ember/10' : 'hover:bg-white/5'
                        }`}
                      >
                        <div>
                          <span className="font-mono text-xs text-bone">{org.name}</span>
                          <span className="font-mono text-[10px] text-ghost ml-2">({org.org_code})</span>
                        </div>
                        <span className={`font-mono text-[10px] transition-colors ${selected ? 'text-ember' : 'text-ghost/30'}`}>
                          {selected ? '✓ PARTNER' : '+ ADD'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="border border-ghost/20 bg-void/50 rounded-sm p-3 space-y-1">
              <p className="font-mono text-[10px] text-ghost/70">
                An invite code will also be generated so <span className="text-bone">other orgs</span> can join as <span className="text-bone">participants</span> (scoreboard access only, no contractor lending).
              </p>
            </div>
            {error && <p className="font-mono text-xs text-danger">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={loading || !form.name.trim() || (isArchitect && !form.host_org_id)}
                className="font-mono text-xs px-4 py-2 bg-ember text-void hover:bg-flare transition-colors disabled:opacity-50 rounded-sm flex-1"
              >
                {loading ? 'CREATING...' : '[ HOST MAJOR EVENT ]'}
              </button>
              <button
                type="button"
                onClick={() => { reset(); onClose() }}
                className="font-mono text-xs px-4 py-2 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm"
              >
                [ CANCEL ]
              </button>
            </div>
          </form>
        </>
      ) : (
        <MajorEventCreatedScreen event={createdEvent} onDone={handleDone} />
      )}
    </Modal>
  )
}

function MajorEventCreatedScreen({ event, onDone }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    if (!event.invite_code) return
    navigator.clipboard.writeText(event.invite_code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="border border-[#00FF88]/30 bg-[#00FF88]/5 rounded-sm p-4 space-y-1">
        <p className="font-mono text-xs text-[#00FF88] tracking-widest">MAJOR EVENT CREATED</p>
        <p className="font-mono font-bold text-bone text-sm">{event.name}</p>
        {event.partner_count > 0 && (
          <p className="font-mono text-[10px] text-ghost">{event.partner_count} partner org{event.partner_count > 1 ? 's' : ''} added.</p>
        )}
      </div>

      <div>
        <p className="font-mono text-[10px] text-ghost tracking-widest mb-2">INVITE CODE</p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg tracking-[0.3em] text-ember bg-void border border-ghost/20 rounded-sm px-4 py-2 flex-1 text-center">
            {event.invite_code || '—'}
          </span>
          <button
            onClick={copy}
            className="font-mono text-xs border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 px-3 py-2 rounded-sm transition-colors whitespace-nowrap"
          >
            {copied ? '[ COPIED ✓ ]' : '[ COPY ]'}
          </button>
        </div>
        <p className="font-mono text-[10px] text-ghost/60 mt-2">
          Share this code with other org Admins to let them join as <span className="text-ghost">participants</span> (scoreboard access, no contractor lending).
        </p>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onDone}
          className="font-mono text-xs px-4 py-2 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm flex-1"
        >
          [ DONE ]
        </button>
      </div>
    </div>
  )
}

// ── Join Major Event Section ──────────────────────────────────────────────────

function JoinMajorEventSection({ onJoined }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleJoin(e) {
    e.preventDefault()
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      await client.post('/events/major-join', { invite_code: trimmed })
      setSuccess('Successfully joined the Major Event.')
      setCode('')
      onJoined()
    } catch (err) {
      const d = err.response?.data?.detail || ''
      if (d === 'INVALID_CODE') setError('Invalid invite code. Check the code and try again.')
      else if (d === 'ALREADY_PARTNER') setError('Your organization is already participating in this event.')
      else if (d === 'RATE_LIMITED') setError('Too many attempts. Please wait before trying again.')
      else setError(d || 'Failed to join event.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-6 border border-ghost/20 bg-abyss rounded-sm p-5">
      <p className="font-mono text-xs text-ghost/60 uppercase tracking-widest mb-1">JOIN A MAJOR EVENT</p>
      <p className="font-mono text-xs text-ghost/50 mb-4">
        Have an invite code from a host organization? Enter it below.
      </p>
      <form onSubmit={handleJoin} className="flex gap-2">
        <input
          className="flex-1 bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:border-ember focus:outline-none placeholder-ghost/30 tracking-widest"
          placeholder="MJ-XXXX-XXXX"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          maxLength={12}
        />
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="font-mono text-xs px-4 py-2 border border-ember/60 text-ember hover:bg-ember/10 transition-colors rounded-sm disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? 'JOINING...' : '[ JOIN AS PARTNER ]'}
        </button>
      </form>
      {error && <p className="font-mono text-xs text-danger mt-2">{error}</p>}
      {success && <p className="font-mono text-xs text-[#00FF88] mt-2">{success}</p>}
    </div>
  )
}

// ── Partner Major Event Card ──────────────────────────────────────────────────

function PartnerMajorEventCard({ event, onManageParticipants, onViewBoard, onLendContractor }) {
  const countdown = useCountdown(event.status === 'ACTIVE' ? event.end_time : null)
  const statusColor = {
    ACTIVE: '#00FF88',
    UPCOMING: '#FF6B00',
    CLOSED: 'rgba(107,107,128,0.6)',
  }[event.status] || 'rgba(107,107,128,0.6)'

  return (
    <div className="border bg-abyss rounded-sm p-5" style={{ borderColor: statusColor + '60' }}>
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="font-mono text-xs border px-2 py-0.5 rounded-sm" style={{ borderColor: statusColor, color: statusColor }}>
              {event.status}
              {event.status === 'ACTIVE' && (
                <span className="w-1.5 h-1.5 rounded-full inline-block ml-1.5 animate-pulse" style={{ background: statusColor }} />
              )}
            </span>
            <MajorBadge />
            <span className="font-mono font-bold text-bone text-base truncate">{event.name}</span>
          </div>
          <div className="font-mono text-xs text-ghost space-y-1">
            {event.host_org_name && (
              <p>Hosted by: <span className="text-bone">{event.host_org_name}</span></p>
            )}
            <p>Participating as: <span className="text-ember">PARTNER</span></p>
            {event.status === 'ACTIVE' && event.end_time && (
              <p>Ends in: <span className="font-bold" style={{ color: statusColor }}>{countdown || '—'}</span></p>
            )}
            {event.status === 'UPCOMING' && event.start_time && (
              <p>Starts: {fmt(event.start_time)}</p>
            )}
            {event.participant_count != null && event.participant_count > 0 && (
              <p>Total participants: {event.participant_count}</p>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <button
          onClick={onManageParticipants}
          className="font-mono text-xs px-3 py-1.5 border border-ember/40 text-ember hover:bg-ember/10 transition-colors rounded-sm"
        >
          [ MANAGE MY PARTICIPANTS ]
        </button>
        <button
          onClick={onViewBoard}
          className="font-mono text-xs px-3 py-1.5 border border-ghost/40 text-ghost hover:text-bone hover:border-bone/40 transition-colors rounded-sm"
        >
          [ VIEW BOUNTY BOARD ]
        </button>
        <button
          onClick={onLendContractor}
          className="font-mono text-xs px-3 py-1.5 border border-ghost/40 text-ghost hover:text-bone hover:border-bone/40 transition-colors rounded-sm"
        >
          [ LEND A CONTRACTOR ]
        </button>
      </div>
      {/* Partner registration key section */}
      {event.registration_key && (
        <PartnerKeySection regKey={event.registration_key} />
      )}
    </div>
  )
}

function PartnerKeySection({ regKey }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const masked = regKey.replace(/[A-Z0-9]/g, '•')

  function copy() {
    navigator.clipboard.writeText(regKey).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mt-4 border-t border-ghost/20 pt-4">
      <p className="font-mono text-[10px] text-ghost tracking-widest mb-2">YOUR PARTNER REGISTRATION KEY</p>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm tracking-[0.2em] text-bone bg-void border border-ghost/20 rounded-sm px-3 py-1.5 flex-1 min-w-0 truncate">
          {revealed ? regKey : masked}
        </span>
        <button onClick={() => setRevealed(v => !v)}
          className="font-mono text-xs border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 px-2.5 py-1.5 rounded-sm transition-colors">
          {revealed ? '[ ◉ ]' : '[ ○ ]'}
        </button>
        <button onClick={copy}
          className="font-mono text-xs border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 px-2.5 py-1.5 rounded-sm transition-colors whitespace-nowrap">
          {copied ? '[ COPIED ✓ ]' : '[ COPY ]'}
        </button>
      </div>
      <p className="font-mono text-[10px] text-ghost/50 mt-1">
        Share this key only with your org's Operatives to register them for this event.
      </p>
    </div>
  )
}

// ── Lend Contractor Modal ─────────────────────────────────────────────────────

function LendContractorModal({ open, onClose, event }) {
  const [contractors, setContractors] = useState([])
  const [loading, setLoading] = useState(true)
  const [lending, setLending] = useState(null)
  const [lentIds, setLentIds] = useState(new Set())

  useEffect(() => {
    if (!open || !event) return
    setLoading(true)
    // Get own org's contractors from the event's major details
    client.get(`/events/${event.id}/major`).then(r => {
      const borrowed = r.data.borrowed_contractors || []
      const borrowedIds = new Set(borrowed.map(c => c.contractor_id))
      setLentIds(borrowedIds)
    }).catch(() => {})

    client.get('/admin/users', { params: { role: 'CONTRACTOR', limit: 100 } })
      .then(r => setContractors(r.data.filter(u => u.is_verified)))
      .catch(() => setContractors([]))
      .finally(() => setLoading(false))
  }, [open, event])

  async function lend(contractorId) {
    setLending(contractorId)
    try {
      await client.post(`/events/${event.id}/contractors`, { contractor_id: contractorId })
      setLentIds(s => new Set([...s, String(contractorId)]))
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to lend contractor')
    } finally {
      setLending(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="LEND A CONTRACTOR" className="max-w-sm">
      <p className="font-mono text-xs text-ghost mb-4">
        Select a Contractor from your organization to lend to <span className="text-bone">{event?.name}</span>.
      </p>
      {loading ? (
        <p className="font-mono text-xs text-ghost animate-pulse">Loading...</p>
      ) : contractors.length === 0 ? (
        <p className="font-mono text-xs text-ghost/40">No Contractors in your organization.</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {contractors.map(c => {
            const alreadyLent = lentIds.has(String(c.id))
            return (
              <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 border border-ghost/20 rounded-sm">
                <div>
                  <p className="font-mono text-xs text-bone">{c.username}</p>
                  <p className="font-mono text-[10px] text-ghost">{c.email}</p>
                </div>
                {alreadyLent ? (
                  <span className="font-mono text-[10px] text-[#00FF88]">LENT</span>
                ) : (
                  <button
                    onClick={() => lend(c.id)}
                    disabled={lending === c.id}
                    className="font-mono text-xs border border-ember/50 text-ember hover:bg-ember/10 px-2 py-1 rounded-sm transition-colors disabled:opacity-50"
                  >
                    {lending === c.id ? '...' : '[ LEND ]'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      <button onClick={onClose} className="mt-4 font-mono text-xs px-4 py-2 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm w-full">
        [ CLOSE ]
      </button>
    </Modal>
  )
}

// ── Manage Event Modal ────────────────────────────────────────────────────────

function MajorSummaryPanel({ event }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!event?.id) return
    client.get(`/events/${event.id}/major-summary`)
      .then(r => setSummary(r.data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false))
  }, [event?.id])

  if (loading) return <p className="font-mono text-xs text-ghost animate-pulse">Loading...</p>
  if (!summary) return <p className="font-mono text-xs text-ghost/40">Summary unavailable.</p>

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-ghost/20 bg-void rounded-sm px-4 py-3">
          <div className="font-mono font-bold text-2xl text-ember">{summary.total_participants}</div>
          <div className="font-mono text-[10px] text-ghost tracking-widest mt-1">TOTAL PARTICIPANTS</div>
        </div>
        <div className="border border-ghost/20 bg-void rounded-sm px-4 py-3">
          <div className="font-mono font-bold text-2xl text-bone">{summary.own_count}</div>
          <div className="font-mono text-[10px] text-ghost tracking-widest mt-1">YOUR OPERATIVES</div>
        </div>
      </div>

      {/* Partner org counts — host only */}
      {summary.is_host && summary.partner_counts.length > 0 && (
        <div className="border border-ghost/20 rounded-sm">
          <div className="px-4 py-2 border-b border-ghost/10 bg-abyss">
            <span className="font-mono text-[10px] text-ghost tracking-widest">PARTNER PARTICIPANTS</span>
          </div>
          <div className="divide-y divide-ghost/10">
            {summary.partner_counts.map(p => (
              <div key={p.org_id} className="flex items-center justify-between px-4 py-2">
                <span className="font-mono text-xs text-bone">{p.org_name}</span>
                <span className="font-mono text-xs text-ember">{p.count} operatives</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ManageEventModal({ open, onClose, event, onSaved }) {
  const isMajor = event?.event_type === 'MAJOR'
  const [tab, setTab] = useState(isMajor ? 'overview' : 'details')
  const [form, setForm] = useState({ name: '', description: '', start_time: '', end_time: '', registration_open: true })
  const [decay, setDecay] = useState({ enabled: false, mode: 'TIME_BASED', ...DECAY_TIER_DEFAULTS })
  const [allowedCategories, setAllowedCategories] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Reset tab when event changes
  useEffect(() => {
    setTab(event?.event_type === 'MAJOR' ? 'overview' : 'details')
  }, [event?.id])

  useEffect(() => {
    if (!event) return
    setForm({
      name: event.name || '',
      description: event.description || '',
      start_time: event.start_time ? toLocalInput(event.start_time) : '',
      end_time: event.end_time ? toLocalInput(event.end_time) : '',
      registration_open: event.registration_open ?? true,
    })
    // Load existing decay override if present
    if (event.decay_mode_override) {
      setDecay({
        enabled: true,
        mode: event.decay_mode_override,
        h1: String(event.decay_tier_1_hours_override ?? DECAY_TIER_DEFAULTS.h1),
        p1: String(event.decay_tier_1_percent_override ?? DECAY_TIER_DEFAULTS.p1),
        h2: String(event.decay_tier_2_hours_override ?? DECAY_TIER_DEFAULTS.h2),
        p2: String(event.decay_tier_2_percent_override ?? DECAY_TIER_DEFAULTS.p2),
        h3: String(event.decay_tier_3_hours_override ?? DECAY_TIER_DEFAULTS.h3),
        p3: String(event.decay_tier_3_percent_override ?? DECAY_TIER_DEFAULTS.p3),
        floor: String(event.decay_floor_percent_override ?? DECAY_TIER_DEFAULTS.floor),
      })
    } else {
      setDecay({ enabled: false, mode: 'TIME_BASED', ...DECAY_TIER_DEFAULTS })
    }
    setAllowedCategories(event.allowed_categories || [])
    setError('')
  }, [event])

  function toLocalInput(iso) {
    const d = new Date(iso)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  async function save(e) {
    e.preventDefault()
    if (decay.enabled && decay.mode === 'TIME_BASED' && validateDecayTiers(decay).length > 0) {
      setError('Fix decay tier errors before saving.')
      return
    }
    setError('')
    setLoading(true)
    try {
      await client.patch(`/events/${event.id}`, {
        name: form.name.trim() || undefined,
        description: form.description.trim() || null,
        start_time: form.start_time ? new Date(form.start_time).toISOString() : null,
        end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
        registration_open: form.registration_open,
        allowed_categories: allowedCategories.length > 0 ? allowedCategories : null,
        clear_allowed_categories: allowedCategories.length === 0,
        ...decayPayload(decay),
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save changes')
    } finally {
      setLoading(false)
    }
  }

  if (!event) return null
  const tabs = isMajor ? ['OVERVIEW', 'DETAILS', 'PARTICIPANTS'] : ['DETAILS', 'PARTICIPANTS']
  return (
    <Modal open={open} onClose={onClose} title={`MANAGE — ${event.name}`} className="max-w-lg">
      {isMajor && (
        <div className="mb-4 px-1">
          <span className="font-mono text-[10px] text-flare border border-flare/30 px-2 py-0.5 rounded-sm tracking-widest">MAJOR EVENT</span>
        </div>
      )}
      {/* Tab bar */}
      <div className="flex gap-0 border-b border-ghost/20 mb-4">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t.toLowerCase())}
            className={`font-mono text-[10px] tracking-widest px-4 py-2 border-b-2 transition-colors ${
              tab === t.toLowerCase() ? 'border-ember text-ember' : 'border-transparent text-ghost hover:text-bone'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && isMajor ? (
        <MajorSummaryPanel event={event} />
      ) : tab === 'participants' ? (
        <ParticipantsPanel event={event} />
      ) : (
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">Event Name</label>
          <input
            className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:border-ember focus:outline-none"
            maxLength={100}
            required
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">Description</label>
          <textarea
            className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:border-ember focus:outline-none resize-none"
            maxLength={300}
            rows={3}
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">Start Time</label>
            <input
              type="datetime-local"
              className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:border-ember focus:outline-none"
              value={form.start_time}
              onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
            />
          </div>
          <div>
            <label className="font-mono text-xs text-ghost uppercase tracking-widest block mb-1">End Time</label>
            <input
              type="datetime-local"
              className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:border-ember focus:outline-none"
              value={form.end_time}
              onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs text-ghost uppercase tracking-widest">Registration</p>
          <div className="flex items-center gap-2">
            <span className={`font-mono text-xs ${form.registration_open ? 'text-[#00FF88]' : 'text-ghost'}`}>
              {form.registration_open ? 'OPEN' : 'CLOSED'}
            </span>
            <Toggle value={form.registration_open} onChange={v => setForm(f => ({ ...f, registration_open: v }))} />
          </div>
        </div>
        <DecayOverrideForm decay={decay} onChange={setDecay} />
        <CategoryPicker selected={allowedCategories} onChange={setAllowedCategories} />
        {error && <p className="font-mono text-xs text-danger">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={loading}
            className="font-mono text-xs px-4 py-2 bg-ember text-void hover:bg-flare transition-colors disabled:opacity-50 rounded-sm flex-1"
          >
            {loading ? 'SAVING...' : '[ SAVE CHANGES ]'}
          </button>
          <button type="button" onClick={onClose}
            className="font-mono text-xs px-4 py-2 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm"
          >
            [ CANCEL ]
          </button>
        </div>
      </form>
      )}
    </Modal>
  )
}

// ── Archive Event Flow ────────────────────────────────────────────────────────

const RESET_LEVELS = [
  {
    key: 'SOFT',
    label: 'SOFT RESET',
    lines: ['Keep contracts published', 'Archive scores only'],
    best: 'same challenges, new group of competitors',
  },
  {
    key: 'MEDIUM',
    label: 'MEDIUM RESET',
    lines: ['Move contracts to draft', 'Archive scores'],
    best: 'new semester, fresh set of challenges',
  },
  {
    key: 'HARD',
    label: 'HARD RESET',
    lines: ['Delete contracts', 'Wipe all competition data'],
    best: 'completely fresh start from scratch',
  },
]

function ArchiveModal({ open, onClose, event, onDone }) {
  const [step, setStep] = useState(1) // 1=export 2=level 3=confirm 4=progress
  const [level, setLevel] = useState(null)
  const [confirmName, setConfirmName] = useState('')
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(false)

  function reset() { setStep(1); setLevel(null); setConfirmName(''); setLines([]); setLoading(false) }
  function handleClose() { if (!loading) { reset(); onClose() } }

  async function runArchive() {
    setStep(4)
    setLoading(true)
    const push = (l) => setLines(prev => [...prev, l])
    push('> Archiving event data...')
    push('> Applying ' + level + ' reset...')
    push('> Dissolving teams...')
    try {
      await client.post(`/events/${event.id}/archive`, { reset_level: level })
      push('> Archive complete.')
      push(`> EVENT ${event.name} archived successfully.`)
    } catch (err) {
      push('> ERROR: ' + (err.response?.data?.detail || 'Archive failed'))
    } finally {
      setLoading(false)
    }
  }

  async function exportResults() {
    try {
      const r = await client.get(`/events/${event.id}/export`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a'); a.href = url
      a.download = `event-${event.id}-export.json`; a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  if (!event) return null
  const nameMatch = confirmName.trim() === event.name.trim()

  return (
    <Modal open={open} onClose={handleClose} title="ARCHIVE EVENT" className="max-w-lg">
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-4">
            <p className="font-mono text-sm text-bone">Export results before archiving?</p>
            <div className="flex gap-2 flex-wrap">
              <button onClick={exportResults}
                className="font-mono text-xs px-3 py-2 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm">
                [ EXPORT JSON ]
              </button>
              <button onClick={() => setStep(2)}
                className="font-mono text-xs px-3 py-2 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm ml-auto">
                [ SKIP ]
              </button>
            </div>
            <button onClick={() => { exportResults(); setStep(2) }}
              className="font-mono text-xs text-ghost/50 hover:text-ghost transition-colors">
              Export then continue →
            </button>
          </motion.div>
        )}
        {step === 2 && (
          <motion.div key="step2" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-3">
            <p className="font-mono text-sm text-bone">Select archive level for <span className="text-ember">{event.name}</span>:</p>
            <div className="space-y-2">
              {RESET_LEVELS.map(rl => (
                <button key={rl.key} onClick={() => setLevel(rl.key)}
                  className={`w-full text-left border rounded-sm p-3 transition-colors font-mono ${
                    level === rl.key
                      ? 'border-ember bg-ember/10 text-bone'
                      : 'border-ghost/30 text-ghost hover:border-ghost/60 hover:text-bone'
                  }`}
                >
                  <p className="text-xs font-bold tracking-widest mb-1">{rl.label}</p>
                  {rl.lines.map(l => <p key={l} className="text-xs">{l}</p>)}
                  <p className="text-xs text-ghost/50 mt-1">Best for: {rl.best}</p>
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setStep(3)} disabled={!level}
                className="font-mono text-xs px-4 py-2 bg-ember text-void hover:bg-flare transition-colors disabled:opacity-50 rounded-sm flex-1">
                CONTINUE →
              </button>
              <button onClick={() => setStep(1)}
                className="font-mono text-xs px-4 py-2 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm">
                ← BACK
              </button>
            </div>
          </motion.div>
        )}
        {step === 3 && (
          <motion.div key="step3" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-4">
            <div className="font-mono text-sm text-bone space-y-1">
              <p>You are about to archive <span className="text-ember">{event.name}</span>.</p>
              <p className="text-xs text-ghost">Reset level: <span className="text-bone">{level}</span></p>
              <div className="text-xs text-ghost mt-2 space-y-0.5">
                <p>This will affect:</p>
                <p>— {event.contract_count ?? '?'} contracts</p>
                <p>— {event.participant_count ?? '?'} participants</p>
                <p>— {event.team_count ?? '?'} teams</p>
              </div>
            </div>
            <div>
              <p className="font-mono text-xs text-ghost mb-1">Type the event name to confirm:</p>
              <input
                className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:border-ember focus:outline-none"
                placeholder={event.name}
                value={confirmName}
                onChange={e => setConfirmName(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button onClick={runArchive} disabled={!nameMatch}
                className="font-mono text-xs px-4 py-2 bg-danger text-void hover:opacity-90 transition-opacity disabled:opacity-30 rounded-sm flex-1">
                [ CONFIRM ARCHIVE ]
              </button>
              <button onClick={handleClose}
                className="font-mono text-xs px-4 py-2 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm">
                [ ABORT ]
              </button>
            </div>
          </motion.div>
        )}
        {step === 4 && (
          <motion.div key="step4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="bg-void rounded-sm p-4 min-h-[120px] font-mono text-xs space-y-1">
              {lines.map((l, i) => (
                <p key={i} className={l.startsWith('> ERROR') ? 'text-danger' : l.includes('successfully') ? 'text-[#00FF88]' : 'text-ghost'}>{l}</p>
              ))}
              {loading && <span className="text-ember animate-pulse">█</span>}
            </div>
            {!loading && (
              <button onClick={() => { reset(); onDone(); onClose() }}
                className="font-mono text-xs px-4 py-2 bg-ember text-void hover:bg-flare transition-colors rounded-sm w-full">
                [ DONE ]
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  )
}

// ── Event History Row ─────────────────────────────────────────────────────────

function HistoryRow({ event, onExport, onDelete }) {
  const [viewOpen, setViewOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const isMajor = event.event_type === 'MAJOR'

  async function handleDelete() {
    if (!window.confirm(`Permanently delete "${event.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await client.delete(`/events/${event.id}`)
      onDelete?.(event.id)
    } catch (e) {
      alert(e?.response?.data?.detail || 'Delete failed.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="border border-ghost/20 bg-abyss rounded-sm p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {isMajor && <MajorBadge />}
              <span className="font-mono font-bold text-bone text-sm truncate">{event.name}</span>
              <span className="font-mono text-xs text-ghost">{fmtShort(event.closed_at || event.end_time)}</span>
            </div>
            <div className="font-mono text-xs text-ghost space-y-0.5">
              <p>
                {event.participant_count ?? 0} participants
                {event.top_player && <span> • Top: <span className="text-ember">{event.top_player}</span></span>}
              </p>
              {event.reset_level && <p>Reset: {event.reset_level}</p>}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setViewOpen(true)}
              className="font-mono text-xs px-2 py-1 border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 transition-colors rounded-sm">
              [ VIEW ]
            </button>
            <button onClick={() => onExport(event)}
              className="font-mono text-xs px-2 py-1 border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 transition-colors rounded-sm">
              [ EXPORT ]
            </button>
            <button onClick={handleDelete} disabled={deleting}
              className="font-mono text-xs px-2 py-1 border border-danger/30 text-danger/70 hover:text-danger hover:border-danger/60 transition-colors rounded-sm disabled:opacity-40">
              {deleting ? '...' : '[ DELETE ]'}
            </button>
          </div>
        </div>
      </div>
      <HistoryViewModal open={viewOpen} onClose={() => setViewOpen(false)} event={event} />
    </>
  )
}

function HistoryViewModal({ open, onClose, event }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !event) return
    setLoading(true)
    client.get(`/events/${event.id}`)
      .then(r => setDetail(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, event])

  if (!event) return null
  return (
    <Modal open={open} onClose={onClose} title={event.name} className="max-w-xl">
      {loading && <p className="font-mono text-xs text-ghost">Loading...</p>}
      {detail && (
        <div className="space-y-4 font-mono text-xs text-ghost">
          <div className="grid grid-cols-2 gap-2">
            <div><p className="text-ghost/60 uppercase tracking-widest mb-0.5">Status</p><p className="text-bone">{detail.status}</p></div>
            <div><p className="text-ghost/60 uppercase tracking-widest mb-0.5">Participants</p><p className="text-bone">{detail.participant_count ?? '—'}</p></div>
            <div><p className="text-ghost/60 uppercase tracking-widest mb-0.5">Started</p><p className="text-bone">{fmt(detail.start_time)}</p></div>
            <div><p className="text-ghost/60 uppercase tracking-widest mb-0.5">Closed</p><p className="text-bone">{fmt(detail.closed_at)}</p></div>
          </div>
          {detail.contract_count != null && (
            <div className="border-t border-ghost/20 pt-3 space-y-1">
              <p className="text-ghost/60 uppercase tracking-widest mb-1">Stats</p>
              <p>Contracts: {detail.contract_count}</p>
              <p>Teams: {detail.team_count}</p>
              <p>Total claims: {detail.claim_count}</p>
              {detail.top_player && <p>Top player: <span className="text-ember">{detail.top_player}</span></p>}
            </div>
          )}
          {detail.description && (
            <div className="border-t border-ghost/20 pt-3">
              <p className="text-ghost/60 uppercase tracking-widest mb-1">Description</p>
              <p className="text-bone">{detail.description}</p>
            </div>
          )}
        </div>
      )}
      <button onClick={onClose} className="mt-4 font-mono text-xs px-4 py-2 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm">
        [ CLOSE ]
      </button>
    </Modal>
  )
}

// ── All-Time Standings ────────────────────────────────────────────────────────

function AllTimeStandings() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [exportLoading, setExportLoading] = useState(false)

  useEffect(() => {
    client.get('/events/all-time')
      .then(r => setRows(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function exportCsv() {
    setExportLoading(true)
    try {
      const header = 'Rank,Callsign,Events,Total BC\n'
      const body = rows.map(r => `${r.rank},${r.callsign},${r.events},${r.total_bc}`).join('\n')
      const blob = new Blob([header + body], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = 'deadnet-all-time.csv'; a.click()
      URL.revokeObjectURL(url)
    } finally { setExportLoading(false) }
  }

  return (
    <div className="border-t border-ghost/20 pt-8">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-mono font-bold text-bone text-sm tracking-widest uppercase">
          ALL-TIME STANDINGS
        </h2>
        <button
          onClick={exportCsv}
          disabled={exportLoading || rows.length === 0}
          className="font-mono text-xs border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 px-3 py-1 rounded-sm transition-colors disabled:opacity-40"
        >
          [ EXPORT ALL-TIME CSV ]
        </button>
      </div>
      <p className="font-mono text-xs text-ghost/50 mb-4">Cumulative performance across all events</p>

      {loading ? (
        <p className="font-mono text-xs text-ghost animate-pulse">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="font-mono text-xs text-ghost/40">No data yet.</p>
      ) : (
        <div className="border border-ghost/20 rounded-sm overflow-hidden">
          <div className="grid grid-cols-4 px-3 py-2 border-b border-ghost/20 bg-void">
            {['#', 'CALLSIGN', 'EVENTS', 'TOTAL BC'].map(h => (
              <span key={h} className="font-mono text-[10px] text-ghost tracking-widest">{h}</span>
            ))}
          </div>
          <div className="divide-y divide-ghost/10">
            {rows.map(r => (
              <div key={r.callsign} className="grid grid-cols-4 px-3 py-2 hover:bg-ghost/5 transition-colors">
                <span className="font-mono text-xs text-ghost/60">{r.rank}</span>
                <span className="font-mono text-xs text-bone">{r.callsign}</span>
                <span className="font-mono text-xs text-ghost">{r.events}</span>
                <span className="font-mono text-xs text-ember">{r.total_bc.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Events() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [current, setCurrent] = useState(null)    // UPCOMING / ACTIVE / CLOSED own event
  const [partnerEvents, setPartnerEvents] = useState([]) // MAJOR events where org is partner
  const [history, setHistory] = useState([])       // ARCHIVED events
  const [boardFrozen, setBoardFrozen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [showTypePicker, setShowTypePicker] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showCreateMajor, setShowCreateMajor] = useState(false)
  const [showManage, setShowManage] = useState(false)
  const [manageEvent, setManageEvent] = useState(null)  // event to pass to ManageEventModal
  const [showArchive, setShowArchive] = useState(false)
  const [lendFor, setLendFor] = useState(null)   // event to lend contractor for
  const [historyOpen, setHistoryOpen] = useState(false)

  // access control — 404 for non-admin/non-architect
  if (user && user.role !== 'ADMIN' && user.role !== 'ARCHITECT') return <NotFound />

  const isArchitect = user?.role === 'ARCHITECT'

  async function load() {
    try {
      const [eventsRes, settingsRes] = await Promise.all([
        client.get('/events'),
        client.get('/public/settings'),
      ])
      const all = eventsRes.data
      // Split own (HOST) events from partner MAJOR events
      const ownEvents = all.filter(e => !e.participating_as || e.participating_as === 'HOST')
      const partnerEvts = all.filter(e => e.participating_as === 'PARTNER')

      // current = first UPCOMING or ACTIVE or the CLOSED event pending archive (own events)
      const active = ownEvents.find(e => e.status === 'ACTIVE')
      const upcoming = ownEvents.find(e => e.status === 'UPCOMING')
      const closedPending = ownEvents.find(e => e.status === 'CLOSED')
      const currentEvent = active || upcoming || closedPending || null
      setCurrent(currentEvent)

      setPartnerEvents(partnerEvts.filter(e => e.status !== 'ARCHIVED'))
      setHistory(ownEvents.filter(e =>
        e.status === 'ARCHIVED' || (e.status === 'CLOSED' && e !== currentEvent)
      ))
      setBoardFrozen(settingsRes.data?.board_frozen === true || settingsRes.data?.board_frozen === 'true')
    } catch { /* ignore */ }
  }

  useEffect(() => { load() }, [])

  async function handleStart() {
    if (!current) return
    setLoading(true)
    try { await client.post(`/events/${current.id}/start`); await load() }
    catch (err) { alert(err.response?.data?.detail || 'Failed') }
    finally { setLoading(false) }
  }

  async function handleHalt() {
    if (!current) return
    setLoading(true)
    try { await client.post(`/events/${current.id}/halt`); await load() }
    catch (err) { alert(err.response?.data?.detail || 'Failed') }
    finally { setLoading(false) }
  }

  async function handleClose() {
    if (!current || !confirm(`Close event "${current.name}"? This cannot be undone.`)) return
    setLoading(true)
    try { await client.post(`/events/${current.id}/close`); await load() }
    catch (err) { alert(err.response?.data?.detail || 'Failed') }
    finally { setLoading(false) }
  }

  async function handleFreezeToggle() {
    setLoading(true)
    try {
      await client.post('/admin/board-freeze', { frozen: !boardFrozen })
      setBoardFrozen(f => !f)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  async function handleExport(event) {
    try {
      const r = await client.get(`/events/${event.id}/export`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a'); a.href = url
      a.download = `event-${event.id}-export.json`; a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  const canCreate = !current || current.status === 'CLOSED'

  return (
    <div className="min-h-screen bg-void flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-mono font-bold text-bone text-2xl tracking-widest uppercase">
            DEADNET EVENTS
          </h1>
          <p className="font-mono text-xs text-ghost mt-1">
            Manage competition events and view historical results.
          </p>
        </div>

        {/* Join a Major Event section — only for non-Architect Admins */}
        {!isArchitect && (
          <JoinMajorEventSection onJoined={load} />
        )}

        {/* Partner Major Events */}
        {partnerEvents.length > 0 && (
          <div className="mb-6">
            <p className="font-mono text-xs text-ghost/60 uppercase tracking-widest mb-2">Participating As Partner</p>
            <div className="space-y-4">
              {partnerEvents.map(ev => (
                <PartnerMajorEventCard
                  key={ev.id}
                  event={ev}
                  onManageParticipants={() => { setManageEvent(ev); setShowManage(true) }}
                  onViewBoard={() => navigate('/bounty-board')}
                  onLendContractor={() => setLendFor(ev)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Current own event */}
        {current && (
          <div className="mb-6">
            <p className="font-mono text-xs text-ghost/60 uppercase tracking-widest mb-2">Current Event</p>
            {current.status === 'UPCOMING' && (
              <UpcomingCard event={current} onStart={handleStart} onEdit={() => { setManageEvent(current); setShowManage(true) }} onRefresh={load} loading={loading} />
            )}
            {current.status === 'ACTIVE' && (
              <ActiveCard
                event={current}
                onHalt={handleHalt}
                onClose={handleClose}
                onManage={() => { setManageEvent(current); setShowManage(true) }}
                onFreezeToggle={handleFreezeToggle}
                boardFrozen={boardFrozen}
                onRefresh={load}
                loading={loading}
              />
            )}
            {current.status === 'CLOSED' && (
              <ClosedCard
                event={current}
                onArchive={() => setShowArchive(true)}
                onExport={() => handleExport(current)}
                loading={loading}
              />
            )}
          </div>
        )}

        {/* Create button row */}
        <div className="mb-8">
          <div className="relative group inline-block">
            <button
              onClick={() => canCreate && setShowTypePicker(true)}
              disabled={!canCreate}
              className={`font-mono text-xs px-4 py-2 border transition-colors rounded-sm ${
                canCreate
                  ? 'border-ember/60 text-ember hover:bg-ember/10'
                  : 'border-ghost/20 text-ghost/30 cursor-not-allowed'
              }`}
            >
              [ + CREATE EVENT ]
            </button>
            {!canCreate && (
              <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block bg-abyss border border-ghost/30 rounded-sm px-3 py-2 whitespace-nowrap">
                <p className="font-mono text-xs text-ghost">Close current event before creating a new one</p>
              </div>
            )}
          </div>
        </div>

        {/* Event History */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setHistoryOpen(o => !o)}
              className="flex items-center gap-2 font-mono text-xs text-ghost/60 uppercase tracking-widest hover:text-ghost transition-colors"
            >
              <span>{historyOpen ? '▼' : '▶'}</span>
              Event History
              {history.length > 0 && (
                <span className="text-ghost/40">({history.length})</span>
              )}
            </button>
            {history.length > 0 && (
              <button
                onClick={() => navigate('/events/history')}
                className="font-mono text-xs px-2 py-1 border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 transition-colors rounded-sm"
              >
                [ VIEW ALL ] →
              </button>
            )}
          </div>
          {historyOpen && (
            history.length === 0 ? (
              <p className="font-mono text-xs text-ghost/40">No archived events yet.</p>
            ) : (
              <div className="space-y-2">
                {history.slice(0, 3).map(ev => (
                  <HistoryRow key={ev.id} event={ev} onExport={handleExport}
                    onDelete={id => setHistory(h => h.filter(e => e.id !== id))} />
                ))}
                {history.length > 3 && (
                  <button
                    onClick={() => navigate('/events/history')}
                    className="w-full font-mono text-xs text-ghost/50 hover:text-ghost py-2 border border-ghost/15 rounded-sm transition-colors"
                  >
                    + {history.length - 3} more — [ VIEW ALL ]
                  </button>
                )}
              </div>
            )
          )}
        </div>

        {/* All-Time Standings */}
        <AllTimeStandings />
      </main>
      <Footer />

      {/* Modals */}
      <CreateEventTypePicker
        open={showTypePicker}
        onClose={() => setShowTypePicker(false)}
        onPickLocal={() => { setShowTypePicker(false); setShowCreate(true) }}
        onPickPartnership={() => { setShowTypePicker(false); setShowCreateMajor(true) }}
      />
      <CreateEventModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
      <CreateMajorEventModal
        open={showCreateMajor}
        onClose={() => setShowCreateMajor(false)}
        onCreated={load}
        userRole={user?.role}
      />
      <ManageEventModal open={showManage} onClose={() => { setShowManage(false); setManageEvent(null) }} event={manageEvent || current} onSaved={load} />
      <ArchiveModal open={showArchive} onClose={() => setShowArchive(false)} event={current} onDone={load} />
      {lendFor && (
        <LendContractorModal
          open={!!lendFor}
          onClose={() => setLendFor(null)}
          event={lendFor}
        />
      )}
    </div>
  )
}
