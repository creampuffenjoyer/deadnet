import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useEventStatus } from '../hooks/useEventStatus'
import { useMyRegistration } from '../hooks/useMyRegistration'
import client from '../api/client'
import Navbar from '../components/ui/Navbar'
import OfflineLock from '../components/ui/OfflineLock'
import CCBanner from '../components/cc/CCBanner'
import Footer from '../components/ui/Footer'
import Scanlines from '../components/effects/Scanlines'
import GlitchText from '../components/effects/GlitchText'
import Badge from '../components/ui/Badge'
import ContractModal from '../components/ContractModal'
import { usePlatformFormat } from '../hooks/usePlatformFormat'

const RARITIES         = ['ALL', 'COMMON', 'RARE', 'CLASSIFIED']
const RARITY_TAB_COLOR = { COMMON: '#8A8A9A', RARE: '#4A9EFF', CLASSIFIED: '#FF2D2D', V01D: '#FF4500' }

const SORT_OPTIONS = [
  { value: 'default',      label: 'DEFAULT'         },
  { value: 'bc_desc',      label: 'BC: HIGH → LOW'  },
  { value: 'bc_asc',       label: 'BC: LOW → HIGH'  },
  { value: 'title_asc',    label: 'TITLE: A → Z'    },
  { value: 'claims_desc',  label: 'MOST CLAIMED'     },
  { value: 'rarity',       label: 'RARITY'           },
  { value: 'team_working', label: 'TEAM: WORKING'    },
  { value: 'team_solved',  label: 'TEAM: SOLVED'     },
]

const RARITY_ORDER = { CLASSIFIED: 0, RARE: 1, COMMON: 2 }

function applySort(list, sortBy) {
  if (sortBy === 'default') return list
  if (sortBy === 'team_working') return list.filter(c => (c.team_working?.length ?? 0) > 0)
  if (sortBy === 'team_solved')  return list.filter(c => (c.team_solved?.length ?? 0) > 0)
  const copy = [...list]
  if (sortBy === 'bc_desc')     return copy.sort((a, b) => b.current_bc_value - a.current_bc_value)
  if (sortBy === 'bc_asc')      return copy.sort((a, b) => a.current_bc_value - b.current_bc_value)
  if (sortBy === 'title_asc')   return copy.sort((a, b) => a.title.localeCompare(b.title))
  if (sortBy === 'claims_desc') return copy.sort((a, b) => b.claim_count - a.claim_count)
  if (sortBy === 'rarity')      return copy.sort((a, b) => (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9))
  return copy
}

const RARITY_BORDER = {
  COMMON:     'border-common-glow/40 hover:border-common-glow',
  RARE:       'border-rare-glow/50 hover:border-rare-glow hover:shadow-[0_0_12px_rgba(74,158,255,0.25)]',
  CLASSIFIED: 'border-classified-glow/60 animate-classified-pulse',
}

// Ensure ISO string is treated as UTC by JS Date
function toUtcDate(isoStr) {
  if (!isoStr) return null
  const s = isoStr.endsWith('Z') || isoStr.match(/[+-]\d{2}:\d{2}$/) ? isoStr : isoStr + 'Z'
  return new Date(s)
}

// Format seconds as H:MM:SS or M:SS
function formatCountdown(secs) {
  if (secs === null || secs === undefined || secs < 0) return null
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// BC color based on how much it has decayed relative to base
function getBcColor(contract) {
  if (!contract.decay_mode || contract.decay_mode === 'OFF') return '#FF4500'
  if (!contract.base_bc_value) return '#FF4500'
  const ratio = contract.current_bc_value / contract.base_bc_value
  if (ratio >= 0.95) return '#FF4500'  // 100%  — ember
  if (ratio >= 0.82) return '#FF6B00'  // ~90%  — flare
  if (ratio >= 0.67) return '#FFAA00'  // ~75%  — yellow-orange
  if (ratio >= 0.55) return '#8A8A9A'  // ~60%  — ghost
  return '#6B6B85'                     // floor — grey
}

// Countdown hook that fires onExpire once when timer first reaches 0
function useDecayCountdown(nextDecayAt, onExpire) {
  const [secs, setSecs] = useState(null)
  const firedRef  = useRef(false)
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

// Countdown hook for pre-competition display (no expire callback)
function useSimpleCountdown(targetIso) {
  const [diff, setDiff] = useState(null)
  useEffect(() => {
    if (!targetIso) return
    const target = toUtcDate(targetIso)
    const tick = () => setDiff(Math.max(0, Math.floor((target - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetIso])

  if (diff === null) return null
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${String(h).padStart(2, '0')} : ${String(m).padStart(2, '0')} : ${String(s).padStart(2, '0')}`
}

function ContractCard({ contract, onClick, activeTag, onTagClick, isReadOnly, onDecayTriggered, isOperative, onBookmark }) {
  const claimed  = contract.is_claimed_by_me
  const bcColor  = getBcColor(contract)
  const bookmarked = !!contract.my_assignment_id

  const secsLeft = useDecayCountdown(
    contract.next_decay_at,
    () => onDecayTriggered?.(contract.id)
  )

  const isTimeBased = contract.decay_mode === 'TIME_BASED'
  const atFloor = isTimeBased
    && contract.next_decay_at === null
    && contract.next_decay_bc === null
    && contract.current_bc_value < contract.base_bc_value
  const showCountdown = isTimeBased && contract.next_decay_at !== null && secsLeft !== null && secsLeft > 0

  return (
    <div
      onClick={() => onClick(contract)}
      className={`
        relative bg-abyss border rounded-sm p-4 cursor-pointer
        transition-all duration-200 overflow-hidden flex flex-col
        ${RARITY_BORDER[contract.rarity]}
        ${claimed ? 'opacity-70' : ''}
      `}
    >
      {/* Contract Seized ribbon */}
      {contract.is_first_blood_taken && !claimed && (
        <div className="absolute top-0 right-0">
          <div className="bg-ember text-void font-mono text-[10px] font-bold px-2 py-0.5 tracking-widest">
            SEIZED
          </div>
        </div>
      )}

      {/* Read-only overlay */}
      {isReadOnly && !claimed && (
        <div className="absolute top-0 left-0 bg-ghost/10 border-b border-r border-ghost/20 font-mono text-[9px] text-ghost px-2 py-0.5 tracking-widest">
          LOCKED
        </div>
      )}

      {/* Claimed overlay */}
      {claimed && (
        <div className="absolute inset-0 border border-success/20 bg-success/5 rounded-sm flex items-center justify-center z-10">
          <span className="font-mono text-xs text-success font-bold tracking-widest bg-abyss/80 px-3 py-1">
            ✓ CONTRACT CLOSED
          </span>
        </div>
      )}

      {/* Rarity + Category */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <Badge label={contract.rarity} type="rarity" className="shrink-0" />
        <span className="font-mono text-[10px] text-ghost tracking-wide uppercase text-right min-w-0 truncate">
          {contract.category}
        </span>
      </div>

      {/* Title */}
      <h3 className="font-ui font-bold text-bone text-base leading-tight mb-3">
        {contract.title}
      </h3>

      {/* Tags */}
      {contract.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3" onClick={e => e.stopPropagation()}>
          {contract.tags.map(tag => (
            <button
              key={tag}
              onClick={() => onTagClick(tag)}
              className={`font-mono text-[9px] tracking-widest px-1.5 py-0.5 rounded-sm border transition-all ${
                activeTag === tag
                  ? 'border-ember text-ember bg-ember/10'
                  : 'border-ghost/30 text-ghost hover:border-ghost hover:text-bone'
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* Team working strip — mid-card, above footer */}
      {contract.team_working?.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3 px-2 py-1.5 rounded-sm bg-flare/5 border border-flare/20">
          <span className="font-mono text-[9px] text-flare/60 tracking-widest shrink-0">WORKING:</span>
          {contract.team_working.map(username => (
            <span key={username} className="font-mono text-[10px] font-bold text-flare tracking-wide">
              {username}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-end justify-between mt-auto">
        <div>
          <span className="font-mono font-bold text-lg" style={{ color: bcColor }}>
            {contract.current_bc_value} BC
          </span>

          {/* Decay indicator */}
          {showCountdown && (
            <div className="font-mono text-[9px] text-ghost mt-0.5">
              <span style={{ color: '#FF6B00' }}>↓</span>
              {' '}{contract.next_decay_bc} BC in {formatCountdown(secsLeft)}
            </div>
          )}
          {atFloor && (
            <div className="font-mono text-[9px] italic mt-0.5" style={{ color: '#6B6B85' }}>
              FLOOR REACHED
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isOperative && !claimed && !isReadOnly && (
            <button
              onClick={e => { e.stopPropagation(); onBookmark?.(contract) }}
              title={bookmarked ? 'Remove working bookmark' : 'Mark as working on this'}
              className={`font-mono text-[9px] tracking-widest border px-1.5 py-0.5 rounded-sm transition-all ${
                bookmarked
                  ? 'border-flare/60 bg-flare/10 text-flare'
                  : 'border-ghost/20 text-ghost/50 hover:border-flare/40 hover:text-flare'
              }`}
            >
              {bookmarked ? '◈ WORKING' : '◇ WORKING'}
            </button>
          )}
          <div className="text-right">
            {contract.team_working?.length > 0 && (
              <div className="font-mono text-[9px] text-flare mb-0.5">
                {contract.team_working.length} working
              </div>
            )}
            <span className="font-mono text-[10px] text-ghost">
              {contract.claim_count} claimed
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ContractBoard() {
  const { user } = useAuth()
  const { active: activeEvent, upcoming: upcomingEvent, loading: eventLoading } = useEventStatus()
  const regStatus = useMyRegistration(activeEvent?.id || null)
  const { competition_start, competition_end, competition_active, competition_manual_end, competition_halted_by } = usePlatformFormat()
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeRarity, setActiveRarity] = useState('ALL')
  const [activeCategory, setActiveCategory] = useState('ALL')
  const [activeTag, setActiveTag] = useState(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('default')
  const [selected, setSelected] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [competitionBlocked, setCompetitionBlocked] = useState(false)
  const [competitionPaused, setCompetitionPaused] = useState(false)
  const [voidContracts, setVoidContracts] = useState([])
  const [voidLoading, setVoidLoading] = useState(false)
  const [voidDenied, setVoidDenied] = useState(false)
  const [flashMsg, setFlashMsg] = useState(null)

  const hasVoidAccess = user?.void_access === true

  const countdown = useSimpleCountdown(competitionBlocked ? competition_start : null)

  const isPrivileged = ['ADMIN', 'CONTRACTOR', 'HANDLER'].includes(user?.role)

  const now = Date.now()
  const startMs = competition_start ? toUtcDate(competition_start)?.getTime() : null
  const endMs = competition_end ? toUtcDate(competition_end)?.getTime() : null
  // Only apply the time-gate if the API hasn't yet confirmed access.
  // If contracts were successfully loaded (lastUpdated set), the backend
  // already authorised the operative — don't let a stale platform setting override that.
  const beforeStart = !isPrivileged && startMs && now < startMs && !lastUpdated
  const afterEnd = !isPrivileged && endMs && now > endMs

  const manualHalted = !isPrivileged && competition_active === 'false'
  const manualEndMs = competition_manual_end ? toUtcDate(competition_manual_end)?.getTime() : null
  const manualExpired = !isPrivileged && competition_active === 'true' && manualEndMs && now > manualEndMs
  const competitionLocked = manualHalted || manualExpired

  const fetchContracts = useCallback(async () => {
    try {
      const { data } = await client.get('/contracts/')
      setContracts(data)
      setLastUpdated(new Date())
      setCompetitionBlocked(false)
      setCompetitionPaused(false)
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (detail === 'NO_EVENT' || detail === 'COMPETITION_NOT_STARTED') {
        setCompetitionBlocked(true)
        setCompetitionPaused(false)
      } else if (detail === 'HALTED' || detail === 'COMPETITION_HALTED') {
        setCompetitionPaused(true)
        setCompetitionBlocked(false)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + 10-second polling
  useEffect(() => {
    fetchContracts()
    const id = setInterval(fetchContracts, 10_000)
    return () => clearInterval(id)
  }, [fetchContracts])

  // Targeted refetch for a single contract when its decay timer fires
  const handleDecayTriggered = useCallback(async (contractId) => {
    // Optimistic: apply next_decay_bc immediately so the card updates without waiting for API
    setContracts(prev => prev.map(c => {
      if (c.id !== contractId || c.next_decay_bc === null) return c
      return { ...c, current_bc_value: c.next_decay_bc, next_decay_at: null, next_decay_bc: null }
    }))
    // Sync with server
    try {
      const { data } = await client.get(`/contracts/${contractId}`)
      setContracts(prev => prev.map(c => c.id === contractId ? {
        ...c,
        current_bc_value: data.current_bc_value,
        decay_mode: data.decay_mode,
        next_decay_at: data.next_decay_at,
        next_decay_bc: data.next_decay_bc,
      } : c))
    } catch {}
  }, [])

  const handleBookmark = useCallback(async (contract) => {
    const assignmentId = contract.my_assignment_id
    const patch = (c, updates) => c.id === contract.id ? { ...c, ...updates } : c

    if (assignmentId) {
      const updates = {
        my_assignment_id: null,
        team_working: contract.team_working?.filter(u => u !== user?.username) ?? [],
      }
      setContracts(prev => prev.map(c => patch(c, updates)))
      setSelected(prev => prev ? patch(prev, updates) : null)
      try {
        await client.delete(`/teams/assignments/${assignmentId}`)
      } catch {
        fetchContracts()
      }
    } else {
      const pending = {
        my_assignment_id: '__pending__',
        team_working: [...(contract.team_working ?? []), user?.username],
      }
      setContracts(prev => prev.map(c => patch(c, pending)))
      setSelected(prev => prev ? patch(prev, pending) : null)
      try {
        const { data } = await client.post('/teams/bookmark', { contract_id: contract.id })
        const final = { my_assignment_id: data.id }
        setContracts(prev => prev.map(c => patch(c, final)))
        setSelected(prev => prev ? patch(prev, final) : null)
      } catch (err) {
        fetchContracts()
        if (err?.response?.status === 403) {
          setFlashMsg('You must be in a team to use the working tracker.')
          setTimeout(() => setFlashMsg(null), 4000)
        }
      }
    }
  }, [user?.username, fetchContracts])

  async function fetchVoidContracts() {
    setVoidLoading(true)
    setVoidDenied(false)
    try {
      const { data } = await client.get('/v01d/contracts')
      setVoidContracts(data)
    } catch (err) {
      if (err?.response?.status === 404 || err?.response?.status === 403) setVoidDenied(true)
    } finally {
      setVoidLoading(false)
    }
  }

  function selectRarity(r) {
    setActiveRarity(r)
    setActiveTag(null)
    setActiveCategory('ALL')
    if (r === 'V01D') fetchVoidContracts()
  }

  const handleTagClick = (tag) => {
    setActiveTag(prev => prev === tag ? null : tag)
    setActiveRarity('ALL')
    setActiveCategory('ALL')
  }

  // Categories present in the current event's contracts (respects allowed_categories automatically)
  const availableCategories = useMemo(() => {
    const cats = [...new Set(contracts.map(c => c.category))].filter(Boolean)
    return cats.sort((a, b) => a.localeCompare(b))
  }, [contracts])

  const categoryList = useMemo(() => ['ALL', ...availableCategories], [availableCategories])

  const rarityCounts = useMemo(() => {
    const unsolved = contracts.filter(c => !c.is_claimed_by_me)
    return {
      ALL:        unsolved.length,
      COMMON:     unsolved.filter(c => c.rarity === 'COMMON').length,
      RARE:       unsolved.filter(c => c.rarity === 'RARE').length,
      CLASSIFIED: unsolved.filter(c => c.rarity === 'CLASSIFIED').length,
    }
  }, [contracts])

  const filtered = useMemo(() => {
    if (activeRarity === 'V01D') {
      let list = voidContracts
      if (activeCategory !== 'ALL') list = list.filter(c => c.category === activeCategory)
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        list = list.filter(c => c.title?.toLowerCase().includes(q))
      }
      return applySort(list, sortBy)
    }
    let list = contracts
    if (activeRarity !== 'ALL')    list = list.filter(c => c.rarity === activeRarity)
    if (activeCategory !== 'ALL')  list = list.filter(c => c.category === activeCategory)
    if (activeTag)                 list = list.filter(c => c.tags?.includes(activeTag))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.tags?.some(t => t.toLowerCase().includes(q))
      )
    }
    return applySort(list, sortBy)
  }, [contracts, voidContracts, activeRarity, activeCategory, activeTag, search, sortBy])

  const grouped = useMemo(() => availableCategories.reduce((acc, cat) => {
    const items = filtered.filter(c => c.category === cat)
    if (items.length) acc[cat] = items
    return acc
  }, {}), [filtered, availableCategories])

  const stats = {
    total: contracts.length,
    claimed: contracts.filter(c => c.is_claimed_by_me).length,
    available: contracts.filter(c => !c.is_claimed_by_me).length,
  }

  if (competitionPaused && !isPrivileged) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Scanlines />
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <div className="font-mono text-xs text-flare tracking-[0.3em] mb-6 animate-pulse">
            ● OPERATIONS SUSPENDED
          </div>
          <GlitchText as="h1" className="font-mono font-bold text-5xl tracking-widest mb-6" style={{ color: '#FF6B00' }}>
            STAND BY
          </GlitchText>
          <p className="font-mono text-ghost text-sm tracking-widest mb-4">
            COMPETITION TEMPORARILY PAUSED
          </p>
          <div className="w-48 border-t border-flare/20 my-6" />
          <p className="font-mono text-xs text-ghost/50 tracking-widest max-w-sm leading-relaxed">
            Contract submissions are locked.<br />
            The competition will resume shortly.
          </p>
        </div>
        <Footer />
      </div>
    )
  }

  if (beforeStart || (competitionBlocked && !isPrivileged)) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Scanlines />
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <GlitchText as="h1" className="font-mono font-bold text-5xl text-ember tracking-widest mb-6">
            DEADNET OFFLINE
          </GlitchText>
          <p className="font-mono text-ghost text-sm tracking-widest mb-10">
            CONTRACTS GO LIVE IN
          </p>
          <div className="font-mono font-bold text-6xl text-bone tracking-[0.2em] mb-6">
            {countdown || '-- : -- : --'}
          </div>
          <p className="font-mono text-xs text-ghost/60 tracking-widest max-w-sm">
            You can still access your profile and team. Contracts unlock when the competition begins.
          </p>
        </div>
        <Footer />
      </div>
    )
  }

  if (!eventLoading && !activeEvent && user?.role === 'OPERATIVE') {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Navbar />
        <OfflineLock title="CONTRACT BOARD OFFLINE" upcoming={upcomingEvent} />
        <Footer />
      </div>
    )
  }

  if (!eventLoading && activeEvent && user?.role === 'OPERATIVE' && !regStatus.loading && regStatus.status === 'REMOVED') {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Navbar />
        <OfflineLock title="CONTRACT BOARD" mode="removed" activeEvent={activeEvent} />
        <Footer />
      </div>
    )
  }

  if (!eventLoading && activeEvent && user?.role === 'OPERATIVE' && !regStatus.loading && !regStatus.registered) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Navbar />
        <OfflineLock title="CONTRACT BOARD" mode="not_registered" activeEvent={activeEvent} />
        <Footer />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-void text-bone flex flex-col">
      <Scanlines />
      <Navbar />
      <CCBanner />

      {afterEnd && (
        <div className="relative z-10 bg-ghost/10 border-b border-ghost/30 px-6 py-2 flex items-center gap-3">
          <span className="font-mono text-xs text-ghost font-bold tracking-widest animate-pulse">
            ⚠ COMPETITION CLOSED — CONTRACTS LOCKED
          </span>
          <span className="font-mono text-xs text-ghost/60">Flag submissions are disabled.</span>
        </div>
      )}

      {competitionLocked && (
        <div className="relative z-10 bg-danger/10 border-b border-danger/30 px-6 py-2 flex items-center gap-3">
          <span className="font-mono text-xs text-danger font-bold tracking-widest animate-pulse">
            ⚠ COMPETITION HALTED — CONTRACTS LOCKED
          </span>
          <span className="font-mono text-xs text-ghost/60">
            Flag submissions are disabled{competition_halted_by ? ` by ${competition_halted_by}` : ''}.
          </span>
        </div>
      )}

      {flashMsg && (
        <div className="relative z-10 bg-flare/10 border-b border-flare/30 px-6 py-2 flex items-center gap-3">
          <span className="font-mono text-xs text-flare tracking-widest">{flashMsg}</span>
        </div>
      )}

      <div className="relative z-10 flex-1 px-6 py-8 max-w-7xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <GlitchText as="h1" className="font-mono font-bold text-4xl text-ember tracking-widest">
              ACTIVE CONTRACTS
            </GlitchText>
            <div className="flex items-center gap-4 mt-2">
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-success">
                <span className="w-2 h-2 rounded-full bg-success animate-pulse inline-block" />
                LIVE
              </span>
              {lastUpdated && (
                <span className="font-mono text-xs text-ghost">
                  updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          {user?.role === 'OPERATIVE' && (
            <div className="flex gap-4">
              {[
                { label: 'AVAILABLE', val: stats.available, color: 'text-ember' },
                { label: 'CLAIMED', val: stats.claimed, color: 'text-success' },
              ].map(s => (
                <div key={s.label} className="border border-ghost/20 bg-abyss rounded-sm px-4 py-2 text-center">
                  <div className={`font-mono font-bold text-xl ${s.color}`}>{s.val}</div>
                  <div className="font-mono text-[10px] text-ghost tracking-widest">{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Search bar */}
        <div className="mb-5">
          <input
            className="w-full max-w-md bg-abyss border border-ghost/30 focus:border-ember rounded-sm px-3 py-2 font-mono text-sm text-bone placeholder-ghost/40 outline-none transition-all"
            placeholder="SEARCH BY TITLE OR TAG..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Rarity tabs */}
        <div className="flex gap-1 mb-3 flex-wrap">
          {RARITIES.map(r => {
            const count = rarityCounts[r]
            const active = activeRarity === r && !activeTag
            const col = RARITY_TAB_COLOR[r]
            return (
              <button
                key={r}
                onClick={() => selectRarity(r)}
                className="font-mono text-xs tracking-widest px-3 py-1.5 rounded-sm border transition-all flex items-center gap-2"
                style={active
                  ? { borderColor: col || '#FF4500', background: `${col || '#FF4500'}18`, color: col || '#FF4500' }
                  : { borderColor: 'rgba(107,107,128,0.2)', color: '#6B6B80' }
                }
              >
                {r}
                {r !== 'ALL' && count > 0 && (
                  <span
                    className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-sm"
                    style={active
                      ? { background: `${col || '#FF4500'}30`, color: col || '#FF4500' }
                      : { background: 'rgba(107,107,128,0.15)', color: '#8A8A9A' }
                    }
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
          {hasVoidAccess && (
            <button
              onClick={() => selectRarity('V01D')}
              className="font-mono text-xs tracking-widest px-3 py-1.5 rounded-sm border transition-all flex items-center gap-2"
              style={activeRarity === 'V01D'
                ? { borderColor: '#FF4500', background: 'rgba(255,69,0,0.1)', color: '#FF4500' }
                : { borderColor: 'rgba(107,107,128,0.2)', color: '#6B6B80' }
              }
            >
              V01D
            </button>
          )}
        </div>

        {/* Category pills + sort controls */}
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <div className="flex gap-1 flex-wrap">
            {categoryList.map(cat => (
              <button
                key={cat}
                onClick={() => { setActiveCategory(cat); setActiveTag(null) }}
                className={`
                  font-mono text-[11px] tracking-widest px-2.5 py-1 rounded-sm border transition-all uppercase
                  ${activeCategory === cat && !activeTag
                    ? 'border-ember bg-ember/10 text-ember'
                    : 'border-ghost/20 text-ghost hover:border-ghost hover:text-bone'
                  }
                `}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Sort selector */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[10px] text-ghost tracking-widest">SORT</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="bg-abyss border border-ghost/20 rounded-sm px-2 py-1 font-mono text-[11px] text-bone focus:outline-none focus:border-ember tracking-widest"
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Active tag chip */}
        {activeTag && (
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono text-xs text-ghost tracking-widest">TAG:</span>
            <button
              onClick={() => setActiveTag(null)}
              className="font-mono text-xs text-ember border border-ember/40 bg-ember/10 px-2 py-0.5 rounded-sm hover:border-ember transition-all"
            >
              #{activeTag} ×
            </button>
          </div>
        )}
        <div className="mb-4" />

        {/* Contract grid */}
        {activeRarity === 'V01D' ? (
          voidLoading ? (
            <div className="flex items-center justify-center py-24">
              <span className="font-mono text-ghost text-sm animate-pulse tracking-widest">ACCESSING V01D...</span>
            </div>
          ) : voidDenied ? (
            <div className="text-center py-24">
              <p className="font-mono text-danger text-sm tracking-widest mb-2">ACCESS DENIED</p>
              <p className="font-mono text-ghost/50 text-xs tracking-widest">You don't have an active void session.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-24">
              <p className="font-mono text-ghost text-sm tracking-widest">NO V01D CONTRACTS MATCH FILTER</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filtered.map(c => (
                <ContractCard
                  key={c.id} contract={c} onClick={setSelected}
                  activeTag={activeTag} onTagClick={handleTagClick}
                  isReadOnly={afterEnd || competitionLocked}
                  onDecayTriggered={handleDecayTriggered}
                  isOperative={user?.role === 'OPERATIVE'}
                  onBookmark={handleBookmark}
                />
              ))}
            </div>
          )
        ) : loading ? (
          <div className="flex items-center justify-center py-24">
            <span className="font-mono text-ghost text-sm animate-pulse tracking-widest">
              ESTABLISHING CONNECTION...
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24">
            <p className="font-mono text-ghost text-sm tracking-widest">
              {contracts.length === 0 ? 'NO CONTRACTS ACTIVE — STAND BY' : 'NO CONTRACTS MATCH FILTER'}
            </p>
          </div>
        ) : activeRarity === 'ALL' && activeCategory === 'ALL' && !activeTag && !search.trim() && sortBy === 'default' ? (
          <div className="flex flex-col gap-10">
            {Object.entries(grouped).map(([cat, items]) => (
              <section key={cat}>
                <h2 className="font-mono text-xs text-ghost tracking-widest uppercase mb-3 border-b border-ghost/10 pb-2">
                  {cat} // {items.length} contract{items.length !== 1 ? 's' : ''}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {items.map(c => (
                    <ContractCard
                      key={c.id} contract={c} onClick={setSelected}
                      activeTag={activeTag} onTagClick={handleTagClick}
                      isReadOnly={afterEnd || competitionLocked}
                      onDecayTriggered={handleDecayTriggered}
                      isOperative={user?.role === 'OPERATIVE'}
                      onBookmark={handleBookmark}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map(c => (
              <ContractCard
                key={c.id} contract={c} onClick={setSelected}
                activeTag={activeTag} onTagClick={handleTagClick}
                isReadOnly={afterEnd || competitionLocked}
                onDecayTriggered={handleDecayTriggered}
                isOperative={user?.role === 'OPERATIVE'}
                onBookmark={handleBookmark}
              />
            ))}
          </div>
        )}
      </div>

      <Footer />

      {selected && (
        <ContractModal
          contract={selected}
          onClose={() => setSelected(null)}
          onClaimed={() => {
            fetchContracts()
            setSelected(prev => prev ? { ...prev, is_claimed_by_me: true } : null)
          }}
          isReadOnly={afterEnd || competitionLocked}
          onBookmark={handleBookmark}
        />
      )}
    </div>
  )
}
