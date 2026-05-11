import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'
import Scanlines from '../components/effects/Scanlines'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'

// Capability card icons (simple SVG)
const Icon = ({ d }) => (
  <svg className="w-5 h-5 mb-3" viewBox="0 0 20 20" fill="none" stroke="currentColor"
       strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

const CONTRACTOR_CARDS = [
  {
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    title: 'CONTRACT MANAGEMENT',
    body: 'Create, publish, and manage contracts for the competition.',
  },
  {
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    title: 'EMERGENCY CONTRACTS',
    body: 'Deploy time-limited surprise contracts with random BC rewards.',
  },
  {
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    title: 'COMPETITION CONTROL',
    body: 'Monitor competition progress and manage the bounty board.',
  },
]

const HANDLER_CARDS = [
  {
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    title: 'MONITOR OPERATIVES',
    body: 'View all registered operatives and their competition progress.',
  },
  {
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    title: 'CONTRACT VISIBILITY',
    body: 'View all contracts and solve statistics during the competition.',
  },
  {
    icon: 'M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12',
    title: 'BOUNTY BOARD ACCESS',
    body: 'Monitor live rankings and competition statistics.',
  },
]

// ── Step 1: Profile completion ───────────────────────────────────────────────
function ProfileStep({ user, onNext }) {
  const isSuper = user.role === 'CONTRACTOR'
  const [form, setForm] = useState({
    full_name: user.full_name || '',
    department: '',
    employee_id: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))

  const handleNext = async () => {
    if (!form.full_name.trim()) { setError('Full name is required.'); return }
    setLoading(true)
    try {
      await client.patch('/shared/staff-profile', {
        full_name: form.full_name.trim(),
        department: form.department.trim() || undefined,
        employee_id: form.employee_id.trim() || undefined,
      })
      onNext()
    } catch {
      setError('Failed to save profile. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div key="step1" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.3 }}
                className="relative z-10 w-full max-w-md">
      <div className="text-center mb-8">
        <p className="font-mono text-xs text-ember tracking-[0.3em] mb-2">
          {isSuper ? 'SYSTEM ACCESS AUTHORIZED' : 'OBSERVER ACCESS GRANTED'}
        </p>
        <h1 className="font-mono font-bold text-2xl text-bone tracking-widest">
          COMPLETE YOUR PROFILE
        </h1>
        <p className="font-mono text-xs text-ghost mt-2">
          {isSuper
            ? 'Complete your operator profile to begin managing the competition.'
            : 'Complete your observer profile to begin monitoring operatives.'}
        </p>
      </div>

      <div className="bg-abyss border border-ghost/20 rounded-sm p-8 flex flex-col gap-5">
        <Input label="FULL NAME" placeholder="Your legal name"
               value={form.full_name} onChange={set('full_name')} required />
        <Input label="DEPARTMENT / FACULTY" placeholder="e.g. College of Computing"
               value={form.department} onChange={set('department')} />
        <Input label="EMPLOYEE / FACULTY ID" placeholder="Your staff ID"
               value={form.employee_id} onChange={set('employee_id')} />

        {error && (
          <p className="font-mono text-xs text-danger">{error}</p>
        )}

        <Button onClick={handleNext} loading={loading} className="w-full mt-2">
          [ PROCEED ]
        </Button>
      </div>
    </motion.div>
  )
}

// ── Step 2: Role briefing ────────────────────────────────────────────────────
function BriefingStep({ user, onEnter }) {
  const isSuper = user.role === 'CONTRACTOR'
  const cards = isSuper ? CONTRACTOR_CARDS : HANDLER_CARDS
  const [hoveredIdx, setHoveredIdx] = useState(null)
  const [loading, setLoading] = useState(false)

  return (
    <motion.div key="step2" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.3 }}
                className="relative z-10 w-full max-w-lg">
      <div className="text-center mb-8">
        <p className="font-mono text-xs text-ember tracking-[0.3em] mb-2">
          {isSuper ? 'CONTRACTOR CLEARANCE' : 'HANDLER CLEARANCE'}
        </p>
        <h1 className="font-mono font-bold text-2xl text-bone tracking-widest">
          YOUR CAPABILITIES
        </h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {cards.map((card, i) => (
          <div
            key={i}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            style={{
              background: '#0E0E1A',
              border: `1px solid ${hoveredIdx === i ? 'rgba(255,69,0,0.4)' : '#2A2A42'}`,
              borderLeft: `2px solid ${hoveredIdx === i ? '#FF4500' : '#2A2A42'}`,
              transition: 'border-color 0.2s',
              padding: '20px',
            }}
          >
            <div style={{ color: hoveredIdx === i ? '#FF6B00' : '#6B6B85' }}>
              <Icon d={card.icon} />
            </div>
            <p className="font-mono text-xs text-bone tracking-widest mb-2">{card.title}</p>
            <p className="font-mono text-[11px] text-ghost leading-relaxed">{card.body}</p>
          </div>
        ))}
      </div>

      <Button
        onClick={() => { setLoading(true); onEnter() }}
        loading={loading}
        className="w-full"
      >
        [ ENTER DEADNET ]
      </Button>
    </motion.div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function StaffOnboarding() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)

  const handleEnter = async () => {
    try {
      await client.post('/shared/staff-complete-onboarding')
    } catch { /* best effort */ }
    // Update local user state
    try {
      const { data: me } = await client.get('/auth/me')
      localStorage.setItem('deadnet_user', JSON.stringify(me))
      setUser(me)
    } catch { /* ignore */ }
    const dest = user?.role === 'CONTRACTOR' ? '/contractor/dashboard' : '/handler/dashboard'
    navigate(dest, { replace: true })
  }

  return (
    <div className="relative min-h-screen bg-void flex flex-col items-center justify-center px-4 py-12 overflow-hidden">
      <Scanlines />
      <div className="absolute inset-0 opacity-10 pointer-events-none"
           style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(255,69,0,0.15) 0%, transparent 60%)' }} />

      <AnimatePresence mode="wait">
        {step === 1 ? (
          <ProfileStep key="s1" user={user || {}} onNext={() => setStep(2)} />
        ) : (
          <BriefingStep key="s2" user={user || {}} onEnter={handleEnter} />
        )}
      </AnimatePresence>
    </div>
  )
}
