import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Scanlines from '../components/effects/Scanlines'
import client from '../api/client'

const PENDING_TOKEN_KEY = 'deadnet_pending_token'

function maskEmail(email) {
  if (!email) return '***'
  const [local, domain] = email.split('@')
  return local.slice(0, 3) + '***@' + domain
}

function TerminalOutput({ lines, done }) {
  return (
    <div className="font-mono text-sm text-success space-y-1">
      {lines.map((line, i) => (
        <div key={i} className="leading-relaxed">
          <span className={
            i === lines.length - 1 && !done
              ? 'after:content-["▋"] after:animate-pulse'
              : ''
          }>
            {line}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function PendingApproval() {
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)   // null=loading, object=loaded
  const [termLines, setTermLines] = useState([])
  const [termDone, setTermDone] = useState(false)
  const [denied, setDenied] = useState(false)
  const pollRef = useRef(null)

  useEffect(() => {
    const token = localStorage.getItem(PENDING_TOKEN_KEY)
    if (!token) { navigate('/login', { replace: true }); return }

    client.get('/auth/pending-status', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        const data = r.data
        if (data.status === 'ACTIVE') {
          // Already approved — go to login
          localStorage.removeItem(PENDING_TOKEN_KEY)
          navigate('/login', { replace: true })
          return
        }
        if (data.status === 'DENIED') {
          setDenied(true)
          setStatus(data)
          return
        }
        setStatus(data)
      })
      .catch(() => navigate('/login', { replace: true }))
  }, []) // eslint-disable-line

  // Poll every 30s for status change
  useEffect(() => {
    if (!status || denied) return
    pollRef.current = setInterval(async () => {
      const token = localStorage.getItem(PENDING_TOKEN_KEY)
      if (!token) return
      try {
        const r = await client.get('/auth/pending-status', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (r.data.status === 'ACTIVE') {
          clearInterval(pollRef.current)
          localStorage.removeItem(PENDING_TOKEN_KEY)
          navigate('/login', { replace: true })
        } else if (r.data.status === 'DENIED') {
          clearInterval(pollRef.current)
          setDenied(true)
          setStatus(r.data)
        }
      } catch { /* ignore */ }
    }, 30000)
    return () => clearInterval(pollRef.current)
  }, [status, denied]) // eslint-disable-line

  // Terminal animation after status loads
  useEffect(() => {
    if (!status || denied) return
    const lines = [
      '> IDENTITY VERIFIED',
      `> ROLE REQUEST: ${status.role}`,
      '> TRANSMISSION SENT TO ADMINISTRATOR',
      '> AWAITING AUTHORIZATION...',
    ]
    let i = 0
    const id = setInterval(() => {
      setTermLines(prev => [...prev, lines[i]])
      i++
      if (i >= lines.length) {
        clearInterval(id)
        setTimeout(() => setTermDone(true), 400)
      }
    }, 500)
    return () => clearInterval(id)
  }, [status, denied]) // eslint-disable-line

  const background = (
    <div className="absolute inset-0 opacity-10 pointer-events-none"
         style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(255,69,0,0.12) 0%, transparent 60%)' }} />
  )

  if (!status) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <Scanlines />
        <p className="font-mono text-xs text-ghost animate-pulse tracking-widest">CONNECTING...</p>
      </div>
    )
  }

  if (denied) {
    return (
      <div className="relative min-h-screen bg-void flex flex-col items-center justify-center px-4">
        <Scanlines />
        {background}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    className="relative z-10 w-full max-w-lg">
          <div className="bg-abyss border border-danger/30 rounded-sm p-8">
            <div className="font-mono text-sm space-y-1 mb-6">
              <p className="text-danger">&gt; REQUEST DENIED</p>
              {status.denied_reason && (
                <p className="text-ghost">&gt; REASON: <span className="text-bone">{status.denied_reason}</span></p>
              )}
              <p className="text-ghost/50">&gt; This account has been scheduled for deletion.</p>
            </div>
            <Link to="/login"
                  onClick={() => localStorage.removeItem(PENDING_TOKEN_KEY)}
                  className="font-mono text-xs text-ghost border border-ghost/30 hover:border-ember hover:text-bone px-4 py-2 tracking-widest transition-all inline-block">
              [ RETURN TO LOGIN ]
            </Link>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-void flex flex-col items-center justify-center px-4">
      <Scanlines />
      {background}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  className="relative z-10 w-full max-w-lg">
        <div className="bg-abyss border border-ghost/20 rounded-sm p-8">
          {/* Terminal */}
          <div className="mb-6 min-h-[100px]">
            <TerminalOutput lines={termLines} done={termDone} />
            {termDone && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                          className="font-mono text-sm text-success">
                &gt; <span className="animate-pulse">▋</span>
              </motion.div>
            )}
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-3 mb-5">
            <span className="w-2 h-2 rounded-full bg-flare animate-pulse inline-block" />
            <span className="font-mono text-xs tracking-widest" style={{ color: '#FF6B00' }}>
              REQUEST STATUS: PENDING
            </span>
          </div>

          {/* Info text */}
          <p className="font-mono text-xs text-ghost leading-relaxed mb-5 tracking-wide">
            Your request has been transmitted to the DEADNET administrator for review.
            You will receive an email notification once a decision has been made.
            This process may take some time.
          </p>

          {/* Identity summary */}
          <div className="border border-ghost/10 rounded-sm p-4 mb-6 space-y-2">
            <div>
              <span className="font-mono text-[10px] text-ghost tracking-widest">OPERATIVE</span>
              <p className="font-mono text-sm text-bone">{status.callsign}</p>
            </div>
            <div>
              <span className="font-mono text-[10px] text-ghost tracking-widest">ROLE REQUESTED</span>
              <p className="font-mono text-sm text-bone">{status.role}</p>
            </div>
            <div>
              <span className="font-mono text-[10px] text-ghost tracking-widest">EMAIL</span>
              <p className="font-mono text-sm text-bone">{maskEmail(status.email)}</p>
            </div>
          </div>

          <Link to="/login"
                onClick={() => localStorage.removeItem(PENDING_TOKEN_KEY)}
                className="font-mono text-xs text-ghost border border-ghost/30 hover:border-ember hover:text-bone px-4 py-2 tracking-widest transition-all inline-block">
            [ RETURN TO LOGIN ]
          </Link>
        </div>
      </motion.div>
    </div>
  )
}
