import { useEffect, useState } from 'react'
import client from '../api/client'

const _defaults = {
  operator: 'Operative',
  team: 'Team',
  handler: 'Handler',
  contractor: 'Contractor',
  maintenanceMode: false,
  bountyBoardPublic: false,
  voidModeEnabled: true,
  registrationLocked: false,
}

let _cached = null
let _promise = null

export function usePlatformTerms() {
  const [terms, setTerms] = useState(_cached || _defaults)

  useEffect(() => {
    if (_cached) { setTerms(_cached); return }
    if (!_promise) {
      _promise = client.get('/public/settings').then(r => {
        _cached = {
          operator:          r.data.term_operator        || _defaults.operator,
          team:              r.data.term_team            || _defaults.team,
          handler:           r.data.term_handler         || _defaults.handler,
          contractor:        r.data.term_contractor      || _defaults.contractor,
          maintenanceMode:   !!r.data.maintenance_mode,
          bountyBoardPublic: !!r.data.bounty_board_public,
          voidModeEnabled:   r.data.void_mode_enabled !== false,
          registrationLocked: !!r.data.platform_registration_locked,
        }
        return _cached
      }).catch(() => _defaults)
    }
    _promise.then(t => setTerms(t))
  }, [])

  return terms
}

export function invalidatePlatformTermsCache() {
  _cached = null
  _promise = null
}
