import { useEffect, useRef, useState } from 'react'
import { Search, LogOut } from 'lucide-react'

const G = 'Geist, sans-serif'
const M = 'JetBrains Mono, monospace'

const _ROLE_COLOR = {
  OPERATIVE: '#6B6B80',
  HANDLER:   '#4A9EFF',
  CONTRACTOR:'#FF6B00',
  ADMIN:     '#FF4500',
  ARCHITECT: '#FF4500',
}
const _STATUS_COLOR = { ACTIVE: '#00FF88', UPCOMING: '#4A9EFF', CLOSED: '#6B6B80' }

export default function ArchitectTopbar({
  callsign,
  platformStatus,
  onLogout,
  onSearch,
  searchResults,
  searchLoading,
  onSelectResult,
}) {
  const [focused, setFocused]   = useState(false)
  const [query, setQuery]       = useState('')
  const containerRef            = useRef(null)

  const isStable = !platformStatus || platformStatus === 'STABLE_ENCRYPTED' || platformStatus === 'STANDBY'

  const showOverlay = query.length >= 2 && (searchLoading || searchResults !== null)

  const totalResults = searchResults
    ? (searchResults.operators?.length || 0) +
      (searchResults.organizations?.length || 0) +
      (searchResults.events?.length || 0)
    : 0

  function handleChange(e) {
    setQuery(e.target.value)
    onSearch?.(e.target.value)
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      setQuery('')
      onSearch?.('')
    }
  }

  function selectResult(result) {
    setQuery('')
    onSearch?.('')
    setFocused(false)
    onSelectResult?.(result)
  }

  // Close overlay on outside click
  useEffect(() => {
    function handle(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setFocused(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <header
      id="arch-topbar"
      className="fixed top-0 left-0 right-0 z-50 h-12 flex items-center justify-between px-5 gap-4"
      style={{ background: '#0d0d0d', borderBottom: '1px solid #1f1f1f' }}
    >
      {/* LEFT — wordmark + callsign */}
      <div className="flex items-center gap-3 min-w-[180px] shrink-0">
        <span style={{ fontFamily: M, fontSize: '13px', fontWeight: 700, letterSpacing: '0.12em', color: '#f97316' }}>
          ◈ TERMINAL
        </span>
        <span style={{ fontFamily: M, fontSize: '12px', color: '#2a2a2a' }}>|</span>
        <div className="flex items-center gap-1.5">
          <span style={{ fontFamily: G, fontSize: '13px', fontWeight: 500, color: '#e5e5e5' }}>{callsign}</span>
          <span style={{ fontFamily: M, fontSize: '11px', color: '#f97316' }}>◈</span>
        </div>
      </div>

      {/* CENTER — search + overlay */}
      <div ref={containerRef} className="flex-1" style={{ maxWidth: '360px', margin: '0 auto', position: 'relative' }}>
        <div className="relative">
          <Search
            size={12}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: focused ? '#f97316' : '#555555' }}
          />
          <input
            type="text"
            value={query}
            onChange={handleChange}
            onFocus={() => setFocused(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search operators, organizations, events..."
            className="w-full pl-8 pr-3 py-1.5 outline-none transition-all"
            style={{
              fontFamily: G, fontSize: '12px', fontWeight: 400,
              background: '#111111',
              border: `1px solid ${focused ? '#f97316' : '#1f1f1f'}`,
              color: '#e5e5e5',
              boxShadow: focused ? '0 0 0 1px rgba(249,115,22,0.2), 0 0 8px rgba(249,115,22,0.1)' : 'none',
              caretColor: '#f97316',
            }}
          />
          {query.length > 0 && (
            <button
              onClick={() => { setQuery(''); onSearch?.('') }}
              style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: '14px', lineHeight: 1, padding: '0 2px' }}
            >×</button>
          )}
        </div>

        {/* Results overlay */}
        {showOverlay && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: '#111111', border: '1px solid #2a2a2a',
            boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
            zIndex: 200, maxHeight: '420px', overflowY: 'auto',
          }}>
            {searchLoading ? (
              <div style={{ padding: '10px 14px', fontFamily: M, fontSize: '10px', color: '#444', letterSpacing: '0.06em' }}>
                SCANNING...
              </div>
            ) : totalResults === 0 ? (
              <div style={{ padding: '10px 14px', fontFamily: G, fontSize: '12px', color: '#444' }}>
                No results for <span style={{ color: '#666' }}>"{query}"</span>
              </div>
            ) : (
              <>
                {/* Operators */}
                {searchResults.operators?.length > 0 && (
                  <section>
                    <div style={{ padding: '5px 14px 3px', fontFamily: G, fontSize: '9px', fontWeight: 600, color: '#333', letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a' }}>
                      Operators
                    </div>
                    {searchResults.operators.map(op => (
                      <button
                        key={op.id}
                        onMouseDown={e => { e.preventDefault(); selectResult({ type: 'operator', ...op }) }}
                        className="w-full text-left flex items-center gap-3 px-3 py-2"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: '1px solid #161616' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#161616' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <span style={{ fontFamily: M, fontSize: '12px', fontWeight: 700, color: op.is_banned ? '#dc2626' : '#e5e5e5', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {op.username}
                        </span>
                        {op.org_code && (
                          <span style={{ fontFamily: G, fontSize: '9px', color: '#444', background: '#1a1a1a', padding: '1px 5px', flexShrink: 0 }}>
                            {op.org_code}
                          </span>
                        )}
                        <span style={{ fontFamily: G, fontSize: '9px', color: _ROLE_COLOR[op.role] || '#555', flexShrink: 0, width: '72px', textAlign: 'right' }}>
                          {op.role}
                        </span>
                      </button>
                    ))}
                  </section>
                )}

                {/* Organizations */}
                {searchResults.organizations?.length > 0 && (
                  <section>
                    <div style={{ padding: '5px 14px 3px', fontFamily: G, fontSize: '9px', fontWeight: 600, color: '#333', letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a', borderTop: searchResults.operators?.length ? '1px solid #1a1a1a' : 'none' }}>
                      Organizations
                    </div>
                    {searchResults.organizations.map(org => (
                      <button
                        key={org.id}
                        onMouseDown={e => { e.preventDefault(); selectResult({ type: 'organization', ...org }) }}
                        className="w-full text-left flex items-center gap-3 px-3 py-2"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: '1px solid #161616' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#161616' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <span style={{ fontFamily: M, fontSize: '12px', fontWeight: 700, color: '#e5e5e5', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {org.org_code || org.name}
                        </span>
                        {org.org_code && org.org_code !== org.name && (
                          <span style={{ fontFamily: G, fontSize: '10px', color: '#555', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {org.name}
                          </span>
                        )}
                        <span style={{ fontFamily: G, fontSize: '9px', color: org.is_active ? '#22c55e' : '#dc2626', flexShrink: 0 }}>
                          {org.is_active ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </button>
                    ))}
                  </section>
                )}

                {/* Events */}
                {searchResults.events?.length > 0 && (
                  <section>
                    <div style={{ padding: '5px 14px 3px', fontFamily: G, fontSize: '9px', fontWeight: 600, color: '#333', letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: '1px solid #1a1a1a', borderTop: (searchResults.operators?.length || searchResults.organizations?.length) ? '1px solid #1a1a1a' : 'none' }}>
                      Events
                    </div>
                    {searchResults.events.map(ev => (
                      <button
                        key={ev.id}
                        onMouseDown={e => { e.preventDefault(); selectResult({ type: 'event', ...ev }) }}
                        className="w-full text-left flex items-center gap-3 px-3 py-2"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: '1px solid #161616' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#161616' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <span style={{ fontFamily: M, fontSize: '12px', fontWeight: 700, color: '#e5e5e5', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ev.name}
                        </span>
                        <span style={{ fontFamily: G, fontSize: '9px', color: '#555', background: '#1a1a1a', padding: '1px 5px', flexShrink: 0 }}>
                          {ev.event_type}
                        </span>
                        <span style={{ fontFamily: G, fontSize: '9px', color: _STATUS_COLOR[ev.status] || '#555', flexShrink: 0, width: '56px', textAlign: 'right' }}>
                          {ev.status}
                        </span>
                      </button>
                    ))}
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* RIGHT — status pill + logout */}
      <div className="flex items-center gap-4 shrink-0">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 border"
          style={{
            fontFamily: G, fontSize: '11px', fontWeight: 500,
            background: '#111111', border: '1px solid #1f1f1f',
            color: isStable ? '#22c55e' : '#dc2626',
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: isStable ? '#22c55e' : '#dc2626', animation: 'termPulse 2s ease-in-out infinite' }}
          />
          {isStable ? 'Stable' : 'Degraded'}
        </div>

        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 transition-all"
          style={{ fontFamily: G, fontSize: '12px', fontWeight: 500, color: '#f97316', border: '1px solid rgba(249,115,22,0.4)', background: 'transparent' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.08)'; e.currentTarget.style.borderColor = '#f97316' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)' }}
        >
          <LogOut size={11} />
          Logout
        </button>
      </div>
    </header>
  )
}
