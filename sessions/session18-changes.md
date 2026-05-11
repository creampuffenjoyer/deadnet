# Session 18 — Changes from Original Plan

## Removed Features

### Org-Blocked Submissions (removed)
- Original plan: contributing org cannot solve their own contributed challenges (`is_blocked_for_own_org=true`)
- **Removed**: all registered operatives can now solve any published contract regardless of which org contributed it
- `OWN_CONTRACT_BLOCKED` error response removed from claim endpoint
- Per-org dynamic flag variants removed — all orgs use the single shared flag on a contract
- Flag variant generation on partner join removed from `events.py`
- `generate_org_variants` calls removed from `contractor.py`
- `is_blocked_for_own_org` kept in DB/model but always set to `false` on new contracts

### Contractor isolation preserved
- Contractors can still only view and edit challenges their own org contributed
- Host org contractors retain full access to all challenges in their MAJOR event
- Borrowed contractors limited to their own contributed challenges only

---

## Bug Fixes

### `bounty_board.py` — `org.code` AttributeError
- `Organization` model uses `org_code`, not `code`
- Fixed: `host_org.code` → `host_org.org_code` (lines 48, 69)

### `events.py` — `org.code` AttributeError
- Same issue in contractor partner count response
- Fixed: `org.code` → `org.org_code` (line 1163)

### `contracts.py` — Wrong constraint name on ContractAttempt upsert
- Constraint in DB is `uq_attempt_netrunner_contract`, not `uq_attempt_operative_contract`
- Fixed: corrected constraint name in `ON CONFLICT` clause

### `events.py` — LOCAL event registration scoping
- Non-ARCHITECT admins could read registrations for LOCAL events owned by other orgs
- Fixed: added org ownership check for LOCAL events in `list_registrations`

### `admin.py` — `intel_purchases.operative_id` column mismatch
- DB column was named `netrunner_id` (old naming), model expected `operative_id`
- Fixed: renamed DB column via `ALTER TABLE intel_purchases RENAME COLUMN netrunner_id TO operative_id`
- This was crashing `GET /admin/users/{id}/detail` with 500 → showing "Record not found" in admin panel

### `sta_op1` login blocked
- Account had `account_status='PENDING_VERIFICATION'` and uncleared `verification_token`
- Fixed: set `account_status='ACTIVE'`, cleared token, set `org_id=5`

---

## New Endpoints

### `GET /contracts/{id}/solvers`
- Returns ordered list of all operatives who solved a contract in the current event
- Fields: `username`, `claimed_at`, `is_first_blood`, `bc_earned`
- Ordered by `claimed_at` ascending (first solver on top)

### `POST /admin/competition/force-resume`
- Clears stuck competition state without requiring an active event
- Resets: `competition_active=true`, `board_frozen=false`, `competition_halted_by=""`, paused seconds, manual end

---

## UI Changes

### ContractBoard — card ribbon
- Removed solver username from SEIZED ribbon on contract cards
- Card now shows only `SEIZED` badge without the operative's name

### ContractModal — solver history dropdown
- Removed `SEIZED BY [username]` from modal header → now just `CONTRACT SEIZED`
- `X OPERATIVES CLAIMED` text is now a clickable toggle
- Expands into a scrollable list (max height 192px) showing:
  - Rank number, `1ST` badge for first blood, username, BC earned, solve time
  - First solver highlighted in amber/bold
  - Lazy loaded on first open, resets when switching contracts

### ContractModal — removed org-blocked overlay
- `⛔ YOUR ORGANIZATION CONTRIBUTED THIS CHALLENGE` overlay removed
- `OWN_CONTRACT_BLOCKED` error handler removed

### ContractBoard — removed ORG BLOCKED badge
- `ORG BLOCKED` card corner badge removed

### `competition_halted_by` attribution
- Halt/resume now tracks which user halted the competition
- Shown in ContractBoard banner: `Flag submissions are disabled by [username]`
- Admin dashboard shows "Halted by: [username]" in competition control panel
- `[ RESUME OPERATIONS ]` button added for when competition is halted with no active event
