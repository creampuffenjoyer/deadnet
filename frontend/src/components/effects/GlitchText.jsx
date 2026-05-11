import { useEffect, useRef, useState } from 'react'

/**
 * Triggers a CSS glitch animation on mount and on hover.
 * NOT a looping idle animation — only fires on interaction.
 */
export default function GlitchText({
  children,
  className = '',
  as: Tag = 'span',
  onClick,
}) {
  const [glitching, setGlitching] = useState(false)
  const timerRef = useRef(null)

  const trigger = () => {
    if (glitching) return
    setGlitching(true)
    timerRef.current = setTimeout(() => setGlitching(false), 350)
  }

  // Fire once on mount
  useEffect(() => {
    const t = setTimeout(trigger, 100)
    return () => {
      clearTimeout(t)
      clearTimeout(timerRef.current)
    }
  }, []) // eslint-disable-line

  return (
    <Tag
      data-text={typeof children === 'string' ? children : undefined}
      onMouseEnter={trigger}
      onClick={onClick}
      className={`glitch-text ${glitching ? 'is-glitching' : ''} ${className}`}
    >
      {children}
    </Tag>
  )
}
