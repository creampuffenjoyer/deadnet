import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import client from '../../api/client'
import Navbar from '../../components/ui/Navbar'
import Footer from '../../components/ui/Footer'
import Scanlines from '../../components/effects/Scanlines'
import Badge from '../../components/ui/Badge'
import { useAuth } from '../../context/AuthContext'
import { usePlatformTerms } from '../../hooks/usePlatformTerms'

export default function HandlerDashboard() {
  const { user } = useAuth()
  const terms = usePlatformTerms()
  const [operatives, setOperatives] = useState([])
  const [teams, setTeams] = useState([])
  const [board, setBoard] = useState([])
  const [boardMeta, setBoardMeta] = useState({ is_major: false, orgs: [] })
  const [orgFilter, setOrgFilter] = useState(null)   // null = ALL
  const [transmissions, setTransmissions] = useState([])
  const [activeEvent, setActiveEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [dashError, setDashError] = useState(false)

  function fetchDashboard() {
    setDashError(false)
    setLoading(true)
    Promise.all([
      client.get('/handler/my-operatives'),
      client.get('/handler/my-teams'),
      client.get('/bounty-board/operatives'),
      client.get('/transmissions/'),
      client.get('/events/active').catch(() => ({ data: { active: null, upcoming: null } })),
    ]).then(([nrRes, synRes, boardRes, txRes, evRes]) => {
      setOperatives(nrRes.data)
      setTeams(synRes.data)
      const fullBoard = boardRes.data.board || []
      setBoard(fullBoard.slice(0, 10))
      setBoardMeta({ is_major: boardRes.data.is_major || false, orgs: boardRes.data.orgs || [] })
      setTransmissions(txRes.data.slice(0, 5))
      setActiveEvent(evRes.data.active || evRes.data.upcoming || null)
    }).catch(() => setDashError(true)).finally(() => setLoading(false))
  }

  useEffect(() => { fetchDashboard() }, [])

  if (loading) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Scanlines />
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <span className="font-mono text-ghost animate-pulse tracking-widest">LOADING ADVISOR CONSOLE...</span>
        </div>
        <Footer />
      </div>
    )
  }

  if (dashError) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Scanlines />
        <Navbar />
        <div className="flex-1 flex items-center justify-center flex-col gap-4">
          <p className="font-mono text-danger tracking-widest">FAILED TO LOAD ADVISOR CONSOLE</p>
          <button
            onClick={fetchDashboard}
            className="font-mono text-xs text-ghost border border-ghost/30 hover:border-ember hover:text-ember px-4 py-2 rounded-sm tracking-widest transition-all"
          >
            [ RETRY ]
          </button>
        </div>
        <Footer />
      </div>
    )
  }

  const isMajorEvent = activeEvent?.event_type === 'MAJOR'
  // Determine own org code for auto-filter default on MAJOR events
  const ownOrgCode = isMajorEvent
    ? (boardMeta.orgs.find(o => o.id === user?.org_id)?.code || null)
    : null

  // Filtered board: apply org filter pill if set
  const filteredBoard = orgFilter
    ? board.filter(r => r.org_code === orgFilter)
    : board

  return (
    <div className="relative min-h-screen bg-void text-bone flex flex-col">
      <Scanlines />
      <Navbar />

      <div className="relative z-10 flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        <div className="mb-6">
          <p className="font-mono text-xs text-ghost tracking-widest mb-1">ADVISOR CONSOLE</p>
          <h1 className="font-mono font-bold text-3xl text-ember tracking-widest">ASSIGNED UNITS</h1>
        </div>

        {/* MAJOR EVENT banner */}
        {isMajorEvent && (
          <div className="mb-5 border border-flare/30 bg-flare/5 rounded-sm px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="font-mono text-[10px] border border-flare/60 text-flare px-2 py-0.5 rounded-sm tracking-widest shrink-0">
              MAJOR EVENT
            </span>
            <span className="font-mono font-bold text-bone text-sm">{activeEvent.name}</span>
            {activeEvent.host_org_name && (
              <span className="font-mono text-xs text-ghost">
                Hosted by: <span className="text-bone">{activeEvent.host_org_name}</span>
              </span>
            )}
            {activeEvent.participating_as === 'PARTNER' && (
              <span className="font-mono text-xs text-ember ml-auto">PARTICIPATING AS PARTNER</span>
            )}
          </div>
        )}

        {/* Transmissions */}
        {transmissions.length > 0 && (
          <div className="mb-6 border border-ember/20 bg-ember/5 rounded-sm overflow-hidden">
            <div className="px-4 py-2 border-b border-ember/10">
              <span className="font-mono text-xs text-ember tracking-widest font-bold">NETWORK TRANSMISSIONS</span>
            </div>
            <div className="divide-y divide-ghost/10">
              {transmissions.map(tx => (
                <div key={tx.id} className="px-4 py-2">
                  <p className="font-mono text-sm text-bone">{tx.content}</p>
                  <p className="font-mono text-[10px] text-ghost mt-0.5">{tx.author_username} · {new Date(tx.created_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Assigned Operatives + Teams */}
          <div className="lg:col-span-2 space-y-6">
            <div className="border border-ghost/20 rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-ghost/10 bg-abyss">
                <span className="font-mono text-xs text-ghost tracking-widest">
                  ASSIGNED {terms.operator.toUpperCase()}S — {operatives.length}
                </span>
              </div>
              {operatives.length === 0 ? (
                <div className="text-center py-10">
                  <p className="font-mono text-xs text-ghost tracking-widest">NO {terms.operator.toUpperCase()}S ASSIGNED</p>
                  <p className="font-mono text-[10px] text-ghost/50 mt-2">Contact the Architect to receive assignments.</p>
                </div>
              ) : (
                <div className="divide-y divide-ghost/10">
                  {operatives.map(nr => (
                    <div key={nr.id} className="flex items-center justify-between px-4 py-3 hover:bg-abyss/60 transition-colors">
                      <div className="flex items-center gap-3">
                        <Link to={`/operatives/${nr.id}`} className="font-mono text-sm text-bone hover:text-ember transition-colors">
                          {nr.username}
                        </Link>
                        <Badge label={nr.clearance_level} type="clearance" />
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-mono font-bold text-ember">{nr.bc_total} BC</span>
                        <Link
                          to={`/operatives/${nr.id}`}
                          className="font-mono text-[10px] text-ghost hover:text-ember border border-ghost/20 hover:border-ember px-2 py-1 rounded-sm transition-all"
                        >
                          VIEW →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {teams.length > 0 && (
              <div className="border border-ghost/20 rounded-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-ghost/10 bg-abyss">
                  <span className="font-mono text-xs text-ghost tracking-widest">
                    ASSIGNED TEAMS — {teams.length}
                  </span>
                </div>
                <div className="divide-y divide-ghost/10">
                  {teams.map(syn => (
                    <div key={syn.id} className="flex items-center justify-between px-4 py-3 hover:bg-abyss/60 transition-colors">
                      <Link to={`/teams/${syn.id}`} className="font-mono text-sm text-bone hover:text-ember transition-colors">
                        {syn.name}
                      </Link>
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-xs text-ghost">{syn.member_count} members</span>
                        <span className="font-mono font-bold text-ember">{syn.total_bc} BC</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Live mini Bounty Board */}
          <div className="border border-ghost/20 rounded-sm overflow-hidden h-fit">
            <div className="px-4 py-3 border-b border-ghost/10 bg-abyss flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse inline-block" />
              <span className="font-mono text-xs text-ghost tracking-widest">
                {isMajorEvent ? 'INTERCAMPUS BOARD' : 'BOUNTY BOARD'} — TOP 10
              </span>
            </div>

            {/* Org filter pills — MAJOR only */}
            {isMajorEvent && boardMeta.orgs.length > 0 && (
              <div className="px-3 py-2 border-b border-ghost/10 flex flex-wrap gap-1.5">
                <button
                  onClick={() => setOrgFilter(null)}
                  className={`font-mono text-[10px] px-2 py-0.5 rounded-sm border transition-colors ${
                    orgFilter === null
                      ? 'bg-ghost/20 border-ghost/40 text-bone'
                      : 'border-ghost/20 text-ghost hover:text-bone'
                  }`}
                >
                  ALL
                </button>
                {boardMeta.orgs.map(o => (
                  <button
                    key={o.code}
                    onClick={() => setOrgFilter(orgFilter === o.code ? null : o.code)}
                    className="font-mono text-[10px] px-2 py-0.5 rounded-sm border transition-colors"
                    style={orgFilter === o.code
                      ? { background: o.color + '30', borderColor: o.color, color: o.color }
                      : { borderColor: o.color + '50', color: o.color + 'CC' }
                    }
                  >
                    {o.code}
                    {o.code === ownOrgCode && ' ★'}
                  </button>
                ))}
              </div>
            )}

            {filteredBoard.length === 0 ? (
              <div className="text-center py-8">
                <p className="font-mono text-xs text-ghost tracking-widest">NO DATA YET</p>
              </div>
            ) : (
              <div className="divide-y divide-ghost/10">
                {filteredBoard.map(r => (
                  <div key={r.id} className={`flex items-center justify-between px-3 py-2 ${r.rank <= 3 ? 'bg-abyss/60' : ''}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`font-mono text-xs w-6 shrink-0 ${r.rank === 1 ? 'text-ember font-bold' : 'text-ghost'}`}>
                        #{r.rank}
                      </span>
                      <span className="font-mono text-xs text-bone truncate">{r.username}</span>
                      {isMajorEvent && r.org_code && (
                        <span
                          className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm border shrink-0"
                          style={{ borderColor: r.org_color + '60', color: r.org_color, background: r.org_color + '15' }}
                        >
                          {r.org_code}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-xs text-ember font-bold shrink-0">{r.bc_total} BC</span>
                  </div>
                ))}
              </div>
            )}
            <div className="px-4 py-2 border-t border-ghost/10">
              <Link to="/bounty-board" className="font-mono text-[10px] text-ember hover:text-flare tracking-widest">
                FULL BOARD →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  )
}
