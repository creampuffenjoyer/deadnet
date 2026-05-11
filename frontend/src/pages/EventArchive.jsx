import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/ui/Navbar'
import Footer from '../components/ui/Footer'
import Modal from '../components/ui/Modal'
import NotFound from './NotFound'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtFull(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function MajorBadge() {
  return (
    <span className="font-mono text-[9px] border border-ember/60 text-ember px-1.5 py-0.5 rounded-sm tracking-widest shrink-0">
      MAJOR
    </span>
  )
}

function HistoryViewModal({ open, onClose, event }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !event) return
    setLoading(true)
    client.get(`/events/${event.id}`)
      .then(r => setDetail(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, event?.id])

  if (!event) return null
  return (
    <Modal open={open} onClose={onClose} title={event.name} className="max-w-xl">
      {loading && <p className="font-mono text-xs text-ghost animate-pulse">PULLING RECORD...</p>}
      {detail && (
        <div className="space-y-4 font-mono text-xs text-ghost">
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-ghost/60 uppercase tracking-widest mb-0.5 text-[10px]">Status</p><p className="text-bone">{detail.status}</p></div>
            <div><p className="text-ghost/60 uppercase tracking-widest mb-0.5 text-[10px]">Type</p><p className="text-bone">{detail.event_type || 'LOCAL'}</p></div>
            <div><p className="text-ghost/60 uppercase tracking-widest mb-0.5 text-[10px]">Participants</p><p className="text-bone">{detail.participant_count ?? '—'}</p></div>
            <div><p className="text-ghost/60 uppercase tracking-widest mb-0.5 text-[10px]">Reset Level</p><p className="text-bone">{detail.reset_level || '—'}</p></div>
            <div><p className="text-ghost/60 uppercase tracking-widest mb-0.5 text-[10px]">Started</p><p className="text-bone">{fmtFull(detail.start_time)}</p></div>
            <div><p className="text-ghost/60 uppercase tracking-widest mb-0.5 text-[10px]">Closed</p><p className="text-bone">{fmtFull(detail.closed_at)}</p></div>
          </div>
          {detail.contract_count != null && (
            <div className="border-t border-ghost/20 pt-3 space-y-1">
              <p className="text-ghost/60 uppercase tracking-widest mb-2 text-[10px]">Stats</p>
              <p>Contracts: <span className="text-bone">{detail.contract_count}</span></p>
              <p>Teams: <span className="text-bone">{detail.team_count}</span></p>
              <p>Total claims: <span className="text-bone">{detail.claim_count}</span></p>
              {detail.top_player && <p>Top player: <span className="text-ember">{detail.top_player}</span></p>}
            </div>
          )}
          {detail.description && (
            <div className="border-t border-ghost/20 pt-3">
              <p className="text-ghost/60 uppercase tracking-widest mb-1 text-[10px]">Description</p>
              <p className="text-bone">{detail.description}</p>
            </div>
          )}
        </div>
      )}
      <button onClick={onClose} className="mt-5 font-mono text-xs px-4 py-2 border border-ghost/40 text-ghost hover:text-bone transition-colors rounded-sm">
        [ CLOSE ]
      </button>
    </Modal>
  )
}

function ArchiveRow({ event, onExport, onDelete }) {
  const [viewOpen, setViewOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const isMajor = event.event_type === 'MAJOR'

  async function handleDelete() {
    if (!window.confirm(`Permanently delete "${event.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await client.delete(`/events/${event.id}`)
      onDelete(event.id)
    } catch (e) {
      alert(e?.response?.data?.detail || 'Delete failed.')
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="border border-ghost/20 bg-abyss rounded-sm p-4 hover:border-ghost/40 transition-colors">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              {isMajor && <MajorBadge />}
              <span className="font-mono font-bold text-bone text-sm">{event.name}</span>
              <span className="font-mono text-[10px] border border-ghost/30 text-ghost px-1.5 py-0.5 rounded-sm tracking-widest">
                {event.status}
              </span>
            </div>
            <div className="font-mono text-xs text-ghost space-y-0.5">
              <p>
                {event.participant_count ?? 0} participants
                {event.top_player && <span> • Top: <span className="text-ember">{event.top_player}</span></span>}
                {event.contract_count != null && <span> • {event.contract_count} contracts</span>}
              </p>
              <p className="text-ghost/50">
                Closed: {fmt(event.closed_at || event.end_time)}
                {event.reset_level && <span> • Reset: {event.reset_level}</span>}
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setViewOpen(true)}
              className="font-mono text-xs px-2 py-1.5 border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 transition-colors rounded-sm"
            >
              [ VIEW ]
            </button>
            <button
              onClick={() => onExport(event)}
              className="font-mono text-xs px-2 py-1.5 border border-ghost/30 text-ghost hover:text-bone hover:border-ghost/60 transition-colors rounded-sm"
            >
              [ EXPORT ]
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="font-mono text-xs px-2 py-1.5 border border-danger/30 text-danger/70 hover:text-danger hover:border-danger/60 transition-colors rounded-sm disabled:opacity-40"
            >
              {deleting ? '...' : '[ DELETE ]'}
            </button>
          </div>
        </div>
      </div>
      <HistoryViewModal open={viewOpen} onClose={() => setViewOpen(false)} event={event} />
    </>
  )
}

export default function EventArchive() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('ALL') // ALL | LOCAL | MAJOR

  if (user && user.role !== 'ADMIN' && user.role !== 'ARCHITECT') return <NotFound />

  useEffect(() => {
    client.get('/events')
      .then(r => {
        const all = r.data || []
        // Show CLOSED and ARCHIVED events that are not the current active/upcoming event
        setEvents(all.filter(e => e.status === 'CLOSED' || e.status === 'ARCHIVED'))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleExport(event) {
    try {
      const res = await client.get(`/events/${event.id}/export`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `deadnet-event-${event.id}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch { alert('Export failed.') }
  }

  function handleDelete(id) {
    setEvents(ev => ev.filter(e => e.id !== id))
  }

  const filtered = events.filter(e => {
    const matchSearch = !search.trim() || e.name.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'ALL' || e.event_type === filter || (!e.event_type && filter === 'LOCAL')
    return matchSearch && matchFilter
  })

  return (
    <div className="min-h-screen bg-void text-bone flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8 flex-wrap">
          <button
            onClick={() => navigate('/events')}
            className="font-mono text-xs text-ghost hover:text-bone transition-colors"
          >
            ← [ BACK TO EVENTS ]
          </button>
          <div className="flex-1" />
          <span className="font-mono text-[10px] text-ghost/50 tracking-widest">
            {events.length} RECORD{events.length !== 1 ? 'S' : ''}
          </span>
        </div>

        <h1 className="font-ui font-bold text-2xl text-bone mb-1 tracking-tight">EVENT ARCHIVE</h1>
        <p className="font-mono text-xs text-ghost/60 mb-6">All closed and archived competition events.</p>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <input
            type="text"
            placeholder="Search events..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-abyss border border-ghost/30 focus:border-ember rounded-sm px-3 py-1.5 font-mono text-xs text-bone placeholder-ghost/40 outline-none transition-all w-52"
          />
          <div className="flex gap-1">
            {['ALL', 'LOCAL', 'MAJOR'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`font-mono text-[10px] px-3 py-1.5 rounded-sm border tracking-widest transition-colors ${
                  filter === f
                    ? 'border-ember text-ember bg-ember/10'
                    : 'border-ghost/30 text-ghost hover:border-ghost/60 hover:text-bone'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <p className="font-mono text-xs text-ghost animate-pulse tracking-widest">LOADING ARCHIVE...</p>
        ) : filtered.length === 0 ? (
          <div className="border border-ghost/15 rounded-sm px-6 py-10 text-center">
            <p className="font-mono text-xs text-ghost/40 tracking-widest">
              {events.length === 0 ? 'NO ARCHIVED EVENTS' : 'NO EVENTS MATCH FILTER'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(ev => (
              <ArchiveRow
                key={ev.id}
                event={ev}
                onExport={handleExport}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
