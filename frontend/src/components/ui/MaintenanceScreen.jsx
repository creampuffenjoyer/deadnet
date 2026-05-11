import { useEffect, useState } from 'react'
import client from '../../api/client'

export default function MaintenanceScreen() {
  const [dots, setDots] = useState('.')
  const [checking, setChecking] = useState(false)
  const [countdown, setCountdown] = useState(30)

  // Animate trailing dots
  useEffect(() => {
    const id = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 500)
    return () => clearInterval(id)
  }, [])

  // Poll every 30s — auto-reload when maintenance lifts
  useEffect(() => {
    const tick = async () => {
      setChecking(true)
      try {
        const r = await client.get('/public/settings')
        if (!r.data.maintenance_mode) {
          window.location.reload()
          return
        }
      } catch { /* ignore */ }
      setChecking(false)
      setCountdown(30)
    }

    // Countdown display
    const countId = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { tick(); return 30 }
        return c - 1
      })
    }, 1000)

    return () => clearInterval(countId)
  }, [])

  const M = 'JetBrains Mono, monospace'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#0A0A0F',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '0',
    }}>
      {/* Scanlines */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
      }} />

      <div style={{ position: 'relative', width: '480px', maxWidth: '90vw', textAlign: 'left' }}>

        {/* Status bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '40px' }}>
          <span style={{
            display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
            background: '#FF2D2D', boxShadow: '0 0 8px #FF2D2D',
            animation: 'pulse 1.4s ease-in-out infinite',
          }} />
          <span style={{ fontFamily: M, fontSize: '10px', color: '#6B6B80', letterSpacing: '0.25em' }}>
            DEADNET — SYSTEM STATUS: OFFLINE
          </span>
        </div>

        {/* Main heading */}
        <p style={{ fontFamily: M, fontSize: '32px', fontWeight: 700, color: '#FF4500', letterSpacing: '0.15em', lineHeight: 1, marginBottom: '8px', textShadow: '0 0 24px rgba(255,69,0,0.5)' }}>
          NETWORK OFFLINE
        </p>
        <p style={{ fontFamily: M, fontSize: '12px', color: '#6B6B80', letterSpacing: '0.2em', marginBottom: '36px' }}>
          SCHEDULED MAINTENANCE IN PROGRESS
        </p>

        {/* Divider */}
        <div style={{ height: '1px', background: 'linear-gradient(90deg, #FF4500, transparent)', marginBottom: '28px' }} />

        {/* Body text */}
        <p style={{ fontFamily: M, fontSize: '12px', color: '#4A4A60', lineHeight: 1.8, marginBottom: '36px' }}>
          The platform is currently undergoing maintenance.<br />
          Operatives are temporarily restricted from access.<br />
          Please stand by for system restoration.
        </p>

        {/* Reconnect bar */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontFamily: M, fontSize: '9px', color: '#3A3A52', letterSpacing: '0.15em' }}>
              {checking ? 'CHECKING STATUS' + dots : 'AUTO-RECONNECT'}
            </span>
            <span style={{ fontFamily: M, fontSize: '9px', color: '#3A3A52', letterSpacing: '0.1em' }}>
              {checking ? '...' : `${countdown}s`}
            </span>
          </div>
          <div style={{ height: '2px', background: '#16162A', borderRadius: '1px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${((30 - countdown) / 30) * 100}%`,
              background: 'linear-gradient(90deg, #FF4500, #FF6B00)',
              transition: 'width 1s linear',
            }} />
          </div>
        </div>

        {/* Footer */}
        <p style={{ fontFamily: M, fontSize: '9px', color: '#2A2A3A', letterSpacing: '0.15em', marginTop: '40px' }}>
          s0L — DEADNET ARCHITECT SYSTEM
        </p>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  )
}
