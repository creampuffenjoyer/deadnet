import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { usePlatformFormat } from '../../hooks/usePlatformFormat'
import { usePlatformTerms } from '../../hooks/usePlatformTerms'
import Badge from './Badge'
import { ROLE_HOME } from '../../router/RoleRoute'
import client from '../../api/client'

const ROLE_LABEL = {
  ADMIN:      "CONSOLE",
  CONTRACTOR: 'CONTRACT HANDLER',
  HANDLER: 'ADVISOR CONSOLE',
  OPERATIVE:  'HOME BASE',
}

const ROLE_PATH = {
  ADMIN:      '/admin/dashboard',
  CONTRACTOR: '/contractor/dashboard',
  HANDLER: '/handler/dashboard',
  OPERATIVE:  '/operative/dashboard',
}

function NavLink({ to, children }) {
  const { pathname } = useLocation()
  const active = pathname === to || pathname.startsWith(to + '/')
  return (
    <Link
      to={to}
      className={`font-mono text-xs tracking-widest uppercase transition-colors ${
        active ? 'text-ember' : 'text-ghost hover:text-bone'
      }`}
    >
      {children}
    </Link>
  )
}

function NotificationBell() {
  const [notifs,   setNotifs]   = useState([])
  const [open,     setOpen]     = useState(false)
  const [clearing, setClearing] = useState(false)
  const ref = useRef(null)

  const unread = notifs.filter(n => !n.read).length

  async function poll() {
    try {
      const r = await client.get('/notifications/mine')
      setNotifs(r.data)
    } catch { /* ignore */ }
  }

  async function clearAll(e) {
    e.stopPropagation()
    setClearing(true)
    try {
      await client.delete('/notifications/mine')
      setNotifs([])
    } catch { /* ignore */ }
    setClearing(false)
  }

  useEffect(() => {
    poll()
    const id = setInterval(poll, 30000)
    return () => clearInterval(id)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function handleOpen() {
    setOpen(v => !v)
    if (!open && unread > 0) {
      try {
        await client.post('/notifications/read-all')
        setNotifs(n => n.map(x => ({ ...x, read: true })))
      } catch { /* ignore */ }
    }
  }

  function timeAgo(iso) {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative font-mono text-xs text-ghost hover:text-bone border border-ghost/30 hover:border-ghost/60 px-2.5 py-1.5 rounded-sm transition-all"
        title="Notifications"
      >
        [ ! ]
        {unread > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full font-mono text-[9px] font-bold"
            style={{ background: '#FF4500', color: '#000' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 border border-ghost/30 rounded-sm shadow-lg z-50 overflow-hidden"
          style={{ background: '#12121A' }}
        >
          <div className="px-3 py-2 border-b border-ghost/10 flex items-center justify-between">
            <span className="font-mono text-[10px] text-ghost tracking-widest">INCOMING SIGNALS</span>
            {notifs.length > 0 && (
              <button
                onClick={clearAll}
                disabled={clearing}
                className="font-mono text-[9px] text-danger/60 hover:text-danger border border-danger/20 hover:border-danger/50 px-1.5 py-0.5 rounded-sm tracking-widest transition-colors disabled:opacity-40"
              >
                {clearing ? '...' : '[ CLEAR ALL ]'}
              </button>
            )}
          </div>
          {notifs.length === 0 ? (
            <div className="px-3 py-5 text-center">
              <p className="font-mono text-[10px] text-ghost tracking-widest">NO SIGNALS</p>
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-ghost/10">
              {notifs.map(n => (
                <div
                  key={n.id}
                  className="px-3 py-2.5"
                  style={{ background: n.read ? 'transparent' : 'rgba(255,69,0,0.05)' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {!n.read && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-ember shrink-0" />
                    )}
                    {n.kind === 'TX' && (
                      <span className="font-mono text-[9px] px-1.5 py-0.5 tracking-widest border border-ember/40 text-ember">
                        SIGNAL
                      </span>
                    )}
                    {n.from_callsign && (
                      <span className="font-mono text-[10px] text-ghost tracking-widest">
                        {n.kind === 'TX' ? '▶' : 'FROM:'} {n.from_callsign}
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-bone leading-relaxed">{n.message}</p>
                  <p className="font-mono text-[10px] text-ghost/40 mt-1">{timeAgo(n.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function useActiveEvent(isAuthenticated) {
  const [state, setState] = useState({ isLive: false, eventName: null })
  useEffect(() => {
    if (!isAuthenticated) return
    const check = () => {
      client.get('/events/active')
        .then(r => setState({
          isLive: r.data?.active != null,
          eventName: r.data?.active?.name ?? null,
        }))
        .catch(() => {})
    }
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [isAuthenticated])
  return state
}

export default function Navbar() {
  const { user, logout } = useAuth()
  const { competition_end } = usePlatformFormat()
  const terms = usePlatformTerms()
  const ROLE_DISPLAY = {
    OPERATIVE:  terms.operator.toUpperCase(),
    HANDLER:    terms.handler.toUpperCase(),
    CONTRACTOR: terms.contractor.toUpperCase(),
    ADMIN:      'ADMIN',
  }
  const navigate = useNavigate()
  const { isLive: isEventLive, eventName: activeEventName } = useActiveEvent(!!user)

  const isCompetitionOver = competition_end && Date.now() > new Date(competition_end).getTime()

  const handleLogout = async () => {
    await logout()
    navigate('/')
  }

  return (
    <nav className="w-full bg-abyss border-b border-ghost/20 px-6 py-3 flex items-center justify-between z-40 relative">
      {/* Logo */}
      <Link
        to={user ? ROLE_HOME[user.role] || '/' : '/'}
        className="flex-shrink-0 flex flex-col leading-none"
      >
        <span className="font-mono font-bold text-xl text-ember tracking-widest neon-ember-text hover:text-flare transition-colors">
          DEADNET
        </span>
        {activeEventName && (
          <span className="font-mono text-[9px] text-ghost tracking-widest uppercase mt-0.5">
            {activeEventName}
          </span>
        )}
      </Link>

      {/* Center nav links — authenticated */}
      {user && (
        <div className="hidden md:flex items-center gap-5 flex-wrap">
          <NavLink to="/contracts">[ CONTRACTS ]</NavLink>
          <NavLink to="/bounty-board">[ BOUNTY BOARD ]</NavLink>
          <NavLink to="/intel">[ INTEL BROKER ]</NavLink>
          <NavLink to="/teams">[ TEAMS ]</NavLink>
          {user.role !== 'OPERATIVE' && (
            <NavLink to="/stats">[ STATS ]</NavLink>
          )}
          {user.role === 'ADMIN' && (
            <span className="flex items-center gap-1.5">
              <NavLink to="/events">[ EVENTS ]</NavLink>
              {isEventLive && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#00FF88] animate-pulse inline-block" />
              )}
            </span>
          )}
          {user.role === 'OPERATIVE' && (
            <NavLink to="/settings">[ OPERATOR SETTINGS ]</NavLink>
          )}
          {ROLE_PATH[user.role] && (
            <NavLink to={ROLE_PATH[user.role]}>[ {ROLE_LABEL[user.role]} ]</NavLink>
          )}
          {isCompetitionOver && (
            <span className="font-mono text-[10px] text-danger border border-danger/40 bg-danger/10 px-2 py-0.5 rounded-sm tracking-widest animate-pulse">
              COMPETITION CLOSED
            </span>
          )}
        </div>
      )}

      {/* Right side */}
      <div className="flex items-center gap-3">
        {user ? (
          <>
            <div className="hidden sm:flex items-center gap-2">
              <span className="font-mono text-xs text-ghost">{user.username}</span>
              <Badge label={user.role} type="role" displayLabel={ROLE_DISPLAY[user.role] || user.role} />
            </div>
            <NotificationBell />
            <button
              onClick={handleLogout}
              className="font-mono text-xs tracking-widest uppercase transition-all"
              style={{
                color: '#FF2D2D',
                border: '1px solid #FF2D2D',
                background: 'transparent',
                padding: '6px 12px',
                textShadow: '0 0 8px #FF2D2D, 0 0 16px #FF2D2D',
              }}
              onMouseEnter={e => { e.currentTarget.style.textShadow = '0 0 12px #FF2D2D, 0 0 24px #FF2D2D, 0 0 40px #FF2D2D' }}
              onMouseLeave={e => { e.currentTarget.style.textShadow = '0 0 8px #FF2D2D, 0 0 16px #FF2D2D' }}
            >
              LOGOUT
            </button>
          </>
        ) : (
          <>
            <Link
              to="/login"
              className="font-mono text-xs text-ghost hover:text-ember tracking-widest uppercase transition-colors"
            >
              [ ACCESS DEADNET ]
            </Link>
            <Link
              to="/register"
              className="font-mono text-xs text-bone border border-ember/50 hover:border-ember px-3 py-1.5 rounded-sm tracking-widest uppercase transition-all neon-ember-hover"
            >
              [ ENLIST ]
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}
