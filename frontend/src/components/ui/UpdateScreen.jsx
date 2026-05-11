import { useEffect, useState } from 'react'

const _LINES = [
  'RECALIBRATING NETWORK PARAMETERS...',
  'FLUSHING IDENTITY CACHE...',
  'PROPAGATING CONFIGURATION...',
  'VERIFYING INTEGRITY...',
  'SYNCHRONIZING NODES...',
]

export default function UpdateScreen() {
  const [progress, setProgress] = useState(0)
  const [lineIdx, setLineIdx] = useState(0)

  const DURATION = 3200

  useEffect(() => {
    const start = Date.now()

    const progInterval = setInterval(() => {
      const p = Math.min(((Date.now() - start) / DURATION) * 100, 100)
      setProgress(p)
      if (p >= 100) {
        clearInterval(progInterval)
        window.location.reload()
      }
    }, 40)

    const lineInterval = setInterval(() => {
      setLineIdx(i => (i + 1) % _LINES.length)
    }, 640)

    return () => { clearInterval(progInterval); clearInterval(lineInterval) }
  }, [])

  const filled = Math.round(progress / 5)   // 0–20 blocks
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#0A0A0F',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '32px',
      }}
    >
      {/* Scanlines overlay */}
      <div
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px)',
        }}
      />

      <div style={{ textAlign: 'center', position: 'relative' }}>
        {/* Logo */}
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '28px', fontWeight: 700, color: '#FF4500', letterSpacing: '0.3em', marginBottom: '6px', textShadow: '0 0 20px rgba(255,69,0,0.6)' }}>
          DEADNET
        </p>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#6B6B80', letterSpacing: '0.25em' }}>
          SYSTEM UPDATE IN PROGRESS
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ width: '320px' }}>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#FF4500', letterSpacing: '0.1em', marginBottom: '8px', minHeight: '16px' }}>
          {_LINES[lineIdx]}
        </p>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: '#FF6B00', letterSpacing: '0.05em', marginBottom: '6px' }}>
          {bar}
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#3A3A52', letterSpacing: '0.1em' }}>RELOADING</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#6B6B80', letterSpacing: '0.1em' }}>{Math.round(progress)}%</span>
        </div>
      </div>

      <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#3A3A52', letterSpacing: '0.2em', position: 'absolute', bottom: '32px' }}>
        DO NOT DISCONNECT
      </p>
    </div>
  )
}
