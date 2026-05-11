const RARITY = {
  COMMON:
    'border-common-glow text-common-glow bg-common-glow/10',
  RARE:
    'border-rare-glow text-rare-glow bg-rare-glow/10 shadow-[0_0_8px_rgba(74,158,255,0.4)]',
  CLASSIFIED:
    'border-classified-glow text-classified-glow bg-classified-glow/10 animate-classified-pulse',
}

const CLEARANCE = {
  NOVICE:  'border-ghost text-ghost bg-ghost/10',
  GHOST:   'border-blue-400 text-blue-400 bg-blue-400/10',
  PHANTOM: 'border-purple-500 text-purple-400 bg-purple-500/10 shadow-[0_0_8px_rgba(138,79,255,0.4)]',
  SPECTER: 'border-flare text-flare bg-flare/10 shadow-[0_0_8px_rgba(255,107,0,0.4)]',
  HACKER:  'border-ember text-ember bg-ember/10 animate-legend-glow',
}

const ROLE = {
  ADMIN:      'border-ember text-ember bg-ember/10',
  CONTRACTOR: 'border-flare text-flare bg-flare/10',
  HANDLER: 'border-rare-glow text-rare-glow bg-rare-glow/10',
  OPERATIVE:  'border-ghost text-ghost bg-ghost/10',
}

export default function Badge({ label, type = 'role', className = '', displayLabel }) {
  const map = type === 'rarity' ? RARITY : type === 'clearance' ? CLEARANCE : ROLE
  const styles = map[label] || 'border-ghost text-ghost bg-ghost/10'
  const shown = displayLabel ?? label

  return (
    <span
      className={`
        inline-block font-mono text-xs font-bold
        px-2 py-0.5 border rounded-sm
        tracking-widest whitespace-nowrap
        ${styles} ${className}
      `}
    >
      [ {shown} ]
    </span>
  )
}
