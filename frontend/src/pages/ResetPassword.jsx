import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import Scanlines from '../components/effects/Scanlines'
import Footer from '../components/ui/Footer'
import client from '../api/client'

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

  const label = ['', 'WEAK', 'FAIR', 'STRONG', 'STRONG'][score]
  const color  = ['bg-ghost/20', 'bg-danger', 'bg-flare', 'bg-success', 'bg-success'][score]
  const width  = ['w-0', 'w-1/4', 'w-2/4', 'w-3/4', 'w-full'][score]
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

// ── Main page ────────────────────────────────────────────────────────────────
export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const token = searchParams.get('token')

  const [form, setForm] = useState({ password: '', confirm: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!token) navigate('/login')
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) { setError('Passphrases do not match.'); return }
    if (form.password.length < 8) { setError('Passphrase must be at least 8 characters.'); return }
    if (!/[a-zA-Z]/.test(form.password)) { setError('Passphrase must contain at least one letter.'); return }
    if (!/[0-9]/.test(form.password)) { setError('Passphrase must contain at least one number.'); return }

    setLoading(true)
    try {
      await client.post('/auth/reset-password', {
        token,
        new_password: form.password,
        confirm_password: form.confirm,
      })
      setSuccess(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (detail === 'INVALID_OR_EXPIRED') setError('Reset link is invalid or expired. Request a new one from the login page.')
      else if (detail === 'PASSWORDS_DO_NOT_MATCH') setError('Passphrases do not match.')
      else if (detail === 'PASSWORD_TOO_SHORT') setError('Passphrase must be at least 8 characters.')
      else if (detail === 'PASSWORD_NEEDS_LETTER') setError('Passphrase must contain at least one letter.')
      else if (detail === 'PASSWORD_NEEDS_NUMBER') setError('Passphrase must contain at least one number.')
      else setError('Reset failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

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
            <p className="font-mono text-xs text-ghost mt-2 tracking-widest">SET NEW PASS CODE</p>
          </div>

          <div className="bg-abyss border border-ghost/20 rounded-sm p-8">
            {success ? (
              <div className="font-mono text-sm space-y-2">
                <p className="text-success font-bold">&gt; PASS CODE UPDATED</p>
                <p className="text-success font-bold">&gt; ALL ACTIVE SESSIONS TERMINATED</p>
                <p className="text-ghost/60">&gt; REDIRECTING TO LOGIN...</p>
              </div>
            ) : (
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
                    placeholder="repeat passphrase"
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
                  disabled={loading}
                  className="w-full font-mono text-sm font-bold text-bone bg-ember/80 hover:bg-ember border border-ember px-4 py-3 rounded-sm tracking-widest transition-all disabled:opacity-50 mt-2"
                >
                  {loading ? '...' : '[ SET NEW PASS CODE ]'}
                </button>
              </form>
            )}

            {!success && (
              <div className="mt-6 pt-5 border-t border-ghost/10 text-center">
                <Link to="/login" className="font-mono text-xs text-ghost hover:text-ember tracking-widest transition-colors">
                  → RETURN TO LOGIN
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}
