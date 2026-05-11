/**
 * Fullscreen scanline overlay. Place as a fixed child of a relative container.
 * Pointer-events: none so it doesn't block interaction.
 */
export default function Scanlines({ className = '' }) {
  return (
    <div
      aria-hidden="true"
      className={`scanlines fixed inset-0 pointer-events-none z-50 ${className}`}
    />
  )
}
