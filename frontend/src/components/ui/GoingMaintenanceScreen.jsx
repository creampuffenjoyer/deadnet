import { useEffect, useState } from 'react'

const _LINES = [
  'INITIATING LOCKDOWN SEQUENCE...',
  'SUSPENDING OPERATIVE ACCESS...',
  'ROUTING TRAFFIC TO DEAD CHANNEL...',
  'SEALING NETWORK PERIMETER...',
  'BLACKOUT PROTOCOL ENGAGED...',
]

export default function GoingMaintenanceScreen({ onComplete }) {
  const [progress, setProgress] = useState(0)
  const [lineIdx, setLineIdx] = useState(0)

  const DURATION = 3500

  useEffect(() => {
    const start = Date.now()

    const progInterval = setInterval(() => {
      const p = Math.min(((Date.now() - start) / DURATION) * 100, 100)
      setProgress(p)
      if (p >= 100) {
        clearInterval(progInterval)
        onComplete?.()
      }
    }, 40)

    const lineInterval = setInterval(() => {
      setLineIdx(i => (i + 1) % _LINES.length)
    }, 700)

    return () => { clearInterval(progInterval); clearInterval(lineInterval) }
  }, [onComplete])

  const filled = Math.round(progress / 5)
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled)
  const M = 'JetBrains Mono, monospace'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#0A0A0F',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '32px',
    }}>
      {/* Scanlines */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px)',
      }} />

      <div style={{ textAlign: 'center', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '14px' }}>
          <span style={{
            display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
            background: '#FF2D2D', boxShadow: '0 0 10px #FF2D2D',
            animation: 'blink 0.6s ease-in-out infinite',
          }} />
          <span style={{ fontFamily: M, fontSize: '9px', color: '#6B2D2D', letterSpacing: '0.3em' }}>
            DEADNET — EMERGENCY PROTOCOL
          </span>
        </div>
        <p style={{
          fontFamily: M, fontSize: '28px', fontWeight: 700,
          color: '#FF2D2D', letterSpacing: '0.2em', marginBottom: '6px',
          textShadow: '0 0 24px rgba(255,45,45,0.6)',
        }}>
          GOING OFFLINE
        </p>
        <p style={{ fontFamily: M, fontSize: '10px', color: '#6B2D2D', letterSpacing: '0.25em' }}>
          MAINTENANCE MODE ACTIVATING
        </p>
      </div>

      {/* Progress */}
      <div style={{ width: '320px' }}>
        <p style={{ fontFamily: M, fontSize: '11px', color: '#FF2D2D', letterSpacing: '0.08em', marginBottom: '8px', minHeight: '16px' }}>
          {_LINES[lineIdx]}
        </p>
        <p style={{ fontFamily: M, fontSize: '13px', color: '#CC1A1A', letterSpacing: '0.05em', marginBottom: '6px' }}>
          {bar}
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: M, fontSize: '9px', color: '#3A1A1A', letterSpacing: '0.1em' }}>LOCKING DOWN</span>
          <span style={{ fontFamily: M, fontSize: '9px', color: '#6B2D2D', letterSpacing: '0.1em' }}>{Math.round(progress)}%</span>
        </div>
      </div>

      <p style={{ fontFamily: M, fontSize: '9px', color: '#2A1A1A', letterSpacing: '0.2em', position: 'absolute', bottom: '32px' }}>
        ALL ACCESS SUSPENDED
      </p>

      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }`}</style>
    </div>
  )
}
