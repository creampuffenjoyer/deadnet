import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { motion, AnimatePresence } from 'framer-motion'
import client from '../../api/client'
import { clearPlatformCache } from '../../hooks/usePlatformFormat'
import { usePlatformTerms } from '../../hooks/usePlatformTerms'
import Navbar from '../../components/ui/Navbar'
import Footer from '../../components/ui/Footer'
import Scanlines from '../../components/effects/Scanlines'

const ROLES = ['OPERATIVE', 'HANDLER', 'CONTRACTOR', 'ADMIN']
const ROLE_COLOR = { ADMIN: '#FF2D2D', CONTRACTOR: '#FF6B00', HANDLER: '#4A6FA5', OPERATIVE: '#6B6B85' }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`font-mono text-xs tracking-widest px-5 py-2 border-b-2 transition-colors whitespace-nowrap ${
        active ? 'border-ember text-ember' : 'border-transparent text-ghost hover:text-bone'
      }`}
    >
      {children}
    </button>
  )
}

function SectionHeader({ children }) {
  return (
    <div className="px-4 py-2 border-b border-ghost/10 bg-abyss">
      <span className="font-mono text-xs text-ghost tracking-widest">{children}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const trunc = (s, n = 20) => s && s.length > n ? s.slice(0, n) + '…' : (s || '—')
const timeAgo = (iso) => { if (!iso) return '—'; const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago` }
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Never'

function StatusBadge({ banned, verified = true }) {
  const s = { fontSize: '10px', padding: '3px 8px', letterSpacing: '0.08em', fontFamily: 'inherit', display: 'inline-block', whiteSpace: 'nowrap' }
  if (banned)    return <span style={{ ...s, border: '1px solid #FF2D2D', color: '#FF2D2D' }}>BANNED</span>
  if (!verified) return <span style={{ ...s, border: '1px solid #FF6B00', color: '#FF6B00' }}>UNVERIFIED</span>
  return           <span style={{ ...s, border: '1px solid #00FF88', color: '#00FF88' }}>ACTIVE</span>
}

// ---------------------------------------------------------------------------
// UserDetailPanel — slide-out from right
// ---------------------------------------------------------------------------
function UserDetailPanel({ userId, onClose, onUpdate }) {
  const terms = usePlatformTerms()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionMsg, setActionMsg] = useState('')
  const [actionLoading, setActionLoading] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [roleChanging, setRoleChanging] = useState(false)
  const [roleChangeTarget, setRoleChangeTarget] = useState(null) // role string being confirmed
  const [roleChangeError, setRoleChangeError] = useState('')

  function reload() {
    if (!userId) return
    setLoading(true)
    client.get(`/admin/users/${userId}/detail`)
      .then(r => setDetail(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [userId]) // eslint-disable-line

  async function sendReminder() {
    setActionLoading('reminder')
    try {
      await client.post(`/admin/users/${userId}/send-reminder`)
      setActionMsg('Reminder sent via Network Transmission.')
    } catch (e) {
      setActionMsg(e.response?.data?.detail || 'Send failed.')
    } finally {
      setActionLoading('')
      setTimeout(() => setActionMsg(''), 3000)
    }
  }

  async function verifyUser() {
    setActionLoading('verify')
    try {
      await client.post(`/admin/users/${userId}/verify`)
      setActionMsg('Account verified.')
      reload()
      onUpdate?.()
    } catch (e) {
      setActionMsg(e.response?.data?.detail || 'Verification failed.')
    } finally {
      setActionLoading('')
      setTimeout(() => setActionMsg(''), 3000)
    }
  }

  async function forceLogout() {
    setActionLoading('logout')
    try {
      await client.post(`/admin/users/${userId}/force-logout`)
      setActionMsg('All sessions invalidated.')
    } catch (e) {
      setActionMsg(e.response?.data?.detail || 'Force logout failed.')
    } finally {
      setActionLoading('')
      setTimeout(() => setActionMsg(''), 3000)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await client.delete(`/admin/users/${userId}`)
      onClose()
      onUpdate?.()
    } catch (e) {
      setActionMsg(e.response?.data?.detail || 'Delete failed.')
      setConfirmDel(false)
    } finally {
      setDeleting(false)
    }
  }

  async function handleRoleChange(newRole) {
    setRoleChanging(true)
    setRoleChangeError('')
    try {
      await client.patch(`/admin/users/${userId}`, { role: newRole })
      setRoleChangeTarget(null)
      reload()
      onUpdate?.()
    } catch (e) {
      const d = e.response?.data?.detail || ''
      setRoleChangeError(d === 'LAST_ADMIN' ? 'Cannot demote the last admin.' : d || 'Role change failed.')
    } finally {
      setRoleChanging(false)
    }
  }

  function DRow({ label, value }) {
    return (
      <div className="flex justify-between gap-2">
        <span className="font-mono text-xs text-ghost/60 shrink-0">{label}</span>
        <span className="font-mono text-xs text-bone text-right">{value || '—'}</span>
      </div>
    )
  }

  return (
    <AnimatePresence>
      {userId && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-void/60"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed top-0 right-0 h-full w-[440px] max-w-full bg-abyss border-l border-ghost/20 z-50 overflow-y-auto"
            style={{ borderTop: '3px solid #FF4500' }}
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-ghost/10">
              <span className="font-mono text-xs text-ghost tracking-widest">OPERATOR DOSSIER</span>
              <button onClick={onClose} className="font-mono text-ghost hover:text-ember text-lg leading-none">×</button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-40">
                <span className="font-mono text-xs text-ghost animate-pulse">PULLING RECORD...</span>
              </div>
            ) : !detail ? (
              <div className="px-6 py-8 font-mono text-xs text-ghost">Record not found.</div>
            ) : (
              <div className="px-6 py-5 space-y-5">

                {/* IDENTITY */}
                <div>
                  <p className="font-mono text-[10px] text-ember tracking-widest mb-3">IDENTITY</p>
                  <div className="space-y-2">
                    <div className="flex justify-between gap-2">
                      <span className="font-mono text-xs text-ghost/60 shrink-0">CALLSIGN</span>
                      <span className="flex items-center gap-1.5 font-mono text-sm text-bone font-bold">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${detail.is_online ? 'bg-success' : 'bg-ghost/30'}`} title={detail.is_online ? 'Online' : 'Offline'} />
                        {detail.username}
                      </span>
                    </div>
                    <DRow label={`${terms.operator.toUpperCase()} NAME`} value={detail.full_name} />
                    <div className="flex justify-between gap-2">
                      <span className="font-mono text-xs text-ghost/60 shrink-0">EMAIL</span>
                      <span className="font-mono text-xs text-bone text-right break-all">{detail.email}</span>
                    </div>
                    <DRow label="OPERATOR ID" value={detail.student_id} />
                    <DRow label="ASSIGNED UNIT" value={detail.section} />
                    <DRow label="DEPLOYMENT CYCLE" value={detail.year_level} />
                    <DRow label="REGISTERED" value={fmtDate(detail.created_at)} />
                    <DRow label="LAST LOGIN" value={fmtDateTime(detail.last_login)} />
                    <div className="flex justify-between gap-2">
                      <span className="font-mono text-xs text-ghost/60 shrink-0">DOSSIER</span>
                      {detail.onboarding_complete
                        ? <span className="font-mono text-[10px] px-2 py-0.5 border border-success/40 text-success tracking-widest">COMPLETE</span>
                        : <span className="font-mono text-[10px] px-2 py-0.5 border border-flare/40 text-flare tracking-widest">INCOMPLETE</span>
                      }
                    </div>
                  </div>
                </div>

                {/* PERFORMANCE */}
                <div className="border-t border-ghost/10 pt-4">
                  <p className="font-mono text-[10px] text-ember tracking-widest mb-3">PERFORMANCE</p>
                  <div className="space-y-2">
                    {detail.clearance_level && (
                      <DRow label="CLEARANCE" value={detail.clearance_level} />
                    )}
                    <DRow label="BC EARNED" value={`${detail.bc_earned} BC`} />
                    <DRow label="CONTRACTS CLAIMED" value={detail.claim_count} />
                    <DRow label="INTEL DROPS PURCHASED" value={detail.intel_purchase_count} />
                    {detail.team ? (
                      <div className="flex justify-between gap-2">
                        <span className="font-mono text-xs text-ghost/60 shrink-0">TEAM</span>
                        <Link to={`/teams/${detail.team.id}`} className="font-mono text-xs text-ember hover:text-flare">
                          {trunc(detail.team.name)}
                        </Link>
                      </div>
                    ) : (
                      <DRow label="TEAM" value="None" />
                    )}
                  </div>
                </div>

                {/* ACCOUNT */}
                <div className="border-t border-ghost/10 pt-4">
                  <p className="font-mono text-[10px] text-ember tracking-widest mb-3">ACCOUNT</p>
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between gap-2">
                      <span className="font-mono text-xs text-ghost/60 shrink-0">STATUS</span>
                      <StatusBadge banned={detail.is_banned} />
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="font-mono text-xs text-ghost/60 shrink-0">VERIFIED</span>
                      {detail.is_verified
                        ? <span className="font-mono text-[10px] px-2 py-0.5 border border-success/40 text-success tracking-widest">VERIFIED</span>
                        : <span className="font-mono text-[10px] px-2 py-0.5 border border-flare/40 text-flare tracking-widest">UNVERIFIED</span>
                      }
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="font-mono text-xs text-ghost/60 shrink-0">ROLE</span>
                      <span className="font-mono text-xs tracking-widest" style={{ color: ROLE_COLOR[detail.role] }}>{detail.role}</span>
                    </div>
                  </div>

                  {/* Role change — only for non-admin targets */}
                  {detail.role !== 'ADMIN' && (
                    <div className="mt-3 mb-1">
                      {roleChangeTarget ? (
                        <div className="border border-flare/30 bg-flare/5 rounded-sm p-3 space-y-2">
                          <p className="font-mono text-xs text-ghost">
                            Change role of <span className="text-bone">{detail.username}</span> to{' '}
                            <span style={{ color: ROLE_COLOR[roleChangeTarget] }} className="tracking-widest">{roleChangeTarget}</span>?
                          </p>
                          {roleChangeError && <p className="font-mono text-[10px] text-danger">{roleChangeError}</p>}
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRoleChange(roleChangeTarget)}
                              disabled={roleChanging}
                              className="flex-1 font-mono text-xs text-void bg-ember hover:bg-flare disabled:opacity-50 px-3 py-1.5 rounded-sm tracking-widest transition-all"
                            >
                              {roleChanging ? 'CHANGING...' : 'CONFIRM'}
                            </button>
                            <button
                              onClick={() => { setRoleChangeTarget(null); setRoleChangeError('') }}
                              className="flex-1 font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-3 py-1.5 rounded-sm tracking-widest transition-all"
                            >
                              ABORT
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className="font-mono text-[10px] text-ghost/60 tracking-widest mb-2">CHANGE ROLE</p>
                          <div className="flex gap-1.5 flex-wrap">
                            {['OPERATIVE', 'HANDLER', 'CONTRACTOR'].filter(r => r !== detail.role).map(r => (
                              <button
                                key={r}
                                onClick={() => { setRoleChangeTarget(r); setRoleChangeError('') }}
                                className="font-mono text-[10px] px-2.5 py-1 border rounded-sm tracking-widest transition-all hover:text-bone"
                                style={{ borderColor: ROLE_COLOR[r] + '60', color: ROLE_COLOR[r] + 'CC' }}
                              >
                                → {r}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    {!detail.is_verified && (
                      <>
                        <button
                          onClick={verifyUser}
                          disabled={!!actionLoading}
                          className="w-full font-mono text-xs text-success border border-success/30 hover:border-success px-3 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
                        >
                          {actionLoading === 'verify' ? 'VERIFYING...' : '[ VERIFY MANUALLY ]'}
                        </button>
                        <button
                          onClick={sendReminder}
                          disabled={actionLoading === 'reminder'}
                          className="w-full font-mono text-xs text-flare border border-flare/30 hover:border-flare px-3 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
                        >
                          {actionLoading === 'reminder' ? 'SENDING...' : '[ SEND VERIFICATION REMINDER ]'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={forceLogout}
                      disabled={!!actionLoading}
                      className="w-full font-mono text-xs text-ghost border border-ghost/30 hover:border-ember hover:text-ember px-3 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
                    >
                      {actionLoading === 'logout' ? 'INVALIDATING...' : '[ FORCE LOGOUT ]'}
                    </button>
                    {actionMsg && (
                      <p className="font-mono text-[10px] text-ghost text-center">{actionMsg}</p>
                    )}
                  </div>
                </div>

                {/* DANGER — delete (non-admin only) */}
                {detail.role !== 'ADMIN' && (
                  <div className="border-t border-danger/20 pt-4">
                    <p className="font-mono text-[10px] text-danger/60 tracking-widest mb-3">DANGER ZONE</p>
                    {!confirmDel ? (
                      <button
                        onClick={() => setConfirmDel(true)}
                        className="w-full font-mono text-xs text-danger/60 border border-danger/20 hover:border-danger hover:text-danger px-3 py-2 rounded-sm tracking-widest transition-all"
                      >
                        [ FORCE DELETE OPERATOR ]
                      </button>
                    ) : (
                      <div className="border border-danger/30 rounded-sm p-3 space-y-2" style={{ background: 'rgba(255,45,45,0.05)' }}>
                        <p className="font-mono text-xs text-danger tracking-widest">CONFIRM PERMANENT DELETE</p>
                        <p className="font-mono text-[10px] text-ghost/60">
                          This will permanently delete <span className="text-bone">{detail.username}</span> and all their activity. This cannot be undone.
                        </p>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={handleDelete}
                            disabled={deleting}
                            className="flex-1 font-mono text-xs text-void bg-danger hover:opacity-80 disabled:opacity-50 px-3 py-1.5 rounded-sm tracking-widest transition-all"
                          >
                            {deleting ? 'DELETING...' : 'CONFIRM DELETE'}
                          </button>
                          <button
                            onClick={() => setConfirmDel(false)}
                            className="flex-1 font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-3 py-1.5 rounded-sm tracking-widest transition-all"
                          >
                            ABORT
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ---------------------------------------------------------------------------
// VERIFICATION QUEUE — unverified operatives panel (OPERATIVE tab only)
// ---------------------------------------------------------------------------
function VerificationQueue({ users, onRefresh }) {
  const unverified = users.filter(u => u.role === 'OPERATIVE' && !u.is_verified)
  const [verifyAllConfirm, setVerifyAllConfirm] = useState(false)
  const [verifyingAll, setVerifyingAll] = useState(false)
  const [verifyingId, setVerifyingId] = useState(null)
  const [resendingId, setResendingId] = useState(null)
  const [error, setError] = useState('')

  if (unverified.length === 0) return null

  async function verifySingle(userId) {
    setVerifyingId(userId)
    try {
      await client.post(`/admin/users/${userId}/verify`)
      onRefresh()
    } catch {
      setError('Verification failed.')
      setTimeout(() => setError(''), 3000)
    } finally {
      setVerifyingId(null)
    }
  }

  async function resendEmail(userId) {
    setResendingId(userId)
    try {
      // Resend by hitting the resend-verification endpoint with the user's email
      // We need the user object for their email — find it
      const u = unverified.find(x => x.id === userId)
      if (u?.email) await client.post('/auth/resend-verification', { email: u.email })
    } catch {
      // Silently ignore — email errors are logged server-side
    } finally {
      setResendingId(null)
    }
  }

  async function verifyAll() {
    setVerifyAllConfirm(false)
    setVerifyingAll(true)
    try {
      await client.post('/admin/users/bulk-verify', { user_ids: unverified.map(u => u.id) })
      onRefresh()
    } catch {
      setError('Bulk verify failed.')
      setTimeout(() => setError(''), 3000)
    } finally {
      setVerifyingAll(false)
    }
  }

  return (
    <>
      {/* Verify all confirm modal */}
      {verifyAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/90">
          <div className="border border-ember/30 bg-abyss rounded-sm p-6 max-w-sm w-full mx-4">
            <p className="font-mono text-xs text-ghost tracking-widest mb-3">VERIFY ALL PENDING</p>
            <p className="font-mono text-sm text-bone mb-2">
              Verify all <span style={{ color: '#FF6B00' }}>{unverified.length}</span> pending accounts?
            </p>
            <p className="font-mono text-[10px] text-ghost/50 mb-5 leading-relaxed">
              This bypasses email verification and grants immediate platform access.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setVerifyAllConfirm(false)}
                className="flex-1 font-mono text-xs text-ghost border border-ghost/30 hover:border-ghost px-3 py-2 rounded-sm tracking-widest transition-all"
              >[ ABORT ]</button>
              <button
                onClick={verifyAll}
                className="flex-1 font-mono text-xs text-void bg-ember hover:bg-flare px-3 py-2 rounded-sm tracking-widest font-bold transition-all"
              >[ CONFIRM ]</button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 border border-flare/20" style={{ background: '#0E0E18' }}>
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-flare/10">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-ghost tracking-widest">VERIFICATION QUEUE</span>
            <span className="font-mono text-[10px] tracking-widest" style={{ color: '#FF6B00' }}>
              — {unverified.length} PENDING
            </span>
          </div>
          <button
            onClick={() => setVerifyAllConfirm(true)}
            disabled={verifyingAll}
            className="font-mono text-[10px] text-void bg-ember hover:bg-flare px-3 py-1.5 tracking-widest transition-all disabled:opacity-50"
          >
            {verifyingAll ? 'VERIFYING...' : '[ VERIFY ALL PENDING ]'}
          </button>
        </div>

        {error && (
          <div className="px-4 py-1.5 font-mono text-[10px] text-danger border-b border-danger/20">
            {error}
          </div>
        )}

        {/* Compact queue table */}
        <table style={{ tableLayout: 'fixed', width: '100%', borderCollapse: 'collapse' }}>
          <colgroup>
            <col />
            <col style={{ width: '200px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '170px' }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: '1px solid #2A2A42' }}>
              <th className="font-mono text-left" style={{ fontSize: '9px', color: '#4A4A6A', letterSpacing: '0.15em', fontWeight: 'normal', padding: '6px 12px' }}>CALLSIGN</th>
              <th className="font-mono text-left" style={{ fontSize: '9px', color: '#4A4A6A', letterSpacing: '0.15em', fontWeight: 'normal', padding: '6px 8px' }}>EMAIL</th>
              <th className="font-mono text-left" style={{ fontSize: '9px', color: '#4A4A6A', letterSpacing: '0.15em', fontWeight: 'normal', padding: '6px 8px' }}>REGISTERED</th>
              <th className="font-mono text-right" style={{ fontSize: '9px', color: '#4A4A6A', letterSpacing: '0.15em', fontWeight: 'normal', padding: '6px 12px' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {unverified.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid #16162A' }}
                onMouseEnter={e => e.currentTarget.style.background = '#13131F'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                <td style={{ padding: '8px 12px', overflow: 'hidden' }}>
                  <span className="font-mono text-xs text-bone" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{u.username}</span>
                </td>
                <td style={{ padding: '8px 8px', overflow: 'hidden' }}>
                  <span className="font-mono" style={{ fontSize: '10px', color: '#6B6B85', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{u.email || '—'}</span>
                </td>
                <td style={{ padding: '8px 8px' }}>
                  <span className="font-mono" style={{ fontSize: '10px', color: '#6B6B85' }}>{fmtDate(u.created_at)}</span>
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                    <button
                      onClick={() => verifySingle(u.id)}
                      disabled={verifyingId === u.id}
                      className="font-mono transition-all disabled:opacity-40"
                      style={{ fontSize: '9px', padding: '3px 8px', border: '1px solid #00FF88', color: '#00FF88', background: 'transparent' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#00FF88'; e.currentTarget.style.color = '#000' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#00FF88' }}
                    >{verifyingId === u.id ? '...' : 'VERIFY'}</button>
                    <button
                      onClick={() => resendEmail(u.id)}
                      disabled={resendingId === u.id}
                      className="font-mono transition-all disabled:opacity-40"
                      style={{ fontSize: '9px', padding: '3px 8px', border: '1px solid #3A3A52', color: '#6B6B85', background: 'transparent' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#6B6B85'; e.currentTarget.style.color = '#E8E8F0' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#3A3A52'; e.currentTarget.style.color = '#6B6B85' }}
                    >{resendingId === u.id ? '...' : 'RESEND'}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}


// ---------------------------------------------------------------------------
// OPERATORS TAB — user management
// ---------------------------------------------------------------------------
function OperatorsTab() {
  const terms = usePlatformTerms()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [roleTab, setRoleTab] = useState('ALL')
  const [detailUserId, setDetailUserId] = useState(null)
  const [pwdResult, setPwdResult] = useState(null)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  async function load() {
    try {
      const res = await client.get('/admin/users')
      setUsers(res.data)
    } catch {
      setError('Failed to load users.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleBan(userId, isBanned) {
    try {
      await client.patch(`/admin/users/${userId}`, { is_banned: !isBanned })
      await load()
    } catch (e) {
      const d = e.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Ban toggle failed.')
    }
  }

  async function generatePassword(u) {
    setPwdLoading(true)
    try {
      const res = await client.post(`/admin/users/${u.id}/reset-password`)
      setPwdResult({ username: res.data.username, temp_password: res.data.temp_password })
    } catch (e) {
      const d = e.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Reset failed.')
    } finally {
      setPwdLoading(false)
    }
  }

  function copyPwd() {
    navigator.clipboard.writeText(pwdResult.temp_password)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const pendingApprovalUsers = users.filter(u => u.account_status === 'PENDING_APPROVAL')
  const pendingCount = pendingApprovalUsers.length

  const byRole = roleTab === 'PENDING'
    ? pendingApprovalUsers
    : users.filter(u => {
        if (roleTab !== 'ALL' && u.role !== roleTab) return false
        // In non-PENDING tabs hide PENDING_APPROVAL accounts
        if (u.account_status === 'PENDING_APPROVAL') return false
        return true
      })

  const ROLE_ORDER = { ADMIN: 0, CONTRACTOR: 1, HANDLER: 2, OPERATIVE: 3 }

  const filtered = byRole
    .filter(u => u.username.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (roleTab !== 'ALL') return 0
      return (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
    })

  return (
    <>
      {/* Detail panel */}
      <UserDetailPanel userId={detailUserId} onClose={() => setDetailUserId(null)} onUpdate={load} />

      {/* PWD result modal */}
      {pwdResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/90">
          <div className="border border-ember/30 bg-abyss rounded-sm p-6 max-w-sm w-full mx-4">
            <p className="font-mono text-xs text-ghost tracking-widest mb-1">TEMP PASSWORD GENERATED</p>
            <p className="font-mono text-sm text-bone font-bold mb-4">{pwdResult.username}</p>
            <p className="font-mono text-[10px] text-ghost/60 mb-3">
              Share via secure channel. User must change it immediately.
            </p>
            <div className="flex items-center gap-2 bg-void border border-ember/20 rounded-sm px-4 py-3 mb-4">
              <code className="flex-1 font-mono text-ember text-sm tracking-widest">{pwdResult.temp_password}</code>
              <button
                onClick={copyPwd}
                className="font-mono text-[10px] text-ghost hover:text-bone border border-ghost/20 hover:border-ghost px-2 py-1 rounded-sm transition-all"
              >
                {copied ? '✓ COPIED' : 'COPY'}
              </button>
            </div>
            <button
              onClick={() => { setPwdResult(null); setCopied(false) }}
              className="w-full font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-4 py-2 rounded-sm tracking-widest transition-all"
            >
              CLOSE
            </button>
          </div>
        </div>
      )}


      {error && (
        <div className="mb-4 font-mono text-xs text-danger border border-danger/30 bg-danger/10 rounded-sm px-3 py-2">
          {error} <button className="ml-2 underline" onClick={() => setError('')}>dismiss</button>
        </div>
      )}

      {/* Primary role tabs */}
      <div className="flex gap-0 border-b border-ghost/10 mb-4 overflow-x-auto">
        {['ALL', 'OPERATIVE', 'HANDLER', 'CONTRACTOR', 'ADMIN'].map(r => {
          const count = r === 'ALL'
            ? users.filter(u => u.account_status !== 'PENDING_APPROVAL').length
            : users.filter(u => u.role === r && u.account_status !== 'PENDING_APPROVAL').length
          const tabLabel = r === 'ALL' ? 'ALL' : r === 'OPERATIVE' ? terms.operator.toUpperCase() : r === 'HANDLER' ? terms.handler.toUpperCase() : r === 'CONTRACTOR' ? terms.contractor.toUpperCase() : r
          return (
            <button
              key={r}
              onClick={() => setRoleTab(r)}
              className={`font-mono text-xs tracking-widest px-4 py-2 border-b-2 transition-colors whitespace-nowrap ${
                roleTab === r ? 'border-ember text-bone' : 'border-transparent text-ghost hover:text-bone'
              }`}
            >
              {tabLabel}
              <span className="ml-1.5 font-mono" style={{ fontSize: '9px', color: roleTab === r ? '#6B6B85' : '#3A3A52' }}>
                {count}
              </span>
            </button>
          )
        })}
        <button
          onClick={() => setRoleTab('PENDING')}
          className={`font-mono text-xs tracking-widest px-4 py-2 border-b-2 transition-colors whitespace-nowrap ${
            roleTab === 'PENDING' ? 'border-ember text-bone' : 'border-transparent text-ghost hover:text-bone'
          }`}
        >
          PENDING
          <span className="ml-1.5 font-mono" style={{
            fontSize: '9px',
            color: pendingCount > 0 ? '#FF6B00' : (roleTab === 'PENDING' ? '#6B6B85' : '#3A3A52'),
            fontWeight: pendingCount > 0 ? 'bold' : 'normal',
          }}>
            {pendingCount}
          </span>
        </button>
      </div>

      {/* Verification queue — OPERATIVE tab only */}
      {roleTab === 'OPERATIVE' && <VerificationQueue users={users} onRefresh={load} />}

      <div className="flex items-center gap-3 mb-4">
        <input
          className="w-full max-w-sm bg-abyss border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
          placeholder="Search by callsign..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div style={{ background: '#0E0E1A', border: '1px solid #2A2A42' }} className="overflow-x-auto">
        <table style={{ tableLayout: 'fixed', width: '100%', minWidth: '680px', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: '40px' }} />
            <col style={{ width: '24px' }} />
            <col />
            <col style={{ width: '140px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '220px' }} />
          </colgroup>
          <thead>
            <tr style={{ background: '#0A0A14', borderBottom: '2px solid #2A2A42', height: '36px' }}>
              <th className="font-mono text-left" style={{ fontSize: '9px', color: '#4A4A6A', letterSpacing: '0.15em', fontWeight: 'normal', padding: '0 8px' }}>#</th>
              <th />
              <th className="font-mono text-left" style={{ fontSize: '9px', color: '#4A4A6A', letterSpacing: '0.15em', fontWeight: 'normal', padding: '0 8px 0 10px' }}>CALLSIGN</th>
              <th className="font-mono text-left" style={{ fontSize: '9px', color: '#4A4A6A', letterSpacing: '0.15em', fontWeight: 'normal', padding: '0 8px' }}>ROLE</th>
              <th className="font-mono text-center" style={{ fontSize: '9px', color: '#4A4A6A', letterSpacing: '0.15em', fontWeight: 'normal', padding: '0 8px' }}>STATUS</th>
              <th className="font-mono text-left" style={{ fontSize: '9px', color: '#4A4A6A', letterSpacing: '0.15em', fontWeight: 'normal', padding: '0 8px' }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px 0' }}>
                <span className="font-mono text-xs text-ghost animate-pulse">LOADING...</span>
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px 0' }}>
                <span className="font-mono text-xs text-ghost">NO OPERATORS FOUND</span>
              </td></tr>
            ) : filtered.map((u, idx) => {
              const roleColor = u.role === 'ADMIN' ? '#FF2D2D' : u.role === 'CONTRACTOR' ? '#FF6B00' : u.role === 'HANDLER' ? '#4A6FA5' : '#6B6B85'
              const lBorder  = u.role === 'ADMIN' ? '#FF2D2D' : u.role === 'CONTRACTOR' ? '#FF6B00' : u.role === 'HANDLER' ? '#4A6FA5' : '#2A2A42'
              return (
                <tr
                  key={u.id}
                  style={{ borderBottom: '1px solid #16162A', height: '48px' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#13131F'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <td style={{ textAlign: 'center', padding: '0 8px' }}>
                    <span className="font-mono" style={{ fontSize: '10px', color: '#6B6B85' }}>{idx + 1}</span>
                  </td>
                  <td style={{ textAlign: 'center', padding: 0 }}>
                    <span style={{
                      width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block',
                      backgroundColor: u.is_online ? '#00FF88' : '#3A3A52',
                      boxShadow: u.is_online ? '0 0 4px #00FF88' : 'none',
                    }} title={u.is_online ? 'Online' : 'Offline'} />
                  </td>
                  <td style={{ borderLeft: `2px solid ${lBorder}`, padding: '0 8px 0 10px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                      <span className="font-mono" style={{ fontSize: '13px', color: '#E8E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.username}>{u.username}</span>
                      {!u.is_verified && (
                        <span style={{ border: '1px solid #FF6B00', color: '#FF6B00', padding: '1px 3px', fontSize: '8px', flexShrink: 0 }}>!</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '0 8px' }}>
                    <span className="font-mono uppercase" style={{ fontSize: '11px', color: roleColor }}>
                      {u.role === 'OPERATIVE' ? terms.operator.toUpperCase() : u.role === 'HANDLER' ? terms.handler.toUpperCase() : u.role === 'CONTRACTOR' ? terms.contractor.toUpperCase() : u.role}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', padding: '0 8px' }}>
                    {u.account_status === 'PENDING_APPROVAL'
                      ? <span style={{ fontSize: '10px', padding: '3px 8px', letterSpacing: '0.08em', fontFamily: 'inherit', display: 'inline-block', whiteSpace: 'nowrap', border: '1px solid #FF6B00', color: '#FF6B00' }}>PENDING</span>
                      : <StatusBadge banned={u.is_banned} verified={u.is_verified} />}
                  </td>
                  <td style={{ padding: '0 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '4px' }}>
                      <button
                        onClick={() => setDetailUserId(u.id)}
                        className="font-mono transition-all"
                        style={{ fontSize: '9px', padding: '3px 7px', border: '1px solid #6B6B85', color: '#6B6B85', background: 'transparent' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#E8E8F0'; e.currentTarget.style.borderColor = '#E8E8F0' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#6B6B85'; e.currentTarget.style.borderColor = '#6B6B85' }}
                      >VIEW</button>
                      {u.account_status !== 'PENDING_APPROVAL' && (<>
                        <button
                          onClick={() => generatePassword(u)}
                          disabled={pwdLoading}
                          className="font-mono transition-all disabled:opacity-40"
                          style={{ fontSize: '9px', padding: '3px 7px', border: '1px solid #FF6B00', color: '#FF6B00', background: 'transparent' }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#FF6B00'; e.currentTarget.style.color = '#000' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#FF6B00' }}
                        >PWD</button>
                        <button
                          onClick={() => toggleBan(u.id, u.is_banned)}
                          className="font-mono transition-all"
                          style={{ fontSize: '9px', padding: '3px 7px', background: 'transparent',
                            border: `1px solid ${u.is_banned ? '#00FF88' : '#FF2D2D'}`,
                            color: u.is_banned ? '#00FF88' : '#FF2D2D',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = u.is_banned ? '#00FF88' : '#FF2D2D'; e.currentTarget.style.color = '#fff' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = u.is_banned ? '#00FF88' : '#FF2D2D' }}
                        >{u.is_banned ? 'UNBAN' : 'BAN'}</button>
                      </>)}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// REGISTRATION REQUESTS (sub-section inside CommsTab)
// ---------------------------------------------------------------------------
const REG_FILTERS = ['PENDING', 'APPROVED', 'DENIED', 'ALL']

function RegistrationRequestsSection() {
  const [filter,       setFilter]       = useState('PENDING')
  const [regs,         setRegs]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [responses,    setResponses]    = useState({})   // {id: string}
  const [resolving,    setResolving]    = useState({})
  const [confirm,      setConfirm]      = useState(null) // {id, callsign, role, type, resp}
  const [regOpen,      setRegOpen]      = useState(true)
  const [clearingRegs, setClearingRegs] = useState(false)

  async function load(f) {
    setLoading(true)
    try {
      const [regRes, countRes] = await Promise.all([
        client.get('/auth/registration-requests', { params: { status: f } }),
        client.get('/auth/registration-requests/pending-count'),
      ])
      setRegs(regRes.data || [])
      setPendingCount(countRes.data.count || 0)
    } catch {
      setTxError('Failed to load registration requests.')
    }
    setLoading(false)
  }

  useEffect(() => { load(filter) }, [filter]) // eslint-disable-line

  function setResp(id, val) {
    setResponses(r => ({ ...r, [id]: val.slice(0, 300) }))
  }

  async function resolve(id, action) {
    const admin_response = (responses[id] || '').trim()
    if (admin_response.length < 5) return
    setResolving(r => ({ ...r, [id]: true }))
    try {
      await client.patch(`/auth/registration-requests/${id}/${action}`, { admin_response })
      await load(filter)
      setResponses(r => { const c = { ...r }; delete c[id]; return c })
    } catch (e) {
      setTxError(e.response?.data?.detail || `Failed to ${action} request.`)
    }
    setResolving(r => ({ ...r, [id]: false }))
    setConfirm(null)
  }

  async function clearAllRegRequests() {
    if (!window.confirm('Delete all resolved (approved/denied) registration requests? Pending requests are kept.')) return
    setClearingRegs(true)
    try {
      await client.delete('/auth/registration-requests')
      await load(filter)
    } catch (e) {
      setTxError(e.response?.data?.detail || 'Clear failed.')
    }
    setClearingRegs(false)
  }

  return (
    <>
      <div className="border border-ghost/20 rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-ghost/10 bg-abyss flex items-center justify-between">
          <button
            onClick={() => setRegOpen(o => !o)}
            className="font-mono text-xs text-ghost tracking-widest flex items-center gap-2 hover:text-bone transition-colors"
          >
            <span>{regOpen ? '▼' : '▶'}</span>
            REGISTRATION REQUESTS
            {pendingCount > 0 && (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-sm" style={{ color: '#FF6B00', border: '1px solid #FF6B00' }}>
                {pendingCount} PENDING
              </span>
            )}
          </button>
          <button
            onClick={clearAllRegRequests}
            disabled={clearingRegs}
            className="font-mono text-[10px] text-danger/70 border border-danger/30 hover:text-danger hover:border-danger/60 px-2 py-0.5 rounded-sm tracking-widest transition-colors disabled:opacity-40"
          >
            {clearingRegs ? '...' : '[ CLEAR RESOLVED ]'}
          </button>
        </div>

        {regOpen && (<>
        {/* Filter sub-tabs */}
        <div className="flex border-b border-ghost/10 overflow-x-auto">
          {REG_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`font-mono text-[10px] tracking-widest px-4 py-2 border-b-2 transition-colors whitespace-nowrap ${
                filter === f ? 'border-ember text-ember' : 'border-transparent text-ghost hover:text-bone'
              }`}
            >
              {f}{f === 'PENDING' && pendingCount > 0 ? ` (${pendingCount})` : ''}
            </button>
          ))}
        </div>

        {/* Cards */}
        <div className="divide-y divide-ghost/10">
          {loading ? (
            <div className="text-center py-8">
              <p className="font-mono text-xs text-ghost animate-pulse tracking-widest">LOADING...</p>
            </div>
          ) : regs.length === 0 ? (
            <div className="text-center py-8">
              <p className="font-mono text-xs text-ghost tracking-widest">NO REQUESTS</p>
            </div>
          ) : (
            regs.map(reg => {
              const resp = responses[reg.id] || ''
              const isPending = reg.status === 'PENDING'
              const leftColor = REQ_LEFT_BORDER[reg.status] || '#2A2A42'
              const isLoading = resolving[reg.id]

              return (
                <div
                  key={reg.id}
                  style={{ background: '#0E0E1A', borderLeft: `3px solid ${leftColor}` }}
                  className="p-4"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <span className="font-mono text-xs text-bone tracking-widest font-bold">
                        {reg.role_requested} REQUEST
                      </span>
                      <span className="font-mono text-[10px] text-ghost ml-3">{timeAgo(reg.requested_at)}</span>
                    </div>
                    <span className="font-mono text-[10px] tracking-widest px-2 py-0.5 rounded-sm shrink-0"
                          style={{ color: leftColor, border: `1px solid ${leftColor}` }}>
                      {reg.status}
                    </span>
                  </div>

                  <p className="font-mono text-[10px] text-ghost mb-0.5">
                    Callsign: <span className="text-bone">{reg.callsign}</span>
                  </p>
                  <p className="font-mono text-[10px] text-ghost mb-2">
                    Email: <span className="text-bone">{reg.email}</span>
                  </p>

                  <div className="border-t border-ghost/10 my-2" />
                  <p className="font-mono text-[10px] text-ghost mb-0.5 tracking-widest">REASON:</p>
                  <p className="font-mono text-xs text-ghost/80 leading-relaxed mb-2">"{reg.reason}"</p>

                  {!isPending && reg.admin_reason && (
                    <div className="border-t border-ghost/10 mt-2 pt-2">
                      <p className="font-mono text-[10px] text-ghost/60 italic mb-1">&gt; ADMIN: {reg.admin_reason}</p>
                      <p className="font-mono text-[10px] text-ghost/40">
                        Resolved by {reg.admin_callsign} · {fmtDateTime(reg.resolved_at)}
                      </p>
                    </div>
                  )}

                  {isPending && (
                    <div className="border-t border-ghost/10 mt-3 pt-3">
                      <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">ADMIN RESPONSE</label>
                      <textarea
                        rows={2}
                        className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:outline-none focus:border-ember resize-none"
                        placeholder="Response required (min 5 chars)..."
                        value={resp}
                        onChange={e => setResp(reg.id, e.target.value)}
                      />
                      <p className="font-mono text-[10px] text-ghost/40 text-right mb-3">{resp.length}/300</p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setConfirm({ id: reg.id, callsign: reg.callsign, role: reg.role_requested, type: 'approve', resp })}
                          disabled={isLoading || resp.trim().length < 5}
                          title={resp.trim().length < 5 ? 'Response required (min 5 chars)' : ''}
                          className="font-mono text-xs px-4 py-1.5 rounded-sm tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ border: '1px solid #00FF88', color: '#00FF88' }}
                          onMouseEnter={e => { if (resp.trim().length >= 5) { e.currentTarget.style.background='#00FF88'; e.currentTarget.style.color='#000' }}}
                          onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='#00FF88' }}
                        >{isLoading ? '...' : 'APPROVE'}</button>
                        <button
                          onClick={() => setConfirm({ id: reg.id, callsign: reg.callsign, role: reg.role_requested, type: 'deny', resp })}
                          disabled={isLoading || resp.trim().length < 5}
                          title={resp.trim().length < 5 ? 'Response required (min 5 chars)' : ''}
                          className="font-mono text-xs px-4 py-1.5 rounded-sm tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ border: '1px solid #FF2D2D', color: '#FF2D2D' }}
                          onMouseEnter={e => { if (resp.trim().length >= 5) { e.currentTarget.style.background='#FF2D2D'; e.currentTarget.style.color='#fff' }}}
                          onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='#FF2D2D' }}
                        >{isLoading ? '...' : 'DENY'}</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
        </>)}
      </div>

      {/* Confirmation modal */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="border border-ghost/30 rounded-sm p-6 max-w-sm w-full mx-4" style={{ background: '#12121A' }}>
            {confirm.type === 'approve' ? (
              <>
                <p className="font-mono text-xs text-ghost tracking-widest mb-3">CONFIRM APPROVAL</p>
                <p className="font-mono text-sm text-bone mb-1">
                  Approve <span className="text-ember">{confirm.role}</span> account for{' '}
                  <span className="text-ember">{confirm.callsign}</span>?
                </p>
                <p className="font-mono text-[10px] text-ghost mb-2">
                  They will receive an email and can log in immediately.
                </p>
                <p className="font-mono text-[10px] text-ghost/60 mb-4">
                  Response: "{confirm.resp}"
                </p>
              </>
            ) : (
              <>
                <p className="font-mono text-xs text-danger tracking-widest mb-3">CONFIRM DENIAL</p>
                <p className="font-mono text-sm text-bone mb-1">
                  Deny registration for <span className="text-ember">{confirm.callsign}</span>?
                </p>
                <p className="font-mono text-[10px] text-ghost mb-2">
                  Their account will be deleted 24 hours after notification.
                </p>
                <p className="font-mono text-[10px] text-ghost/60 mb-4">
                  Response: "{confirm.resp}"
                </p>
              </>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => resolve(confirm.id, confirm.type === 'approve' ? 'approve' : 'deny')}
                className="font-mono text-xs text-void px-5 py-2 rounded-sm tracking-widest font-bold"
                style={{ background: confirm.type === 'approve' ? '#00FF88' : '#FF2D2D' }}
              >
                CONFIRM {confirm.type.toUpperCase()}
              </button>
              <button
                onClick={() => setConfirm(null)}
                className="font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-5 py-2 rounded-sm tracking-widest transition-all"
              >
                ABORT
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


// ---------------------------------------------------------------------------
// COMMS TAB — transmissions + operator requests
// ---------------------------------------------------------------------------
const REQ_FILTERS = ['PENDING', 'APPROVED', 'DENIED', 'ALL']
const REQ_LEFT_BORDER = { PENDING: '#FF6B00', APPROVED: '#00FF88', DENIED: '#FF2D2D', CANCELLED: '#6B6B80' }

function CommsTab() {
  const terms = usePlatformTerms()
  // --- transmissions ---
  const [transmissions, setTransmissions] = useState([])
  const [content, setContent]             = useState('')
  const [sending, setSending]             = useState(false)
  const [txError, setTxError]             = useState('')
  const [logOpen, setLogOpen]             = useState(true)
  const [clearing, setClearing]           = useState(false)

  // targeting
  const [txMode, setTxMode]               = useState('all')   // 'all' | 'roles' | 'specific'
  const [selectedRoles, setSelectedRoles] = useState(new Set())
  const [operatives, setOperatives]       = useState([])
  const [opSearch, setOpSearch]           = useState('')
  const [selectedOps, setSelectedOps]     = useState(new Set())

  const TARGETABLE_ROLES = ['OPERATIVE', 'CONTRACTOR', 'HANDLER', 'ARCHITECT']

  async function loadTx() {
    const res = await client.get('/transmissions/')
    setTransmissions(res.data)
  }
  async function loadOperatives() {
    const res = await client.get('/operatives/')
    setOperatives(res.data)
  }
  useEffect(() => { loadTx().catch(() => {}); loadOperatives().catch(() => {}) }, [])

  function switchMode(mode) {
    setTxMode(mode)
    setSelectedOps(new Set())
    setSelectedRoles(new Set())
    setOpSearch('')
  }

  function toggleRole(role) {
    setSelectedRoles(prev => {
      const next = new Set(prev)
      next.has(role) ? next.delete(role) : next.add(role)
      return next
    })
  }

  function toggleOp(id) {
    setSelectedOps(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const filteredOps = operatives.filter(o =>
    o.username.toLowerCase().includes(opSearch.toLowerCase())
  )

  async function clearAllLogs() {
    if (!window.confirm('Permanently delete all transmission logs? This cannot be undone.')) return
    setClearing(true)
    try {
      await client.delete('/transmissions/')
      setTransmissions([])
    } catch (e) {
      setTxError(e.response?.data?.detail || 'Clear failed.')
    } finally {
      setClearing(false)
    }
  }

  async function send() {
    if (!content.trim()) return
    if (txMode === 'roles' && selectedRoles.size === 0) { setTxError('Select at least one role.'); return }
    if (txMode === 'specific' && selectedOps.size === 0) { setTxError('Select at least one operative.'); return }
    setSending(true)
    try {
      const payload = { content: content.trim() }
      if (txMode === 'roles')    payload.target_roles   = [...selectedRoles]
      if (txMode === 'specific') payload.recipient_ids  = [...selectedOps]
      await client.post('/transmissions/', payload)
      setContent('')
      setSelectedOps(new Set())
      setSelectedRoles(new Set())
      setOpSearch('')
      await loadTx()
    } catch (e) {
      setTxError(e.response?.data?.detail || 'Broadcast failed.')
    } finally {
      setSending(false)
    }
  }

  // --- operator requests ---
  const [reqFilter,     setReqFilter]     = useState('PENDING')
  const [requests,      setRequests]      = useState([])
  const [reqsLoading,   setReqsLoading]   = useState(true)
  const [pendingCount,  setPendingCount]  = useState(0)
  const [responses,     setResponses]     = useState({})   // {id: string}
  const [resolving,     setResolving]     = useState({})   // {id: bool}
  const [confirmApprove, setConfirmApprove] = useState(null) // {id, callsign, from, to}
  const [bulkSelected,  setBulkSelected] = useState(new Set())
  const [bulkReason,    setBulkReason]   = useState('')
  const [bulkDenying,   setBulkDenying]  = useState(false)
  const [showBulkForm,  setShowBulkForm] = useState(false)
  const [reqOpen,       setReqOpen]      = useState(true)
  const [clearingReqs,  setClearingReqs] = useState(false)

  async function loadRequests(filter) {
    setReqsLoading(true)
    try {
      const params = { status: filter, limit: 50 }
      const [reqRes, countRes] = await Promise.all([
        client.get('/requests', { params }),
        client.get('/requests/pending-count'),
      ])
      setRequests(reqRes.data.items || [])
      setPendingCount(countRes.data.count || 0)
    } catch { /* ignore */ }
    setReqsLoading(false)
  }

  useEffect(() => {
    setBulkSelected(new Set())
    setShowBulkForm(false)
    setBulkReason('')
    loadRequests(reqFilter)
  }, [reqFilter]) // eslint-disable-line

  function setResponse(id, val) {
    setResponses(r => ({ ...r, [id]: val.slice(0, 300) }))
  }

  async function resolveRequest(id, status) {
    const adminResponse = (responses[id] || '').trim()
    if (!adminResponse) return
    setResolving(r => ({ ...r, [id]: true }))
    try {
      await client.patch(`/requests/${id}/resolve`, { status, admin_response: adminResponse })
      await loadRequests(reqFilter)
      setResponses(r => { const c = { ...r }; delete c[id]; return c })
    } catch { /* ignore */ }
    setResolving(r => ({ ...r, [id]: false }))
    setConfirmApprove(null)
  }

  function handleApproveClick(req) {
    if (req.request_type === 'ROLE_CHANGE') {
      setConfirmApprove({
        id: req.id,
        callsign: req.sender_callsign,
        from: req.sender_role,
        to: req.requested_role,
      })
    } else {
      resolveRequest(req.id, 'APPROVED')
    }
  }

  function toggleSelect(id) {
    setBulkSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function bulkDeny() {
    if (!bulkReason.trim() || bulkSelected.size === 0) return
    setBulkDenying(true)
    const results = await Promise.all([...bulkSelected].map(id =>
      client.patch(`/requests/${id}/resolve`, { status: 'DENIED', admin_response: bulkReason.trim() })
        .then(() => true).catch(() => false)
    ))
    const failed = results.filter(r => !r).length
    setBulkSelected(new Set())
    setBulkReason('')
    setShowBulkForm(false)
    setBulkDenying(false)
    if (failed > 0) setTxError(`${failed} denial${failed !== 1 ? 's' : ''} failed. Reload and retry.`)
    await loadRequests(reqFilter)
  }

  async function clearAllRequests() {
    if (!window.confirm('Delete all resolved (approved/denied) operator requests? Pending requests are kept.')) return
    setClearingReqs(true)
    try {
      await client.delete('/requests')
      await loadRequests(reqFilter)
    } catch (e) {
      setTxError(e.response?.data?.detail || 'Clear failed.')
    } finally {
      setClearingReqs(false)
    }
  }

  const pendingRequests = requests.filter(r => r.status === 'PENDING')

  return (
    <div className="space-y-6">
      {/* ── Network Transmissions ── */}
      {txError && (
        <div className="font-mono text-xs text-danger border border-danger/30 bg-danger/10 rounded-sm px-3 py-2">
          {txError} <button className="ml-2 underline" onClick={() => setTxError('')}>dismiss</button>
        </div>
      )}

      <div className="border border-ember/20 bg-ember/5 rounded-sm p-4 space-y-3">
        {/* Mode selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] text-ember tracking-widest">TARGET:</span>
          {[['all', 'ALL'], ['roles', 'BY ROLE'], ['specific', `SPECIFIC ${terms.operator.toUpperCase()}`]].map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => switchMode(mode)}
              className={`font-mono text-[10px] px-3 py-1 rounded-sm tracking-widest border transition-all ${
                txMode === mode
                  ? 'border-ember text-ember bg-ember/10'
                  : 'border-ghost/30 text-ghost hover:border-ghost hover:text-bone'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Role picker */}
        {txMode === 'roles' && (
          <div className="flex flex-wrap gap-2">
            {TARGETABLE_ROLES.map(role => (
              <button
                key={role}
                onClick={() => toggleRole(role)}
                className={`font-mono text-[10px] px-3 py-1.5 rounded-sm tracking-widest border transition-all ${
                  selectedRoles.has(role)
                    ? 'border-ember text-ember bg-ember/10'
                    : 'border-ghost/20 text-ghost hover:border-ghost/50 hover:text-bone'
                }`}
              >
                {role === 'OPERATIVE' ? terms.operator.toUpperCase() : role === 'HANDLER' ? terms.handler.toUpperCase() : role === 'CONTRACTOR' ? terms.contractor.toUpperCase() : role}
              </button>
            ))}
            {selectedRoles.size > 0 && (
              <span className="font-mono text-[10px] text-ghost/50 self-center ml-1">
                {[...selectedRoles].join(', ')} will see this
              </span>
            )}
          </div>
        )}

        {/* Specific operative picker */}
        {txMode === 'specific' && (
          <div className="border border-ghost/20 rounded-sm overflow-hidden">
            <div className="px-3 py-2 border-b border-ghost/10 bg-void">
              <input
                type="text"
                placeholder="Search operatives..."
                value={opSearch}
                onChange={e => setOpSearch(e.target.value)}
                className="w-full bg-transparent font-mono text-xs text-bone placeholder:text-ghost focus:outline-none"
              />
            </div>
            <div className="max-h-36 overflow-y-auto divide-y divide-ghost/10">
              {filteredOps.length === 0 ? (
                <p className="font-mono text-[10px] text-ghost px-3 py-2 tracking-widest">NO {terms.operator.toUpperCase()}S FOUND</p>
              ) : filteredOps.map(op => (
                <label key={op.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-ghost/5">
                  <input type="checkbox" checked={selectedOps.has(op.id)} onChange={() => toggleOp(op.id)} className="accent-ember" />
                  <span className="font-mono text-xs text-bone">{op.username}</span>
                  <span className="font-mono text-[10px] text-ghost ml-auto">{op.bc_total} BC</span>
                </label>
              ))}
            </div>
            {selectedOps.size > 0 && (
              <div className="px-3 py-1.5 border-t border-ghost/10 bg-void">
                <span className="font-mono text-[10px] text-ember">{selectedOps.size} {terms.operator.toUpperCase()}{selectedOps.size > 1 ? 'S' : ''} SELECTED</span>
              </div>
            )}
          </div>
        )}

        <textarea
          rows={3}
          className="w-full bg-void border border-ember/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember resize-none"
          placeholder={
            txMode === 'all'      ? 'Network-wide transmission...' :
            txMode === 'roles'    ? 'Role-restricted transmission...' :
                                    'Targeted transmission...'
          }
          value={content}
          onChange={e => setContent(e.target.value)}
        />
        <div className="flex justify-end">
          <button
            onClick={send}
            disabled={
              sending || !content.trim() ||
              (txMode === 'roles' && selectedRoles.size === 0) ||
              (txMode === 'specific' && selectedOps.size === 0)
            }
            className="font-mono text-xs text-ember border border-ember/40 hover:border-ember hover:bg-ember/10 px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
          >
            {sending ? 'SENDING...' :
             txMode === 'all'      ? 'BROADCAST' :
             txMode === 'roles'    ? `BROADCAST TO ${selectedRoles.size > 0 ? [...selectedRoles].join(', ') : '?'}` :
                                     `SEND TO ${selectedOps.size || '?'} ${terms.operator.toUpperCase()}${selectedOps.size !== 1 ? 'S' : ''}`}
          </button>
        </div>
      </div>

      <div className="border border-ghost/20 rounded-sm overflow-hidden">
        <div className="px-4 py-2 border-b border-ghost/10 bg-abyss flex items-center justify-between">
          <button
            onClick={() => setLogOpen(o => !o)}
            className="font-mono text-[10px] text-ghost tracking-widest flex items-center gap-2 hover:text-bone transition-colors"
          >
            <span>{logOpen ? '▼' : '▶'}</span>
            TRANSMISSION LOG
            <span className="text-ghost/50">({transmissions.length})</span>
          </button>
          {transmissions.length > 0 && (
            <button
              onClick={clearAllLogs}
              disabled={clearing}
              className="font-mono text-[10px] text-danger/70 border border-danger/30 hover:text-danger hover:border-danger/60 px-2 py-0.5 rounded-sm tracking-widest transition-colors disabled:opacity-40"
            >
              {clearing ? '...' : '[ CLEAR ALL ]'}
            </button>
          )}
        </div>
        {logOpen && (
          transmissions.length === 0 ? (
            <div className="text-center py-8">
              <p className="font-mono text-xs text-ghost tracking-widest">NO TRANSMISSIONS</p>
            </div>
          ) : (
            <div className="divide-y divide-ghost/10">
              {transmissions.map(tx => (
                <div key={tx.id} className="px-4 py-3">
                  <p className="font-mono text-sm text-bone">{tx.content}</p>
                  <p className="font-mono text-[10px] text-ghost mt-1 flex items-center gap-2 flex-wrap">
                    <span>{tx.author_username}</span>
                    <span>·</span>
                    {tx.recipient_username
                      ? <span className="text-ember">→ {tx.recipient_username}</span>
                      : tx.target_roles?.length
                        ? <span className="text-flare">→ {tx.target_roles.join(', ')}</span>
                        : <span className="text-ghost/50">→ ALL</span>
                    }
                    <span>·</span>
                    <span>{new Date(tx.created_at).toLocaleString()}</span>
                  </p>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Operator Requests ── */}
      <div className="border border-ghost/20 rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-ghost/10 bg-abyss flex items-center justify-between">
          <button
            onClick={() => setReqOpen(o => !o)}
            className="font-mono text-xs text-ghost tracking-widest flex items-center gap-2 hover:text-bone transition-colors"
          >
            <span>{reqOpen ? '▼' : '▶'}</span>
            OPERATOR REQUESTS
            {pendingCount > 0 && (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-sm" style={{ color: '#FF6B00', border: '1px solid #FF6B00' }}>
                {pendingCount} PENDING
              </span>
            )}
          </button>
          <button
            onClick={clearAllRequests}
            disabled={clearingReqs}
            className="font-mono text-[10px] text-danger/70 border border-danger/30 hover:text-danger hover:border-danger/60 px-2 py-0.5 rounded-sm tracking-widest transition-colors disabled:opacity-40"
          >
            {clearingReqs ? '...' : '[ CLEAR RESOLVED ]'}
          </button>
        </div>

        {reqOpen && (<>
        {/* Filter sub-tabs */}
        <div className="flex border-b border-ghost/10 overflow-x-auto">
          {REQ_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setReqFilter(f)}
              className={`font-mono text-[10px] tracking-widest px-4 py-2 border-b-2 transition-colors whitespace-nowrap ${
                reqFilter === f ? 'border-ember text-ember' : 'border-transparent text-ghost hover:text-bone'
              }`}
            >
              {f}{f === 'PENDING' && pendingCount > 0 ? ` (${pendingCount})` : ''}
            </button>
          ))}
        </div>

        {/* Bulk action bar — only for PENDING with selections */}
        {reqFilter === 'PENDING' && pendingRequests.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 border-b border-ghost/10 bg-abyss flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={bulkSelected.size === pendingRequests.length && pendingRequests.length > 0}
                onChange={e => setBulkSelected(e.target.checked ? new Set(pendingRequests.map(r => r.id)) : new Set())}
                className="accent-ember"
              />
              <span className="font-mono text-[10px] text-ghost">SELECT ALL</span>
            </label>
            {bulkSelected.size > 0 && (
              <button
                onClick={() => setShowBulkForm(v => !v)}
                className="font-mono text-[10px] text-danger border border-danger/30 hover:border-danger px-3 py-1 rounded-sm tracking-widest transition-all"
              >
                [ DENY SELECTED ({bulkSelected.size}) ]
              </button>
            )}
          </div>
        )}

        {/* Bulk deny form */}
        {showBulkForm && bulkSelected.size > 0 && (
          <div className="px-4 py-3 border-b border-ghost/10" style={{ background: 'rgba(255,45,45,0.05)' }}>
            <p className="font-mono text-[10px] text-danger tracking-widest mb-2">REASON FOR BULK DENIAL</p>
            <textarea
              rows={2}
              className="w-full bg-void border border-danger/30 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-danger resize-none"
              placeholder="Reason applied to all selected requests..."
              value={bulkReason}
              onChange={e => setBulkReason(e.target.value.slice(0, 300))}
            />
            <p className="font-mono text-[10px] text-ghost/40 text-right mb-2">{bulkReason.length}/300</p>
            <div className="flex gap-3">
              <button
                onClick={bulkDeny}
                disabled={bulkDenying || !bulkReason.trim()}
                className="font-mono text-xs text-void bg-danger hover:opacity-80 disabled:opacity-40 px-4 py-1.5 rounded-sm tracking-widest transition-all"
              >
                {bulkDenying ? 'DENYING...' : `CONFIRM DENY (${bulkSelected.size})`}
              </button>
              <button
                onClick={() => { setShowBulkForm(false); setBulkReason('') }}
                className="font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-4 py-1.5 rounded-sm tracking-widest transition-all"
              >
                CANCEL
              </button>
            </div>
          </div>
        )}

        {/* Request cards */}
        <div className="divide-y divide-ghost/10">
          {reqsLoading ? (
            <div className="text-center py-8">
              <p className="font-mono text-xs text-ghost animate-pulse tracking-widest">LOADING...</p>
            </div>
          ) : requests.length === 0 ? (
            <div className="text-center py-8">
              <p className="font-mono text-xs text-ghost tracking-widest">NO REQUESTS</p>
            </div>
          ) : (
            requests.map(req => {

              const resp = responses[req.id] || ''
              const isPending = req.status === 'PENDING'
              const leftColor = REQ_LEFT_BORDER[req.status] || '#2A2A42'
              const isLoading = resolving[req.id]

              return (
                <div
                  key={req.id}
                  style={{ background: '#0E0E1A', borderLeft: `3px solid ${leftColor}` }}
                  className="p-4"
                >
                  <div className="flex items-start gap-3">
                    {isPending && (
                      <input
                        type="checkbox"
                        checked={bulkSelected.has(req.id)}
                        onChange={() => toggleSelect(req.id)}
                        className="mt-1 accent-ember shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      {/* Card header */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <span className="font-mono text-xs text-bone tracking-widest font-bold">
                            {req.request_type.replace('_', ' ')} REQUEST
                          </span>
                          <span className="font-mono text-[10px] text-ghost ml-3">{timeAgo(req.created_at)}</span>
                        </div>
                        <span
                          className="font-mono text-[10px] tracking-widest px-2 py-0.5 rounded-sm shrink-0"
                          style={{ color: leftColor, border: `1px solid ${leftColor}` }}
                        >
                          {req.status}
                        </span>
                      </div>

                      <p className="font-mono text-[10px] text-ghost mb-0.5">
                        From: <span className="text-bone">{req.sender_callsign}</span>
                        <span className="ml-1 text-ghost/60">[{req.sender_role}]</span>
                      </p>
                      {req.request_type === 'ROLE_CHANGE' && req.requested_role && (
                        <p className="font-mono text-[10px] text-ghost mb-0.5">
                          Requesting: <span className="text-bone">{req.requested_role}</span>
                        </p>
                      )}

                      <div className="border-t border-ghost/10 my-2" />
                      <p className="font-mono text-xs text-ghost/80 leading-relaxed">{req.reason}</p>

                      {/* Resolved info */}
                      {!isPending && (
                        <div className="border-t border-ghost/10 mt-2 pt-2">
                          {req.admin_response && (
                            <p className="font-mono text-[10px] text-ghost/60 italic mb-1">&gt; ADMIN: {req.admin_response}</p>
                          )}
                          <p className="font-mono text-[10px] text-ghost/40">
                            Resolved by {req.resolved_by} · {fmtDateTime(req.resolved_at)}
                          </p>
                        </div>
                      )}

                      {/* Resolve form — PENDING only */}
                      {isPending && (
                        <div className="mt-3">
                          <div className="border-t border-ghost/10 pt-3">
                            <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">ADMIN RESPONSE</label>
                            <textarea
                              rows={2}
                              className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:outline-none focus:border-ember resize-none"
                              placeholder="Response required before resolving..."
                              value={resp}
                              onChange={e => setResponse(req.id, e.target.value)}
                            />
                            <p className="font-mono text-[10px] text-ghost/40 text-right mb-3">{resp.length}/300</p>
                            <div className="flex gap-3">
                              <button
                                onClick={() => handleApproveClick(req)}
                                disabled={isLoading || !resp.trim()}
                                title={!resp.trim() ? 'Response required' : ''}
                                className="font-mono text-xs px-4 py-1.5 rounded-sm tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{ border: '1px solid #00FF88', color: '#00FF88' }}
                                onMouseEnter={e => { if (resp.trim()) { e.currentTarget.style.background='#00FF88'; e.currentTarget.style.color='#000' }}}
                                onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='#00FF88' }}
                              >
                                {isLoading ? '...' : 'APPROVE'}
                              </button>
                              <button
                                onClick={() => resolveRequest(req.id, 'DENIED')}
                                disabled={isLoading || !resp.trim()}
                                title={!resp.trim() ? 'Response required' : ''}
                                className="font-mono text-xs px-4 py-1.5 rounded-sm tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{ border: '1px solid #FF2D2D', color: '#FF2D2D' }}
                                onMouseEnter={e => { if (resp.trim()) { e.currentTarget.style.background='#FF2D2D'; e.currentTarget.style.color='#fff' }}}
                                onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='#FF2D2D' }}
                              >
                                {isLoading ? '...' : 'DENY'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
        </>)}
      </div>

      {/* ── Registration Requests ── */}
      <RegistrationRequestsSection />

      {/* Confirm dialog for ROLE_CHANGE approve */}
      {confirmApprove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="border border-ghost/30 rounded-sm p-6 max-w-sm w-full" style={{ background: '#12121A' }}>
            <p className="font-mono text-xs text-ghost tracking-widest mb-4">CONFIRM ROLE CHANGE</p>
            <p className="font-mono text-sm text-bone mb-2">
              Approve role change for <span className="text-ember">{confirmApprove.callsign}</span>?
            </p>
            <p className="font-mono text-sm mb-4">
              <span className="text-ghost">[{confirmApprove.from}]</span>
              <span className="text-ghost mx-2">→</span>
              <span style={{ color: '#00FF88' }}>[{confirmApprove.to}]</span>
            </p>
            <p className="font-mono text-[10px] text-ghost/60 mb-5">
              This will immediately update their access level.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => resolveRequest(confirmApprove.id, 'APPROVED')}
                className="font-mono text-xs text-void px-5 py-2 rounded-sm tracking-widest font-bold"
                style={{ background: '#00FF88' }}
              >
                CONFIRM
              </button>
              <button
                onClick={() => setConfirmApprove(null)}
                className="font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-5 py-2 rounded-sm tracking-widest transition-all"
              >
                ABORT
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SETTINGS TAB — platform config
// ---------------------------------------------------------------------------
// SETTINGS TAB — platform config
// ---------------------------------------------------------------------------

const SETTINGS_DEFAULTS = {
  competition_name: 'DEADNET',
  competition_start: '',
  competition_end: '',
  competition_timezone: 'Asia/Manila',
  competition_format: 'local',
  show_section_in_name: 'true',
  registration_open: 'true',
  team_registration_open: 'true',
  allow_solo: 'true',
  max_team_size: '4',
  max_flag_attempts: '0',
  decay_mode: 'TIME_BASED',
  decay_tier_1_hours: '1.0',
  decay_tier_1_percent: '90',
  decay_tier_2_hours: '2.0',
  decay_tier_2_percent: '75',
  decay_tier_3_hours: '3.0',
  decay_tier_3_percent: '60',
  decay_floor_percent: '50',
  cl_ghost: '501',
  cl_phantom: '1501',
  cl_specter: '3001',
  cl_legend: '6001',
  competition_active: '',
  competition_manual_end: '',
  competition_paused_remaining_seconds: '0',
}

const TIMEZONES = [
  'Asia/Manila', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Bangkok',
  'Asia/Jakarta', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Seoul',
  'Asia/Shanghai', 'UTC', 'Europe/London', 'Europe/Paris',
  'Europe/Berlin', 'America/New_York', 'America/Chicago',
  'America/Los_Angeles', 'Australia/Sydney',
]

// ---------------------------------------------------------------------------
// Shared decay tier form — used in admin settings + event override
// ---------------------------------------------------------------------------

function validateDecayTiers(t1h, t2h, t3h, t1p, t2p, t3p, fp) {
  const errors = []
  if (isNaN(t1h) || t1h <= 0) errors.push('Tier 1 hours must be > 0')
  if (isNaN(t2h) || t2h <= 0) errors.push('Tier 2 hours must be > 0')
  if (isNaN(t3h) || t3h <= 0) errors.push('Tier 3 hours must be > 0')
  if (!isNaN(t1h) && !isNaN(t2h) && t2h <= t1h) errors.push('Tier 2 must be after Tier 1')
  if (!isNaN(t2h) && !isNaN(t3h) && t3h <= t2h) errors.push('Tier 3 must be after Tier 2')
  if (!isNaN(t1p) && !isNaN(t2p) && t1p <= t2p) errors.push('Tier 1% must be greater than Tier 2%')
  if (!isNaN(t2p) && !isNaN(t3p) && t2p <= t3p) errors.push('Tier 2% must be greater than Tier 3%')
  if (!isNaN(t3p) && !isNaN(fp) && fp > t3p) errors.push('Floor must not exceed Tier 3%')
  if (isNaN(fp) || fp < 1) errors.push('Floor must be at least 1%')
  return errors
}

function DecayTierInputs({ values, onChange, disabled = false }) {
  const inputCls = `w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember text-center ${disabled ? 'opacity-50' : ''}`
  const tiers = [
    { n: 1, hKey: 'h1', pKey: 'p1' },
    { n: 2, hKey: 'h2', pKey: 'p2' },
    { n: 3, hKey: 'h3', pKey: 'p3' },
  ]
  return (
    <div className="space-y-3">
      {tiers.map(({ n, hKey, pKey }) => (
        <div key={n} className="border border-ghost/15 rounded-sm p-3 bg-void/40">
          <p className="font-mono text-[10px] text-ghost tracking-widest mb-2">TIER {n}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-[10px] text-ghost/50 block mb-1">AFTER (HOURS)</label>
              <input
                type="number" step="0.5" min="0.1"
                className={inputCls}
                value={values[hKey] ?? ''}
                onChange={e => onChange(hKey, e.target.value)}
                disabled={disabled}
              />
            </div>
            <div>
              <label className="font-mono text-[10px] text-ghost/50 block mb-1">BC VALUE (%)</label>
              <input
                type="number" step="1" min="1" max="99"
                className={inputCls}
                value={values[pKey] ?? ''}
                onChange={e => onChange(pKey, e.target.value)}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      ))}
      <div className="border border-ghost/15 rounded-sm p-3 bg-void/40">
        <p className="font-mono text-[10px] text-ghost tracking-widest mb-2">FLOOR</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="font-mono text-[10px] text-ghost/50 block mb-1">MINIMUM BC (%)</label>
            <input
              type="number" step="1" min="1" max="99"
              className={inputCls}
              value={values.floor ?? ''}
              onChange={e => onChange('floor', e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="flex items-end pb-2">
            <p className="font-mono text-[10px] text-ghost/40 leading-relaxed">BC never drops below this percentage of the original value.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function DecayPreview({ t1h, t2h, t3h, t1p, t2p, t3p, fp }) {
  const eff3p = Math.max(t3p, fp)
  const segments = [
    { pct: '100%',   time: `0 – ${t1h}hr`,        color: '#FF4500' },
    { pct: `${t1p}%`, time: `${t1h} – ${t2h}hr`,  color: '#FF6B00' },
    { pct: `${t2p}%`, time: `${t2h} – ${t3h}hr`,  color: '#FFAA00' },
    { pct: `${eff3p}%`, time: `${t3h}hr+`,         color: '#6B6B85' },
  ]
  return (
    <div>
      <p className="font-mono text-[10px] text-ghost tracking-widest mb-2">EXAMPLE</p>
      <div className="flex border border-ghost/20 rounded-sm overflow-hidden">
        {segments.map((s, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col items-center justify-center px-1"
            style={{ minHeight: 60, borderRight: i < 3 ? '1px solid rgba(107,107,128,0.2)' : undefined }}
          >
            <p className="font-mono text-xs font-bold" style={{ color: s.color }}>{s.pct}</p>
            <p className="font-mono text-[10px] text-ghost/50 mt-0.5">{s.time}</p>
          </div>
        ))}
      </div>
      <p className="font-mono text-[9px] text-ghost/30 text-right mt-1 tracking-widest">TIME →</p>
    </div>
  )
}

function DecaySettingsSection({ settings, set }) {
  const t1h = parseFloat(settings.decay_tier_1_hours)
  const t2h = parseFloat(settings.decay_tier_2_hours)
  const t3h = parseFloat(settings.decay_tier_3_hours)
  const t1p = parseInt(settings.decay_tier_1_percent)
  const t2p = parseInt(settings.decay_tier_2_percent)
  const t3p = parseInt(settings.decay_tier_3_percent)
  const fp  = parseInt(settings.decay_floor_percent)
  const errors = validateDecayTiers(t1h, t2h, t3h, t1p, t2p, t3p, fp)
  const previewOk = errors.length === 0 && !isNaN(t1h) && !isNaN(t2h) && !isNaN(t3h) && !isNaN(t1p) && !isNaN(t2p) && !isNaN(t3p) && !isNaN(fp)

  const tierValues = {
    h1: settings.decay_tier_1_hours, p1: settings.decay_tier_1_percent,
    h2: settings.decay_tier_2_hours, p2: settings.decay_tier_2_percent,
    h3: settings.decay_tier_3_hours, p3: settings.decay_tier_3_percent,
    floor: settings.decay_floor_percent,
  }
  const tierKeyMap = {
    h1: 'decay_tier_1_hours', p1: 'decay_tier_1_percent',
    h2: 'decay_tier_2_hours', p2: 'decay_tier_2_percent',
    h3: 'decay_tier_3_hours', p3: 'decay_tier_3_percent',
    floor: 'decay_floor_percent',
  }

  return (
    <div className="space-y-5">
      {/* Mode selector */}
      <div className="grid md:grid-cols-2 gap-3">
        {[
          { value: 'TIME_BASED', label: 'TIME-BASED DECAY', desc: 'BC decreases at set time intervals during the event' },
          { value: 'OFF',        label: 'NO DECAY',         desc: 'Fixed BC throughout the event. Standard CTF mode.' },
        ].map(opt => {
          const active = settings.decay_mode === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => set('decay_mode', opt.value)}
              className="text-left p-4 border rounded-sm transition-all"
              style={active
                ? { borderColor: '#FF4500', background: 'rgba(255,69,0,0.08)' }
                : { borderColor: 'rgba(107,107,128,0.2)' }
              }
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="w-3 h-3 rounded-full border-2 shrink-0 transition-colors"
                  style={active
                    ? { borderColor: '#FF4500', background: '#FF4500' }
                    : { borderColor: 'rgba(107,107,128,0.4)' }
                  }
                />
                <span className={`font-mono text-xs font-bold tracking-widest ${active ? 'text-bone' : 'text-ghost'}`}>
                  {opt.label}
                </span>
              </div>
              <p className="font-mono text-[10px] text-ghost/60 pl-5">{opt.desc}</p>
            </button>
          )
        })}
      </div>

      {/* Tier config — shown only when TIME_BASED */}
      {settings.decay_mode === 'TIME_BASED' && (
        <div className="space-y-4">
          <div>
            <p className="font-mono text-[10px] text-ghost tracking-widest mb-0.5">DECAY TIERS</p>
            <p className="font-mono text-[9px] text-ghost/50">Configure when BC drops and by how much during the event.</p>
          </div>
          <DecayTierInputs
            values={tierValues}
            onChange={(k, v) => set(tierKeyMap[k], v)}
          />
          {errors.length > 0 && (
            <div className="space-y-1 pt-1">
              {errors.map((err, i) => (
                <p key={i} className="font-mono text-[10px] text-danger">⚠ {err}</p>
              ))}
            </div>
          )}
          {previewOk && (
            <DecayPreview t1h={t1h} t2h={t2h} t3h={t3h} t1p={t1p} t2p={t2p} t3p={t3p} fp={fp} />
          )}
        </div>
      )}
    </div>
  )
}

function SettingsSection({ title, children }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="font-mono text-[10px] text-ember tracking-widest shrink-0">{title}</span>
        <div className="flex-1 h-px bg-ember/25" />
      </div>
      {children}
    </div>
  )
}

function Toggle({ value, onChange, onLabel = 'OPEN', offLabel = 'CLOSED' }) {
  const on = value === 'true'
  return (
    <div className="flex items-center gap-3 mt-1">
      <button
        type="button"
        onClick={() => onChange(on ? 'false' : 'true')}
        className={`w-10 h-5 rounded-full transition-colors relative ${on ? 'bg-ember' : 'bg-ghost/30'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-bone rounded-full transition-transform ${on ? 'translate-x-5' : ''}`} />
      </button>
      <span className="font-mono text-xs text-ghost">{on ? onLabel : offLabel}</span>
    </div>
  )
}

function FieldLabel({ children }) {
  return <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">{children}</label>
}

function TextInput({ value, onChange, type = 'text', ...props }) {
  return (
    <input
      type={type}
      className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      {...props}
    />
  )
}

function DateTimeInput({ value, onChange, label }) {
  // Split stored ISO string into date + time parts
  const normalized = value ? value.slice(0, 16) : ''
  const datePart   = normalized.slice(0, 10)   // YYYY-MM-DD
  const timePart   = normalized.slice(11, 16)  // HH:mm (empty string if no value)

  function emit(d, t) {
    if (!d && !t) { onChange(''); return }
    onChange(`${d || datePart}T${t || timePart || '00:00'}`)
  }

  // Quick-set presets: today + common competition times
  const today = new Date()
  const pad = n => String(n).padStart(2, '0')
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const tomorrowStr = (() => {
    const d = new Date(today); d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })()

  const presets = [
    { label: 'Today',    date: todayStr,    time: null },
    { label: 'Tomorrow', date: tomorrowStr, time: null },
    { label: '08:00',    date: null,        time: '08:00' },
    { label: '09:00',    date: null,        time: '09:00' },
    { label: '17:00',    date: null,        time: '17:00' },
    { label: '18:00',    date: null,        time: '18:00' },
  ]

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {/* Date picker */}
        <div className="flex-1">
          <p className="font-mono text-[10px] text-ghost/50 tracking-widest mb-1">DATE</p>
          <input
            type="date"
            className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:invert"
            value={datePart}
            onChange={e => emit(e.target.value, timePart)}
          />
        </div>
        {/* Time picker */}
        <div className="w-32">
          <p className="font-mono text-[10px] text-ghost/50 tracking-widest mb-1">TIME (24H)</p>
          <input
            type="time"
            className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:invert"
            value={timePart}
            onChange={e => emit(datePart, e.target.value)}
          />
        </div>
        {/* Clear */}
        {normalized && (
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => onChange('')}
              className="font-mono text-[10px] text-ghost/50 hover:text-danger border border-ghost/20 hover:border-danger/50 px-2 py-2 rounded-sm transition-all"
              title="Clear"
            >✕</button>
          </div>
        )}
      </div>

      {/* Quick-set presets */}
      <div className="flex flex-wrap gap-1.5">
        {presets.map(p => (
          <button
            key={p.label}
            type="button"
            onClick={() => emit(p.date || datePart || todayStr, p.time || timePart || '00:00')}
            className="font-mono text-[10px] text-ghost hover:text-ember border border-ghost/20 hover:border-ember/50 px-2 py-0.5 rounded-sm tracking-widest transition-all"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Preview of set value */}
      {normalized && (
        <p className="font-mono text-[10px] text-ghost/40">
          Set to: {new Date(normalized).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}
        </p>
      )}
    </div>
  )
}

function SettingsTab() {
  const [settings, setSettings] = useState(SETTINGS_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState({ text: '', ok: true })
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    client.get('/admin/settings')
      .then(r => setSettings({ ...SETTINGS_DEFAULTS, ...r.data }))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const set = (key, val) => setSettings(s => ({ ...s, [key]: val }))

  async function doSave() {
    setShowConfirm(false)
    setSaving(true)
    setMsg({ text: '', ok: true })
    try {
      await client.patch('/admin/settings', { settings })
      setMsg({ text: 'Settings saved.', ok: true })
    } catch (e) {
      const d = e.response?.data?.detail
      setMsg({ text: typeof d === 'string' ? d : 'Save failed.', ok: false })
    } finally {
      setSaving(false)
      setTimeout(() => setMsg({ text: '', ok: true }), 4000)
    }
  }

  if (loading) return <div className="font-mono text-xs text-ghost animate-pulse">LOADING...</div>

  return (
    <div className="space-y-8 max-w-3xl p-4">
      {/* Confirm dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/90">
          <div className="border border-ember/40 bg-abyss rounded-sm p-6 max-w-md w-full mx-4">
            <p className="font-mono text-sm text-bone mb-3 tracking-widest">CONFIRM SETTINGS CHANGE</p>
            <p className="font-mono text-xs text-ghost/80 leading-relaxed mb-6">
              Saving changes to decay or clearance settings during an active competition
              will affect ongoing scoring. Decay changes apply immediately. Are you sure?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-3 py-2 rounded-sm tracking-widest transition-all"
              >
                CANCEL
              </button>
              <button
                onClick={doSave}
                className="flex-1 font-mono text-xs text-void bg-ember hover:bg-flare px-3 py-2 rounded-sm tracking-widest transition-all font-bold"
              >
                CONFIRM SAVE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings sections */}
      <div className="space-y-6">

      {/* REGISTRATION */}
      <SettingsSection title="REGISTRATION">
        <div className="grid md:grid-cols-3 gap-6">
          <div>
            <FieldLabel>GENERAL REGISTRATION</FieldLabel>
            <Toggle value={settings.registration_open} onChange={v => set('registration_open', v)} />
          </div>
          <div>
            <FieldLabel>TEAM REGISTRATION</FieldLabel>
            <Toggle value={settings.team_registration_open} onChange={v => set('team_registration_open', v)} />
          </div>
          <div>
            <FieldLabel>ALLOW SOLO OPERATORS</FieldLabel>
            <Toggle value={settings.allow_solo} onChange={v => set('allow_solo', v)} onLabel="ALLOWED" offLabel="BLOCKED" />
          </div>
        </div>
      </SettingsSection>

      {/* TEAM CONFIG */}
      <SettingsSection title="TEAM CONFIG">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <FieldLabel>MAX TEAM SIZE</FieldLabel>
            <TextInput type="number" value={settings.max_team_size} onChange={v => set('max_team_size', v)} min={2} max={20} />
            <p className="font-mono text-[10px] text-ghost/50 mt-1">max members per team</p>
          </div>
        </div>
      </SettingsSection>

      {/* SCORING CONFIG */}
      <SettingsSection title="SCORING CONFIG">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <FieldLabel>MAX FLAG ATTEMPTS PER CONTRACT</FieldLabel>
            <TextInput type="number" value={settings.max_flag_attempts} onChange={v => set('max_flag_attempts', v)} min={0} />
            <p className="font-mono text-[10px] text-ghost/50 mt-1">
              0 = unlimited · classified contracts auto-cap at 10 per team
            </p>
          </div>
        </div>
      </SettingsSection>

      {/* BOUNTY DECAY */}
      <SettingsSection title="BOUNTY DECAY">
        <DecaySettingsSection settings={settings} set={set} />
      </SettingsSection>

      {/* CLEARANCE LEVELS */}
      <SettingsSection title="CLEARANCE LEVELS">
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { key: 'cl_ghost',   label: 'GHOST THRESHOLD (BC)',   hint: 'NOVICE → GHOST' },
            { key: 'cl_phantom', label: 'PHANTOM THRESHOLD (BC)', hint: 'GHOST → PHANTOM' },
            { key: 'cl_specter', label: 'SPECTER THRESHOLD (BC)', hint: 'PHANTOM → SPECTER' },
            { key: 'cl_legend',  label: 'HACKER THRESHOLD (BC)',  hint: 'SPECTER → HACKER' },
          ].map(({ key, label, hint }) => (
            <div key={key}>
              <FieldLabel>{label}</FieldLabel>
              <TextInput type="number" value={settings[key]} onChange={v => set(key, v)} min={1} />
              <p className="font-mono text-[10px] text-ghost/50 mt-1">{hint}</p>
            </div>
          ))}
        </div>
      </SettingsSection>

      </div>{/* end settings sections wrapper */}

      {/* Save row */}
      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={() => setShowConfirm(true)}
          disabled={saving}
          className="font-mono text-xs text-void bg-ember hover:bg-flare px-6 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50 font-bold"
        >
          {saving ? 'SAVING...' : 'SAVE SETTINGS'}
        </button>
        {msg.text && (
          <span className={`font-mono text-xs ${msg.ok ? 'text-success' : 'text-danger'}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// TEAMS TAB — list + disband
// ---------------------------------------------------------------------------
function TeamsTab() {
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmDisband, setConfirmDisband] = useState(null)

  async function load() {
    const res = await client.get('/bounty-board/teams')
    setTeams(res.data.board || [])
  }

  useEffect(() => { load().catch(() => {}).finally(() => setLoading(false)) }, [])

  async function disband() {
    if (!confirmDisband) return
    try {
      await client.delete(`/admin/teams/${confirmDisband.id}`)
      setConfirmDisband(null)
      await load()
    } catch (e) {
      setError(e.response?.data?.detail || 'Disband failed.')
    }
  }

  return (
    <>
      {confirmDisband && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/90">
          <div className="border border-danger/40 bg-abyss rounded-sm p-6 max-w-sm w-full mx-4">
            <p className="font-mono text-sm text-bone mb-2">DISBAND TEAM</p>
            <p className="font-mono text-xs text-ghost mb-1">
              <span className="text-ember">{confirmDisband.name}</span>
            </p>
            <p className="font-mono text-xs text-ghost/60 mb-6">All members will be removed. BC history is preserved.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDisband(null)} className="flex-1 font-mono text-xs text-ghost border border-ghost/20 px-3 py-2 rounded-sm tracking-widest">CANCEL</button>
              <button onClick={disband} className="flex-1 font-mono text-xs text-danger border border-danger/40 hover:border-danger hover:bg-danger/10 px-3 py-2 rounded-sm tracking-widest">DISBAND</button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 font-mono text-xs text-danger border border-danger/30 bg-danger/10 rounded-sm px-3 py-2">
          {error} <button className="ml-2 underline" onClick={() => setError('')}>dismiss</button>
        </div>
      )}

      <div className="border border-ghost/20 rounded-sm overflow-hidden">
        <div className="grid grid-cols-[1fr_80px_80px_120px] gap-0 px-4 py-2 border-b border-ghost/10 bg-abyss">
          {['TEAM', 'MEMBERS', 'CREW BC', 'ACTIONS'].map(h => (
            <span key={h} className="font-mono text-[10px] text-ghost tracking-widest">{h}</span>
          ))}
        </div>
        {loading ? (
          <div className="text-center py-8"><span className="font-mono text-xs text-ghost animate-pulse">LOADING...</span></div>
        ) : teams.length === 0 ? (
          <div className="text-center py-8"><p className="font-mono text-xs text-ghost tracking-widest">NO TEAMS</p></div>
        ) : (
          <div className="divide-y divide-ghost/10">
            {teams.map(s => (
              <div key={s.id} className="grid grid-cols-[1fr_80px_80px_120px] gap-0 px-4 py-3 items-center hover:bg-abyss/40 transition-colors">
                <Link to={`/teams/${s.id}`} className="font-mono text-sm text-bone hover:text-ember transition-colors">
                  {s.name}
                </Link>
                <span className="font-mono text-xs text-ghost">{s.member_count}</span>
                <span className="font-mono text-xs text-ember font-bold">{s.total_bc}</span>
                <button
                  onClick={() => setConfirmDisband(s)}
                  className="font-mono text-[10px] text-ghost hover:text-danger border border-ghost/20 hover:border-danger px-2 py-0.5 rounded-sm transition-all w-fit"
                >
                  DISBAND
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// ORGANIZATION PROFILE CARD
// ---------------------------------------------------------------------------
function OrgProfileCard() {
  const terms = usePlatformTerms()
  const [org, setOrg] = useState(null)

  useEffect(() => {
    client.get('/admin/organization').then(r => setOrg(r.data)).catch(() => {})
  }, [])

  if (!org) return null

  function fmtMonth(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  function StatCol({ label, value }) {
    return (
      <div>
        <p className="font-mono text-[10px] tracking-widest mb-0.5" style={{ color: '#6B6B85' }}>{label}</p>
        <p className="font-mono text-sm font-bold" style={{ color: '#E8E8F0' }}>{value}</p>
      </div>
    )
  }

  return (
    <div
      className="rounded-sm overflow-hidden mb-6"
      style={{ background: '#0E0E1A', border: '1px solid #2A2A42', borderLeft: '3px solid #FF4500' }}
    >
      <div className="px-5 py-4">
        <p className="font-mono text-[10px] tracking-widest mb-4" style={{ color: '#6B6B85' }}>ORGANIZATION PROFILE</p>
        <div className="space-y-1.5 mb-4">
          <div className="flex justify-between">
            <span className="font-mono text-xs" style={{ color: '#6B6B85' }}>NAME</span>
            <span className="font-mono text-xs" style={{ color: '#E8E8F0' }}>{org.name}</span>
          </div>
          {org.org_code && (
            <div className="flex justify-between">
              <span className="font-mono text-xs" style={{ color: '#6B6B85' }}>ORG CODE</span>
              <span className="font-mono text-xs" style={{ color: '#E8E8F0' }}>{org.org_code}</span>
            </div>
          )}
          {org.description && (
            <div className="flex justify-between gap-4">
              <span className="font-mono text-xs shrink-0" style={{ color: '#6B6B85' }}>DESCRIPTION</span>
              <span className="font-mono text-xs text-right" style={{ color: '#E8E8F0' }}>{org.description}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="font-mono text-xs" style={{ color: '#6B6B85' }}>MEMBER SINCE</span>
            <span className="font-mono text-xs" style={{ color: '#E8E8F0' }}>{fmtMonth(org.created_at)}</span>
          </div>
        </div>

        <div className="border-t pt-4 mt-2 grid grid-cols-2 gap-4" style={{ borderColor: 'rgba(42,42,66,0.8)' }}>
          <p className="font-mono text-[10px] tracking-widest col-span-2" style={{ color: '#6B6B85' }}>OVERALL STATISTICS</p>
          <StatCol label="TOTAL EVENTS"        value={org.stats?.total_events ?? '—'} />
          <StatCol label={`TOTAL ${terms.operator.toUpperCase()}S`} value={org.stats?.total_operatives ?? '—'} />
          <StatCol label="TOTAL BC DISTRIBUTED" value={org.stats?.total_bc_distributed != null ? org.stats.total_bc_distributed.toLocaleString() : '—'} />
          <StatCol label="ACTIVE EVENT"        value={org.stats?.active_event ?? 'None'} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EVENTS TAB — live status command centre
// ---------------------------------------------------------------------------

function fmt(isoStr, tz) {
  if (!isoStr) return '—'
  try {
    return new Date(isoStr).toLocaleString('en-GB', {
      timeZone: tz || 'UTC',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return isoStr
  }
}

function durStr(ms) {
  if (ms <= 0) return '0s'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sc = s % 60
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${sc}s`].filter(Boolean).slice(0, 3).join(' ')
}

const STATUS_META = {
  NOT_CONFIGURED: { label: 'NOT CONFIGURED', color: 'text-ghost',    border: 'border-ghost/20',    bg: 'bg-ghost/5',    dot: 'bg-ghost/40' },
  SCHEDULED:      { label: 'SCHEDULED',      color: 'text-rare-glow', border: 'border-rare-glow/30', bg: 'bg-rare-glow/5', dot: 'bg-rare-glow' },
  ACTIVE:         { label: 'ACTIVE',         color: 'text-success',  border: 'border-success/30',  bg: 'bg-success/5',  dot: 'bg-success animate-pulse' },
  PAUSED:         { label: 'PAUSED',         color: 'text-flare',    border: 'border-flare/40',    bg: 'bg-flare/5',    dot: 'bg-flare animate-pulse' },
  ENDED:          { label: 'ENDED',          color: 'text-ghost/60', border: 'border-ghost/10',    bg: 'bg-ghost/5',    dot: 'bg-ghost/30' },
}

function QuickToggle({ label, hint, value, onToggle, onLabel = 'OPEN', offLabel = 'CLOSED' }) {
  const on = value === 'true'
  return (
    <div className="flex items-center justify-between py-3 border-b border-ghost/10 last:border-0">
      <div>
        <p className="font-mono text-xs text-bone">{label}</p>
        <p className="font-mono text-[10px] text-ghost/50 mt-0.5">{hint}</p>
      </div>
      <div className="flex items-center gap-3 ml-6 shrink-0">
        <span className={`font-mono text-[10px] tracking-widest ${on ? 'text-success' : 'text-ghost'}`}>
          {on ? onLabel : offLabel}
        </span>
        <button
          type="button"
          onClick={onToggle}
          className={`w-10 h-5 rounded-full transition-colors relative ${on ? 'bg-ember' : 'bg-ghost/30'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-bone rounded-full transition-transform ${on ? 'translate-x-5' : ''}`} />
        </button>
      </div>
    </div>
  )
}

function CompetitionTab() {
  const [settings, setSettings] = useState(null)
  const [activeEvent, setActiveEvent] = useState(null)
  const [upcomingEvent, setUpcomingEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [toggling, setToggling] = useState({})
  const [ctrlBusy, setCtrlBusy] = useState(false)
  const [ctrlMsg, setCtrlMsg] = useState('')

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  async function load() {
    const [settingsRes, eventsRes] = await Promise.all([
      client.get('/admin/settings'),
      client.get('/events').catch(() => ({ data: [] })),
    ])
    setSettings({ ...SETTINGS_DEFAULTS, ...settingsRes.data })
    const evList = eventsRes.data || []
    setActiveEvent(evList.find(e => e.status === 'ACTIVE') || null)
    setUpcomingEvent(evList.find(e => e.status === 'UPCOMING') || null)
  }

  useEffect(() => {
    load().catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function quickToggle(key) {
    if (!settings) return
    setToggling(t => ({ ...t, [key]: true }))
    try {
      const next = settings[key] === 'true' ? 'false' : 'true'
      if (key === 'board_frozen') {
        await client.post('/admin/board-freeze', { frozen: next === 'true' })
      } else {
        await client.patch('/admin/settings', { settings: { [key]: next } })
      }
      await load()
    } catch {
      setCtrlMsg('Toggle failed. Try again.')
      setTimeout(() => setCtrlMsg(''), 3000)
    } finally {
      setToggling(t => ({ ...t, [key]: false }))
    }
  }

  async function handleCommence() {
    // Halted active event → resume
    if (activeEvent && settings?.competition_active === 'false') {
      if (!window.confirm('Resume competition? Claims and intel purchases will be unlocked.')) return
      setCtrlBusy(true); setCtrlMsg('')
      try {
        await client.post(`/events/${activeEvent.id}/resume`)
        clearPlatformCache(); await load()
        setCtrlMsg('Competition resumed.')
      } catch { setCtrlMsg('Failed to resume.') }
      finally { setCtrlBusy(false); setTimeout(() => setCtrlMsg(''), 4000) }
      return
    }
    // Upcoming event → start it
    const target = upcomingEvent
    if (!target) { setCtrlMsg('No upcoming event. Create one in [ EVENTS ].'); return }
    if (!window.confirm(`Start "${target.name}"? Claims and intel purchases will be unlocked.`)) return
    setCtrlBusy(true); setCtrlMsg('')
    try {
      await client.post(`/events/${target.id}/start`)
      clearPlatformCache(); await load()
      setCtrlMsg('Competition started.')
    } catch (e) {
      setCtrlMsg(e?.response?.data?.detail || 'Failed to start.')
    }
    finally { setCtrlBusy(false); setTimeout(() => setCtrlMsg(''), 4000) }
  }

  async function handlePause() {
    if (!activeEvent) { setCtrlMsg('No active event to halt.'); return }
    if (!window.confirm('Halt competition? All competition actions will be locked.')) return
    setCtrlBusy(true); setCtrlMsg('')
    try {
      await client.post(`/events/${activeEvent.id}/halt`)
      clearPlatformCache(); await load()
      setCtrlMsg('Competition halted.')
    } catch { setCtrlMsg('Failed to halt.') }
    finally { setCtrlBusy(false); setTimeout(() => setCtrlMsg(''), 4000) }
  }

  if (loading || !settings) {
    return <div className="font-mono text-xs text-ghost animate-pulse">LOADING...</div>
  }

  const start = settings.competition_start ? new Date(settings.competition_start) : null
  const end   = settings.competition_end   ? new Date(settings.competition_end)   : null
  const tz    = settings.competition_timezone || 'Asia/Manila'

  // Manual control state — must be derived before status
  const manualActive     = settings.competition_active === 'true'
  const manualHalted     = settings.competition_active === 'false'
  const manualEndMs      = settings.competition_manual_end ? new Date(settings.competition_manual_end).getTime() : null
  const manualExpired    = manualActive && manualEndMs && now > manualEndMs
  const pausedRemaining  = parseInt(settings.competition_paused_remaining_seconds || '0', 10)
  const isPaused         = manualHalted && pausedRemaining > 0


  return (
    <div className="space-y-6 max-w-3xl">

      {/* Events link */}
      <div className="flex items-center gap-3 px-4 py-3 border border-ember/30 bg-ember/5 rounded-sm">
        <p className="font-mono text-xs text-ghost flex-1">
          Manage competition events, archive results, and view event history.
        </p>
        <a
          href="/events"
          className="font-mono text-xs px-3 py-1.5 border border-ember/60 text-ember hover:bg-ember/10 transition-colors rounded-sm whitespace-nowrap"
        >
          [ EVENTS ] →
        </a>
      </div>

      {/* Organization profile + stats */}
      <OrgProfileCard />

      {/* Manual control panel */}
      <div className={`border rounded-sm overflow-hidden ${
        manualActive && !manualExpired ? 'border-success/40 bg-success/5'
        : isPaused ? 'border-flare/40 bg-flare/5'
        : manualHalted ? 'border-ghost/20 bg-abyss'
        : 'border-ghost/20 bg-abyss'
      }`}>
        <div className="px-4 py-2 border-b border-ghost/10 bg-void flex items-center justify-between">
          <span className="font-mono text-[10px] text-ember tracking-widest">MANUAL COMPETITION CONTROL</span>
          {manualActive && !manualExpired && (
            <span className="font-mono text-[10px] text-success tracking-widest animate-pulse">● ACTIVE</span>
          )}
          {isPaused && (
            <span className="font-mono text-[10px] text-flare tracking-widest animate-pulse">● PAUSED</span>
          )}
          {manualHalted && !isPaused && (
            <span className="font-mono text-[10px] text-ghost tracking-widest">● ENDED</span>
          )}
          {!settings.competition_active && (
            <span className="font-mono text-[10px] text-ghost tracking-widest">SCHEDULE-DRIVEN</span>
          )}
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Status line */}
          {manualActive && !manualExpired && manualEndMs && (
            <p className="font-mono text-xs text-success">
              Running — auto-stops in {durStr(manualEndMs - now)}
            </p>
          )}
          {isPaused && (
            <p className="font-mono text-xs text-flare">
              Paused — {durStr(pausedRemaining * 1000)} remaining. Board frozen. Claims and intel locked.
            </p>
          )}

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {/* No event — show guidance */}
            {!activeEvent && !upcomingEvent && (
              <p className="font-mono text-xs text-ghost/60">
                Create an event in{' '}
                <a href="/events" className="text-ember underline">[ EVENTS ]</a>
                {' '}before starting the competition.
              </p>
            )}

            {/* Commence / Resume */}
            {(upcomingEvent || (activeEvent && settings?.competition_active === 'false')) && (
              <button
                onClick={handleCommence}
                disabled={ctrlBusy}
                className="font-mono text-xs text-success border border-success/40 hover:border-success hover:bg-success/10 px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
              >
                {ctrlBusy ? '...' : activeEvent && settings?.competition_active === 'false' ? '[ RESUME HACKING ]' : '[ COMMENCE HACKING ]'}
              </button>
            )}

            {/* Halt — only when active and running */}
            {activeEvent && settings?.competition_active === 'true' && (
              <button
                onClick={handlePause}
                disabled={ctrlBusy}
                className="font-mono text-xs text-flare border border-flare/40 hover:border-flare hover:bg-flare/10 px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
              >
                {ctrlBusy ? '...' : '[ HALT OPERATIONS ]'}
              </button>
            )}
          </div>

          {ctrlMsg && (
            <p className="font-mono text-xs text-ghost">{ctrlMsg}</p>
          )}
          <p className="font-mono text-[10px] text-ghost/50 leading-relaxed">
            COMMENCE starts the event and unlocks claims, intel, and file downloads.
            HALT pauses all competition actions without ending the event.
            RESUME restores competition from a halted state.
          </p>
        </div>
      </div>

      {/* Quick controls */}
      <div className="border border-ghost/20 bg-abyss rounded-sm overflow-hidden">
        <div className="px-4 py-2 border-b border-ghost/10 bg-void">
          <span className="font-mono text-[10px] text-ghost tracking-widest">QUICK CONTROLS</span>
        </div>
        <div className="px-4">
          <QuickToggle
            label="GENERAL REGISTRATION"
            hint="Allows new users to enlist as OPERATIVE — visible on the landing page ENLIST button"
            value={settings.registration_open}
            onToggle={() => quickToggle('registration_open')}
          />
          <QuickToggle
            label="TEAM REGISTRATION"
            hint="Controls whether teams can be created or joined"
            value={settings.team_registration_open}
            onToggle={() => quickToggle('team_registration_open')}
          />
          <QuickToggle
            label="ALLOW SOLO OPERATORS"
            hint="When OFF, operatives must join a team to participate"
            value={settings.allow_solo}
            onToggle={() => quickToggle('allow_solo')}
            onLabel="ALLOWED" offLabel="BLOCKED"
          />
          <QuickToggle
            label="BOUNTY BOARD FREEZE"
            hint="Hides the leaderboard rankings from all users — use at competition end"
            value={settings.board_frozen}
            onToggle={() => quickToggle('board_frozen')}
            onLabel="FROZEN" offLabel="LIVE"
          />
        </div>
      </div>

      {/* Danger zone — reset competition */}
      <div className="border border-danger/20 rounded-sm overflow-hidden">
        <div className="px-4 py-2 border-b border-danger/20 bg-danger/5">
          <span className="font-mono text-[10px] text-danger tracking-widest">DANGER ZONE</span>
        </div>
        <div className="px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-bone">RESET COMPETITION SCHEDULE</p>
            <p className="font-mono text-[10px] text-ghost/50 mt-0.5">
              Clears the start and end times. The landing page countdown will be removed.
              Scores, contracts, and users are unaffected.
            </p>
          </div>
          <button
            onClick={async () => {
              if (!window.confirm('Clear competition start and end times? The landing page countdown will be removed.')) return
              await client.patch('/admin/settings', { settings: { competition_start: '', competition_end: '' } })
              await load()
            }}
            className="font-mono text-xs text-danger border border-danger/30 hover:border-danger hover:bg-danger/10 px-4 py-2 rounded-sm tracking-widest transition-all shrink-0"
          >
            RESET SCHEDULE
          </button>
        </div>
      </div>

      {/* How it works */}
      <div className="border border-ghost/10 rounded-sm p-4 space-y-3">
        <p className="font-mono text-[10px] text-ember tracking-widest">HOW COMPETITION SETTINGS WORK</p>
        <div className="space-y-2">
          {[
            ['Competition Start / End', 'Drives the countdown clock on the public landing page. Once start passes the landing page shows "DEADNET IS LIVE". End time is informational only — contracts remain active unless you manually close them.'],
            ['General Registration', 'The ENLIST button on the landing page. When CLOSED new visitors cannot create accounts. Existing accounts are unaffected.'],
            ['Team Registration', 'When CLOSED, operatives cannot create new teams or join existing ones via invite code.'],
            ['Allow Solo', 'When BLOCKED, operatives without a team cannot claim contracts. Enforced at flag submission.'],
            ['Bounty Board Freeze', 'Hides all rankings. Use this before announcing results so scores aren\'t visible mid-deliberation.'],
          ].map(([title, desc]) => (
            <div key={title} className="flex gap-3">
              <span className="font-mono text-[10px] text-ember/70 tracking-widest shrink-0 w-36">{title}</span>
              <p className="font-mono text-[10px] text-ghost/70 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ArchiveTab — Browse the contract archive and redeploy to active events
// ---------------------------------------------------------------------------
const ARCHIVE_PAGE_SIZE = 15

function ArchiveTab() {
  const [archived,            setArchived]            = useState([])
  const [events,              setEvents]              = useState([])
  const [loading,             setLoading]             = useState(true)
  const [bulkEventId,         setBulkEventId]         = useState('')
  const [bulking,             setBulking]             = useState(false)
  // Single-contract modal redeploy
  const [redeployTarget,      setRedeployTarget]      = useState(null)
  const [redeployEventId,     setRedeployEventId]     = useState('')
  const [redeployPublish,     setRedeployPublish]     = useState(false)
  const [redeployLoading,     setRedeployLoading]     = useState(false)
  // Inline quick-deploy (expanded row)
  const [expandedId,          setExpandedId]          = useState(null)
  const [inlineEventId,       setInlineEventId]       = useState('')
  const [inlinePublish,       setInlinePublish]       = useState(false)
  const [inlineDeploying,     setInlineDeploying]     = useState(false)
  // Redeploy-all
  const [redeployAllOpen,     setRedeployAllOpen]     = useState(false)
  const [redeployAllEventId,  setRedeployAllEventId]  = useState('')
  const [redeployAllPublish,  setRedeployAllPublish]  = useState(false)
  const [redeployAllLoading,  setRedeployAllLoading]  = useState(false)
  const [redeployAllProgress, setRedeployAllProgress] = useState({ done: 0, total: 0 })
  // Flash / sort / page
  const [msg,     setMsg]     = useState('')
  const [msgType, setMsgType] = useState('success')
  const [sortKey, setSortKey] = useState('archived_at')
  const [sortDir, setSortDir] = useState('desc')
  const [page,    setPage]    = useState(1)

  function flash(text, type = 'success') {
    setMsg(text); setMsgType(type)
    setTimeout(() => setMsg(''), 4000)
  }

  async function loadArchive() {
    setLoading(true)
    try {
      const r = await client.get('/admin/contracts/archive')
      setArchived(r.data)
      setPage(1)
    } catch { flash('Failed to load archive.', 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    loadArchive()
    client.get('/events').then(r => setEvents(r.data)).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBulkArchive() {
    if (!bulkEventId) return
    setBulking(true)
    try {
      const r = await client.post(`/admin/events/${bulkEventId}/archive-contracts`)
      const skippedNote = r.data.skipped > 0 ? ` (${r.data.skipped} skipped — not owned by your org)` : ''
      flash(`${r.data.archived} contract(s) archived.${skippedNote}`)
      setBulkEventId('')
      loadArchive()
    } catch (e) {
      flash(e.response?.data?.detail || 'Bulk archive failed.', 'error')
    } finally { setBulking(false) }
  }

  async function handleUnarchive(contract) {
    try {
      await client.post(`/admin/contracts/${contract.id}/archive`)
      flash(`"${contract.title}" restored to its original event as unpublished.`)
      loadArchive()
    } catch { flash('Failed to restore contract.', 'error') }
  }

  async function handleRedeploy() {
    if (!redeployEventId) return
    setRedeployLoading(true)
    try {
      await client.post(`/admin/contracts/${redeployTarget.id}/redeploy`, {
        event_id: parseInt(redeployEventId), publish: redeployPublish,
      })
      const evtName = events.find(e => String(e.id) === String(redeployEventId))?.name || 'target event'
      flash(`"${redeployTarget.title}" deployed to ${evtName} as ${redeployPublish ? 'PUBLISHED' : 'DRAFT'}.`)
      setRedeployTarget(null); setRedeployEventId(''); setRedeployPublish(false)
    } catch (e) {
      flash(e.response?.data?.detail || 'Redeploy failed.', 'error')
    } finally { setRedeployLoading(false) }
  }

  async function handleInlineDeploy(contract) {
    if (!inlineEventId) return
    setInlineDeploying(true)
    try {
      await client.post(`/admin/contracts/${contract.id}/redeploy`, {
        event_id: parseInt(inlineEventId), publish: inlinePublish,
      })
      const evtName = events.find(e => String(e.id) === String(inlineEventId))?.name || 'target event'
      flash(`"${contract.title}" deployed to ${evtName} as ${inlinePublish ? 'PUBLISHED' : 'DRAFT'}.`)
      setExpandedId(null); setInlineEventId(''); setInlinePublish(false)
    } catch (e) {
      flash(e.response?.data?.detail || 'Deploy failed.', 'error')
    } finally { setInlineDeploying(false) }
  }

  async function handleRedeployAll() {
    if (!redeployAllEventId || sorted.length === 0) return
    setRedeployAllLoading(true)
    let done = 0, failed = 0
    setRedeployAllProgress({ done: 0, total: sorted.length })
    for (const c of sorted) {
      try {
        await client.post(`/admin/contracts/${c.id}/redeploy`, {
          event_id: parseInt(redeployAllEventId), publish: redeployAllPublish,
        })
        done++
      } catch { failed++ }
      setRedeployAllProgress({ done: done + failed, total: sorted.length })
    }
    setRedeployAllLoading(false)
    setRedeployAllOpen(false); setRedeployAllEventId(''); setRedeployAllPublish(false)
    const evtName = events.find(e => String(e.id) === String(redeployAllEventId))?.name || 'target event'
    flash(
      `${done} contract(s) deployed to ${evtName}${failed > 0 ? ` · ${failed} failed` : ''}.`,
      failed > 0 ? 'error' : 'success'
    )
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc'); setPage(1) }
  }

  function toggleExpand(id) {
    if (expandedId === id) { setExpandedId(null) }
    else { setExpandedId(id); setInlineEventId(''); setInlinePublish(false) }
  }

  const sorted = [...archived].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey]
    if (av == null) return 1; if (bv == null) return -1
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const totalPages = Math.max(1, Math.ceil(sorted.length / ARCHIVE_PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageSlice  = sorted.slice((safePage - 1) * ARCHIVE_PAGE_SIZE, safePage * ARCHIVE_PAGE_SIZE)
  const activeEvents = events.filter(e => ['ACTIVE', 'UPCOMING'].includes(e.status))

  const RARITY_CFG = { COMMON: '#8A8A9A', RARE: '#4A9EFF', CLASSIFIED: '#FF2D2D' }
  const COL_HEADERS = [
    { key: 'title',         label: 'TITLE' },
    { key: 'category',      label: 'CATEGORY' },
    { key: 'rarity',        label: 'RARITY' },
    { key: 'base_bc_value', label: 'BC' },
    { key: 'event_name',    label: 'SOURCE EVENT' },
    { key: 'claim_count',   label: 'CLAIMS' },
    { key: null,            label: 'ACTIONS' },
  ]

  function SortInd({ col }) {
    if (!col || sortKey !== col) return <span className="text-ghost/20 ml-1">↕</span>
    return <span className="text-ember ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const selectCls = 'bg-void border border-ghost/20 rounded-sm px-2 py-1 font-mono text-xs text-bone focus:outline-none focus:border-ember'

  return (
    <div className="space-y-6">
      {msg && (
        <div className={`font-mono text-xs px-4 py-3 rounded-sm border ${
          msgType === 'success' ? 'text-success border-success/30 bg-success/5' : 'text-danger border-danger/30 bg-danger/5'
        }`}>
          {msg}
        </div>
      )}

      {/* Bulk archive from event */}
      <div className="border border-ghost/20 rounded-sm p-4">
        <p className="font-mono text-[10px] text-ember tracking-widest mb-1">ARCHIVE ALL CONTRACTS FROM EVENT</p>
        <p className="font-mono text-[10px] text-ghost/50 mb-4 leading-relaxed">
          Select an event to move all its contracts into the archive. Archived contracts are unpublished and preserved for future reuse.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={bulkEventId} onChange={e => setBulkEventId(e.target.value)} className={selectCls}>
            <option value="">— SELECT EVENT —</option>
            {events.map(e => <option key={e.id} value={e.id}>{e.name} [{e.status}]</option>)}
          </select>
          <button
            onClick={handleBulkArchive} disabled={!bulkEventId || bulking}
            className="font-mono text-xs text-ember border border-ember/40 hover:border-ember hover:bg-ember/10 px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {bulking ? 'ARCHIVING...' : '[ ARCHIVE ALL ]'}
          </button>
        </div>
      </div>

      {/* Archive library */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="font-mono text-[10px] text-ghost tracking-widest">
            ARCHIVED LIBRARY — {archived.length} CONTRACT{archived.length !== 1 ? 'S' : ''}
            {!loading && archived.length > 0 && <span className="text-ghost/30 ml-3">PAGE {safePage}/{totalPages}</span>}
          </p>
          {!loading && archived.length > 0 && (
            <button
              onClick={() => { setRedeployAllOpen(true); setRedeployAllEventId(''); setRedeployAllPublish(false) }}
              className="font-mono text-[10px] text-flare border border-flare/30 hover:border-flare hover:bg-flare/5 px-3 py-1 rounded-sm tracking-widest transition-all"
            >
              [ REDEPLOY ALL ]
            </button>
          )}
        </div>

        {loading ? (
          <p className="font-mono text-xs text-ghost animate-pulse py-8 text-center">PULLING ARCHIVE...</p>
        ) : archived.length === 0 ? (
          <div className="border border-ghost/20 rounded-sm py-12 text-center space-y-2">
            <p className="font-mono text-xs text-ghost tracking-widest">NO ARCHIVED CONTRACTS</p>
            <p className="font-mono text-[10px] text-ghost/40">Archive contracts using the tool above or the ARCH button in the Contractor Dashboard.</p>
          </div>
        ) : (
          <>
            <div className="border border-ghost/20 rounded-sm overflow-x-auto">
              {/* Sortable header */}
              <div className="grid grid-cols-[2fr_120px_110px_60px_140px_80px_170px] px-4 py-2 border-b border-ghost/10 bg-abyss min-w-[900px]">
                {COL_HEADERS.map(({ key, label }) => (
                  <button
                    key={label}
                    onClick={() => key && toggleSort(key)}
                    className={`font-mono text-[10px] tracking-widest text-left transition-colors ${
                      key ? 'hover:text-ghost cursor-pointer' : 'cursor-default'
                    } ${key && sortKey === key ? 'text-ember' : 'text-ghost/50'}`}
                  >
                    {label}<SortInd col={key} />
                  </button>
                ))}
              </div>

              {/* Rows */}
              {pageSlice.map(c => {
                const rColor = RARITY_CFG[c.rarity] || '#8A8A9A'
                const isExpanded = expandedId === c.id
                return (
                  <div key={c.id} className={`border-b border-ghost/10 transition-colors ${isExpanded ? 'bg-abyss/50' : ''}`}>
                    {/* Main clickable row */}
                    <div
                      className="grid grid-cols-[2fr_120px_110px_60px_140px_80px_170px] px-4 py-3 items-center min-w-[900px] hover:bg-abyss/40 transition-colors cursor-pointer select-none"
                      style={{ borderLeft: `3px solid ${rColor}${isExpanded ? '70' : '30'}` }}
                      onClick={() => toggleExpand(c.id)}
                    >
                      <div className="min-w-0 pr-2">
                        <p className="font-mono text-sm text-bone truncate">{c.title}</p>
                        {c.tags?.length > 0 && (
                          <p className="font-mono text-[10px] text-ghost/40 truncate mt-0.5">{c.tags.slice(0, 3).join(', ')}</p>
                        )}
                      </div>
                      <span className="font-mono text-xs text-ghost whitespace-nowrap">{c.category}</span>
                      <span className="font-mono text-xs whitespace-nowrap" style={{ color: rColor }}>{c.rarity}</span>
                      <span className="font-mono text-sm font-bold text-ember whitespace-nowrap">{c.base_bc_value}</span>
                      <div className="min-w-0 pr-2">
                        <p className="font-mono text-[10px] text-bone truncate">{c.event_name || '—'}</p>
                        {c.event_status && (
                          <p className={`font-mono text-[9px] tracking-widest ${c.event_status === 'ACTIVE' ? 'text-success' : 'text-ghost/40'}`}>
                            {c.event_status}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="font-mono text-xs text-bone">{c.claim_count}</p>
                        {c.intel_count > 0 && <p className="font-mono text-[10px] text-ghost/40">{c.intel_count} intel</p>}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => { setRedeployTarget(c); setRedeployEventId(''); setRedeployPublish(false) }}
                          className="font-mono text-[10px] text-ember border border-ember/30 hover:border-ember px-2 py-0.5 rounded-sm transition-all whitespace-nowrap"
                        >REDEPLOY</button>
                        <button
                          onClick={() => handleUnarchive(c)}
                          title="Remove from archive — restores to original event as unpublished draft"
                          className="font-mono text-[10px] text-ghost hover:text-bone border border-ghost/20 hover:border-ghost/50 px-2 py-0.5 rounded-sm transition-all whitespace-nowrap"
                        >RESTORE</button>
                      </div>
                    </div>

                    {/* Inline expansion panel */}
                    {isExpanded && (
                      <div className="px-4 py-3 border-t border-ghost/5 bg-void/30 min-w-[900px]">
                        {/* Meta row */}
                        <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3">
                          {c.intel_count > 0 && <span className="font-mono text-[10px] text-ghost/50">{c.intel_count} intel drops</span>}
                          {c.attachment_count > 0 && <span className="font-mono text-[10px] text-ghost/50">{c.attachment_count} file{c.attachment_count !== 1 ? 's' : ''}</span>}
                          {c.creator_username && <span className="font-mono text-[10px] text-ghost/50">by {c.creator_username}</span>}
                          {c.archived_at && <span className="font-mono text-[10px] text-ghost/40">archived {c.archived_at.slice(0, 10)}</span>}
                          {c.tags?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {c.tags.map(t => (
                                <span key={t} className="font-mono text-[9px] px-1.5 py-0.5 border border-ghost/15 text-ghost/40 rounded-sm">{t}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* Quick deploy */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] text-ghost/40 tracking-widest">QUICK DEPLOY →</span>
                          <select
                            value={inlineEventId}
                            onChange={e => setInlineEventId(e.target.value)}
                            className={selectCls}
                            onClick={e => e.stopPropagation()}
                          >
                            <option value="">— target event —</option>
                            {activeEvents.map(e => <option key={e.id} value={e.id}>{e.name} [{e.status}]</option>)}
                          </select>
                          <div className="flex rounded-sm overflow-hidden border border-ghost/20">
                            <button
                              onClick={e => { e.stopPropagation(); setInlinePublish(false) }}
                              className={`font-mono text-[10px] px-2 py-1 transition-colors ${!inlinePublish ? 'bg-ghost/15 text-bone' : 'text-ghost/40 hover:text-ghost'}`}
                            >DRAFT</button>
                            <button
                              onClick={e => { e.stopPropagation(); setInlinePublish(true) }}
                              className={`font-mono text-[10px] px-2 py-1 border-l border-ghost/20 transition-colors ${inlinePublish ? 'bg-success/10 text-success' : 'text-ghost/40 hover:text-ghost'}`}
                            >PUBLISH</button>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); handleInlineDeploy(c) }}
                            disabled={!inlineEventId || inlineDeploying}
                            className={`font-mono text-[10px] px-3 py-1 rounded-sm border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                              inlinePublish
                                ? 'text-success border-success/40 hover:border-success hover:bg-success/10'
                                : 'text-ember border-ember/40 hover:border-ember hover:bg-ember/10'
                            }`}
                          >
                            {inlineDeploying ? '...' : inlinePublish ? '[ DEPLOY & PUBLISH ]' : '[ DEPLOY AS DRAFT ]'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                  className="font-mono text-[10px] text-ghost border border-ghost/20 hover:border-ghost/50 hover:text-bone px-3 py-1 rounded-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >← PREV</button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                    <button key={p} onClick={() => setPage(p)}
                      className={`font-mono text-[10px] w-6 h-6 rounded-sm transition-all ${
                        p === safePage ? 'bg-ember/20 text-ember border border-ember/40' : 'text-ghost/50 hover:text-bone border border-transparent hover:border-ghost/20'
                      }`}
                    >{p}</button>
                  ))}
                </div>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                  className="font-mono text-[10px] text-ghost border border-ghost/20 hover:border-ghost/50 hover:text-bone px-3 py-1 rounded-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >NEXT →</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── REDEPLOY ALL modal ── */}
      <AnimatePresence>
        {redeployAllOpen && (
          <>
            <motion.div className="fixed inset-0 z-50 bg-void/70" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !redeployAllLoading && setRedeployAllOpen(false)} />
            <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}
            >
              <div className="bg-abyss border border-ghost/30 rounded-sm p-6 w-full max-w-md pointer-events-auto" style={{ borderTop: '3px solid #FF6B00' }}>
                <p className="font-mono text-[10px] text-ghost tracking-widest mb-1">REDEPLOY ALL ARCHIVED CONTRACTS</p>
                <p className="font-mono text-lg text-bone font-bold mb-1">{sorted.length} contract{sorted.length !== 1 ? 's' : ''}</p>
                <p className="font-mono text-[10px] text-ghost/50 mb-5 leading-relaxed">
                  A fresh copy of every archived contract will be created in the target event.<br/>
                  All archived originals are preserved. Intel drops are included.
                </p>
                <label className="font-mono text-[10px] text-ghost tracking-widest block mb-2">TARGET EVENT</label>
                <select value={redeployAllEventId} onChange={e => setRedeployAllEventId(e.target.value)}
                  className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:outline-none focus:border-ember mb-4"
                  disabled={redeployAllLoading}
                >
                  <option value="">— SELECT TARGET EVENT —</option>
                  {activeEvents.map(e => <option key={e.id} value={e.id}>{e.name} [{e.status}]</option>)}
                </select>
                <label className="font-mono text-[10px] text-ghost tracking-widest block mb-2">DEPLOY AS</label>
                <div className="flex gap-2 mb-5">
                  {[false, true].map(v => (
                    <button key={String(v)} onClick={() => setRedeployAllPublish(v)} disabled={redeployAllLoading}
                      className={`flex-1 font-mono text-xs py-2 rounded-sm border transition-all disabled:opacity-50 ${
                        redeployAllPublish === v
                          ? v ? 'border-success/60 text-success bg-success/10' : 'border-ghost/60 text-bone bg-ghost/10'
                          : 'border-ghost/20 text-ghost/50 hover:border-ghost/40'
                      }`}
                    >{v ? 'PUBLISHED' : 'DRAFT'}</button>
                  ))}
                </div>
                {redeployAllLoading && (
                  <div className="mb-4">
                    <div className="h-1 bg-ghost/10 rounded-full overflow-hidden mb-1">
                      <div
                        className="h-full bg-ember transition-all"
                        style={{ width: `${redeployAllProgress.total ? (redeployAllProgress.done / redeployAllProgress.total) * 100 : 0}%` }}
                      />
                    </div>
                    <p className="font-mono text-[10px] text-ghost/50 text-center">
                      {redeployAllProgress.done} / {redeployAllProgress.total} deployed…
                    </p>
                  </div>
                )}
                <div className="flex justify-end gap-3">
                  <button onClick={() => setRedeployAllOpen(false)} disabled={redeployAllLoading}
                    className="font-mono text-xs text-ghost border border-ghost/20 px-4 py-2 rounded-sm hover:border-ghost transition-all disabled:opacity-40"
                  >CANCEL</button>
                  <button
                    onClick={handleRedeployAll}
                    disabled={!redeployAllEventId || redeployAllLoading}
                    className={`font-mono text-xs px-4 py-2 rounded-sm border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      redeployAllPublish
                        ? 'text-success border-success/40 hover:border-success hover:bg-success/10'
                        : 'text-flare border-flare/40 hover:border-flare hover:bg-flare/10'
                    }`}
                  >
                    {redeployAllLoading ? `DEPLOYING ${redeployAllProgress.done}/${redeployAllProgress.total}...` : redeployAllPublish ? '[ DEPLOY ALL & PUBLISH ]' : '[ DEPLOY ALL AS DRAFT ]'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Single-contract redeploy modal ── */}
      <AnimatePresence>
        {redeployTarget && (
          <>
            <motion.div className="fixed inset-0 z-50 bg-void/70" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setRedeployTarget(null); setRedeployEventId(''); setRedeployPublish(false) }} />
            <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}
            >
              <div className="bg-abyss border border-ghost/30 rounded-sm p-6 w-full max-w-md pointer-events-auto" style={{ borderTop: '3px solid #FF4500' }}>
                <p className="font-mono text-[10px] text-ghost tracking-widest mb-1">REDEPLOY CONTRACT</p>
                <p className="font-mono text-lg text-bone font-bold mb-1 leading-snug">{redeployTarget?.title}</p>
                <p className="font-mono text-[10px] text-ghost/50 mb-5 leading-relaxed">
                  A fresh copy will be created in the target event. Intel drops are included.<br />The archived original is preserved.
                </p>
                <label className="font-mono text-[10px] text-ghost tracking-widest block mb-2">TARGET EVENT</label>
                <select value={redeployEventId} onChange={e => setRedeployEventId(e.target.value)}
                  className="w-full bg-void border border-ghost/30 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:outline-none focus:border-ember mb-4"
                >
                  <option value="">— SELECT TARGET EVENT —</option>
                  {activeEvents.map(e => <option key={e.id} value={e.id}>{e.name} [{e.status}]</option>)}
                </select>
                <label className="font-mono text-[10px] text-ghost tracking-widest block mb-2">DEPLOY AS</label>
                <div className="flex gap-2 mb-5">
                  {[false, true].map(v => (
                    <button key={String(v)} onClick={() => setRedeployPublish(v)}
                      className={`flex-1 font-mono text-xs py-2 rounded-sm border transition-all ${
                        redeployPublish === v
                          ? v ? 'border-success/60 text-success bg-success/10' : 'border-ghost/60 text-bone bg-ghost/10'
                          : 'border-ghost/20 text-ghost/50 hover:border-ghost/40'
                      }`}
                    >{v ? 'PUBLISHED' : 'DRAFT'}</button>
                  ))}
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => { setRedeployTarget(null); setRedeployEventId(''); setRedeployPublish(false) }}
                    className="font-mono text-xs text-ghost border border-ghost/20 px-4 py-2 rounded-sm hover:border-ghost transition-all"
                  >CANCEL</button>
                  <button onClick={handleRedeploy} disabled={!redeployEventId || redeployLoading}
                    className={`font-mono text-xs px-4 py-2 rounded-sm border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      redeployPublish
                        ? 'text-success border-success/40 hover:border-success hover:bg-success/10'
                        : 'text-ember border-ember/40 hover:border-ember hover:bg-ember/10'
                    }`}
                  >
                    {redeployLoading ? 'DEPLOYING...' : redeployPublish ? '[ DEPLOY & PUBLISH ]' : '[ DEPLOY AS DRAFT ]'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AdminDashboard
// ---------------------------------------------------------------------------
export default function AdminDashboard() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const initialTab = searchParams.get('tab') || 'competition'
  const [tab, setTab] = useState(initialTab)
  const [pendingReqs, setPendingReqs] = useState(0)
  const [orgShortName, setOrgShortName] = useState('')

  // Redirect to onboarding if not yet complete
  useEffect(() => {
    if (user && !user.onboarding_complete) {
      navigate('/admin/onboarding', { replace: true })
    }
  }, [user, navigate])

  // Fetch organization short name for header badge
  useEffect(() => {
    client.get('/admin/organization')
      .then(r => setOrgShortName(r.data.org_code || r.data.name || ''))
      .catch(() => {})
  }, [])

  // Poll pending request count every 30 seconds for badge + banner
  useEffect(() => {
    let mounted = true
    async function poll() {
      try {
        const r = await client.get('/requests/pending-count')
        if (mounted) setPendingReqs(r.data.count || 0)
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 30000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  const TABS = [
    ['competition', 'OVERVIEW'],
    ['operators',   'OPERATORS'],
    ['teams',       'TEAMS'],
    ['archive',     'ARCHIVE'],
    ['comms',       'COMMS'],
    ['settings',    'SETTINGS'],
  ]

  return (
    <div className="relative min-h-screen bg-void text-bone flex flex-col">
      <Scanlines />
      <Navbar />

      <div className="relative z-10 flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <h1 className="font-mono font-bold text-3xl text-ember tracking-widest">ADMIN CONSOLE</h1>
          {orgShortName && (
            <span
              className="font-mono text-[10px] tracking-widest"
              style={{
                border: '1px solid #6B6B85',
                color: '#6B6B85',
                padding: '2px 6px',
              }}
            >
              {orgShortName}
            </span>
          )}
        </div>

        {/* Pending requests alert banner */}
        {pendingReqs > 0 && (
          <button
            onClick={() => setTab('comms')}
            className="w-full text-left mb-4 font-mono text-xs tracking-widest px-4 py-3 rounded-sm transition-all"
            style={{ background: 'rgba(255,69,0,0.08)', border: '1px solid rgba(255,69,0,0.4)', color: '#FF4500' }}
          >
            [ ! ] {pendingReqs} PENDING OPERATOR REQUEST{pendingReqs !== 1 ? 'S' : ''} — click to review
          </button>
        )}

        {/* Tab bar */}
        <div className="flex border-b border-ghost/20 mb-6 overflow-x-auto">
          {TABS.map(([key, label]) => (
            <TabButton key={key} active={tab === key} onClick={() => setTab(key)}>
              {key === 'comms' && pendingReqs > 0
                ? <>{label} <span className="inline-flex items-center justify-center ml-1 w-4 h-4 rounded-full text-[10px] font-bold" style={{ background: '#FF4500', color: '#000' }}>{pendingReqs > 9 ? '9+' : pendingReqs}</span></>
                : label
              }
            </TabButton>
          ))}
        </div>

        {tab === 'competition' && <CompetitionTab />}
        {tab === 'operators'   && <OperatorsTab />}
        {tab === 'comms'       && <CommsTab />}
        {tab === 'settings'    && <SettingsTab />}
        {tab === 'teams'       && <TeamsTab />}
        {tab === 'archive'     && <ArchiveTab />}
      </div>

      <Footer />
    </div>
  )
}
