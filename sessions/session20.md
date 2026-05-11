# DEADNET — Architect Dashboard UI/UX Revamp Session 20

This is a **pure frontend rework** of the Architect dashboard shell and overview page. No backend changes. No API changes. No new endpoints. All existing data fetching and functionality must be preserved exactly — we are only changing how it looks and how navigation is structured.

Do NOT touch any other role's dashboard. Do NOT change routing logic. Do NOT remove any existing features.

---

## CONTEXT

DEADNET is a cyberpunk CTF platform. The Architect (`s0L`) is the highest-privilege role — a hardcoded shadow account above Admin. Their dashboard is called the **ARCHITECT'S TERMINAL**.

Stack: React + Tailwind + Framer Motion
Design: dark cyberpunk, monospace typography, ember orange accents

**Design tokens — apply consistently throughout:**
```
Background:       #0a0a0a  (void black)
Surface:          #111111  (card/panel bg)
Border:           #1f1f1f  (subtle borders)
Border active:    #f97316  (ember, active states)
Accent primary:   #f97316  (ember orange)
Accent green:     #22c55e  (live/healthy)
Accent red:       #dc2626  (critical/halt)
Accent blue:      #3b82f6  (partner/comms)
Accent purple:    #a855f7  (V0ID)
Text primary:     #e5e5e5
Text muted:       #555555
Text dim:         #333333
Font:             JetBrains Mono or monospace fallback
```

---

## PART A — OVERALL SHELL STRUCTURE

Replace the current top-tab navigation with a sidebar + slim topbar layout.

```
┌─────────────────────────────────────────────────────┐
│  TOPBAR (h-12, fixed, full width)                   │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ SIDEBAR  │  MAIN CONTENT AREA                       │
│ (fixed,  │  (scrollable, fills remaining space)     │
│  left)   │                                          │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

---

## PART B — TOPBAR

Fixed, full width, height `h-12`. Background `#0d0d0d`, bottom border `1px solid #1f1f1f`.

**Left section:**
- `◈ TERMINAL` wordmark in ember (`#f97316`), bold monospace
- Separator `|` in dim color
- Callsign: `s0L` in white, followed by a small `◈` symbol in ember

**Center section:**
- Global search bar — `w-80`, dark input (`#111111`), border `#1f1f1f`, focus border ember
- Placeholder: `SEARCH OPERATORS, CONTRACTS, EVENTS...`
- Search icon (magnifying glass) inside input left side
- On focus: subtle ember glow border

**Right section:**
- Small platform status pill: `● STABLE` in green or `● DEGRADED` in red — reads from existing platform health data
- `LOGOUT` button — ember outline, small, existing logout functionality unchanged

---

## PART C — SIDEBAR

**Default state:** Expanded (`w-56`), showing icons + labels.
**Collapsed state:** Icon rail only (`w-14`), labels hidden.
**Toggle:** A `‹` / `›` chevron button at the bottom of the sidebar. Clicking toggles expanded/collapsed.
**Transition:** Framer Motion `animate={{ width }}` smooth width transition, `duration: 0.2`.

Sidebar background: `#0d0d0d`, right border: `1px solid #1f1f1f`.
Fixed position, full height, sits below topbar.

**Sidebar sections and nav items:**

```
MAIN
─────
⊞  OVERVIEW
🏛  ORGANIZATIONS
👤  OPERATORS
⚡  EVENTS

PLATFORM
─────────
💬  COMMS
📋  LOGS
🔍  AUDIT TRAIL
⚙   SETTINGS

RESTRICTED
───────────
◈  V0ID
```

Each nav item:
- Icon (lucide-react icon) + label text when expanded, icon only when collapsed
- Active state: ember left border `3px`, ember text, surface background `#161616`
- Hover state: `#161616` background, white text
- Tooltip showing label on hover when sidebar is collapsed

Section headers (MAIN, PLATFORM, RESTRICTED):
- All caps, `text-[10px]`, muted color `#555555`
- Hidden when sidebar is collapsed

**V0ID item special styling:**
- Purple accent `#a855f7` instead of ember
- Subtle purple glow on hover
- Only visible to Architect role (already the case, don't change logic)

**Bottom of sidebar (above toggle):**
- Small platform health indicator:
  ```
  ● ORGS      NOMINAL
  ● ACCOUNTS  21 REG
  ● EVENTS    2 RUNNING
  ```
  Green dots for nominal, red for issues. Collapsed state: just three colored dots stacked.

---

## PART D — OVERVIEW PAGE REDESIGN

Replace the current overview content entirely. All existing data and API calls stay — only the layout and presentation changes.

### D1 — STAT BAR (replaces the 4 big stat cards)

Single horizontal strip at the top of the content area. Height `h-16`. Background `#111111`, border bottom `1px solid #1f1f1f`.

Four stats in a row separated by vertical dividers:

```
ORGANIZATIONS    |  OPERATORS        |  ACTIVE EVENTS    |  TOTAL SOLVES
2 • ALL ACTIVE   |  21 • 18 ONLINE   |  2 • 1 LIVE       |  47 TODAY
```

- Stat number: large, white, tabular-nums
- Label: small, muted, all caps
- Sub-label (the secondary line): ember for active/live counts, muted for neutral
- Vertical dividers: `1px solid #1f1f1f`

### D2 — MAIN CONTENT GRID (below stat bar)

Two column layout: left `65%`, right `35%`. Gap `16px`. Fills remaining viewport height.

---

#### LEFT COLUMN

**Active Event Panel (primary card — most visual weight on the page):**

Background `#111111`, border `1px solid #1f1f1f`. When event is LIVE: ember left border `3px` with subtle ember glow on the entire card border.

Top row inside card:
- Left: event name in large ember text (`text-2xl bold`), e.g. `EVENT 1`
- Right: `● LIVE_BROADCAST` pulsing green dot + text, or `● STANDBY` in muted if not live

Three-column grid inside the card:

```
┌─────────────────┬──────────────────┬─────────────────┐
│ TOP OPERATIVE   │ ELAPSED TIME     │ SYSTEM TIME     │
│ cry0x           │ 01:23:45 ↑       │ 20:04:42        │
│ (ember color)   │ (counting up)    │                 │
├─────────────────┼──────────────────┼─────────────────┤
│ TOTAL SOLVES    │ PLATFORM STATUS  │ STANDBY CLOCK   │
│ 0               │ STABLE_ENCRYPTED │ Wed, 15 Apr 2026│
│                 │ (green)          │                 │
└─────────────────┴──────────────────┴─────────────────┘
```

Below the grid — Contract Progress bar:
```
CONTRACTS SOLVED  ████████░░░░░░░░░░░░  8 / 23
```
Progress bar: ember fill, dark track, percentage shown right side.

Below progress — Recent Solves feed (last 3):
```
RECENT SOLVES
› cry0x solved "SQL Injection Test"  +200 BC   2m ago
› ghost_null solved "Web Recon"      +100 BC   5m ago
› xr3d solved "Test Contract"        +100 BC   8m ago
```
Small, monospace, muted with ember for callsigns.

Bottom action buttons (unchanged functionality):
- `[ VIEW LIVE STREAM ]` — filled green button
- `[ HALT COMPETITION ]` — ember outline button, red glow on hover

**No active event state:**
Center-aligned inside the card:
```
NO ACTIVE OPERATION

[ + CREATE EVENT ]
```
Ghost/muted styling, create button in ember.

---

**Registered Organizations strip (below active event card):**

Header: `REGISTERED_ORGANIZATIONS` + `VIEW ALL ›` link right side.

Horizontal scrollable row of org cards instead of table:

```
┌─────────────────────┐
│ LSPU-SC  ● LIVE     │
│ LSPU Siniloan       │
│ 19 operators        │
│ [ OPEN ]            │
└─────────────────────┘
```

Card: `#161616` background, `1px solid #1f1f1f` border.
LIVE org: green left border. Active no event: muted border. 
`[ OPEN ]` button: ember outline, existing functionality unchanged.

---

#### RIGHT COLUMN

Two panels stacked, each takes ~50% of right column height.

**Top right — Live Standings panel:**

Header: `LIVE STANDINGS` + event name in muted + `VIEW FULL BOARD ›` link.

Top 5 leaderboard:
```
#  CALLSIGN     ORG       SCORE    BAR
1  cry0x        LSPU-SC   2840 BC  ████████████
2  ghost_null   LSPU-SC   2610 BC  ███████████
3  xr3d         LSPU-SC   2200 BC  ██████████
4  null_ptr     STA-CRUZ  1800 BC  ████████
5  h4x0r        LSPU-SC   1200 BC  █████
```

Rank 1: ember text. Relative score bars: ember fill. Org badge: small pill with org code.
If no active event: `NO ACTIVE EVENT` centered in muted text.

---

**Bottom right — Activity Feed panel:**

Header: `ACTIVITY_FEED` + auto-scroll toggle (pill toggle, on by default).

Color-coded entries by type:
- `MAJOR_EVENT` — ember `#f97316`
- `PARTNER` — blue `#3b82f6`
- `SYSTEM` — white `#e5e5e5`
- `SECURITY` — red `#dc2626`
- `OPERATOR` — muted `#888888`

Each entry format:
```
[TYPE_TAG]  ORG_BADGE  short description  timestamp
```

Font size `text-xs`, line height tight, scrollable. New entries animate in from top with Framer Motion `initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}`.

---

## PART E — VISUAL POLISH

Apply these globally to the Architect dashboard only:

1. **Scanline overlay** — a full-viewport pseudo-element with repeating horizontal lines, `opacity: 0.02`, pointer-events none, z-index above background but below content. CSS only, no JS.

2. **Ember glow on active nav item** — `box-shadow: 0 0 8px rgba(249, 115, 22, 0.3)` on the active sidebar item's left border.

3. **Pulsing live indicator** — the `●` dot on LIVE events uses a CSS keyframe pulse animation:
```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

4. **Card hover states** — all clickable cards get `hover:border-[#2a2a2a]` and `transition-colors duration-150`.

5. **Scrollbar styling** — custom thin scrollbar for the activity feed:
```css
scrollbar-width: thin;
scrollbar-color: #1f1f1f #0a0a0a;
```

6. **Tabular numbers** — all numeric values use `font-variant-numeric: tabular-nums` so numbers don't shift width.

---

## PART F — WHAT NOT TO CHANGE

- Do NOT modify any API calls, data fetching, or backend logic
- Do NOT change routing — all existing routes stay
- Do NOT touch any other role's dashboard (Admin, Contractor, Handler, Operative)
- Do NOT remove HALT COMPETITION, VIEW LIVE STREAM, or OPEN button functionality
- Do NOT change the V0ID tab content — only its sidebar entry styling
- Do NOT change LOGOUT functionality
- The global search bar is UI only in this session — wire it to filter visible data client-side if possible, but do not build a backend search endpoint

---

## PART G — IMPLEMENTATION ORDER

1. Create sidebar component with collapse/expand toggle
2. Create new topbar component (wordmark + search + status + logout)
3. Update Architect layout shell to use sidebar + topbar
4. Build stat bar component
5. Rebuild active event panel with progress bar + recent solves
6. Build org cards horizontal strip
7. Build live standings panel
8. Rebuild activity feed with color coding + animation
9. Apply visual polish (scanline, glows, scrollbar, tabular-nums)
10. Verify all existing functionality still works

---

## PART H — VERIFY AFTER IMPLEMENTATION

```
SHELL:
[ ] Sidebar renders expanded by default (w-56)
[ ] Collapse toggle works (shrinks to w-14 icon rail)
[ ] All nav items present with correct icons
[ ] Active item has ember left border
[ ] Tooltips show on collapsed hover
[ ] V0ID item is purple not ember
[ ] Platform health dots show at sidebar bottom
[ ] Topbar fixed, full width, correct sections
[ ] Global search bar renders and focuses correctly
[ ] Platform status pill shows correct state
[ ] LOGOUT still works

OVERVIEW:
[ ] Stat bar shows 4 stats with correct data
[ ] Active event panel shows live data
[ ] Elapsed timer counts up when event is live
[ ] Contract progress bar renders correctly
[ ] Recent solves feed shows last 3 solves
[ ] HALT COMPETITION works unchanged
[ ] VIEW LIVE STREAM works unchanged
[ ] No active event state renders correctly
[ ] Org cards scroll horizontally
[ ] OPEN button works unchanged
[ ] Live standings shows top 5
[ ] Activity feed color codes by type
[ ] Activity feed auto-scrolls

VISUAL:
[ ] Scanline overlay visible but subtle
[ ] Ember glow on active nav
[ ] Live pulse animation on LIVE indicator
[ ] No layout breaks at 1280px, 1440px, 1920px
[ ] Scrollbars styled correctly
[ ] No regressions on any other page
[ ] No existing functionality broken
```