import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useEventStatus } from '../../hooks/useEventStatus'
import { useMyRegistration } from '../../hooks/useMyRegistration'
import client from '../../api/client'
import Navbar from '../../components/ui/Navbar'
import CCBanner from '../../components/cc/CCBanner'
import Footer from '../../components/ui/Footer'
import Scanlines from '../../components/effects/Scanlines'
import Badge from '../../components/ui/Badge'
import GlitchText from '../../components/effects/GlitchText'
import RegistrationModal from '../../components/ui/RegistrationModal'
import { usePlatformFormat, synDisplayName } from '../../hooks/usePlatformFormat'

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

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function EventBanner({ active, upcoming, regStatus, onOpenModal }) {
  const countdown = useCountdown(active?.end_time || upcoming?.start_time)
  const [modalOpen, setModalOpen] = useState(false)

  function openModal() {
    setModalOpen(true)
    if (onOpenModal) onOpenModal()
  }

  // ── ACTIVE EVENT ──────────────────────────────────────────────────────────
  if (active) {
    const { registered, status: regSt } = regStatus

    // Removed state
    if (regSt === 'REMOVED') {
      return (
        <div className="mb-6 border border-danger/50 bg-danger/5 rounded-sm px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-danger text-sm">✗</span>
            <span className="font-mono text-xs text-danger tracking-widest font-bold">
              ACCESS REVOKED: {active.name}
            </span>
          </div>
          <p className="font-mono text-xs text-ghost">You have been removed from this event.</p>
          <p className="font-mono text-xs text-ghost mt-0.5">
            Contact admin via{' '}
            <Link to="/requests" className="text-ember hover:underline">[ REQUEST SYSTEM ]</Link>
          </p>
        </div>
      )
    }

    // Registered
    if (registered) {
      return (
        <div className="mb-6 border border-[#00FF88]/50 bg-[#00FF88]/5 rounded-sm px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#00FF88] text-sm">✓</span>
            <span className="font-mono text-xs text-[#00FF88] tracking-widest font-bold">
              REGISTERED: {active.name}
            </span>
          </div>
          <p className="font-mono text-xs text-ghost">Competition is live • You're competing</p>
          {active.end_time && countdown && (
            <p className="font-mono text-xs text-ghost mt-0.5">
              Ends in: <span className="text-[#00FF88]">{countdown}</span>
            </p>
          )}
        </div>
      )
    }

    // Not registered — registration open?
    if (active.registration_open) {
      return (
        <>
          <div className="mb-6 border border-ember/50 bg-ember/5 rounded-sm px-4 py-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs text-ember tracking-widest font-bold">
                    ACTIVE EVENT: {active.name}
                  </span>
                </div>
                <p className="font-mono text-xs text-ghost">
                  Competition is live — register to compete and access contracts.
                </p>
              </div>
              <button
                onClick={openModal}
                className="font-mono text-xs px-3 py-1.5 border border-ember/60 text-ember hover:bg-ember/10 transition-colors rounded-sm shrink-0"
              >
                [ ENTER PASS CODE ]
              </button>
            </div>
          </div>
          <RegistrationModal
            isOpen={modalOpen}
            onClose={() => setModalOpen(false)}
            event={active}
            onSuccess={() => window.location.reload()}
          />
        </>
      )
    }

    // Active but registration closed
    return (
      <div className="mb-6 border border-ghost/30 bg-ghost/5 rounded-sm px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-xs text-ghost tracking-widest font-bold">
            {active.name} — IN PROGRESS
          </span>
        </div>
        <p className="font-mono text-xs text-ghost">Registration is closed. Contact your administrator to join.</p>
      </div>
    )
  }

  // ── UPCOMING EVENT ────────────────────────────────────────────────────────
  if (!upcoming) return null

  const { registered, status: regSt } = regStatus
  const regOpen = upcoming.registration_open

  if (registered) {
    return (
      <div className="mb-6 border border-[#00FF88]/50 bg-[#00FF88]/5 rounded-sm px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[#00FF88] text-sm">✓</span>
          <span className="font-mono text-xs text-[#00FF88] tracking-widest font-bold">
            REGISTERED: {upcoming.name}
          </span>
        </div>
        <p className="font-mono text-xs text-ghost">
          {fmtDate(upcoming.start_time)} • You're in
        </p>
        {upcoming.start_time && countdown && (
          <p className="font-mono text-xs text-ghost mt-0.5">
            Starts in: <span className="text-[#00FF88]">{countdown}</span>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mb-6 border border-ember/50 bg-ember/5 rounded-sm px-4 py-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-ember tracking-widest font-bold">
              UPCOMING EVENT: {upcoming.name}
            </span>
          </div>
          <p className="font-mono text-xs text-ghost">
            {fmtDate(upcoming.start_time)}
            {regOpen ? ' • Registration Open' : ' • Registration Closed'}
          </p>
        </div>
        {regOpen && (
          <button
            className="font-mono text-xs px-3 py-1.5 border border-ember/60 text-ember hover:bg-ember/10 transition-colors rounded-sm shrink-0"
            onClick={() => alert('Registration opens when the event goes live.')}
          >
            [ REGISTER FOR EVENT ]
          </button>
        )}
      </div>
    </div>
  )
}

const RARITY_COLOR = {
  COMMON: 'text-common-glow',
  RARE: 'text-rare-glow',
  CLASSIFIED: 'text-classified-glow',
}

function StatCard({ label, value, sub, color = 'text-ember' }) {
  return (
    <div className="border border-ghost/20 bg-abyss rounded-sm px-5 py-4 flex-1 min-w-[120px]">
      <div className={`font-mono font-bold text-2xl ${color}`}>{value}</div>
      {sub && <div className={`font-mono text-xs ${color} opacity-70`}>{sub}</div>}
      <div className="font-mono text-[10px] text-ghost tracking-widest mt-1">{label}</div>
    </div>
  )
}


export default function OperativeDashboard() {
  const { user } = useAuth()
  const { active: activeEvent, upcoming: upcomingEvent } = useEventStatus()
  const currentEventId = activeEvent?.id || upcomingEvent?.id || null
  const regStatus = useMyRegistration(currentEventId)
  const { format, showSection } = usePlatformFormat()
  const [data, setData] = useState(null)
  const [dashError, setDashError] = useState(false)
  const [transmissions, setTransmissions] = useState([])
  const [txOpen, setTxOpen] = useState(true)

  function fetchDashboard() {
    setDashError(false)
    client.get('/operative/dashboard').then(r => setData(r.data)).catch(() => setDashError(true))
  }

  useEffect(() => { fetchDashboard() }, [])

  // Poll transmissions every 30 seconds so new broadcasts appear without refresh
  useEffect(() => {
    function fetchTx() {
      client.get('/transmissions/').then(r => setTransmissions(r.data.slice(0, 5))).catch(() => {})
    }
    fetchTx()
    const id = setInterval(fetchTx, 30000)
    return () => clearInterval(id)
  }, [])

  if (!data) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Scanlines />
        <Navbar />
        <div className="flex-1 flex items-center justify-center flex-col gap-4">
          {dashError ? (
            <>
              <span className="font-mono text-ghost tracking-widest">FAILED TO LOAD HOME BASE</span>
              <button
                onClick={fetchDashboard}
                className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-4 py-2 rounded-sm tracking-widest transition-all"
              >
                [ RETRY ]
              </button>
            </>
          ) : (
            <span className="font-mono text-ghost animate-pulse tracking-widest">LOADING HOME BASE...</span>
          )}
        </div>
        <Footer />
      </div>
    )
  }

  const { bc_total, rank, total_operatives, claim_count, clearance, recent_claims, team } = data

  return (
    <div className="relative min-h-screen bg-void text-bone flex flex-col">
      <Scanlines />
      <Navbar />
      <CCBanner />

      <div className="relative z-10 flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-ghost tracking-widest mb-1">HOME BASE</p>
            <GlitchText as="h1" className="font-mono font-bold text-3xl text-ember tracking-widest">
              {user?.username}
            </GlitchText>
            <div className="mt-2">
              <Badge label={clearance.level} type="clearance" />
            </div>
          </div>
          <Link
            to={`/operatives/${user?.id || ''}`}
            className="font-mono text-xs text-ghost border border-ghost/20 hover:border-ember hover:text-ember px-3 py-1.5 rounded-sm tracking-widest transition-all shrink-0 mt-1"
          >
            [ MY PROFILE ]
          </Link>
        </div>

            {/* Event registration banner */}
            <EventBanner active={activeEvent} upcoming={upcomingEvent} regStatus={regStatus} />

            {/* Stat cards — overview header already rendered above */}
            <div className="flex gap-3 flex-wrap mb-6">
              <StatCard label="GLOBAL RANK" value={`#${rank}`} sub={`of ${total_operatives}`} />
              <StatCard label="BC TOTAL" value={bc_total} sub="BOUNTY CREDITS" />
              <StatCard label="CONTRACTS" value={claim_count} sub="CLAIMED" color="text-bone" />
            </div>

            {/* Clearance progress bar */}
            <div className="border border-ghost/20 bg-abyss rounded-sm px-5 py-4 mb-6">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-ghost tracking-widest">CLEARANCE PROGRESS</span>
                  <Badge label={clearance.level} type="clearance" />
                </div>
                {clearance.next_level ? (
                  <span className="font-mono text-xs text-ghost">
                    {clearance.bc_to_next} BC to <span className="text-bone">{clearance.next_level}</span>
                  </span>
                ) : (
                  <span className="font-mono text-xs text-ember tracking-widest">MAX LEVEL</span>
                )}
              </div>
              <div className="w-full bg-void rounded-sm h-2 overflow-hidden border border-ghost/20">
                <div
                  className="h-full bg-ember transition-all duration-700 rounded-sm"
                  style={{ width: `${clearance.progress_pct}%` }}
                />
              </div>
              <div className="font-mono text-[10px] text-ghost mt-1">{clearance.progress_pct}% complete</div>
            </div>

            {/* Two-column: team + recent activity */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Team widget */}
              <div className="border border-ghost/20 bg-abyss rounded-sm p-5">
                <p className="font-mono text-xs text-ghost tracking-widest mb-4">TEAM</p>
                {team ? (
                  <>
                    <div className="mb-3">
                      <Link
                        to={`/teams/${team.id}`}
                        className="font-mono font-bold text-lg text-ember hover:text-flare transition-colors"
                      >
                        {synDisplayName(team.name, team.captain_school, team.captain_section, format, showSection)}
                      </Link>
                      {team.is_captain && (
                        <span className="ml-2 font-mono text-[10px] text-ember border border-ember/40 px-1 py-0.5 rounded-sm">CAPTAIN</span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {[
                        { label: 'RANK', val: `#${team.rank}` },
                        { label: 'MEMBERS', val: team.member_count },
                        { label: 'CREW BC', val: team.total_bc },
                      ].map(s => (
                        <div key={s.label} className="text-center border border-ghost/10 rounded-sm py-2">
                          <div className="font-mono font-bold text-base text-ember">{s.val}</div>
                          <div className="font-mono text-[10px] text-ghost tracking-widest">{s.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="border border-ghost/10 rounded-sm px-3 py-2">
                      <span className="font-mono text-[10px] text-ghost tracking-widest">INVITE CODE </span>
                      <span className="font-mono text-sm text-bone font-bold tracking-widest">{team.invite_code}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="font-mono text-xs text-ghost mb-4 tracking-widest">NOT IN A TEAM</p>
                    <Link
                      to="/teams"
                      className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-3 py-1.5 rounded-sm tracking-widest transition-all"
                    >
                      [ FIND A CREW ]
                    </Link>
                  </div>
                )}
              </div>

              {/* Recent activity */}
              <div className="border border-ghost/20 rounded-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-ghost/10 bg-abyss flex items-center justify-between">
                  <span className="font-mono text-xs text-ghost tracking-widest">RECENT OPERATIONS</span>
                  <Link to="/contracts" className="font-mono text-[10px] text-ember hover:text-flare tracking-widest">
                    VIEW ALL →
                  </Link>
                </div>
                {recent_claims.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="font-mono text-xs text-ghost tracking-widest">NO CONTRACTS CLAIMED YET</p>
                    <Link
                      to="/contracts"
                      className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-3 py-1.5 rounded-sm tracking-widest transition-all inline-block mt-3"
                    >
                      [ BROWSE CONTRACTS ]
                    </Link>
                  </div>
                ) : (
                  <div className="divide-y divide-ghost/10">
                    {recent_claims.map((cl, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-bone">{cl.contract_title}</span>
                            {cl.is_first_blood && (
                              <span className="font-mono text-[10px] text-ember border border-ember/40 px-1 py-0.5 rounded-sm">1ST</span>
                            )}
                          </div>
                          <p className={`font-mono text-[10px] mt-0.5 ${RARITY_COLOR[cl.contract_rarity] || 'text-ghost'}`}>
                            {cl.contract_rarity} · {cl.contract_category} · {new Date(cl.claimed_at).toLocaleString()}
                          </p>
                        </div>
                        <span className="font-mono font-bold text-success text-sm">+{cl.bc_earned} BC</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Network Transmissions */}
            {transmissions.length > 0 && (
              <div className="mt-6 border border-ember/20 bg-abyss rounded-sm overflow-hidden">
                <button
                  onClick={() => setTxOpen(o => !o)}
                  className="w-full px-4 py-3 bg-ember/5 flex items-center justify-between hover:bg-ember/10 transition-colors"
                >
                  <span className="font-mono text-xs text-ember tracking-widest font-bold">NETWORK TRANSMISSIONS</span>
                  <span className="font-mono text-xs text-ember">{txOpen ? '[ − ]' : '[ + ]'}</span>
                </button>
                {txOpen && (
                  <div className="divide-y divide-ghost/10">
                    {transmissions.map(tx => (
                      <div key={tx.id} className="px-4 py-3">
                        <p className="font-mono text-sm text-bone">{tx.content}</p>
                        <p className="font-mono text-[10px] text-ghost mt-1">
                          {tx.author_username} · {new Date(tx.created_at).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

      </div>

      <Footer />
    </div>
  )
}
