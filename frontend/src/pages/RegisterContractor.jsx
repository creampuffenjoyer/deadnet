import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import GlitchText from '../components/effects/GlitchText'
import Scanlines from '../components/effects/Scanlines'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import Footer from '../components/ui/Footer'
import client from '../api/client'

const CONTRACTOR_REASONS = [
  'I am a course handler managing this competition',
  'I am a faculty member overseeing student activity',
  'I am the competition organizer / event coordinator',
  'I am a system administrator for this deployment',
  'I am an handler from another organization / campus',
  'Other',
]

const HANDLER_REASONS = [
  'I am a coach mentoring competing students',
  'I am a team adviser guiding a team',
  'I am a competition coach from another organization / campus',
  'I am a faculty coach overseeing student competitors',
  'Other',
]

function StrengthBar({ password }) {
  const checks = [
    password.length >= 8,
    /[a-zA-Z]/.test(password),
    /[0-9]/.test(password),
    password.length >= 12,
  ]
  const score = checks.filter(Boolean).length
  const color = score <= 1 ? '#FF2D2D' : score === 2 ? '#FF6B00' : score === 3 ? '#FFB800' : '#00FF88'
  return (
    <div className="flex gap-1 mt-1">
      {checks.map((ok, i) => (
        <div key={i} className="h-1 flex-1 rounded-full transition-all"
             style={{ background: i < score ? color : '#2A2A42' }} />
      ))}
    </div>
  )
}

function ReasonSelect({ options, choice, onChoose, otherValue, onOtherChange, error }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (opt) => {
    onChoose(opt)
    setOpen(false)
  }

  return (
    <div ref={ref} className="flex flex-col gap-2">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-3 font-mono text-xs tracking-wide flex items-center justify-between"
        style={{
          background: '#0A0A0F',
          border: `1px solid ${error ? '#FF2D2D' : choice ? '#FF4500' : '#2A2A42'}`,
          borderLeft: `3px solid ${error ? '#FF2D2D' : choice ? '#FF4500' : '#2A2A42'}`,
          color: choice ? '#E8E8F0' : '#6B6B85',
          borderRadius: '2px',
          transition: 'border-color 0.15s',
        }}
      >
        <span>{choice || '— select a reason —'}</span>
        <span
          style={{
            display: 'inline-block',
            transition: 'transform 0.2s ease',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            color: choice ? '#FF4500' : '#3A3A52',
            fontSize: '14px',
            flexShrink: 0,
            marginLeft: '8px',
          }}
        >›</span>
      </button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col gap-1"
            style={{
              background: '#0D0D18',
              border: '1px solid #2A2A42',
              borderRadius: '2px',
              padding: '6px',
            }}
          >
            {options.map((opt) => {
              const isActive = choice === opt
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => select(opt)}
                  className="w-full text-left px-3 py-2 font-mono text-xs tracking-wide transition-colors"
                  style={{
                    background: isActive ? 'rgba(255,69,0,0.08)' : 'transparent',
                    border: `1px solid ${isActive ? '#FF4500' : 'transparent'}`,
                    borderLeft: `2px solid ${isActive ? '#FF4500' : 'transparent'}`,
                    color: isActive ? '#E8E8F0' : '#6B6B85',
                    borderRadius: '2px',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'rgba(255,69,0,0.04)'
                      e.currentTarget.style.color = '#A0A0B0'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = '#6B6B85'
                    }
                  }}
                >
                  <span style={{ color: isActive ? '#FF4500' : '#3A3A52', marginRight: '8px' }}>›</span>
                  {opt}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Other textarea */}
      <AnimatePresence>
        {choice === 'Other' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <textarea
              rows={3}
              className={`w-full bg-void border rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none resize-y transition-colors ${
                error ? 'border-danger' : 'border-ghost/30 focus:border-ember'
              }`}
              placeholder="Describe your role and why you need access..."
              value={otherValue}
              onChange={onOtherChange}
              maxLength={300}
              autoFocus
            />
            <div className="flex items-center justify-between mt-1">
              {error
                ? <span className="font-mono text-[10px] text-danger">{error}</span>
                : <span />}
              <span className="font-mono text-[10px] text-ghost/40">{otherValue.length}/300</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && choice !== 'Other' && (
        <span className="font-mono text-[10px] text-danger">{error}</span>
      )}
    </div>
  )
}

function StaffRegisterPage({ role }) {
  const navigate = useNavigate()
  const isSuper = role === 'contractor'
  const roleLabel = isSuper ? 'CONTRACTOR' : 'HANDLER'
  const reasons  = isSuper ? CONTRACTOR_REASONS : HANDLER_REASONS
  const btnLabel = isSuper ? '[ REQUEST CONTRACTOR ACCESS ]' : '[ REQUEST HANDLER ACCESS ]'

  const [form, setForm] = useState({
    callsign: '', email: '', password: '', confirm: '',
    full_name: '', org_id: '',
    reason_choice: '', reason_other: '',
  })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [organizations, setOrganizations] = useState([])

  useEffect(() => {
    client.get('/public/organizations').then(r => setOrganizations(r.data)).catch(() => {})
  }, [])

  const set = (field) => (e) => {
    setForm(f => ({ ...f, [field]: e.target.value }))
    setErrors(p => ({ ...p, [field]: '' }))
  }

  const chooseReason = (opt) => {
    setForm(f => ({ ...f, reason_choice: opt, reason_other: '' }))
    setErrors(p => ({ ...p, reason: '' }))
  }

  const canSubmit =
    form.reason_choice &&
    (form.reason_choice !== 'Other' || form.reason_other.trim().length >= 20)

  const validate = () => {
    const errs = {}
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(form.callsign))
      errs.callsign = 'Letters, numbers, underscore only (3–20 chars)'
    if (!form.email.includes('@')) errs.email = 'Enter a valid email address'
    if (form.password.length < 8) errs.password = 'Password must be at least 8 characters'
    if (!/[a-zA-Z]/.test(form.password)) errs.password = 'Password must include a letter'
    if (!/[0-9]/.test(form.password)) errs.password = 'Password must include a number'
    if (form.password !== form.confirm) errs.confirm = 'Passwords do not match'
    if (!form.full_name.trim()) errs.full_name = 'Full name is required'
    if (organizations.length > 0 && !form.org_id) errs.org_id = 'Please select your organization'
    if (!form.reason_choice) {
      errs.reason = 'Please select a reason for access'
    } else if (form.reason_choice === 'Other' && form.reason_other.trim().length < 20) {
      errs.reason = 'Please describe your role (min 20 characters)'
    }
    return errs
  }

  const resolvedReason = () =>
    form.reason_choice === 'Other' ? form.reason_other.trim() : form.reason_choice

  const handleSubmit = async (e) => {
    e.preventDefault()
    setServerError('')
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setLoading(true)
    try {
      await client.post(`/auth/register/${role}`, {
        callsign: form.callsign,
        email: form.email,
        password: form.password,
        full_name: form.full_name,
        org_id: form.org_id ? parseInt(form.org_id) : undefined,
        reason: resolvedReason(),
      })
      setSubmitted(true)
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (detail === 'CALLSIGN_TAKEN') setErrors({ callsign: 'Callsign already taken' })
      else if (detail === 'CALLSIGN_INVALID') setErrors({ callsign: 'Invalid callsign format' })
      else if (detail === 'PASSWORD_TOO_SHORT') setErrors({ password: 'Password too short' })
      else if (detail === 'PASSWORD_NEEDS_LETTER') setErrors({ password: 'Password must include a letter' })
      else if (detail === 'PASSWORD_NEEDS_NUMBER') setErrors({ password: 'Password must include a number' })
      else setServerError('Registration failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const background = (
    <div className="absolute inset-0 opacity-10 pointer-events-none"
         style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(255,69,0,0.15) 0%, transparent 60%)' }} />
  )

  if (submitted) {
    return (
      <div className="relative min-h-screen bg-void flex flex-col overflow-hidden">
        <Scanlines />
        {background}
        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                      className="relative z-10 w-full max-w-md">
            <div className="bg-abyss border border-ember/30 rounded-sm p-8">
              <div className="font-mono text-sm space-y-2 mb-6">
                <p className="text-ember font-bold">&gt; REQUEST TRANSMITTED</p>
                <p className="text-ember font-bold">&gt; VERIFICATION REQUIRED</p>
                <p className="text-ghost">&gt; A verification signal has been dispatched</p>
                <p className="text-ghost">&gt; Check your inbox and click the link</p>
                <p className="text-ghost">&gt; to submit your {roleLabel} request</p>
                <p className="text-ghost">&gt; for administrator review.</p>
                <p className="text-ghost/60">&gt; Link expires in 24 hours.</p>
              </div>
              <Link to="/login"
                    className="font-mono text-xs text-ember hover:text-flare transition-colors tracking-widest">
                ← Return to Login
              </Link>
            </div>
          </motion.div>
        </div>
        <Footer />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-void flex flex-col overflow-hidden">
      <Scanlines />
      {background}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="relative z-10 w-full max-w-md">
          <div className="text-center mb-8">
            <Link to="/register" className="font-mono text-xs text-ghost hover:text-ember tracking-widest uppercase transition-colors">
              ← Return to Operative Registration
            </Link>
            <GlitchText as="h1"
                        className="font-mono font-bold text-3xl text-ember neon-ember-text mt-4 tracking-widest">
              {roleLabel} ENLISTMENT
            </GlitchText>
            <p className="font-mono text-xs text-ghost mt-2 tracking-wide">
              {roleLabel.charAt(0) + roleLabel.slice(1).toLowerCase()} accounts require administrator approval before access is granted.
            </p>
          </div>

          <div className="bg-abyss border border-ghost/20 rounded-sm p-8">
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <Input label="CALLSIGN" placeholder="your_callsign"
                     value={form.callsign} onChange={set('callsign')}
                     error={errors.callsign} autoComplete="username" required />
              <Input label="EMAIL ADDRESS" type="email" placeholder="you@institution.edu"
                     value={form.email} onChange={set('email')}
                     error={errors.email} autoComplete="email" required />
              <div>
                <Input label="PASSWORD" type="password" placeholder="min. 8 characters"
                       value={form.password} onChange={set('password')}
                       error={errors.password} autoComplete="new-password" required />
                {form.password && <StrengthBar password={form.password} />}
              </div>
              <Input label="CONFIRM PASSWORD" type="password" placeholder="repeat password"
                     value={form.confirm} onChange={set('confirm')}
                     error={errors.confirm} autoComplete="new-password" required />

              <div className="mt-1">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-ghost/20" />
                  <span className="font-mono text-[10px] text-ghost tracking-widest whitespace-nowrap">
                    IDENTITY VERIFICATION
                  </span>
                  <div className="flex-1 h-px bg-ghost/20" />
                </div>
                <div className="flex flex-col gap-5">
                  <Input label="FULL NAME" placeholder="Your name"
                         value={form.full_name} onChange={set('full_name')}
                         error={errors.full_name} required />
                  <div>
                    <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">
                      ORGANIZATION / INSTITUTION{organizations.length > 0 ? ' *' : ''}
                    </label>
                    {organizations.length > 0 ? (
                      <select
                        className={`w-full bg-void border rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember transition-colors ${errors.org_id ? 'border-danger' : 'border-ghost/20'}`}
                        value={form.org_id}
                        onChange={e => { setForm(f => ({ ...f, org_id: e.target.value })); setErrors(p => ({ ...p, org_id: '' })) }}
                      >
                        <option value="">— select your organization —</option>
                        {organizations.map(u => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="font-mono text-xs text-ghost/50 italic py-2">
                        No organizations configured yet.
                      </p>
                    )}
                    {errors.org_id && (
                      <span className="font-mono text-[10px] text-danger">{errors.org_id}</span>
                    )}
                  </div>
                  <div>
                    <label className="font-mono text-[10px] text-ghost tracking-widest block mb-2">
                      REASON FOR ACCESS REQUEST
                    </label>
                    <ReasonSelect
                      options={reasons}
                      choice={form.reason_choice}
                      onChoose={chooseReason}
                      otherValue={form.reason_other}
                      onOtherChange={e => {
                        setForm(f => ({ ...f, reason_other: e.target.value }))
                        setErrors(p => ({ ...p, reason: '' }))
                      }}
                      error={errors.reason}
                    />
                  </div>
                </div>
              </div>

              {serverError && (
                <div className="border border-danger/30 bg-danger/10 rounded-sm px-4 py-2">
                  <span className="font-mono text-xs text-danger">{serverError}</span>
                </div>
              )}

              <Button
                type="submit"
                loading={loading}
                disabled={!canSubmit || loading}
                className="w-full mt-2"
              >
                {btnLabel}
              </Button>
            </form>
          </div>
        </motion.div>
      </div>
      <Footer />
    </div>
  )
}

export default function RegisterContractor() {
  return <StaffRegisterPage role="contractor" />
}
