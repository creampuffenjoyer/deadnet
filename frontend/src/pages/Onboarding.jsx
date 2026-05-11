import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'
import Scanlines from '../components/effects/Scanlines'

// ---------------------------------------------------------------------------
// Organization select component (shared by DossierStep)
// ---------------------------------------------------------------------------
function OrganizationSelect({ organizations, value, onChange, error }) {
  if (organizations === null) return null  // still loading
  return (
    <div>
      <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">
        INSTITUTION{organizations.length > 0 ? ' *' : ''}
      </label>
      {organizations.length > 0 ? (
        <select
          className={`w-full bg-void border rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember transition-colors ${error ? 'border-danger' : 'border-ghost/20'}`}
          value={value}
          onChange={onChange}
        >
          <option value="">— select your organization —</option>
          {organizations.map(u => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      ) : (
        <p className="font-mono text-xs text-ghost/50 italic py-2">No organizations configured yet.</p>
      )}
      {error && <p className="font-mono text-[10px] text-danger mt-1">{error}</p>}
    </div>
  )
}

const YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year']

// ---------------------------------------------------------------------------
// Step 1 — Terminal boot animation
// ---------------------------------------------------------------------------
const BOOT_LINES = (callsign) => [
  '> CONNECTING TO DEADNET...',
  '> ESTABLISHING ENCRYPTED TUNNEL...',
  `> IDENTITY VERIFIED: ${callsign}`,
  '> CLEARANCE LEVEL: NOVICE',
  '> OPERATOR DOSSIER: INCOMPLETE',
  '> ACTION REQUIRED: COMPLETE OPERATOR PROFILE',
  '> ...',
]

function TerminalStep({ callsign, onNext }) {
  const [lines, setLines] = useState([])
  const [done, setDone] = useState(false)

  useEffect(() => {
    const all = BOOT_LINES(callsign)
    let i = 0
    const id = setInterval(() => {
      setLines(prev => [...prev, all[i]])
      i++
      if (i >= all.length) {
        clearInterval(id)
        setTimeout(() => setDone(true), 600)
      }
    }, 420)
    return () => clearInterval(id)
  }, [callsign])

  return (
    <div
      className="min-h-screen bg-void flex flex-col items-center justify-center px-6 cursor-pointer"
      onClick={() => done && onNext()}
    >
      <Scanlines />
      <div className="relative z-10 w-full max-w-xl">
        <div className="bg-abyss border border-ghost/20 rounded-sm p-8 font-mono text-sm text-success">
          {lines.map((line, i) => (
            <div key={i} className="leading-loose">
              <span className={i === lines.length - 1 && !done ? 'after:content-["▋"] after:animate-pulse' : ''}>{line}</span>
            </div>
          ))}
          {done && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-6 font-mono text-xs text-ghost tracking-widest text-center"
            >
              CLICK OR PRESS ANY KEY TO CONTINUE →
            </motion.p>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Dossier form
// ---------------------------------------------------------------------------
function DossierStep({ onNext }) {
  const [form, setForm] = useState({ full_name: '', student_id: '', org_id: '', section: '', year_level: '1st Year' })
  const [errors, setErrors] = useState({})
  const [organizations, setOrganizations] = useState(null)

  useEffect(() => {
    client.get('/public/organizations').then(r => setOrganizations(r.data)).catch(() => setOrganizations([]))
  }, [])

  const set = (k) => (e) => {
    setForm(f => ({ ...f, [k]: e.target.value }))
    setErrors(prev => ({ ...prev, [k]: '' }))
  }

  function validate() {
    const errs = {}
    if (!form.full_name.trim()) errs.full_name = 'Required'
    if (!form.student_id.trim()) errs.student_id = 'Required'
    if (organizations && organizations.length > 0 && !form.org_id) errs.org_id = 'Required'
    if (!form.section.trim()) errs.section = 'Required'
    return errs
  }

  function submit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    const payload = { ...form }
    if (payload.org_id) payload.org_id = parseInt(payload.org_id)
    else delete payload.org_id
    onNext(payload)
  }

  return (
    <div className="min-h-screen bg-void flex flex-col items-center justify-center px-6">
      <Scanlines />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="text-center mb-8">
          <p className="font-mono text-[10px] text-ghost tracking-widest mb-1">STEP 2 OF 4</p>
          <h1 className="font-mono font-bold text-3xl text-ember tracking-widest">COMPLETE YOUR DOSSIER</h1>
          <p className="font-mono text-xs text-ghost mt-2 tracking-widest">FILL IN YOUR OPERATOR FILE</p>
        </div>

        <div className="bg-abyss border border-ember/30 rounded-sm" style={{ borderTop: '3px solid #FF4500' }}>
          <div className="px-6 py-3 border-b border-ghost/10">
            <p className="font-mono text-[10px] text-ghost tracking-widest">CLASSIFIED — OPERATOR PROFILE</p>
          </div>
          <form onSubmit={submit} className="px-6 py-6 space-y-5">
            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">OPERATIVE NAME *</label>
              <input
                className={`w-full bg-void border ${errors.full_name ? 'border-danger' : 'border-ghost/20'} rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember`}
                placeholder="Full legal name"
                value={form.full_name}
                onChange={set('full_name')}
              />
              {errors.full_name && <p className="font-mono text-[10px] text-danger mt-1">{errors.full_name}</p>}
            </div>

            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">OPERATOR ID *</label>
              <input
                className={`w-full bg-void border ${errors.student_id ? 'border-danger' : 'border-ghost/20'} rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember`}
                placeholder="Student ID number"
                value={form.student_id}
                onChange={set('student_id')}
              />
              {errors.student_id && <p className="font-mono text-[10px] text-danger mt-1">{errors.student_id}</p>}
            </div>

            <OrganizationSelect
              organizations={organizations}
              value={form.org_id}
              onChange={set('org_id')}
              error={errors.org_id}
            />

            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">ASSIGNED UNIT *</label>
              <input
                className={`w-full bg-void border ${errors.section ? 'border-danger' : 'border-ghost/20'} rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember`}
                placeholder="e.g. BSCS 4A"
                value={form.section}
                onChange={set('section')}
              />
              {errors.section && <p className="font-mono text-[10px] text-danger mt-1">{errors.section}</p>}
            </div>

            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">DEPLOYMENT CYCLE</label>
              <select
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                value={form.year_level}
                onChange={set('year_level')}
              >
                {YEAR_LEVELS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <button
              type="submit"
              className="w-full font-mono text-sm text-void bg-ember hover:bg-flare px-6 py-3 rounded-sm tracking-widest transition-all font-bold mt-2"
            >
              [ SUBMIT DOSSIER ]
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Team selection
// ---------------------------------------------------------------------------
function TeamStep({ onNext }) {
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')

  function joinTeam(e) {
    e.preventDefault()
    if (!inviteCode.trim()) { setError('Enter an invite code.'); return }
    onNext(inviteCode.trim().toUpperCase())
  }

  return (
    <div className="min-h-screen bg-void flex flex-col items-center justify-center px-6">
      <Scanlines />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 w-full max-w-2xl"
      >
        <div className="text-center mb-8">
          <p className="font-mono text-[10px] text-ghost tracking-widest mb-1">STEP 3 OF 4</p>
          <h1 className="font-mono font-bold text-3xl text-ember tracking-widest">TEAM SELECTION</h1>
          <p className="font-mono text-xs text-ghost mt-2 tracking-widest">
            Teams pool intel and split bounty rankings. Choose wisely, Operative.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Join team */}
          <div className="bg-abyss border border-ghost/20 hover:border-ember/40 rounded-sm p-6 transition-colors">
            <h2 className="font-mono font-bold text-lg text-ember tracking-widest mb-2">JOIN A TEAM</h2>
            <p className="font-mono text-xs text-ghost mb-5">Join your crew and share the bounties.</p>
            <form onSubmit={joinTeam} className="space-y-3">
              <input
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember uppercase tracking-widest placeholder:normal-case"
                placeholder="Invite code..."
                value={inviteCode}
                onChange={e => { setInviteCode(e.target.value); setError('') }}
              />
              {error && <p className="font-mono text-[10px] text-danger">{error}</p>}
              <button
                type="submit"
                className="w-full font-mono text-xs text-void bg-ember hover:bg-flare px-4 py-2 rounded-sm tracking-widest transition-all font-bold"
              >
                [ JOIN TEAM ]
              </button>
            </form>
          </div>

          {/* Operate solo */}
          <div className="bg-abyss border border-ghost/20 hover:border-ghost/40 rounded-sm p-6 transition-colors flex flex-col justify-between">
            <div>
              <h2 className="font-mono font-bold text-lg text-bone tracking-widest mb-2">OPERATE SOLO</h2>
              <p className="font-mono text-xs text-ghost mb-2">Go dark. No Team. No split.</p>
              <p className="font-mono text-[10px] text-ghost/50">You can join a Team later.</p>
            </div>
            <button
              onClick={() => onNext(null)}
              className="w-full font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost hover:text-bone px-4 py-2 rounded-sm tracking-widest transition-all mt-5"
            >
              [ OPERATE SOLO ]
            </button>
          </div>
        </div>

        <p className="text-center font-mono text-xs text-ember mt-4 tracking-widest">— OR —</p>
      </motion.div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — Mission briefing
// ---------------------------------------------------------------------------
const BRIEFING_CARDS = [
  {
    title: 'CONTRACTS',
    icon: '⊕',
    body: 'Contracts are hacking challenges. Claim them by submitting the correct flag. Harder contracts = more BC.',
  },
  {
    title: 'BOUNTY CREDITS',
    icon: '◈',
    body: 'BC is your score. Earn it by claiming contracts. Claim early for maximum payout — bounties decay after first blood.',
  },
  {
    title: 'INTEL DROPS',
    icon: '⧖',
    body: 'Stuck? Visit THE BROKER. Purchase intel drops for BC. Flavor-text hints from a shady contact. Spend wisely.',
  },
  {
    title: 'CLEARANCE LEVELS',
    icon: '▲',
    body: 'Earn BC to rank up: NOVICE → GHOST → PHANTOM → SPECTER → HACKER. Your level shows next to your callsign.',
  },
]

function BriefingStep({ onEnter, loading }) {
  return (
    <div className="min-h-screen bg-void flex flex-col items-center justify-center px-6 py-12">
      <Scanlines />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 w-full max-w-2xl"
      >
        <div className="text-center mb-8">
          <p className="font-mono text-[10px] text-ghost tracking-widest mb-1">STEP 4 OF 4</p>
          <h1 className="font-mono font-bold text-3xl text-ember tracking-widest">MISSION BRIEFING</h1>
          <p className="font-mono text-xs text-ghost mt-2 tracking-widest">OPERATIONAL PARAMETERS</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          {BRIEFING_CARDS.map(card => (
            <div key={card.title} className="bg-abyss border border-ghost/20 rounded-sm p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-ember text-lg">{card.icon}</span>
                <span className="font-mono font-bold text-sm text-ember tracking-widest">{card.title}</span>
              </div>
              <p className="font-mono text-xs text-ghost leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>

        <button
          onClick={onEnter}
          disabled={loading}
          className="w-full font-mono text-lg font-bold text-void bg-ember hover:bg-flare disabled:opacity-50 px-6 py-4 rounded-sm tracking-widest transition-all"
        >
          {loading ? 'INITIALIZING...' : '[ ENTER DEADNET ]'}
        </button>
      </motion.div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Onboarding controller
// ---------------------------------------------------------------------------
export default function Onboarding() {
  const { user, setUser, login } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [dossier, setDossier] = useState(null)
  const [inviteCode, setInviteCode] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // If already onboarded, skip
  useEffect(() => {
    if (user?.onboarding_complete) navigate('/contracts', { replace: true })
  }, [user, navigate])

  function handleTerminalNext() {
    setStep(2)
  }

  function handleDossierNext(data) {
    setDossier(data)
    setStep(3)
  }

  function handleTeamNext(code) {
    setInviteCode(code)
    setStep(4)
  }

  async function handleEnterDeadnet() {
    setLoading(true)
    setError('')
    try {
      await client.post('/operative/complete-onboarding', {
        ...dossier,
        invite_code: inviteCode,
      })
      // Refresh user data in context so onboarding_complete is immediately visible
      const { data: me } = await client.get('/auth/me')
      localStorage.setItem('deadnet_user', JSON.stringify(me))
      setUser(me)
      navigate('/contracts', { replace: true })
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to complete onboarding.')
      setLoading(false)
    }
  }

  return (
    <AnimatePresence mode="wait">
      {step === 1 && (
        <motion.div key="s1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <TerminalStep callsign={user?.username || 'UNKNOWN'} onNext={handleTerminalNext} />
        </motion.div>
      )}
      {step === 2 && (
        <motion.div key="s2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <DossierStep onNext={handleDossierNext} />
        </motion.div>
      )}
      {step === 3 && (
        <motion.div key="s3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <TeamStep onNext={handleTeamNext} />
        </motion.div>
      )}
      {step === 4 && (
        <motion.div key="s4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <BriefingStep onEnter={handleEnterDeadnet} loading={loading} />
          {error && (
            <p className="fixed bottom-6 left-1/2 -translate-x-1/2 font-mono text-xs text-danger border border-danger/30 bg-abyss px-4 py-2 rounded-sm">
              {error}
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
