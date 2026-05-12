import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import GlitchText from '../components/effects/GlitchText'
import Scanlines from '../components/effects/Scanlines'
import client from '../api/client'

function useCountdown(targetISO) {
  const [left, setLeft] = useState(null)

  useEffect(() => {
    if (!targetISO) return

    const calc = () => {
      const diff = new Date(targetISO) - Date.now()
      if (diff <= 0) return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 }
      return {
        expired: false,
        days: Math.floor(diff / 86_400_000),
        hours: Math.floor((diff % 86_400_000) / 3_600_000),
        minutes: Math.floor((diff % 3_600_000) / 60_000),
        seconds: Math.floor((diff % 60_000) / 1_000),
      }
    }

    setLeft(calc())
    const id = setInterval(() => setLeft(calc()), 1000)
    return () => clearInterval(id)
  }, [targetISO])

  return left
}

function CountdownUnit({ value, label }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-mono text-4xl md:text-6xl font-bold text-ember tabular-nums neon-ember-text">
        {String(value).padStart(2, '0')}
      </span>
      <span className="font-mono text-xs text-ghost tracking-widest uppercase">{label}</span>
    </div>
  )
}

export default function Landing() {
  const [settings, setSettings] = useState(null)
  const countdown = useCountdown(settings?.competition_start || null)
  const logoClicksRef = useRef(0)
  const logoTimerRef = useRef(null)

  useEffect(() => {
    client.get('/public/settings').then((r) => setSettings(r.data)).catch(() => {})
  }, [])

  // Fragment 4 — rapid logo click 5 times triggers console.log
  function handleLogoClick() {
    logoClicksRef.current += 1
    if (logoTimerRef.current) clearTimeout(logoTimerRef.current)
    logoTimerRef.current = setTimeout(() => { logoClicksRef.current = 0 }, 1500)
    if (logoClicksRef.current >= 5) {
      logoClicksRef.current = 0
      // eslint-disable-next-line no-console
      console.log('FRAGMENT: tr4c3s_')
    }
  }

  const competitionLive = countdown?.expired
  const showCountdown = countdown && !countdown.expired

  return (
    <div className="relative min-h-screen bg-void flex flex-col overflow-hidden">
      <Scanlines />

      {/* Animated background gradient */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 20% 50%, rgba(255,69,0,0.15) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(255,107,0,0.1) 0%, transparent 50%)',
        }}
      />

      {/* Top bar */}
      <div className="relative z-10 w-full border-b border-ghost/20 px-6 py-3 flex justify-between items-center">
        <span className="font-mono text-xs text-ghost tracking-widest">DEADNET // v1.0</span>
        <div className="flex gap-4">
          <Link
            to="/login"
            className="font-mono text-xs text-ghost hover:text-ember tracking-widest uppercase transition-colors py-1"
          >
            [ ACCESS DEADNET ]
          </Link>
          <Link
            to="/register"
            className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-3 py-1 rounded-sm tracking-widest uppercase transition-all neon-ember-hover"
          >
            [ ENLIST ]
          </Link>
        </div>
      </div>

      {/* Hero */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 text-center gap-8">
        {/* Main title */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex flex-col items-center gap-2"
        >
          {/* Fragment 3 — data-sig only visible in DOM source inspection */}
          <div data-sig="4ll_my_" aria-hidden="true" className="hidden" />
          <GlitchText
            as="h1"
            onClick={handleLogoClick}
            className="font-mono font-bold text-7xl md:text-9xl text-ember neon-ember-text tracking-tighter leading-none select-none cursor-pointer"
          >
            DEADNET
          </GlitchText>
          <p className="font-mono text-ghost text-sm md:text-base tracking-widest uppercase">
            DEADNET IS LIVE
          </p>
        </motion.div>

        {/* Countdown or live status */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="flex flex-col items-center gap-4"
        >
          {competitionLive ? (
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="font-mono text-success text-sm tracking-widest uppercase font-bold">
                DEADNET IS LIVE — CONTRACTS ACTIVE
              </span>
            </div>
          ) : settings?.competition_start ? (
            <>
              <p className="font-mono text-xs text-ghost tracking-widest uppercase">
                DEADNET GOES LIVE IN...
              </p>
              {countdown && (
                <div className="flex items-center gap-6 md:gap-10">
                  <CountdownUnit value={countdown.days} label="DAYS" />
                  <span className="font-mono text-ember text-4xl font-bold">:</span>
                  <CountdownUnit value={countdown.hours} label="HRS" />
                  <span className="font-mono text-ember text-4xl font-bold">:</span>
                  <CountdownUnit value={countdown.minutes} label="MIN" />
                  <span className="font-mono text-ember text-4xl font-bold">:</span>
                  <CountdownUnit value={countdown.seconds} label="SEC" />
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="font-mono text-success text-sm tracking-widest uppercase font-bold"
                style={{ textShadow: '0 0 10px #00FF88, 0 0 20px #00FF88' }}>
                DEADNET IS LIVE
              </span>
            </div>
          )}
        </motion.div>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.5 }}
          className="flex flex-col sm:flex-row gap-4"
        >
          <Link
            to="/login"
            className="font-mono font-bold text-sm tracking-widest uppercase px-8 py-3 bg-ember text-white border border-ember rounded-sm hover:bg-flare hover:border-flare neon-ember transition-all"
          >
            [ ACCESS DEADNET ]
          </Link>
          <Link
            to="/register"
            className="font-mono font-bold text-sm tracking-widest uppercase px-8 py-3 bg-transparent text-ember border border-ember rounded-sm hover:bg-ember/10 neon-ember-hover transition-all"
          >
            {(() => {
              const term = settings?.term_operator || 'Operative'
              const article = /^[aeiou]/i.test(term) ? 'AN' : 'A'
              return `[ JOIN AS ${article} ${term.toUpperCase()} ]`
            })()}
          </Link>
        </motion.div>

        {/* Bottom flavor text */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.5 }}
          className="flex flex-col items-center gap-1"
        >
          <div className="flex gap-6 font-mono text-xs text-ghost/50 tracking-widest">
            <span>WELCOME</span>
            <span>//</span>
            <span>TO</span>
            <span>//</span>
            <span>THE</span>
            <span>//</span>
            <span>NET</span>
          </div>
        </motion.div>
      </div>

      {/* Bottom bar */}
      <div className="relative z-10 border-t border-ghost/20 px-6 py-3 flex justify-between items-center">
        <span className="font-mono text-xs text-ghost/40 tracking-widest">
          SECURE CHANNEL ESTABLISHED
        </span>
        <div className="flex items-center gap-6">
          <span className="font-mono text-xs text-ghost/40 tracking-widest">
            {settings?.competition_name || 'DEADNET'} // ACADEMIC CTF PLATFORM
          </span>
          <span className="font-mono text-xs text-ghost/30 tracking-widest">
            created by <span className="text-ghost/50">s0L</span>
          </span>
        </div>
      </div>
    </div>
  )
}
