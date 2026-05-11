import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Scanlines from '../components/effects/Scanlines'
import Footer from '../components/ui/Footer'
import client from '../api/client'

const ROLE_HOME = {
  ARCHITECT:  '/architect/dashboard',
  ADMIN:      '/admin/dashboard',
  CONTRACTOR: '/contractor/dashboard',
  HANDLER: '/handler/dashboard',
  OPERATIVE:  '/operative/dashboard',
}

const PENDING_TOKEN_KEY = 'deadnet_pending_token'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { loginWithTokens } = useAuth()

  const [status, setStatus] = useState('loading') // loading | success | pending | error
  const [callsign, setCallsign] = useState('')
  const [resendEmail, setResendEmail] = useState('')
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState('')
  const [resendSent, setResendSent] = useState(false)

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) { navigate('/login'); return }

    client.get(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = r.data
        // CONTRACTOR/HANDLER pending approval flow
        if (data.status === 'PENDING_APPROVAL' && data.pending_token) {
          localStorage.setItem(PENDING_TOKEN_KEY, data.pending_token)
          setStatus('pending')
          setTimeout(() => navigate('/pending-approval'), 2500)
          return
        }
        if (data.status === 'ACTIVE') {
          // Already approved — go to login
          setStatus('success')
          setCallsign('')
          setTimeout(() => navigate('/login'), 2500)
          return
        }
        // Normal flow — got full JWT
        const user = await loginWithTokens(data.access_token, data.refresh_token)
        setCallsign(user.username || data.username || '')
        setStatus('success')
        setTimeout(() => {
          if (user._needsOnboarding) {
            if (user.role === 'CONTRACTOR' || user.role === 'HANDLER') navigate('/staff-onboarding')
            else navigate('/onboarding')
          } else navigate(ROLE_HOME[user.role] || '/')
        }, 2500)
      })
      .catch(() => setStatus('error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleResend = async () => {
    if (!resendEmail.includes('@')) return
    setResending(true)
    setResendMsg('')
    try {
      await client.post('/auth/resend-verification', { email: resendEmail })
      setResendSent(true)
      setResendMsg('> NEW LINK DISPATCHED. CHECK YOUR INBOX.')
    } catch {
      setResendMsg('> RESEND FAILED. TRY AGAIN LATER.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-void flex flex-col overflow-hidden">
      <Scanlines />
      <div
        className="absolute inset-0 opacity-15 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(255,69,0,0.2) 0%, transparent 60%)' }}
      />

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="relative z-10 w-full max-w-md bg-abyss border border-ghost/20 rounded-sm p-8">

          {status === 'loading' && (
            <div className="font-mono text-sm space-y-2">
              <p className="text-ghost">&gt; VERIFYING SIGNAL<span className="animate-pulse">_</span></p>
            </div>
          )}

          {status === 'success' && (
            <div className="font-mono text-sm space-y-2">
              <p className="text-success font-bold">&gt; IDENTITY CONFIRMED</p>
              <p className="text-success font-bold">&gt; OPERATOR STATUS: ACTIVE</p>
              {callsign && (
                <p className="text-bone">&gt; WELCOME TO DEADNET, <span className="text-ember font-bold">{callsign.toUpperCase()}</span></p>
              )}
              <p className="text-ghost/60 mt-4">&gt; REDIRECTING...</p>
            </div>
          )}

          {status === 'pending' && (
            <div className="font-mono text-sm space-y-2">
              <p className="text-ember font-bold">&gt; IDENTITY VERIFIED</p>
              <p className="text-ember font-bold">&gt; REQUEST SUBMITTED</p>
              <p className="text-ghost">&gt; Transmitting to administrator for review...</p>
              <p className="text-ghost/60 mt-4">&gt; REDIRECTING...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="font-mono text-sm space-y-3">
              <p className="text-danger font-bold">&gt; VERIFICATION FAILED</p>
              <p className="text-danger font-bold">&gt; SIGNAL CORRUPTED OR EXPIRED</p>
              <p className="text-ghost/60 mt-2">The link may have expired (24h limit) or already been used.</p>
              {!resendSent ? (
                <div className="mt-4 space-y-2">
                  <p className="text-ghost text-xs tracking-widest">REQUEST A NEW LINK:</p>
                  <input
                    type="email"
                    value={resendEmail}
                    onChange={e => setResendEmail(e.target.value)}
                    placeholder="your registered email"
                    className="w-full bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-2 font-mono text-sm text-bone outline-none transition-all"
                    onKeyDown={e => e.key === 'Enter' && handleResend()}
                    autoFocus
                  />
                  <button
                    onClick={handleResend}
                    disabled={resending || !resendEmail.includes('@')}
                    className="font-mono text-xs text-ghost border border-ghost/30 hover:border-ember hover:text-ember px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
                  >
                    {resending ? '...' : '[ DISPATCH NEW LINK ]'}
                  </button>
                  {resendMsg && (
                    <p className="font-mono text-[10px] text-danger">{resendMsg}</p>
                  )}
                </div>
              ) : (
                <p className="font-mono text-xs text-success mt-2">{resendMsg}</p>
              )}
              <Link
                to="/login"
                className="font-mono text-xs text-ember hover:text-flare tracking-widest transition-colors block mt-2"
              >
                → RETURN TO LOGIN
              </Link>
            </div>
          )}

        </div>
      </div>
      <Footer />
    </div>
  )
}
