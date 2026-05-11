import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'
import Scanlines from '../components/effects/Scanlines'

// ── Capability cards shown in Step 2 ─────────────────────────────────────────
const CAPABILITY_CARDS = (organizationName) => [
  {
    title: 'EVENT MANAGEMENT',
    body: 'Create and manage competition events for your organization.',
  },
  {
    title: 'OPERATOR MANAGEMENT',
    body: 'Manage Operative, Contractor and Handler accounts for your organization.',
  },
  {
    title: 'COMPETITION OVERSIGHT',
    body: 'Monitor live competition, view stats, and export results for your adviser.',
  },
  {
    title: 'SCOPED ACCESS',
    body: `You manage ${organizationName || 'your organization'} only. Your data is fully isolated from other organizations.`,
  },
]

// ── Step 1 — Complete your profile ───────────────────────────────────────────
function ProfileStep({ organizationName, userEmail, onDone }) {
  const [form, setForm]   = useState({ fullName: '', position: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.fullName.trim()) { setError('Full name is required.'); return }

    setSaving(true)
    try {
      await client.patch('/shared/admin-profile', {
        full_name: form.fullName.trim(),
        position: form.position.trim() || null,
      })
      onDone()
    } catch {
      setError('Failed to save profile. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="relative z-10 w-full max-w-lg">

        <div className="mb-10">
          <h1 className="font-mono font-bold text-3xl text-bone tracking-widest">
            ADMIN ACCESS AUTHORIZED
          </h1>
          <p className="font-mono text-sm text-ghost mt-2">
            Complete your administrator profile for{' '}
            <span className="text-ember">{organizationName || '…'}</span>
          </p>
        </div>

        <div className="bg-abyss border border-ghost/20 rounded-sm p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">

            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">
                FULL NAME *
              </label>
              <input
                type="text"
                value={form.fullName}
                onChange={set('fullName')}
                placeholder="e.g. Juan dela Cruz"
                autoFocus
                required
                className="w-full bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-2.5 font-mono text-sm text-bone outline-none transition-all"
              />
            </div>

            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">
                POSITION / TITLE
              </label>
              <input
                type="text"
                value={form.position}
                onChange={set('position')}
                placeholder="e.g. Faculty Member, IT Administrator"
                className="w-full bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-2.5 font-mono text-sm text-bone outline-none transition-all"
              />
            </div>

            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">
                CONTACT EMAIL
              </label>
              <input
                type="text"
                value={userEmail}
                disabled
                className="w-full bg-void/50 border border-ghost/15 rounded-sm px-3 py-2.5 font-mono text-sm text-ghost outline-none cursor-not-allowed"
              />
              <p className="font-mono text-[10px] text-ghost/40 mt-1">
                To change your email, update it in account settings after setup.
              </p>
            </div>

            {error && (
              <div className="border border-danger/30 bg-danger/10 rounded-sm px-4 py-2">
                <span className="font-mono text-xs text-danger tracking-wide">⚠ {error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full font-mono text-sm font-bold text-bone bg-ember/80 hover:bg-ember border border-ember px-4 py-3 rounded-sm tracking-widest transition-all disabled:opacity-50 mt-2"
            >
              {saving ? '...' : '[ PROCEED ]'}
            </button>
          </form>
        </div>

      </div>
    </div>
  )
}

// ── Step 2 — Admin briefing ───────────────────────────────────────────────────
function BriefingStep({ organizationName, onDone }) {
  const [completing, setCompleting] = useState(false)
  const cards = CAPABILITY_CARDS(organizationName)

  const handleEnter = async () => {
    setCompleting(true)
    try {
      await client.post('/shared/admin-complete-onboarding')
    } catch {
      // Non-fatal — proceed anyway
    }
    onDone()
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="relative z-10 w-full max-w-2xl">

        <div className="mb-10">
          <h1 className="font-mono font-bold text-3xl text-bone tracking-widest">
            ADMIN CLEARANCE
          </h1>
          <p className="font-mono text-sm text-ghost mt-2">
            Your responsibilities for{' '}
            <span className="text-ember">{organizationName || '…'}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {cards.map((card) => (
            <div
              key={card.title}
              className="bg-abyss border border-ghost/20 rounded-sm p-5"
            >
              <p className="font-mono text-xs font-bold text-ember tracking-widest mb-2">
                {card.title}
              </p>
              <p className="font-mono text-sm text-ghost/80 leading-relaxed">
                {card.body}
              </p>
            </div>
          ))}
        </div>

        <button
          onClick={handleEnter}
          disabled={completing}
          className="w-full font-mono text-sm font-bold text-bone bg-ember/80 hover:bg-ember border border-ember px-4 py-3 rounded-sm tracking-widest transition-all disabled:opacity-50"
        >
          {completing ? '...' : '[ ENTER ADMIN CONSOLE ]'}
        </button>

      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminOnboarding() {
  const navigate = useNavigate()
  const { user, setUser } = useAuth()

  const [step, setStep]                 = useState(1)
  const [organizationName, setOrganizationName] = useState('')

  useEffect(() => {
    // If already onboarded, redirect to dashboard
    if (user && user.onboarding_complete) {
      navigate('/admin', { replace: true })
      return
    }
    // Fetch organization name
    client.get('/admin/organization')
      .then(({ data }) => setOrganizationName(data.name))
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleStep1Done = () => setStep(2)

  const handleStep2Done = () => {
    // Update local user state so re-entry check works
    if (user) {
      const updated = { ...user, onboarding_complete: true }
      setUser(updated)
      localStorage.setItem('deadnet_user', JSON.stringify(updated))
    }
    navigate('/admin', { replace: true })
  }

  return (
    <div className="relative min-h-screen bg-void flex flex-col overflow-hidden">
      <Scanlines />
      <div
        className="absolute inset-0 opacity-15 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(255,69,0,0.2) 0%, transparent 60%)' }}
      />

      {/* Step indicator */}
      <div className="relative z-10 flex justify-center pt-8 gap-3">
        {[1, 2].map((n) => (
          <div
            key={n}
            className={`w-8 h-1 rounded-full transition-all ${
              step >= n ? 'bg-ember' : 'bg-ghost/20'
            }`}
          />
        ))}
      </div>

      {step === 1 && (
        <ProfileStep
          organizationName={organizationName}
          userEmail={user?.email || ''}
          onDone={handleStep1Done}
        />
      )}

      {step === 2 && (
        <BriefingStep
          organizationName={organizationName}
          onDone={handleStep2Done}
        />
      )}
    </div>
  )
}
