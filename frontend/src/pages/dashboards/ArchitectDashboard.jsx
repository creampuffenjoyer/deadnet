import { Fragment, useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { usePlatformTerms } from '../../hooks/usePlatformTerms'
import UpdateScreen from '../../components/ui/UpdateScreen'
import GoingMaintenanceScreen from '../../components/ui/GoingMaintenanceScreen'
import client from '../../api/client'
import ArchitectTopbar from '../../components/architect/ArchitectTopbar'
import ArchitectSidebar from '../../components/architect/ArchitectSidebar'

// ---------------------------------------------------------------------------
// Logo processor — runs client-side before upload
//   1. Center-square crop
//   2. Flood-fill white background removal from all four corners
//   Returns a PNG Blob ready to upload.
// ---------------------------------------------------------------------------
function processLogoImage(file, targetSize = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)

      // ── Step 1: center-square crop onto canvas ──
      const canvas = document.createElement('canvas')
      canvas.width = targetSize
      canvas.height = targetSize
      const ctx = canvas.getContext('2d', { willReadFrequently: true })

      const srcSize = Math.min(img.width, img.height)
      const sx = (img.width  - srcSize) / 2
      const sy = (img.height - srcSize) / 2
      ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, targetSize, targetSize)

      // ── Step 2: flood-fill white removal from all 4 corners ──
      const imageData = ctx.getImageData(0, 0, targetSize, targetSize)
      const data = imageData.data
      const W = targetSize

      function isNearWhite(idx) {
        return data[idx] > 230 && data[idx + 1] > 230 && data[idx + 2] > 230 && data[idx + 3] > 10
      }
      function makeTransparent(idx) { data[idx + 3] = 0 }

      // BFS flood fill starting from corners
      const visited = new Uint8Array(W * W)
      const queue = [0, W - 1, W * (W - 1), W * W - 1]  // corner pixel indices (as pixel #, not byte idx)
      queue.forEach(p => { visited[p] = 1 })

      let head = 0
      while (head < queue.length) {
        const p = queue[head++]
        const idx = p * 4
        if (!isNearWhite(idx)) continue
        makeTransparent(idx)

        const x = p % W, y = Math.floor(p / W)
        const neighbors = []
        if (x > 0)     neighbors.push(p - 1)
        if (x < W - 1) neighbors.push(p + 1)
        if (y > 0)     neighbors.push(p - W)
        if (y < W - 1) neighbors.push(p + W)
        for (const n of neighbors) {
          if (!visited[n]) { visited[n] = 1; queue.push(n) }
        }
      }

      ctx.putImageData(imageData, 0, 0)
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
    img.src = url
  })
}

// ---------------------------------------------------------------------------
// Logo upload helper — uses fetch so the browser sets multipart boundary
// (axios instance default Content-Type: application/json breaks FormData)
// ---------------------------------------------------------------------------
async function uploadLogo(orgId, file) {
  const fd = new FormData()
  fd.append('file', file)
  const token = localStorage.getItem('deadnet_access_token')
  const base = import.meta.env.VITE_API_URL || 'http://localhost:8000'
  const res = await fetch(`${base}/organizations/${orgId}/logo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  return res.json()
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function fmtDate(v) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDateTime(v) {
  if (!v) return '—'
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Role sort order for operator lists — module-level so all tabs share it
const _ROLE_SORT_ORDER = { ARCHITECT: 0, ADMIN: 1, CONTRACTOR: 2, HANDLER: 3, OPERATIVE: 4 }

function _roleLabel(role, terms) {
  if (role === 'OPERATIVE')  return terms.operator.toUpperCase()
  if (role === 'HANDLER')    return terms.handler.toUpperCase()
  if (role === 'CONTRACTOR') return terms.contractor.toUpperCase()
  return role
}

// Tab order (7 tabs — CHANGE LOGS + ARCHITECT LOG merged into LOGS)
const ARCH_TABS = [
  ['overview',      'OVERVIEW'],
  ['organizations', 'ORGANIZATIONS'],
  ['operators',     'OPERATORS'],
  ['events',        'EVENTS'],
  ['void',          'V01D'],
  ['logs',          'LOGS'],
  ['settings',      'SETTINGS'],
]

// Workspace sub-tabs for the scoped org view
const WORKSPACE_TABS = [
  ['overview',     'OVERVIEW'],
  ['operators',    'OPERATORS'],
  ['teams',        'TEAMS'],
  ['comms',        'COMMS'],
  ['settings',     'SETTINGS'],
]

// ---------------------------------------------------------------------------
// Competition Control Panel — shown in Overview
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Elapsed time hook — counts UP from a start ISO timestamp
// ---------------------------------------------------------------------------
function useElapsed(startIso) {
  const [elapsed, setElapsed] = useState('')
  useEffect(() => {
    if (!startIso) { setElapsed('—'); return }
    function calc() {
      const diff = Math.max(0, Math.floor((Date.now() - new Date(startIso)) / 1000))
      const h = Math.floor(diff / 3600)
      const m = Math.floor((diff % 3600) / 60)
      const s = diff % 60
      setElapsed(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`)
    }
    calc()
    const id = setInterval(calc, 1000)
    return () => clearInterval(id)
  }, [startIso])
  return elapsed
}

// ---------------------------------------------------------------------------
// Live countdown hook — ticks every second
// ---------------------------------------------------------------------------
function useCountdown(targetIso) {
  const [parts, setParts] = useState(null)

  useEffect(() => {
    if (!targetIso) { setParts(null); return }

    function calc() {
      const diff = new Date(targetIso) - Date.now()
      if (diff <= 0) { setParts({ d: 0, h: 0, m: 0, s: 0, expired: true }); return }
      const d = Math.floor(diff / 86400000)
      const h = Math.floor((diff % 86400000) / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setParts({ d, h, m, s, expired: false })
    }

    calc()
    const id = setInterval(calc, 1000)
    return () => clearInterval(id)
  }, [targetIso])

  return parts
}

// ---------------------------------------------------------------------------
// Countdown Clock — live wall clock + optional event countdown
// ---------------------------------------------------------------------------
function CountdownClock({ activeEvent, upcomingEvent, isHalted }) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const target = activeEvent?.end_time || upcomingEvent?.start_time || null
  const countdown = useCountdown(target)

  const countdownLabel = activeEvent
    ? (isHalted ? 'HALTED — TIME REMAINING' : 'EVENT ENDS IN')
    : upcomingEvent
    ? 'EVENT STARTS IN'
    : null

  const cdClass = isHalted ? 'text-danger' : activeEvent ? 'text-success' : 'text-flare'

  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="flex flex-col items-center justify-center px-6 py-5 gap-2">
      {/* Live wall clock — always ticking */}
      <span className="font-mono text-[9px] tracking-widest text-ghost">SYSTEM TIME</span>
      <div className="flex items-baseline gap-0.5">
        <span className="font-mono text-5xl font-bold tabular-nums leading-none text-bone">{hh}</span>
        <span className="font-mono text-4xl font-bold text-bone opacity-60 leading-none">:</span>
        <span className="font-mono text-5xl font-bold tabular-nums leading-none text-bone">{mm}</span>
        <span className="font-mono text-4xl font-bold text-bone opacity-60 leading-none">:</span>
        <span className="font-mono text-5xl font-bold tabular-nums leading-none text-ghost/50">{ss}</span>
      </div>
      <span className="font-mono text-[9px] text-ghost/50 tracking-wide">{dateStr}</span>

      {/* Event countdown — only if there's a target */}
      {target && (
        <div className="mt-2 pt-2 border-t border-ghost/15 w-full flex flex-col items-center gap-1.5">
          <span className="font-mono text-[9px] tracking-widest text-ghost">{countdownLabel}</span>
          {countdown && !countdown.expired ? (
            <div className="flex items-baseline gap-0.5">
              {countdown.d > 0 && (
                <>
                  <span className={`font-mono text-xl font-bold tabular-nums ${cdClass}`}>{String(countdown.d).padStart(2, '0')}d</span>
                  <span className={`font-mono text-lg font-bold ${cdClass} opacity-40 mx-0.5`}>:</span>
                </>
              )}
              <span className={`font-mono text-xl font-bold tabular-nums ${cdClass}`}>{String(countdown.h).padStart(2, '0')}</span>
              <span className={`font-mono text-lg font-bold ${cdClass} opacity-40`}>:</span>
              <span className={`font-mono text-xl font-bold tabular-nums ${cdClass}`}>{String(countdown.m).padStart(2, '0')}</span>
              <span className={`font-mono text-lg font-bold ${cdClass} opacity-40`}>:</span>
              <span className={`font-mono text-xl font-bold tabular-nums ${cdClass}`}>{String(countdown.s).padStart(2, '0')}</span>
            </div>
          ) : (
            <span className={`font-mono text-sm font-bold tracking-widest ${cdClass}`}>TIME EXPIRED</span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// OVERVIEW TAB
// ---------------------------------------------------------------------------
function OverviewTab({ onOpen, searchQuery = '' }) {
  const navigate = useNavigate()

  // Overview + logs data
  const [data, setData]             = useState(null)
  const [recentLogs, setRecentLogs] = useState([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [feedRefreshedAt, setFeedRefreshedAt] = useState(null)
  const [feedPulse, setFeedPulse] = useState(false)

  // Competition control state
  const [activeEvent, setActiveEvent]             = useState(null)
  const [upcomingEvent, setUpcomingEvent]         = useState(null)
  const [competitionActive, setCompetitionActive] = useState(null)
  const [haltedBy, setHaltedBy]                   = useState(null)
  const [busy, setBusy]                           = useState(false)
  const [actionMsg, setActionMsg]                 = useState('')
  const [liveBoard, setLiveBoard]                 = useState(null)
  const [now, setNow]                             = useState(new Date())

  const isHalted = competitionActive === 'false'
  const elapsed  = useElapsed(activeEvent?.start_time || null)
  const countdown = useCountdown(activeEvent?.end_time || upcomingEvent?.start_time || null)

  async function load() {
    try {
      const [overviewRes, logsRes, evRes, setRes] = await Promise.all([
        client.get('/architect/overview'),
        client.get('/architect/log'),
        client.get('/events'),
        client.get('/public/settings'),
      ])
      setData(overviewRes.data)
      setRecentLogs((logsRes.data || []).slice(0, 24))
      setFeedRefreshedAt(new Date())
      const events = evRes.data || []
      setActiveEvent(events.find(e => e.status === 'ACTIVE') || null)
      setUpcomingEvent(events.find(e => e.status === 'UPCOMING') || null)
      setCompetitionActive(setRes.data?.competition_active ?? null)
      setHaltedBy(setRes.data?.competition_halted_by || null)
    } catch { /* ignore */ }
  }

  async function loadFeed() {
    try {
      const r = await client.get('/architect/log')
      setRecentLogs((r.data || []).slice(0, 24))
      setFeedRefreshedAt(new Date())
      setFeedPulse(true)
      setTimeout(() => setFeedPulse(false), 600)
    } catch { /* ignore */ }
  }

  async function loadLive() {
    try {
      const r = await client.get('/bounty-board/operatives')
      const board = r.data?.board || []
      setLiveBoard({
        participants: board.length,
        topOp: board[0] || null,
        top5: board.slice(0, 5),
        totalSolves: board.reduce((s, op) => s + (op.solve_count ?? 0), 0),
        maxBc: board[0]?.bc_total || 1,
      })
    } catch { /* ignore */ }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { const id = setInterval(loadFeed, 15000); return () => clearInterval(id) }, [])
  useEffect(() => { loadLive(); const id = setInterval(loadLive, 30000); return () => clearInterval(id) }, [])
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])

  async function act(action, eventId) {
    setBusy(true); setActionMsg('')
    try {
      await client.post(`/events/${eventId}/${action}`)
      try { const mod = await import('../../hooks/usePlatformFormat'); mod.clearPlatformCache?.() } catch { /* ignore */ }
      setActionMsg(action === 'halt' ? 'Competition halted.' : action === 'resume' ? 'Competition resumed.' : 'Event started.')
      await load()
    } catch (e) {
      setActionMsg(e?.response?.data?.detail || `Failed to ${action}.`)
    } finally {
      setBusy(false)
      setTimeout(() => setActionMsg(''), 4000)
    }
  }

  async function forceResume() {
    setBusy(true); setActionMsg('')
    try {
      await client.post('/admin/competition/force-resume')
      try { const mod = await import('../../hooks/usePlatformFormat'); mod.clearPlatformCache?.() } catch { /* ignore */ }
      setActionMsg('Competition state cleared.')
      await load()
    } catch (e) {
      setActionMsg(e?.response?.data?.detail || 'Force resume failed.')
    } finally {
      setBusy(false)
      setTimeout(() => setActionMsg(''), 5000)
    }
  }

  // Activity feed color by log action
  function feedColor(action = '') {
    if (action.startsWith('EVENT'))    return '#f97316'  // ember — MAJOR_EVENT
    if (action.startsWith('USER'))     return '#3b82f6'  // blue  — OPERATOR
    if (action.startsWith('SECURITY')) return '#dc2626'  // red   — SECURITY
    if (action.startsWith('CONTRACT')) return '#f97316'  // ember — CONTRACT
    if (action.startsWith('SETTINGS')) return '#e5e5e5'  // white — SYSTEM
    return '#888888'
  }

  function feedTag(action = '') {
    if (action.startsWith('EVENT'))    return 'MAJOR_EVENT'
    if (action.startsWith('USER'))     return 'OPERATOR'
    if (action.startsWith('SECURITY')) return 'SECURITY'
    if (action.startsWith('CONTRACT')) return 'CONTRACT'
    if (action.startsWith('SETTINGS')) return 'SYSTEM'
    return 'SYSTEM'
  }

  function fmtAgo(iso) {
    if (!iso) return '—'
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
    if (diff < 60)   return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }

  function fmtCountdown(c) {
    if (!c) return '—'
    if (c.expired) return 'EXPIRED'
    const parts = []
    if (c.d > 0) parts.push(`${c.d}d`)
    parts.push(String(c.h).padStart(2,'0'))
    parts.push(String(c.m).padStart(2,'0'))
    parts.push(String(c.s).padStart(2,'0'))
    return parts.join(':')
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 pt-8">
        <span className="font-mono text-xs tracking-widest animate-pulse" style={{ color: '#f97316' }}>
          LOADING TERMINAL DATA...
        </span>
      </div>
    )
  }

  const liveParticipants = data.organizations.reduce((s, u) => s + (u.active_event?.participant_count ?? 0), 0)
  const inactiveOrgs     = data.organizations.filter(u => !u.is_active).length
  const platformStatus   = isHalted ? 'HALTED' : activeEvent ? 'STABLE_ENCRYPTED' : 'STANDBY'

  const q = searchQuery.trim().toLowerCase()
  const visibleOrgs = q
    ? data.organizations.filter(u =>
        u.name?.toLowerCase().includes(q) ||
        u.org_code?.toLowerCase().includes(q)
      )
    : data.organizations
  const visibleLogs = q
    ? recentLogs.filter(l =>
        l.action?.toLowerCase().includes(q) ||
        l.target?.toLowerCase().includes(q) ||
        l.performed_by?.toLowerCase().includes(q) ||
        l.org_code?.toLowerCase().includes(q) ||
        l.org_name?.toLowerCase().includes(q)
      )
    : recentLogs

  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })

  // Font shorthands — used throughout this tab
  const G = 'Geist, sans-serif'
  const M = 'JetBrains Mono, monospace'

  return (
    <div className="space-y-0 -m-8">

      {/* ── D1: STAT BAR ── */}
      <div
        className="flex items-stretch"
        style={{ height: '64px', background: '#111111', borderBottom: '1px solid #1f1f1f' }}
      >
        {[
          { label: 'Organizations',  value: data.stats.total_organizations,
            sub: inactiveOrgs > 0 ? `${inactiveOrgs} inactive` : 'All active',
            subColor: inactiveOrgs > 0 ? '#dc2626' : '#22c55e', dest: '?tab=organizations' },
          { label: 'Operators',      value: data.stats.total_users,
            sub: `${liveParticipants} online`,
            subColor: liveParticipants > 0 ? '#f97316' : '#555555', dest: '?tab=operators' },
          { label: 'Active Events',  value: data.stats.active_events,
            sub: activeEvent ? '1 live' : 'None live',
            subColor: activeEvent ? '#22c55e' : '#555555', dest: '?tab=events' },
          { label: 'Total Solves',   value: liveBoard?.totalSolves ?? '—',
            sub: 'This season', subColor: '#555555', dest: '/bounty-board' },
        ].map((stat, i, arr) => (
          <button
            key={stat.label}
            onClick={() => navigate(stat.dest)}
            className="arch-stat-btn flex-1 flex flex-col justify-center px-6 text-left"
            style={{ borderRight: i < arr.length - 1 ? '1px solid #1f1f1f' : 'none', background: 'transparent' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#161616' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <div className="flex items-baseline gap-2">
              {/* Number — mono, data */}
              <span style={{ fontFamily: M, fontSize: '22px', fontWeight: 700, color: '#e5e5e5', fontVariantNumeric: 'tabular-nums' }}>
                {stat.value}
              </span>
              {/* Sub-label — geist, UI */}
              <span style={{ fontFamily: G, fontSize: '11px', fontWeight: 500, color: stat.subColor }}>
                · {stat.sub}
              </span>
            </div>
            {/* Label — geist, muted */}
            <span style={{ fontFamily: G, fontSize: '11px', fontWeight: 400, color: '#444444', marginTop: '2px' }}>
              {stat.label}
            </span>
          </button>
        ))}
      </div>

      {/* ── D2: MAIN CONTENT GRID ── */}
      <div className="flex gap-4 p-6 items-stretch">

        {/* LEFT COLUMN — 65% */}
        <div className="flex flex-col gap-4" style={{ flex: '0 0 65%', minWidth: 0, minHeight: 0 }}>

          {/* Active Event Panel */}
          <div
            className={`arch-card overflow-hidden${activeEvent && !isHalted ? ' arch-event-live' : ''}`}
            style={{
              background: '#111111',
              border: '1px solid #1f1f1f',
              borderLeft: activeEvent && !isHalted ? '3px solid #f97316'
                : isHalted ? '3px solid #dc2626' : '3px solid #1f1f1f',
            }}
          >
            {/* Card top row — event name (mono, identity) + status badge (geist) */}
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <h2 style={{ fontFamily: M, fontSize: '20px', fontWeight: 700, letterSpacing: '0.06em', color: '#f97316' }}>
                {activeEvent ? activeEvent.name.toUpperCase()
                  : upcomingEvent ? upcomingEvent.name.toUpperCase()
                  : 'NO ACTIVE OPERATION'}
              </h2>
              {activeEvent && !isHalted && (
                <div className="flex items-center gap-1.5" style={{ fontFamily: G, fontSize: '11px', fontWeight: 600, color: '#22c55e' }}>
                  <span className="arch-live-dot">●</span>
                  Live Broadcast
                </div>
              )}
              {isHalted && (
                <div className="flex items-center gap-1.5" style={{ fontFamily: G, fontSize: '11px', fontWeight: 600, color: '#dc2626' }}>
                  <span className="arch-live-dot">●</span>
                  Halted
                </div>
              )}
              {!activeEvent && upcomingEvent && (
                <span style={{ fontFamily: G, fontSize: '11px', fontWeight: 500, color: '#f97316' }}>◌ Upcoming</span>
              )}
              {!activeEvent && !upcomingEvent && (
                <span style={{ fontFamily: G, fontSize: '11px', color: '#333333' }}>No event</span>
              )}
            </div>

            {activeEvent || upcomingEvent ? (
              <div className="px-5 pb-5 space-y-4">
                {/* 3×2 telemetry grid — label=geist, value=mono */}
                <div className="grid grid-cols-3 gap-2 pt-2">
                  {[
                    ['Top Operative',   liveBoard?.topOp?.username || '—',  liveBoard?.topOp ? '#f97316' : '#333333'],
                    [activeEvent ? 'Elapsed Time' : 'Starts In',
                      activeEvent ? elapsed : fmtCountdown(countdown), '#e5e5e5'],
                    ['System Time',    `${hh}:${mm}:${ss}`, '#e5e5e5'],
                    ['Total Solves',   liveBoard?.totalSolves ?? '—', liveBoard?.totalSolves > 0 ? '#e5e5e5' : '#333333'],
                    ['Platform Status', platformStatus, isHalted ? '#dc2626' : activeEvent ? '#22c55e' : '#555555'],
                    [activeEvent?.end_time ? 'Event Ends In' : 'Standby Clock',
                      countdown && !countdown.expired && activeEvent?.end_time ? fmtCountdown(countdown) : dateStr, '#555555'],
                  ].map(([lbl, val, color]) => (
                    <div key={lbl} className="px-3 py-2.5" style={{ background: '#0d0d0d', border: '1px solid #1f1f1f' }}>
                      <p style={{ fontFamily: G, fontSize: '10px', fontWeight: 500, color: '#444444', marginBottom: '4px' }}>{lbl}</p>
                      <p style={{ fontFamily: M, fontSize: '13px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{val}</p>
                    </div>
                  ))}
                </div>

                {/* Halted by notice */}
                {isHalted && haltedBy && (
                  <p style={{ fontFamily: G, fontSize: '12px', color: '#555555' }}>
                    Halted by: <span style={{ color: '#e5e5e5', fontWeight: 500 }}>{haltedBy}</span>
                  </p>
                )}

                {/* Contract progress bar */}
                {liveBoard && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span style={{ fontFamily: G, fontSize: '11px', fontWeight: 500, color: '#444444' }}>Contracts Solved</span>
                      <span style={{ fontFamily: M, fontSize: '11px', color: '#e5e5e5', fontVariantNumeric: 'tabular-nums' }}>
                        {liveBoard.totalSolves} solves
                      </span>
                    </div>
                    <div className="h-1.5 w-full" style={{ background: '#1f1f1f' }}>
                      <div
                        className="h-full transition-all duration-500"
                        style={{
                          background: '#f97316',
                          width: `${Math.min(100, (liveBoard.participants > 0 ? (liveBoard.totalSolves / Math.max(liveBoard.participants * 3, 1)) * 100 : 0))}%`,
                          boxShadow: '0 0 6px rgba(249,115,22,0.5)',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Recent solves feed */}
                {recentLogs.length > 0 && (() => {
                  const solveLogs = recentLogs.filter(l => l.action?.startsWith('CONTRACT') || l.action?.startsWith('EVENT')).slice(0, 3)
                  if (!solveLogs.length) return null
                  return (
                    <div className="space-y-1.5 pt-1">
                      <p style={{ fontFamily: G, fontSize: '10px', fontWeight: 600, color: '#444444', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Recent Solves</p>
                      {solveLogs.map(l => (
                        <div key={l.id} className="flex items-center gap-2" style={{ fontFamily: M, fontSize: '11px' }}>
                          <span style={{ color: '#555555' }}>›</span>
                          <span style={{ color: '#f97316' }}>{l.performed_by || l.target || '—'}</span>
                          <span style={{ color: '#555555' }} className="truncate flex-1">{l.target || l.action}</span>
                          <span style={{ color: '#333333' }} className="shrink-0">{fmtAgo(l.timestamp)}</span>
                        </div>
                      ))}
                    </div>
                  )
                })()}

                {/* Action message */}
                {actionMsg && (
                  <p className="px-3 py-1.5" style={{
                    fontFamily: G, fontSize: '12px',
                    background: actionMsg.includes('ailed') ? 'rgba(220,38,38,0.1)' : 'rgba(34,197,94,0.1)',
                    color: actionMsg.includes('ailed') ? '#dc2626' : '#22c55e',
                    border: `1px solid ${actionMsg.includes('ailed') ? 'rgba(220,38,38,0.2)' : 'rgba(34,197,94,0.2)'}`,
                  }}>
                    {actionMsg}
                  </p>
                )}

                {/* CTA buttons — mono bracketed */}
                <div className="flex gap-2 flex-wrap pt-1">
                  {activeEvent && (
                    <a href="/bounty-board" target="_blank" rel="noopener noreferrer"
                      className="px-4 py-2 transition-colors"
                      style={{ fontFamily: M, fontSize: '11px', fontWeight: 700, border: '1px solid rgba(34,197,94,0.5)', color: '#22c55e', background: 'transparent' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.08)'; e.currentTarget.style.borderColor = '#22c55e' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(34,197,94,0.5)' }}>
                      [ View Live Event ]
                    </a>
                  )}
                  {activeEvent && isHalted && (
                    <button onClick={() => act('resume', activeEvent.id)} disabled={busy}
                      className="px-4 py-2 transition-colors disabled:opacity-40"
                      style={{ fontFamily: M, fontSize: '11px', fontWeight: 700, border: '1px solid rgba(34,197,94,0.5)', color: '#22c55e', background: 'transparent' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.08)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      {busy ? '...' : '[ Resume Hacking ]'}
                    </button>
                  )}
                  {isHalted && !activeEvent && (
                    <button onClick={() => { if (window.confirm('Force-clear halted state?')) forceResume() }} disabled={busy}
                      className="px-4 py-2 transition-colors disabled:opacity-40"
                      style={{ fontFamily: M, fontSize: '11px', fontWeight: 700, border: '1px solid rgba(34,197,94,0.5)', color: '#22c55e', background: 'transparent' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.08)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      {busy ? '...' : '[ Resume Operations ]'}
                    </button>
                  )}
                  {activeEvent && !isHalted && (
                    <button
                      onClick={() => { if (window.confirm('Halt competition? All submissions will be locked.')) act('halt', activeEvent.id) }}
                      disabled={busy}
                      className="px-4 py-2 transition-colors disabled:opacity-40"
                      style={{ fontFamily: M, fontSize: '11px', fontWeight: 700, border: '1px solid rgba(220,38,38,0.5)', color: '#dc2626', background: 'transparent' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(220,38,38,0.1)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      {busy ? '...' : '[ Halt Competition ]'}
                    </button>
                  )}
                  {!activeEvent && upcomingEvent && (
                    <button onClick={() => { if (window.confirm(`Start "${upcomingEvent.name}"?`)) act('start', upcomingEvent.id) }} disabled={busy}
                      className="px-4 py-2 transition-colors disabled:opacity-40"
                      style={{ fontFamily: M, fontSize: '11px', fontWeight: 700, border: '1px solid rgba(34,197,94,0.5)', color: '#22c55e', background: 'transparent' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.08)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      {busy ? '...' : `[ Start ${upcomingEvent.name} ]`}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* No active or upcoming event */
              <div className="px-5 pb-5 pt-3 space-y-3">
                <p style={{ fontFamily: M, fontSize: '11px', color: '#333333', letterSpacing: '0.08em' }}>// NO ACTIVE OPERATION</p>
                <p style={{ fontFamily: G, fontSize: '12px', color: '#2a2a2a', lineHeight: '1.6' }}>
                  No event is live or scheduled. Create or activate an event to begin monitoring competition state.
                </p>
                {actionMsg && (
                  <p className="px-3 py-1.5" style={{
                    fontFamily: G, fontSize: '12px',
                    background: 'rgba(220,38,38,0.1)', color: '#dc2626',
                    border: '1px solid rgba(220,38,38,0.2)',
                  }}>{actionMsg}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => navigate('?tab=events')}
                    className="px-4 py-2 transition-colors"
                    style={{ fontFamily: M, fontSize: '11px', fontWeight: 700, border: '1px solid rgba(249,115,22,0.4)', color: '#f97316', background: 'transparent' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.08)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                    [ + Create Event ]
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Org status list — compact, scannable */}
          <div className="arch-card flex flex-col" style={{ flex: '1', minHeight: 0, background: '#111111', border: '1px solid #1f1f1f', overflow: 'hidden' }}>
            <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '1px solid #1f1f1f' }}>
              <span style={{ fontFamily: G, fontSize: '11px', fontWeight: 600, color: '#444444', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Organizations · {visibleOrgs.length}{q ? ` / ${data.organizations.length}` : ''}
              </span>
              <button
                onClick={() => navigate('?tab=organizations')}
                style={{ fontFamily: G, fontSize: '11px', fontWeight: 500, color: '#555555', background: 'transparent', border: 'none', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#f97316' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#555555' }}>
                Manage ›
              </button>
            </div>
            {data.organizations.length === 0 ? (
              <p className="px-5 py-6" style={{ fontFamily: G, fontSize: '12px', color: '#333333' }}>
                No organizations registered.
              </p>
            ) : visibleOrgs.length === 0 ? (
              <p className="px-5 py-4" style={{ fontFamily: G, fontSize: '12px', color: '#333333' }}>
                No organizations match <span style={{ color: '#555555' }}>"{searchQuery}"</span>
              </p>
            ) : (
              <div className="arch-scroll flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
                {visibleOrgs.map(u => {
                  const isLive   = !!u.active_event
                  const isActive = u.is_active
                  const dotColor = isLive ? '#00FF88' : isActive ? '#3a3a3a' : '#dc2626'
                  const dotLabel = isLive ? 'LIVE' : isActive ? 'IDLE' : 'OFF'
                  return (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 px-4 py-2 transition-colors"
                      style={{
                        borderBottom: '1px solid #0d0d0d',
                        borderLeft: isLive ? '2px solid #00FF88' : '2px solid transparent',
                        cursor: 'pointer',
                      }}
                      onClick={() => onOpen(u)}
                      onMouseEnter={e => { e.currentTarget.style.background = '#161616' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <OrgLogo org={u} size={20} />
                      {/* Identity */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span style={{ fontFamily: M, fontSize: '12px', fontWeight: 700, color: '#e5e5e5' }} className="truncate">
                            {u.org_code || u.name}
                          </span>
                          <span className={isLive ? 'arch-live-dot' : ''} style={{ fontFamily: M, fontSize: '9px', color: dotColor, flexShrink: 0 }}>
                            {dotLabel}
                          </span>
                        </div>
                        {isLive && (
                          <p style={{ fontFamily: G, fontSize: '10px', color: '#555555', marginTop: '1px' }} className="truncate">
                            {u.active_event.name}
                          </p>
                        )}
                      </div>
                      {/* Operator count */}
                      <span style={{ fontFamily: M, fontSize: '11px', color: '#333333', flexShrink: 0 }}>
                        {u.user_count} ops
                      </span>
                      {/* Open */}
                      <button
                        onClick={e => { e.stopPropagation(); onOpen(u) }}
                        style={{ fontFamily: M, fontSize: '10px', color: '#444444', background: 'transparent', border: '1px solid #2a2a2a', padding: '2px 7px', flexShrink: 0, cursor: 'pointer' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#f97316'; e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#444444'; e.currentTarget.style.borderColor = '#2a2a2a' }}>
                        [ › ]
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN — 35% */}
        <div className="flex flex-col gap-4" style={{ flex: '0 0 35%', minWidth: 0 }}>

          {/* Live Standings */}
          <div className="arch-card flex flex-col" style={{ flex: '1', background: '#111111', border: '1px solid #1f1f1f', minHeight: 0 }}>
            <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid #1f1f1f' }}>
              <div className="flex items-center gap-2">
                <span style={{ fontFamily: G, fontSize: '11px', fontWeight: 600, color: '#444444', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Live Standings</span>
                {activeEvent && (
                  <span style={{ fontFamily: M, fontSize: '9px', background: '#1f1f1f', color: '#888888', padding: '2px 6px' }}>
                    {activeEvent.name.slice(0, 16)}
                  </span>
                )}
              </div>
              <button
                onClick={() => navigate('/bounty-board')}
                style={{ fontFamily: G, fontSize: '11px', fontWeight: 500, color: '#555555' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#f97316' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#555555' }}>
                Full board ›
              </button>
            </div>

            {liveBoard?.top5?.length > 0 ? (
              <div className="px-4 py-3 space-y-2">
                {liveBoard.top5.map((op, i) => {
                  const pct = Math.round((op.bc_total / liveBoard.maxBc) * 100)
                  return (
                    <div key={op.username} className="space-y-1">
                      <div className="flex items-center gap-2">
                        {/* Rank — mono */}
                        <span style={{ fontFamily: M, fontSize: '11px', fontVariantNumeric: 'tabular-nums', width: '12px', flexShrink: 0, color: i === 0 ? '#f97316' : '#555555' }}>
                          {i + 1}
                        </span>
                        {/* Username — mono, identity */}
                        <span style={{ fontFamily: M, fontSize: '12px', fontWeight: 700, flex: 1, color: i === 0 ? '#f97316' : '#e5e5e5' }} className="truncate">
                          {op.username}
                        </span>
                        {/* Org code pill — geist */}
                        {op.org_code && (
                          <span style={{ fontFamily: G, fontSize: '10px', fontWeight: 500, background: '#1f1f1f', color: '#888888', padding: '1px 5px', flexShrink: 0 }}>
                            {op.org_code}
                          </span>
                        )}
                        {/* BC — mono, data */}
                        <span style={{ fontFamily: M, fontSize: '11px', fontVariantNumeric: 'tabular-nums', color: '#888888', flexShrink: 0 }}>
                          {op.bc_total} BC
                        </span>
                      </div>
                      <div className="h-0.5 w-full" style={{ background: '#1f1f1f' }}>
                        <div className="h-full" style={{ width: `${pct}%`, background: i === 0 ? '#f97316' : '#2a2a2a', transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 py-6">
                <p style={{ fontFamily: M, fontSize: '11px', color: '#2a2a2a', letterSpacing: '0.08em' }}>// STANDBY</p>
                <p style={{ fontFamily: G, fontSize: '11px', color: '#222222', textAlign: 'center', lineHeight: '1.6' }}>
                  Standings populate<br/>when a competition is live.
                </p>
                <button
                  onClick={() => navigate('?tab=events')}
                  className="mt-2 px-3 py-1.5 transition-colors"
                  style={{ fontFamily: M, fontSize: '10px', fontWeight: 700, border: '1px solid #2a2a2a', color: '#444444', background: 'transparent', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)'; e.currentTarget.style.color = '#f97316' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#444444' }}>
                  [ → Events ]
                </button>
              </div>
            )}
          </div>

          {/* Activity Feed */}
          <div className="arch-card flex flex-col" style={{ flex: '1', background: '#111111', border: `1px solid ${feedPulse ? 'rgba(249,115,22,0.35)' : '#1f1f1f'}`, minHeight: 0, transition: 'border-color 0.4s' }}>
            <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid #1f1f1f' }}>
              <div className="flex items-center gap-2">
                <span style={{ fontFamily: G, fontSize: '11px', fontWeight: 600, color: '#444444', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Activity Feed</span>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: feedPulse ? '#f97316' : '#2a2a2a', display: 'inline-block', transition: 'background 0.3s' }} />
                {feedRefreshedAt && (
                  <span style={{ fontFamily: M, fontSize: '9px', color: '#2e2e2e' }}>
                    {fmtAgo(feedRefreshedAt)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadFeed}
                  style={{ fontFamily: G, fontSize: '10px', fontWeight: 500, color: '#555555', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f97316' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#555555' }}
                  title="Refresh feed"
                >↺</button>
                <button
                  onClick={() => setAutoScroll(v => !v)}
                  className="flex items-center gap-1.5 px-2 py-1 transition-colors"
                  style={{
                    fontFamily: G, fontSize: '10px', fontWeight: 500,
                    background: autoScroll ? 'rgba(249,115,22,0.12)' : '#161616',
                    border: `1px solid ${autoScroll ? 'rgba(249,115,22,0.3)' : '#1f1f1f'}`,
                    color: autoScroll ? '#f97316' : '#555555',
                  }}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: autoScroll ? '#f97316' : '#555555', display: 'inline-block' }} />
                  Auto
                </button>
              </div>
            </div>

            <div className="arch-scroll flex-1 overflow-y-auto px-4 py-2" ref={el => { if (el && autoScroll) el.scrollTop = 0 }}>
              {recentLogs.length === 0 ? (
                <p className="py-4" style={{ fontFamily: G, fontSize: '12px', color: '#333333' }}>No activity recorded.</p>
              ) : visibleLogs.length === 0 ? (
                <p className="py-4" style={{ fontFamily: G, fontSize: '12px', color: '#333333' }}>No logs match <span style={{ color: '#555555' }}>"{searchQuery}"</span></p>
              ) : (
                visibleLogs.map(l => {
                  const color = feedColor(l.action)
                  const tag   = feedTag(l.action)
                  return (
                    <div
                      key={l.id}
                      className="arch-feed-entry flex items-start gap-2 py-1.5"
                      style={{ borderBottom: '1px solid #0d0d0d' }}
                    >
                      {/* Tag pill — geist */}
                      <span className="shrink-0 px-1.5 py-0.5" style={{ fontFamily: G, fontSize: '9px', fontWeight: 600, color, background: `${color}18`, border: `1px solid ${color}30` }}>
                        {tag}
                      </span>
                      {l.org_code && (
                        <span className="shrink-0 px-1 py-0.5" style={{ fontFamily: G, fontSize: '8px', fontWeight: 500, background: '#161616', color: '#555555', border: '1px solid #1f1f1f' }}>
                          {l.org_code}
                        </span>
                      )}
                      {/* Description — mono, data */}
                      <span className="flex-1 truncate" style={{ fontFamily: M, fontSize: '11px', color: '#666666' }}>
                        {l.target || l.performed_by || l.action}
                      </span>
                      {/* Timestamp — mono, data */}
                      <span className="shrink-0" style={{ fontFamily: M, fontSize: '10px', color: '#2e2e2e' }}>{fmtAgo(l.timestamp)}</span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EVENTS TAB (global — all organizations)
// ---------------------------------------------------------------------------
const _EV_STATUS_COLOR  = { ACTIVE: '#00FF88', UPCOMING: '#4A9EFF', CLOSED: '#6B6B80' }
const _EV_STATUS_LABEL  = { ACTIVE: '● ACTIVE', UPCOMING: '◌ UPCOMING', CLOSED: '— CLOSED' }
const _EV_TYPE_COLOR    = { MAJOR: '#FF4500', LOCAL: '#6B6B80' }

function EventsTab({ defaultOpenEventId = null }) {
  const [events, setEvents]         = useState([])
  const [organizations, setOrgs]    = useState([])
  const [loading, setLoading]       = useState(true)
  const [orgFilter, setOrgFilter]   = useState(null)
  const [statusFilter, setStatus]   = useState('ALL')
  // Modal state
  const [modalEvent, setModalEvent]   = useState(null)   // event object being viewed
  const [modalDetail, setModalDetail] = useState(null)   // MAJOR detail (lazy)
  const [modalLoading, setModalLoading] = useState(false)

  const M = 'JetBrains Mono, monospace'
  const G = 'Geist, sans-serif'

  async function load() {
    setLoading(true)
    try {
      const [evR, unR] = await Promise.all([
        client.get('/events'),
        client.get('/organizations'),
      ])
      setEvents(evR.data || [])
      setOrgs(unR.data || [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const univMap = Object.fromEntries(organizations.map(u => [u.id, u]))

  // Open modal — lazy-fetch MAJOR details
  async function openModal(ev) {
    setModalEvent(ev)
    setModalDetail(null)
    if (ev.event_type === 'MAJOR') {
      setModalLoading(true)
      try {
        const r = await client.get(`/events/${ev.id}/major`)
        setModalDetail(r.data)
      } catch { /* ignore */ }
      finally { setModalLoading(false) }
    }
  }

  // Auto-open event from global search — runs after events load
  useEffect(() => {
    if (!defaultOpenEventId || events.length === 0) return
    if (modalEvent?.id === defaultOpenEventId) return
    const ev = events.find(e => e.id === defaultOpenEventId)
    if (ev) openModal(ev)
  }, [defaultOpenEventId, events])

  function closeModal() { setModalEvent(null); setModalDetail(null) }

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const _ORDER = { ACTIVE: 0, UPCOMING: 1, CLOSED: 2 }

  const filtered = events
    .filter(e => !orgFilter || (e.host_org_id || e.org_id) === orgFilter)
    .filter(e => statusFilter === 'ALL' || e.status === statusFilter)
    .sort((a, b) => (_ORDER[a.status] ?? 9) - (_ORDER[b.status] ?? 9))

  function fmtDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  function fmtDateShort(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const STATUS_TABS = ['ALL', 'ACTIVE', 'UPCOMING', 'CLOSED']

  // ── Modal component (rendered inline) ────────────────────────────────────────
  function EventModal({ ev }) {
    const isMajor   = ev.event_type === 'MAJOR'
    const sc        = _EV_STATUS_COLOR[ev.status] || '#6B6B80'
    const hostOrgId = ev.host_org_id || ev.org_id
    const hostOrg   = univMap[hostOrgId]
    const detail    = modalDetail

    return (
      // Overlay
      <div
        onClick={closeModal}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '24px',
        }}
      >
        {/* Modal container — stop propagation so clicks inside don't close */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: '960px',
            maxHeight: '90vh',
            display: 'flex', flexDirection: 'column',
            background: '#0d0d0d',
            border: `1px solid ${sc}40`,
            borderTop: `3px solid ${sc}`,
          }}
        >
          {/* ── Modal header ── */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            padding: '18px 20px 14px',
            borderBottom: '1px solid rgba(107,107,128,0.15)',
            flexShrink: 0,
          }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontFamily: M, fontSize: '18px', fontWeight: 'bold', color: '#F0F0F0', margin: 0, letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ev.name}
              </p>
              {/* Sub-header badges */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' }}>
                <span style={{ fontFamily: M, fontSize: '9px', color: sc, border: `1px solid ${sc}50`, padding: '2px 8px', letterSpacing: '0.06em' }}>
                  {_EV_STATUS_LABEL[ev.status] || ev.status}
                </span>
                {hostOrg && (
                  <span style={{ fontFamily: M, fontSize: '9px', color: '#FF4500', border: '1px solid rgba(255,69,0,0.35)', padding: '2px 8px' }}>
                    HOST · {hostOrg.org_code || hostOrg.name}
                  </span>
                )}
                <span style={{
                  fontFamily: M, fontSize: '9px', padding: '2px 8px',
                  color: isMajor ? '#FF6B00' : '#6B6B80',
                  border: `1px solid ${isMajor ? 'rgba(255,107,0,0.35)' : 'rgba(107,107,128,0.25)'}`,
                }}>
                  {isMajor ? '★ MAJOR' : 'LOCAL'}
                </span>
                <span style={{ fontFamily: M, fontSize: '9px', color: ev.registration_open ? '#00FF88' : '#555', border: `1px solid ${ev.registration_open ? 'rgba(0,255,136,0.3)' : 'rgba(107,107,128,0.2)'}`, padding: '2px 8px' }}>
                  REG {ev.registration_open ? 'OPEN' : 'CLOSED'}
                </span>
                {(ev.start_time || ev.end_time) && (
                  <span style={{ fontFamily: M, fontSize: '9px', color: '#555' }}>
                    {fmtDate(ev.start_time)}{ev.end_time ? ` → ${fmtDate(ev.end_time)}` : ''}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={closeModal}
              style={{ fontFamily: M, fontSize: '16px', color: '#555', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 16px', lineHeight: 1, flexShrink: 0 }}
              onMouseEnter={e => { e.currentTarget.style.color = '#F0F0F0' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#555' }}
            >×</button>
          </div>

          {/* ── Stats bar ── */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            borderBottom: '1px solid rgba(107,107,128,0.15)',
            flexShrink: 0,
          }}>
            {[
              ['CONTRACTS', ev.contract_count ?? '—'],
              ['CLAIMS',    ev.claim_count    ?? '—'],
              ['TEAMS',     ev.team_count     ?? '—'],
              ['PLAYERS',   ev.participant_count ?? '—'],
            ].map(([label, val], i, arr) => (
              <div key={label} style={{
                padding: '12px 16px', textAlign: 'center',
                borderRight: i < arr.length - 1 ? '1px solid rgba(107,107,128,0.15)' : 'none',
              }}>
                <div style={{ fontFamily: M, fontSize: '22px', fontWeight: 'bold', color: '#E0E0E0', lineHeight: 1 }}>{val}</div>
                <div style={{ fontFamily: M, fontSize: '8px', color: '#444', letterSpacing: '0.1em', marginTop: '4px' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* ── Scrollable body ── */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {modalLoading && (
              <p style={{ fontFamily: M, fontSize: '9px', color: '#444', letterSpacing: '0.12em', margin: 0 }}>
                LOADING MAJOR EVENT DATA...
              </p>
            )}

            {/* Description */}
            {ev.description && (
              <section>
                <p style={{ fontFamily: M, fontSize: '9px', color: '#555', letterSpacing: '0.12em', marginBottom: '8px' }}>DESCRIPTION</p>
                <p style={{ fontFamily: G, fontSize: '13px', color: '#888', lineHeight: 1.65, margin: 0 }}>{ev.description}</p>
              </section>
            )}

            {/* MAJOR — Participating Organizations */}
            {isMajor && (
              <section>
                <p style={{ fontFamily: M, fontSize: '9px', color: '#555', letterSpacing: '0.12em', marginBottom: '10px' }}>
                  PARTICIPATING ORGANIZATIONS
                  {detail?.partners && (
                    <span style={{ color: '#444', marginLeft: '8px' }}>
                      — {detail.partners.filter(p => p.status === 'ACTIVE').length} active
                    </span>
                  )}
                </p>
                {!detail && !modalLoading && (
                  <p style={{ fontFamily: M, fontSize: '9px', color: '#444' }}>No partner data available.</p>
                )}
                {detail?.partners && (
                  <div style={{ border: '1px solid rgba(107,107,128,0.15)', overflowX: 'auto', maxHeight: '280px', overflowY: 'auto' }}>
                    {/* Table header */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: '24px minmax(140px,1fr) 80px 80px 90px 130px',
                      padding: '6px 12px', background: '#0a0a0a',
                      borderBottom: '1px solid rgba(107,107,128,0.15)',
                      position: 'sticky', top: 0, zIndex: 1, minWidth: '560px',
                    }}>
                      {['', 'ORGANIZATION', 'PLAYERS', 'STATUS', 'JOINED', 'REG KEY'].map(h => (
                        <span key={h} style={{ fontFamily: M, fontSize: '8px', color: '#444', letterSpacing: '0.08em' }}>{h}</span>
                      ))}
                    </div>
                    {detail.partners.map((p, i) => (
                      <div key={p.org_id} style={{
                        display: 'grid', gridTemplateColumns: '24px minmax(140px,1fr) 80px 80px 90px 130px',
                        padding: '8px 12px', alignItems: 'center',
                        borderBottom: i < detail.partners.length - 1 ? '1px solid rgba(107,107,128,0.08)' : 'none',
                        background: p.is_host ? 'rgba(255,69,0,0.04)' : 'transparent',
                        minWidth: '560px',
                      }}>
                        <span style={{ fontFamily: M, fontSize: '8px', color: p.is_host ? '#FF4500' : '#333' }}>
                          {p.is_host ? '★' : '·'}
                        </span>
                        <span style={{ fontFamily: M, fontSize: '11px', color: p.is_host ? '#FF4500' : '#C0C0C0', fontWeight: p.is_host ? 'bold' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.org_code ? `[${p.org_code}] ` : ''}{p.name}
                        </span>
                        <span style={{ fontFamily: M, fontSize: '11px', color: '#777' }}>{p.participant_count ?? 0}</span>
                        <span style={{
                          fontFamily: M, fontSize: '8px', padding: '2px 6px', display: 'inline-block', width: 'fit-content',
                          color: p.status === 'ACTIVE' ? '#00FF88' : '#555',
                          border: `1px solid ${p.status === 'ACTIVE' ? 'rgba(0,255,136,0.25)' : 'rgba(107,107,128,0.2)'}`,
                        }}>
                          {p.status}
                        </span>
                        <span style={{ fontFamily: M, fontSize: '9px', color: '#444' }}>
                          {p.joined_at ? fmtDate(p.joined_at) : '—'}
                        </span>
                        <span style={{ fontFamily: M, fontSize: '10px', color: '#4A9EFF', letterSpacing: '0.12em' }}>
                          {p.registration_key || '—'}
                        </span>
                      </div>
                    ))}
                    {detail.partners.length === 0 && (
                      <div style={{ padding: '12px', fontFamily: M, fontSize: '9px', color: '#444' }}>No organizations yet.</div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* MAJOR — Borrowed Contractors */}
            {isMajor && detail?.borrowed_contractors?.length > 0 && (
              <section>
                <p style={{ fontFamily: M, fontSize: '9px', color: '#555', letterSpacing: '0.12em', marginBottom: '10px' }}>
                  BORROWED CONTRACTORS ({detail.borrowed_contractors.length})
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {detail.borrowed_contractors.map(c => (
                    <div key={c.contractor_id} style={{
                      padding: '5px 10px', border: '1px solid rgba(255,107,0,0.2)',
                      background: 'rgba(255,107,0,0.04)',
                    }}>
                      <span style={{ fontFamily: M, fontSize: '10px', color: '#FF6B00' }}>{c.callsign}</span>
                      <span style={{ fontFamily: M, fontSize: '9px', color: '#444', marginLeft: '6px' }}>
                        {c.org_code ? `[${c.org_code}]` : c.org_name}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Timing + Config — two columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {/* Timing */}
              <section>
                <p style={{ fontFamily: M, fontSize: '9px', color: '#555', letterSpacing: '0.12em', marginBottom: '10px' }}>TIMING</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[
                    ['CREATED', fmtDate(ev.created_at)],
                    ['STARTS',  fmtDate(ev.start_time)],
                    ['ENDS',    fmtDate(ev.end_time)],
                    ['CLOSED',  fmtDate(ev.closed_at)],
                    ['ARCHIVED', fmtDate(ev.archived_at)],
                  ].filter(([, v]) => v !== '—').map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <span style={{ fontFamily: M, fontSize: '10px', color: '#444' }}>{label}</span>
                      <span style={{ fontFamily: M, fontSize: '10px', color: '#888' }}>{val}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Config */}
              <section>
                <p style={{ fontFamily: M, fontSize: '9px', color: '#555', letterSpacing: '0.12em', marginBottom: '10px' }}>CONFIG</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[
                    ['DECAY MODE',    ev.decay_mode_override || 'PLATFORM DEFAULT'],
                    ['EMAIL DOMAIN',  ev.email_domain_restriction || 'UNRESTRICTED'],
                    ['RESET LEVEL',   ev.reset_level || '—'],
                    ['EXPORT',        ev.export_generated ? 'GENERATED' : 'NOT GENERATED'],
                    ['TOP PLAYER',    ev.top_player || '—'],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <span style={{ fontFamily: M, fontSize: '10px', color: '#444', flexShrink: 0 }}>{label}</span>
                      <span style={{ fontFamily: M, fontSize: '10px', color: '#888', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
                    </div>
                  ))}
                  {ev.allowed_categories?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                      <span style={{ fontFamily: M, fontSize: '9px', color: '#444', flexShrink: 0, marginRight: '4px' }}>CATEGORIES</span>
                      {ev.allowed_categories.map(cat => (
                        <span key={cat} style={{ fontFamily: M, fontSize: '8px', color: '#4A9EFF', border: '1px solid rgba(74,158,255,0.25)', padding: '1px 5px' }}>{cat}</span>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Keys section */}
            {(ev.registration_key || (isMajor && ev.major_event_invite_code)) && (
              <section style={{ paddingTop: '16px', borderTop: '1px solid rgba(107,107,128,0.12)' }}>
                <p style={{ fontFamily: M, fontSize: '9px', color: '#555', letterSpacing: '0.12em', marginBottom: '12px' }}>ACCESS KEYS</p>
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                  {ev.registration_key && (
                    <div>
                      <p style={{ fontFamily: M, fontSize: '8px', color: '#444', letterSpacing: '0.1em', marginBottom: '5px' }}>HOST REG KEY</p>
                      <span style={{ fontFamily: M, fontSize: '16px', color: '#FF4500', letterSpacing: '0.25em', fontWeight: 'bold' }}>{ev.registration_key}</span>
                    </div>
                  )}
                  {isMajor && ev.major_event_invite_code && (
                    <div>
                      <p style={{ fontFamily: M, fontSize: '8px', color: '#444', letterSpacing: '0.1em', marginBottom: '5px' }}>MAJOR INVITE CODE</p>
                      <span style={{ fontFamily: M, fontSize: '16px', color: '#FF6B00', letterSpacing: '0.2em', fontWeight: 'bold' }}>{ev.major_event_invite_code}</span>
                    </div>
                  )}
                </div>
              </section>
            )}

          </div>{/* end scrollable body */}
        </div>{/* end modal container */}
      </div>  // end overlay
    )
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* ── Filter bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '2px' }}>
          {STATUS_TABS.map(s => (
            <button key={s}
              onClick={() => setStatus(s)}
              style={{
                fontFamily: M, fontSize: '9px', letterSpacing: '0.1em',
                padding: '4px 10px', border: '1px solid transparent',
                cursor: 'pointer', transition: 'all 0.15s',
                color: statusFilter === s ? (s === 'ALL' ? '#FF4500' : (_EV_STATUS_COLOR[s] || '#FF4500')) : '#555',
                borderColor: statusFilter === s ? (s === 'ALL' ? 'rgba(255,69,0,0.4)' : `${_EV_STATUS_COLOR[s] || '#FF4500'}40`) : 'transparent',
                background: statusFilter === s ? (s === 'ALL' ? 'rgba(255,69,0,0.06)' : `${_EV_STATUS_COLOR[s] || '#FF4500'}0a`) : 'transparent',
              }}
            >{s === 'ALL' ? 'ALL EVENTS' : _EV_STATUS_LABEL[s] || s}</button>
          ))}
        </div>

        <select
          value={orgFilter ?? ''}
          onChange={e => setOrgFilter(e.target.value ? Number(e.target.value) : null)}
          style={{
            fontFamily: M, fontSize: '10px', background: '#0a0a0a',
            border: '1px solid rgba(107,107,128,0.25)', color: orgFilter ? '#F0F0F0' : '#555',
            padding: '4px 8px', outline: 'none', cursor: 'pointer',
          }}
        >
          <option value="">ALL ORGANIZATIONS</option>
          {organizations.map(u => (
            <option key={u.id} value={u.id}>{u.org_code || u.name}</option>
          ))}
        </select>

        <button onClick={load}
          style={{ fontFamily: M, fontSize: '9px', color: '#555', background: 'none', border: '1px solid rgba(107,107,128,0.2)', padding: '4px 10px', cursor: 'pointer' }}>
          ↺ REFRESH
        </button>
        <span style={{ fontFamily: M, fontSize: '9px', color: '#444', marginLeft: 'auto' }}>
          {filtered.length} EVENT{filtered.length !== 1 ? 'S' : ''}
        </span>
      </div>

      {/* ── Card grid ── */}
      {loading ? (
        <p style={{ fontFamily: M, fontSize: '10px', color: '#444' }}>LOADING...</p>
      ) : filtered.length === 0 ? (
        <p style={{ fontFamily: M, fontSize: '10px', color: '#444' }}>No events match your filter.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '10px' }}>
          {filtered.map(ev => {
            const hostOrgId = ev.host_org_id || ev.org_id
            const hostOrg   = univMap[hostOrgId]
            const sc        = _EV_STATUS_COLOR[ev.status] || '#6B6B80'
            const isMajor   = ev.event_type === 'MAJOR'
            const accentClr = ev.status === 'ACTIVE' ? '#00FF88' : ev.status === 'UPCOMING' ? '#4A9EFF' : '#222'

            return (
              <div
                key={ev.id}
                onClick={() => openModal(ev)}
                style={{
                  border: '1px solid rgba(107,107,128,0.15)',
                  borderTop: `2px solid ${accentClr}`,
                  padding: '14px', cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                  background: 'transparent',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.015)'; e.currentTarget.style.borderColor = `${sc}40` }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(107,107,128,0.15)' }}
              >
                {/* Row 1 — name + status */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                  <p style={{ fontFamily: M, fontSize: '13px', color: '#F0F0F0', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                    {ev.name}
                  </p>
                  <span style={{ fontFamily: M, fontSize: '9px', color: sc, flexShrink: 0, letterSpacing: '0.05em' }}>
                    {_EV_STATUS_LABEL[ev.status] || ev.status}
                  </span>
                </div>

                {/* Row 2 — host org + type */}
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
                  {hostOrg && (
                    <span style={{ fontFamily: M, fontSize: '8px', color: '#FF4500', border: '1px solid rgba(255,69,0,0.3)', padding: '1px 6px' }}>
                      HOST · {hostOrg.org_code || hostOrg.name}
                    </span>
                  )}
                  <span style={{
                    fontFamily: M, fontSize: '8px', padding: '1px 5px',
                    color: isMajor ? '#FF6B00' : '#6B6B80',
                    border: `1px solid ${isMajor ? 'rgba(255,107,0,0.3)' : 'rgba(107,107,128,0.2)'}`,
                  }}>
                    {isMajor ? '★ MAJOR' : 'LOCAL'}
                  </span>
                </div>

                {/* Row 3 — stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '5px', marginBottom: '10px' }}>
                  {[
                    ['CONTRACTS', ev.contract_count ?? '—'],
                    ['CLAIMS',    ev.claim_count    ?? '—'],
                    ['TEAMS',     ev.team_count     ?? '—'],
                    ['PLAYERS',   ev.participant_count ?? '—'],
                  ].map(([label, val]) => (
                    <div key={label} style={{ textAlign: 'center', padding: '5px 4px', border: '1px solid rgba(107,107,128,0.08)', background: '#0a0a0a' }}>
                      <div style={{ fontFamily: M, fontSize: '13px', color: '#D0D0D0', fontWeight: 'bold', lineHeight: 1 }}>{val}</div>
                      <div style={{ fontFamily: M, fontSize: '7px', letterSpacing: '0.08em', color: '#444', marginTop: '2px' }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Row 4 — dates + reg */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                  <span style={{ fontFamily: M, fontSize: '9px', color: '#555' }}>
                    {ev.start_time ? fmtDateShort(ev.start_time) : '—'}
                    {ev.end_time ? ` → ${fmtDateShort(ev.end_time)}` : ''}
                  </span>
                  <span style={{ fontFamily: M, fontSize: '8px', padding: '1px 5px', border: `1px solid ${ev.registration_open ? 'rgba(0,255,136,0.3)' : 'rgba(107,107,128,0.2)'}`, color: ev.registration_open ? '#00FF88' : '#555' }}>
                    REG {ev.registration_open ? 'OPEN' : 'CLOSED'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Event detail modal ── */}
      {modalEvent && <EventModal ev={modalEvent} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// OPERATORS TAB  (orgId prop: scoped to a specific organization when set)
// ---------------------------------------------------------------------------
function OperatorsTab({ orgId, archScoped = false, defaultSelectedId = null }) {
  const terms = usePlatformTerms()
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [tempPwd, setTempPwd] = useState('')
  const [roleTab, setRoleTab] = useState('ALL')
  const [verifyFilter, setVerifyFilter] = useState('ALL')
  const [checkedIds, setCheckedIds] = useState(new Set())
  const [bulkVerifying, setBulkVerifying] = useState(false)
  const [sortKey, setSortKey] = useState('role')
  const [sortDir, setSortDir] = useState('asc')
  const [confirm, setConfirm] = useState(null)

  const qp = orgId ? `?org_id=${orgId}` : ''

  async function load() {
    try {
      const r = await client.get(`/admin/users${qp}`)
      setUsers(r.data)
    } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [orgId])

  // Auto-select operator from global search
  useEffect(() => {
    if (!defaultSelectedId || users.length === 0) return
    const u = users.find(u => u.id === defaultSelectedId)
    if (u && selected?.id !== defaultSelectedId) { setSelected(u); setTempPwd('') }
  }, [defaultSelectedId, users])

  async function patchUser(id, body) {
    setSaving(true)
    try {
      await client.patch(`/admin/users/${id}`, body)
      await load()
      setSelected(prev => prev ? { ...prev, ...body } : prev)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  // Wrap destructive actions with confirmation when archScoped
  function guardedPatch(id, body, label) {
    if (!archScoped) return patchUser(id, body)
    setConfirm({
      label,
      onConfirm: () => { setConfirm(null); patchUser(id, body) },
    })
  }

  async function forceLogout(id) {
    try { await client.post(`/admin/users/${id}/force-logout`) } catch { /* ignore */ }
  }

  async function resetPassword(id) {
    try {
      const r = await client.post(`/admin/users/${id}/reset-password`)
      setTempPwd(r.data.temp_password)
    } catch { /* ignore */ }
  }

  async function verifyUser(id) {
    try {
      await client.post(`/architect/users/${id}/verify`)
      setUsers(prev => prev.map(u => u.id === id ? { ...u, is_verified: true } : u))
      setSelected(prev => prev?.id === id ? { ...prev, is_verified: true } : prev)
    } catch { /* ignore */ }
  }

  async function unverifyUser(id) {
    try {
      await client.post(`/architect/users/${id}/unverify`)
      setUsers(prev => prev.map(u => u.id === id ? { ...u, is_verified: false } : u))
      setSelected(prev => prev?.id === id ? { ...prev, is_verified: false } : prev)
    } catch { /* ignore */ }
  }

  async function bulkVerify() {
    if (!checkedIds.size) return
    setBulkVerifying(true)
    try {
      await client.post('/architect/users/bulk-verify', { user_ids: [...checkedIds] })
      const ids = [...checkedIds]
      setUsers(prev => prev.map(u => ids.includes(u.id) ? { ...u, is_verified: true } : u))
      setCheckedIds(new Set())
    } catch { /* ignore */ }
    finally { setBulkVerifying(false) }
  }

  function toggleCheck(id) {
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleCheckAll() {
    const unverifiedIds = filtered.filter(u => !u.is_verified).map(u => u.id)
    setCheckedIds(prev => unverifiedIds.every(id => prev.has(id)) ? new Set() : new Set(unverifiedIds))
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = users
    .filter(u => {
      if (roleTab !== 'ALL' && u.role !== roleTab) return false
      if (verifyFilter === 'VERIFIED' && !u.is_verified) return false
      if (verifyFilter === 'UNVERIFIED' && u.is_verified) return false
      return (
        u.username?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase())
      )
    })
    .sort((a, b) => {
      let av, bv
      if (sortKey === 'role')     { av = _ROLE_SORT_ORDER[a.role] ?? 99; bv = _ROLE_SORT_ORDER[b.role] ?? 99 }
      else if (sortKey === 'bc')  { av = a.bc_total ?? 0; bv = b.bc_total ?? 0 }
      else if (sortKey === 'status') { av = a.is_banned ? 1 : 0; bv = b.is_banned ? 1 : 0 }
      else                        { av = (a.username || '').toLowerCase(); bv = (b.username || '').toLowerCase() }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

  const ROLES = ['OPERATIVE', 'HANDLER', 'CONTRACTOR', 'ADMIN']
  const ROLE_COLOR = { OPERATIVE: '#6B6B80', HANDLER: '#4A9EFF', CONTRACTOR: '#FF6B00', ADMIN: '#FF4500' }

  return (
    <div className="flex gap-4 h-full relative">
      {/* Architect scoped confirmation dialog */}
      {confirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-void/85">
          <div className="border border-ember/40 bg-abyss p-6 space-y-4 max-w-xs w-full">
            <p className="font-mono text-[10px] tracking-widest text-ember">ARCHITECT CONFIRMATION</p>
            <p className="font-mono text-sm text-bone">{confirm.label}</p>
            <p className="font-mono text-[10px] text-ghost">
              You are operating in scoped organization view. Confirm to proceed.
            </p>
            <div className="flex gap-2">
              <button
                onClick={confirm.onConfirm}
                className="flex-1 font-mono text-[10px] tracking-widest py-2 border border-ember/40 text-ember"
              >
                [ CONFIRM ]
              </button>
              <button
                onClick={() => setConfirm(null)}
                className="flex-1 font-mono text-[10px] tracking-widest py-2 border border-ghost/20 text-ghost"
              >
                [ CANCEL ]
              </button>
            </div>
          </div>
        </div>
      )}
      {/* List */}
      <div className="flex-1 min-w-0">
        {/* Role filter tabs */}
        <div className="flex gap-0 border-b border-ghost/10 mb-0 overflow-x-auto">
          {['ALL', 'OPERATIVE', 'HANDLER', 'CONTRACTOR', 'ADMIN'].map(r => {
            const count = r === 'ALL' ? users.length : users.filter(u => u.role === r).length
            const label = r === 'ALL' ? 'ALL' : _roleLabel(r, terms)
            return (
              <button
                key={r}
                onClick={() => setRoleTab(r)}
                className={`font-mono text-[10px] tracking-widest px-3 py-1.5 border-b-2 transition-colors whitespace-nowrap ${
                  roleTab === r ? 'border-ember text-bone' : 'border-transparent text-ghost hover:text-bone'
                }`}
              >
                {label}
                <span className="ml-1.5" style={{ fontSize: '9px', color: roleTab === r ? '#6B6B85' : '#3A3A52' }}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
        {/* Verification filter */}
        <div className="flex gap-0 border-b border-ghost/10 mb-3 overflow-x-auto">
          {[['ALL', users.length], ['VERIFIED', users.filter(u => u.is_verified).length], ['UNVERIFIED', users.filter(u => !u.is_verified).length]].map(([f, count]) => (
            <button
              key={f}
              onClick={() => setVerifyFilter(f)}
              className={`font-mono text-[10px] tracking-widest px-3 py-1.5 border-b-2 transition-colors whitespace-nowrap ${
                verifyFilter === f
                  ? f === 'UNVERIFIED' ? 'border-flare text-flare' : 'border-ghost/40 text-bone'
                  : 'border-transparent text-ghost hover:text-bone'
              }`}
            >
              {f}
              <span className="ml-1.5" style={{ fontSize: '9px', color: verifyFilter === f ? '#6B6B85' : '#3A3A52' }}>
                {count}
              </span>
            </button>
          ))}
        </div>
        <input
          className="w-full bg-transparent border border-ghost/20 px-3 py-2 font-mono text-xs text-bone outline-none focus:border-ember mb-3 caret-ember"
          placeholder="Search callsign or email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="border border-ghost/20 rounded-sm overflow-hidden">
          <div className="grid grid-cols-[20px_1fr_100px_80px_110px] px-4 py-2 border-b border-ghost/10 font-mono text-[10px] tracking-widest text-ghost items-center">
            <input
              type="checkbox"
              className="accent-flare cursor-pointer"
              checked={filtered.filter(u => !u.is_verified).length > 0 && filtered.filter(u => !u.is_verified).every(u => checkedIds.has(u.id))}
              onChange={toggleCheckAll}
              title="Select all unverified"
            />
            {[['CALLSIGN','callsign'],['ROLE','role'],['BC','bc'],['STATUS','status']].map(([label, key]) => (
              <span
                key={key}
                onClick={() => toggleSort(key)}
                className="cursor-pointer select-none hover:text-ember transition-colors flex items-center gap-1"
              >
                {label}
                {sortKey === key && <span className="text-ember">{sortDir === 'asc' ? '↑' : '↓'}</span>}
              </span>
            ))}
          </div>
          <div className="divide-y divide-ghost/10 max-h-[calc(100vh-360px)] overflow-y-auto">
            {filtered.map(u => (
              <div
                key={u.id}
                className={`grid grid-cols-[20px_1fr_100px_80px_110px] px-4 py-2.5 transition-colors items-center ${selected?.id === u.id ? 'bg-abyss' : 'hover:bg-abyss/40'}`}
              >
                <input
                  type="checkbox"
                  className="accent-flare cursor-pointer"
                  checked={checkedIds.has(u.id)}
                  disabled={u.is_verified}
                  onChange={() => toggleCheck(u.id)}
                  onClick={e => e.stopPropagation()}
                />
                <span
                  className="font-mono text-sm text-bone truncate cursor-pointer"
                  onClick={() => { setSelected(u); setTempPwd('') }}
                >{u.username}</span>
                <span
                  className="font-mono text-[10px] tracking-wider cursor-pointer"
                  style={{ color: ROLE_COLOR[u.role] || '#6B6B80' }}
                  onClick={() => { setSelected(u); setTempPwd('') }}
                >{_roleLabel(u.role, terms)}</span>
                <span
                  className="font-mono text-xs text-ghost cursor-pointer"
                  onClick={() => { setSelected(u); setTempPwd('') }}
                >{u.bc_total ?? 0}</span>
                <span className="font-mono text-[10px] flex items-center gap-1">
                  {u.is_banned
                    ? <span className="text-danger">BANNED</span>
                    : !u.is_verified
                      ? <span className="text-flare">⚠ UNVERIFIED</span>
                      : <span className="text-success">ACTIVE</span>
                  }
                </span>
              </div>
            ))}
          </div>
        </div>
        {checkedIds.size > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={bulkVerify}
              disabled={bulkVerifying}
              className="font-mono text-[10px] tracking-widest px-4 py-1.5 border border-flare/40 text-flare disabled:opacity-40 hover:bg-flare/10 transition-colors"
            >
              {bulkVerifying ? '[ VERIFYING... ]' : `[ VERIFY SELECTED (${checkedIds.size}) ]`}
            </button>
            <button
              onClick={() => setCheckedIds(new Set())}
              className="font-mono text-[10px] tracking-widest text-ghost hover:text-bone"
            >
              CLEAR
            </button>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-72 border border-ghost/20 rounded-sm bg-abyss p-4 space-y-4 flex-shrink-0">
          <div>
            <p className="font-mono text-[10px] tracking-widest mb-0.5 text-ghost">OPERATOR</p>
            <p className="font-mono text-base font-bold text-ember">{selected.username}</p>
            <p className="font-mono text-xs text-ghost">{selected.email}</p>
          </div>

          <div className="mb-1">
            {selected.is_verified
              ? <span className="font-mono text-[10px] text-success">✓ VERIFIED</span>
              : <span className="font-mono text-[10px] text-flare">⚠ UNVERIFIED</span>
            }
          </div>
          <div className="space-y-2 text-xs">
            {[
              ['School',     selected.school],
              ['Section',    selected.section],
              ['Full Name',  selected.full_name],
              ['Student ID', selected.student_id],
              ['Year Level', selected.year_level],
              ['Last Login', fmtDateTime(selected.last_login)],
              ['BC Total',   selected.bc_total],
              ['Void BC',    selected.void_bc],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between">
                <span className="font-mono text-[10px] text-ghost">{label}</span>
                <span className="font-mono text-[11px] text-bone">{val || '—'}</span>
              </div>
            ))}
          </div>

          {/* Role */}
          <div>
            <p className="font-mono text-[10px] tracking-widest mb-1 text-ghost">ROLE</p>
            <div className="grid grid-cols-2 gap-1">
              {ROLES.map(r => (
                <button
                  key={r}
                  disabled={saving || selected.role === r}
                  onClick={() => guardedPatch(selected.id, { role: r }, `Change role of "${selected.username}" to ${r}?`)}
                  className="font-mono text-[10px] py-1 border transition-all disabled:opacity-40"
                  style={{
                    borderColor: selected.role === r ? ROLE_COLOR[r] : 'rgba(107,107,128,0.3)',
                    color: selected.role === r ? ROLE_COLOR[r] : '#6B6B80',
                    background: selected.role === r ? `${ROLE_COLOR[r]}15` : 'transparent',
                  }}
                >
                  {_roleLabel(r, terms)}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-1.5">
            {selected.is_verified ? (
              <button
                onClick={() => unverifyUser(selected.id)}
                className="w-full font-mono text-[10px] tracking-widest py-1.5 border border-flare/40 text-flare transition-all hover:bg-flare/10"
              >
                [ UNVERIFY OPERATOR ]
              </button>
            ) : (
              <button
                onClick={() => verifyUser(selected.id)}
                className="w-full font-mono text-[10px] tracking-widest py-1.5 border border-success/40 text-success transition-all hover:bg-success/10"
              >
                [ VERIFY OPERATOR ]
              </button>
            )}
            <button
              onClick={() => guardedPatch(
                selected.id,
                { is_banned: !selected.is_banned },
                selected.is_banned ? `Unban operator "${selected.username}"?` : `Ban operator "${selected.username}"?`
              )}
              disabled={saving}
              className={`w-full font-mono text-[10px] tracking-widest py-1.5 border transition-all disabled:opacity-40 ${
                selected.is_banned ? 'border-success/40 text-success' : 'border-danger/40 text-danger'
              }`}
            >
              {selected.is_banned ? '[ UNBAN OPERATOR ]' : '[ BAN OPERATOR ]'}
            </button>
            <button
              onClick={() => forceLogout(selected.id)}
              className="w-full font-mono text-[10px] tracking-widest py-1.5 border border-ghost/20 text-ghost transition-all hover:border-ghost/40"
            >
              [ FORCE LOGOUT ]
            </button>
            <button
              onClick={() => resetPassword(selected.id)}
              disabled={saving}
              className="w-full font-mono text-[10px] tracking-widest py-1.5 border border-ghost/20 text-ghost transition-all hover:border-ghost/40 disabled:opacity-40"
            >
              [ GENERATE TEMP PASSWORD ]
            </button>
            {tempPwd && (
              <div className="border border-ghost/20 p-2">
                <p className="font-mono text-[10px] text-ghost">TEMP PASSWORD:</p>
                <p className="font-mono text-sm font-bold text-ember">{tempPwd}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GLOBAL OPERATORS TAB  (organization filter tabs wrapping OperatorsTab)
// ---------------------------------------------------------------------------
function GlobalOperatorsTab({ defaultSelectedId = null }) {
  const [organizations, setOrganizations] = useState([])
  const [orgFilter, setOrgFilter] = useState(null) // null = ALL

  useEffect(() => {
    client.get('/organizations')
      .then(r => setOrganizations(r.data))
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-4">
      {/* Organization filter tabs */}
      <div className="flex items-center gap-0 flex-wrap border-b border-ghost/20">
        {[{ id: null, label: 'ALL' }, ...organizations.map(u => ({ id: u.id, label: u.org_code || u.name }))].map(({ id, label }) => (
          <button
            key={id ?? '_all'}
            onClick={() => setOrgFilter(id)}
            className={`font-mono text-[10px] tracking-widest px-4 py-2 border-b-2 transition-all whitespace-nowrap ${
              orgFilter === id ? 'border-ember text-ember' : 'border-transparent text-ghost'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Operators panel — scoped to selected organization */}
      <OperatorsTab orgId={orgFilter} defaultSelectedId={defaultSelectedId} />
    </div>
  )
}


// ---------------------------------------------------------------------------
// COMMS TAB  (orgId prop for scoped view)
// ---------------------------------------------------------------------------
const _TX_ROLES = ['OPERATIVE', 'HANDLER', 'CONTRACTOR', 'ADMIN']
const _TX_ROLE_COLORS = { OPERATIVE: '#00FF88', HANDLER: '#4A9EFF', CONTRACTOR: '#FF6B00', ADMIN: '#FF4500' }

function CommsTab({ orgId }) {
  const terms = usePlatformTerms()
  const [transmissions, setTransmissions]   = useState([])
  const [loading, setLoading]               = useState(true)
  const [sending, setSending]               = useState(false)

  // Compose
  const [content, setContent]               = useState('')
  const [targetMode, setTargetMode]         = useState('all')   // 'all' | 'role' | 'direct'
  const [selectedRoles, setSelectedRoles]   = useState(new Set())
  const [selectedUsers, setSelectedUsers]   = useState([])
  const [userSearch, setUserSearch]         = useState('')
  const [userList, setUserList]             = useState([])
  const [showUserDrop, setShowUserDrop]     = useState(false)

  // List controls
  const [filterType, setFilterType]         = useState('all')   // 'all'|'broadcast'|'role'|'direct'
  const [sortOrder, setSortOrder]           = useState('newest')
  const [openCards, setOpenCards]           = useState(new Set())
  const [deleting, setDeleting]             = useState(null)

  const qp = orgId ? `?org_id=${orgId}` : ''

  async function load() {
    setLoading(true)
    try {
      const r = await client.get(`/transmissions/${qp}`)
      setTransmissions(r.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  async function loadUsers() {
    try {
      const r = await client.get(`/admin/users${orgId ? `?org_id=${orgId}` : ''}`)
      setUserList(r.data)
    } catch { /* ignore */ }
  }

  useEffect(() => { load() }, [orgId])
  useEffect(() => {
    // Reset all compose state when org scope changes to prevent cross-org targeting
    setContent('')
    setTargetMode('all')
    setSelectedRoles(new Set())
    setSelectedUsers([])
    setUserSearch('')
    setShowUserDrop(false)
  }, [orgId])
  useEffect(() => { if (targetMode === 'direct') loadUsers() }, [targetMode, orgId])

  function toggleCard(id) {
    setOpenCards(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleRole(role) {
    setSelectedRoles(prev => { const n = new Set(prev); n.has(role) ? n.delete(role) : n.add(role); return n })
  }

  function addUser(u) {
    if (!selectedUsers.find(x => x.id === u.id)) setSelectedUsers(p => [...p, u])
    setUserSearch(''); setShowUserDrop(false)
  }

  function removeUser(id) { setSelectedUsers(p => p.filter(u => u.id !== id)) }

  async function send() {
    if (!content.trim()) return
    if (targetMode === 'role' && selectedRoles.size === 0) return
    if (targetMode === 'direct' && selectedUsers.length === 0) return
    setSending(true)
    try {
      const body = { content }
      if (targetMode === 'role')   body.target_roles   = [...selectedRoles]
      if (targetMode === 'direct') body.recipient_ids  = selectedUsers.map(u => u.id)
      await client.post('/transmissions/', body)
      setContent(''); setSelectedRoles(new Set()); setSelectedUsers([]); setTargetMode('all')
      await load()
    } catch { /* ignore */ }
    finally { setSending(false) }
  }

  async function deleteTransmission(id) {
    setDeleting(id)
    try {
      await client.delete(`/transmissions/${id}`)
      setTransmissions(p => p.filter(t => t.id !== id))
      setOpenCards(p => { const n = new Set(p); n.delete(id); return n })
    } catch { /* ignore */ }
    finally { setDeleting(null) }
  }

  function txType(t) {
    if (t.recipient_id) return 'direct'
    if (t.target_roles && t.target_roles.length > 0) return 'role'
    return 'broadcast'
  }

  const filtered = transmissions
    .filter(t => {
      if (filterType === 'broadcast') return !t.recipient_id && (!t.target_roles || t.target_roles.length === 0)
      if (filterType === 'role')      return !t.recipient_id && t.target_roles && t.target_roles.length > 0
      if (filterType === 'direct')    return !!t.recipient_id
      return true
    })
    .sort((a, b) => {
      const d = new Date(b.created_at) - new Date(a.created_at)
      return sortOrder === 'newest' ? d : -d
    })

  const filteredUserDrop = userList
    .filter(u =>
      u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.role.toLowerCase().includes(userSearch.toLowerCase())
    )
    .slice(0, 10)

  const M = 'JetBrains Mono, monospace'
  const canSend = content.trim() &&
    (targetMode !== 'role'   || selectedRoles.size > 0) &&
    (targetMode !== 'direct' || selectedUsers.length > 0)

  const SELECT_STYLE = {
    background: '#0a0a0a', border: '1px solid rgba(107,107,128,0.25)',
    color: '#F0F0F0', fontFamily: M, fontSize: '10px',
    padding: '4px 8px', outline: 'none', cursor: 'pointer',
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── COMPOSE PANEL ── */}
      <div style={{ border: '1px solid rgba(107,107,128,0.2)', padding: '16px', background: '#0d0d0d' }}>
        <p style={{ fontFamily: M, fontSize: '9px', letterSpacing: '0.15em', color: '#6B6B80', marginBottom: '14px' }}>
          NEW TRANSMISSION
        </p>

        {/* Target selector row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: M, fontSize: '9px', letterSpacing: '0.1em', color: '#555', flexShrink: 0 }}>TARGET</span>
          <select value={targetMode} onChange={e => { setTargetMode(e.target.value); setSelectedRoles(new Set()); setSelectedUsers([]) }} style={SELECT_STYLE}>
            <option value="all">ALL OPERATORS</option>
            <option value="role">BY ROLE</option>
            <option value="direct">DIRECT — SPECIFIC USER</option>
          </select>
        </div>

        {/* Role checkboxes */}
        {targetMode === 'role' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '12px', padding: '8px 0' }}>
            {_TX_ROLES.map(role => (
              <label key={role} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedRoles.has(role)}
                  onChange={() => toggleRole(role)}
                  style={{ accentColor: _TX_ROLE_COLORS[role] }}
                />
                <span style={{ fontFamily: M, fontSize: '9px', letterSpacing: '0.08em', color: _TX_ROLE_COLORS[role] }}>{_roleLabel(role, terms)}</span>
              </label>
            ))}
          </div>
        )}

        {/* Direct user picker */}
        {targetMode === 'direct' && (
          <div style={{ marginBottom: '12px', position: 'relative' }}>
            {/* Chips */}
            {selectedUsers.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                {selectedUsers.map(u => (
                  <div key={u.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    background: 'rgba(255,69,0,0.08)', border: '1px solid rgba(255,69,0,0.25)',
                    padding: '2px 7px',
                  }}>
                    <span style={{ fontFamily: M, fontSize: '9px', color: '#FF4500' }}>{u.username}</span>
                    <span style={{ fontFamily: M, fontSize: '9px', color: '#6B6B80' }}>·</span>
                    <span style={{ fontFamily: M, fontSize: '9px', color: _TX_ROLE_COLORS[u.role] || '#6B6B80' }}>{u.role}</span>
                    <button
                      onClick={() => removeUser(u.id)}
                      style={{ fontFamily: M, fontSize: '11px', color: '#6B6B80', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 1px' }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            {/* Search input */}
            <input
              value={userSearch}
              onChange={e => { setUserSearch(e.target.value); setShowUserDrop(true) }}
              onFocus={() => setShowUserDrop(true)}
              onBlur={() => setTimeout(() => setShowUserDrop(false), 150)}
              placeholder="SEARCH OPERATOR BY CALLSIGN OR ROLE..."
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'transparent', border: '1px solid rgba(107,107,128,0.2)',
                color: '#F0F0F0', fontFamily: M, fontSize: '11px',
                padding: '6px 10px', outline: 'none', caretColor: '#FF4500',
              }}
            />
            {/* Dropdown */}
            {showUserDrop && filteredUserDrop.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0,
                background: '#111', border: '1px solid rgba(107,107,128,0.3)',
                borderTop: 'none', zIndex: 50, maxHeight: '160px', overflowY: 'auto',
              }}>
                {filteredUserDrop.map(u => (
                  <button
                    key={u.id}
                    onMouseDown={() => addUser(u)}
                    style={{
                      display: 'flex', width: '100%', alignItems: 'center',
                      justifyContent: 'space-between', padding: '7px 10px',
                      background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                    }}
                    className="hover:bg-white/5"
                  >
                    <span style={{ fontFamily: M, fontSize: '11px', color: '#F0F0F0' }}>{u.username}</span>
                    <span style={{ fontFamily: M, fontSize: '9px', color: _TX_ROLE_COLORS[u.role] || '#6B6B80' }}>{u.role}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Content textarea */}
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="TRANSMISSION CONTENT..."
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'transparent', border: `1px solid ${content ? 'rgba(255,69,0,0.3)' : 'rgba(107,107,128,0.2)'}`,
            color: '#F0F0F0', fontFamily: M, fontSize: '11px',
            padding: '8px 10px', outline: 'none', resize: 'vertical', caretColor: '#FF4500',
          }}
        />

        {/* Send row */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button
            onClick={send}
            disabled={sending || !canSend}
            style={{
              fontFamily: M, fontSize: '10px', letterSpacing: '0.15em',
              padding: '6px 18px', border: '1px solid rgba(255,69,0,0.4)', color: '#FF4500',
              background: 'transparent', cursor: canSend && !sending ? 'pointer' : 'not-allowed',
              opacity: sending || !canSend ? 0.35 : 1, transition: 'opacity 0.15s',
            }}
          >
            {sending ? 'BROADCASTING...' : '[ BROADCAST ]'}
          </button>
        </div>
      </div>

      {/* ── FILTER BAR ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: M, fontSize: '9px', letterSpacing: '0.1em', color: '#555' }}>FILTER</span>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={SELECT_STYLE}>
          <option value="all">ALL TYPES</option>
          <option value="broadcast">BROADCAST</option>
          <option value="role">ROLE-TARGETED</option>
          <option value="direct">DIRECT</option>
        </select>
        <select value={sortOrder} onChange={e => setSortOrder(e.target.value)} style={SELECT_STYLE}>
          <option value="newest">NEWEST FIRST</option>
          <option value="oldest">OLDEST FIRST</option>
        </select>
        <button
          onClick={load}
          style={{ fontFamily: M, fontSize: '9px', letterSpacing: '0.1em', padding: '4px 10px', border: '1px solid rgba(107,107,128,0.2)', color: '#6B6B80', background: 'transparent', cursor: 'pointer' }}
        >↺ REFRESH</button>
        <span style={{ fontFamily: M, fontSize: '9px', color: '#444', marginLeft: 'auto' }}>
          {filtered.length} TRANSMISSION{filtered.length !== 1 ? 'S' : ''}
        </span>
      </div>

      {/* ── TRANSMISSION LIST ── */}
      {loading ? (
        <p style={{ fontFamily: M, fontSize: '10px', color: '#444' }}>LOADING...</p>
      ) : filtered.length === 0 ? (
        <p style={{ fontFamily: M, fontSize: '10px', color: '#444' }}>NO TRANSMISSIONS FOUND</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {filtered.map(t => {
            const isOpen  = openCards.has(t.id)
            const type    = txType(t)
            const TC      = { broadcast: '#6B6B80', role: '#4A9EFF', direct: '#FF4500' }[type]
            const TL      = { broadcast: 'BROADCAST', role: 'ROLE-TARGET', direct: 'DIRECT' }[type]
            return (
              <div key={t.id} style={{
                border: `1px solid ${isOpen ? 'rgba(107,107,128,0.25)' : 'rgba(107,107,128,0.12)'}`,
                background: isOpen ? '#0d0d0d' : 'transparent',
                transition: 'background 0.1s',
              }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    onClick={() => toggleCard(t.id)}
                    style={{
                      display: 'flex', alignItems: 'center', flex: 1,
                      padding: '8px 12px', gap: '10px',
                      background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                      minWidth: 0,
                    }}
                    className="hover:bg-white/[0.02]"
                  >
                    <span style={{ fontFamily: M, fontSize: '9px', color: '#555', flexShrink: 0, width: '8px' }}>
                      {isOpen ? '▼' : '▶'}
                    </span>
                    <span style={{
                      fontFamily: M, fontSize: '9px', letterSpacing: '0.08em',
                      color: TC, flexShrink: 0, minWidth: '90px',
                      border: `1px solid ${TC}30`, padding: '1px 5px',
                    }}>
                      {TL}
                    </span>
                    <span style={{ fontFamily: M, fontSize: '11px', color: '#D0D0D0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.content.slice(0, 90)}{t.content.length > 90 ? '…' : ''}
                    </span>
                    <span style={{ fontFamily: M, fontSize: '9px', color: '#555', flexShrink: 0 }}>
                      {fmtDateTime(t.created_at)}
                    </span>
                  </button>
                  <button
                    onClick={() => deleteTransmission(t.id)}
                    disabled={deleting === t.id}
                    title="Remove transmission"
                    style={{
                      padding: '8px 12px', background: 'transparent', border: 'none',
                      cursor: deleting === t.id ? 'not-allowed' : 'pointer',
                      fontFamily: M, fontSize: '13px', color: '#444',
                      flexShrink: 0, lineHeight: 1, opacity: deleting === t.id ? 0.3 : 1,
                      transition: 'color 0.15s',
                    }}
                    className="hover:text-danger"
                  >
                    {deleting === t.id ? '…' : '×'}
                  </button>
                </div>

                {/* Expanded body */}
                {isOpen && (
                  <div style={{ padding: '0 12px 12px 30px', borderTop: '1px solid rgba(107,107,128,0.1)' }}>
                    {/* Full content */}
                    <p style={{ fontFamily: M, fontSize: '11px', color: '#E0E0E0', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: '10px 0 12px' }}>
                      {t.content}
                    </p>
                    {/* Metadata + delete */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: M, fontSize: '9px', color: '#555' }}>
                          FROM: <span style={{ color: '#888' }}>{t.author_username}</span>
                        </span>
                        {type === 'direct' && (
                          <span style={{ fontFamily: M, fontSize: '9px', color: '#555' }}>
                            TO: <span style={{ color: '#FF4500' }}>{t.recipient_username}</span>
                          </span>
                        )}
                        {type === 'role' && (
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {(t.target_roles || []).map(r => (
                              <span key={r} style={{
                                fontFamily: M, fontSize: '9px',
                                color: _TX_ROLE_COLORS[r] || '#6B6B80',
                                border: `1px solid ${(_TX_ROLE_COLORS[r] || '#6B6B80')}40`,
                                padding: '1px 5px',
                              }}>{r}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => deleteTransmission(t.id)}
                        disabled={deleting === t.id}
                        style={{
                          fontFamily: M, fontSize: '9px', letterSpacing: '0.08em',
                          padding: '3px 10px', border: '1px solid rgba(255,45,45,0.3)', color: '#FF2D2D',
                          background: 'transparent', cursor: deleting === t.id ? 'not-allowed' : 'pointer',
                          opacity: deleting === t.id ? 0.4 : 1,
                        }}
                        className="hover:bg-red-500/10 transition-colors"
                      >
                        {deleting === t.id ? 'DELETING...' : '[ DELETE ]'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ARCHITECT SETTINGS TAB — platform settings, email, architect accounts
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ArchitectSettingsTab helper components — defined OUTSIDE the tab so React
// never remounts them on state changes (which would cause inputs to lose focus).
// ---------------------------------------------------------------------------
const _AS_G = 'Geist, sans-serif'
const _AS_M = 'JetBrains Mono, monospace'

const _AS_FILE_GROUPS = [
  { label: 'Archives',   exts: ['zip', 'tar', 'gz', 'rar', '7z'] },
  { label: 'Documents',  exts: ['pdf', 'txt', 'md', 'docx', 'xlsx', 'csv'] },
  { label: 'Images',     exts: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] },
  { label: 'Code',       exts: ['py', 'js', 'sh', 'json', 'xml', 'yaml', 'html', 'c', 'cpp'] },
  { label: 'Binary',     exts: ['bin', 'elf', 'exe', 'so', 'dll', 'pcap', 'cap', 'img'] },
]

function _ASFileTypePicker({ value, onChange }) {
  const selected = new Set(
    (value || '').split(',').map(x => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
  )

  function toggle(ext) {
    const next = new Set(selected)
    if (next.has(ext)) next.delete(ext)
    else next.add(ext)
    onChange([...next].join(','))
  }

  function selectGroup(exts, allOn) {
    const next = new Set(selected)
    exts.forEach(e => allOn ? next.delete(e) : next.add(e))
    onChange([...next].join(','))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {_AS_FILE_GROUPS.map(({ label, exts }) => {
        const groupOn = exts.every(e => selected.has(e))
        const groupPartial = !groupOn && exts.some(e => selected.has(e))
        return (
          <div key={label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              <span style={{ fontFamily: _AS_G, fontSize: '9px', fontWeight: 600, color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', minWidth: '64px' }}>{label}</span>
              <button
                onClick={() => selectGroup(exts, groupOn)}
                style={{
                  fontFamily: _AS_M, fontSize: '8px', padding: '2px 7px',
                  border: `1px solid ${groupOn ? 'rgba(249,115,22,0.5)' : '#2a2a2a'}`,
                  color: groupOn ? '#f97316' : '#333',
                  background: 'transparent', cursor: 'pointer',
                }}
              >
                {groupOn ? 'DESELECT ALL' : groupPartial ? 'SELECT ALL' : 'SELECT ALL'}
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {exts.map(ext => {
                const on = selected.has(ext)
                return (
                  <button
                    key={ext}
                    onClick={() => toggle(ext)}
                    style={{
                      fontFamily: _AS_M, fontSize: '11px', padding: '4px 10px',
                      border: `1px solid ${on ? 'rgba(249,115,22,0.6)' : '#2a2a2a'}`,
                      color: on ? '#f97316' : '#555',
                      background: on ? 'rgba(249,115,22,0.08)' : 'transparent',
                      cursor: 'pointer', transition: 'all 0.1s',
                    }}
                    onMouseEnter={e => { if (!on) { e.currentTarget.style.borderColor = '#3a3a3a'; e.currentTarget.style.color = '#888' } }}
                    onMouseLeave={e => { if (!on) { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#555' } }}
                  >
                    .{ext}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      {selected.size > 0 && (
        <p style={{ fontFamily: _AS_G, fontSize: '9px', color: '#333', marginTop: '2px' }}>
          Active: {[...selected].map(e => `.${e}`).join(', ')}
        </p>
      )}
      {selected.size === 0 && (
        <p style={{ fontFamily: _AS_G, fontSize: '9px', color: '#dc2626' }}>
          Warning: no types selected — all uploads will be blocked.
        </p>
      )}
    </div>
  )
}

function _ASCard({ label, children, danger = false, accent = false }) {
  return (
    <div style={{ background: '#111111', border: `1px solid ${danger ? 'rgba(220,38,38,0.3)' : accent ? 'rgba(249,115,22,0.2)' : '#1f1f1f'}` }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${danger ? 'rgba(220,38,38,0.2)' : accent ? 'rgba(249,115,22,0.1)' : '#1a1a1a'}` }}>
        <span style={{ fontFamily: _AS_M, fontSize: '10px', color: danger ? '#dc2626' : accent ? '#f97316' : '#444', letterSpacing: '0.1em' }}>
          {label}
        </span>
      </div>
      <div style={{ padding: '20px' }}>{children}</div>
    </div>
  )
}

function _ASNumInp({ value, onChange, min, max, step }) {
  return (
    <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value)}
      min={min} max={max} step={step}
      style={{
        width: '100%', background: '#0d0d0d', border: '1px solid #2a2a2a',
        padding: '6px 10px', fontFamily: _AS_M, fontSize: '13px', color: '#e5e5e5',
        outline: 'none', caretColor: '#f97316',
      }}
      onFocus={e => { e.target.style.borderColor = '#f97316' }}
      onBlur={e => { e.target.style.borderColor = '#2a2a2a' }}
    />
  )
}

function _ASTextInp({ value, onChange, placeholder }) {
  return (
    <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', background: '#0d0d0d', border: '1px solid #2a2a2a',
        padding: '6px 10px', fontFamily: _AS_M, fontSize: '13px', color: '#e5e5e5',
        outline: 'none', caretColor: '#f97316',
      }}
      onFocus={e => { e.target.style.borderColor = '#f97316' }}
      onBlur={e => { e.target.style.borderColor = '#2a2a2a' }}
    />
  )
}

function _ASFieldLbl({ children, hint }) {
  return (
    <div style={{ marginBottom: '6px' }}>
      <p style={{ fontFamily: _AS_G, fontSize: '10px', fontWeight: 600, color: '#444', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{children}</p>
      {hint && <p style={{ fontFamily: _AS_G, fontSize: '9px', color: '#333', marginTop: '2px' }}>{hint}</p>}
    </div>
  )
}

function _ASToggle({ on, onToggle, label, desc, warn = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #161616' }}>
      <div>
        <p style={{ fontFamily: _AS_M, fontSize: '11px', fontWeight: 700, color: warn && on ? '#f97316' : '#e5e5e5', marginBottom: '2px' }}>{label}</p>
        <p style={{ fontFamily: _AS_G, fontSize: '10px', color: '#444' }}>{desc}</p>
      </div>
      <button
        onClick={onToggle}
        style={{
          flexShrink: 0, marginLeft: '20px',
          width: '40px', height: '20px', borderRadius: '10px',
          background: on ? (warn ? 'rgba(249,115,22,0.6)' : 'rgba(0,255,136,0.3)') : '#1a1a1a',
          border: `1px solid ${on ? (warn ? 'rgba(249,115,22,0.7)' : 'rgba(0,255,136,0.4)') : '#2a2a2a'}`,
          cursor: 'pointer', position: 'relative', transition: 'all 0.15s',
        }}
      >
        <span style={{
          position: 'absolute', top: '2px', left: on ? '22px' : '2px',
          width: '14px', height: '14px', borderRadius: '50%',
          background: on ? (warn ? '#f97316' : '#00FF88') : '#3a3a3a',
          transition: 'left 0.15s',
        }} />
      </button>
    </div>
  )
}

function _ASStatusRow({ label, status }) {
  const color = _STATUS_DOT[status] || _STATUS_DOT.UNKNOWN
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #161616' }}>
      <span style={{ fontFamily: _AS_M, fontSize: '11px', color: '#888' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: color, display: 'inline-block', boxShadow: status === 'ONLINE' ? `0 0 6px ${color}80` : 'none' }} />
        <span style={{ fontFamily: _AS_M, fontSize: '10px', color, letterSpacing: '0.06em' }}>{status}</span>
      </div>
    </div>
  )
}

function _ASSaveRow({ onSave, saving, msg }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #1a1a1a' }}>
      <button onClick={onSave} disabled={saving}
        style={{ fontFamily: _AS_M, fontSize: '10px', fontWeight: 700, padding: '8px 20px', border: '1px solid rgba(249,115,22,0.5)', color: '#f97316', background: 'transparent', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.08)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        {saving ? '...' : '[ SAVE CONFIGURATION ]'}
      </button>
      {msg?.text && (
        <span style={{ fontFamily: _AS_G, fontSize: '11px', color: msg.ok ? '#00FF88' : '#FF2D2D' }}>{msg.text}</span>
      )}
    </div>
  )
}

const _ARCH_SETTINGS_DEFAULTS = {
  // decay
  decay_mode: 'TIME_BASED',
  decay_tier_1_hours: '1.0', decay_tier_1_percent: '90',
  decay_tier_2_hours: '2.0', decay_tier_2_percent: '75',
  decay_tier_3_hours: '3.0', decay_tier_3_percent: '60',
  decay_floor_percent: '50',
  // clearance
  cl_ghost: '501', cl_phantom: '1501', cl_specter: '3001', cl_legend: '6001',
  // feature flags
  void_mode_enabled: 'true',
  bounty_board_public: 'false',
  maintenance_mode: 'false',
  // platform identity
  term_operator: 'Operative',
  term_team: 'Team',
  term_handler: 'Handler',
  term_contractor: 'Contractor',
  // org caps
  max_organizations: '0',
  max_events_per_org: '0',
  max_operators_per_org: '0',
  // registration gateway
  platform_registration_locked: 'false',
  // file limits
  max_upload_mb: '50',
  allowed_file_types: 'zip,pdf,txt,png,jpg,bin,elf',
}

const _STATUS_DOT = { ONLINE: '#00FF88', ERROR: '#FF2D2D', CHECKING: '#f97316', UNKNOWN: '#6B6B80' }

function ArchitectSettingsTab() {
  const [settings, setSettings]       = useState(_ARCH_SETTINGS_DEFAULTS)
  const [loadingAll, setLoadingAll]   = useState(true)
  const [cardStates, setCardStates]   = useState({}) // per-card { saving, msg }
  const [showUpdate, setShowUpdate]         = useState(false)
  const [confirmIdentity, setConfirmIdentity] = useState(false)
  const [confirmMaintenance, setConfirmMaintenance] = useState(false)
  const [showGoingMaintenance, setShowGoingMaintenance] = useState(false)
  const [smtp, setSmtp]               = useState(null)
  const [testTo, setTestTo]           = useState('')
  const [testSending, setTestSending] = useState(false)
  const [testMsg, setTestMsg]         = useState({ text: '', ok: true })
  const [accounts, setAccounts]       = useState([])
  const [health, setHealth]           = useState(null)
  const [healthChecking, setHealthChecking] = useState(false)
  const [dangerBusy, setDangerBusy]   = useState(null)
  const [dangerMsg, setDangerMsg]     = useState({ text: '', ok: true })

  useEffect(() => {
    Promise.all([
      client.get('/architect/settings'),
      client.get('/architect/smtp-info'),
      client.get('/architect/accounts'),
    ]).then(([sR, smtpR, acR]) => {
      setSettings({ ..._ARCH_SETTINGS_DEFAULTS, ...sR.data })
      setSmtp(smtpR.data)
      setAccounts(acR.data)
    }).catch(() => {}).finally(() => setLoadingAll(false))
    checkHealth()
  }, [])

  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }))
  const toggle = k => setSettings(s => ({ ...s, [k]: s[k] === 'true' ? 'false' : 'true' }))
  const isOn = k => settings[k] === 'true'

  // Returns { saving, msg } for a given card id
  const cs = id => cardStates[id] || { saving: false, msg: { text: '', ok: true } }

  async function saveCard(id, keys) {
    setCardStates(s => ({ ...s, [id]: { saving: true, msg: { text: '', ok: true } } }))
    const subset = Object.fromEntries(keys.map(k => [k, settings[k]]))
    try {
      await client.patch('/architect/settings', { settings: subset })
      if (id === 'identity') {
        setShowUpdate(true)
        return
      }
      if (id === 'flags' && subset.maintenance_mode === 'true') {
        setShowGoingMaintenance(true)
        return
      }
      setCardStates(s => ({ ...s, [id]: { saving: false, msg: { text: 'Saved.', ok: true } } }))
    } catch {
      setCardStates(s => ({ ...s, [id]: { saving: false, msg: { text: 'Save failed.', ok: false } } }))
    }
    setTimeout(() => setCardStates(s => ({ ...s, [id]: { saving: false, msg: { text: '', ok: true } } })), 3000)
  }

  async function checkHealth() {
    setHealthChecking(true)
    try {
      const r = await client.get('/architect/system-status')
      setHealth(r.data)
    } catch { setHealth({ api: 'ERROR', db: 'UNKNOWN', redis: 'UNKNOWN' }) }
    finally { setHealthChecking(false) }
  }

  async function sendTest() {
    if (!testTo) return
    setTestSending(true); setTestMsg({ text: '', ok: true })
    try {
      await client.post('/architect/test-email', { to_email: testTo })
      setTestMsg({ text: `Dispatched to ${testTo}`, ok: true })
    } catch { setTestMsg({ text: 'Send failed — check SMTP config.', ok: false }) }
    finally { setTestSending(false) }
  }

  async function clearLog() {
    if (!window.confirm('Wipe all architect audit log entries? This cannot be undone.')) return
    setDangerBusy('log'); setDangerMsg({ text: '', ok: true })
    try {
      await client.delete('/architect/log')
      setDangerMsg({ text: 'Architect log cleared.', ok: true })
    } catch { setDangerMsg({ text: 'Failed to clear log.', ok: false }) }
    finally { setDangerBusy(null); setTimeout(() => setDangerMsg({ text: '', ok: true }), 4000) }
  }

  async function forceResume() {
    if (!window.confirm('Force-clear the competition halted state? Only use this if the competition is stuck.')) return
    setDangerBusy('halt'); setDangerMsg({ text: '', ok: true })
    try {
      await client.post('/admin/competition/force-resume')
      setDangerMsg({ text: 'Halted state cleared.', ok: true })
    } catch { setDangerMsg({ text: 'Force-resume failed.', ok: false }) }
    finally { setDangerBusy(null); setTimeout(() => setDangerMsg({ text: '', ok: true }), 4000) }
  }

  if (loadingAll) return (
    <p style={{ fontFamily: _AS_M, fontSize: '11px', color: '#444', letterSpacing: '0.08em' }} className="animate-pulse">
      LOADING CONFIGURATION...
    </p>
  )

  const checkedAt = health?.checked_at
    ? new Date(health.checked_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <>
    {showUpdate && <UpdateScreen />}
    {showGoingMaintenance && <GoingMaintenanceScreen onComplete={() => window.location.reload()} />}

    {/* ── MAINTENANCE CONFIRM MODAL ── */}
    {confirmMaintenance && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(10,10,15,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '420px', border: '1px solid rgba(255,45,45,0.5)', background: '#0d0d12', padding: '28px 28px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <span style={{ fontFamily: _AS_M, fontSize: '9px', letterSpacing: '0.2em', color: '#FF2D2D', border: '1px solid rgba(255,45,45,0.4)', padding: '3px 8px' }}>⚠ CRITICAL</span>
            <span style={{ fontFamily: _AS_M, fontSize: '11px', fontWeight: 700, color: '#e5e5e5', letterSpacing: '0.08em' }}>MAINTENANCE MODE ACTIVATION</span>
          </div>
          <p style={{ fontFamily: _AS_G, fontSize: '12px', color: '#888', lineHeight: 1.6, marginBottom: '18px' }}>
            Enabling maintenance mode will <span style={{ color: '#FF2D2D' }}>immediately lock out all operatives</span> from the platform.
            Only the Architect can access the system while maintenance is active.
          </p>
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '12px 14px', marginBottom: '22px' }}>
            <p style={{ fontFamily: _AS_M, fontSize: '10px', color: '#FF2D2D', letterSpacing: '0.1em', marginBottom: '4px' }}>BLACKOUT PROTOCOL</p>
            <p style={{ fontFamily: _AS_G, fontSize: '11px', color: '#555', lineHeight: 1.5 }}>
              All active sessions will be redirected to the maintenance screen. The platform will display "NETWORK OFFLINE" to all users.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => { setConfirmMaintenance(false); saveCard('flags', ['void_mode_enabled', 'bounty_board_public', 'maintenance_mode']) }}
              style={{ flex: 1, fontFamily: _AS_M, fontSize: '10px', fontWeight: 700, padding: '10px', border: '1px solid rgba(255,45,45,0.5)', color: '#FF2D2D', background: 'transparent', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,45,0.1)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              [ INITIATE BLACKOUT ]
            </button>
            <button
              onClick={() => setConfirmMaintenance(false)}
              style={{ flex: 1, fontFamily: _AS_M, fontSize: '10px', padding: '10px', border: '1px solid #2a2a2a', color: '#6B6B80', background: 'transparent', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#6B6B80'; e.currentTarget.style.color = '#e5e5e5' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#6B6B80' }}
            >
              [ ABORT ]
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── IDENTITY CONFIRM MODAL ── */}
    {confirmIdentity && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(10,10,15,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '420px', border: '1px solid rgba(249,115,22,0.5)', background: '#0d0d12', padding: '28px 28px 24px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <span style={{ fontFamily: _AS_M, fontSize: '9px', letterSpacing: '0.2em', color: '#f97316', border: '1px solid rgba(249,115,22,0.4)', padding: '3px 8px' }}>⚠ WARNING</span>
            <span style={{ fontFamily: _AS_M, fontSize: '11px', fontWeight: 700, color: '#e5e5e5', letterSpacing: '0.08em' }}>IDENTITY CONFIGURATION CHANGE</span>
          </div>

          {/* Body */}
          <p style={{ fontFamily: _AS_G, fontSize: '12px', color: '#888', lineHeight: 1.6, marginBottom: '18px' }}>
            Saving these changes will trigger a <span style={{ color: '#f97316' }}>platform-wide system update</span> and reload the page.
            All role display labels will be replaced across every dashboard.
          </p>

          {/* Preview of new values */}
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '12px 14px', marginBottom: '22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {[
              ['Player Role', settings.term_operator],
              ['Team',        settings.term_team],
              ['Handler',     settings.term_handler],
              ['Contractor',  settings.term_contractor],
            ].map(([label, val]) => (
              <div key={label}>
                <p style={{ fontFamily: _AS_G, fontSize: '9px', color: '#555', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</p>
                <p style={{ fontFamily: _AS_M, fontSize: '11px', color: '#f97316', fontWeight: 700 }}>{val || '—'}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => { setConfirmIdentity(false); saveCard('identity', ['term_operator', 'term_team', 'term_handler', 'term_contractor']) }}
              style={{ flex: 1, fontFamily: _AS_M, fontSize: '10px', fontWeight: 700, padding: '10px', border: '1px solid rgba(249,115,22,0.5)', color: '#f97316', background: 'transparent', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.1)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              [ CONFIRM UPDATE ]
            </button>
            <button
              onClick={() => setConfirmIdentity(false)}
              style={{ flex: 1, fontFamily: _AS_M, fontSize: '10px', padding: '10px', border: '1px solid #2a2a2a', color: '#6B6B80', background: 'transparent', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#6B6B80'; e.currentTarget.style.color = '#e5e5e5' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#6B6B80' }}
            >
              [ CANCEL ]
            </button>
          </div>
        </div>
      </div>
    )}

    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* ── 1. SYSTEM HEALTH ── */}
      <_ASCard label="SYSTEM HEALTH">
        <div>
          <_ASStatusRow label="API BACKEND"   status={healthChecking ? 'CHECKING' : (health?.api   || 'UNKNOWN')} />
          <_ASStatusRow label="DATABASE"      status={healthChecking ? 'CHECKING' : (health?.db    || 'UNKNOWN')} />
          <_ASStatusRow label="CACHE (REDIS)" status={healthChecking ? 'CHECKING' : (health?.redis || 'UNKNOWN')} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '14px' }}>
          {checkedAt && (
            <span style={{ fontFamily: _AS_G, fontSize: '10px', color: '#333' }}>Last checked at {checkedAt}</span>
          )}
          <button
            onClick={checkHealth} disabled={healthChecking}
            style={{ fontFamily: _AS_M, fontSize: '10px', fontWeight: 700, color: '#555', border: '1px solid #2a2a2a', background: 'transparent', padding: '5px 12px', cursor: 'pointer', opacity: healthChecking ? 0.5 : 1 }}
            onMouseEnter={e => { e.currentTarget.style.color = '#f97316'; e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#555'; e.currentTarget.style.borderColor = '#2a2a2a' }}
          >
            {healthChecking ? '...' : '[ RECHECK ]'}
          </button>
        </div>
      </_ASCard>

      {/* ── 2. FEATURE FLAGS ── */}
      <_ASCard label="FEATURE FLAGS" accent>
        <div>
          <_ASToggle on={isOn('void_mode_enabled')}             onToggle={() => toggle('void_mode_enabled')}             label="V01D MODE"           desc="Enables the hidden VO1D challenge track. Turn off to hide /v01d from all operatives." />
          <_ASToggle on={isOn('bounty_board_public')}           onToggle={() => toggle('bounty_board_public')}           label="PUBLIC BOUNTY BOARD" desc="When ON, the bounty board is visible without authentication." />
          <_ASToggle on={isOn('maintenance_mode')}              onToggle={() => toggle('maintenance_mode')}              label="MAINTENANCE MODE"    desc="Hides the platform behind a maintenance screen. All operatives are blocked." warn />
        </div>
        <_ASSaveRow
          onSave={() => {
            if (settings.maintenance_mode === 'true') {
              setConfirmMaintenance(true)
            } else {
              saveCard('flags', ['void_mode_enabled', 'bounty_board_public', 'maintenance_mode'])
            }
          }}
          saving={cs('flags').saving}
          msg={cs('flags').msg}
        />
      </_ASCard>

      {/* ── 3. PLATFORM IDENTITY ── */}
      <_ASCard label="PLATFORM IDENTITY" accent>
        <p style={{ fontFamily: _AS_G, fontSize: '10px', color: '#555', marginBottom: '14px' }}>
          Override role display names and team terminology. Changes take effect on next page load.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
          <div>
            <_ASFieldLbl hint="e.g. Operative, Hacker, Agent — shown as role label">Term: Player Role</_ASFieldLbl>
            <_ASTextInp value={settings.term_operator} onChange={v => set('term_operator', v)} placeholder="Operative" />
          </div>
          <div>
            <_ASFieldLbl hint="e.g. Team, Syndicate, Crew">Term: Team</_ASFieldLbl>
            <_ASTextInp value={settings.term_team} onChange={v => set('term_team', v)} placeholder="Team" />
          </div>
          <div>
            <_ASFieldLbl hint="e.g. Handler, Advisor, Coach — shown for HANDLER role">Term: Handler Role</_ASFieldLbl>
            <_ASTextInp value={settings.term_handler} onChange={v => set('term_handler', v)} placeholder="Handler" />
          </div>
          <div>
            <_ASFieldLbl hint="e.g. Contractor, Supervisor — shown for CONTRACTOR role">Term: Contractor Role</_ASFieldLbl>
            <_ASTextInp value={settings.term_contractor} onChange={v => set('term_contractor', v)} placeholder="Contractor" />
          </div>
        </div>
        <_ASSaveRow onSave={() => setConfirmIdentity(true)} saving={cs('identity').saving} msg={cs('identity').msg} />
      </_ASCard>

      {/* ── 4. PLATFORM DEFAULTS ── */}
      <_ASCard label="PLATFORM DEFAULTS">
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontFamily: _AS_G, fontSize: '11px', fontWeight: 600, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Bounty Decay Schedule</span>
            <span style={{ fontFamily: _AS_G, fontSize: '9px', color: '#333' }}>per-event overrides available</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {['TIME_BASED', 'OFF'].map(m => (
              <button key={m} type="button" onClick={() => set('decay_mode', m)}
                style={{
                  fontFamily: _AS_M, fontSize: '10px', padding: '5px 14px',
                  border: settings.decay_mode === m ? '1px solid rgba(249,115,22,0.6)' : '1px solid #2a2a2a',
                  color: settings.decay_mode === m ? '#f97316' : '#555',
                  background: settings.decay_mode === m ? 'rgba(249,115,22,0.08)' : 'transparent',
                  cursor: 'pointer',
                }}
              >{m === 'TIME_BASED' ? 'TIME-BASED' : 'OFF (FIXED)'}</button>
            ))}
          </div>
          {settings.decay_mode === 'TIME_BASED' && (
            <div>
              {/* Column headers */}
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '10px', marginBottom: '6px' }}>
                <div />
                <span style={{ fontFamily: _AS_G, fontSize: '9px', fontWeight: 600, color: '#333', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Hours after publish</span>
                <span style={{ fontFamily: _AS_G, fontSize: '9px', fontWeight: 600, color: '#333', letterSpacing: '0.08em', textTransform: 'uppercase' }}>BC % paid out</span>
              </div>
              {/* Tier rows — Hours and BC% always side by side */}
              {[1, 2, 3].map(t => (
                <div key={t} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '10px', marginBottom: '10px', alignItems: 'center' }}>
                  <span style={{ fontFamily: _AS_M, fontSize: '10px', color: '#555' }}>TIER {t}</span>
                  <_ASNumInp value={settings[`decay_tier_${t}_hours`]} onChange={v => set(`decay_tier_${t}_hours`, v)} min={0} step={0.5} />
                  <_ASNumInp value={settings[`decay_tier_${t}_percent`]} onChange={v => set(`decay_tier_${t}_percent`, v)} min={0} max={100} step={1} />
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '10px', alignItems: 'center' }}>
                <span style={{ fontFamily: _AS_M, fontSize: '10px', color: '#555' }}>FLOOR</span>
                <div />
                <_ASNumInp value={settings.decay_floor_percent} onChange={v => set('decay_floor_percent', v)} min={0} max={100} step={1} />
              </div>
              <p style={{ fontFamily: _AS_G, fontSize: '9px', color: '#2a2a2a', marginTop: '8px' }}>Floor = minimum BC% paid regardless of solve time.</p>
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontFamily: _AS_G, fontSize: '11px', fontWeight: 600, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Clearance Thresholds (BC)</span>
            <span style={{ fontFamily: _AS_G, fontSize: '9px', color: '#333' }}>cumulative BC to reach rank</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            {[
              ['cl_ghost',  'Ghost',   'NOVICE → GHOST'],
              ['cl_phantom','Phantom', 'GHOST → PHANTOM'],
              ['cl_specter','Specter', 'PHANTOM → SPECTER'],
              ['cl_legend', 'Legend',  'SPECTER → LEGEND'],
            ].map(([k, l, h]) => (
              <div key={k}>
                <_ASFieldLbl hint={h}>{l}</_ASFieldLbl>
                <_ASNumInp value={settings[k]} onChange={v => set(k, v)} min={1} />
              </div>
            ))}
          </div>
        </div>
        <_ASSaveRow onSave={() => saveCard('defaults', ['decay_mode','decay_tier_1_hours','decay_tier_1_percent','decay_tier_2_hours','decay_tier_2_percent','decay_tier_3_hours','decay_tier_3_percent','decay_floor_percent','cl_ghost','cl_phantom','cl_specter','cl_legend'])} saving={cs('defaults').saving} msg={cs('defaults').msg} />
      </_ASCard>

      {/* ── 5. ORG CAPS ── */}
      <_ASCard label="ORG CAPS" accent>
        <p style={{ fontFamily: _AS_G, fontSize: '10px', color: '#555', marginBottom: '14px' }}>
          Set platform-wide maximums. <span style={{ color: '#333' }}>0 = unlimited.</span>
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
          <div>
            <_ASFieldLbl hint="Total orgs across the platform">Max Organizations</_ASFieldLbl>
            <_ASNumInp value={settings.max_organizations} onChange={v => set('max_organizations', v)} min={0} />
          </div>
          <div>
            <_ASFieldLbl hint="Events per organization">Max Events / Org</_ASFieldLbl>
            <_ASNumInp value={settings.max_events_per_org} onChange={v => set('max_events_per_org', v)} min={0} />
          </div>
          <div>
            <_ASFieldLbl hint="Registered users per org">Max Operators / Org</_ASFieldLbl>
            <_ASNumInp value={settings.max_operators_per_org} onChange={v => set('max_operators_per_org', v)} min={0} />
          </div>
        </div>
        <_ASSaveRow onSave={() => saveCard('caps', ['max_organizations', 'max_events_per_org', 'max_operators_per_org'])} saving={cs('caps').saving} msg={cs('caps').msg} />
      </_ASCard>

      {/* ── 6. REGISTRATION GATEWAY ── */}
      <_ASCard label="REGISTRATION GATEWAY" accent>
        <p style={{ fontFamily: _AS_G, fontSize: '10px', color: '#555', marginBottom: '14px' }}>
          The master lock overrides all per-org registration settings. When locked, no new accounts can be created on any organization.
        </p>
        <_ASToggle
          on={isOn('platform_registration_locked')}
          onToggle={() => toggle('platform_registration_locked')}
          label="LOCK ALL REGISTRATION"
          desc="When ON, registration is globally closed. Admins cannot re-open it without Architect action."
          warn
        />
        <_ASSaveRow onSave={() => saveCard('gateway', ['platform_registration_locked'])} saving={cs('gateway').saving} msg={cs('gateway').msg} />
      </_ASCard>

      {/* ── 7. FILE LIMITS ── */}
      <_ASCard label="FILE LIMITS" accent>
        <p style={{ fontFamily: _AS_G, fontSize: '10px', color: '#555', marginBottom: '16px' }}>
          Controls what operatives can upload as contract attachments. Applied at upload time.
        </p>
        <div style={{ marginBottom: '20px' }}>
          <_ASFieldLbl hint="Maximum file size in megabytes">Max Upload Size (MB)</_ASFieldLbl>
          <div style={{ maxWidth: '160px' }}>
            <_ASNumInp value={settings.max_upload_mb} onChange={v => set('max_upload_mb', v)} min={1} max={500} />
          </div>
        </div>
        <div>
          <_ASFieldLbl hint="Select which file types operatives can upload">Allowed File Types</_ASFieldLbl>
          <_ASFileTypePicker
            value={settings.allowed_file_types}
            onChange={v => set('allowed_file_types', v)}
          />
        </div>
        <_ASSaveRow onSave={() => saveCard('filelimits', ['max_upload_mb', 'allowed_file_types'])} saving={cs('filelimits').saving} msg={cs('filelimits').msg} />
      </_ASCard>

      {/* ── 8. EMAIL INFRASTRUCTURE ── */}
      <_ASCard label="EMAIL INFRASTRUCTURE">
        {smtp ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px', marginBottom: '16px' }}>
            {[
              ['SMTP HOST',  smtp.host || '—'],
              ['SMTP PORT',  String(smtp.port || '—')],
              ['FROM EMAIL', smtp.from_email || '(not set)'],
              ['FROM NAME',  smtp.from_name  || '—'],
              ['USERNAME',   smtp.username   || '(not set)'],
              ['TLS / SSL',  smtp.tls ? 'TLS ON' : smtp.ssl ? 'SSL ON' : 'DISABLED'],
            ].map(([l, v]) => (
              <div key={l}>
                <p style={{ fontFamily: _AS_G, fontSize: '9px', fontWeight: 600, color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '3px' }}>{l}</p>
                <p style={{ fontFamily: _AS_M, fontSize: '12px', color: '#e5e5e5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</p>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontFamily: _AS_G, fontSize: '12px', color: '#444', marginBottom: '16px' }}>SMTP config unavailable.</p>
        )}
        <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '16px' }}>
          <p style={{ fontFamily: _AS_G, fontSize: '10px', fontWeight: 600, color: '#444', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' }}>Send Test Email</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input type="email" placeholder="target@email.com" value={testTo} onChange={e => setTestTo(e.target.value)}
              style={{ flex: 1, background: '#0d0d0d', border: '1px solid #2a2a2a', padding: '7px 10px', fontFamily: _AS_M, fontSize: '12px', color: '#e5e5e5', outline: 'none', caretColor: '#f97316' }}
              onFocus={e => { e.target.style.borderColor = '#f97316' }}
              onBlur={e => { e.target.style.borderColor = '#2a2a2a' }}
            />
            <button onClick={sendTest} disabled={testSending || !testTo}
              style={{ fontFamily: _AS_M, fontSize: '10px', fontWeight: 700, padding: '7px 16px', border: '1px solid #2a2a2a', color: '#888', background: 'transparent', cursor: 'pointer', opacity: !testTo || testSending ? 0.4 : 1 }}
              onMouseEnter={e => { if (testTo && !testSending) { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)'; e.currentTarget.style.color = '#f97316' } }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#888' }}
            >
              {testSending ? '...' : '[ SEND TEST ]'}
            </button>
          </div>
          {testMsg.text && <p style={{ fontFamily: _AS_G, fontSize: '11px', marginTop: '8px', color: testMsg.ok ? '#00FF88' : '#FF2D2D' }}>{testMsg.text}</p>}
        </div>
        <p style={{ fontFamily: _AS_G, fontSize: '10px', color: '#2a2a2a', marginTop: '14px' }}>
          SMTP credentials are set via .env — redeploy to change host, port, or password.
        </p>
      </_ASCard>

      {/* ── 9. ARCHITECT CREDENTIALS ── */}
      <_ASCard label="ARCHITECT CREDENTIALS">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '14px' }}>
          {accounts.length === 0 ? (
            <p style={{ fontFamily: _AS_G, fontSize: '12px', color: '#444' }}>No architect accounts configured.</p>
          ) : accounts.map(a => (
            <div key={a.callsign} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #161616' }}>
              <span style={{ fontFamily: _AS_M, fontSize: '10px', color: '#f97316' }}>◈</span>
              <span style={{ fontFamily: _AS_M, fontSize: '13px', fontWeight: 700, color: '#e5e5e5' }}>{a.callsign}</span>
              <span style={{ fontFamily: _AS_G, fontSize: '9px', color: '#444', background: '#1a1a1a', padding: '1px 6px', marginLeft: 'auto' }}>ARCHITECT</span>
            </div>
          ))}
        </div>
        <p style={{ fontFamily: _AS_G, fontSize: '10px', color: '#2a2a2a' }}>
          Accounts are configured via ARCHITECT_N_CALLSIGN / ARCHITECT_N_PASSWORD in .env — redeploy to add or remove.
        </p>
      </_ASCard>

      {/* ── 10. DANGER ZONE ── */}
      <_ASCard label="DANGER ZONE" danger>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: '#0d0d0d', border: '1px solid #1a1a1a' }}>
            <div>
              <p style={{ fontFamily: _AS_M, fontSize: '11px', fontWeight: 700, color: '#e5e5e5', marginBottom: '3px' }}>Clear Architect Log</p>
              <p style={{ fontFamily: _AS_G, fontSize: '11px', color: '#444' }}>Permanently wipes all entries from the audit log. Irreversible.</p>
            </div>
            <button onClick={clearLog} disabled={!!dangerBusy}
              style={{ fontFamily: _AS_M, fontSize: '10px', fontWeight: 700, padding: '7px 14px', border: '1px solid rgba(220,38,38,0.4)', color: '#dc2626', background: 'transparent', cursor: 'pointer', flexShrink: 0, marginLeft: '16px', opacity: dangerBusy ? 0.4 : 1 }}
              onMouseEnter={e => { if (!dangerBusy) e.currentTarget.style.background = 'rgba(220,38,38,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {dangerBusy === 'log' ? '...' : '[ CLEAR LOG ]'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: '#0d0d0d', border: '1px solid #1a1a1a' }}>
            <div>
              <p style={{ fontFamily: _AS_M, fontSize: '11px', fontWeight: 700, color: '#e5e5e5', marginBottom: '3px' }}>Force Clear Halted State</p>
              <p style={{ fontFamily: _AS_G, fontSize: '11px', color: '#444' }}>Bypasses normal resume flow. Use only if competition is stuck in a halted state.</p>
            </div>
            <button onClick={forceResume} disabled={!!dangerBusy}
              style={{ fontFamily: _AS_M, fontSize: '10px', fontWeight: 700, padding: '7px 14px', border: '1px solid rgba(220,38,38,0.4)', color: '#dc2626', background: 'transparent', cursor: 'pointer', flexShrink: 0, marginLeft: '16px', opacity: dangerBusy ? 0.4 : 1 }}
              onMouseEnter={e => { if (!dangerBusy) e.currentTarget.style.background = 'rgba(220,38,38,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {dangerBusy === 'halt' ? '...' : '[ FORCE RESUME ]'}
            </button>
          </div>

          {dangerMsg.text && (
            <p style={{ fontFamily: _AS_G, fontSize: '11px', color: dangerMsg.ok ? '#00FF88' : '#FF2D2D' }}>
              {dangerMsg.text}
            </p>
          )}
        </div>
      </_ASCard>

    </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// ASSIGNMENTS TAB  (orgId prop)
// ---------------------------------------------------------------------------
function AssignmentsTab({ orgId }) {
  const [assignments, setAssignments] = useState([])
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ handler_id: '', operative_id: '' })
  const [saving, setSaving] = useState(false)

  const qp = orgId ? `?org_id=${orgId}` : ''

  async function load() {
    try {
      const [a, u] = await Promise.all([
        client.get(`/admin/assignments${qp}`),
        client.get(`/admin/users${qp}`),
      ])
      setAssignments(a.data)
      setUsers(u.data)
    } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [orgId])

  async function create() {
    if (!form.handler_id || !form.operative_id) return
    setSaving(true)
    try { await client.post('/admin/assignments', form); await load() } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  async function remove(id) {
    try { await client.delete(`/admin/assignments/${id}`); await load() } catch { /* ignore */ }
  }

  const handlers = users.filter(u => u.role === 'HANDLER')
  const operatives = users.filter(u => u.role === 'OPERATIVE')

  return (
    <div className="max-w-2xl space-y-4">
      {/* Create */}
      <div className="border border-ghost/20 p-4 space-y-3">
        <p className="font-mono text-[10px] tracking-widest text-ghost">NEW ASSIGNMENT</p>
        <div className="grid grid-cols-2 gap-3">
          <select
            className="bg-abyss border border-ghost/20 px-2 py-1.5 font-mono text-xs text-bone outline-none"
            value={form.handler_id}
            onChange={e => setForm(p => ({ ...p, handler_id: e.target.value }))}
          >
            <option value="">Handler</option>
            {handlers.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
          <select
            className="bg-abyss border border-ghost/20 px-2 py-1.5 font-mono text-xs text-bone outline-none"
            value={form.operative_id}
            onChange={e => setForm(p => ({ ...p, operative_id: e.target.value }))}
          >
            <option value="">Operative</option>
            {operatives.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        </div>
        <button onClick={create} disabled={saving} className="font-mono text-[10px] tracking-widest px-4 py-1.5 border border-ghost/20 text-ghost disabled:opacity-40 hover:border-ghost/40">
          {saving ? '...' : '[ ASSIGN ]'}
        </button>
      </div>
      {/* List */}
      <div className="border border-ghost/20 divide-y divide-ghost/10 rounded-sm overflow-hidden">
        {assignments.map(a => (
          <div key={a.id} className="flex items-center justify-between px-4 py-2.5">
            <span className="font-mono text-xs text-bone">{a.handler_username} → {a.operative_username}</span>
            <button onClick={() => remove(a.id)} className="font-mono text-[10px] text-ghost hover:text-bone transition-colors">REMOVE</button>
          </div>
        ))}
        {assignments.length === 0 && <p className="font-mono text-xs px-4 py-3 text-ghost">No assignments.</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TEAMS TAB  (orgId prop)
// ---------------------------------------------------------------------------
const _T_ROLE_COLORS = { OPERATIVE: '#00FF88', HANDLER: '#4A9EFF', CONTRACTOR: '#FF6B00', ADMIN: '#FF4500', ARCHITECT: '#FF4500' }

function TeamsTab({ orgId }) {
  const terms = usePlatformTerms()
  const [teams, setTeams]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [selectedTeam, setSelectedTeam] = useState(null)   // team detail from /teams/{id}
  const [teamLoading, setTeamLoading]   = useState(false)
  const [selectedOp, setSelectedOp]     = useState(null)   // operator detail
  const [opLoading, setOpLoading]       = useState(false)
  const [disbanding, setDisbanding]     = useState(null)

  const qp = orgId ? `?org_id=${orgId}` : ''
  const M  = 'JetBrains Mono, monospace'

  async function loadList() {
    setLoading(true)
    try { const r = await client.get(`/admin/teams${qp}`); setTeams(r.data) }
    catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { loadList() }, [orgId])

  async function openTeam(teamId) {
    setTeamLoading(true); setSelectedTeam(null); setSelectedOp(null)
    try { const r = await client.get(`/teams/${teamId}`); setSelectedTeam(r.data) }
    catch { /* ignore */ }
    finally { setTeamLoading(false) }
  }

  async function openOperator(userId) {
    if (selectedOp?.id === userId) { setSelectedOp(null); return }
    setOpLoading(true)
    try { const r = await client.get(`/admin/users/${userId}/detail`); setSelectedOp(r.data) }
    catch { /* ignore */ }
    finally { setOpLoading(false) }
  }

  async function disband(id) {
    setDisbanding(id)
    try {
      await client.delete(`/admin/teams/${id}`)
      await loadList()
      if (selectedTeam?.id === id) { setSelectedTeam(null); setSelectedOp(null) }
    } catch { /* ignore */ }
    finally { setDisbanding(null) }
  }

  // ── LIST VIEW ──
  if (!selectedTeam && !teamLoading) {
    return (
      <div style={{ width: '100%' }}>
        {loading ? (
          <p className="font-mono text-xs text-ghost">LOADING...</p>
        ) : teams.length === 0 ? (
          <p className="font-mono text-xs text-ghost py-4">No teams registered.</p>
        ) : (
          <div className="border border-ghost/20 rounded-sm overflow-hidden">
            <div className="grid px-4 py-2 border-b border-ghost/10 font-mono text-[10px] tracking-widest text-ghost"
              style={{ gridTemplateColumns: '1fr 70px 80px 110px 80px' }}>
              {['TEAM NAME', 'MEMBERS', 'TOTAL BC', 'FORMED', ''].map((h, i) => <span key={i}>{h}</span>)}
            </div>
            <div className="divide-y divide-ghost/10">
              {teams.map(s => (
                <div
                  key={s.id}
                  className="grid px-4 py-2.5 items-center cursor-pointer hover:bg-abyss/40 transition-colors"
                  style={{ gridTemplateColumns: '1fr 70px 80px 110px 80px' }}
                  onClick={() => openTeam(s.id)}
                >
                  <span className="font-mono text-sm text-bone truncate">{s.name}</span>
                  <span className="font-mono text-xs text-ghost">{s.member_count}</span>
                  <span className="font-mono text-xs text-ghost">{s.total_bc ?? 0}</span>
                  <span className="font-mono text-[9px] text-ghost/50">
                    {s.created_at ? new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase() : '—'}
                  </span>
                  <div className="flex justify-end">
                    <button
                      onClick={e => { e.stopPropagation(); disband(s.id) }}
                      disabled={disbanding === s.id}
                      className="font-mono text-[10px] text-danger hover:text-danger/80 transition-colors disabled:opacity-40"
                    >
                      {disbanding === s.id ? '...' : 'DISBAND'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── LOADING TEAM DETAIL ──
  if (teamLoading) {
    return <p className="font-mono text-xs text-ghost py-4">LOADING TEAM...</p>
  }

  // ── TEAM DETAIL VIEW ──
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <button
          onClick={() => { setSelectedTeam(null); setSelectedOp(null) }}
          style={{ fontFamily: M, fontSize: '9px', letterSpacing: '0.1em', color: '#6B6B80', background: 'none', border: '1px solid rgba(107,107,128,0.2)', padding: '4px 10px', cursor: 'pointer', flexShrink: 0 }}
          className="hover:border-ghost/40 transition-colors"
        >
          ← ALL TEAMS
        </button>
        <div style={{ flex: 1 }}>
          <span style={{ fontFamily: M, fontSize: '15px', color: '#F0F0F0', fontWeight: 'bold' }}>{selectedTeam.name}</span>
          {selectedTeam.invite_code && (
            <span style={{ fontFamily: M, fontSize: '9px', color: '#555', marginLeft: '10px' }}>
              CODE: {selectedTeam.invite_code}
            </span>
          )}
        </div>
        {/* Stats */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          {[
            ['TOTAL BC',  selectedTeam.total_bc],
            ['CLAIMS',    selectedTeam.claim_count],
            ['MEMBERS',   (selectedTeam.members || []).length],
          ].map(([label, val]) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: M, fontSize: '16px', color: '#F0F0F0', fontWeight: 'bold', lineHeight: 1 }}>{val}</div>
              <div style={{ fontFamily: M, fontSize: '8px', letterSpacing: '0.12em', color: '#555', marginTop: '3px' }}>{label}</div>
            </div>
          ))}
          <span style={{ fontFamily: M, fontSize: '9px', color: '#555', borderLeft: '1px solid rgba(107,107,128,0.15)', paddingLeft: '16px' }}>
            FORMED {selectedTeam.created_at ? new Date(selectedTeam.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase() : '—'}
          </span>
        </div>
        <button
          onClick={() => disband(selectedTeam.id)}
          disabled={disbanding === selectedTeam.id}
          style={{ fontFamily: M, fontSize: '9px', letterSpacing: '0.08em', padding: '5px 12px', border: '1px solid rgba(255,45,45,0.3)', color: '#FF2D2D', background: 'none', cursor: 'pointer', opacity: disbanding === selectedTeam.id ? 0.4 : 1, flexShrink: 0 }}
          className="hover:bg-red-500/10 transition-colors"
        >
          {disbanding === selectedTeam.id ? 'DISBANDING...' : '[ DISBAND TEAM ]'}
        </button>
      </div>

      {/* Body — members | claims | operator panel */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedOp ? '280px 1fr 280px' : '280px 1fr', gap: '14px', alignItems: 'start' }}>

        {/* Members list */}
        <div>
          <p style={{ fontFamily: M, fontSize: '9px', letterSpacing: '0.12em', color: '#6B6B80', marginBottom: '8px' }}>
            {terms.operator.toUpperCase()}S — {(selectedTeam.members || []).length}
          </p>
          <div style={{ border: '1px solid rgba(107,107,128,0.15)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 50px 60px', padding: '5px 10px', borderBottom: '1px solid rgba(107,107,128,0.1)', fontFamily: M, fontSize: '8px', letterSpacing: '0.1em', color: '#444' }}>
              <span>CALLSIGN</span><span>BC</span><span>JOINED</span>
            </div>
            {(selectedTeam.members || []).length === 0 && (
              <p style={{ fontFamily: M, fontSize: '10px', color: '#444', padding: '10px' }}>No members.</p>
            )}
            {(selectedTeam.members || []).map(m => (
              <button
                key={m.id}
                onClick={() => openOperator(m.id)}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 50px 60px',
                  width: '100%', padding: '8px 10px',
                  background: selectedOp?.id === m.id ? 'rgba(255,69,0,0.06)' : 'transparent',
                  border: 'none', borderBottom: '1px solid rgba(107,107,128,0.07)',
                  borderLeft: selectedOp?.id === m.id ? '2px solid #FF4500' : '2px solid transparent',
                  cursor: 'pointer', textAlign: 'left', alignItems: 'center',
                }}
                className="hover:bg-white/[0.025] transition-colors"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                  <span style={{ fontFamily: M, fontSize: '11px', color: '#E0E0E0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.username}</span>
                  {m.is_captain && (
                    <span style={{ fontFamily: M, fontSize: '7px', letterSpacing: '0.05em', color: '#FF4500', border: '1px solid rgba(255,69,0,0.35)', padding: '0 3px', flexShrink: 0 }}>CPT</span>
                  )}
                </div>
                <span style={{ fontFamily: M, fontSize: '10px', color: '#888' }}>{m.bc_total}</span>
                <span style={{ fontFamily: M, fontSize: '9px', color: '#555' }}>
                  {m.joined_at ? new Date(m.joined_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent claims */}
        <div>
          <p style={{ fontFamily: M, fontSize: '9px', letterSpacing: '0.12em', color: '#6B6B80', marginBottom: '8px' }}>
            RECENT CLAIMS
          </p>
          <div style={{ border: '1px solid rgba(107,107,128,0.15)' }}>
            {!selectedTeam.recent_claims?.length ? (
              <p style={{ fontFamily: M, fontSize: '10px', color: '#444', padding: '12px' }}>No claims for this event yet.</p>
            ) : selectedTeam.recent_claims.map((c, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 12px', borderBottom: '1px solid rgba(107,107,128,0.07)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: M, fontSize: '11px', color: '#E0E0E0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.is_first_blood && <span style={{ color: '#FF4500', marginRight: '5px', fontSize: '10px' }}>FIRST BLOOD</span>}
                    {c.contract_title}
                  </p>
                  <p style={{ fontFamily: M, fontSize: '9px', color: '#555', marginTop: '2px' }}>
                    {c.operative_username}
                    {c.contract_category && <span style={{ color: '#444', marginLeft: '6px' }}>[{c.contract_category}]</span>}
                    {c.claimed_at && <span style={{ marginLeft: '6px' }}>{new Date(c.claimed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                  </p>
                </div>
                <span style={{ fontFamily: M, fontSize: '12px', color: '#00FF88', fontWeight: 'bold', flexShrink: 0 }}>
                  +{c.bc_earned}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Operator detail panel */}
        {selectedOp && (
          <div style={{ border: '1px solid rgba(107,107,128,0.2)', background: '#0d0d0d', position: 'relative' }}>
            {/* Panel header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(107,107,128,0.12)' }}>
              <span style={{ fontFamily: M, fontSize: '9px', letterSpacing: '0.12em', color: '#555' }}>OPERATOR PROFILE</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => openOperator(selectedOp.id)}
                  disabled={opLoading}
                  title="Refresh profile"
                  style={{ fontFamily: M, fontSize: '11px', color: '#555', background: 'none', border: 'none', cursor: opLoading ? 'not-allowed' : 'pointer', lineHeight: 1, opacity: opLoading ? 0.4 : 1 }}
                  className="hover:text-ghost transition-colors"
                >↺</button>
                <button
                  onClick={() => setSelectedOp(null)}
                  style={{ fontFamily: M, fontSize: '12px', color: '#555', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}
                  className="hover:text-ghost transition-colors"
                >×</button>
              </div>
            </div>

            {opLoading ? (
              <p style={{ fontFamily: M, fontSize: '10px', color: '#444', padding: '14px' }}>LOADING...</p>
            ) : (
              <div style={{ padding: '14px' }}>
                {/* Identity */}
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                    <span style={{ fontFamily: M, fontSize: '14px', color: '#FF4500', fontWeight: 'bold' }}>{selectedOp.username}</span>
                    {(() => {
                      const mem = selectedTeam.members?.find(m => m.id === selectedOp.id)
                      return mem?.is_captain ? (
                        <span style={{ fontFamily: M, fontSize: '8px', color: '#FF4500', border: '1px solid rgba(255,69,0,0.4)', padding: '1px 4px' }}>CAPTAIN</span>
                      ) : null
                    })()}
                  </div>
                  <p style={{ fontFamily: M, fontSize: '10px', color: '#555' }}>{selectedOp.email}</p>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: M, fontSize: '8px', color: _T_ROLE_COLORS[selectedOp.role] || '#888', border: `1px solid ${(_T_ROLE_COLORS[selectedOp.role] || '#888')}40`, padding: '1px 5px' }}>
                      {selectedOp.role}
                    </span>
                    <span style={{ fontFamily: M, fontSize: '8px', color: selectedOp.is_banned ? '#FF2D2D' : selectedOp.is_online ? '#00FF88' : '#6B6B80', border: `1px solid ${selectedOp.is_banned ? 'rgba(255,45,45,0.3)' : selectedOp.is_online ? 'rgba(0,255,136,0.3)' : 'rgba(107,107,128,0.2)'}`, padding: '1px 5px' }}>
                      {selectedOp.is_banned ? 'BANNED' : selectedOp.is_online ? '● ONLINE' : 'OFFLINE'}
                    </span>
                    {selectedOp.clearance_level && (
                      <span style={{ fontFamily: M, fontSize: '8px', color: '#4A9EFF', border: '1px solid rgba(74,158,255,0.3)', padding: '1px 5px' }}>
                        {selectedOp.clearance_level}
                      </span>
                    )}
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid rgba(107,107,128,0.12)' }}>
                  {[['BC', selectedOp.bc_total ?? 0], ['CLAIMS', selectedOp.claim_count ?? 0], ['HINTS', selectedOp.intel_purchase_count ?? 0]].map(([label, val]) => (
                    <div key={label} style={{ textAlign: 'center', padding: '6px', border: '1px solid rgba(107,107,128,0.1)' }}>
                      <div style={{ fontFamily: M, fontSize: '14px', color: '#E0E0E0', fontWeight: 'bold', lineHeight: 1 }}>{val}</div>
                      <div style={{ fontFamily: M, fontSize: '8px', letterSpacing: '0.1em', color: '#555', marginTop: '3px' }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Field rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[
                    ['FULL NAME',  selectedOp.full_name],
                    ['STUDENT ID', selectedOp.student_id],
                    ['YEAR LEVEL', selectedOp.year_level],
                    ['SCHOOL',     selectedOp.school],
                    ['SECTION',    selectedOp.section],
                    ['VOID BC',    selectedOp.void_bc || 0],
                    ['LAST LOGIN', selectedOp.last_login ? new Date(selectedOp.last_login).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null],
                    ['JOINED TEAM', (() => { const m = selectedTeam.members?.find(x => x.id === selectedOp.id); return m?.joined_at ? new Date(m.joined_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null })()],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontFamily: M, fontSize: '9px', color: '#555', letterSpacing: '0.05em' }}>{label}</span>
                      <span style={{ fontFamily: M, fontSize: '10px', color: val ? '#C0C0C0' : '#333' }}>{val ?? '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EVENT ARCHIVE TAB — archive view + reset flow (scoped org view)
// ---------------------------------------------------------------------------
function EventArchiveTab() {
  const [events, setEvents] = useState([])
  const [cooldown, setCooldown] = useState({ can_reset: true, seconds_remaining: 0 })
  const [resetStep, setResetStep] = useState(0)
  const [resetLevel, setResetLevel] = useState(1)
  const [resetting, setResetting] = useState(false)

  async function load() {
    try {
      const [s, c] = await Promise.all([client.get('/admin/events'), client.get('/admin/reset/cooldown')])
      setEvents(s.data)
      setCooldown(c.data)
    } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [])

  async function executeReset() {
    setResetting(true)
    try { await client.post('/admin/reset', { level: resetLevel }); setResetStep(0); await load() } catch { /* ignore */ }
    finally { setResetting(false) }
  }

  async function downloadBackup(id) {
    try {
      const r = await client.get(`/admin/events/${id}/backup`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a'); a.href = url; a.download = `event-${id}-backup.json`; a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  const RESET_LEVELS = [
    [1, 'SOFT',   'Reset BC only. Keep contracts + teams.'],
    [2, 'MEDIUM', 'Reset BC + unpublish contracts. Keep teams.'],
    [3, 'HARD',   'Full reset. Delete teams, reset all progress.'],
  ]

  return (
    <div className="max-w-2xl space-y-6">
      {/* Event archive */}
      <div className="border border-ghost/20 rounded-sm overflow-hidden">
        <p className="font-mono text-[10px] tracking-widest px-4 py-2 border-b border-ghost/10 text-ghost">EVENT ARCHIVE</p>
        <div className="divide-y divide-ghost/10">
          {events.map(s => (
            <div key={s.id} className="flex justify-between items-center px-4 py-2.5">
              <span className="font-mono text-sm text-bone">Event {s.id} — {s.name || 'Unnamed'}</span>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] text-ghost">{s.status}</span>
                <button onClick={() => downloadBackup(s.id)} className="font-mono text-[10px] border border-ghost/20 text-ghost px-2 py-0.5 hover:border-ghost/40 transition-colors">BACKUP</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Reset flow */}
      <div className="border border-danger/20 p-4 space-y-3">
        <p className="font-mono text-[10px] tracking-widest text-danger">COMPETITION RESET</p>
        {!cooldown.can_reset && (
          <p className="font-mono text-xs text-ghost">Cooldown active — {cooldown.seconds_remaining}s remaining</p>
        )}
        {resetStep === 0 && (
          <button onClick={() => setResetStep(1)} disabled={!cooldown.can_reset} className="font-mono text-xs text-danger px-4 py-2 border border-danger/30 disabled:opacity-30">
            [ INITIATE RESET ]
          </button>
        )}
        {resetStep === 1 && (
          <div className="space-y-2">
            {RESET_LEVELS.map(([lvl, name, desc]) => (
              <button key={lvl} onClick={() => setResetLevel(lvl)}
                className={`w-full text-left font-mono text-xs px-3 py-2 border transition-all ${
                  resetLevel === lvl ? 'border-danger text-danger' : 'border-ghost/20 text-ghost'
                }`}>
                L{lvl} — {name}: {desc}
              </button>
            ))}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setResetStep(2)} className="font-mono text-xs text-danger px-4 py-1.5 border border-danger/30">CONFIRM LEVEL →</button>
              <button onClick={() => setResetStep(0)} className="font-mono text-xs text-ghost px-4 py-1.5 border border-ghost/20">ABORT</button>
            </div>
          </div>
        )}
        {resetStep === 2 && (
          <div className="space-y-2">
            <p className="font-mono text-xs text-danger">⚠ FINAL CONFIRMATION — L{resetLevel} reset will begin</p>
            <div className="flex gap-2">
              <button onClick={executeReset} disabled={resetting} className="font-mono text-xs text-danger px-4 py-1.5 border border-danger/60 disabled:opacity-40">
                {resetting ? 'RESETTING...' : '[ EXECUTE RESET ]'}
              </button>
              <button onClick={() => setResetStep(0)} className="font-mono text-xs text-ghost px-4 py-1.5 border border-ghost/20">ABORT</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CHANGE LOGS TAB
// ---------------------------------------------------------------------------
const ACTION_CATEGORIES = ['ALL', 'USERS', 'EVENTS', 'CONTRACTS', 'SETTINGS']

function ChangeLogsTab() {
  const [orgs,       setOrgs]       = useState([])
  const [logs,       setLogs]       = useState([])
  const [orgFilter,  setOrgFilter]  = useState(null)   // null = ALL
  const [category,   setCategory]   = useState('ALL')
  const [dateFrom,   setDateFrom]   = useState('')
  const [dateTo,     setDateTo]     = useState('')
  const [expanded,   setExpanded]   = useState(null)   // log id
  const [loading,    setLoading]    = useState(false)
  const [exporting,  setExporting]  = useState(false)

  // Load orgs once
  useEffect(() => {
    client.get('/organizations').then(r => setOrgs(r.data || [])).catch(() => {})
  }, [])

  // Load logs whenever filters change
  useEffect(() => {
    const params = new URLSearchParams()
    if (orgFilter)            params.set('org_id',    orgFilter)
    if (category !== 'ALL')   params.set('category',  category)
    if (dateFrom)             params.set('date_from', dateFrom)
    if (dateTo)               params.set('date_to',   dateTo)
    setLoading(true)
    client.get('/architect/log?' + params.toString())
      .then(r => setLogs(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [orgFilter, category, dateFrom, dateTo])

  async function handleExport() {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      if (orgFilter)          params.set('org_id',    orgFilter)
      if (category !== 'ALL') params.set('category',  category)
      if (dateFrom)           params.set('date_from', dateFrom)
      if (dateTo)             params.set('date_to',   dateTo)
      const r = await client.get('/architect/log/export?' + params.toString(), { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `change-logs-${new Date().toISOString().slice(0,10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ } finally { setExporting(false) }
  }

  function fmtTs(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  return (
    <div className="flex gap-4 h-full">
      {/* Left sidebar — org selector */}
      <div className="w-44 shrink-0 space-y-1">
        <p className="font-mono text-[10px] tracking-widest mb-2 text-ghost">FILTER BY ORG</p>
        <button
          onClick={() => setOrgFilter(null)}
          className={`font-mono text-[10px] tracking-widest w-full text-left px-2 py-1.5 transition-all border-l-2 ${
            orgFilter === null ? 'text-ember bg-ember/8 border-ember' : 'text-ghost bg-transparent border-transparent'
          }`}
        >
          ALL ORGANIZATIONS
        </button>
        {orgs.map(o => (
          <button
            key={o.id}
            onClick={() => setOrgFilter(o.id)}
            className={`font-mono text-[10px] tracking-widest w-full text-left px-2 py-1.5 transition-all border-l-2 truncate ${
              orgFilter === o.id ? 'text-ember bg-ember/8 border-ember' : 'text-ghost bg-transparent border-transparent'
            }`}
          >
            {o.org_code || o.name}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-3">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          {ACTION_CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`font-mono text-[10px] tracking-widest px-3 py-1 border transition-all ${
                category === c ? 'border-ember text-ember bg-ember/8' : 'border-ghost/30 text-ghost'
              }`}
            >
              {c}
            </button>
          ))}
          <input
            type="date"
            className="font-mono text-[10px] bg-void border border-ghost/20 text-ghost px-1.5 py-0.5 outline-none focus:border-ghost/40"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
          <span className="font-mono text-[10px] text-ghost">—</span>
          <input
            type="date"
            className="font-mono text-[10px] bg-void border border-ghost/20 text-ghost px-1.5 py-0.5 outline-none focus:border-ghost/40"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
          <button
            onClick={handleExport}
            disabled={exporting || logs.length === 0}
            className="font-mono text-[10px] tracking-widest px-3 py-1 border border-ghost/20 text-ghost transition-all ml-auto disabled:opacity-30 hover:border-ghost/50"
          >
            {exporting ? '...' : '[ EXPORT LOGS ]'}
          </button>
        </div>

        {/* Table header */}
        <div className="font-mono text-[10px] tracking-widest grid px-3 py-1.5 text-ghost border-b border-ghost/20"
          style={{ gridTemplateColumns: '140px 60px 1fr 100px' }}
        >
          <span>TIMESTAMP</span><span>ORG</span><span>ACTION</span><span>PERFORMED BY</span>
        </div>

        {/* Log entries */}
        <div className="border border-ghost/20 rounded-sm overflow-hidden">
          {loading ? (
            <p className="font-mono text-xs px-4 py-4 animate-pulse text-ghost">LOADING...</p>
          ) : logs.length === 0 ? (
            <p className="font-mono text-xs px-4 py-4 text-ghost">No entries found.</p>
          ) : (
            <div className="divide-y divide-ghost/10 max-h-[55vh] overflow-y-auto">
              {logs.map(l => (
                <div key={l.id}>
                  <button
                    onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                    className="w-full text-left px-3 py-2.5 grid transition-all hover:bg-white/[0.02]"
                    style={{ gridTemplateColumns: '140px 60px 1fr 100px' }}
                  >
                    <span className="font-mono text-[10px] text-ghost">{fmtTs(l.timestamp)}</span>
                    <span className="font-mono text-[10px] font-bold text-[#4A9EFF]">
                      {l.org_code || '—'}
                    </span>
                    <span className="font-mono text-xs font-bold text-ember">{l.action}</span>
                    <span className="font-mono text-[10px] text-ghost">{l.performed_by}</span>
                  </button>
                  {expanded === l.id && (
                    <div className="px-4 py-3 space-y-1.5 text-left bg-white/[0.02] border-t border-ghost/10">
                      {l.target && (
                        <div className="flex gap-3">
                          <span className="font-mono text-[10px] shrink-0 text-ghost">TARGET</span>
                          <span className="font-mono text-[10px] text-bone">{l.target}</span>
                        </div>
                      )}
                      {l.org_name && (
                        <div className="flex gap-3">
                          <span className="font-mono text-[10px] shrink-0 text-ghost">ORG</span>
                          <span className="font-mono text-[10px] text-bone">{l.org_name}</span>
                        </div>
                      )}
                      {l.ip && (
                        <div className="flex gap-3">
                          <span className="font-mono text-[10px] shrink-0 text-ghost">IP</span>
                          <span className="font-mono text-[10px] text-bone">{l.ip}</span>
                        </div>
                      )}
                      {l.extra && Object.keys(l.extra).length > 0 && (
                        <div className="mt-2">
                          <p className="font-mono text-[10px] mb-1 text-ghost">DETAILS</p>
                          <div className="space-y-0.5 pl-2">
                            {Object.entries(l.extra).map(([k, v]) => (
                              <div key={k} className="flex gap-3">
                                <span className="font-mono text-[10px] shrink-0 text-[#4A9EFF]">{k}</span>
                                <span className="font-mono text-[10px] text-bone break-all">{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="font-mono text-[10px] text-ghost">{logs.length} entries</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ARCH LOG TAB
// ---------------------------------------------------------------------------
function ArchLogTab() {
  const [logs, setLogs] = useState([])
  const [clearing, setClearing] = useState(false)

  async function load() {
    try { const r = await client.get('/architect/log'); setLogs(r.data) } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [])

  async function clearLog() {
    setClearing(true)
    try { await client.delete('/architect/log'); await load() } catch { /* ignore */ }
    finally { setClearing(false) }
  }

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] tracking-widest text-ghost">ARCHITECT ACTION LOG — {logs.length} entries</p>
        <button
          onClick={clearLog}
          disabled={clearing || logs.length === 0}
          className="font-mono text-[10px] tracking-widest px-3 py-1 border border-ghost/20 text-ghost disabled:opacity-30 transition-all hover:border-ghost/50"
        >
          {clearing ? '...' : '[ CLEAR LOG ]'}
        </button>
      </div>
      <div className="border border-ghost/20 rounded-sm overflow-hidden">
        {logs.length === 0 ? (
          <p className="font-mono text-xs px-4 py-4 text-ghost">No entries recorded.</p>
        ) : (
          <div className="divide-y divide-ghost/10 max-h-[60vh] overflow-y-auto">
            {logs.map(l => (
              <div key={l.id} className="px-4 py-2.5 grid grid-cols-[140px_1fr_1fr]">
                <span className="font-mono text-[10px] text-ghost">{fmtDateTime(l.timestamp)}</span>
                <span className="font-mono text-xs font-bold text-ember">{l.action}</span>
                <span className="font-mono text-xs text-ghost truncate">{l.target || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LIBRARY TAB — all contracts across all orgs
// ---------------------------------------------------------------------------
const RARITY_COLOR = { COMMON: '#8A8A9A', RARE: '#4A9EFF', CLASSIFIED: '#FF2D2D' }
const CONTRACT_CATEGORIES = [
  'Web','Cryptography','Forensics','Pwn','Misc','OSINT','Reverse Engineering',
  'SQL Injection','Steganography','Network','Mobile','Cloud','Blockchain',
  'Hardware','Binary Exploitation','Social Engineering',
]

function LibraryTab() {
  const G = 'Geist, sans-serif'
  const M = 'JetBrains Mono, monospace'

  const [contracts, setContracts] = useState([])
  const [orgs,      setOrgs]      = useState([])
  const [loading,   setLoading]   = useState(false)

  // Filters
  const [orgFilter,    setOrgFilter]    = useState('')
  const [statusFilter, setStatusFilter] = useState('all')   // all | published | unpublished
  const [catFilter,    setCatFilter]    = useState('')
  const [search,       setSearch]       = useState('')
  const [searchInput,  setSearchInput]  = useState('')

  // Sorting
  const [sortKey,  setSortKey]  = useState('created_at')
  const [sortDir,  setSortDir]  = useState('desc')

  // Expanded row
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    client.get('/organizations').then(r => setOrgs(r.data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (orgFilter)               params.set('org_id',   orgFilter)
    if (statusFilter !== 'all')  params.set('status',   statusFilter)
    if (catFilter)               params.set('category', catFilter)
    if (search)                  params.set('search',   search)
    client.get(`/architect/library?${params}`)
      .then(r => setContracts(r.data || []))
      .catch(() => setContracts([]))
      .finally(() => setLoading(false))
  }, [orgFilter, statusFilter, catFilter, search])

  // Client-side sort
  const sorted = [...contracts].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey]
    if (av == null) av = ''
    if (bv == null) bv = ''
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function SortIcon({ col }) {
    if (sortKey !== col) return <span style={{ color: '#2a2a2a', marginLeft: 4 }}>↕</span>
    return <span style={{ color: '#f97316', marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const thStyle = (col) => ({
    fontFamily: G, fontSize: '10px', fontWeight: 600, color: '#444444',
    letterSpacing: '0.07em', textTransform: 'uppercase', padding: '8px 12px',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
    background: sortKey === col ? '#161616' : 'transparent',
  })

  return (
    <div className="flex flex-col gap-4 p-6" style={{ minHeight: 0 }}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 style={{ fontFamily: G, fontSize: '14px', fontWeight: 700, color: '#e5e5e5', letterSpacing: '0.04em' }}>
            CONTRACT LIBRARY
          </h2>
          <p style={{ fontFamily: G, fontSize: '11px', color: '#555555', marginTop: 2 }}>
            All contracts across all organizations — published and unpublished
          </p>
        </div>
        <span style={{ fontFamily: M, fontSize: '11px', color: '#555555' }}>
          {loading ? '...' : `${sorted.length} contract${sorted.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Search */}
        <form onSubmit={e => { e.preventDefault(); setSearch(searchInput) }} style={{ display: 'flex', gap: 4 }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search title / description…"
            style={{
              fontFamily: M, fontSize: '11px', background: '#111111', border: '1px solid #222222',
              color: '#e5e5e5', padding: '5px 10px', outline: 'none', width: '220px',
            }}
            onBlur={() => { if (!searchInput) setSearch('') }}
          />
          <button
            type="submit"
            style={{ fontFamily: G, fontSize: '11px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#888888', padding: '5px 10px' }}
          >Search</button>
          {search && (
            <button type="button" onClick={() => { setSearch(''); setSearchInput('') }}
              style={{ fontFamily: G, fontSize: '11px', color: '#555555', background: 'transparent', border: 'none', cursor: 'pointer' }}>
              ✕
            </button>
          )}
        </form>

        {/* Org filter */}
        <select
          value={orgFilter}
          onChange={e => setOrgFilter(e.target.value)}
          style={{ fontFamily: G, fontSize: '11px', background: '#111111', border: '1px solid #222222', color: orgFilter ? '#e5e5e5' : '#555555', padding: '5px 10px', outline: 'none' }}
        >
          <option value="">All Organizations</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.org_code || o.name}</option>)}
        </select>

        {/* Status filter */}
        {['all', 'published', 'unpublished'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              fontFamily: G, fontSize: '11px', padding: '5px 12px',
              background: statusFilter === s ? 'rgba(249,115,22,0.12)' : '#111111',
              border: `1px solid ${statusFilter === s ? '#f97316' : '#222222'}`,
              color: statusFilter === s ? '#f97316' : '#555555',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}
          >
            {s === 'all' ? 'All' : s}
          </button>
        ))}

        {/* Category filter */}
        <select
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
          style={{ fontFamily: G, fontSize: '11px', background: '#111111', border: '1px solid #222222', color: catFilter ? '#e5e5e5' : '#555555', padding: '5px 10px', outline: 'none' }}
        >
          <option value="">All Categories</option>
          {CONTRACT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="arch-card" style={{ background: '#111111', border: '1px solid #1f1f1f', overflow: 'hidden' }}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <span style={{ fontFamily: M, fontSize: '12px', color: '#333333' }}>Loading library…</span>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <span style={{ fontFamily: G, fontSize: '12px', color: '#333333' }}>No contracts match the current filters.</span>
          </div>
        ) : (
          <div className="arch-scroll overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#111111' }}>
                <tr style={{ borderBottom: '1px solid #1f1f1f' }}>
                  <th style={thStyle('title')}      onClick={() => toggleSort('title')}>Title <SortIcon col="title" /></th>
                  <th style={thStyle('category')}   onClick={() => toggleSort('category')}>Category <SortIcon col="category" /></th>
                  <th style={thStyle('rarity')}     onClick={() => toggleSort('rarity')}>Rarity <SortIcon col="rarity" /></th>
                  <th style={thStyle('base_bc_value')} onClick={() => toggleSort('base_bc_value')}>BC <SortIcon col="base_bc_value" /></th>
                  <th style={thStyle('org_name')}   onClick={() => toggleSort('org_name')}>Organization <SortIcon col="org_name" /></th>
                  <th style={thStyle('event_name')} onClick={() => toggleSort('event_name')}>Event <SortIcon col="event_name" /></th>
                  <th style={thStyle('creator_username')} onClick={() => toggleSort('creator_username')}>Creator <SortIcon col="creator_username" /></th>
                  <th style={thStyle('claim_count')} onClick={() => toggleSort('claim_count')}>Claims <SortIcon col="claim_count" /></th>
                  <th style={thStyle('created_at')} onClick={() => toggleSort('created_at')}>Created <SortIcon col="created_at" /></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(c => {
                  const isExp = expanded === c.id
                  return (
                    <Fragment key={c.id}>
                      <tr
                        style={{
                          borderBottom: '1px solid #161616', cursor: 'pointer',
                          background: isExp ? '#161616' : 'transparent',
                        }}
                        onClick={() => setExpanded(isExp ? null : c.id)}
                        onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = '#141414' }}
                        onMouseLeave={e => { if (!isExp) e.currentTarget.style.background = 'transparent' }}
                      >
                        <td style={{ padding: '9px 12px', fontFamily: M, fontSize: '12px', color: '#e5e5e5', maxWidth: '220px' }}>
                          <span className="block truncate">{c.title}</span>
                          {(c.intel_count > 0 || c.attachments > 0) && (
                            <span style={{ fontFamily: G, fontSize: '10px', color: '#444444' }}>
                              {c.intel_count > 0 && `${c.intel_count} intel`}
                              {c.intel_count > 0 && c.attachments > 0 && ' · '}
                              {c.attachments > 0 && `${c.attachments} file${c.attachments !== 1 ? 's' : ''}`}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '9px 12px', fontFamily: G, fontSize: '11px', color: '#888888', whiteSpace: 'nowrap' }}>{c.category}</td>
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontFamily: M, fontSize: '10px', fontWeight: 700, color: RARITY_COLOR[c.rarity] || '#8A8A9A', letterSpacing: '0.06em' }}>
                            {c.rarity}
                          </span>
                        </td>
                        <td style={{ padding: '9px 12px', fontFamily: M, fontSize: '12px', color: '#f97316', textAlign: 'right' }}>{c.base_bc_value}</td>
                        <td style={{ padding: '9px 12px', fontFamily: G, fontSize: '11px', color: '#888888', maxWidth: '160px' }}>
                          <span className="block truncate">{c.org_name || <span style={{ color: '#333' }}>—</span>}</span>
                          {c.org_code && <span style={{ fontSize: '10px', color: '#444444', fontFamily: M }}>{c.org_code}</span>}
                        </td>
                        <td style={{ padding: '9px 12px', fontFamily: G, fontSize: '11px', color: '#888888', maxWidth: '140px' }}>
                          {c.event_name ? (
                            <span className="block truncate">
                              {c.event_name}
                              {c.event_status === 'ACTIVE' && (
                                <span style={{ fontFamily: M, fontSize: '9px', color: '#22c55e', marginLeft: 4 }}>● LIVE</span>
                              )}
                            </span>
                          ) : <span style={{ color: '#333' }}>—</span>}
                        </td>
                        <td style={{ padding: '9px 12px', fontFamily: M, fontSize: '11px', color: c.creator_username ? '#e5e5e5' : '#333333', whiteSpace: 'nowrap' }}>
                          {c.creator_username || <span style={{ color: '#333' }}>—</span>}
                        </td>
                        <td style={{ padding: '9px 12px', fontFamily: M, fontSize: '12px', color: c.claim_count > 0 ? '#e5e5e5' : '#333333', textAlign: 'right' }}>{c.claim_count}</td>
                        <td style={{ padding: '9px 12px', fontFamily: G, fontSize: '11px', color: '#555555', whiteSpace: 'nowrap' }}>{fmtDate(c.created_at)}</td>
                      </tr>
                      {isExp && (
                        <tr style={{ background: '#131313', borderBottom: '1px solid #1f1f1f' }}>
                          <td colSpan={9} style={{ padding: '12px 16px' }}>
                            <div className="flex gap-6 flex-wrap">
                              <div>
                                <span style={{ fontFamily: G, fontSize: '10px', color: '#444444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Contract ID</span>
                                <p style={{ fontFamily: M, fontSize: '11px', color: '#888888', marginTop: 2 }}>{c.id}</p>
                              </div>
                              {c.tags?.length > 0 && (
                                <div>
                                  <span style={{ fontFamily: G, fontSize: '10px', color: '#444444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tags</span>
                                  <div className="flex gap-1 flex-wrap mt-1">
                                    {c.tags.map(t => (
                                      <span key={t} style={{ fontFamily: M, fontSize: '10px', color: '#888888', background: '#1a1a1a', border: '1px solid #222222', padding: '1px 6px' }}>{t}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {c.first_claimed_at && (
                                <div>
                                  <span style={{ fontFamily: G, fontSize: '10px', color: '#444444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>First Claimed</span>
                                  <p style={{ fontFamily: M, fontSize: '11px', color: '#22c55e', marginTop: 2 }}>{fmtDateTime(c.first_claimed_at)}</p>
                                </div>
                              )}
                              {c.updated_at && (
                                <div>
                                  <span style={{ fontFamily: G, fontSize: '10px', color: '#444444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Last Updated</span>
                                  <p style={{ fontFamily: M, fontSize: '11px', color: '#555555', marginTop: 2 }}>{fmtDateTime(c.updated_at)}</p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LOGS TAB — merged wrapper for ChangeLogsTab + ArchLogTab
// ---------------------------------------------------------------------------
function LogsTab() {
  const [subTab, setSubTab] = useState('changelogs')
  return (
    <div className="space-y-4">
      <div className="flex border-b border-ghost/20">
        {[['changelogs', 'PLATFORM CHANGES'], ['archlog', 'ARCHITECT LOG']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`font-mono text-[10px] tracking-widest px-5 py-2.5 transition-all border-b-2 ${
              subTab === key ? 'text-ember border-ember' : 'text-ghost border-transparent'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {subTab === 'changelogs' && <ChangeLogsTab />}
      {subTab === 'archlog'    && <ArchLogTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// V01D TAB
// ---------------------------------------------------------------------------
function VoidTab() {
  const [overview, setOverview] = useState(null)
  const [contracts, setContracts] = useState([])
  const [operatives, setOperatives] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [toggling, setToggling] = useState(null)

  async function load() {
    try {
      const [ov, ct, nr] = await Promise.all([
        client.get('/v01d/admin/overview'),
        client.get('/v01d/admin/contracts'),
        client.get('/v01d/admin/operatives'),
      ])
      setOverview(ov.data)
      setContracts(ct.data)
      setOperatives(nr.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function handleToggle(contractId) {
    setToggling(contractId)
    try { await client.patch(`/v01d/admin/contracts/${contractId}/toggle`); await load() } catch { /* ignore */ }
    finally { setToggling(null) }
  }

  async function handleResetAttempts(operativeID, contractId) {
    try { await client.delete(`/v01d/admin/attempts/${operativeID}/${contractId}`); await load() } catch { /* ignore */ }
  }

  if (loading) return <div className="font-mono text-xs animate-pulse text-ghost">LOADING...</div>

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Overview */}
      <div className="border border-bone/20 rounded-sm p-5 bg-void/60">
        <p className="font-mono text-[10px] tracking-widest mb-4 text-bone/50">V01D OVERVIEW</p>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'TOTAL VOID BC',        val: overview?.total_void_bc_distributed ?? 0 },
            { label: 'TOTAL CLAIMS',          val: overview?.total_void_claims ?? 0 },
            { label: 'OPERATORS W/ ACCESS',   val: overview?.operatives_with_access ?? 0 },
            { label: 'LOCKED OPERATORS',      val: overview?.locked_operatives ?? 0 },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="font-mono font-bold text-2xl text-bone/85">{s.val}</div>
              <div className="font-mono text-[10px] tracking-widest text-ghost">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Contracts */}
      <div>
        <p className="font-mono text-[10px] tracking-widest mb-3 text-ghost">VOID CONTRACTS</p>
        <div className="border border-ghost/20 rounded-sm overflow-hidden">
          <div className="divide-y divide-ghost/10">
            {contracts.map(c => (
              <div key={c.id}>
                <div
                  className="flex items-center justify-between px-4 py-3 hover:bg-abyss/40 cursor-pointer"
                  onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                >
                  <div>
                    <span className="font-mono text-sm text-bone">{c.title}</span>
                    <span className="font-mono text-xs ml-3 text-ghost">{c.claim_count} claims</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-mono text-[10px] px-2 py-0.5 border ${
                      c.is_published ? 'border-success/40 text-success' : 'border-ghost/30 text-ghost'
                    }`}>
                      {c.is_published ? 'ACTIVE' : 'DISABLED'}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); handleToggle(c.id) }}
                      disabled={toggling === c.id}
                      className="font-mono text-[10px] border border-ghost/20 text-ghost px-2 py-0.5 transition-all disabled:opacity-40 hover:border-ghost/40"
                    >
                      {toggling === c.id ? '...' : c.is_published ? 'DISABLE' : 'ENABLE'}
                    </button>
                  </div>
                </div>
                {expanded === c.id && c.claims.length > 0 && (
                  <div className="px-4 pb-3 bg-abyss/30 border-t border-ghost/10 pt-3 space-y-1">
                    {c.claims.map((cl, i) => (
                      <div key={i} className="flex justify-between items-center">
                        <span className="font-mono text-xs text-bone">{cl.callsign}</span>
                        <div className="flex items-center gap-4">
                          {cl.attempts > 0 && <span className="font-mono text-xs text-ghost/60">{cl.attempts} failed</span>}
                          <span className="font-mono text-xs text-ghost">{fmtDateTime(cl.claimed_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {expanded === c.id && c.claims.length === 0 && (
                  <div className="px-4 pb-3 bg-abyss/30 border-t border-ghost/10 pt-3">
                    <p className="font-mono text-xs text-ghost/50">No claims yet.</p>
                  </div>
                )}
                {expanded === c.id && c.locked_operatives?.length > 0 && (
                  <div className="px-4 pb-3 bg-abyss/20 border-t border-ember/20 pt-3">
                    <p className="font-mono text-[10px] tracking-widest mb-2 text-ember">LOCKED OPERATORS</p>
                    <div className="space-y-1.5">
                      {c.locked_operatives.map((ln, i) => (
                        <div key={i} className="flex justify-between items-center">
                          <span className="font-mono text-xs text-ember">{ln.callsign}</span>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-xs text-ghost">{ln.attempts}/5 attempts</span>
                            <button
                              onClick={() => handleResetAttempts(ln.operative_id, c.id)}
                              className="font-mono text-[10px] border border-ghost/20 text-ghost px-2 py-0.5 transition-all hover:border-ghost/40"
                            >
                              RESET
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Void Operatives */}
      {operatives.length > 0 && (
        <div>
          <p className="font-mono text-[10px] tracking-widest mb-3 text-ghost">OPERATORS WITH V01D ACCESS</p>
          <div className="border border-ghost/20 rounded-sm overflow-hidden">
            <div className="grid grid-cols-[1fr_80px_100px_120px] px-4 py-2 border-b border-ghost/10 font-mono text-[10px] tracking-widest text-ghost">
              {['CALLSIGN', 'VOID BC', 'CONTRACTS', 'FIRST ACCESS'].map(h => <span key={h}>{h}</span>)}
            </div>
            <div className="divide-y divide-ghost/10">
              {operatives.map(nr => (
                <div key={nr.id} className="grid grid-cols-[1fr_80px_100px_120px] px-4 py-3 items-center">
                  <span className="font-mono text-sm text-bone/80">{nr.callsign}</span>
                  <span className="font-mono text-xs text-ghost">{nr.void_bc}</span>
                  <span className="font-mono text-xs text-ghost">{nr.contracts_solved}</span>
                  <span className="font-mono text-[10px] text-ghost">{fmtDate(nr.first_access)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CREATE ORGANIZATION MODAL — 2-step flow
// ---------------------------------------------------------------------------
function CreateOrganizationModal({ onClose, onCreated }) {
  const [step, setStep] = useState(1)          // 1 = details, 2 = admin invite, 3 = success
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Step 1 form
  const [orgForm, setOrgForm] = useState({ name: '', org_code: '', description: '' })
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const logoInputRef = useRef(null)
  // Created organization (returned after step 1)
  const [newOrg, setNewOrg] = useState(null)

  // Step 2 form
  const [adminForm, setAdminForm] = useState({ username: '', email: '' })
  const [inviteResult, setInviteResult] = useState(null)

  async function handleCreateOrganization() {
    if (!orgForm.name.trim()) return
    setSaving(true)
    setError('')
    try {
      const r = await client.post('/organizations', {
        name: orgForm.name.trim(),
        org_code: orgForm.org_code.trim() || undefined,
        description: orgForm.description.trim() || undefined,
      })
      // Upload logo if one was selected
      if (logoFile) {
        try {
          const logoRes = await uploadLogo(r.data.id, logoFile)
          r.data.logo_url = logoRes.logo_url
          r.data.updated_at = logoRes.updated_at
        } catch { /* logo failure is non-fatal */ }
      }
      setNewOrg(r.data)
      onCreated?.(r.data)  // pass new org to parent so it can auto-open workspace
      setStep(2)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to create organization.')
    } finally {
      setSaving(false)
    }
  }

  async function handleInviteAdmin() {
    if (!adminForm.username.trim() || !adminForm.email.trim()) return
    setSaving(true)
    setError('')
    try {
      const r = await client.post(`/architect/organizations/${newOrg.id}/invite-admin`, {
        username: adminForm.username.trim(),
        email: adminForm.email.trim(),
      })
      setInviteResult(r.data)
      setStep(3)
    } catch (e) {
      const detail = e?.response?.data?.detail || ''
      if (detail === 'USERNAME_TAKEN') setError('Callsign already in use.')
      else if (detail === 'EMAIL_TAKEN') setError('Email already registered.')
      else setError(detail || 'Failed to send invitation.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md border border-ghost/30 bg-abyss p-6 space-y-5">
        {/* Step 1 — Organization details */}
        {step === 1 && (
          <>
            <div>
              <p className="font-mono text-[10px] tracking-widest mb-1 text-ghost">STEP 1 / 2</p>
              <p className="font-mono text-sm font-bold text-bone">NEW ORGANIZATION</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-mono text-[10px] tracking-widest block mb-1 text-ghost">
                  ORGANIZATION NAME <span className="text-ember">*</span>
                </label>
                <input
                  className="w-full bg-transparent border border-ghost/20 px-3 py-2 font-mono text-sm text-bone outline-none focus:border-ember caret-ember"
                  maxLength={100}
                  placeholder="e.g. Laguna State Polytechnic University"
                  value={orgForm.name}
                  onChange={e => setOrgForm(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleCreateOrganization()}
                />
              </div>
              <div>
                <label className="font-mono text-[10px] tracking-widest block mb-1 text-ghost">
                  ORG SHORT NAME
                </label>
                <input
                  className="w-full bg-transparent border border-ghost/20 px-3 py-2 font-mono text-sm text-bone outline-none focus:border-ember caret-ember"
                  maxLength={20}
                  placeholder="e.g. LSPU Siniloan — used as badge label"
                  value={orgForm.org_code}
                  onChange={e => setOrgForm(p => ({ ...p, org_code: e.target.value }))}
                />
              </div>
              <div>
                <label className="font-mono text-[10px] tracking-widest block mb-1 text-ghost">
                  DESCRIPTION
                </label>
                <textarea
                  className="w-full bg-transparent border border-ghost/20 px-3 py-2 font-mono text-xs text-bone outline-none resize-none focus:border-ember caret-ember"
                  rows={2}
                  maxLength={300}
                  placeholder="Optional"
                  value={orgForm.description}
                  onChange={e => setOrgForm(p => ({ ...p, description: e.target.value }))}
                />
              </div>

              {/* Logo upload */}
              <div>
                <label className="font-mono text-[10px] tracking-widest block mb-2 text-ghost">
                  ORGANIZATION LOGO <span className="text-ghost/40">— optional</span>
                </label>
                <div className="flex items-center gap-3">
                  {logoPreview ? (
                    <img
                      src={logoPreview}
                      alt="preview"
                      style={{ width: 48, height: 48, objectFit: 'contain', background: '#161616', border: '1px solid #2a2a2a', flexShrink: 0 }}
                    />
                  ) : (
                    <div style={{ width: 48, height: 48, flexShrink: 0, background: '#161616', border: '1px solid #1f1f1f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="font-mono text-[9px] text-ghost/30">LOGO</span>
                    </div>
                  )}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        className="font-mono text-[10px] tracking-widest px-3 py-1.5 border border-ghost/25 text-ghost hover:border-ember hover:text-ember transition-all"
                      >
                        {logoFile ? '[ CHANGE ]' : '[ UPLOAD ]'}
                      </button>
                      {logoFile && (
                        <button
                          type="button"
                          onClick={() => { setLogoFile(null); setLogoPreview(null) }}
                          className="font-mono text-[10px] text-ember/50 hover:text-ember transition-colors"
                        >
                          ✕ remove
                        </button>
                      )}
                    </div>
                    <p className="font-mono text-[9px] text-ghost/40">PNG, JPG, WebP — max 5MB</p>
                    {logoFile && <p className="font-mono text-[9px] text-success truncate max-w-[160px]">{logoFile.name}</p>}
                  </div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={async e => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      try {
                        const blob = await processLogoImage(f)
                        const processed = new File([blob], 'logo.png', { type: 'image/png' })
                        setLogoFile(processed)
                        setLogoPreview(URL.createObjectURL(blob))
                      } catch {
                        setLogoFile(f)
                        setLogoPreview(URL.createObjectURL(f))
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {error && <p className="font-mono text-xs text-danger">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleCreateOrganization}
                disabled={saving || !orgForm.name.trim()}
                className="font-mono text-[10px] tracking-widest px-5 py-2 border border-ember/50 text-ember disabled:opacity-40 transition-all"
              >
                {saving ? 'CREATING...' : '[ NEXT ]'}
              </button>
              <button
                onClick={onClose}
                className="font-mono text-[10px] tracking-widest px-5 py-2 border border-ghost/20 text-ghost"
              >
                [ CANCEL ]
              </button>
            </div>
          </>
        )}

        {/* Step 2 — Create Admin */}
        {step === 2 && newOrg && (
          <>
            <div>
              <p className="font-mono text-[10px] tracking-widest mb-1 text-ghost">STEP 2 / 2</p>
              <p className="font-mono text-sm font-bold text-success">ORGANIZATION CREATED.</p>
              <p className="font-mono text-xs mt-1 text-ghost">
                Now create an Admin account for{' '}
                <span className="text-bone">{newOrg.name}</span>.
              </p>
              <p className="font-mono text-[10px] mt-0.5 text-ghost">
                You can also skip this and create an Admin later.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-mono text-[10px] tracking-widest block mb-1 text-ghost">
                  ADMIN CALLSIGN <span className="text-ember">*</span>
                </label>
                <input
                  className="w-full bg-transparent border border-ghost/20 px-3 py-2 font-mono text-sm text-bone outline-none focus:border-ember caret-ember"
                  placeholder="Unique callsign"
                  value={adminForm.username}
                  onChange={e => setAdminForm(p => ({ ...p, username: e.target.value }))}
                />
              </div>
              <div>
                <label className="font-mono text-[10px] tracking-widest block mb-1 text-ghost">
                  ADMIN EMAIL <span className="text-ember">*</span>
                </label>
                <input
                  type="email"
                  className="w-full bg-transparent border border-ghost/20 px-3 py-2 font-mono text-sm text-bone outline-none focus:border-ember caret-ember"
                  placeholder="Organization email preferred"
                  value={adminForm.email}
                  onChange={e => setAdminForm(p => ({ ...p, email: e.target.value }))}
                />
              </div>
            </div>

            {error && <p className="font-mono text-xs text-danger">{error}</p>}

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={handleInviteAdmin}
                disabled={saving || !adminForm.username.trim() || !adminForm.email.trim()}
                className="font-mono text-[10px] tracking-widest px-5 py-2.5 border border-ember/50 text-ember disabled:opacity-40 transition-all"
              >
                {saving ? 'SENDING...' : '[ CREATE ADMIN & SEND INVITATION ]'}
              </button>
              <button
                onClick={onClose}
                className="font-mono text-[10px] tracking-widest py-1 text-center text-ghost"
              >
                [ SKIP — CREATE ADMIN LATER ]
              </button>
            </div>
          </>
        )}

        {/* Step 3 — Success */}
        {step === 3 && inviteResult && (
          <>
            <div className="space-y-2">
              <p className="font-mono text-xs text-success">&gt; ORGANIZATION CREATED: {inviteResult.organization_name}</p>
              <p className="font-mono text-xs text-bone">&gt; ADMIN ACCOUNT: {inviteResult.username}</p>
              <p className="font-mono text-xs text-bone">&gt; INVITATION SENT TO: {inviteResult.email}</p>
              <p className="font-mono text-xs text-ghost">&gt; They have 72 hours to set their password.</p>
            </div>
            <button
              onClick={onClose}
              className="font-mono text-[10px] tracking-widest px-5 py-2 border border-ember/50 text-ember mt-2"
            >
              [ DONE ]
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ORG LOGO — small square logo with initials fallback
// ---------------------------------------------------------------------------
function OrgLogo({ org, size = 32 }) {
  const [err, setErr] = useState(false)
  const initials = (org.org_code || org.name || '?').slice(0, 2).toUpperCase()
  const G = 'Geist, sans-serif'
  const M = 'JetBrains Mono, monospace'
  if (org.logo_url && !err) {
    const cacheBust = org.updated_at || String(Date.now())
    return (
      <img
        key={cacheBust}
        src={`/organizations/${org.id}/logo?v=${encodeURIComponent(cacheBust)}`}
        alt={org.name}
        onError={() => setErr(true)}
        style={{ width: size, height: size, objectFit: 'contain', background: 'transparent', flexShrink: 0 }}
      />
    )
  }
  return (
    <div
      style={{
        width: size, height: size, flexShrink: 0,
        background: '#161616', border: '1px solid #1f1f1f',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: M, fontSize: Math.max(8, Math.floor(size * 0.32)) + 'px',
        fontWeight: 700, color: '#3a3a3a', letterSpacing: '0.04em',
      }}
    >
      {initials}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ORG CARD — single organization card for the grid layout
// ---------------------------------------------------------------------------
function OrgCard({ org: u, onOpen }) {
  const isActive = u.is_active
  const isLive   = !!u.active_event_name

  const topColor  = isLive ? '#00FF88' : isActive ? 'rgba(107,107,128,0.35)' : '#FF4500'
  const borderClr = isLive ? 'rgba(0,255,136,0.2)' : isActive ? 'rgba(107,107,128,0.18)' : 'rgba(255,69,0,0.2)'
  const hoverBorderClr = isLive ? 'rgba(0,255,136,0.45)' : isActive ? 'rgba(255,69,0,0.35)' : 'rgba(255,69,0,0.45)'

  return (
    <div
      className="bg-abyss overflow-hidden flex flex-col transition-colors group"
      style={{ border: `1px solid ${borderClr}`, borderTop: `3px solid ${topColor}` }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = hoverBorderClr }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = borderClr }}
    >
      <div className="p-5 flex flex-col gap-3 flex-1">

        {/* ── Row 1: Identity + status ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <OrgLogo org={u} size={38} />
            <div className="min-w-0">
              <h3 className="font-mono text-sm font-bold text-bone leading-snug truncate" title={u.name}>
                {u.name}
              </h3>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {u.org_code && (
                  <span className="font-mono text-[9px] px-1.5 py-0.5 border border-ghost/25 text-ghost/65 tracking-wider">
                    {u.org_code}
                  </span>
                )}
                {u.admin_callsign && (
                  <span className="font-mono text-[9px] text-ghost/40 tracking-wide">
                    ⌘ {u.admin_callsign}
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className={`font-mono text-[9px] shrink-0 tracking-wide ${isActive ? 'text-success' : 'text-danger/70'}`}>
            {isActive ? '● ACTIVE' : '○ INACTIVE'}
          </span>
        </div>

        {/* ── Description preview ── */}
        {u.description && (
          <p className="font-mono text-[10px] text-ghost/45 leading-relaxed line-clamp-2">
            {u.description}
          </p>
        )}

        {/* ── Divider ── */}
        <div className="border-t border-ghost/10" />

        {/* ── Stats — all consistent numbers ── */}
        <div className="grid grid-cols-3 gap-2">
          {[
            ['OPERATORS', u.user_count  ?? 0],
            ['EVENTS',    u.event_count ?? 0],
            ['TEAMS',     u.team_count  ?? 0],
          ].map(([label, val]) => (
            <div key={label} className="text-center py-2" style={{ background: '#0a0a0a', border: '1px solid rgba(107,107,128,0.08)' }}>
              <div className="font-mono text-lg font-bold text-bone leading-none">{val}</div>
              <div className="font-mono text-[8px] tracking-widest text-ghost/35 mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* ── Live event strip OR established date ── */}
        {isLive ? (
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{ background: 'rgba(0,255,136,0.05)', border: '1px solid rgba(0,255,136,0.18)' }}
          >
            <span className="font-mono text-[8px] text-success tracking-widest shrink-0 animate-pulse">● LIVE</span>
            <span className="font-mono text-[10px] text-success/75 truncate" title={u.active_event_name}>
              {u.active_event_name}
            </span>
          </div>
        ) : u.created_at ? (
          <p className="font-mono text-[9px] text-ghost/28 tracking-wider">
            EST. {new Date(u.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase()}
          </p>
        ) : null}

        {/* ── Open workspace button pinned to bottom ── */}
        <div className="mt-auto pt-1">
          <div className="border-t border-ghost/10 mb-3" />
          <button
            onClick={onOpen}
            className="w-full font-mono text-[10px] tracking-widest py-2.5 border border-ember/40 text-ember transition-all hover:bg-ember/8 hover:border-ember"
          >
            [ OPEN WORKSPACE ]
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ORGANIZATIONS TAB — card grid layout with search, status filter, sort
// ---------------------------------------------------------------------------
function OrganizationsTab({ onViewOrganization }) {
  const [organizations, setOrganizations] = useState([])
  const [search, setSearch]               = useState('')
  const [statusFilter, setStatusFilter]   = useState('ALL')
  const [sortBy, setSortBy]               = useState('status') // status | name | operators | events | teams
  const [sortDir, setSortDir]             = useState(1)        // 1 = asc, -1 = desc
  const [showCreate, setShowCreate]       = useState(false)
  const [pendingOpenOrg, setPendingOpenOrg] = useState(null)

  async function load() {
    try { const r = await client.get('/organizations'); setOrganizations(r.data) } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [])

  const counts = {
    ALL:      organizations.length,
    ACTIVE:   organizations.filter(u => u.is_active).length,
    INACTIVE: organizations.filter(u => !u.is_active).length,
  }

  const _SORT_KEY = {
    status:    u => (u.active_event_name ? 0 : u.is_active ? 1 : 2),
    name:      u => (u.name || '').toLowerCase(),
    operators: u => -(u.user_count  ?? 0),
    events:    u => -(u.event_count ?? 0),
    teams:     u => -(u.team_count  ?? 0),
  }

  const filtered = organizations
    .filter(u => {
      const q = search.toLowerCase()
      return (
        (!q || u.name.toLowerCase().includes(q) || (u.org_code || '').toLowerCase().includes(q)) &&
        (statusFilter === 'ALL' || (statusFilter === 'ACTIVE' && u.is_active) || (statusFilter === 'INACTIVE' && !u.is_active))
      )
    })
    .sort((a, b) => {
      const ka = _SORT_KEY[sortBy](a)
      const kb = _SORT_KEY[sortBy](b)
      if (ka !== kb) return ka < kb ? -sortDir : sortDir
      // tiebreak: name ascending
      return (a.name || '').toLowerCase() < (b.name || '').toLowerCase() ? -1 : 1
    })

  function toggleSort(key) {
    if (sortBy === key) setSortDir(d => -d)
    else { setSortBy(key); setSortDir(key === 'name' ? 1 : 1) }
  }

  const M = 'JetBrains Mono, monospace'

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="font-mono text-sm font-bold tracking-widest text-bone">ORGANIZATIONS</p>
        <button
          onClick={() => setShowCreate(true)}
          className="font-mono text-[10px] tracking-widest px-4 py-2 border border-ember/50 text-ember transition-all hover:border-ember"
        >
          [ + REGISTER ORGANIZATION ]
        </button>
      </div>

      {/* ── Controls bar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <input
          className="bg-transparent border border-ghost/20 px-3 py-1.5 font-mono text-xs text-bone outline-none focus:border-ember caret-ember w-56"
          placeholder="Search name or code..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* Status tabs with counts */}
        <div className="flex gap-1">
          {['ALL', 'ACTIVE', 'INACTIVE'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`font-mono text-[10px] tracking-widest px-3 py-1.5 border transition-all ${
                statusFilter === s
                  ? 'border-ember text-ember bg-ember/8'
                  : 'border-ghost/20 text-ghost hover:border-ghost/40'
              }`}
            >
              {s} <span className="opacity-50 ml-0.5">{counts[s]}</span>
            </button>
          ))}
        </div>

        {/* Sort controls */}
        <div className="flex gap-1 ml-2">
          {[['status','STATUS'], ['name','NAME'], ['operators','OPS'], ['events','EVENTS'], ['teams','TEAMS']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => toggleSort(key)}
              style={{
                fontFamily: M, fontSize: '9px', letterSpacing: '0.08em',
                padding: '4px 8px', cursor: 'pointer', transition: 'all 0.15s',
                border: '1px solid transparent',
                color: sortBy === key ? '#FF4500' : '#555',
                borderColor: sortBy === key ? 'rgba(255,69,0,0.35)' : 'transparent',
                background: sortBy === key ? 'rgba(255,69,0,0.06)' : 'transparent',
              }}
            >
              {label} {sortBy === key ? (sortDir === 1 ? '↑' : '↓') : ''}
            </button>
          ))}
        </div>

        <span className="font-mono text-[10px] text-ghost/40 ml-auto">
          {filtered.length} / {organizations.length}
        </span>
      </div>

      {/* ── Card grid ── */}
      {filtered.length === 0 ? (
        <p className="font-mono text-xs text-ghost py-6">
          {organizations.length === 0
            ? 'No organizations registered. Create one above.'
            : 'No organizations match your filter.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {filtered.map(u => (
            <OrgCard
              key={u.id}
              org={u}
              onOpen={() => onViewOrganization?.(u)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateOrganizationModal
          onClose={() => {
            setShowCreate(false)
            if (pendingOpenOrg) {
              onViewOrganization?.(pendingOpenOrg)
              setPendingOpenOrg(null)
            }
          }}
          onCreated={newOrg => { load(); if (newOrg) setPendingOpenOrg(newOrg) }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ORG OVERVIEW SUB-TAB — stats widgets + active event + top performers
// ---------------------------------------------------------------------------
function OrgOverviewTab({ orgId, org, onUpdated }) {
  const terms = usePlatformTerms()
  const [stats, setStats] = useState(null)
  const [events, setEvents] = useState([])
  const [toggling, setToggling] = useState(false)
  const [toggleError, setToggleError] = useState('')
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  async function handleToggleActive() {
    setToggling(true); setToggleError('')
    try {
      await client.patch(`/organizations/${orgId}`, { is_active: !org.is_active })
      onUpdated?.()
      setConfirmDeactivate(false)
    } catch (e) {
      setToggleError(e?.response?.data?.detail || 'Failed to update status.')
    } finally { setToggling(false) }
  }

  useEffect(() => {
    Promise.all([
      client.get(`/organizations/${orgId}/stats`),
      client.get(`/events?org_id=${orgId}`),
    ])
      .then(([s, e]) => { setStats(s.data); setEvents(e.data) })
      .catch(() => {})
  }, [orgId])

  if (!stats) return <p className="font-mono text-xs animate-pulse text-ghost">LOADING...</p>

  const activeEvent = events.find(e => e.status === 'ACTIVE') || null
  const topOp = stats.top_performers?.[0] || null

  function exportData() {
    const lines = [
      `DEADNET ORGANIZATION REPORT — ${org?.name || orgId}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      `Total Operators,${stats.users?.total ?? 0}`,
      `Teams,${stats.teams ?? 0}`,
      `BC Distributed,${stats.bc_distributed ?? 0}`,
      '',
      'USERS BY ROLE',
      ...Object.entries(stats.users?.by_role ?? {}).map(([role, count]) => `${role},${count}`),
      '',
      'TOP PERFORMERS',
      'Callsign,BC,Clearance',
      ...(stats.top_performers ?? []).map(p => `${p.username},${p.bc_total},${p.clearance_level}`),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${org?.org_code || 'org'}-report.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Activity status — top banner */}
      <div className={`border rounded-sm px-5 py-3 flex items-center justify-between gap-4 ${org.is_active ? 'border-success/30 bg-success/5' : 'border-danger/20 bg-danger/5'}`}>
        <div className="flex items-center gap-3">
          <span className={`font-mono text-xs font-bold tracking-widest ${org.is_active ? 'text-success' : 'text-danger'}`}>
            {org.is_active ? '● ACTIVE' : '● INACTIVE'}
          </span>
          <span className="font-mono text-[10px] text-ghost/50">Organization status</span>
        </div>
        {!confirmDeactivate ? (
          <button
            onClick={() => org.is_active ? setConfirmDeactivate(true) : handleToggleActive()}
            disabled={toggling}
            className={`font-mono text-[10px] tracking-widest px-4 py-1.5 border transition-all disabled:opacity-40 ${
              org.is_active
                ? 'border-ember/30 text-ember hover:bg-ember/10'
                : 'border-success/30 text-success hover:bg-success/10'
            }`}
          >
            {toggling ? '...' : org.is_active ? '[ DEACTIVATE ]' : '[ REACTIVATE ]'}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-ghost/60">Confirm deactivate?</span>
            <button
              onClick={handleToggleActive}
              disabled={toggling}
              className="font-mono text-[10px] tracking-widest px-3 py-1.5 border border-ember/40 text-ember disabled:opacity-40 hover:bg-ember/10 transition-all"
            >
              {toggling ? '...' : '[ CONFIRM ]'}
            </button>
            <button
              onClick={() => setConfirmDeactivate(false)}
              className="font-mono text-[10px] tracking-widest px-3 py-1.5 border border-ghost/20 text-ghost hover:text-bone transition-all"
            >
              [ ABORT ]
            </button>
          </div>
        )}
        {toggleError && <p className="font-mono text-[10px] text-danger ml-2">{toggleError}</p>}
      </div>

      {/* Stat widgets row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* OPERATORS */}
        <div className="border border-ghost/20 bg-abyss rounded-sm p-4 space-y-3">
          <p className="font-mono text-[10px] tracking-widest text-ghost">OPERATORS</p>
          <div className="font-mono text-3xl font-bold text-bone">{stats.users?.total ?? 0}</div>
          <div className="space-y-1 pt-1 border-t border-ghost/10">
            {Object.entries(stats.users?.by_role ?? {}).map(([role, count]) => (
              <div key={role} className="flex justify-between">
                <span className="font-mono text-[10px] text-ghost">{role}</span>
                <span className="font-mono text-[10px] font-bold text-bone">{count}</span>
              </div>
            ))}
            {Object.keys(stats.users?.by_role ?? {}).length === 0 && (
              <p className="font-mono text-[10px] text-ghost/40">No breakdown available</p>
            )}
          </div>
        </div>

        {/* TEAMS */}
        <div className="border border-ghost/20 bg-abyss rounded-sm p-4 space-y-3">
          <p className="font-mono text-[10px] tracking-widest text-ghost">TEAMS</p>
          <div className="font-mono text-3xl font-bold text-bone">{stats.teams ?? 0}</div>
          <div className="pt-1 border-t border-ghost/10">
            <p className="font-mono text-[10px] text-ghost">BC DISTRIBUTED</p>
            <p className="font-mono text-xl font-bold text-ember mt-0.5">
              {(stats.bc_distributed ?? 0).toLocaleString()}
            </p>
          </div>
        </div>

        {/* TOP OPERATIVE */}
        <div className="border border-ghost/20 bg-abyss rounded-sm p-4 space-y-3">
          <p className="font-mono text-[10px] tracking-widest text-ghost">TOP {terms.operator.toUpperCase()}</p>
          {topOp ? (
            <>
              <div className="font-mono text-base font-bold text-bone truncate" title={topOp.username}>
                {topOp.username}
              </div>
              <div className="pt-1 border-t border-ghost/10">
                <p className="font-mono text-[10px] text-ghost">BC TOTAL</p>
                <p className="font-mono text-xl font-bold text-ember mt-0.5">{topOp.bc_total}</p>
                <p className="font-mono text-[10px] text-ghost mt-1">{topOp.clearance_level}</p>
              </div>
            </>
          ) : (
            <p className="font-mono text-sm text-ghost/40">No data yet</p>
          )}
        </div>
      </div>

      {/* Active Event card */}
      <div className={`border rounded-sm p-4 ${activeEvent ? 'border-success/30 bg-success/5' : 'border-ghost/15 bg-abyss'}`}>
        <p className="font-mono text-[10px] tracking-widest mb-3 text-ghost">ACTIVE EVENT</p>
        {activeEvent ? (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-mono text-sm font-bold text-bone">{activeEvent.name}</p>
              <p className="font-mono text-[10px] text-ghost mt-0.5">
                {activeEvent.participant_count ?? 0} participants
                {activeEvent.contract_count != null && ` · ${activeEvent.contract_count} contracts`}
              </p>
            </div>
            <span className="font-mono text-[10px] tracking-widest animate-pulse text-success">● LIVE</span>
          </div>
        ) : (
          <p className="font-mono text-xs text-ghost/50">No active event for this organization.</p>
        )}
      </div>

      {/* Top performers table */}
      {stats.top_performers?.length > 0 && (
        <div>
          <p className="font-mono text-[10px] tracking-widest mb-3 text-ghost">TOP PERFORMERS</p>
          <div className="border border-ghost/20 rounded-sm overflow-hidden">
            <div className="grid grid-cols-[32px_1fr_80px_120px] px-4 py-2 border-b border-ghost/10 font-mono text-[10px] tracking-widest text-ghost">
              {['#', 'CALLSIGN', 'BC', 'CLEARANCE'].map(h => <span key={h}>{h}</span>)}
            </div>
            <div className="divide-y divide-ghost/10">
              {stats.top_performers.slice(0, 5).map((p, i) => (
                <div key={p.username} className="grid grid-cols-[32px_1fr_80px_120px] px-4 py-2.5 items-center">
                  <span className="font-mono text-[10px] text-ghost">{i + 1}</span>
                  <span className="font-mono text-sm text-bone">{p.username}</span>
                  <span className="font-mono text-sm font-bold text-ember">{p.bc_total}</span>
                  <span className="font-mono text-[10px] text-ghost">{p.clearance_level}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <p className="font-mono text-[10px] tracking-widest mb-3 text-ghost">QUICK ACTIONS</p>
        <div className="flex gap-3 flex-wrap">
          <button
            disabled
            className="font-mono text-[10px] tracking-widest px-4 py-2 border border-ghost/20 text-ghost opacity-40 cursor-not-allowed"
          >
            [ FREEZE BOARD ]
          </button>
          <button
            disabled
            className="font-mono text-[10px] tracking-widest px-4 py-2 border border-ghost/20 text-ghost opacity-40 cursor-not-allowed"
          >
            [ BROADCAST MESSAGE ]
          </button>
          <button
            onClick={exportData}
            className="font-mono text-[10px] tracking-widest px-4 py-2 border border-ghost/25 text-ghost transition-all hover:border-ghost/50 hover:text-bone"
          >
            [ EXPORT DATA ]
          </button>
        </div>
        <p className="font-mono text-[10px] text-ghost/35 mt-2">Freeze board and broadcast wired in Part C.</p>
      </div>

    </div>
  )
}

// ---------------------------------------------------------------------------
// ORG SETTINGS SUB-TAB — org-level identity, status toggle, danger zone
// ---------------------------------------------------------------------------
function OrgSettingsTab({ univ, onUpdated, onBack }) {
  const [form, setForm] = useState({
    name: univ.name,
    org_code: univ.org_code || '',
    description: univ.description || '',
  })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState({ text: '', ok: true })

  // Logo upload
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoMsg, setLogoMsg] = useState({ text: '', ok: true })
  const logoInputRef = useRef(null)

  async function handleLogoUpload() {
    if (!logoFile) return
    setLogoUploading(true)
    setLogoMsg({ text: '', ok: true })
    try {
      const res = await uploadLogo(univ.id, logoFile)
      setLogoMsg({ text: 'Logo updated.', ok: true })
      setLogoFile(null)
      setLogoPreview(null)
      // Patch updated_at locally so OrgLogo cache-buster changes immediately,
      // then do the full refresh to get authoritative data.
      if (res.data?.updated_at) {
        onUpdated?.({ logo_url: res.data.logo_url, updated_at: res.data.updated_at })
      } else {
        onUpdated?.()
      }
    } catch {
      setLogoMsg({ text: 'Upload failed.', ok: false })
    } finally {
      setLogoUploading(false)
      setTimeout(() => setLogoMsg({ text: '', ok: true }), 3000)
    }
  }
  const [showDeleteZone, setShowDeleteZone] = useState(false)
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  async function handleSave() {
    setSaving(true); setSaveMsg({ text: '', ok: true })
    try {
      await client.patch(`/organizations/${univ.id}`, {
        name: form.name.trim(),
        org_code: form.org_code.trim() || undefined,
        description: form.description.trim() || undefined,
      })
      setSaveMsg({ text: 'Changes saved.', ok: true })
      onUpdated?.()
    } catch {
      setSaveMsg({ text: 'Save failed.', ok: false })
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg({ text: '', ok: true }), 3000)
    }
  }

  async function handleDelete() {
    if (deleteConfirmInput !== univ.name) return
    setDeleting(true); setDeleteError('')
    try {
      await client.delete(`/organizations/${univ.id}`)
      onBack?.()  // exit workspace — org is gone
    } catch (e) {
      setDeleteError(e?.response?.data?.detail || 'Deletion failed.')
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Identity */}
      <div className="space-y-3">
        <p className="font-mono text-[10px] tracking-widest text-ghost">ORGANIZATION IDENTITY</p>
        <div className="border border-ghost/20 p-5 space-y-4">
          <div>
            <label className="font-mono text-[10px] tracking-widest block mb-1.5 text-ghost">
              ORGANIZATION NAME <span className="text-ember">*</span>
            </label>
            <input
              className="w-full bg-transparent border border-ghost/20 px-3 py-2 font-mono text-sm text-bone outline-none focus:border-ember caret-ember"
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="font-mono text-[10px] tracking-widest block mb-1.5 text-ghost">ORG CODE</label>
            <input
              className="w-full bg-transparent border border-ghost/20 px-3 py-2 font-mono text-sm text-bone outline-none focus:border-ember caret-ember"
              placeholder="Short badge label, e.g. DLSU"
              value={form.org_code}
              onChange={e => setForm(p => ({ ...p, org_code: e.target.value }))}
            />
          </div>
          <div>
            <label className="font-mono text-[10px] tracking-widest block mb-1.5 text-ghost">DESCRIPTION</label>
            <textarea
              className="w-full bg-transparent border border-ghost/20 px-3 py-2 font-mono text-xs text-bone outline-none resize-none focus:border-ember caret-ember"
              rows={3}
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            />
          </div>
          {/* Logo upload */}
          <div className="pt-1 border-t border-ghost/10 space-y-2">
            <label className="font-mono text-[10px] tracking-widest text-ghost block">ORGANIZATION LOGO</label>
            <div className="flex items-center gap-3">
              {logoPreview ? (
                <img
                  src={logoPreview}
                  alt="preview"
                  style={{ width: 48, height: 48, objectFit: 'contain', background: '#0d0d0d', border: '1px solid #2a2a2a', flexShrink: 0 }}
                />
              ) : (
                <OrgLogo org={univ} size={48} />
              )}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="font-mono text-[10px] tracking-widest px-3 py-1.5 border border-ghost/25 text-ghost hover:border-ember hover:text-ember transition-all"
                  >
                    {logoFile ? '[ CHANGE ]' : '[ UPLOAD LOGO ]'}
                  </button>
                  {logoFile && (
                    <>
                      <button
                        type="button"
                        onClick={handleLogoUpload}
                        disabled={logoUploading}
                        className="font-mono text-[10px] tracking-widest px-3 py-1.5 border border-ember/50 text-ember hover:border-ember transition-all disabled:opacity-40"
                      >
                        {logoUploading ? 'SAVING...' : '[ SAVE LOGO ]'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setLogoFile(null); setLogoPreview(null) }}
                        className="font-mono text-[10px] text-ember/50 hover:text-ember transition-colors"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
                {logoFile && <p className="font-mono text-[9px] text-ghost/60 truncate max-w-[200px]">{logoFile.name}</p>}
                {logoMsg.text && <p className={`font-mono text-[9px] ${logoMsg.ok ? 'text-success' : 'text-danger'}`}>{logoMsg.text}</p>}
                {!logoFile && <p className="font-mono text-[9px] text-ghost/40">PNG, JPG, WebP — max 5MB</p>}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={async e => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  try {
                    const blob = await processLogoImage(f)
                    const processed = new File([blob], 'logo.png', { type: 'image/png' })
                    setLogoFile(processed)
                    setLogoPreview(URL.createObjectURL(blob))
                  } catch {
                    setLogoFile(f)
                    setLogoPreview(URL.createObjectURL(f))
                  }
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-4 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              className="font-mono text-[10px] tracking-widest px-5 py-2 border border-ember/50 text-ember disabled:opacity-40 transition-all hover:border-ember"
            >
              {saving ? 'SAVING...' : '[ SAVE CHANGES ]'}
            </button>
            {saveMsg.text && (
              <span className={`font-mono text-xs ${saveMsg.ok ? 'text-success' : 'text-danger'}`}>
                {saveMsg.text}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="space-y-3">
        <p className="font-mono text-[10px] tracking-widest text-ember">DANGER ZONE</p>
        <div className="border border-ember/20 p-5 space-y-4">
          {/* Delete organization */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-xs text-bone">Delete this organization</p>
                <p className="font-mono text-[10px] text-ghost mt-0.5">
                  Permanently removes the org record. Users are preserved but unlinked.
                </p>
              </div>
              {!showDeleteZone && (
                <button
                  onClick={() => { setShowDeleteZone(true); setDeleteConfirmInput(''); setDeleteError('') }}
                  className="font-mono text-[10px] tracking-widest px-4 py-1.5 border border-ember/40 text-ember transition-all hover:bg-ember/8 shrink-0"
                >
                  [ DELETE ORGANIZATION ]
                </button>
              )}
            </div>

            {showDeleteZone && (
              <div className="border border-ember/40 bg-ember/5 p-5 space-y-4">
                {/* Warning header */}
                <div className="space-y-1">
                  <p className="font-mono text-xs font-bold text-ember">⚠ THIS ACTION IS PERMANENT AND CANNOT BE UNDONE</p>
                  <p className="font-mono text-[10px] text-ghost">The following will happen immediately:</p>
                </div>
                <ul className="space-y-1">
                  {[
                    'The organization record is permanently deleted',
                    'All operators in this org are unlinked (accounts preserved)',
                    'All events, teams, and transmissions linked to this org are unlinked',
                    'Audit logs for this org are anonymized',
                    'This cannot be reversed — there is no backup',
                  ].map(item => (
                    <li key={item} className="font-mono text-[10px] text-ember/80 flex gap-2">
                      <span className="shrink-0">›</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                {/* Type-to-confirm */}
                <div className="space-y-2 pt-1">
                  <p className="font-mono text-[10px] text-ghost">
                    Type <span className="text-bone font-bold">{univ.name}</span> to confirm deletion:
                  </p>
                  <input
                    className="w-full bg-void border border-ember/30 px-3 py-2 font-mono text-sm text-bone outline-none focus:border-ember caret-ember"
                    placeholder={univ.name}
                    value={deleteConfirmInput}
                    onChange={e => { setDeleteConfirmInput(e.target.value); setDeleteError('') }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                {deleteError && (
                  <p className="font-mono text-[10px] text-danger">{deleteError}</p>
                )}

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={handleDelete}
                    disabled={deleting || deleteConfirmInput !== univ.name}
                    className="font-mono text-[10px] tracking-widest px-5 py-2 border border-ember text-ember transition-all disabled:opacity-30 hover:bg-ember/10"
                  >
                    {deleting ? 'DELETING...' : '[ PERMANENTLY DELETE ORGANIZATION ]'}
                  </button>
                  <button
                    onClick={() => { setShowDeleteZone(false); setDeleteConfirmInput(''); setDeleteError('') }}
                    className="font-mono text-[10px] tracking-widest px-4 py-2 border border-ghost/20 text-ghost transition-all hover:border-ghost/40"
                  >
                    [ CANCEL ]
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SCOPED ORGANIZATION VIEW
// Full workspace shown when Architect opens an organization.
// ---------------------------------------------------------------------------
function ScopedOrganizationView({ univ: initialUniv, onBack }) {
  const [subTab, setSubTab] = useState('overview')
  const [showAddAdmin, setShowAddAdmin] = useState(false)
  const [adminForm, setAdminForm]       = useState({ username: '', email: '' })
  const [adminSaving, setAdminSaving]   = useState(false)
  const [adminError, setAdminError]     = useState('')
  const [adminSuccess, setAdminSuccess] = useState('')
  // Local org copy — refreshed when Settings saves changes
  const [univ, setUniv] = useState(initialUniv)

  async function refreshOrg(patch) {
    // Apply an immediate local patch (e.g. logo_url + updated_at from upload response)
    // so the UI updates without waiting for the full list fetch.
    if (patch) setUniv(prev => ({ ...prev, ...patch }))
    try {
      const r = await client.get('/organizations')
      const updated = (r.data || []).find(o => o.id === univ.id)
      if (updated) setUniv(updated)
    } catch { /* ignore */ }
  }

  async function handleCreateAdmin() {
    if (!adminForm.username.trim() || !adminForm.email.trim()) return
    setAdminSaving(true); setAdminError(''); setAdminSuccess('')
    try {
      await client.post(`/architect/organizations/${univ.id}/invite-admin`, {
        username: adminForm.username.trim(),
        email:    adminForm.email.trim(),
      })
      setAdminSuccess('Invitation sent. Admin account created.')
      setAdminForm({ username: '', email: '' })
      setTimeout(() => { setShowAddAdmin(false); setAdminSuccess('') }, 2000)
    } catch (e) {
      const d = e?.response?.data?.detail || ''
      if (d === 'USERNAME_TAKEN') setAdminError('Callsign already in use.')
      else if (d === 'EMAIL_TAKEN') setAdminError('Email already registered.')
      else setAdminError(d || 'Failed to send invitation.')
    } finally { setAdminSaving(false) }
  }

  return (
    <div className="space-y-4">
      {/* Workspace header */}
      <div className="border border-ghost/20 rounded-sm bg-abyss px-5 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <button
              onClick={onBack}
              className="font-mono text-[10px] tracking-widest text-ghost hover:text-bone transition-colors mb-2 flex items-center gap-1"
            >
              ← BACK TO ALL ORGANIZATIONS
            </button>
            <div className="flex items-center gap-3 flex-wrap">
              <OrgLogo org={univ} size={40} />
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-mono text-xl font-bold text-bone">{univ.name.toUpperCase()}</h2>
                  {univ.org_code && (
                    <span className="font-mono text-[10px] px-1.5 py-0.5 border border-ghost/30 text-ghost">
                      {univ.org_code}
                    </span>
                  )}
                  <span className={`font-mono text-[10px] ${univ.is_active ? 'text-success' : 'text-danger'}`}>
                    {univ.is_active ? '● ACTIVE' : '● INACTIVE'}
                  </span>
                </div>
              </div>
            </div>
            <p className="font-mono text-xs text-ghost mt-1">
              Scoped workspace — changes affect this organization only
            </p>
          </div>
          <button
            onClick={() => { setSubTab('operators'); setShowAddAdmin(true) }}
            className="font-mono text-[10px] tracking-widest px-3 py-1.5 border border-ember text-ember transition-all hover:bg-ember/8 shrink-0"
          >
            [ + CREATE ADMIN ACCOUNT ]
          </button>
        </div>
      </div>

      {/* Create Admin inline form */}
      {showAddAdmin && (
        <div className="border border-ember/40 bg-ember/5 p-4 space-y-3 rounded-sm">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] tracking-widest text-ember">
              CREATE ADMIN ACCOUNT — {univ.name}
            </p>
            <button
              onClick={() => { setShowAddAdmin(false); setAdminError(''); setAdminSuccess('') }}
              className="font-mono text-ghost hover:text-bone text-sm leading-none transition-colors"
            >×</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-[10px] tracking-widest block mb-1 text-ghost">CALLSIGN</label>
              <input
                className="font-mono text-xs w-full bg-void border border-ghost/20 px-2 py-1.5 text-bone outline-none focus:border-ember caret-ember"
                placeholder="username"
                value={adminForm.username}
                onChange={e => setAdminForm(p => ({ ...p, username: e.target.value }))}
              />
            </div>
            <div>
              <label className="font-mono text-[10px] tracking-widest block mb-1 text-ghost">EMAIL</label>
              <input
                type="email"
                className="font-mono text-xs w-full bg-void border border-ghost/20 px-2 py-1.5 text-bone outline-none focus:border-ember caret-ember"
                placeholder="admin@org.local"
                value={adminForm.email}
                onChange={e => setAdminForm(p => ({ ...p, email: e.target.value }))}
              />
            </div>
          </div>
          {adminError   && <p className="font-mono text-[10px] text-danger">{adminError}</p>}
          {adminSuccess && <p className="font-mono text-[10px] text-success">{adminSuccess}</p>}
          <button
            onClick={handleCreateAdmin}
            disabled={adminSaving || !adminForm.username.trim() || !adminForm.email.trim()}
            className="font-mono text-[10px] tracking-widest px-4 py-2 border border-ember/60 text-ember disabled:opacity-40 transition-all"
          >
            {adminSaving ? 'SENDING...' : '[ CREATE ADMIN & SEND INVITATION ]'}
          </button>
        </div>
      )}

      {/* Workspace sub-tabs */}
      <div className="flex gap-0 border-b border-ghost/15 overflow-x-auto">
        {WORKSPACE_TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`font-mono text-[10px] tracking-widest px-4 py-2.5 transition-all border-b-2 whitespace-nowrap ${
              subTab === key
                ? 'text-ember border-ember'
                : 'text-ghost border-transparent hover:text-bone'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {subTab === 'overview'  && <OrgOverviewTab orgId={univ.id} org={univ} onUpdated={refreshOrg} />}
        {subTab === 'operators' && <OperatorsTab orgId={univ.id} archScoped />}
        {subTab === 'teams'     && <TeamsTab orgId={univ.id} />}
        {subTab === 'comms'     && <CommsTab orgId={univ.id} />}
        {subTab === 'settings'  && <OrgSettingsTab univ={univ} onUpdated={refreshOrg} onBack={onBack} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main ArchitectDashboard
// ---------------------------------------------------------------------------
export default function ArchitectDashboard() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'overview'

  const [callsign, setCallsign]       = useState('s0L')
  const [scopedOrg, setScopedOrg]     = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [pendingOpenUserId,  setPendingOpenUserId]  = useState(null)
  const [pendingOpenEventId, setPendingOpenEventId] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('arch_sidebar_collapsed') === 'true' } catch { return false }
  })

  // Health data for sidebar bottom indicator
  const [healthData, setHealthData] = useState({ orgs: 0, orgsIssue: false, accounts: 0, events: 0 })

  // Platform status for topbar pill
  const [platformStatus, setPlatformStatus] = useState('STABLE_ENCRYPTED')

  useEffect(() => {
    client.get('/architect/me').then(r => setCallsign(r.data.callsign)).catch(() => {})
  }, [])

  // Fetch health data for sidebar + topbar
  useEffect(() => {
    async function fetchHealth() {
      try {
        const [overviewRes, evRes, setRes] = await Promise.all([
          client.get('/architect/overview'),
          client.get('/events'),
          client.get('/public/settings'),
        ])
        const d = overviewRes.data
        const events = evRes.data || []
        const activeEvents = events.filter(e => e.status === 'ACTIVE').length
        const orgs = d?.stats?.total_organizations ?? 0
        const accounts = d?.stats?.total_users ?? 0
        const inactiveOrgs = (d?.organizations || []).filter(u => !u.is_active).length

        const isHalted = setRes.data?.competition_active === 'false'
        const hasActive = activeEvents > 0

        setHealthData({
          orgs,
          orgsIssue: inactiveOrgs > 0,
          accounts,
          events: activeEvents,
        })
        setPlatformStatus(isHalted ? 'HALTED' : hasActive ? 'STABLE_ENCRYPTED' : 'STANDBY')
      } catch { /* ignore */ }
    }
    fetchHealth()
    const id = setInterval(fetchHealth, 30000)
    return () => clearInterval(id)
  }, [])

  // Debounced global search
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) { setSearchResults(null); setSearchLoading(false); return }
    setSearchLoading(true)
    const timer = setTimeout(async () => {
      try {
        const r = await client.get(`/architect/search?q=${encodeURIComponent(q)}`)
        setSearchResults(r.data)
      } catch {
        setSearchResults(null)
      } finally {
        setSearchLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  function handleSearchSelect(result) {
    setSearchResults(null)
    if (result.type === 'operator') {
      setPendingOpenUserId(result.id)
      setTab('operators')
    } else if (result.type === 'organization') {
      handleOpenWorkspace(result)
    } else if (result.type === 'event') {
      setPendingOpenEventId(result.id)
      setTab('events')
    }
  }

  function setTab(t) {
    setScopedOrg(null)
    setSearchParams({ tab: t }, { replace: true })
  }

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  function handleOpenWorkspace(univ) {
    setScopedOrg(univ)
  }

  function handleExitScope() {
    setScopedOrg(null)
  }

  const TAB_COMPONENTS = {
    overview:      <OverviewTab onOpen={handleOpenWorkspace} searchQuery={searchQuery} />,
    organizations: <OrganizationsTab onViewOrganization={handleOpenWorkspace} searchQuery={searchQuery} />,
    operators:     <GlobalOperatorsTab defaultSelectedId={pendingOpenUserId} />,
    events:        <EventsTab defaultOpenEventId={pendingOpenEventId} />,
    comms:         <CommsTab orgId={null} />,
    logs:          <LogsTab />,
    library:       <LibraryTab />,
    void:          <VoidTab />,
    settings:      <ArchitectSettingsTab />,
  }

  return (
    <div className="min-h-screen" style={{ background: '#0a0a0a', fontFamily: 'JetBrains Mono, monospace' }}>
      {/* Scanline overlay — CSS only, no JS, opacity 0.02, above bg below content */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 5, pointerEvents: 'none',
          opacity: 0.02,
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, #ffffff 2px, #ffffff 4px)',
        }}
      />

      {/* Topbar */}
      <ArchitectTopbar
        callsign={callsign}
        platformStatus={platformStatus}
        onLogout={handleLogout}
        onSearch={setSearchQuery}
        searchResults={searchResults}
        searchLoading={searchLoading}
        onSelectResult={handleSearchSelect}
      />

      {/* Sidebar */}
      <ArchitectSidebar
        activeTab={tab}
        onTabChange={setTab}
        healthData={healthData}
        onCollapseChange={setSidebarCollapsed}
      />

      {/* Main content — pushed right by sidebar width, down by topbar height */}
      <main
        id="arch-main"
        className="overflow-auto"
        style={{
          paddingTop: '48px',
          paddingLeft: sidebarCollapsed ? '56px' : '224px',
          minHeight: '100vh',
          transition: 'padding-left 0.2s ease',
        }}
      >
        <div className="p-8">
          {scopedOrg ? (
            <ScopedOrganizationView univ={scopedOrg} onBack={handleExitScope} />
          ) : (
            TAB_COMPONENTS[tab] || TAB_COMPONENTS['overview']
          )}
        </div>
      </main>

      {/* ═══ ARCHITECT DASHBOARD — GLOBAL STYLES ═══ */}
      <style>{`

        /* --- Animations --- */

        /* Status dot pulse (topbar pill, health dots) */
        @keyframes termPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }

        /* Live event ● indicator — spec-exact pulse */
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }

        /* Ember border glow breathe — active event card */
        @keyframes emberBreath {
          0%, 100% { box-shadow: 0 0 8px  rgba(249,115,22,0.15); }
          50%       { box-shadow: 0 0 20px rgba(249,115,22,0.30); }
        }

        /* Activity feed entry slide-in */
        @keyframes archFeedIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0);    }
        }

        /* --- Live dot class --- */
        .arch-live-dot {
          animation: livePulse 1.5s ease-in-out infinite;
          display: inline-block;
        }

        /* Ember glow on active sidebar nav item (spec: 0 0 8px rgba(249,115,22,0.3)) */
        .arch-nav-active {
          box-shadow: 0 0 8px rgba(249, 115, 22, 0.3);
        }
        .arch-nav-active-void {
          box-shadow: 0 0 8px rgba(168, 85, 247, 0.3);
        }

        /* Card hover — transition + border lighten */
        .arch-card {
          transition: border-color 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
        }
        .arch-card:hover {
          border-color: #2a2a2a !important;
        }

        /* Active event card — ember glow breathe when LIVE */
        .arch-event-live {
          animation: emberBreath 3s ease-in-out infinite;
        }

        /* Activity feed entry animation */
        .arch-feed-entry {
          animation: archFeedIn 0.18s ease-out both;
        }

        /* Tabular numbers — all numeric spans under arch-main */
        .arch-num,
        #arch-main .tabular-nums {
          font-variant-numeric: tabular-nums;
          font-feature-settings: "tnum";
        }

        /* --- Scrollbars (thin, dark, consistent) --- */
        #arch-main,
        .arch-scroll {
          scrollbar-width: thin;
          scrollbar-color: #1f1f1f #0a0a0a;
        }
        #arch-main::-webkit-scrollbar,
        .arch-scroll::-webkit-scrollbar        { width: 4px; height: 4px; }
        #arch-main::-webkit-scrollbar-track,
        .arch-scroll::-webkit-scrollbar-track  { background: #0a0a0a; }
        #arch-main::-webkit-scrollbar-thumb,
        .arch-scroll::-webkit-scrollbar-thumb  { background: #1f1f1f; border-radius: 0; }
        #arch-main::-webkit-scrollbar-thumb:hover,
        .arch-scroll::-webkit-scrollbar-thumb:hover { background: #2a2a2a; }

        /* --- Topbar bottom accent gradient (overlaid on the 1px border) --- */
        #arch-topbar {
          position: fixed !important;
        }
        #arch-topbar::after {
          content: '';
          position: absolute;
          bottom: -1px; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent 0%, rgba(249,115,22,0.25) 35%, rgba(249,115,22,0.25) 65%, transparent 100%);
          pointer-events: none;
          z-index: 1;
        }

        /* --- Stat bar hover transition --- */
        .arch-stat-btn {
          transition: background-color 150ms ease;
        }

        /* --- Stat bar dividers don't shift on hover --- */
        .arch-stat-btn:not(:last-child) {
          border-right: 1px solid #1f1f1f;
        }

      `}</style>
    </div>
  )
}
