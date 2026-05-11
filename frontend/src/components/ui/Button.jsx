import { motion } from 'framer-motion'

const VARIANTS = {
  primary:
    'bg-ember text-white border border-ember hover:bg-flare hover:border-flare neon-ember-hover transition-all',
  secondary:
    'bg-transparent text-ember border border-ember hover:bg-ember/10 neon-ember-hover transition-all',
  danger:
    'bg-danger text-white border border-danger hover:bg-danger/80 transition-all',
  ghost:
    'bg-transparent text-ghost border border-ghost/30 hover:border-ghost hover:text-bone transition-all',
}

export default function Button({
  children,
  variant = 'primary',
  className = '',
  disabled = false,
  loading = false,
  type = 'button',
  onClick,
  ...props
}) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      whileTap={{ scale: disabled || loading ? 1 : 0.97 }}
      className={`
        font-mono font-bold tracking-widest uppercase text-sm
        px-6 py-2.5 rounded-sm
        ${VARIANTS[variant]}
        ${disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      {...props}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          PROCESSING...
        </span>
      ) : (
        children
      )}
    </motion.button>
  )
}
