import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'
import Navbar from '../components/ui/Navbar'
import CCBanner from '../components/cc/CCBanner'
import Footer from '../components/ui/Footer'
import Scanlines from '../components/effects/Scanlines'
import GlitchText from '../components/effects/GlitchText'
import { usePlatformFormat } from '../hooks/usePlatformFormat'

const YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year']

const REQUEST_TYPES = [
  { value: 'ROLE_CHANGE',   label: 'ROLE CHANGE',   sub: 'Request a different operator role',    icon: '⬡' },
  { value: 'ACCOUNT_ISSUE', label: 'ACCOUNT ISSUE', sub: 'Report a problem with your account',  icon: '⚠' },
  { value: 'OTHER',         label: 'OTHER',          sub: 'Send a general message to Admin',      icon: '✉' },
]
const ROLE_OPTIONS = ['OPERATIVE', 'HANDLER', 'CONTRACTOR', 'ADMIN']
const STATUS_META = {
  PENDING:  { color: '#FF6B00', border: '1px solid #FF6B00' },
  APPROVED: { color: '#00FF88', border: '1px solid #00FF88' },
  DENIED:   { color: '#FF2D2D', border: '1px solid #FF2D2D' },
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m} minute${m !== 1 ? 's' : ''} ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h !== 1 ? 's' : ''} ago`
  return `${Math.floor(h / 24)} days ago`
}

function OperatorRequestsSection({ currentRole }) {
  const [reqType,   setReqType]   = useState(null)
  const [reqRole,   setReqRole]   = useState('')
  const [reason,    setReason]    = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState({ text: '', ok: true })
  const [requests,  setRequests]  = useState([])
  const [reqsLoading, setReqsLoading] = useState(true)
  const [cancelId,  setCancelId]  = useState(null)
  const [dailyUsed, setDailyUsed] = useState(0)

  async function loadRequests() {
    try {
      const r = await client.get('/requests/mine')
      setRequests(r.data)
    } catch { /* ignore */ }
    setReqsLoading(false)
  }

  useEffect(() => {
    loadRequests()
    // Mark notifications as read when user views their requests (Part G)
    client.post('/notifications/read-all').catch(() => {})
  }, [])

  async function submitRequest(e) {
    e.preventDefault()
    setSubmitting(true)
    setSubmitMsg({ text: '', ok: true })
    try {
      await client.post('/requests', {
        request_type:   reqType,
        reason:         reason.trim(),
        ...(reqType === 'ROLE_CHANGE' ? { requested_role: reqRole } : {}),
      })
      setReqType(null)
      setReqRole('')
      setReason('')
      setDailyUsed(d => d + 1)
      setSubmitMsg({ text: 'Request transmitted.', ok: true })
      await loadRequests()
    } catch (err) {
      const d = err.response?.data?.detail
      const msgs = {
        TRANSMISSION_LIMIT_REACHED: 'TRANSMISSION LIMIT REACHED — Max 5 requests per 24 hours.',
        TOO_MANY_OPEN_REQUESTS: 'TOO MANY OPEN REQUESTS — Resolve or cancel existing requests first.',
        PENDING_ROLE_CHANGE_EXISTS: 'You already have a pending ROLE CHANGE request. Cancel it to submit a new one.',
      }
      setSubmitMsg({ text: msgs[d] || (typeof d === 'string' ? d : 'Transmission failed.'), ok: false })
    } finally {
      setSubmitting(false)
      setTimeout(() => setSubmitMsg({ text: '', ok: true }), 6000)
    }
  }

  async function cancelRequest(id) {
    try {
      await client.delete(`/requests/${id}`)
      setCancelId(null)
      await loadRequests()
    } catch { /* ignore */ }
  }

  const hasPendingRoleChange = requests.some(r => r.request_type === 'ROLE_CHANGE' && r.status === 'PENDING')
  const reasonPlaceholder = reqType === 'ACCOUNT_ISSUE'
    ? 'Describe the issue with your account...'
    : reqType === 'OTHER'
    ? 'Type your message to the administrator...'
    : 'Explain why you need this role change...'

  return (
    <div className="border border-ghost/20 rounded-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-ghost/10 bg-abyss">
        <span className="font-mono text-xs text-ghost tracking-widest">OPERATOR REQUESTS</span>
      </div>
      <div className="px-5 py-5 space-y-6">
        <p className="font-mono text-[10px] text-ghost/60 tracking-wide">
          Submit a request to the DEADNET administrator.
        </p>

        {/* Type selector */}
        <div>
          <p className="font-mono text-[10px] text-ghost tracking-widest mb-3">SELECT REQUEST TYPE</p>
          <div className="grid sm:grid-cols-3 gap-3">
            {REQUEST_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => { setReqType(t.value); setReason(''); setReqRole('') }}
                style={{
                  background: reqType === t.value ? 'rgba(255,69,0,0.08)' : '#0A0A0F',
                  border: reqType === t.value ? '1px solid #FF4500' : '1px solid #2A2A42',
                }}
                className="text-left p-3 rounded-sm transition-all"
              >
                <span className="block font-mono text-base mb-1" style={{ color: reqType === t.value ? '#FF4500' : '#6B6B80' }}>{t.icon}</span>
                <span className="block font-mono text-xs text-bone tracking-widest">{t.label}</span>
                <span className="block font-mono text-[10px] text-ghost mt-1">{t.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Form — shown after type selected */}
        {reqType && (
          <form onSubmit={submitRequest} className="space-y-4">
            {reqType === 'ROLE_CHANGE' && (
              <div>
                <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">REQUESTED ROLE</label>
                <select
                  className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                  value={reqRole}
                  onChange={e => setReqRole(e.target.value)}
                  required
                >
                  <option value="">— select role —</option>
                  {ROLE_OPTIONS.map(r => (
                    <option key={r} value={r} disabled={r === currentRole}>{r}{r === currentRole ? ' (current)' : ''}</option>
                  ))}
                </select>
                {hasPendingRoleChange && (
                  <p className="font-mono text-[10px] text-flare mt-1">
                    You already have a pending ROLE CHANGE request. Cancel it to submit a new one.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">
                {reqType === 'ROLE_CHANGE' ? 'REASON FOR REQUEST' : 'DESCRIBE YOUR ISSUE / MESSAGE'}
              </label>
              <textarea
                rows={4}
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember resize-none"
                placeholder={reasonPlaceholder}
                value={reason}
                onChange={e => setReason(e.target.value.slice(0, 300))}
                required
                minLength={10}
              />
              <p className="font-mono text-[10px] text-ghost/40 text-right mt-0.5">{reason.length}/300</p>
            </div>

            {dailyUsed > 0 && (
              <p className="font-mono text-[10px] text-ghost/60">
                {dailyUsed} of 5 daily requests used
              </p>
            )}

            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={submitting || (reqType === 'ROLE_CHANGE' && hasPendingRoleChange)}
                className="font-mono text-xs text-void bg-ember hover:bg-flare disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2 rounded-sm tracking-widest transition-all font-bold"
              >
                {submitting ? 'TRANSMITTING...' : '[ TRANSMIT REQUEST ]'}
              </button>
              {submitMsg.text && (
                <span className={`font-mono text-xs ${submitMsg.ok ? 'text-success' : 'text-danger'}`}>{submitMsg.text}</span>
              )}
            </div>
          </form>
        )}

        {/* Transmission log */}
        <div>
          <p className="font-mono text-[10px] text-ghost tracking-widest mb-3">YOUR TRANSMISSION LOG</p>
          {reqsLoading ? (
            <p className="font-mono text-xs text-ghost animate-pulse">LOADING...</p>
          ) : requests.length === 0 ? (
            <p className="font-mono text-xs text-ghost text-center py-4">NO TRANSMISSIONS SENT</p>
          ) : (
            <div className="space-y-3">
              {requests.map(req => (
                <div
                  key={req.id}
                  style={{ background: '#0E0E1A', border: '1px solid #2A2A42' }}
                  className="rounded-sm p-3"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[10px] font-bold text-bone tracking-widest">
                        {req.request_type.replace('_', ' ')}
                        {req.requested_role ? ` → ${req.requested_role}` : ''}
                      </span>
                    </div>
                    <span
                      className="font-mono text-[10px] tracking-widest shrink-0 px-2 py-0.5 rounded-sm"
                      style={STATUS_META[req.status] || { color: '#6B6B80' }}
                    >
                      {req.status}
                    </span>
                  </div>

                  <p className="font-mono text-xs text-ghost/80 mb-1 leading-relaxed">{req.reason}</p>
                  <p className="font-mono text-[10px] text-ghost/40">Submitted: {timeAgo(req.created_at)}</p>

                  {(req.status === 'APPROVED' || req.status === 'DENIED') && req.admin_response && (
                    <p className="font-mono text-xs text-ghost/60 italic mt-2 border-t border-ghost/10 pt-2">
                      &gt; ADMIN: {req.admin_response}
                    </p>
                  )}

                  {req.status === 'PENDING' && (
                    cancelId === req.id ? (
                      <div className="flex items-center gap-3 mt-2">
                        <span className="font-mono text-[10px] text-ghost">Cancel this request?</span>
                        <button
                          onClick={() => cancelRequest(req.id)}
                          className="font-mono text-[10px] text-danger underline"
                        >CONFIRM</button>
                        <button
                          onClick={() => setCancelId(null)}
                          className="font-mono text-[10px] text-ghost underline"
                        >ABORT</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setCancelId(req.id)}
                        className="font-mono text-[10px] text-ghost/50 hover:text-ghost underline mt-2 block"
                      >[ CANCEL REQUEST ]</button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionBlock({ title, borderColor = 'border-ghost/20', children }) {
  return (
    <div className={`border ${borderColor} rounded-sm overflow-hidden`}>
      <div className="px-5 py-3 border-b border-ghost/10 bg-abyss">
        <span className="font-mono text-xs text-ghost tracking-widest">{title}</span>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">{label}</label>
      {children}
      {hint && <p className="font-mono text-[10px] text-ghost/50 mt-1">{hint}</p>}
    </div>
  )
}

function TextInput({ value, onChange, disabled, placeholder }) {
  return (
    <input
      className={`w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember disabled:opacity-40 disabled:cursor-not-allowed`}
      value={value ?? ''}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
    />
  )
}

export default function ProfileSettings() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { competition_start } = usePlatformFormat()

  const [profile, setProfile] = useState({
    username: '', full_name: '', student_id: '', school: '', section: '', year_level: '1st Year',
  })
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState({ text: '', ok: true })

  const [pwdForm, setPwdForm] = useState({ current_password: '', new_password: '', confirm: '' })
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdMsg, setPwdMsg] = useState({ text: '', ok: true })

  const [emailForm, setEmailForm] = useState({ new_email: '', current_password: '' })
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailMsg, setEmailMsg] = useState({ text: '', ok: true })

  const [revokeLoading, setRevokeLoading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState('')

  const competitionStarted = competition_start && Date.now() > new Date(competition_start).getTime()

  useEffect(() => {
    client.get('/operative/profile')
      .then(r => setProfile({
        username: r.data.username || '',
        full_name: r.data.full_name || '',
        student_id: r.data.student_id || '',
        school: r.data.school || '',
        section: r.data.section || '',
        year_level: r.data.year_level || '1st Year',
      }))
      .catch(() => {})
      .finally(() => setProfileLoading(false))
  }, [])

  async function saveIdentity(e) {
    e.preventDefault()
    setProfileSaving(true)
    setProfileMsg({ text: '', ok: true })
    try {
      await client.patch('/operative/profile', {
        username: profile.username,
        full_name: profile.full_name,
        school: profile.school,
        section: profile.section,
        year_level: profile.year_level,
      })
      // Refresh user in context if username changed
      const { data: me } = await client.get('/auth/me')
      localStorage.setItem('deadnet_user', JSON.stringify(me))
      setProfileMsg({ text: 'Identity updated.', ok: true })
    } catch (e) {
      const d = e.response?.data?.detail
      setProfileMsg({ text: d === 'CALLSIGN_TAKEN' ? 'Callsign already taken.' : (typeof d === 'string' ? d : 'Save failed.'), ok: false })
    } finally {
      setProfileSaving(false)
      setTimeout(() => setProfileMsg({ text: '', ok: true }), 4000)
    }
  }

  async function savePassword(e) {
    e.preventDefault()
    if (pwdForm.new_password !== pwdForm.confirm) {
      setPwdMsg({ text: 'Passphrases do not match.', ok: false })
      return
    }
    if (pwdForm.new_password.length < 8) {
      setPwdMsg({ text: 'New passphrase must be at least 8 characters.', ok: false })
      return
    }
    setPwdSaving(true)
    setPwdMsg({ text: '', ok: true })
    try {
      await client.post('/auth/change-password', {
        current_password: pwdForm.current_password,
        new_password: pwdForm.new_password,
      })
      setPwdForm({ current_password: '', new_password: '', confirm: '' })
      setPwdMsg({ text: 'Passphrase updated.', ok: true })
    } catch (e) {
      const d = e.response?.data?.detail
      setPwdMsg({ text: typeof d === 'string' ? d : 'Update failed.', ok: false })
    } finally {
      setPwdSaving(false)
      setTimeout(() => setPwdMsg({ text: '', ok: true }), 4000)
    }
  }

  async function revokeSessions() {
    setRevokeLoading(true)
    try {
      await client.post('/auth/revoke-sessions')
      await logout()
      navigate('/login')
    } catch {
      setRevokeLoading(false)
    }
  }

  async function deleteAccount() {
    setDeleteLoading(true)
    setDeleteMsg('')
    try {
      await client.delete('/auth/account')
      await logout()
      navigate('/')
    } catch (e) {
      const d = e.response?.data?.detail
      if (d === 'COMPETITION_STARTED_CANNOT_DELETE') {
        setDeleteMsg('Account deletion is disabled once the competition has started.')
      } else {
        setDeleteMsg(typeof d === 'string' ? d : 'Deletion failed.')
      }
      setDeleteLoading(false)
      setDeleteConfirm(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-void text-bone flex flex-col">
      <Scanlines />
      <Navbar />
      <CCBanner />

      <div className="relative z-10 flex-1 max-w-2xl mx-auto w-full px-4 py-8">
        <div className="mb-6">
          <p className="font-mono text-xs text-ghost tracking-widest mb-1">OPERATOR SETTINGS</p>
          <GlitchText as="h1" className="font-mono font-bold text-3xl text-ember tracking-widest">
            OPERATOR SETTINGS
          </GlitchText>
        </div>

        {profileLoading ? (
          <div className="font-mono text-xs text-ghost animate-pulse">LOADING PROFILE...</div>
        ) : (
          <div className="space-y-6">

            {/* IDENTITY */}
            <SectionBlock title="IDENTITY">
              <form onSubmit={saveIdentity} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="CALLSIGN (USERNAME)">
                    <TextInput value={profile.username} onChange={e => setProfile(p => ({ ...p, username: e.target.value }))} />
                  </Field>
                  <Field label="OPERATIVE NAME (FULL NAME)">
                    <TextInput value={profile.full_name} onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))} />
                  </Field>
                  <Field label="OPERATOR ID (STUDENT ID)" hint="Read-only after initial setup — contact admin to change">
                    <TextInput value={profile.student_id} disabled />
                  </Field>
                  <Field label="ORGANIZATION / UNIVERSITY">
                    <TextInput
                      value={profile.school}
                      onChange={e => setProfile(p => ({ ...p, school: e.target.value }))} 
                      placeholder=""
                    />
                  </Field>
                  <Field label="ASSIGNED UNIT" hint="TO BE DISPLAYED BESIDE YOUR TEAM NAME">
                    <TextInput value={profile.section} onChange={e => setProfile(p => ({ ...p, section: e.target.value }))} placeholder="e.g. LSPU SINILOAN" />
                  </Field>
                  <Field label="DEPLOYMENT CYCLE (YEAR LEVEL)">
                    <select
                      className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                      value={profile.year_level}
                      onChange={e => setProfile(p => ({ ...p, year_level: e.target.value }))}
                    >
                      {YEAR_LEVELS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="flex items-center gap-4 pt-1">
                  <button
                    type="submit"
                    disabled={profileSaving}
                    className="font-mono text-xs text-void bg-ember hover:bg-flare disabled:opacity-50 px-5 py-2 rounded-sm tracking-widest transition-all font-bold"
                  >
                    {profileSaving ? 'SAVING...' : 'SAVE IDENTITY'}
                  </button>
                  {profileMsg.text && (
                    <span className={`font-mono text-xs ${profileMsg.ok ? 'text-success' : 'text-danger'}`}>{profileMsg.text}</span>
                  )}
                </div>
              </form>
            </SectionBlock>

            {/* ACCOUNT SECURITY */}
            <SectionBlock title="ACCOUNT SECURITY">
              <div className="space-y-6">
                {/* Change password */}
                <form onSubmit={savePassword} className="space-y-4">
                  <p className="font-mono text-[10px] text-ghost tracking-widest">CHANGE PASSPHRASE</p>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <Field label="CURRENT PASSPHRASE">
                      <input
                        type="password"
                        className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                        value={pwdForm.current_password}
                        onChange={e => setPwdForm(f => ({ ...f, current_password: e.target.value }))}
                        autoComplete="current-password"
                      />
                    </Field>
                    <Field label="NEW PASSPHRASE">
                      <input
                        type="password"
                        className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                        value={pwdForm.new_password}
                        onChange={e => setPwdForm(f => ({ ...f, new_password: e.target.value }))}
                        autoComplete="new-password"
                      />
                    </Field>
                    <Field label="CONFIRM PASSPHRASE">
                      <input
                        type="password"
                        className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                        value={pwdForm.confirm}
                        onChange={e => setPwdForm(f => ({ ...f, confirm: e.target.value }))}
                        autoComplete="new-password"
                      />
                    </Field>
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      type="submit"
                      disabled={pwdSaving}
                      className="font-mono text-xs text-void bg-ember hover:bg-flare disabled:opacity-50 px-5 py-2 rounded-sm tracking-widest transition-all font-bold"
                    >
                      {pwdSaving ? 'UPDATING...' : 'UPDATE PASSPHRASE'}
                    </button>
                    {pwdMsg.text && (
                      <span className={`font-mono text-xs ${pwdMsg.ok ? 'text-success' : 'text-danger'}`}>{pwdMsg.text}</span>
                    )}
                  </div>
                </form>

                {/* Revoke sessions */}
                <div className="pt-4 border-t border-ghost/10">
                  <p className="font-mono text-[10px] text-ghost tracking-widest mb-2">ACTIVE SESSIONS</p>
                  <p className="font-mono text-xs text-ghost/60 mb-3">
                    Revoke all active sessions and sign out everywhere. You will be redirected to login.
                  </p>
                  <button
                    onClick={revokeSessions}
                    disabled={revokeLoading}
                    className="font-mono text-xs text-danger border border-danger/30 hover:border-danger disabled:opacity-50 px-4 py-2 rounded-sm tracking-widest transition-all"
                  >
                    {revokeLoading ? 'REVOKING...' : '[ REVOKE ALL SESSIONS ]'}
                  </button>
                </div>
              </div>
            </SectionBlock>

            {/* OPERATOR REQUESTS */}
            <OperatorRequestsSection currentRole={user?.role} />

            {/* DANGER ZONE */}
            <SectionBlock title="DANGER ZONE" borderColor="border-danger/30">
              <div>
                <p className="font-mono text-xs text-ghost mb-1">DELETE ACCOUNT</p>
                <p className="font-mono text-[10px] text-ghost/50 mb-4 leading-relaxed">
                  Permanently deletes your account and all associated data. This action cannot be undone.
                  {competitionStarted && (
                    <span className="block mt-1 text-danger/80">Account deletion is disabled after competition starts.</span>
                  )}
                </p>

                {!deleteConfirm ? (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    disabled={competitionStarted}
                    className="font-mono text-xs text-danger border border-danger/30 hover:border-danger disabled:opacity-30 disabled:cursor-not-allowed px-4 py-2 rounded-sm tracking-widest transition-all"
                  >
                    [ DELETE ACCOUNT ]
                  </button>
                ) : (
                  <div className="space-y-3">
                    <p className="font-mono text-xs text-danger tracking-widest">
                      ⚠ ARE YOU SURE? THIS CANNOT BE UNDONE.
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => { setDeleteConfirm(false); setDeleteMsg('') }}
                        className="font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-4 py-2 rounded-sm tracking-widest transition-all"
                      >
                        CANCEL
                      </button>
                      <button
                        onClick={deleteAccount}
                        disabled={deleteLoading}
                        className="font-mono text-xs text-void bg-danger hover:bg-danger/80 disabled:opacity-50 px-4 py-2 rounded-sm tracking-widest transition-all font-bold"
                      >
                        {deleteLoading ? 'DELETING...' : 'CONFIRM DELETE'}
                      </button>
                    </div>
                    {deleteMsg && <p className="font-mono text-[10px] text-danger">{deleteMsg}</p>}
                  </div>
                )}
              </div>
            </SectionBlock>

          </div>
        )}
      </div>

      <Footer />
    </div>
  )
}
