import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useEventStatus } from '../hooks/useEventStatus'
import { useMyRegistration } from '../hooks/useMyRegistration'
import client from '../api/client'
import Navbar from '../components/ui/Navbar'
import OfflineLock from '../components/ui/OfflineLock'
import CCBanner from '../components/cc/CCBanner'
import Footer from '../components/ui/Footer'
import Scanlines from '../components/effects/Scanlines'
import { usePlatformFormat } from '../hooks/usePlatformFormat'

// ── THE BROKER avatar ──────────────────────────────────────────────────────
function BrokerAvatar() {
  return (
    <div className="w-12 h-12 flex-shrink-0 bg-void border border-ember/50 rounded-sm overflow-hidden shadow-[0_0_12px_rgba(255,69,0,0.3)]">
      <img
        src="/broker.png"
        alt="The Broker"
        className="w-full h-full object-cover invert opacity-90"
        style={{ filter: 'invert(1) sepia(1) saturate(5) hue-rotate(345deg) brightness(0.9)' }}
      />
    </div>
  )
}

// ── Chat bubble ────────────────────────────────────────────────────────────
function BrokerMessage({ children, animate = true }) {
  return (
    <motion.div
      className="flex gap-3 items-start"
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <BrokerAvatar />
      <div className="bg-abyss border border-ember/20 rounded-sm px-4 py-3 max-w-lg">
        <p className="font-mono text-xs text-ember font-bold tracking-widest mb-1">THE BROKER</p>
        <div className="font-mono text-sm text-bone leading-relaxed">{children}</div>
      </div>
    </motion.div>
  )
}

function OperativeMessage({ children }) {
  return (
    <div className="flex justify-end">
      <div className="bg-ember/10 border border-ember/30 rounded-sm px-4 py-3 max-w-lg">
        <p className="font-mono text-xs text-ghost font-bold tracking-widest mb-1">YOU</p>
        <div className="font-mono text-sm text-bone">{children}</div>
      </div>
    </div>
  )
}

// ── Intel drop item ────────────────────────────────────────────────────────
function IntelDropItem({ drop, onPurchase, isPurchasing, isPrivileged }) {
  const [confirming, setConfirming] = useState(false)

  if (drop.is_purchased) {
    return (
      <motion.div
        className="border border-success/30 bg-success/5 rounded-sm p-4"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono text-xs text-success tracking-widest font-bold">
            {isPrivileged ? '[ INTEL DROP ]' : '[ INTEL UNLOCKED ]'}
          </span>
          <span className="font-mono text-xs text-ghost">DROP {drop.order_index + 1}</span>
        </div>
        <p className="font-mono text-sm text-bone">{drop.content}</p>
      </motion.div>
    )
  }

  return (
    <div className="border border-ghost/20 bg-abyss rounded-sm p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <span className="font-mono text-xs text-ghost tracking-widest">
            [ INTEL DROP — COSTS {drop.cost_bc} BC ]
          </span>
          <p className="font-mono text-xs text-ghost/50 mt-0.5">DROP {drop.order_index + 1} — CONTENT ENCRYPTED</p>
        </div>
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-3 py-1.5 rounded-sm tracking-widest transition-all"
          >
            [ REQUEST INTEL ]
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-ghost">SPEND {drop.cost_bc} BC?</span>
            <button
              onClick={() => { onPurchase(drop); setConfirming(false) }}
              disabled={isPurchasing}
              className="font-mono text-xs text-ember border border-ember/60 hover:border-ember hover:bg-ember/10 px-3 py-1.5 rounded-sm tracking-widest transition-all disabled:opacity-50"
            >
              [ CONFIRM ]
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="font-mono text-xs text-ghost border border-ghost/30 hover:border-ghost px-3 py-1.5 rounded-sm tracking-widest transition-all"
            >
              [ ABORT ]
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function IntelBroker() {
  const { user, setUser } = useAuth()
  const { active: activeEvent, loading: eventLoading } = useEventStatus()
  const regStatus = useMyRegistration(activeEvent?.id || null)
  const { competition_active, competition_manual_end } = usePlatformFormat()
  const [searchParams] = useSearchParams()
  const [contracts, setContracts] = useState([])
  const [selectedId, setSelectedId] = useState(searchParams.get('contract') || '')
  const [drops, setDrops] = useState([])
  const [messages, setMessages] = useState([])
  const [purchasing, setPurchasing] = useState(false)
  const [userBc, setUserBc] = useState(null)
  const chatEndRef = useRef(null)
  const isPrivileged = ['ADMIN', 'CONTRACTOR', 'HANDLER'].includes(user?.role)

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load contracts list
  useEffect(() => {
    client.get('/contracts/').then(r => setContracts(r.data)).catch(() => {})
    client.get('/auth/me').then(r => setUserBc(r.data.bc_total ?? null)).catch(() => {})
  }, [])

  // Load intel drops when contract selected
  useEffect(() => {
    if (!selectedId) return
    setDrops([])
    setMessages([{
      type: 'broker',
      text: `...connection established... you want intel on this contract, Operative? Every drop costs you. Nothing is free on DEADNET.`,
    }])
    client.get(`/contracts/${selectedId}/intel`)
      .then(r => setDrops(r.data))
      .catch(() => {})
  }, [selectedId])

  const handlePurchase = async (drop) => {
    setPurchasing(true)
    setMessages(prev => [...prev, {
      type: 'operative',
      text: `Requesting intel drop ${drop.order_index + 1}. Authorizing ${drop.cost_bc} BC transfer...`,
    }])
    try {
      const { data } = await client.post(
        `/contracts/${selectedId}/intel/${drop.id}/purchase`
      )
      // Update drop in list
      setDrops(prev => prev.map(d =>
        d.id === drop.id ? { ...d, is_purchased: true, content: data.content } : d
      ))
      setUserBc(data.bc_total)
      // Sync BC into AuthContext so navbar updates immediately
      client.get('/auth/me').then(r => {
        localStorage.setItem('deadnet_user', JSON.stringify(r.data))
        setUser(r.data)
      }).catch(() => {})
      setMessages(prev => [...prev, {
        type: 'broker',
        text: data.content,
        isIntel: true,
      }])
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg = detail === 'INSUFFICIENT_BC'
        ? `...transaction denied. You don't have enough BC. Earn more and come back.`
        : detail === 'ALREADY_PURCHASED'
        ? `...you already own that intel, Operative.`
        : `...something went wrong on my end. Try again.`
      setMessages(prev => [...prev, { type: 'broker', text: msg }])
    } finally {
      setPurchasing(false)
    }
  }

  const selectedContract = contracts.find(c => c.id === selectedId)

  // Locked state for operatives under manual halt
  const nowMs = Date.now()
  const manualEndMs = competition_manual_end ? new Date(competition_manual_end).getTime() : null
  const isLocked = !isPrivileged && (
    competition_active === 'false' ||
    (competition_active === 'true' && manualEndMs && nowMs > manualEndMs)
  )

  if (isLocked) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Scanlines />
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <p className="font-mono font-bold text-3xl text-danger tracking-widest mb-4">
            CHANNEL OFFLINE
          </p>
          <p className="font-mono text-xs text-ghost tracking-widest">
            The Broker has gone dark. Competition is currently halted.
          </p>
          <p className="font-mono text-xs text-ghost/50 mt-2 tracking-widest">
            Intel purchases are disabled until competition resumes.
          </p>
        </div>
        <Footer />
      </div>
    )
  }

  // Operative lock — no active event
  if (!eventLoading && !activeEvent && user?.role === 'OPERATIVE') {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Navbar />
        <OfflineLock
          title="BROKER OFFLINE"
          lines={[
            '> THE BROKER: I\'m not taking clients right now.',
            '>             Come back when the competition is live.',
          ]}
          upcoming={null}
        />
        <Footer />
      </div>
    )
  }

  // Operative lock — removed from event
  if (!eventLoading && activeEvent && user?.role === 'OPERATIVE' && !regStatus.loading && regStatus.status === 'REMOVED') {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Navbar />
        <OfflineLock title="INTEL BROKER" mode="removed" activeEvent={activeEvent} />
        <Footer />
      </div>
    )
  }

  // Operative lock — active event but not registered
  if (!eventLoading && activeEvent && user?.role === 'OPERATIVE' && !regStatus.loading && !regStatus.registered) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Navbar />
        <OfflineLock title="INTEL BROKER" mode="not_registered" activeEvent={activeEvent} />
        <Footer />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-void text-bone flex flex-col">
      <Scanlines />
      <Navbar />
      <CCBanner />

      <div className="relative z-10 flex-1 max-w-4xl mx-auto w-full px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-mono font-bold text-3xl text-ember tracking-widest">
            THE BROKER
          </h1>
          <p className="font-mono text-xs text-ghost mt-1 tracking-widest">
            INTEL DROPS — CLASSIFIED INFORMATION FOR SALE
            {userBc !== null && (
              <span className="ml-4 text-ember font-bold">{userBc} BC AVAILABLE</span>
            )}
          </p>
        </div>

        {/* Contract selector */}
        <div className="mb-6 border border-ghost/20 bg-abyss rounded-sm p-4">
          <label className="font-mono text-xs text-ghost tracking-widest block mb-2">
            SELECT CONTRACT
          </label>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="w-full bg-void border border-ghost/30 focus:border-ember rounded-sm px-3 py-2.5 font-mono text-sm text-bone outline-none transition-all"
          >
            <option value="">— CHOOSE A CONTRACT —</option>
            {contracts.map(c => (
              <option key={c.id} value={c.id}>
                [{c.rarity}] {c.title}
              </option>
            ))}
          </select>
        </div>

        {!selectedId ? (
          <BrokerMessage animate={false}>
            ...you've reached an encrypted channel. Select a contract and I'll see what intel
            I can pull for you. Everything has a price.
          </BrokerMessage>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Chat feed */}
            <div className="flex flex-col gap-4 min-h-32">
              <AnimatePresence>
                {messages.map((msg, i) => (
                  msg.type === 'broker' ? (
                    <BrokerMessage key={i}>
                      {msg.isIntel ? (
                        <span className="text-success">
                          ...data transfer complete... <br />{msg.text}
                        </span>
                      ) : msg.text}
                    </BrokerMessage>
                  ) : (
                    <OperativeMessage key={i}>{msg.text}</OperativeMessage>
                  )
                ))}
              </AnimatePresence>
              <div ref={chatEndRef} />
            </div>

            {/* Intel drops */}
            {drops.length > 0 && (
              <div className="border border-ghost/20 rounded-sm p-4">
                <p className="font-mono text-xs text-ghost tracking-widest mb-3">
                  AVAILABLE INTEL — {selectedContract?.title}
                  {isPrivileged && (
                    <span className="ml-3 text-rare-glow">[ PRIVILEGED ACCESS — FREE ]</span>
                  )}
                </p>
                <div className="flex flex-col gap-3">
                  {drops.map(drop => (
                    <IntelDropItem
                      key={drop.id}
                      drop={drop}
                      onPurchase={handlePurchase}
                      isPurchasing={purchasing}
                      isPrivileged={isPrivileged}
                    />
                  ))}
                </div>
              </div>
            )}

            {drops.length === 0 && selectedId && (
              <div className="text-center py-6">
                <p className="font-mono text-xs text-ghost tracking-widest">
                  NO INTEL DROPS AVAILABLE FOR THIS CONTRACT
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <Footer />
    </div>
  )
}
