import { useEffect, useState } from 'react'

const COUNTDOWN_SECS = 5 * 60  // matches the gap between WARN_MS and IDLE_MS

export default function IdleWarningModal({ onStay, onLogout }) {
  const [secs, setSecs] = useState(COUNTDOWN_SECS)

  useEffect(() => {
    const iv = setInterval(() => setSecs(s => s - 1), 1000)
    return () => clearInterval(iv)
  }, [])

  const mm = String(Math.floor(Math.max(secs, 0) / 60)).padStart(2, '0')
  const ss = String(Math.max(secs, 0) % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="border border-ember/40 bg-abyss rounded-sm w-full max-w-sm mx-4 overflow-hidden">
        {/* Header */}
        <div className="border-b border-ember/20 px-5 py-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-ember animate-pulse" />
          <span className="font-mono text-xs text-ember tracking-widest">SESSION WARNING</span>
        </div>

        {/* Body */}
        <div className="px-5 py-6 text-center space-y-4">
          <p className="font-mono text-xs text-ghost tracking-wide leading-relaxed">
            YOU HAVE BEEN INACTIVE FOR 25 MINUTES.<br />
            YOUR SESSION WILL TERMINATE IN
          </p>
          <div className="font-mono text-4xl text-ember tracking-widest tabular-nums">
            {mm}:{ss}
          </div>
          <p className="font-mono text-xs text-ghost/50 tracking-wide">
            MOVE YOUR MOUSE OR PRESS A KEY TO STAY CONNECTED.
          </p>
        </div>

        {/* Actions */}
        <div className="border-t border-ghost/10 px-5 py-4 flex gap-3">
          <button
            onClick={onStay}
            className="flex-1 font-mono text-xs tracking-widest border border-ember/40 hover:border-ember text-ember hover:text-flare py-2 rounded-sm transition-all"
          >
            [ STAY CONNECTED ]
          </button>
          <button
            onClick={onLogout}
            className="font-mono text-xs tracking-widest border border-ghost/20 hover:border-ghost/50 text-ghost hover:text-bone py-2 px-4 rounded-sm transition-all"
          >
            [ GO DARK ]
          </button>
        </div>
      </div>
    </div>
  )
}
