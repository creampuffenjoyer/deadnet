import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import GlitchText from '../components/effects/GlitchText'
import Scanlines from '../components/effects/Scanlines'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import Footer from '../components/ui/Footer'
import client from '../api/client'

// ── Post-registration success screen ────────────────────────────────────────
function SuccessScreen({ email }) {
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState('')

  const handleResend = async () => {
    setResending(true)
    setResendMsg('')
    try {
      await client.post('/auth/resend-verification', { email })
      setResendMsg('> NEW LINK DISPATCHED.')
    } catch {
      setResendMsg('> RESEND FAILED. TRY AGAIN LATER.')
    } finally {
      setResending(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative z-10 w-full max-w-md"
    >
      <div className="bg-abyss border border-ember/30 rounded-sm p-8">
        <div className="font-mono text-sm space-y-2 mb-6">
          <p className="text-ember font-bold">&gt; ENLISTMENT RECEIVED</p>
          <p className="text-ember font-bold">&gt; VERIFICATION REQUIRED</p>
          <p className="text-ghost">&gt; A verification signal has been dispatched</p>
          <p className="text-ghost">&gt; To <span className="text-bone">{email}</span></p>
          <p className="text-ghost">&gt; Check your inbox and click the link</p>
          <p className="text-ghost">&gt; To activate your operator account.</p>
          <p className="text-ghost/60">&gt; Link expires in 24 hours.</p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-ghost">Didn&apos;t receive it?</span>
            <button
              onClick={handleResend}
              disabled={resending}
              className="font-mono text-xs text-ghost border border-ghost/30 hover:border-ember hover:text-ember px-3 py-1 rounded-sm tracking-widest transition-all disabled:opacity-50"
            >
              {resending ? '...' : '[ RESEND ]'}
            </button>
          </div>
          {resendMsg && (
            <p className="font-mono text-xs text-success">{resendMsg}</p>
          )}
          <div>
            <span className="font-mono text-xs text-ghost">Already verified? </span>
            <Link to="/login" className="font-mono text-xs text-ember hover:text-flare transition-colors tracking-widest">
              [ ACCESS DEADNET ]
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── Main register page ───────────────────────────────────────────────────────
export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState('')

  useEffect(() => {
    client.get('/public/settings')
      .then((r) => setRegistrationOpen(r.data.registration_open))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true))
  }, [])

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }))
    setErrors((prev) => ({ ...prev, [field]: '' }))
    setServerError('')
  }

  const validate = () => {
    const errs = {}
    if (form.username.length < 3) errs.username = 'Callsign must be at least 3 characters'
    if (!/^[a-zA-Z0-9_\-]+$/.test(form.username)) errs.username = 'Letters, numbers, _ and - only'
    if (!form.email.includes('@')) errs.email = 'Enter a valid email address'
    if (form.password.length < 8) errs.password = 'Passphrase must be at least 8 characters'
    if (form.password !== form.confirm) errs.confirm = 'Passphrases do not match'
    return errs
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setServerError('')
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setLoading(true)
    try {
      await register(form.username, form.email, form.password)
      setRegisteredEmail(form.email)
      setRegistered(true)
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (detail === 'ENLISTMENT_CLOSED') setServerError('Enlistment is currently closed.')
      else if (detail === 'CALLSIGN_TAKEN') setErrors({ username: 'Callsign already taken' })
      else setServerError('Enlistment failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const background = (
    <div
      className="absolute inset-0 opacity-15 pointer-events-none"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(255,69,0,0.2) 0%, transparent 60%)' }}
    />
  )

  if (registered) {
    return (
      <div className="relative min-h-screen bg-void flex flex-col overflow-hidden">
        <Scanlines />
        {background}
        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <SuccessScreen email={registeredEmail} />
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
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="text-center mb-8">
          <Link to="/" className="font-mono text-xs text-ghost hover:text-ember tracking-widest uppercase transition-colors">
            ← DEADNET
          </Link>
          <GlitchText
            as="h1"
            className="font-mono font-bold text-4xl text-ember neon-ember-text mt-4 tracking-widest"
          >
            ENLIST AS AN OPERATIVE
          </GlitchText>
          <p className="font-mono text-xs text-ghost mt-2 tracking-widest">
            CHOOSE YOUR CALLSIGN. ENTER THE NETWORK.
          </p>
        </div>

        <div className="bg-abyss border border-ghost/20 rounded-sm p-8">
          {settingsLoaded && !registrationOpen ? (
            <div className="text-center py-4 flex flex-col gap-4">
              <div className="border border-danger/40 bg-danger/10 rounded-sm px-6 py-4">
                <p className="font-mono font-bold text-danger text-sm tracking-widest">
                  ENLISTMENT CLOSED
                </p>
                <p className="font-mono text-xs text-ghost mt-2">
                  The enlistment window is not currently active.
                  Contact your Contractor or check back later.
                </p>
              </div>
              <Link to="/login" className="font-mono text-xs text-ember hover:text-flare transition-colors">
                Already enlisted? ACCESS DEADNET →
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <Input
                label="CALLSIGN"
                placeholder="your_callsign"
                value={form.username}
                onChange={set('username')}
                error={errors.username}
                autoComplete="username"
                required
              />
              <Input
                label="EMAIL"
                type="email"
                placeholder="operative@grid.net"
                value={form.email}
                onChange={set('email')}
                error={errors.email}
                autoComplete="email"
                required
              />
              <Input
                label="PASSPHRASE"
                type="password"
                placeholder="min. 8 characters"
                value={form.password}
                onChange={set('password')}
                error={errors.password}
                autoComplete="new-password"
                required
              />
              <Input
                label="CONFIRM PASSPHRASE"
                type="password"
                placeholder="repeat passphrase"
                value={form.confirm}
                onChange={set('confirm')}
                error={errors.confirm}
                autoComplete="new-password"
                required
              />

              {serverError && (
                <div className="border border-danger/30 bg-danger/10 rounded-sm px-4 py-2">
                  <span className="font-mono text-xs text-danger tracking-wide">
                    ⚠ {serverError}
                  </span>
                </div>
              )}

              <Button type="submit" loading={loading} className="w-full mt-2">
                [ ENLIST AS AN OPERATIVE ]
              </Button>
            </form>
          )}

          <div className="mt-6 pt-5 border-t border-ghost/10 text-center">
            <span className="font-mono text-xs text-ghost">
              ALREADY ENLISTED?{' '}
              <Link to="/login" className="text-ember hover:text-flare transition-colors">
                ACCESS DEADNET →
              </Link>
            </span>
          </div>
        </div>

        {/* Not a Operative? */}
        <div className="mt-6 pt-5 border-t border-ghost/10 text-center space-y-3">
          <p className="font-mono text-[11px] text-ghost tracking-widest">Not a Operative?</p>
          <div className="flex gap-3 justify-center">
            <Link
              to="/register/contractor"
              className="font-mono text-[10px] tracking-widest px-4 py-2 border border-ghost/30 text-ghost hover:border-ember/50 hover:text-bone transition-all"
            >
              Enlist as Contractor
            </Link>
            <Link
              to="/register/handler"
              className="font-mono text-[10px] tracking-widest px-4 py-2 border border-ghost/30 text-ghost hover:border-ember/50 hover:text-bone transition-all"
            >
              Enlist as Handler
            </Link>
          </div>
        </div>
      </motion.div>
      </div>
      <Footer />
    </div>
  )
}
