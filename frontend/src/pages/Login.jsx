import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import GlitchText from '../components/effects/GlitchText'
import Scanlines from '../components/effects/Scanlines'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import Footer from '../components/ui/Footer'
import client from '../api/client'

const ROLE_HOME = {
  ARCHITECT:  '/architect/dashboard',
  ADMIN:      '/admin/dashboard',
  CONTRACTOR: '/contractor/dashboard',
  HANDLER: '/handler/dashboard',
  OPERATIVE:  '/operative/dashboard',
}

// ── Forgot password modal ────────────────────────────────────────────────────
function ForgotModal({ onClose }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleDispatch = async () => {
    if (!email.includes('@')) return
    setLoading(true)
    try {
      await client.post('/auth/forgot-password', { email })
    } catch { /* always show success */ }
    finally {
      setLoading(false)
      setSent(true)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-void/80" onClick={onClose} />

      <motion.div
        className="relative z-10 w-full max-w-sm bg-abyss border border-ghost/30 rounded-sm p-6"
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 8, opacity: 0 }}
      >
        {!sent ? (
          <>
            <p className="font-mono text-xs text-ember tracking-widest mb-4">
              DISPATCH RESET LINK
            </p>
            <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">
              ENTER YOUR REGISTERED EMAIL
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="operative@grid.net"
              className="w-full bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-2 font-mono text-sm text-bone outline-none transition-all mb-4"
              onKeyDown={e => e.key === 'Enter' && handleDispatch()}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={handleDispatch}
                disabled={loading || !email.includes('@')}
                className="flex-1 font-mono text-xs text-bone bg-ember/80 hover:bg-ember border border-ember px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
              >
                {loading ? '...' : '[ DISPATCH RESET LINK ]'}
              </button>
              <button
                onClick={onClose}
                className="font-mono text-xs text-ghost border border-ghost/30 hover:border-ghost px-4 py-2 rounded-sm tracking-widest transition-all"
              >
                [ ABORT ]
              </button>
            </div>
          </>
        ) : (
          <div className="font-mono text-sm space-y-2">
            <p className="text-success font-bold">&gt; RESET SIGNAL DISPATCHED</p>
            <p className="text-ghost">&gt; Check your inbox. Expires in 1 hour.</p>
            <button
              onClick={onClose}
              className="mt-4 font-mono text-xs text-ghost border border-ghost/30 hover:border-ember hover:text-ember px-4 py-2 rounded-sm tracking-widest transition-all"
            >
              [ CLOSE ]
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ── Main login page ──────────────────────────────────────────────────────────
export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [unverifiedEmail, setUnverifiedEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [resendEmail, setResendEmail] = useState('')
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState('')

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setUnverifiedEmail('')
    setResendMsg('')
    setLoading(true)
    try {
      const user = await login(form.username, form.password)
      if (user._needsOnboarding) {
        if (user.role === 'CONTRACTOR' || user.role === 'HANDLER') {
          navigate('/staff-onboarding')
        } else {
          navigate('/onboarding')
        }
      } else {
        navigate(ROLE_HOME[user.role] || '/')
      }
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (detail === 'Invalid credentials') setError('Invalid callsign or passphrase.')
      else if (detail === 'Account suspended') setError('Account suspended. Contact Admin.')
      else if (detail === 'EMAIL_NOT_VERIFIED') {
        setError('Account unverified — check your inbox.')
        setUnverifiedEmail('')  // will ask for email in resend UI
      }
      else if (detail === 'PENDING_APPROVAL') setError('PENDING_APPROVAL')
      else if (detail === 'ACCOUNT_DENIED') setError('ACCOUNT_DENIED')
      else setError('Connection failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (!resendEmail.includes('@')) return
    setResending(true)
    setResendMsg('')
    try {
      await client.post('/auth/resend-verification', { email: resendEmail })
      setResendMsg('> NEW LINK DISPATCHED.')
    } catch {
      setResendMsg('> RESEND FAILED. TRY AGAIN LATER.')
    } finally {
      setResending(false)
    }
  }

  const isUnverified = error === 'Account unverified — check your inbox.'
  const isPendingApproval = error === 'PENDING_APPROVAL'
  const isAccountDenied = error === 'ACCOUNT_DENIED'

  return (
    <>
      <AnimatePresence>
        {showForgot && <ForgotModal onClose={() => setShowForgot(false)} />}
      </AnimatePresence>

      <div className="relative min-h-screen bg-void flex flex-col overflow-hidden">
        <Scanlines />

        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(255,69,0,0.2) 0%, transparent 60%)' }}
        />

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
              ACCESS DEADNET
            </GlitchText>
            <p className="font-mono text-xs text-ghost mt-2 tracking-widest">
              IDENTIFY YOURSELF, OPERATIVE
            </p>
          </div>

          <div className="bg-abyss border border-ghost/20 rounded-sm p-8">
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <Input
                label="CALLSIGN"
                placeholder="your_callsign"
                value={form.username}
                onChange={set('username')}
                autoComplete="username"
                required
              />
              <div>
                <Input
                  label="PASSPHRASE"
                  type="password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={set('password')}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowForgot(true)}
                  className="mt-1.5 font-mono text-[10px] text-ghost hover:text-ember tracking-widest transition-colors"
                >
                  [ FORGOT PASS CODE? ]
                </button>
              </div>

              {error && (
                <div className={`border rounded-sm px-4 py-3 space-y-2 ${
                  isPendingApproval
                    ? 'border-flare/30 bg-flare/5'
                    : 'border-danger/30 bg-danger/10'
                }`}>
                  {isPendingApproval ? (
                    <div className="font-mono text-xs space-y-1">
                      <p className="text-flare tracking-wide">Account pending administrator approval.</p>
                      <p className="text-ghost/70">You will be notified by email once approved.</p>
                    </div>
                  ) : isAccountDenied ? (
                    <span className="font-mono text-xs text-danger tracking-wide block">
                      Registration request was not approved. Contact your administrator.
                    </span>
                  ) : (
                    <span className="font-mono text-xs text-danger tracking-wide block">
                      {error}
                    </span>
                  )}
                  {isUnverified && (
                    <div className="pt-1 space-y-2">
                      <input
                        type="email"
                        value={resendEmail}
                        onChange={e => setResendEmail(e.target.value)}
                        placeholder="your email address"
                        className="w-full bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-1.5 font-mono text-xs text-bone outline-none transition-all"
                      />
                      <button
                        type="button"
                        onClick={handleResend}
                        disabled={resending || !resendEmail.includes('@')}
                        className="font-mono text-[10px] text-ghost border border-ghost/30 hover:border-ember hover:text-ember px-3 py-1 rounded-sm tracking-widest transition-all disabled:opacity-50"
                      >
                        {resending ? '...' : '[ RESEND VERIFICATION ]'}
                      </button>
                      {resendMsg && (
                        <p className="font-mono text-[10px] text-success">{resendMsg}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <Button type="submit" loading={loading} className="w-full mt-2">
                [ ACCESS DEADNET ]
              </Button>
            </form>

            <div className="mt-6 pt-5 border-t border-ghost/10 text-center">
              <span className="font-mono text-xs text-ghost">
                NOT ENLISTED?{' '}
                <Link to="/register" className="text-ember hover:text-flare transition-colors">
                  ENLIST AS AN OPERATIVE →
                </Link>
              </span>
            </div>
          </div>
        </motion.div>
        </div>
        <Footer />
      </div>
    </>
  )
}
