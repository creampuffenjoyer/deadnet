# Architect Overview Tab — Revamp Plan
**Reference:** `c:\Users\Administrator\Desktop\screen.png`
**File to edit:** `frontend/src/pages/dashboards/ArchitectDashboard.jsx`

---

## Goal
Revamp the OVERVIEW tab content to match the reference dashboard layout while keeping
DEADNET design tokens, font-mono, sharp edges, and all existing functionality.
No structural changes to the top tab nav or main dashboard shell.

---

## Current Structure (to be replaced)
1. `CompetitionControlPanel` (full width, two-column with clock)
2. 5-stat grid (clickable chips)
3. Two-column: org list (left) + recent activity + platform health (right)

## New Structure

### Row 1 — Stats Strip (full width, 4 chips)
```
[ TOTAL ORGANIZATIONS ]  [ ACTIVE OPERATORS ]  [ ACTIVE EVENTS ]  [ TOTAL PARTICIPANTS ]
        24                      1,242                  03                  4,891
```
- Grid: `grid-cols-4 gap-4`
- Larger value text: `text-4xl`
- Keep clickable navigation per chip
- Remove INACTIVE ORGS from this row (move to platform health)
- LIVE PARTICIPANTS renamed to TOTAL PARTICIPANTS

### Row 2 — Two-column hero section
```
┌─────────────────────────────────────┐  ┌──────────────────┐
│  ACTIVE EVENT HERO CARD  (flex-1)   │  │  RECENT_LOGS     │
│                                     │  │  (w-80)          │
│  [ event name large ]  ● LIVE       │  │                  │
│  Top Operative | Elapsed Time       │  │  log entry...    │
│  Total BC      | Platform Status    │  │  log entry...    │
│  Mission Clock (countdown)          │  │  log entry...    │
│                                     │  │  log entry...    │
│  [ VIEW LIVE STREAM ] [HALT COMP.]  │  │  ...             │
└─────────────────────────────────────┘  └──────────────────┘
```

#### Active Event Hero Card
- Border: `border-success/40 bg-success/5` when live, `border-ghost/20 bg-abyss` when no event
- Header row: label `ACTIVE EVENT` left + `● LIVE_BROADCAST` pill right (animated pulse)
- Event name: `text-3xl font-bold font-mono text-bone` (or text-success when live)
- Two-column data grid below name:
  - TOP OPERATIVE | ELAPSED TIME (live ticking up from start_time)
  - TOTAL BC      | PLATFORM STATUS (STABLE_ENCRYPTED / HALTED / STANDBY)
- Mission Clock (reuse existing `CountdownClock` component)
- Action buttons row:
  - `[ VIEW LIVE STREAM ]` — green border, navigates to `/bounty-board` in new tab
  - `[ HALT COMPETITION ]` / `[ RESUME HACKING ]` — danger/success border (existing logic)
- When no active event: show UPCOMING event info or "NO ACTIVE EVENT" placeholder

#### Recent Logs Panel (right, w-80)
- Header: `RECENT_LOGS` with collapsible toggle (keep existing)
- Show last 7 entries (keep existing)
- Keep existing color coding per action type
- Below logs: `PLATFORM_HEALTH` widget (keep existing)

### Row 3 — Registered Organizations Table (full width)
```
REGISTERED_ORGANIZATIONS                                          [ VIEW ALL ]
──────────────────────────────────────────────────────────────────────────────
ORGANIZATION          OPERATORS   STATUS    ACTION
──────────────────────────────────────────────────────────────────────────────
DLSU                  128         ACTIVE    [ OPEN ]
Laguna State Poly...  256         ACTIVE    [ OPEN ]
Polytechnic Univ...   0           INACTIVE  [ OPEN ]
```
- Replace current org card list with a proper table
- Columns: ORGANIZATION (name + org_code badge), OPERATORS, STATUS pill, ACTION
- Entire row clickable → opens org workspace via `onOpen(u)`
- `[ VIEW ALL ]` button navigates to `?tab=organizations`
- Show max 5 rows, rest hidden (enough for overview)
- Status: `ACTIVE` → `text-success`, `INACTIVE` → `text-danger`
- If org has active event: show animated `● LIVE` indicator beside name

---

## Components to reuse
- `useCountdown` hook — for elapsed time (count UP from start_time) and countdown to end_time
- `CompetitionControlPanel` logic (loadState, act, forceResume) — gutted into the hero card
- `CountdownClock` — embed inside hero card for end-time countdown
- `logColor`, `fmtLogTs` helpers — unchanged

## Components to remove/replace
- `CompetitionControlPanel` — its UI is replaced by the Active Event Hero Card
  - Keep state logic (activeEvent, upcomingEvent, isHalted, busy, msg)
  - Move all fetch + action functions into OverviewTab directly
- Current org list (left column) — replaced by the table in Row 3
- Current two-column layout — replaced by new two-column in Row 2

## State additions needed in OverviewTab
```js
const [activeEvent, setActiveEvent] = useState(null)
const [upcomingEvent, setUpcomingEvent] = useState(null)
const [competitionActive, setCompetitionActive] = useState(null)
const [haltedBy, setHaltedBy] = useState(null)
const [busy, setBusy] = useState(false)
const [actionMsg, setActionMsg] = useState('')
const [liveBoard, setLiveBoard] = useState(null)
// existing: data, recentLogs, activityOpen
```

## Elapsed time counter
- New `useElapsed(startIso)` hook — counts UP every second
- Returns `{ h, m, s }` formatted as `HH:MM:SS`
- Used in hero card "ELAPSED TIME" field

## Data sources
- `/architect/overview` — stats + org list (existing)
- `/architect/log` — recent logs (existing)
- `/events` + `/public/settings` — active event, halted state (move from CompetitionControlPanel)
- `/bounty-board/operatives` — top operative name (existing liveBoard fetch)

---

## Implementation Steps
1. Write `useElapsed` hook above `useCountdown`
2. Rewrite `OverviewTab` — merge CompetitionControlPanel state/logic in, add new layout
3. Build `ActiveEventHero` sub-component (renders hero card)
4. Build `RegisteredOrgsTable` sub-component (renders Row 3 table)
5. Remove `CompetitionControlPanel` component entirely (its logic now lives in OverviewTab)
6. Remove `CountdownClock` component (inline into ActiveEventHero or keep as utility)

---

## Design Rules (unchanged)
- `font-mono` everywhere
- `rounded-sm` max
- Design tokens only (no raw hex)
- `border border-ghost/20` on card wrappers
- Action buttons: ember border primary, danger border for destructive
- Stat values: `text-4xl font-bold`
- Section labels: `text-[10px] tracking-widest text-ghost`
