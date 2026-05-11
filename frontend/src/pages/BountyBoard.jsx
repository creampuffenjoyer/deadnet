import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useAuth } from '../context/AuthContext'
import { useEventStatus } from '../hooks/useEventStatus'
import { useMyRegistration } from '../hooks/useMyRegistration'
import { usePlatformTerms } from '../hooks/usePlatformTerms'
import client from '../api/client'
import Navbar from '../components/ui/Navbar'
import OfflineLock from '../components/ui/OfflineLock'
import CCBanner from '../components/cc/CCBanner'
import Footer from '../components/ui/Footer'
import Scanlines from '../components/effects/Scanlines'
import Badge from '../components/ui/Badge'
import GlitchText from '../components/effects/GlitchText'
import { usePlatformFormat, synDisplayName } from '../hooks/usePlatformFormat'

const LINE_COLORS = [
  '#FF4500', '#4A9EFF', '#00FF88', '#FF6B00', '#8A4FFF',
  '#FF2D2D', '#FFD700', '#00CED1', '#FF69B4', '#ADFF2F',
]

function RankBadge({ rank }) {
  const styles = {
    1: 'text-ember border-ember shadow-[0_0_8px_rgba(255,69,0,0.5)] font-bold',
    2: 'text-ghost border-ghost/60',
    3: 'text-bone border-ghost/40',
  }
  return (
    <span className={`font-mono text-sm border px-2 py-0.5 rounded-sm ${styles[rank] || 'text-ghost/60 border-ghost/20'}`}>
      #{rank}
    </span>
  )
}

function buildChartData(series) {
  if (!series || series.length === 0) return { data: [], keys: [] }
  const allTimestamps = new Set()
  const lookup = {}
  series.forEach(({ username, data }) => {
    lookup[username] = {}
    data.forEach(({ timestamp, bc }) => {
      allTimestamps.add(timestamp)
      lookup[username][timestamp] = bc
    })
  })
  const sorted = [...allTimestamps].sort()
  const keys = series.map(s => s.username)
  const running = {}
  keys.forEach(k => { running[k] = 0 })
  const data = sorted.map(ts => {
    const point = { time: new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
    keys.forEach(k => {
      if (lookup[k][ts] !== undefined) running[k] = lookup[k][ts]
      point[k] = running[k]
    })
    return point
  })
  return { data, keys }
}

// CSV export (client-side)
function exportCSV(tab, operatives, teams) {
  const date = new Date().toISOString().split('T')[0]
  let csv = ''
  if (tab === 'operatives') {
    csv = 'Rank,Callsign,Clearance,BC,Contracts Claimed\n'
    csv += operatives.map(r =>
      `${r.rank},"${r.username}",${r.clearance_level},${r.main_bc ?? r.bc_total},${r.claim_count}`
    ).join('\n')
  } else {
    csv = 'Rank,Team,Total BC,Members,Contracts\n'
    csv += teams.map(s =>
      `${s.rank},"${s.name}",${s.total_bc},${s.member_count},${s.claim_count}`
    ).join('\n')
  }
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `DEADNET_final_scoreboard_${date}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// PDF export (client-side jsPDF)
async function exportPDF(tab, operatives, teams) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const date = new Date().toISOString().split('T')[0]
  const doc = new jsPDF()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('DEADNET — FINAL SCOREBOARD', 14, 18)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100)
  doc.text(`Generated: ${date}  |  Tab: ${tab.toUpperCase()}`, 14, 26)

  if (tab === 'operatives') {
    autoTable(doc, {
      startY: 32,
      head: [['Rank', 'Callsign', 'Clearance', 'BC', 'Contracts']],
      body: operatives.map(r => [r.rank, r.username, r.clearance_level, r.main_bc ?? r.bc_total, r.claim_count]),
      styles: { font: 'helvetica', fontSize: 9 },
      headStyles: { fillColor: [255, 69, 0] },
    })
  } else {
    autoTable(doc, {
      startY: 32,
      head: [['Rank', 'Team', 'Total BC', 'Members', 'Contracts']],
      body: teams.map(s => [s.rank, s.name, s.total_bc, s.member_count, s.claim_count]),
      styles: { font: 'helvetica', fontSize: 9 },
      headStyles: { fillColor: [255, 69, 0] },
    })
  }

  doc.save(`DEADNET_final_scoreboard_${date}.pdf`)
}

// OrgBadge — small colored pill showing org code
function OrgBadge({ code, color }) {
  if (!code) return null
  return (
    <span
      className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm border tracking-widest"
      style={{ color, borderColor: color + '60', backgroundColor: color + '15' }}
    >
      {code}
    </span>
  )
}

export default function BountyBoard() {
  const { user } = useAuth()
  const { active: activeEvent, upcoming: upcomingEvent, loading: eventLoading } = useEventStatus()
  const regStatus = useMyRegistration(activeEvent?.id || null)
  const { format, showSection, competition_active, competition_manual_end } = usePlatformFormat()
  const terms = usePlatformTerms()
  const [tab, setTab] = useState('operatives')
  const [boardView, setBoardView] = useState('individual') // kept for compat, unused
  const [orgFilter, setOrgFilter] = useState(null)         // null = ALL, else org_code
  const [expandedOrg, setExpandedOrg] = useState(null)     // org_id of expanded row
  const [operatives, setOperatives] = useState([])
  const [orgBoard, setOrgBoard] = useState([])
  const [isMajor, setIsMajor] = useState(false)
  const [majorOrgs, setMajorOrgs] = useState([])           // [{org_id,code,name,color}]
  const [teams, setTeams] = useState([])
  const [graphSeries, setGraphSeries] = useState([])
  const [synGraphSeries, setSynGraphSeries] = useState([])
  const [isFrozen, setIsFrozen] = useState(false)
  const [onlineCount, setOnlineCount] = useState(0)
  const [showGraph, setShowGraph] = useState(false)
  const [showSynGraph, setShowSynGraph] = useState(false)
  const [feed, setFeed] = useState([])
  const [feedState, setFeedState] = useState(null)   // "ACTIVE" | "NO_EVENT" | null
  const [isMajorFeed, setIsMajorFeed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [boardState, setBoardState] = useState(null)   // "ACTIVE" | "NO_EVENT" | "ARCHIVED"
  const [boardEventName, setBoardEventName] = useState(null)
  const [boardEndsAt, setBoardEndsAt] = useState(null)
  const [removedParticipants, setRemovedParticipants] = useState([])
  const [showRemoved, setShowRemoved] = useState(false)

  const canExport = ['ADMIN', 'CONTRACTOR'].includes(user?.role)

  const fetchAll = useCallback(async () => {
    try {
      const [nRes, sRes, gRes, sgRes, feedRes, orgRes] = await Promise.all([
        client.get('/bounty-board/operatives'),
        client.get('/bounty-board/teams'),
        client.get('/bounty-board/graph'),
        client.get('/bounty-board/team-graph'),
        client.get('/bounty-board/feed'),
        client.get('/bounty-board/orgs').catch(() => ({ data: { board: [], is_major: false } })),
      ])
      setOperatives(nRes.data.board || [])
      setTeams(sRes.data.board || [])
      setIsFrozen(nRes.data.is_frozen || false)
      setOnlineCount(nRes.data.online_count || 0)
      setBoardState(nRes.data.state || null)
      setBoardEventName(nRes.data.event_name || null)
      setBoardEndsAt(nRes.data.event_ends_at || null)
      setRemovedParticipants(nRes.data.removed_participants || [])
      setIsMajor(nRes.data.is_major || false)
      setMajorOrgs(nRes.data.orgs || [])
      setGraphSeries(gRes.data.series || [])
      setSynGraphSeries(sgRes.data.series || [])
      const feedPayload = feedRes.data
      setFeedState(feedPayload?.state || null)
      setFeed(feedPayload?.entries || [])
      setIsMajorFeed(feedPayload?.is_major || false)
      setOrgBoard(orgRes.data.board || [])
    } catch {
      // Keep existing data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(() => {
      if (!document.hidden) fetchAll()
    }, 30_000)
    const onVisibility = () => { if (!document.hidden) fetchAll() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchAll])

  const { data: chartData, keys: chartKeys } = buildChartData(graphSeries)
  const { data: synChartData, keys: synChartKeys } = buildChartData(synGraphSeries)

  // Operative lock — no active event
  if (!eventLoading && !activeEvent && user?.role === 'OPERATIVE') {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Navbar />
        <OfflineLock
          title="BOUNTY BOARD OFFLINE"
          lines={['> Rankings will be available once the competition goes live.']}
          upcoming={upcomingEvent}
        />
        <Footer />
      </div>
    )
  }

  // Operative lock — removed from event
  if (!eventLoading && activeEvent && user?.role === 'OPERATIVE' && !regStatus.loading && regStatus.status === 'REMOVED') {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Navbar />
        <OfflineLock title="BOUNTY BOARD" mode="removed" activeEvent={activeEvent} />
        <Footer />
      </div>
    )
  }

  // Operative lock — active event but not registered
  if (!eventLoading && activeEvent && user?.role === 'OPERATIVE' && !regStatus.loading && !regStatus.registered) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Navbar />
        <OfflineLock title="BOUNTY BOARD" mode="not_registered" activeEvent={activeEvent} />
        <Footer />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-void text-bone flex flex-col">
      <Scanlines />
      <Navbar />
      <CCBanner />

      <div className="relative z-10 flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <GlitchText as="h1" className="font-mono font-bold text-3xl text-ember tracking-widest">
              BOUNTY BOARD
            </GlitchText>
            {boardEventName && (
              <p className="font-mono text-xs text-ghost tracking-widest mt-0.5 uppercase">
                {boardEventName}
                {boardEndsAt && (
                  <span className="ml-2 text-ghost/50">
                    · ends {new Date(boardEndsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </p>
            )}
            <div className="flex items-center gap-4 mt-1 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${boardState === 'ACTIVE' ? 'text-success' : 'text-ghost'}`}>
                <span className={`w-2 h-2 rounded-full inline-block ${boardState === 'ACTIVE' ? 'bg-success animate-pulse' : 'bg-ghost'}`} />
                {boardState === 'ACTIVE' ? 'LIVE' : boardState === 'ARCHIVED' ? 'ARCHIVED' : 'STANDBY'}
              </span>
              <span className="font-mono text-xs text-ghost tracking-widest">
                AUTO-REFRESH 30s
              </span>
              {/* Online count — visible to all */}
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ember border border-ember/30 bg-ember/5 px-2 py-0.5 rounded-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-ember animate-pulse inline-block" />
                {onlineCount} {terms.operator.toUpperCase()}{onlineCount !== 1 ? 'S' : ''} ONLINE
              </span>
            </div>
          </div>

          {/* Export buttons */}
          {canExport && (
            <div className="flex gap-2">
              <button
                onClick={() => exportCSV(tab, operatives, teams)}
                className="font-mono text-xs text-rare-glow border border-rare-glow/40 hover:border-rare-glow px-3 py-1.5 rounded-sm transition-all"
              >
                [ EXPORT CSV ]
              </button>
              <button
                onClick={() => exportPDF(tab, operatives, teams)}
                className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-3 py-1.5 rounded-sm transition-all"
              >
                [ EXPORT PDF ]
              </button>
            </div>
          )}
        </div>

        {/* Freeze overlay */}
        {isFrozen && (
          <div className="mb-4 border border-danger/50 bg-danger/10 rounded-sm px-4 py-3 flex items-center gap-3">
            <span className="font-mono text-sm text-danger font-bold tracking-widest animate-pulse">
              ⚠ BOUNTY BOARD FROZEN
            </span>
            <span className="font-mono text-xs text-ghost">
              Rankings locked by Architect. Final standings displayed.
            </span>
          </div>
        )}

        {/* Competition halted overlay */}
        {(() => {
          const nowMs = Date.now()
          const manualEndMs = competition_manual_end ? new Date(competition_manual_end).getTime() : null
          const halted = competition_active === 'false' || (competition_active === 'true' && manualEndMs && nowMs > manualEndMs)
          return halted ? (
            <div className="mb-4 border border-ghost/30 bg-ghost/5 rounded-sm px-4 py-3 flex items-center gap-3">
              <span className="font-mono text-sm text-ghost font-bold tracking-widest animate-pulse">
                ⚠ COMPETITION HALTED
              </span>
              <span className="font-mono text-xs text-ghost/60">
                Scoreboard visible — competition activity is paused.
              </span>
            </div>
          ) : null
        })()}

        {/* MAJOR EVENT badge */}
        {isMajor && (
          <div className="mb-3 flex items-center gap-3">
            <span className="font-mono text-[10px] text-flare border border-flare/30 px-2 py-0.5 rounded-sm tracking-widest">MAJOR EVENT</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 flex-wrap">
          {(isMajor ? ['operatives', 'teams', 'organizations'] : ['operatives', 'teams']).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`font-mono text-xs tracking-widest px-4 py-2 rounded-sm border transition-all ${
                tab === t
                  ? 'border-ember bg-ember/10 text-ember'
                  : 'border-ghost/20 text-ghost hover:border-ghost hover:text-bone'
              }`}
            >
              [ {t.toUpperCase()} ]
            </button>
          ))}
        </div>

        {/* Org filter pills — operatives tab, MAJOR event only */}
        {isMajor && tab === 'operatives' && majorOrgs.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-4">
            <button
              onClick={() => setOrgFilter(null)}
              className={`font-mono text-[10px] px-2.5 py-1 rounded-sm border transition-all ${
                orgFilter === null
                  ? 'border-bone/60 text-bone bg-bone/10'
                  : 'border-ghost/20 text-ghost hover:border-ghost'
              }`}
            >
              ALL
            </button>
            {majorOrgs.map(o => (
              <button
                key={o.org_id}
                onClick={() => setOrgFilter(orgFilter === o.code ? null : o.code)}
                className="font-mono text-[10px] px-2.5 py-1 rounded-sm border transition-all"
                style={orgFilter === o.code
                  ? { borderColor: o.color, color: o.color, backgroundColor: o.color + '20' }
                  : { borderColor: o.color + '50', color: o.color + 'AA' }
                }
              >
                {o.code}
              </button>
            ))}
          </div>
        )}

        {/* Two-column layout: board + feed */}
        <div className="flex gap-6 flex-col xl:flex-row">
          {/* Board (left) */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="text-center py-24">
                <span className="font-mono text-ghost text-sm animate-pulse tracking-widest">
                  LOADING BOUNTY DATA...
                </span>
              </div>
            ) : (
              <>
                {tab === 'operatives' && (
                  <div className="border border-ghost/20 rounded-sm overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-ghost/20 bg-abyss">
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-left px-4 py-2">RANK</th>
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-left px-4 py-2">CALLSIGN</th>
                          {isMajor && <th className="font-mono text-[10px] text-ghost tracking-widest text-left px-4 py-2">ORG</th>}
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-left px-4 py-2 hidden sm:table-cell">CLEARANCE</th>
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-right px-4 py-2">BC</th>
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-right px-4 py-2 hidden md:table-cell">CONTRACTS</th>
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-right px-4 py-2 hidden lg:table-cell">LAST CLAIM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const filtered = orgFilter
                            ? operatives.filter(r => r.org_code === orgFilter)
                            : operatives
                          if (filtered.length === 0) return (
                            <tr><td colSpan={isMajor ? 7 : 6} className="text-center py-12 font-mono text-ghost text-sm tracking-widest">NO {terms.operator.toUpperCase()}S ON THE BOARD YET</td></tr>
                          )
                          return filtered.map((runner, idx) => (
                            <tr
                              key={runner.id}
                              className={`border-b border-ghost/10 transition-colors ${
                                runner.is_me
                                  ? 'border-l-2 border-l-ember bg-ember/5'
                                  : 'hover:bg-abyss/60'
                              } ${runner.rank <= 3 ? 'bg-abyss' : ''}`}
                            >
                              <td className="px-4 py-3"><RankBadge rank={orgFilter ? idx + 1 : runner.rank} /></td>
                              <td className="px-4 py-3">
                                <Link to={`/operatives/${runner.id}`} className="font-mono text-sm text-bone hover:text-ember transition-colors">
                                  {runner.username}
                                  {runner.is_me && <span className="ml-2 font-mono text-[10px] text-ember">[YOU]</span>}
                                </Link>
                              </td>
                              {isMajor && (
                                <td className="px-4 py-3">
                                  <OrgBadge code={runner.org_code} color={runner.org_color} />
                                </td>
                              )}
                              <td className="px-4 py-3 hidden sm:table-cell"><Badge label={runner.clearance_level} type="clearance" /></td>
                              <td className="px-4 py-3 text-right">
                                <span className="font-mono font-bold text-ember">{runner.bc_total}</span>
                                <span className="font-mono text-xs text-ghost ml-1">BC</span>
                              </td>
                              <td className="px-4 py-3 text-right hidden md:table-cell">
                                <span className="font-mono text-sm text-ghost">{runner.claim_count}</span>
                              </td>
                              <td className="px-4 py-3 text-right hidden lg:table-cell">
                                <span className="font-mono text-xs text-ghost/60">
                                  {runner.last_claim_at
                                    ? new Date(runner.last_claim_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                    : '—'}
                                </span>
                              </td>
                            </tr>
                          ))
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* MAJOR — Organization view */}
                {tab === 'organizations' && (
                  <div className="border border-ghost/20 rounded-sm overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-ghost/20 bg-abyss">
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-left px-4 py-2">RANK</th>
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-left px-4 py-2">ORGANIZATION</th>
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-right px-4 py-2 hidden sm:table-cell">MEMBERS</th>
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-right px-4 py-2">TEAM BC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orgBoard.length === 0 ? (
                          <tr><td colSpan={4} className="text-center py-12 font-mono text-ghost text-sm tracking-widest">NO ORGANIZATIONS ON THE BOARD YET</td></tr>
                        ) : (
                          orgBoard.map(org => (
                            <>
                              <tr
                                key={org.org_id}
                                onClick={() => setExpandedOrg(expandedOrg === org.org_id ? null : org.org_id)}
                                className="border-b border-ghost/10 hover:bg-abyss/60 cursor-pointer transition-colors"
                                style={org.org_id === user?.org_id ? { borderLeft: `2px solid ${org.color}` } : {}}
                              >
                                <td className="px-4 py-3">
                                  <span className="font-mono text-xs text-ghost">{expandedOrg === org.org_id ? '▼' : '▶'}</span>
                                  <span className="ml-2"><RankBadge rank={org.rank} /></span>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <OrgBadge code={org.org_code} color={org.color} />
                                    <span className="font-mono text-sm text-bone">{org.org_name}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right hidden sm:table-cell">
                                  <span className="font-mono text-sm text-ghost">{org.member_count}</span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <span className="font-mono font-bold" style={{ color: org.color }}>{org.total_bc}</span>
                                  <span className="font-mono text-xs text-ghost ml-1">BC</span>
                                </td>
                              </tr>
                              {expandedOrg === org.org_id && (
                                <tr key={`${org.org_id}-expanded`} className="border-b border-ghost/10 bg-abyss/40">
                                  <td colSpan={4} className="px-8 py-3">
                                    <div className="space-y-1">
                                      {org.top_performers.map((p, i) => (
                                        <div key={p.user_id} className="flex items-center gap-3">
                                          <span className="font-mono text-[10px] text-ghost/50 w-4">{i + 1}.</span>
                                          <Link to={`/operatives/${p.user_id}`} className="font-mono text-xs text-bone hover:text-ember transition-colors flex-1">
                                            {p.username}
                                          </Link>
                                          <span className="font-mono text-xs" style={{ color: org.color }}>{p.bc} BC</span>
                                        </div>
                                      ))}
                                      {org.member_count > 3 && (
                                        <p className="font-mono text-[10px] text-ghost/40 mt-1">+ {org.member_count - 3} more participants</p>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {tab === 'teams' && (
                  <div className="border border-ghost/20 rounded-sm overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-ghost/20 bg-abyss">
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-left px-4 py-2">RANK</th>
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-left px-4 py-2">TEAM</th>
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-right px-4 py-2">BC</th>
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-right px-4 py-2 hidden sm:table-cell">MEMBERS</th>
                          <th className="font-mono text-[10px] text-ghost tracking-widest text-right px-4 py-2 hidden md:table-cell">CONTRACTS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teams.length === 0 ? (
                          <tr><td colSpan={5} className="text-center py-12 font-mono text-ghost text-sm tracking-widest">NO TEAMS REGISTERED YET</td></tr>
                        ) : (
                          teams.map(syn => (
                            <tr
                              key={syn.id}
                              className={`border-b border-ghost/10 transition-colors ${
                                syn.is_mine ? 'border-l-2 border-l-ember bg-ember/5' : 'hover:bg-abyss/60'
                              }`}
                            >
                              <td className="px-4 py-3"><RankBadge rank={syn.rank} /></td>
                              <td className="px-4 py-3">
                                <Link to={`/teams/${syn.id}`} className="font-mono text-sm text-bone hover:text-ember transition-colors">
                                  {synDisplayName(syn.name, syn.captain_school, syn.captain_section, format, showSection)}
                                  {syn.is_mine && <span className="ml-2 font-mono text-[10px] text-ember">[YOUR CREW]</span>}
                                </Link>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className="font-mono font-bold text-ember">{syn.total_bc}</span>
                                <span className="font-mono text-xs text-ghost ml-1">BC</span>
                              </td>
                              <td className="px-4 py-3 text-right hidden sm:table-cell">
                                <span className="font-mono text-sm text-ghost">{syn.member_count}</span>
                              </td>
                              <td className="px-4 py-3 text-right hidden md:table-cell">
                                <span className="font-mono text-sm text-ghost">{syn.claim_count}</span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Graphs */}
                {tab === 'teams' && (
                  <div className="mt-6 border border-ghost/20 rounded-sm bg-abyss">
                    <button onClick={() => setShowSynGraph(v => !v)} className="w-full flex items-center justify-between px-4 py-3 font-mono text-xs text-ghost hover:text-bone tracking-widest transition-colors">
                      <span>BC PROGRESSION — TOP 10 TEAMS</span>
                      <span>{showSynGraph ? '▲ COLLAPSE' : '▼ EXPAND'}</span>
                    </button>
                    {showSynGraph && (
                      <div className="px-4 pb-4">
                        {synChartData.length === 0 ? (
                          <p className="font-mono text-xs text-ghost/60 text-center py-8 tracking-widest">NO TEAM CLAIM DATA YET</p>
                        ) : (
                          <ResponsiveContainer width="100%" height={280}>
                            <LineChart data={synChartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(107,107,128,0.15)" />
                              <XAxis dataKey="time" tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#6B6B80' }} axisLine={{ stroke: 'rgba(107,107,128,0.3)' }} />
                              <YAxis tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#6B6B80' }} axisLine={{ stroke: 'rgba(107,107,128,0.3)' }} />
                              <Tooltip contentStyle={{ backgroundColor: '#12121A', border: '1px solid rgba(107,107,128,0.3)', borderRadius: '2px', fontFamily: 'JetBrains Mono', fontSize: 11 }} labelStyle={{ color: '#6B6B80' }} />
                              <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10 }} />
                              {synChartKeys.map((key, i) => (
                                <Line key={key} type="stepAfter" dataKey={key} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                              ))}
                            </LineChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {tab === 'operatives' && (!isMajor || boardView !== 'organization') && (
                  <div className="mt-6 border border-ghost/20 rounded-sm bg-abyss">
                    <button onClick={() => setShowGraph(v => !v)} className="w-full flex items-center justify-between px-4 py-3 font-mono text-xs text-ghost hover:text-bone tracking-widest transition-colors">
                      <span>BC PROGRESSION — TOP 10</span>
                      <span>{showGraph ? '▲ COLLAPSE' : '▼ EXPAND'}</span>
                    </button>
                    {showGraph && (
                      <div className="px-4 pb-4">
                        {chartData.length === 0 ? (
                          <p className="font-mono text-xs text-ghost/60 text-center py-8 tracking-widest">NO CLAIM DATA YET</p>
                        ) : (
                          <ResponsiveContainer width="100%" height={280}>
                            <LineChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(107,107,128,0.15)" />
                              <XAxis dataKey="time" tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#6B6B80' }} axisLine={{ stroke: 'rgba(107,107,128,0.3)' }} />
                              <YAxis tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#6B6B80' }} axisLine={{ stroke: 'rgba(107,107,128,0.3)' }} />
                              <Tooltip contentStyle={{ backgroundColor: '#12121A', border: '1px solid rgba(107,107,128,0.3)', borderRadius: '2px', fontFamily: 'JetBrains Mono', fontSize: 11 }} labelStyle={{ color: '#6B6B80' }} />
                              <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10 }} />
                              {chartKeys.map((key, i) => (
                                <Line key={key} type="stepAfter" dataKey={key} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                              ))}
                            </LineChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    )}
                  </div>
                )}
              {/* Removed participants — admin only */}
              {tab === 'operatives' && removedParticipants.length > 0 && (
                <div className="mt-6 border border-ghost/20 rounded-sm bg-abyss">
                  <button
                    onClick={() => setShowRemoved(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 font-mono text-xs text-ghost hover:text-bone tracking-widest transition-colors"
                  >
                    <span className="text-ghost/60">REMOVED PARTICIPANTS ({removedParticipants.length})</span>
                    <span>{showRemoved ? '▲ COLLAPSE' : '▼ EXPAND'}</span>
                  </button>
                  {showRemoved && (
                    <div className="px-4 pb-4 space-y-1">
                      {removedParticipants.map((r, i) => (
                        <div key={i} className="flex items-center gap-3 py-1 font-mono text-xs text-ghost/60 border-b border-ghost/10">
                          <span className="text-ghost line-through">{r.callsign}</span>
                          <span className="text-ghost/40 ml-auto">{r.bc_wiped} BC wiped</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              </>
            )}
          </div>

          {/* Solve Feed (right) */}
          <div className="xl:w-72 flex-shrink-0">
            <div className="border border-ghost/20 rounded-sm bg-abyss h-full">
              <div className="px-3 py-2 border-b border-ghost/10 flex items-center justify-between">
                <span className="font-mono text-[10px] text-ghost tracking-widest">SOLVE FEED</span>
                {feedState === 'ACTIVE' ? (
                  <span className="inline-flex items-center gap-1 font-mono text-[9px] text-ghost/50">
                    <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
                    LIVE
                  </span>
                ) : (
                  <span className="font-mono text-[9px] text-ghost/30">OFFLINE</span>
                )}
              </div>
              <div className="p-2 flex flex-col gap-1 max-h-[600px] overflow-y-auto">
                {feedState === 'NO_EVENT' ? (
                  <div className="font-mono text-[10px] text-ghost/40 py-6 px-1 space-y-1">
                    <p>&gt; SOLVE FEED OFFLINE</p>
                    <p>&gt; No active competition.</p>
                    <p className="mt-2 text-ghost/25">&gt; Solve feed will be live during the event.</p>
                  </div>
                ) : feed.length === 0 ? (
                  <div className="font-mono text-[10px] text-ghost/40 py-6 px-1 space-y-1">
                    <p>&gt; NO ACTIVITY YET</p>
                    <p className="text-ghost/25">&gt; Be the first to claim a contract.</p>
                  </div>
                ) : (
                  feed.map((entry, i) => {
                    const isJackpot = entry.is_cc && entry.bc_earned >= 500
                    return (
                      <div
                        key={i}
                        className={`font-mono text-[10px] px-2 py-1.5 rounded-sm border-l-2 border border-ghost/10 ${
                          isJackpot
                            ? 'border-l-ember bg-ember/5 text-ember border-ember/20'
                            : entry.is_cc
                            ? 'border-l-danger bg-danger/5 text-danger border-danger/20'
                            : entry.is_first_blood
                            ? 'border-l-ember bg-ember/5 text-ember border-ember/20'
                            : 'border-l-ghost/20 bg-void/50 text-ghost'
                        }`}
                      >
                        {entry.is_cc ? (
                          isJackpot ? (
                            <span>
                              MAXIMUM SIGNAL —{' '}
                              <span className="text-bone font-bold">{entry.operative_username}</span>{' '}
                              extracted{' '}
                              <span className="font-bold">{entry.bc_earned} BC</span>{' '}
                              from a EMERGENCY CONTRACT
                            </span>
                          ) : (
                            <span>
                              <span className="text-bone">{entry.operative_username}</span>{' '}
                              extracted{' '}
                              <span className="font-bold">{entry.bc_earned} BC</span>{' '}
                              from a EMERGENCY CONTRACT
                            </span>
                          )
                        ) : entry.is_first_blood ? (
                          <span>
                            CONTRACT SEIZED —{' '}
                            <span className="text-bone">{entry.operative_username}</span>
                            {isMajorFeed && entry.org_code && (
                              <>{' '}<OrgBadge code={entry.org_code} color={entry.org_color} /></>
                            )}{' '}
                            was first to claim{' '}
                            <span className="text-bone">{entry.contract_title}</span>{' '}
                            +<span className="font-bold">{entry.bc_earned} BC</span>
                          </span>
                        ) : (
                          <span>
                            <span className="text-bone">{entry.operative_username}</span>
                            {isMajorFeed && entry.org_code && (
                              <>{' '}<OrgBadge code={entry.org_code} color={entry.org_color} /></>
                            )}{' '}
                            claimed{' '}
                            <span className="text-ghost/80">{entry.contract_title}</span>{' '}
                            +<span className="text-ember">{entry.bc_earned} BC</span>
                          </span>
                        )}
                        <div className="text-ghost/40 mt-0.5">
                          {new Date(entry.claimed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}
