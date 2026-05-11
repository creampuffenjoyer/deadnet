import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'
import Navbar from '../components/ui/Navbar'
import Footer from '../components/ui/Footer'
import Scanlines from '../components/effects/Scanlines'
import GlitchText from '../components/effects/GlitchText'
import Badge from '../components/ui/Badge'

const BAR_COLOR = '#FF4500'
const BAR_ALT = '#FF6B00'

async function exportStatsPDF(stats) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const date = new Date().toISOString().split('T')[0]
  const doc = new jsPDF()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('DEADNET — COMPETITION STATISTICS', 14, 18)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100)
  doc.text(`Generated: ${date}`, 14, 26)

  const ov = stats.overview
  autoTable(doc, {
    startY: 32,
    head: [['Metric', 'Value']],
    body: [
      ['Total BC Distributed', ov.total_bc_distributed],
      ['Total Contract Claims', ov.total_claims],
      ['Unique Solvers', ov.unique_solvers],
      ['Most Active Category', ov.most_active_category || '—'],
      ['Total Intel Purchases', ov.total_intel_purchases],
      ['Hardest Contract', ov.hardest_contract?.title || '—'],
      ['Easiest Contract', ov.easiest_contract?.title || '—'],
      ['Fastest Solve', ov.fastest_solve ? `${ov.fastest_solve.netrunner_username} — ${ov.fastest_solve.contract_title} (${ov.fastest_solve.elapsed || 'N/A'})` : '—'],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [255, 69, 0] },
  })

  const { top_performers, category_breakdown } = stats
  let y = doc.lastAutoTable.finalY + 10
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(0)
  doc.text('Top Performers — By BC', 14, y)
  autoTable(doc, {
    startY: y + 4,
    head: [['Callsign', 'BC Total', 'Clearance']],
    body: top_performers.top_by_bc.map(r => [r.username, r.bc_total, r.clearance_level]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [255, 107, 0] },
  })

  y = doc.lastAutoTable.finalY + 10
  doc.text('Category Breakdown', 14, y)
  autoTable(doc, {
    startY: y + 4,
    head: [['Category', 'Claims', 'Avg BC']],
    body: category_breakdown.map(r => [r.category, r.claim_count, r.avg_bc_earned]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [255, 45, 45] },
  })

  doc.save(`DEADNET_stats_${date}.pdf`)
}

function StatCard({ label, value, sub }) {
  return (
    <div className="border border-ghost/20 bg-abyss rounded-sm px-4 py-4">
      <div className="font-mono font-bold text-2xl text-ember mb-1">{value ?? '—'}</div>
      <div className="font-mono text-[10px] text-ghost tracking-widest uppercase">{label}</div>
      {sub && <div className="font-mono text-xs text-ghost/60 mt-1">{sub}</div>}
    </div>
  )
}

export default function Stats() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  const isAdmin = user?.role === 'ADMIN'

  useEffect(() => {
    client.get('/stats/').then(r => {
      setStats(r.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="relative min-h-screen bg-void text-bone flex flex-col">
      <Scanlines />
      <Navbar />
      <div className="flex-1 flex items-center justify-center">
        <span className="font-mono text-ghost text-sm animate-pulse tracking-widest">LOADING STATS...</span>
      </div>
      <Footer />
    </div>
  )

  if (!stats) return null

  const { overview, top_performers, category_breakdown } = stats

  return (
    <div className="relative min-h-screen bg-void text-bone flex flex-col">
      <Scanlines />
      <Navbar />

      <div className="relative z-10 flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
          <GlitchText as="h1" className="font-mono font-bold text-3xl text-ember tracking-widest">
            COMPETITION STATS
          </GlitchText>
          {isAdmin && (
            <button
              onClick={() => exportStatsPDF(stats)}
              className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-3 py-1.5 rounded-sm transition-all"
            >
              [ EXPORT STATS PDF ]
            </button>
          )}
        </div>

        {/* Overview */}
        <section className="mb-8">
          <h2 className="font-mono text-xs text-ghost tracking-widest uppercase mb-4 border-b border-ghost/10 pb-2">
            OVERVIEW
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatCard label="Total BC Distributed" value={overview.total_bc_distributed} />
            <StatCard label="Total Claims" value={overview.total_claims} />
            <StatCard label="Unique Solvers" value={overview.unique_solvers} />
            <StatCard label="Intel Purchases" value={overview.total_intel_purchases} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <StatCard
              label="Most Active Category"
              value={overview.most_active_category || '—'}
            />
            <StatCard
              label="Fastest Solve"
              value={overview.fastest_solve
                ? `${overview.fastest_solve.elapsed || 'instant'}`
                : '—'}
              sub={overview.fastest_solve
                ? `${overview.fastest_solve.netrunner_username} — ${overview.fastest_solve.contract_title}`
                : undefined}
            />
            <StatCard
              label="Hardest Contract"
              value={overview.hardest_contract?.title || '—'}
              sub={overview.hardest_contract
                ? `${overview.hardest_contract.solve_count} solve${overview.hardest_contract.solve_count !== 1 ? 's' : ''} · ${overview.hardest_contract.total_attempts} attempts`
                : undefined}
            />
            <StatCard
              label="Easiest Contract"
              value={overview.easiest_contract?.title || '—'}
              sub={overview.easiest_contract
                ? `${overview.easiest_contract.solve_count} solve${overview.easiest_contract.solve_count !== 1 ? 's' : ''} · ${overview.easiest_contract.total_attempts} attempts`
                : undefined}
            />
          </div>
        </section>

        {/* Top Performers */}
        <section className="mb-8">
          <h2 className="font-mono text-xs text-ghost tracking-widest uppercase mb-4 border-b border-ghost/10 pb-2">
            TOP PERFORMERS
          </h2>

          {/* First Blood Hall */}
          {top_performers.first_blood_hall.length > 0 && (
            <div className="mb-6">
              <p className="font-mono text-[10px] text-ghost tracking-widest mb-2">FIRST BLOOD HALL</p>
              <div className="border border-ghost/20 rounded-sm overflow-hidden">
                {top_performers.first_blood_hall.map((fb, i) => (
                  <div key={i} className={`flex items-center justify-between px-4 py-2.5 font-mono text-sm border-b border-ghost/10 last:border-0 ${i === 0 ? 'bg-ember/5' : 'bg-abyss'}`}>
                    <div>
                      <span className="text-bone font-bold">{fb.netrunner_username}</span>
                      <span className="text-ghost mx-2">→</span>
                      <span className="text-ghost/80">{fb.contract_title}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-ember text-xs font-bold">+{fb.bc_earned} BC</span>
                      <span className="text-ghost/40 text-xs">
                        {new Date(fb.claimed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top 5 tables */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="font-mono text-[10px] text-ghost tracking-widest mb-2">MOST CONTRACTS CLAIMED</p>
              <div className="border border-ghost/20 rounded-sm overflow-hidden">
                {top_performers.top_by_contracts.map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-ghost/10 last:border-0 bg-abyss">
                    <span className="font-mono text-sm text-bone">{r.username}</span>
                    <span className="font-mono text-sm text-ember font-bold">{r.claim_count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="font-mono text-[10px] text-ghost tracking-widest mb-2">HIGHEST BC EARNED</p>
              <div className="border border-ghost/20 rounded-sm overflow-hidden">
                {top_performers.top_by_bc.map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-ghost/10 last:border-0 bg-abyss">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-bone">{r.username}</span>
                      <Badge label={r.clearance_level} type="clearance" />
                    </div>
                    <span className="font-mono text-sm text-ember font-bold">{r.bc_total} BC</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Category Breakdown */}
        <section>
          <h2 className="font-mono text-xs text-ghost tracking-widest uppercase mb-4 border-b border-ghost/10 pb-2">
            CATEGORY BREAKDOWN
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="font-mono text-[10px] text-ghost tracking-widest mb-3">CLAIMS PER CATEGORY</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={category_breakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(107,107,128,0.15)" />
                  <XAxis type="number" tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#6B6B80' }} axisLine={{ stroke: 'rgba(107,107,128,0.3)' }} />
                  <YAxis dataKey="category" type="category" tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#6B6B80' }} axisLine={{ stroke: 'rgba(107,107,128,0.3)' }} width={80} />
                  <Tooltip contentStyle={{ backgroundColor: '#12121A', border: '1px solid rgba(107,107,128,0.3)', borderRadius: '2px', fontFamily: 'JetBrains Mono', fontSize: 11 }} />
                  <Bar dataKey="claim_count" name="Claims">
                    {category_breakdown.map((_, i) => (
                      <Cell key={i} fill={i % 2 === 0 ? BAR_COLOR : BAR_ALT} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="font-mono text-[10px] text-ghost tracking-widest mb-3">AVG BC PER CATEGORY</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={category_breakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(107,107,128,0.15)" />
                  <XAxis type="number" tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#6B6B80' }} axisLine={{ stroke: 'rgba(107,107,128,0.3)' }} />
                  <YAxis dataKey="category" type="category" tick={{ fontFamily: 'JetBrains Mono', fontSize: 10, fill: '#6B6B80' }} axisLine={{ stroke: 'rgba(107,107,128,0.3)' }} width={80} />
                  <Tooltip contentStyle={{ backgroundColor: '#12121A', border: '1px solid rgba(107,107,128,0.3)', borderRadius: '2px', fontFamily: 'JetBrains Mono', fontSize: 11 }} />
                  <Bar dataKey="avg_bc_earned" name="Avg BC">
                    {category_breakdown.map((_, i) => (
                      <Cell key={i} fill={i % 2 === 0 ? BAR_ALT : BAR_COLOR} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      </div>

      <Footer />
    </div>
  )
}
