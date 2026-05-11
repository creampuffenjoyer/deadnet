const RARITY_BORDER = {
  COMMON: 'border-common-glow/40 hover:border-common-glow',
  RARE: 'border-rare-glow/50 hover:border-rare-glow hover:neon-rare',
  CLASSIFIED: 'border-classified-glow/50 animate-classified-pulse',
}

export default function Card({ children, rarity, className = '', onClick }) {
  const rarityClass = rarity ? RARITY_BORDER[rarity] : 'border-ghost/20 hover:border-ghost/50'

  return (
    <div
      onClick={onClick}
      className={`
        bg-abyss border rounded-sm p-4
        transition-all duration-200
        ${rarityClass}
        ${onClick ? 'cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  )
}
