import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Building2,
  Users,
  Trophy,
  MessageSquare,
  ScrollText,
  BookOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import clsx from 'clsx'

// VO1D icon — lucide doesn't have one, use custom SVG
function VoidIcon({ size = 16, color = '#a855f7' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="8,1 15,13 1,13" stroke={color} strokeWidth="1.5" fill="none" />
      <circle cx="8" cy="9" r="1.5" fill={color} />
      <line x1="8" y1="5" x2="8" y2="7.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

const NAV_SECTIONS = [
  {
    label: 'MAIN',
    items: [
      { key: 'overview',      label: 'OVERVIEW',      Icon: LayoutDashboard },
      { key: 'organizations', label: 'ORGANIZATIONS',  Icon: Building2 },
      { key: 'operators',     label: 'OPERATORS',      Icon: Users },
      { key: 'events',        label: 'EVENTS',         Icon: Trophy },
    ],
  },
  {
    label: 'PLATFORM',
    items: [
      { key: 'comms',    label: 'COMMS',       Icon: MessageSquare },
      { key: 'logs',     label: 'LOGS',        Icon: ScrollText },
      { key: 'library',  label: 'CONTRACT LIBRARY',     Icon: BookOpen },
      { key: 'settings', label: 'SETTINGS',    Icon: Settings },
    ],
  },
  {
    label: 'RESTRICTED',
    items: [
      { key: 'void', label: 'V0ID', Icon: null, isVoid: true },
    ],
  },
]

function NavItem({ item, active, collapsed, onClick }) {
  const [hovered, setHovered] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ top: 0 })

  const isVoid  = !!item.isVoid
  const accent  = isVoid ? '#a855f7' : '#f97316'
  const activeGlow = isVoid
    ? '0 0 8px rgba(168,85,247,0.3)'
    : '0 0 8px rgba(249,115,22,0.3)'

  const baseStyle = {
    background: active ? '#161616' : hovered ? '#161616' : 'transparent',
    borderLeft: active ? `3px solid ${accent}` : '3px solid transparent',
    boxShadow: active ? activeGlow : 'none',
    color: active ? accent : hovered ? '#e5e5e5' : '#555555',
    transition: 'all 0.15s ease',
  }

  function handleMouseEnter(e) {
    setHovered(true)
    if (collapsed) {
      const rect = e.currentTarget.getBoundingClientRect()
      setTooltipPos({ top: rect.top + rect.height / 2 })
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => onClick(item.key)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHovered(false)}
        className="w-full flex items-center gap-3 px-3 py-2.5 transition-all"
        style={{ ...baseStyle, fontFamily: 'Geist, sans-serif' }}
        title={collapsed ? item.label : undefined}
      >
        {/* Icon */}
        <span className="shrink-0 flex items-center justify-center w-4 h-4">
          {item.isVoid
            ? <VoidIcon size={15} color={active ? '#a855f7' : hovered ? '#c084fc' : '#555555'} />
            : <item.Icon
                size={15}
                style={{ color: active ? accent : hovered ? '#e5e5e5' : '#555555' }}
              />
          }
        </span>

        {/* Label — only when expanded */}
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              key="label"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden whitespace-nowrap text-left"
              style={{
                color: 'inherit',
                fontSize: '13px',
                fontWeight: active ? 600 : 500,
                letterSpacing: '0.01em',
              }}
            >
              {item.label}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* Tooltip — only when collapsed + hovered */}
      {collapsed && hovered && (
        <div
          className="fixed z-[200] pointer-events-none"
          style={{ left: '64px', top: tooltipPos.top, transform: 'translateY(-50%)' }}
        >
          <div
            className="text-[11px] px-2.5 py-1.5 whitespace-nowrap"
            style={{
              fontFamily: 'Geist, sans-serif',
              fontWeight: 500,
              letterSpacing: '0.01em',
              background: '#1a1a1a',
              border: `1px solid ${accent}`,
              color: accent,
              boxShadow: `0 0 8px rgba(0,0,0,0.6)`,
            }}
          >
            {item.label}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ArchitectSidebar({ activeTab, onTabChange, healthData, onCollapseChange }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('arch_sidebar_collapsed') === 'true' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('arch_sidebar_collapsed', String(collapsed)) } catch {}
    onCollapseChange?.(collapsed)
  }, [collapsed])

  const { orgs = 0, orgsIssue = false, accounts = 0, events = 0 } = healthData || {}

  return (
    <motion.aside
      animate={{ width: collapsed ? 56 : 224 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="fixed left-0 top-12 bottom-0 z-40 flex flex-col overflow-hidden"
      style={{ background: '#0d0d0d', borderRight: '1px solid #1f1f1f' }}
    >
      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden pt-3 pb-2">
        {NAV_SECTIONS.map((section, si) => (
          <div key={section.label} className={clsx(si > 0 && 'mt-4')}>
            {/* Section header — hidden when collapsed */}
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.div
                  key={section.label}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                  className="px-4 pb-1"
                  style={{
                    fontFamily: 'Geist, sans-serif',
                    fontSize: '10px',
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    color: '#3a3a3a',
                    textTransform: 'uppercase',
                  }}
                >
                  {section.label}
                  <div style={{ height: '1px', background: '#1f1f1f', marginTop: '4px' }} />
                </motion.div>
              )}
            </AnimatePresence>

            {section.items.map(item => (
              <NavItem
                key={item.key}
                item={item}
                active={activeTab === item.key}
                collapsed={collapsed}
                onClick={onTabChange}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Bottom health indicator */}
      <div
        className="shrink-0 px-3 py-3"
        style={{ borderTop: '1px solid #1f1f1f' }}
      >
        {collapsed ? (
          /* Collapsed: three colored dots */
          <div className="flex flex-col items-center gap-2 py-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: orgsIssue ? '#dc2626' : '#22c55e' }}
              title="ORGANIZATIONS"
            />
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: '#22c55e' }}
              title={`ACCOUNTS: ${accounts}`}
            />
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: events > 0 ? '#22c55e' : '#555555' }}
              title={`EVENTS: ${events} RUNNING`}
            />
          </div>
        ) : (
          /* Expanded: full health rows */
          <div className="space-y-1.5">
            <HealthRow
              label="ORGS"
              value="NOMINAL"
              dotColor={orgsIssue ? '#dc2626' : '#22c55e'}
            />
            <HealthRow
              label="ACCOUNTS"
              value={`${accounts} REG`}
              dotColor="#22c55e"
            />
            <HealthRow
              label="EVENTS"
              value={`${events} RUNNING`}
              dotColor={events > 0 ? '#22c55e' : '#555555'}
            />
          </div>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="shrink-0 flex items-center justify-center h-9 transition-colors"
        style={{
          borderTop: '1px solid #1f1f1f',
          background: 'transparent',
          color: '#555555',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = '#161616'
          e.currentTarget.style.color = '#e5e5e5'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = '#555555'
        }}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </motion.aside>
  )
}

function HealthRow({ label, value, dotColor }) {
  return (
    <div
      className="flex items-center gap-2"
      style={{ fontFamily: 'Geist, sans-serif', fontSize: '11px' }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: dotColor }}
      />
      <span style={{ color: '#444444', minWidth: '56px', fontWeight: 500 }}>
        {label}
      </span>
      <span style={{ color: '#888888', fontWeight: 400 }}>{value}</span>
    </div>
  )
}
