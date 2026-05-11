export default function Input({
  label,
  error,
  className = '',
  prefix,
  ...props
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="font-mono text-xs text-ghost tracking-widest uppercase">
          {label}
        </label>
      )}
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-ghost text-sm">
            {prefix}
          </span>
        )}
        <input
          className={`
            w-full bg-void border rounded-sm px-3 py-2.5
            font-mono text-sm text-bone placeholder-ghost/50
            outline-none
            border-ghost/30
            focus:border-ember focus:shadow-[0_0_0_1px_#FF4500]
            transition-all duration-150
            ${prefix ? 'pl-8' : ''}
            ${error ? 'border-danger focus:border-danger focus:shadow-[0_0_0_1px_#FF2D2D]' : ''}
          `}
          {...props}
        />
      </div>
      {error && (
        <span className="font-mono text-xs text-danger tracking-wide">
          {error}
        </span>
      )}
    </div>
  )
}
