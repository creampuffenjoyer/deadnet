import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'
import Navbar from '../components/ui/Navbar'
import CCBanner from '../components/cc/CCBanner'
import Footer from '../components/ui/Footer'
import Scanlines from '../components/effects/Scanlines'
import Badge from '../components/ui/Badge'
import GlitchText from '../components/effects/GlitchText'

const RARITY_COLOR = {
  COMMON: 'text-common-glow',
  RARE: 'text-rare-glow',
  CLASSIFIED: 'text-classified-glow',
}


export default function OperativeProfile() {
  const { id } = useParams()
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    client.get(`/operatives/${id}`)
      .then(r => setProfile(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Scanlines />
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <span className="font-mono text-ghost animate-pulse tracking-widest">LOADING OPERATOR FILE...</span>
        </div>
        <Footer />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Scanlines />
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <p className="font-mono text-ghost tracking-widest">OPERATOR FILE NOT FOUND</p>
        </div>
        <Footer />
      </div>
    )
  }

  const isMe = user?.id === id || user?.username === profile.username

  return (
    <div className="relative min-h-screen bg-void text-bone flex flex-col">
      <Scanlines />
      <Navbar />
      <CCBanner />

      <div className="relative z-10 flex-1 max-w-4xl mx-auto w-full px-4 py-8">
        {/* Back */}
        <Link to="/bounty-board" className="font-mono text-xs text-ghost hover:text-bone tracking-widest mb-6 inline-block">
          ← BOUNTY BOARD
        </Link>

        {/* Profile header */}
        <div className="border border-ghost/20 bg-abyss rounded-sm p-6 mb-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <p className="font-mono text-xs text-ghost tracking-widest mb-1">OPERATOR FILE</p>
              <GlitchText as="h1" className="font-mono font-bold text-2xl text-ember tracking-widest">
                {profile.username}
                {isMe && <span className="ml-3 font-mono text-sm text-ghost font-normal">[YOU]</span>}
              </GlitchText>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <Badge label={profile.clearance_level} type="clearance" />
                {/* V01D ACCESS badge — only shown when void_access = true */}
                {profile.void_access && (
                  <span
                    className="font-mono text-[10px] px-2 py-0.5 tracking-widest"
                    style={{
                      background: '#080810',
                      color: '#E8E8F0',
                      border: '1px solid rgba(232,232,240,0.5)',
                      animation: 'voidStaticBadge 4s steps(1) infinite',
                    }}
                  >
                    [ V01D ACCESS ]
                  </span>
                )}
                {profile.team && (
                  <Link
                    to={`/teams/${profile.team.id}`}
                    className="font-mono text-xs text-ghost hover:text-bone border border-ghost/20 hover:border-ghost px-2 py-0.5 rounded-sm transition-all"
                  >
                    {profile.team.name}
                    {profile.team.is_captain && (
                      <span className="ml-1 text-ember">[CAPTAIN]</span>
                    )}
                  </Link>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="flex gap-4 flex-wrap">
              {[
                { label: 'RANK', val: `#${profile.rank}`, color: 'text-ember' },
                { label: 'BC TOTAL', val: `${profile.bc_total} BC`, color: 'text-ember' },
                { label: 'CONTRACTS', val: profile.claim_count, color: 'text-bone' },
              ].map(s => (
                <div key={s.label} className="border border-ghost/20 bg-void rounded-sm px-4 py-2 text-center">
                  <div className={`font-mono font-bold text-xl ${s.color}`}>{s.val}</div>
                  <div className="font-mono text-[10px] text-ghost tracking-widest">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Two-column layout: radar + claims */}
        <div className="grid md:grid-cols-[280px_1fr] gap-6">
          {/* Category breakdown */}
          <div className="border border-ghost/20 bg-abyss rounded-sm p-4 flex flex-col">
            <p className="font-mono text-xs text-ghost tracking-widest mb-4">CATEGORY BREAKDOWN</p>
            {profile.claim_count === 0 ? (
              <div className="flex items-center justify-center flex-1 h-48">
                <p className="font-mono text-xs text-ghost/60 text-center tracking-widest">
                  NO CONTRACTS CLAIMED YET
                </p>
              </div>
            ) : (() => {
              const sorted = [...profile.radar_data].sort((a, b) => b.count - a.count)
              const max = sorted[0]?.count || 1
              const total = sorted.reduce((s, d) => s + d.count, 0)
              return (
                <div className="space-y-3">
                  {sorted.map(({ category, count }) => (
                    <div key={category}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-[10px] text-ghost tracking-wider uppercase">{category}</span>
                        <span className="font-mono text-[10px] text-ember tabular-nums">
                          {count} <span className="text-ghost/50">/ {total}</span>
                        </span>
                      </div>
                      <div className="h-[3px] bg-ghost/10 w-full">
                        <div
                          className="h-full bg-ember transition-all duration-500"
                          style={{ width: `${(count / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* Claim history */}
          <div className="border border-ghost/20 rounded-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-ghost/10 bg-abyss">
              <span className="font-mono text-xs text-ghost tracking-widest">
                OPERATION LOG — {profile.claim_count} CONTRACTS CLAIMED
              </span>
            </div>
            {profile.claims.length === 0 ? (
              <div className="text-center py-12">
                <p className="font-mono text-xs text-ghost tracking-widest">
                  NO OPERATIONS ON RECORD
                </p>
              </div>
            ) : (
              <div className="divide-y divide-ghost/10 max-h-[480px] overflow-y-auto">
                {profile.claims.map((cl, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3 flex-wrap gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-bone">{cl.contract_title}</span>
                        <span className={`font-mono text-[10px] ${RARITY_COLOR[cl.contract_rarity] || 'text-ghost'}`}>
                          {cl.contract_rarity}
                        </span>
                        {cl.is_first_blood && (
                          <span className="font-mono text-[10px] text-ember border border-ember/40 px-1 py-0.5 rounded-sm">
                            FIRST BLOOD
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-xs text-ghost/60 mt-0.5">
                        {cl.contract_category} · {new Date(cl.claimed_at).toLocaleString()}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-success">+{cl.bc_earned} BC</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Footer />
      <style>{`
        @keyframes voidStaticBadge {
          0%   { opacity: 1; }
          90%  { opacity: 1; }
          92%  { opacity: 0.2; }
          94%  { opacity: 1; }
          97%  { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
