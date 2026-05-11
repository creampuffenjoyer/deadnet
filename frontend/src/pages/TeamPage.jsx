import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useEventStatus } from '../hooks/useEventStatus'
import { useMyRegistration } from '../hooks/useMyRegistration'
import client from '../api/client'
import Navbar from '../components/ui/Navbar'
import OfflineLock from '../components/ui/OfflineLock'
import CCBanner from '../components/cc/CCBanner'
import Footer from '../components/ui/Footer'
import Scanlines from '../components/effects/Scanlines'
import Badge from '../components/ui/Badge'
import { usePlatformFormat, synDisplayName } from '../hooks/usePlatformFormat'

function TeamCreate({ onCreated }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await client.post('/teams/', { name: name.trim() })
      onCreated()
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(
        detail === 'ALREADY_IN_TEAM' ? 'You are already in a team.'
        : detail === 'NAME_TAKEN' ? 'That team name is already taken.'
        : 'Failed to create team.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border border-ghost/20 bg-abyss rounded-sm p-4">
      <p className="font-mono text-xs text-ghost tracking-widest mb-3">FOUND A TEAM</p>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-2 font-mono text-sm text-bone placeholder-ghost/40 outline-none transition-all"
          placeholder="TEAM NAME"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={100}
        />
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="font-mono text-xs text-ember border border-ember/50 hover:border-ember hover:bg-ember/10 px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
        >
          [ CREATE ]
        </button>
      </div>
      {error && (
        <p className="font-mono text-xs text-danger mt-2">⚠ {error}</p>
      )}
    </form>
  )
}

function TeamJoin({ onJoined }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await client.post('/teams/join', { invite_code: code.trim() })
      onJoined()
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(
        detail === 'ALREADY_IN_TEAM' ? 'You are already in a team.'
        : detail === 'INVALID_INVITE_CODE' ? 'Invalid invite code.'
        : 'Failed to join team.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border border-ghost/20 bg-abyss rounded-sm p-4">
      <p className="font-mono text-xs text-ghost tracking-widest mb-3">JOIN A TEAM</p>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-2 font-mono text-sm text-bone placeholder-ghost/40 outline-none transition-all uppercase"
          placeholder="INVITE CODE"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          maxLength={10}
        />
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="font-mono text-xs text-ember border border-ember/50 hover:border-ember hover:bg-ember/10 px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
        >
          [ JOIN ]
        </button>
      </div>
      {error && (
        <p className="font-mono text-xs text-danger mt-2">⚠ {error}</p>
      )}
    </form>
  )
}

export default function TeamPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const { active: activeEvent, upcoming: upcomingEvent, loading: eventLoading } = useEventStatus()
  const regStatus = useMyRegistration(activeEvent?.id || null)
  const navigate = useNavigate()
  const [team, setTeam] = useState(null)
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [myTeam, setMyTeam] = useState(null)
  const [leaveLoading, setLeaveLoading] = useState(false)
  const [leaveError, setLeaveError] = useState('')
  const [transferTarget, setTransferTarget] = useState('')

  // Assignments state
  const [detailTab, setDetailTab] = useState('roster')
  const [assignments, setAssignments] = useState([])
  const [showSolved, setShowSolved] = useState(false)
  const [contracts, setContracts] = useState([])
  const [contractsLoaded, setContractsLoaded] = useState(false)
  const [assignTarget, setAssignTarget] = useState('')
  const [assignContract, setAssignContract] = useState('')
  const [assignSearch, setAssignSearch] = useState('')
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [showAssignForm, setShowAssignForm] = useState(false)

  // Contract directory state
  const [contractSort, setContractSort] = useState('default')
  const [contractSearch, setContractSearch] = useState('')
  const [inlineAssignId, setInlineAssignId] = useState(null)
  const [inlineAssignPick, setInlineAssignPick] = useState('')
  const [inlineAssignLoading, setInlineAssignLoading] = useState(false)
  const [inlineAssignError, setInlineAssignError] = useState('')

  const isOperative = user?.role === 'OPERATIVE'
  const { format, showSection } = usePlatformFormat()

  const fetchData = async () => {
    try {
      const listRes = await client.get('/teams/')
      setTeams(listRes.data)
      const mine = listRes.data.find(s => s.is_mine)
      setMyTeam(mine || null)

      if (id) {
        const detailRes = await client.get(`/teams/${id}`)
        setTeam(detailRes.data)
      }
    } catch {
      // noop
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [id])

  const fetchAssignments = useCallback(async (teamId) => {
    try {
      const { data } = await client.get(`/teams/${teamId}/assignments`)
      setAssignments(data)
    } catch {}
  }, [])

  useEffect(() => {
    if (!id || !team?.is_mine) return
    fetchAssignments(id)
    const intervalId = setInterval(() => fetchAssignments(id), 10_000)
    return () => clearInterval(intervalId)
  }, [id, team?.is_mine, fetchAssignments])

  const loadContracts = async () => {
    if (contractsLoaded) return
    try {
      const { data } = await client.get('/contracts/')
      setContracts(data)
      setContractsLoaded(true)
    } catch {}
  }

  const handleAssign = async (e) => {
    e.preventDefault()
    if (!assignTarget || !assignContract) return
    setAssignLoading(true)
    setAssignError('')
    try {
      const newAssign = await client.post(`/teams/${id}/assignments`, {
        assigned_to_id: assignTarget,
        contract_id: assignContract,
      })
      setAssignments(prev => [newAssign.data, ...prev])
      setAssignContract('')
      setAssignSearch('')
      setShowAssignForm(false)
    } catch (err) {
      const detail = err?.response?.data?.detail
      setAssignError(
        detail === 'ALREADY_ASSIGNED' ? 'Already assigned to this operative.'
        : detail === 'ASSIGNEE_NOT_IN_TEAM' ? 'Operative is not in your team.'
        : detail === 'CONTRACT_NOT_FOUND' ? 'Contract not found.'
        : 'Failed to assign.'
      )
    } finally {
      setAssignLoading(false)
    }
  }

  const handleRemoveAssignment = async (assignmentId) => {
    try {
      await client.delete(`/teams/${id}/assignments/${assignmentId}`)
      setAssignments(prev => prev.filter(a => a.id !== assignmentId))
    } catch {}
  }

  const handleInlineAssign = async (contractId) => {
    if (!inlineAssignPick) return
    setInlineAssignLoading(true)
    setInlineAssignError('')
    try {
      const res = await client.post(`/teams/${id}/assignments`, {
        assigned_to_id: inlineAssignPick,
        contract_id: contractId,
      })
      setAssignments(prev => [res.data, ...prev])
      setInlineAssignId(null)
      setInlineAssignPick('')
    } catch (err) {
      const detail = err?.response?.data?.detail
      setInlineAssignError(
        detail === 'ALREADY_ASSIGNED' ? 'Already assigned to this operative.'
        : detail === 'ASSIGNEE_NOT_IN_TEAM' ? 'Operative not in team.'
        : 'Failed to assign.'
      )
    } finally {
      setInlineAssignLoading(false)
    }
  }

  const RARITY_ORDER_MAP = { CLASSIFIED: 0, RARE: 1, COMMON: 2 }
  const RARITY_COLOR_MAP = { COMMON: '#8A8A9A', RARE: '#4A9EFF', CLASSIFIED: '#FF2D2D' }

  const sortedContracts = useMemo(() => {
    let list = contracts.filter(c => !c.is_void)
    if (contractSearch.trim()) {
      const q = contractSearch.trim().toLowerCase()
      list = list.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q)
      )
    }
    const copy = [...list]
    if (contractSort === 'bc_desc') return copy.sort((a, b) => b.current_bc_value - a.current_bc_value)
    if (contractSort === 'bc_asc')  return copy.sort((a, b) => a.current_bc_value - b.current_bc_value)
    if (contractSort === 'title')   return copy.sort((a, b) => a.title.localeCompare(b.title))
    if (contractSort === 'rarity')  return copy.sort((a, b) => (RARITY_ORDER_MAP[a.rarity] ?? 9) - (RARITY_ORDER_MAP[b.rarity] ?? 9))
    return copy
  }, [contracts, contractSearch, contractSort])

  const handleLeave = async () => {
    if (!team) return
    setLeaveLoading(true)
    setLeaveError('')
    try {
      await client.post(`/teams/${team.id}/leave`)
      navigate('/teams')
      fetchData()
    } catch (err) {
      const detail = err?.response?.data?.detail
      setLeaveError(
        detail === 'CAPTAIN_MUST_TRANSFER' ? 'Transfer captaincy before leaving.'
        : 'Failed to leave team.'
      )
    } finally {
      setLeaveLoading(false)
    }
  }

  const handleTransfer = async () => {
    if (!transferTarget || !team) return
    try {
      await client.post(`/teams/${team.id}/transfer`, { new_captain_id: transferTarget })
      fetchData()
      setTransferTarget('')
    } catch (err) {
      const detail = err?.response?.data?.detail
      alert(detail === 'NOT_A_MEMBER' ? 'That Operative is not in your team.' : 'Transfer failed.')
    }
  }

  // Operative lock — no active event
  if (!eventLoading && !activeEvent && user?.role === 'OPERATIVE') {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Navbar />
        <OfflineLock
          title="TEAM REGISTRY OFFLINE"
          lines={[
            '> Teams are formed per event.',
            '> Register for an upcoming event to join or create a team.',
          ]}
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
        <OfflineLock title="TEAM REGISTRY" mode="removed" activeEvent={activeEvent} />
        <Footer />
      </div>
    )
  }

  // Operative lock — active event but not registered
  if (!eventLoading && activeEvent && user?.role === 'OPERATIVE' && !regStatus.loading && !regStatus.registered) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Navbar />
        <OfflineLock title="TEAM REGISTRY" mode="not_registered" activeEvent={activeEvent} />
        <Footer />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Scanlines />
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <span className="font-mono text-ghost animate-pulse tracking-widest">LOADING...</span>
        </div>
        <Footer />
      </div>
    )
  }

  // ── Teams list (no ID in URL) ─────────────────────────────────────────
  if (!id) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Scanlines />
        <Navbar />

        <div className="relative z-10 flex-1 max-w-6xl mx-auto w-full px-4 py-8">
          <h1 className="font-mono font-bold text-3xl text-ember tracking-widest mb-6">
            TEAMS
          </h1>

          {/* Operative: create/join UI if not already in one */}
          {isOperative && !myTeam && (
            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              <TeamCreate onCreated={fetchData} />
              <TeamJoin onJoined={fetchData} />
            </div>
          )}

          {/* My team banner */}
          {isOperative && myTeam && (
            <div className="mb-6 border border-ember/30 bg-ember/5 rounded-sm px-4 py-3 flex items-center justify-between">
              <div>
                <span className="font-mono text-xs text-ghost tracking-widest">YOUR TEAM</span>
                <p className="font-mono font-bold text-ember">{synDisplayName(myTeam.name, myTeam.captain_school, myTeam.captain_section, format, showSection)}</p>
                {myTeam.invite_code && (
                  <p className="font-mono text-xs text-ghost mt-0.5">
                    INVITE CODE: <span className="text-bone font-bold tracking-widest">{myTeam.invite_code}</span>
                  </p>
                )}
              </div>
              <Link
                to={`/teams/${myTeam.id}`}
                className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-3 py-1.5 rounded-sm transition-all"
              >
                [ VIEW ]
              </Link>
            </div>
          )}

          {/* Team list */}
          <div className="border border-ghost/20 rounded-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-ghost/10 bg-abyss">
              <span className="font-mono text-xs text-ghost tracking-widest">
                ALL TEAMS — {teams.length} REGISTERED
              </span>
            </div>
            {teams.length === 0 ? (
              <div className="text-center py-12">
                <p className="font-mono text-ghost text-sm tracking-widest">
                  NO TEAMS YET — BE THE FIRST TO ORGANIZE
                </p>
              </div>
            ) : (
              <div className="divide-y divide-ghost/10">
                {teams.map(syn => (
                  <Link
                    key={syn.id}
                    to={`/teams/${syn.id}`}
                    className={`flex items-center justify-between px-4 py-3 transition-colors hover:bg-abyss/60 ${syn.is_mine ? 'border-l-2 border-l-ember' : ''}`}
                  >
                    <div>
                      <span className="font-mono text-sm text-bone">{synDisplayName(syn.name, syn.captain_school, syn.captain_section, format, showSection)}</span>
                      {syn.is_mine && (
                        <span className="ml-2 font-mono text-[10px] text-ember">[YOUR CREW]</span>
                      )}
                    </div>
                    <span className="font-mono text-xs text-ghost">{syn.member_count} member{syn.member_count !== 1 ? 's' : ''}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <Footer />
      </div>
    )
  }

  // ── Team detail ───────────────────────────────────────────────────────
  if (!team) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Scanlines />
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <p className="font-mono text-ghost tracking-widest">TEAM NOT FOUND</p>
        </div>
        <Footer />
      </div>
    )
  }

  const isCaptain = team.is_captain
  const isMine = team.is_mine

  return (
    <div className="relative min-h-screen bg-void text-bone flex flex-col">
      <Scanlines />
      <Navbar />
      <CCBanner />

      <div className="relative z-10 flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        {/* Back link */}
        <Link to="/teams" className="font-mono text-xs text-ghost hover:text-bone tracking-widest mb-6 inline-block">
          ← ALL TEAMS
        </Link>

        {/* Header */}
        <div className="border border-ghost/20 bg-abyss rounded-sm p-6 mb-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className="font-mono font-bold text-2xl text-ember tracking-widest">
                {synDisplayName(team.name, team.captain_school, team.captain_section, format, showSection)}
              </h1>
              {isMine && team.invite_code && (
                <p className="font-mono text-xs text-ghost mt-1 tracking-widest">
                  INVITE CODE: <span className="text-bone font-bold">{team.invite_code}</span>
                </p>
              )}
            </div>
            <div className="flex gap-4">
              <div className="text-center">
                <div className="font-mono font-bold text-xl text-ember">{team.total_bc}</div>
                <div className="font-mono text-[10px] text-ghost tracking-widest">TOTAL BC</div>
              </div>
              <div className="text-center">
                <div className="font-mono font-bold text-xl text-bone">{team.members.length}</div>
                <div className="font-mono text-[10px] text-ghost tracking-widest">MEMBERS</div>
              </div>
              <div className="text-center">
                <div className="font-mono font-bold text-xl text-bone">{team.claim_count}</div>
                <div className="font-mono text-[10px] text-ghost tracking-widest">CONTRACTS</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab switcher (members only) */}
        {isMine && (
          <div className="flex gap-1 mb-4">
            {[
              { key: 'roster', label: 'ROSTER' },
              { key: 'assignments', label: 'ASSIGNMENTS' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => {
                  setDetailTab(t.key)
                  if (t.key === 'assignments') loadContracts()
                }}
                className={`font-mono text-xs tracking-widest px-4 py-1.5 rounded-sm border transition-all ${
                  detailTab === t.key
                    ? 'border-ember text-ember bg-ember/10'
                    : 'border-ghost/20 text-ghost hover:border-ghost hover:text-bone'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* ── ASSIGNMENTS TAB ─────────────────────────────────────────────── */}
        {isMine && detailTab === 'assignments' && (
          <div className="mb-6">
            {/* Assign form toggle */}
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-xs text-ghost tracking-widest">
                MISSION ASSIGNMENTS
              </span>
              <button
                onClick={() => { setShowAssignForm(v => !v); setAssignError('') }}
                className="font-mono text-xs text-ember border border-ember/40 hover:border-ember hover:bg-ember/10 px-3 py-1.5 rounded-sm tracking-widest transition-all"
              >
                {showAssignForm ? '[ CANCEL ]' : '[ + ASSIGN ]'}
              </button>
            </div>

            {/* Assign form */}
            {showAssignForm && (
              <form onSubmit={handleAssign} className="border border-ghost/20 bg-abyss rounded-sm p-4 mb-4">
                <div className="grid sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <p className="font-mono text-[10px] text-ghost tracking-widest mb-1">ASSIGN TO</p>
                    <select
                      value={assignTarget}
                      onChange={e => setAssignTarget(e.target.value)}
                      className="w-full bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-2 font-mono text-sm text-bone outline-none transition-all"
                    >
                      <option value="">SELECT OPERATIVE</option>
                      {team.members.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.username}{m.is_captain ? ' [CAPTAIN]' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] text-ghost tracking-widest mb-1">CONTRACT</p>
                    <input
                      className="w-full bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-2 font-mono text-sm text-bone placeholder-ghost/40 outline-none transition-all"
                      placeholder="SEARCH CONTRACT..."
                      value={assignSearch}
                      onChange={e => { setAssignSearch(e.target.value); setAssignContract('') }}
                    />
                    {assignSearch.trim() && (
                      <div className="border border-ghost/20 bg-abyss rounded-sm mt-1 max-h-40 overflow-y-auto">
                        {contracts
                          .filter(c => c.title.toLowerCase().includes(assignSearch.toLowerCase()))
                          .slice(0, 8)
                          .map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => { setAssignContract(c.id); setAssignSearch(c.title) }}
                              className={`w-full text-left px-3 py-2 font-mono text-xs transition-colors hover:bg-ghost/10 ${
                                assignContract === c.id ? 'text-ember' : 'text-bone'
                              }`}
                            >
                              {c.title}
                              <span className="ml-2 text-ghost">{c.category}</span>
                            </button>
                          ))}
                        {contracts.filter(c => c.title.toLowerCase().includes(assignSearch.toLowerCase())).length === 0 && (
                          <p className="px-3 py-2 font-mono text-xs text-ghost">NO MATCH</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {assignError && (
                  <p className="font-mono text-xs text-danger mb-2">⚠ {assignError}</p>
                )}
                <button
                  type="submit"
                  disabled={assignLoading || !assignTarget || !assignContract}
                  className="font-mono text-xs text-ember border border-ember/50 hover:border-ember hover:bg-ember/10 px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
                >
                  {assignLoading ? 'ASSIGNING...' : '[ CONFIRM ASSIGNMENT ]'}
                </button>
              </form>
            )}

            {/* Filter toggle */}
            <div className="flex gap-1 mb-3">
              {[
                { key: false, label: 'ACTIVE' },
                { key: true,  label: 'SOLVED'  },
              ].map(f => (
                <button
                  key={String(f.key)}
                  onClick={() => setShowSolved(f.key)}
                  className={`font-mono text-[10px] tracking-widest px-3 py-1 rounded-sm border transition-all ${
                    showSolved === f.key
                      ? 'border-ember text-ember bg-ember/10'
                      : 'border-ghost/20 text-ghost hover:border-ghost'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Assignment list */}
            <div className="border border-ghost/20 rounded-sm overflow-hidden">
              {(() => {
                const filtered = assignments.filter(a => showSolved ? a.status === 'SOLVED' : a.status === 'ACTIVE')
                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-8">
                      <p className="font-mono text-xs text-ghost tracking-widest">
                        {showSolved ? 'NO SOLVED ASSIGNMENTS' : 'NO ACTIVE ASSIGNMENTS'}
                      </p>
                    </div>
                  )
                }
                return (
                  <div className="divide-y divide-ghost/10">
                    {filtered.map(a => (
                      <div key={a.id} className="flex items-center justify-between px-4 py-3 gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs text-ember font-bold">{a.assigned_to_username}</span>
                            <span className="font-mono text-ghost text-[10px]">→</span>
                            <span className="font-mono text-sm text-bone truncate">{a.contract_title}</span>
                            <span className="font-mono text-[10px] text-ghost/60 border border-ghost/20 px-1 py-0.5 rounded-sm">
                              {a.contract_category}
                            </span>
                            {a.status === 'SOLVED' && (
                              <span className="font-mono text-[10px] text-success border border-success/30 px-1 py-0.5 rounded-sm">
                                ✓ SOLVED
                              </span>
                            )}
                          </div>
                          <p className="font-mono text-[10px] text-ghost/50 mt-0.5">
                            assigned by {a.assigned_by_username} · {new Date(a.created_at).toLocaleString()}
                          </p>
                        </div>
                        {a.status === 'ACTIVE' && a.can_remove && (
                          <button
                            onClick={() => handleRemoveAssignment(a.id)}
                            className="font-mono text-[10px] text-danger border border-danger/30 hover:border-danger hover:bg-danger/10 px-2 py-1 rounded-sm tracking-widest transition-all shrink-0"
                          >
                            [ REMOVE ]
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>

            {/* ── CONTRACT DIRECTORY ──────────────────────────────────────── */}
            <div className="mt-6">
              {/* Header + controls */}
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <span className="font-mono text-xs text-ghost tracking-widest">CONTRACT DIRECTORY</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    className="bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-1.5 font-mono text-xs text-bone placeholder-ghost/40 outline-none transition-all w-44"
                    placeholder="SEARCH..."
                    value={contractSearch}
                    onChange={e => setContractSearch(e.target.value)}
                  />
                  <select
                    value={contractSort}
                    onChange={e => setContractSort(e.target.value)}
                    className="bg-void border border-ghost/30 focus:border-ember rounded-sm px-2 py-1.5 font-mono text-xs text-bone outline-none transition-all"
                  >
                    <option value="default">DEFAULT</option>
                    <option value="bc_desc">BC: HIGH → LOW</option>
                    <option value="bc_asc">BC: LOW → HIGH</option>
                    <option value="title">TITLE: A → Z</option>
                    <option value="rarity">RARITY</option>
                  </select>
                </div>
              </div>

              {/* Contract rows */}
              <div className="border border-ghost/20 rounded-sm overflow-hidden">
                {!contractsLoaded ? (
                  <div className="text-center py-8">
                    <p className="font-mono text-xs text-ghost animate-pulse tracking-widest">LOADING CONTRACTS...</p>
                  </div>
                ) : sortedContracts.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="font-mono text-xs text-ghost tracking-widest">NO CONTRACTS MATCH</p>
                  </div>
                ) : (
                  <div className="divide-y divide-ghost/10">
                    {sortedContracts.map(c => {
                      const rarityColor = RARITY_COLOR_MAP[c.rarity] ?? '#8A8A9A'
                      const isInlineOpen = inlineAssignId === c.id
                      return (
                        <div key={c.id}>
                          <div className="flex items-center gap-3 px-4 py-3 hover:bg-abyss/60 transition-colors flex-wrap">
                            {/* Rarity stripe */}
                            <div className="w-0.5 h-8 rounded-sm shrink-0" style={{ background: rarityColor }} />

                            {/* Title + category */}
                            <div className="flex-1 min-w-0">
                              <span className="font-mono text-sm text-bone">{c.title}</span>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className="font-mono text-[10px] text-ghost">{c.category}</span>
                                <span
                                  className="font-mono text-[9px] tracking-widest px-1 py-0.5 rounded-sm border"
                                  style={{ color: rarityColor, borderColor: `${rarityColor}40` }}
                                >
                                  {c.rarity}
                                </span>
                              </div>
                            </div>

                            {/* BC value */}
                            <span className="font-mono font-bold text-ember text-sm shrink-0">
                              {c.current_bc_value} BC
                            </span>

                            {/* Team status chips */}
                            <div className="flex flex-wrap gap-1 shrink-0">
                              {c.team_working?.map(u => (
                                <span key={u} className="font-mono text-[9px] text-flare border border-flare/40 bg-flare/5 px-1.5 py-0.5 rounded-sm">
                                  {u}: WORKING
                                </span>
                              ))}
                              {c.team_solved?.map(u => (
                                <span key={u} className="font-mono text-[9px] text-success border border-success/30 bg-success/5 px-1.5 py-0.5 rounded-sm">
                                  {u}: SOLVED
                                </span>
                              ))}
                            </div>

                            {/* Assign toggle */}
                            <button
                              onClick={() => {
                                setInlineAssignId(isInlineOpen ? null : c.id)
                                setInlineAssignPick('')
                                setInlineAssignError('')
                              }}
                              className={`font-mono text-[10px] border px-2 py-1 rounded-sm tracking-widest transition-all shrink-0 ${
                                isInlineOpen
                                  ? 'border-ember text-ember bg-ember/10'
                                  : 'border-ghost/30 text-ghost hover:border-ember hover:text-ember'
                              }`}
                            >
                              {isInlineOpen ? '[ CANCEL ]' : '[ + ASSIGN ]'}
                            </button>
                          </div>

                          {/* Inline assign row */}
                          {isInlineOpen && (
                            <div className="px-4 pb-3 bg-abyss/40 border-t border-ghost/10 flex items-center gap-3 flex-wrap">
                              <select
                                value={inlineAssignPick}
                                onChange={e => { setInlineAssignPick(e.target.value); setInlineAssignError('') }}
                                className="bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-1.5 font-mono text-xs text-bone outline-none transition-all mt-3"
                              >
                                <option value="">SELECT OPERATIVE</option>
                                {team.members.map(m => (
                                  <option key={m.id} value={m.id}>
                                    {m.username}{m.is_captain ? ' [CAPTAIN]' : ''}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleInlineAssign(c.id)}
                                disabled={inlineAssignLoading || !inlineAssignPick}
                                className="font-mono text-[10px] text-ember border border-ember/50 hover:border-ember hover:bg-ember/10 px-3 py-1.5 rounded-sm tracking-widest transition-all disabled:opacity-50 mt-3"
                              >
                                {inlineAssignLoading ? 'ASSIGNING...' : '[ CONFIRM ]'}
                              </button>
                              {inlineAssignError && (
                                <p className="font-mono text-[10px] text-danger mt-3">⚠ {inlineAssignError}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── ROSTER TAB ──────────────────────────────────────────────────── */}
        {(!isMine || detailTab === 'roster') && (
          <>
            <div className="border border-ghost/20 rounded-sm overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-ghost/10 bg-abyss">
                <span className="font-mono text-xs text-ghost tracking-widest">CREW MANIFEST</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-ghost/10">
                    <th className="font-mono text-[10px] text-ghost tracking-widest text-left px-4 py-2">CALLSIGN</th>
                    <th className="font-mono text-[10px] text-ghost tracking-widest text-left px-4 py-2">RANK</th>
                    <th className="font-mono text-[10px] text-ghost tracking-widest text-right px-4 py-2">BC</th>
                    <th className="font-mono text-[10px] text-ghost tracking-widest text-right px-4 py-2 hidden sm:table-cell">JOINED</th>
                  </tr>
                </thead>
                <tbody>
                  {team.members.map(m => (
                    <tr key={m.id} className="border-b border-ghost/10 hover:bg-abyss/60">
                      <td className="px-4 py-2">
                        <Link to={`/operatives/${m.id}`} className="font-mono text-sm text-bone hover:text-ember transition-colors">
                          {m.username}
                        </Link>
                        {m.is_captain && (
                          <span className="ml-2 font-mono text-[10px] text-ember border border-ember/40 px-1 py-0.5 rounded-sm">CAPTAIN</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {isCaptain && !m.is_captain && (
                          <button
                            onClick={() => setTransferTarget(m.id === transferTarget ? '' : m.id)}
                            className={`font-mono text-[10px] border px-2 py-0.5 rounded-sm transition-all ${
                              transferTarget === m.id
                                ? 'text-ember border-ember bg-ember/10'
                                : 'text-ghost border-ghost/30 hover:border-ghost'
                            }`}
                          >
                            {transferTarget === m.id ? 'SELECTED' : 'SET CAPTAIN'}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className="font-mono font-bold text-ember">{m.bc_total}</span>
                        <span className="font-mono text-xs text-ghost ml-1">BC</span>
                      </td>
                      <td className="px-4 py-2 text-right hidden sm:table-cell">
                        <span className="font-mono text-xs text-ghost/60">
                          {new Date(m.joined_at).toLocaleDateString()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Transfer confirm button */}
            {isCaptain && transferTarget && (
              <div className="mb-4 flex items-center gap-3">
                <span className="font-mono text-xs text-ghost">
                  Transfer captaincy to {team.members.find(m => m.id === transferTarget)?.username}?
                </span>
                <button
                  onClick={handleTransfer}
                  className="font-mono text-xs text-ember border border-ember/50 hover:border-ember px-3 py-1.5 rounded-sm tracking-widest transition-all"
                >
                  [ CONFIRM ]
                </button>
                <button
                  onClick={() => setTransferTarget('')}
                  className="font-mono text-xs text-ghost border border-ghost/30 hover:border-ghost px-3 py-1.5 rounded-sm tracking-widest transition-all"
                >
                  [ ABORT ]
                </button>
              </div>
            )}

            {/* Leave team */}
            {isMine && isOperative && (
              <div className="mb-6 border border-danger/20 rounded-sm p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-ghost tracking-widest">
                    {isCaptain ? 'CAPTAIN — TRANSFER BEFORE LEAVING' : 'LEAVE TEAM'}
                  </span>
                  <button
                    onClick={handleLeave}
                    disabled={leaveLoading}
                    className="font-mono text-xs text-danger border border-danger/40 hover:border-danger hover:bg-danger/10 px-3 py-1.5 rounded-sm tracking-widest transition-all disabled:opacity-50"
                  >
                    [ GO SOLO ]
                  </button>
                </div>
                {leaveError && (
                  <p className="font-mono text-xs text-danger mt-2">⚠ {leaveError}</p>
                )}
              </div>
            )}

            {/* Recent claims */}
            {team.recent_claims.length > 0 && (
              <div className="border border-ghost/20 rounded-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-ghost/10 bg-abyss">
                  <span className="font-mono text-xs text-ghost tracking-widest">RECENT OPERATIONS</span>
                </div>
                <div className="divide-y divide-ghost/10">
                  {team.recent_claims.map((cl, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3 flex-wrap gap-2">
                      <div>
                        <span className="font-mono text-sm text-bone">{cl.contract_title}</span>
                        <span className="ml-2 font-mono text-[10px] text-ghost">{cl.contract_category}</span>
                        {cl.is_first_blood && (
                          <span className="ml-2 font-mono text-[10px] text-ember border border-ember/40 px-1 py-0.5 rounded-sm">FIRST BLOOD</span>
                        )}
                        <p className="font-mono text-xs text-ghost/60 mt-0.5">
                          by {cl.operative_username} · {new Date(cl.claimed_at).toLocaleString()}
                        </p>
                      </div>
                      <span className="font-mono font-bold text-ember">+{cl.bc_earned} BC</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Footer />
    </div>
  )
}
