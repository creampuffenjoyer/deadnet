# DEADNET — Contracts Dashboard Revamp

This session is a **pure frontend rework** of the Contracts Dashboard used by the Contractor role. No backend changes. No new API endpoints. We are replacing the existing flex-div table layout with a proper card grid + slide-out panel system.

---

## CONTEXT

DEADNET is a cyberpunk-themed CTF competition platform. The aesthetic is **ember red/orange on void black**. The Contractor role manages contracts (challenges) — creating, editing, publishing, and previewing them before an event goes live.

The current contracts table has persistent alignment bugs due to flex-div layout. We are scrapping it entirely and replacing it with a better system.

Stack: **React + Tailwind + Framer Motion**

---

## WHAT TO BUILD

### 1. PAGE LAYOUT

```
┌────────────────────────────────────────────────────────┐
│  CONTRACTS                          [ + NEW CONTRACT ] │
├────────────────────────────────────────────────────────┤
│  [Sort: RARITY ▾]  [Filter pills]  [ ⊞ GRID | ≡ LIST ]│
├────────────────────────────────────────────────────────┤
│                                                        │
│   Card Grid (default)                                  │
│                                                        │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│   │ card     │  │ card     │  │ card     │            │
│   └──────────┘  └──────────┘  └──────────┘            │
│                                                        │
└────────────────────────────────────────────────────────┘
```

- Default view on load: **Card Grid**
- Toggle between Grid and List stored in local component state
- `[ + NEW CONTRACT ]` button behavior unchanged — opens existing create modal/form

---

### 2. FILTER & SORT BAR

Sits between the page header and the card grid. Single row.

**Sort dropdown** (left side):
- Rarity Tier (COMMON → VO1D, ascending)
- BC Value — High to Low
- BC Value — Low to High
- Date Created — Newest
- Date Created — Oldest
- Title — A to Z

**Filter pills** (center, horizontally scrollable):
- ALL (default selected)
- One pill per category (Web, Cryptography, Reverse Engineering, Forensics, OSINT, Hardware, etc. — pull from existing category list)
- PUBLISHED / DRAFT status pills

**Layout toggle** (right side):
- `⊞` Grid icon
- `≡` List icon
- Active icon highlighted in ember color

All filters and sort are client-side — no API calls on filter change.

---

### 3. CARD GRID VIEW

**Grid layout:** `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` with consistent gap.

**Each card shows:**
```
┌─────────────────────────────┐
│ [RARITY BADGE]   [STATUS]   │
│                             │
│ Contract Title              │
│ Category                    │
│                             │
│ BASE BC → NOW BC            │
│                             │
│ [EDIT] [UNPUB/PUB] [DEL]   │
└─────────────────────────────┘
```

**Rarity badge colors (left border + badge bg):**
- COMMON — muted gray
- RARE — blue (`#3b82f6`)
- EPIC — purple (`#a855f7`)
- CLASSIFIED — ember orange (`#f97316`)
- VO1D — deep red (`#dc2626`) with a subtle glow effect

**Status badge:**
- PUBLISHED — green dot + "LIVE" text
- DRAFT — ghost/muted + "DRAFT" text

**BC display:**
- If NOW BC < BASE BC (decay has happened): show BASE BC in muted, arrow, NOW BC in ember
- If no decay: just show BC value in ember

**Card interactions:**
- Clicking anywhere on the card body (not the action buttons) opens the slide-out detail panel
- Hover: subtle ember border glow, slight scale up (`scale-[1.02]`)
- Action buttons: EDIT opens slide-out in edit mode, UNPUB/PUB toggles publish state with confirm, DEL triggers confirm dialog

**Pagination:** Show 20 cards per page. Simple prev/next pagination controls at the bottom. No infinite scroll.

---

### 4. LIST VIEW (toggle)

A proper CSS Grid table replacing the old flex-div layout.

```jsx
const gridCols = "grid grid-cols-[2fr_180px_130px_90px_90px_150px] items-center"
```

Apply `gridCols` to BOTH the header row and every data row. Header cells use `whitespace-nowrap`. This guarantees alignment.

Columns: TITLE | CATEGORY | RARITY | BASE BC | NOW BC | ACTIONS

Same rarity colors applied to the RARITY cell text. Same action buttons as card view.

Clicking a row (not buttons) opens the slide-out panel.

---

### 5. SLIDE-OUT DETAIL PANEL

Slides in from the RIGHT side of the screen. Does not replace the page — overlays it with a backdrop.

**Panel width:** `w-[480px]` on desktop, full width on mobile.

**Panel sections:**

```
┌────────────────────────────────────────┐
│ [RARITY BADGE]          [ × CLOSE ]   │
│                                        │
│ CONTRACT TITLE (editable inline)       │
│                                        │
│ ── DETAILS ────────────────────────── │
│ Category    [dropdown — editable]      │
│ Rarity      [dropdown — editable]      │
│ Base BC     [number input — editable]  │
│ Status      [toggle — editable]        │
│                                        │
│ ── DESCRIPTION ─────────────────────  │
│ [textarea — editable]                  │
│                                        │
│ ── FLAG ────────────────────────────  │
│ [text input — editable, masked]        │
│ [👁 show/hide toggle]                  │
│                                        │
│ ── PREVIEW ─────────────────────────  │
│ Shows how the contract card looks      │
│ to Operatives (read-only preview)      │
│                                        │
│ [ SAVE CHANGES ]    [ DISCARD ]        │
└────────────────────────────────────────┘
```

**Inline edit behavior:**
- All fields are directly editable — no separate edit modal
- Fields show their current values on open
- `[ SAVE CHANGES ]` calls the existing PATCH/PUT contract endpoint
- `[ DISCARD ]` resets fields to original values and closes panel
- If user has unsaved changes and clicks outside/close — show a confirm "Discard changes?" prompt

**Operative preview section:**
- Renders a read-only mock of how the contract challenge card looks to an Operative
- Shows: title, category, rarity badge, BC value, description (truncated), difficulty indicator
- Clearly labeled "OPERATIVE VIEW" so Contractor knows it's a preview

**Animation:** Framer Motion slide-in from right (`x: 480 → x: 0`), backdrop fade in. Close reverses.

---

### 6. CONFIRM DIALOGS

Replace any existing `window.confirm()` with a styled modal dialog for:
- Delete contract: "This contract will be permanently deleted. This cannot be undone."
- Publish/Unpublish: "This contract will go live to all Operatives. Continue?"
- Discard unsaved changes: "You have unsaved changes. Discard them?"

Keep dialogs minimal — just the message, a confirm button (ember), and a cancel button (ghost).

---

### 7. WHAT NOT TO CHANGE

- Do NOT touch any backend API calls — use existing endpoints as-is
- Do NOT change the `[ + NEW CONTRACT ]` create flow
- Do NOT change any other dashboard tabs or pages
- Do NOT add drag-and-drop in this session
- Do NOT change routing

---

## IMPLEMENTATION ORDER

1. Filter + sort bar component
2. Card grid layout + individual contract card component
3. List view with CSS Grid layout
4. Grid/List toggle
5. Slide-out panel with inline edit
6. Confirm dialogs
7. Pagination

---

## VERIFY AFTER IMPLEMENTATION

```
CARD GRID:
[ ] Cards render in correct grid columns
[ ] Rarity colors applied correctly per tier
[ ] VO1D cards have glow effect
[ ] PUBLISHED / DRAFT status visible on card
[ ] BC decay display (base vs now) correct
[ ] Hover animation works
[ ] Clicking card body opens slide-out
[ ] Action buttons work independently of card click
[ ] Pagination works (20 per page)

FILTER & SORT:
[ ] Sort dropdown changes card order
[ ] Category filter pills work
[ ] Status filter (PUBLISHED/DRAFT) works
[ ] ALL pill resets filters
[ ] Filters and sort combine correctly

LIST VIEW:
[ ] Toggle switches between grid and list
[ ] List columns align perfectly (header = data rows)
[ ] No column wrapping in header row
[ ] Clicking row opens slide-out

SLIDE-OUT PANEL:
[ ] Slides in from right with animation
[ ] All fields editable inline
[ ] Flag field masked with show/hide toggle
[ ] Operative preview renders correctly
[ ] SAVE calls correct endpoint
[ ] DISCARD resets fields
[ ] Unsaved changes prompt on close
[ ] Backdrop click triggers unsaved check

CONFIRM DIALOGS:
[ ] Delete confirm appears before deletion
[ ] Publish/Unpublish confirm appears
[ ] Discard changes confirm appears
[ ] No window.confirm() calls remain

GENERAL:
[ ] No regressions on other tabs
[ ] Mobile layout not broken
[ ] Existing create flow unchanged
```