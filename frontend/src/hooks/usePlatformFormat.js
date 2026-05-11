import { useEffect, useState } from 'react'
import client from '../api/client'

// Module-level cache so settings are only fetched once across all component instances
let _cached = null

export function clearPlatformCache() {
  _cached = null
}

export function usePlatformFormat() {
  const [format, setFormat] = useState(_cached?.format || 'local')
  const [showSection, setShowSection] = useState(_cached?.showSection || 'true')
  const [max_flag_attempts, setMaxFlagAttempts] = useState(_cached?.max_flag_attempts ?? 0)
  const [competition_start, setCompetitionStart] = useState(_cached?.competition_start || null)
  const [competition_end, setCompetitionEnd] = useState(_cached?.competition_end || null)
  const [allow_solo, setAllowSolo] = useState(_cached?.allow_solo ?? true)
  const [competition_active, setCompetitionActive] = useState(_cached?.competition_active ?? null)
  const [competition_manual_end, setCompetitionManualEnd] = useState(_cached?.competition_manual_end || null)
  const [competition_halted_by, setCompetitionHaltedBy] = useState(_cached?.competition_halted_by || null)

  useEffect(() => {
    if (_cached) return
    client.get('/public/settings').then(r => {
      _cached = {
        format: r.data.competition_format || 'local',
        showSection: r.data.show_section_in_name || 'true',
        max_flag_attempts: r.data.max_flag_attempts ?? 0,
        competition_start: r.data.competition_start || null,
        competition_end: r.data.competition_end || null,
        allow_solo: r.data.allow_solo ?? true,
        competition_active: r.data.competition_active || null,
        competition_manual_end: r.data.competition_manual_end || null,
        competition_halted_by: r.data.competition_halted_by || null,
      }
      setFormat(_cached.format)
      setShowSection(_cached.showSection)
      setMaxFlagAttempts(_cached.max_flag_attempts)
      setCompetitionStart(_cached.competition_start)
      setCompetitionEnd(_cached.competition_end)
      setAllowSolo(_cached.allow_solo)
      setCompetitionActive(_cached.competition_active)
      setCompetitionManualEnd(_cached.competition_manual_end)
      setCompetitionHaltedBy(_cached.competition_halted_by)
    }).catch(() => {})
  }, [])

  return { format, showSection, max_flag_attempts, competition_start, competition_end, allow_solo, competition_active, competition_manual_end, competition_halted_by }
}

/**
 * Compute team display name based on competition format.
 * - intercampus: "TeamName (School)"
 * - local + showSection true: "TeamName (Section)"
 * - otherwise: "TeamName"
 */
export function synDisplayName(name, captainSchool, captainSection, format, showSection) {
  if (format === 'intercampus' && captainSchool) return `${name} (${captainSchool})`
  if (format === 'local' && showSection === 'true' && captainSection) return `${name} (${captainSection})`
  return name || ''
}
