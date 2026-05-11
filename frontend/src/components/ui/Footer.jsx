export default function Footer({ className = '' }) {
  return (
    <div className={`w-full border-t border-ghost/10 px-6 py-3 flex justify-end ${className}`}>
      <span className="font-mono text-xs text-ghost/30 tracking-widest">
        created by <span className="text-ghost/50">s0L</span>
      </span>
    </div>
  )
}
