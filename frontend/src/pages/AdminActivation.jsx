import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Scanlines from '../components/effects/Scanlines'
import Footer from '../components/ui/Footer'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'

// ── Password strength bar ────────────────────────────────────────────────────
function StrengthBar({ password }) {
  const score = (() => {
    if (!password) return 0
    let s = 0
    if (password.length >= 8)  s++
    if (password.length >= 12) s++
    if (/[a-zA-Z]/.test(password) && /[0-9]/.test(password)) s++
    if (/[^a-zA-Z0-9]/.test(password)) s++
    return s
  })()
  const label     = ['', 'WEAK', 'FAIR', 'STRONG', 'STRONG'][score]
  const color     = ['bg-ghost/20', 'bg-danger', 'bg-flare', 'bg-success', 'bg-success'][score]
  const width     = ['w-0', 'w-1/4', 'w-2/4', 'w-3/4', 'w-full'][score]
  const textColor = ['text-ghost', 'text-danger', 'text-flare', 'text-success', 'text-success'][score]
  if (!password) return null
  return (
    <div className="mt-1.5">
      <div className="h-1 bg-ghost/10 rounded-full overflow-hidden">
        <div className={`h-full transition-all duration-300 ${color} ${width}`} />
      </div>
      <p className={`font-mono text-[10px] tracking-widest mt-0.5 ${textColor}`}>{label}</p>
    </div>
  )
}

// ── Timed terminal line reveal ───────────────────────────────────────────────
function TerminalLines({ lines, onDone, delayMs = 350 }) {
  const [visible, setVisible] = useState(0)

  useEffect(() => {
    setVisible(0)
  }, [lines])

  useEffect(() => {
    if (visible < lines.length) {
      const t = setTimeout(() => setVisible(v => v + 1), delayMs)
      return () => clearTimeout(t)
    } else if (onDone && lines.length > 0) {
      const t = setTimeout(onDone, 200)
      return () => clearTimeout(t)
    }
  }, [visible, lines.length, onDone, delayMs])

  return (
    <div className="font-mono text-sm space-y-1.5">
      {lines.slice(0, visible).map((line, i) => (
        <p key={i} className={line.color || 'text-ghost/70'}>{line.text}</p>
      ))}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function AdminActivation() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { loginWithTokens } = useAuth()

  const token = searchParams.get('token')

  // phase: 'loading' | 'invalid' | 'form' | 'success'
  const [phase, setPhase]         = useState('loading')
  const [userData, setUserData]   = useState(null)   // { callsign, organization_name }
  const [linesReady, setLinesReady] = useState(false)
  const [form, setForm]           = useState({ password: '', confirm: '' })
  const [error, setError]         = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Validate token on mount
  useEffect(() => {
    if (!token) { setPhase('invalid'); return }
    client.get(`/auth/validate-invite?token=${encodeURIComponent(token)}`)
      .then(({ data }) => {
        setUserData({ callsign: data.callsign, organization_name: data.organization_name })
        setPhase('form')
      })
      .catch(() => setPhase('invalid'))
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) { setError('Access codes do not match.'); return }
    if (form.password.length < 8) { setError('Must be at least 8 characters.'); return }
    if (!/[a-zA-Z]/.test(form.password)) { setError('Must contain at least one letter.'); return }
    if (!/[0-9]/.test(form.password)) { setError('Must contain at least one number.'); return }

    setSubmitting(true)
    try {
      const { data } = await client.post('/auth/activate-admin', {
        token,
        new_password: form.password,
        confirm_password: form.confirm,
      })
      await loginWithTokens(data.access_token, data.refresh_token)
      setPhase('success')
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (detail === 'INVALID_OR_EXPIRED')
        setError('Activation link is invalid or expired. Contact the platform architect for a new invitation.')
      else if (detail === 'PASSWORDS_DO_NOT_MATCH') setError('Access codes do not match.')
      else if (detail === 'PASSWORD_TOO_SHORT')     setError('Must be at least 8 characters.')
      else if (detail === 'PASSWORD_NEEDS_LETTER')  setError('Must contain at least one letter.')
      else if (detail === 'PASSWORD_NEEDS_NUMBER')  setError('Must contain at least one number.')
      else setError('Activation failed. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const introLines = userData ? [
    { text: '> TOKEN VERIFIED',                                   color: 'text-success' },
    { text: `> ORGANIZATION: ${userData.organization_name || 'UNKNOWN'}`, color: 'text-bone' },
    { text: `> CALLSIGN: ${userData.callsign}`,                   color: 'text-bone' },
    { text: '> SET YOUR PASS CODE TO ACTIVATE',                 color: 'text-ghost/70' },
  ] : []

  const successLines = [
    { text: '> PASS CODE SET',              color: 'text-success' },
    { text: '> ADMIN ACCOUNT ACTIVATED',      color: 'text-success' },
    { text: `> ORGANIZATION: ${userData?.organization_name || ''}`, color: 'text-bone' },
    { text: '> REDIRECTING TO ADMIN CONSOLE...', color: 'text-ghost/60' },
  ]

  return (
    <div className="relative min-h-screen bg-void flex flex-col overflow-hidden">
      <Scanlines />
      <div
        className="absolute inset-0 opacity-15 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(255,69,0,0.2) 0%, transparent 60%)' }}
      />

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="relative z-10 w-full max-w-md">

          <div className="text-center mb-8">
            <p className="font-mono font-bold text-4xl text-ember tracking-widest">DEADNET</p>
            <p className="font-mono text-xs text-ghost mt-2 tracking-widest">ADMIN ACCOUNT ACTIVATION</p>
          </div>

          <div className="bg-abyss border border-ghost/20 rounded-sm p-8">

            {/* Loading */}
            {phase === 'loading' && (
              <p className="font-mono text-sm text-ghost/60 animate-pulse">&gt; VALIDATING TOKEN...</p>
            )}

            {/* Invalid */}
            {phase === 'invalid' && (
              <div className="font-mono text-sm space-y-3">
                <p className="text-danger font-bold">&gt; ACTIVATION LINK INVALID OR EXPIRED</p>
                <p className="text-ghost/60">&gt; Contact the platform architect to request a new invitation.</p>
              </div>
            )}

            {/* Form — intro lines then password form */}
            {phase === 'form' && (
              <>
                <div className="mb-6">
                  <TerminalLines
                    lines={introLines}
                    onDone={() => setLinesReady(true)}
                  />
                </div>

                {linesReady && (
                  <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                    <div>
                      <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">
                        NEW PASS CODE
                      </label>
                      <input
                        type="password"
                        value={form.password}
                        onChange={set('password')}
                        placeholder="min. 8 characters"
                        autoComplete="new-password"
                        required
                        className="w-full bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-2.5 font-mono text-sm text-bone outline-none transition-all"
                      />
                      <StrengthBar password={form.password} />
                    </div>

                    <div>
                      <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">
                        CONFIRM PASS CODE
                      </label>
                      <input
                        type="password"
                        value={form.confirm}
                        onChange={set('confirm')}
                        placeholder="repeat pass code"
                        autoComplete="new-password"
                        required
                        className="w-full bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-2.5 font-mono text-sm text-bone outline-none transition-all"
                      />
                    </div>

                    {error && (
                      <div className="border border-danger/30 bg-danger/10 rounded-sm px-4 py-2">
                        <span className="font-mono text-xs text-danger tracking-wide">⚠ {error}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full font-mono text-sm font-bold text-bone bg-ember/80 hover:bg-ember border border-ember px-4 py-3 rounded-sm tracking-widest transition-all disabled:opacity-50 mt-2"
                    >
                      {submitting ? '...' : '[ ACTIVATE ACCOUNT ]'}
                    </button>
                  </form>
                )}
              </>
            )}

            {/* Success terminal animation */}
            {phase === 'success' && (
              <TerminalLines
                lines={successLines}
                onDone={() => navigate('/admin')}
                delayMs={500}
              />
            )}

          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
