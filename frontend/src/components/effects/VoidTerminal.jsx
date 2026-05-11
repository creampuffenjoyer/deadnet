import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import client from '../../api/client'
import { VOID_PATH } from '../../lib/voidPath'

// Key sequence: ↑ ↑ ↓ ↓ ← → ← → B A
const SEQUENCE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA']
const TIMEOUT_MS = 3000
const CHAR_DELAY_MS = 28

function typeText(lines, setLines, text, onDone) {
  let i = 0
  const id = setInterval(() => {
    setLines(prev => {
      const next = [...prev]
      const last = next[next.length - 1]
      next[next.length - 1] = last + text[i]
      return next
    })
    i++
    if (i >= text.length) {
      clearInterval(id)
      if (onDone) onDone()
    }
  }, CHAR_DELAY_MS)
  return id
}

export default function VoidTerminal() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [flash, setFlash] = useState(false)
  const inputRef = useRef(null)
  const scrollRef = useRef(null)
  const seqRef = useRef([])
  const timerRef = useRef(null)

  const isAuthPage = pathname === '/login' || pathname === '/register'

  // Global key sequence listener
  useEffect(() => {
    if (!user || isAuthPage) return

    function handleKey(e) {
      if (open) return // don't track sequence when terminal is already open

      const key = e.code
      seqRef.current = [...seqRef.current, key]

      // Reset timer on each keypress
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        seqRef.current = []
      }, TIMEOUT_MS)

      // Check if last N keys match the sequence
      const buf = seqRef.current
      const seq = SEQUENCE
      if (buf.length >= seq.length) {
        const tail = buf.slice(-seq.length)
        if (tail.every((k, i) => k === seq[i])) {
          seqRef.current = []
          clearTimeout(timerRef.current)
          // Trigger: flash + open terminal
          setFlash(true)
          setTimeout(() => setFlash(false), 120)
          openTerminal()
        }
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [user, isAuthPage, open]) // eslint-disable-line

  function openTerminal() {
    setLines([
      '> DEADNET SHADOW TERMINAL — UNAUTHORIZED ACCESS',
    ])
    setInput('')
    setTyping(false)
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // Auto-scroll on new lines
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines])

  function appendLine(text) {
    setLines(prev => [...prev, text])
  }

  function typeOutput(text, onDone) {
    setTyping(true)
    setLines(prev => [...prev, ''])
    typeText(null, setLines, text, () => {
      setTyping(false)
      if (onDone) onDone()
    })
  }

  function typeLines(texts, onDone) {
    let i = 0
    function next() {
      if (i >= texts.length) { if (onDone) onDone(); return }
      const t = texts[i++]
      setTyping(true)
      setLines(prev => [...prev, ''])
      typeText(null, setLines, t, () => {
        setTimeout(next, 80)
      })
    }
    next()
    setTyping(false)
  }

  function handleCommand(cmd) {
    const trimmed = cmd.trim().toLowerCase()
    appendLine(`> ${cmd}`)

    if (trimmed === 'whoami') {
      appendLine('UNKNOWN OPERATOR — IDENTITY UNVERIFIED')
    } else if (trimmed === 'help') {
      appendLine('AVAILABLE COMMANDS: whoami, ls, cd, cat, clear, exit')
    } else if (trimmed === 'ls') {
      appendLine('/deadnet  /v01d  /architect  /null')
    } else if (trimmed === 'cd /deadnet') {
      appendLine('already here, operative.')
    } else if (trimmed === 'cd /architect') {
      if (user?.role === 'ARCHITECT') {
        typeLines(
          [
            '> IDENTITY CONFIRMED — WELCOME HOME, s0L',
            '> ARCHITECT CONSOLE AVAILABLE',
            '> REDIRECTING TO /architect/dashboard...',
          ],
          () => {
            setOpen(false)
            navigate('/architect/dashboard')
          }
        )
      } else {
        appendLine('ACCESS DENIED.')
        appendLine('this directory belongs to s0L.')
        appendLine('you are not s0L.')
      }
    } else if (trimmed === 'cd /null') {
      appendLine('you stare into /null')
      appendLine('/null stares back')
      appendLine('nothing is here.')
      appendLine('some doors need a /gate.')
    } else if (trimmed === 'cd /v01d' || trimmed === 'cat /v01d') {
      typeLines(
        [
          '> AUTHENTICATING...',
          '> SIGNAL LOCKED...',
          `> VOID ACCESS GRANTED, ${user?.username?.toUpperCase() || 'OPERATIVE'}`,
          '> REDIRECTING...',
        ],
        async () => {
          try {
            await client.post('/v01d/authorize')
            setOpen(false)
            navigate(VOID_PATH || '/404')
          } catch {
            appendLine('> SIGNAL BLOCKED')
            setTyping(false)
          }
        }
      )
      return
    } else if (trimmed === 'clear') {
      setLines([
        '> DEADNET SHADOW TERMINAL — UNAUTHORIZED ACCESS',
        '>',
      ])
      setInput('')
      return
    } else if (trimmed === 'exit') {
      setOpen(false)
      return
    } else if (trimmed === '') {
      // ignore blank input
    } else {
      appendLine(`command not found: ${cmd.trim()}`)
    }

    setInput('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      if (typing) return
      handleCommand(input)
    }
  }

  if (!open && !flash) return null

  return (
    <>
      {/* Single-frame scanline flash */}
      {flash && (
        <div className="fixed inset-0 z-[9998] pointer-events-none bg-bone/10 animate-ping" />
      )}

      {/* Terminal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col"
          style={{ background: '#080810' }}
          onClick={() => inputRef.current?.focus()}
        >
          {/* Heavy scanlines */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.35) 2px, rgba(0,0,0,0.35) 4px)',
              zIndex: 1,
            }}
          />

          {/* Terminal content */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-6 font-mono text-sm"
            style={{ color: '#E8E8F0', position: 'relative', zIndex: 2 }}
          >
            {lines.map((line, i) => (
              <div key={i} className="leading-6 whitespace-pre-wrap">
                <span style={{ color: line.startsWith('>') ? '#FF4500' : '#E8E8F0' }}>
                  {line}
                </span>
              </div>
            ))}
          </div>

          {/* Input row */}
          <div
            className="flex items-center px-6 py-4 border-t font-mono text-sm"
            style={{ borderColor: '#FF4500', background: '#080810', position: 'relative', zIndex: 2 }}
          >
            <span style={{ color: '#FF4500' }}>{'>'}&nbsp;</span>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={typing}
              className="flex-1 bg-transparent outline-none caret-ember"
              style={{ color: '#E8E8F0', caretColor: '#FF4500' }}
              autoComplete="off"
              spellCheck={false}
            />
            <span
              className="ml-1 animate-pulse"
              style={{ color: '#FF4500' }}
            >
              █
            </span>
          </div>
        </div>
      )}
    </>
  )
}
