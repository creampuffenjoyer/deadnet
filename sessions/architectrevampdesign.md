# Architect Dashboard — Organizations Revamp Plan

**File to edit:** `frontend/src/pages/dashboards/ArchitectDashboard.jsx`

---

## Context

The Organizations tab currently renders a sparse table of org cards with a slide-out `ManageOrganizationPanel`. The management system is underdeveloped — it lacks stats, operator browsing, team oversight, and has no real "command center" feel for an Architect managing multiple organizations.

**Goal:** Replace the table + slide-out pattern with a full workspace model. Each org gets its own scoped view that replaces the tab content entirely, giving the Architect a proper per-org command center.

---

## Part A — Organizations Tab Overhaul (Cards + Entry Points)

**What to build:** Replace the current sparse table/card list with a proper org grid that surfaces key stats at a glance and has one clear action: `[ OPEN ]`.

### Layout changes
- Grid layout: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4`
- Each card shows:
  - Org name (large, font-mono, all-caps)
  - `org_code` badge (e.g., `[ DLSU ]`)
  - Active/Inactive status pill (success/danger color)
  - Three stat chips in a row: **OPERATORS**, **TEAMS**, **ACTIVE EVENT**
  - Bottom action bar: `[ OPEN WORKSPACE ]` (full width, ember border)
- Remove the slide-out `ManageOrganizationPanel` entirely — all management moves into the workspace
- Keep the `[ + REGISTER ORGANIZATION ]` button in the tab header

### Stat data
- Operator count: from `univ.user_count` or derived from the org detail endpoint
- Team count: from `univ.syndicate_count` or similar
- Active event: name of active contract event or `—` if none
- If the backend doesn't return these fields yet, show `—` with a `text-ghost` style; wire up properly in Part C

### Search/filter bar
- Text input: filter orgs by name or org_code (client-side filter on the array)
- Status filter: `[ ALL ] [ ACTIVE ] [ INACTIVE ]` tab pills above the grid

### Visual polish
- Hover state: `hover:border-ember/40` on card border
- No animations needed — keep it static and crisp
- Status: `ACTIVE` → `text-success`, `INACTIVE` → `text-danger`

---

## Part B — Org Workspace (Full Scoped View)

**What to build:** When `[ OPEN WORKSPACE ]` is clicked, the entire Organizations tab content is replaced by a scoped org workspace. This is the "command center" for that org.

### Entry point
- `ScopedOrganizationView` component replaces the org list when `scopedOrg` state is set
- Workspace has its own sub-tab system (separate from the main ARCH_TABS)

### Workspace header
```
← BACK TO ALL ORGANIZATIONS

[ DLSU ]  DE LA SALLE UNIVERSITY  •  ACTIVE
Scoped view — changes affect this organization only
                                         [ + CREATE ADMIN ACCOUNT ]
```
- Back button: small, `text-ghost`, top-left
- Org name: large, font-mono, bone
- Status badge inline with name
- `[ + CREATE ADMIN ACCOUNT ]` top-right, ember border

### Workspace sub-tabs
```
[ OVERVIEW ]  [ OPERATORS ]  [ TEAMS ]  [ COMMS ]  [ ASSIGNMENTS ]  [ SETTINGS ]
```

#### OVERVIEW sub-tab
Three stat widgets in a row:
- **OPERATORS** — total count + breakdown by role (ADMIN / HANDLER / NETRUNNER)
- **TEAMS** — total syndicates, active/inactive split
- **TOP OPERATIVE** — username + BC total of highest-ranked member in this org

Below stats:
- **ACTIVE EVENT** card — name, status, BC pool, end date (or "No active event")
- **RECENT ACTIVITY** feed — last 5 claims or BC events scoped to this org (read from `/admin/...` endpoints, filtered by org)
- **QUICK ACTIONS** row: `[ FREEZE BOARD ]`, `[ BROADCAST MESSAGE ]`, `[ EXPORT DATA ]` (stub buttons for now, wire in Part C)

#### OPERATORS sub-tab
- Table of all users in this org (filter by `school` or future `org_id` FK)
- Columns: CALLSIGN, ROLE, BC, CLEARANCE, STATUS (active/banned), LAST SEEN
- Row actions: `[ VIEW ]` (opens existing user detail panel), `[ BAN ]`, `[ RESET PW ]`
- Filter pills: ALL / ADMIN / HANDLER / NETRUNNER / BANNED
- Search by callsign

#### TEAMS sub-tab
- Table of all syndicates in this org
- Columns: TEAM NAME, CAPTAIN, MEMBERS, TOTAL BC, STATUS
- Row actions: `[ VIEW ]` (opens syndicate detail), `[ DISBAND ]`
- No create from here — teams are created by netrunners

#### COMMS sub-tab
- Reuse the existing `TransmissionsTab` logic but pre-filtered to this org
- Post field scoped: `audience = org_id` (or tag with org_code)
- Shows transmissions sent to this org + global transmissions

#### ASSIGNMENTS sub-tab
- Reuse existing `AssignmentsTab` logic scoped to this org's instructors/handlers
- List current handler→syndicate assignments for this org
- `[ + NEW ASSIGNMENT ]` button

#### SETTINGS sub-tab
- Org-level toggleable settings:
  - Org name (editable text field)
  - Org code (editable)
  - Active toggle (ACTIVE / INACTIVE)
  - `[ SAVE CHANGES ]` button (calls PATCH `/admin/organizations/{id}`)
- Danger zone at bottom:
  - `[ ARCHIVE ORGANIZATION ]` — soft-delete / deactivate
  - `[ FORCE RESET ALL PASSWORDS ]` — stub for now

---

## Part C — Cleanup + Backend Wiring

### Remove ManageOrganizationPanel
- Delete the entire `ManageOrganizationPanel` component from ArchitectDashboard.jsx
- Remove `managedOrg` state and all references
- Ensure no orphan imports or state setters remain

### Overview tab org cards
- The Overview tab shows org cards in the stats section — simplify these to just show name, status, and operator count
- Remove any "manage" button from Overview org cards — navigation goes: ORGANIZATIONS tab → workspace only

### Backend changes needed (wire in this part)
- `GET /admin/organizations` — add `user_count`, `syndicate_count` to response (or derive client-side from existing data if already available)
- `GET /admin/organizations/{id}/overview` — returns: operator count by role, team count, top operative, recent activity (last 5 bc_events for users in this org)
- `PATCH /admin/organizations/{id}` — update name, org_code, is_active
- Ensure `/admin/users` can be filtered by `org_id` or `school` for the OPERATORS sub-tab

### State management pattern
```js
// In ArchitectDashboard main component:
const [scopedOrg, setScopedOrg] = useState(null)  // null = show org list, object = show workspace

// In OrganizationsTab:
if (scopedOrg) return <OrgWorkspace org={scopedOrg} onBack={() => setScopedOrg(null)} />
return <OrgList onOpen={(org) => setScopedOrg(org)} />
```

### Create Organization flow
- Keep the existing create modal but move it into the `OrgList` header (already in Part A)
- After successful create: auto-open the new org's workspace (`setScopedOrg(newOrg)`)

---

## Implementation Order

1. **Part A first** — get the new org card grid working with `[ OPEN WORKSPACE ]` wired to set `scopedOrg`; stub the workspace as a placeholder div. Verify the grid layout and cards look correct before touching the workspace.

2. **Part B second** — build `OrgWorkspace` with all 6 sub-tabs. Start with OVERVIEW and OPERATORS (highest value), then TEAMS, COMMS, ASSIGNMENTS, SETTINGS. Use existing component patterns (same table styles, same stat widget style as NetrunnerDashboard).

3. **Part C last** — delete `ManageOrganizationPanel`, clean up Overview tab, wire backend endpoints, add backend routes if missing.

---

## Design Rules (apply throughout)

- Font: `font-mono` everywhere, no sans-serif in data tables
- Border radius: `rounded-sm` max (sharp edges, no `rounded-lg`)
- Colors: only use design tokens — no raw hex values in JSX
- Hover: Tailwind hover utilities only, no `onMouseEnter`/`onMouseLeave`
- Spacing: `space-y-4` between sections, `gap-4` in grids
- Tables: `border border-ghost/20` on table wrapper, `border-b border-ghost/10` on rows, `py-2.5 px-3` on cells
- Stat widgets: `border border-ghost/20 bg-abyss rounded-sm p-4`, label in `text-[10px] text-ghost tracking-widest`, value in `text-xl font-bold text-bone`
- Action buttons: `border border-ember text-ember hover:bg-ember/10` for primary, `border border-ghost/30 text-ghost hover:border-ghost/60` for secondary
- Danger actions: `border border-danger/40 text-danger hover:bg-danger/10`
