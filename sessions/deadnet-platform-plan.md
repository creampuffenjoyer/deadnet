# 🔴 DEADNET — Custom CTF Platform Project Plan
> Cyberpunk/Futuristic | Red-Orange on Dark | Local Development First | Bounty System

---

## Overview

A fully custom CTF competition platform built from scratch — no CTFd, no open-source frameworks. Themed as **DEADNET**, an underground bounty network where competitors are called **Netrunners**, challenges are **Contracts**, and points are **Bounty Credits (BC)**. Cyberpunk aesthetic with red/orange accents on dark backgrounds. Designed for a **basic academic competition** — not DefCon scale, but polished, complete, and fun to compete in.

---

## DEADNET Terminology Map

| Standard CTF Term | DEADNET Term | Notes |
|---|---|---|
| Challenge | Contract | The thing Netrunners solve |
| Points | Bounty Credits (BC) | Currency of the platform |
| Submit Flag | Claim Bounty | `[ CLAIM CONTRACT ]` button |
| Hints | Intel Drops | Purchased from the Intel Broker |
| Scoreboard | Bounty Board | Live Netrunner + Syndicate rankings |
| Teams | Syndicates | Named crews |
| First Blood | Contract Seized | First Netrunner to claim a contract |
| Solved | Contract Closed | Visual state on card |
| Unsolved | Contract Open | Default state |
| Player | Netrunner | Competitor role name |
| Login | Access DEADNET | UI copy |
| Register | Enlist as Netrunner | UI copy |
| Logout | Go Dark | UI copy |
| Announcements | Network Transmissions | Admin/Supervisor broadcasts |
| Competition starts in... | DEADNET Goes Live In... | Countdown copy |

> **Note:** Admin, Supervisor, and Instructor keep their real names. Categories (Web, Cryptography, Forensics, Pwn, Misc, OSINT) keep their real names. Only competitor-facing flavor text changes.

---

## Bounty System Mechanics

### 1. Contract Rarity Tiers
Every contract is tagged with a rarity that reflects difficulty and BC payout. Set by Supervisor on upload.

| Rarity | Difficulty | Border Glow | BC Range (example) |
|---|---|---|---|
| `[ COMMON ]` | Easy | Grey `#8A8A9A` static | 50–100 BC |
| `[ RARE ]` | Medium | Blue `#4A9EFF` glow | 150–300 BC |
| `[ CLASSIFIED ]` | Hard | Red `#FF2D2D` animated pulse | 400–600 BC |

No separate difficulty bar — rarity tag replaces it entirely.

### 2. Bounty Decay
After the first Netrunner claims a contract, BC value decreases for later claimants. Calibrated for a basic competition — rewarding speed without punishing latecomers too harshly.

| Time Since First Claim | BC Multiplier |
|---|---|
| First claimant (Contract Seized) | 100% |
| Within 1 hour | 90% |
| Within 3 hours | 75% |
| After 3 hours | 60% |
| Minimum floor (always) | 50% |

Decay thresholds are configurable by Admin in platform settings.

### 3. Intel Broker System
Replaces standard hints. A dedicated page styled as a dark web chat interface with an anonymous NPC character **"THE BROKER"**. Each intel drop costs BC and is written in character flavor text — not plain hint text.

- Each contract has up to 3 intel drops (written by Supervisor on contract creation)
- Cost shown upfront: `[ INTEL DROP — COSTS 30 BC ]`
- Confirmation before purchase: `[ SPEND 30 BC FOR INTEL? ]`
- After purchase: THE BROKER "responds" with in-character flavor text intel
- BC deducted + intel unlocked atomically in one DB transaction
- Instructors can view intel drops read-only at no cost

### 4. Clearance Level (Netrunner Rank Title)
Netrunners earn a title based on total BC earned — shown as a badge on profiles and the Bounty Board.

| BC Earned | Clearance Level | Badge Color |
|---|---|---|
| 0 – 500 BC | `NOVICE` | Ghost grey |
| 501 – 1,500 BC | `GHOST` | Muted blue |
| 1,501 – 3,000 BC | `PHANTOM` | Purple `#8A4FFF` |
| 3,001 – 6,000 BC | `SPECTER` | Orange `#FF6B00` |
| 6,001+ BC | `LEGEND` | Ember red `#FF4500` animated glow |

Thresholds configurable by Admin to match total BC available in the competition.

---

## User Roles & Permission Matrix

| Permission | Admin | Supervisor | Instructor | Netrunner |
|---|:---:|:---:|:---:|:---:|
| Access all platform areas | ✅ | ❌ | ❌ | ❌ |
| Manage users & roles | ✅ | ❌ | ❌ | ❌ |
| Platform-wide settings (decay, clearance thresholds) | ✅ | ❌ | ❌ | ❌ |
| Bounty Board freeze / unfreeze | ✅ | ❌ | ❌ | ❌ |
| Broadcast Network Transmissions | ✅ | ✅ | ❌ | ❌ |
| Upload / edit / delete contracts | ✅ | ✅ | ❌ | ❌ |
| Set rarity + BC value on contracts | ✅ | ✅ | ❌ | ❌ |
| Write intel drops | ✅ | ✅ | ❌ | ❌ |
| Toggle contract visibility | ✅ | ✅ | ❌ | ❌ |
| View all contracts (read-only) | ✅ | ✅ | ✅ | ✅ |
| View intel drops (no BC cost) | ✅ | ✅ | ✅ | ❌ |
| View Bounty Board | ✅ | ✅ | ✅ | ✅ |
| View own Syndicate/Netrunner stats | ✅ | ✅ | ✅ | ✅ |
| View **other** Syndicates/Netrunners stats | ✅ | ✅ | ❌ assigned only | ✅ |
| Claim contracts (submit flags) | ❌ | ❌ | ❌ | ✅ |
| Purchase intel drops | ❌ | ❌ | ❌ | ✅ |
| Join / create Syndicates | ❌ | ❌ | ❌ | ✅ |

### Role Definitions

**Admin** — Full platform ownership. Manages users, roles, decay config, clearance thresholds, Bounty Board freeze, and the full audit log. At least one Admin must always exist and cannot be deleted.

**Supervisor** — Contract manager. Uploads, edits, categorizes, sets rarity/BC/intel drops, and publishes contracts. Can broadcast Network Transmissions. Cannot touch user accounts or platform settings.

**Instructor** — Read-only coach. Views contracts and Bounty Board. Accesses stats for their assigned Netrunners/Syndicates only — all others invisible. Intel drops viewable at no BC cost.

**Netrunner** — Competitor. Browses contracts, claims bounties, purchases intel drops, earns BC and Clearance Level titles, belongs to a Syndicate.

### Key Enforcement Rules
- Role in JWT payload, verified server-side every request — frontend guards are UX only
- Instructor assignments managed by Admin only
- Supervisors cannot self-elevate or assign roles
- All role violations return `403 Forbidden`, never `404`

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend | React + Tailwind + Framer Motion | Cyberpunk UI + animations |
| Backend | FastAPI (Python) | Fast, async, real-time ready |
| Database | PostgreSQL | Robust relational data |
| Cache / Rate Limiting | Redis | Sessions, rate limits, board caching |
| Containerization | Docker + Docker Compose | One-command local setup |
| Auth | JWT (access + refresh tokens) | Stateless, role-aware |

---

## Design System

| Token | Value |
|---|---|
| Background (Void Black) | `#0A0A0F` |
| Surface (Abyss) | `#12121A` |
| Primary Accent (Ember) | `#FF4500` |
| Secondary Accent (Flare) | `#FF6B00` |
| Text Primary (Bone) | `#F0F0F0` |
| Text Muted (Ghost) | `#6B6B80` |
| Danger | `#FF2D2D` |
| Success (flag claimed only) | `#00FF88` |
| Common Rarity Glow | `#8A8A9A` |
| Rare Rarity Glow | `#4A9EFF` |
| Classified Rarity Glow | `#FF2D2D` (animated pulse) |
| Font (UI) | Rajdhani |
| Font (Mono/Code) | JetBrains Mono |

**Key visual effects:**
- Glitch on headings — trigger on mount/hover, not looping idle
- Neon glow on interactive elements — intensity increases on hover
- Scanline overlay — 2px lines at ~4% opacity (felt, not seen)
- Slow animated gradient backgrounds
- Sharp edges everywhere — max 2px border radius
- Contract card border glow color matches rarity tier

---

## Session Breakdown

### Session 1 — Foundation + Design System + Auth
**Goal:** Running DEADNET app with styling and all 4 roles working.

**Prompt focus:**
```
Target: local development, docker-compose with hot reload.
Theme: DEADNET — cyberpunk bounty platform. Players = Netrunners. Teams = Syndicates.

Build:
1. Project scaffold (frontend + backend separated)
2. Design system: Tailwind config, colors, fonts, reusable components
   (Button, Card, Input, Badge, Modal, Navbar)
   Include rarity badge variants: COMMON (grey glow), RARE (blue glow), CLASSIFIED (red pulse)
   Include clearance level badge variants: NOVICE, GHOST, PHANTOM, SPECTER, LEGEND
3. Glitch effect component + neon glow CSS utilities
4. Landing page:
   - "DEADNET" in massive display font with glitch on mount
   - Countdown timer: "DEADNET GOES LIVE IN..."
   - CTAs: [ ACCESS DEADNET ] and [ ENLIST AS NETRUNNER ]
5. Login page (ACCESS DEADNET) + Register page (ENLIST AS NETRUNNER) — full cyberpunk styling
6. JWT auth backend: register, login, refresh token endpoints
7. PostgreSQL users table with role enum: ADMIN | SUPERVISOR | INSTRUCTOR | NETRUNNER
   Default on register: NETRUNNER. Seed one ADMIN on first run.
8. Role middleware:
   /admin/* → ADMIN only
   /supervisor/* → ADMIN + SUPERVISOR
   /instructor/* → ADMIN + INSTRUCTOR
   /netrunner/* → NETRUNNER only
   /shared/* → all authenticated
9. Frontend React Router role guards — each role redirects to own dashboard on login
10. Redis session blacklisting
11. .env with local defaults pre-filled
```

**Deliverables:**
- `docker-compose up` works first try
- `DESIGN.md` with tokens and DEADNET terminology
- Auth + role routing fully functional
- Landing page with countdown and DEADNET copy

---

### Session 2 — Contract Board + Bounty System + Intel Broker
**Goal:** Core competition mechanics — contracts, rarity, BC, decay, intel broker.

**Prompt focus:**
```
Build on Session 1. Add:

1. Contract Board (challenge board):
   - Grid grouped by category: Web, Cryptography, Pwn, Forensics, Misc, OSINT
   - Each card: contract title, rarity badge, current BC value, claim count,
     category tag, "CONTRACT SEIZED" ribbon on first blood
   - Border glow matches rarity: grey / blue / red pulse
   - Claimed cards: "CONTRACT CLOSED" green tint overlay

2. Contract modal:
   - Markdown description
   - File attachments
   - Current BC value with decay note if already claimed
   - [ CLAIM CONTRACT ] flag submission button
   - Intel Drops section linking to Intel Broker (NOT a plain hints panel)

3. Intel Broker page (separate page, navbar link):
   - Dark web chat interface aesthetic
   - NPC character "THE BROKER" (pixelated skull avatar)
   - Netrunner picks a contract, sees locked intel drops
   - Each shows cost: [ INTEL DROP — COSTS 30 BC ]
   - Confirm dialog: [ SPEND 30 BC FOR INTEL? ]
   - On purchase: broker "responds" in character flavor-text
   - BC deducted + intel unlocked atomically
   - Instructors: intel visible read-only, no BC cost

4. Backend endpoints:
   GET /contracts — list with rarity, current BC (decay applied)
   GET /contracts/{id}
   POST /contracts/{id}/claim — flag submission, returns BC earned
   GET /contracts/{id}/intel — list intel drops (locked/unlocked state)
   POST /contracts/{id}/intel/{id}/purchase — deduct BC, unlock

5. PostgreSQL schema:
   contracts: title, description, category, rarity, base_bc_value, flag, is_published
   intel_drops: contract_id, cost_bc, content, order_index
   claims: contract_id, netrunner_id, syndicate_id, bc_earned, claimed_at
   intel_purchases: intel_drop_id, netrunner_id, bc_spent, purchased_at

6. Bounty Decay (server-side):
   First claim: 100% | Within 1hr: 90% | Within 3hrs: 75% | After 3hrs: 60% | Floor: 50%
   Thresholds from config (Admin adjustable)

7. Contract Seized (first blood): flagged in DB, ribbon on card
```

**Security this session:**
- Rate limit claims: 5/min per contract per Netrunner
- Constant-time flag comparison
- Secure file serving (backend only, no direct static)
- Intel purchase + BC deduction atomic (same DB transaction)
- Claim + BC award atomic (prevent double-claim race condition)

**Deliverables:**
- Contract board with all 3 rarity tiers renders correctly
- Flag claim works with correct decay BC calculation
- Intel Broker page functional — purchases work, flavor text displays
- Contract Seized ribbon on first claimed contracts

---

### Session 3 — Bounty Board + Syndicates + Profiles
**Goal:** Live Bounty Board, Syndicate system, Clearance Levels, Netrunner profiles.

**Prompt focus:**
```
Build on Sessions 1-2. Add:

1. Bounty Board (scoreboard):
   - Two tabs: [ NETRUNNERS ] and [ SYNDICATES ]
   - Netrunner tab: rank | callsign | clearance level badge | BC | contracts claimed | last claim time
   - Syndicate tab: rank | name | total BC | contracts claimed | members
   - Top 3 special styling: #1 ember glow row, #2 dimmer, #3 subtle
   - Pulsing LIVE indicator
   - Line graph: top 10 Netrunners BC over time (Recharts)
   - Freeze mode: "BOUNTY BOARD FROZEN" stripe overlay
   - Own row: left ember border highlight

2. Clearance Level system:
   - Server-side computed from BC earned
   - NOVICE/GHOST/PHANTOM/SPECTER/LEGEND badges on board + profile + navbar
   - Thresholds from config

3. Syndicate pages:
   - Name, member list, total BC, rank, contracts claimed
   - Member BC contribution breakdown
   - Claimed contracts list with timestamps + BC earned

4. Netrunner profile pages:
   - Callsign, clearance level badge, total BC, rank
   - Claim history timeline
   - Category radar chart

5. Backend endpoints:
   GET /bounty-board/netrunners
   GET /bounty-board/syndicates
   GET /syndicates/{id}
   GET /netrunners/{id}
   WebSocket or polling for live updates

6. Syndicate schema + invite code system
7. instructor_assignments table (instructor → netrunner/syndicate)
   GET /instructor/my-netrunners and /instructor/my-syndicates (assigned only, 403 otherwise)
```

**Deliverables:**
- Bounty Board live, both tabs functional
- Clearance Level badges display correctly
- Syndicate + Netrunner profiles complete
- Instructor scoping enforced server-side

---

### Session 4 — All Dashboards + Security + Docker Polish
**Goal:** 4 role dashboards complete, all security on, clean local dev.

**Prompt focus:**
```
Build on Sessions 1-3. Add:

1. Admin dashboard (ADMIN only):
   - Users table: role badges, assign/change roles, ban, reset password
   - Instructor assignment UI: link instructors → Netrunners/Syndicates
   - Syndicate management: view + disband
   - Bounty Board freeze toggle (industrial switch, confirm dialog)
   - Platform settings: competition name, start/end time, Syndicate size limit,
     decay thresholds (1hr%, 3hr%, floor%), clearance level BC thresholds
   - Audit log: all events, timestamped, IP logged, color-coded by role
   - Network Transmissions broadcaster

2. Supervisor dashboard (ADMIN + SUPERVISOR):
   - Contract CRUD: create/edit/delete/toggle draft-published
   - Contract fields: title, category, rarity, base BC, description, flag,
     file attachments, up to 3 intel drops (each: BC cost + flavor-text content)
   - Contract preview mode: renders as Netrunner sees it, with PREVIEW MODE banner
   - Contract table: sortable by category, rarity, status, BC value
   - Network Transmissions broadcaster

3. Instructor dashboard (ADMIN + INSTRUCTOR):
   - Assigned Netrunners roster with full stats (click to expand)
   - Assigned Syndicates breakdown
   - Read-only Contract Board ([ CLAIM CONTRACT ] → [ VIEW ONLY ] badge)
   - Intel drops visible, no BC cost
   - Live Bounty Board feed
   - Unassigned Netrunners/Syndicates not listed

4. Netrunner dashboard (NETRUNNER only):
   - Clearance level badge, BC earned, rank, contracts claimed
   - My Syndicate widget: name, rank, members, invite code
   - Recent activity: last 5 claims with BC + timestamp
   - BC progress bar toward next Clearance Level

5. Security hardening:
   - Login brute force: lockout after 10 attempts, exponential backoff
   - IP + account rate limiting via Redis
   - CSRF protection on all state-changing endpoints
   - Input validation + sanitization on all endpoints
   - Headers: HSTS, CSP, X-Frame-Options, X-Content-Type-Options
   - All events audit logged with IP + timestamp
   - Admin re-auth (sudo mode, 15min window)
   - Role changes logged, cannot be self-applied

6. Docker polish:
   - docker-compose.yml: frontend, backend, postgres, redis
   - Hot reload: Vite + uvicorn --reload
   - Health checks on all services
   - Persistent postgres volume
   - .env.example fully documented
   - Seed script: default Admin + one per role + 6 mock contracts (2 per rarity)

7. README.md: setup, roles, DEADNET terminology, development tips
```

**Deliverables:**
- All 4 dashboards functional and styled consistently
- Supervisor can create contracts with rarity, BC, intel drops
- Admin can configure decay + clearance thresholds
- `docker-compose up` + seed = fully working platform immediately

---

## Pages Checklist

| Page | DEADNET Name | Role Access | Session | Status |
|---|---|---|---|---|
| Landing / Home | DEADNET Entry | All | 1 | ⬜ |
| Login | Access DEADNET | All | 1 | ⬜ |
| Register | Enlist as Netrunner | All | 1 | ⬜ |
| Contract Board | Active Contracts | All authenticated | 2 | ⬜ |
| Contract Modal | Contract Briefing | All authenticated | 2 | ⬜ |
| Intel Broker | The Broker | Netrunner + Admin | 2 | ⬜ |
| Bounty Board | Bounty Board | All authenticated | 3 | ⬜ |
| Syndicate Page | Syndicate Profile | All authenticated | 3 | ⬜ |
| Netrunner Profile | Operator File | All authenticated | 3 | ⬜ |
| Netrunner Dashboard | Home Base | Netrunner | 4 | ⬜ |
| Instructor Dashboard | Advisor Console | Instructor + Admin | 4 | ⬜ |
| Supervisor Dashboard | Contract Handler | Supervisor + Admin | 4 | ⬜ |
| Admin — Users & Roles | Architect's Terminal | Admin | 4 | ⬜ |
| Admin — Assignments | Instructor Links | Admin | 4 | ⬜ |
| Admin — Settings | Platform Config | Admin | 4 | ⬜ |
| Admin — Audit Log | Event Log | Admin | 4 | ⬜ |

---

## Security Checklist

| Feature | Session | Status |
|---|---|---|
| JWT auth with role in payload | 1 | ⬜ |
| Password hashing (bcrypt/argon2) | 1 | ⬜ |
| Redis session blacklisting | 1 | ⬜ |
| Role-based middleware on all backend routes | 1 | ⬜ |
| Frontend route guards per role | 1 | ⬜ |
| Claim rate limiting (5/min per contract per Netrunner) | 2 | ⬜ |
| Constant-time flag comparison | 2 | ⬜ |
| Secure file serving (backend only) | 2 | ⬜ |
| Intel purchase atomic (BC + unlock in one transaction) | 2 | ⬜ |
| Claim atomic (no double-claim race condition) | 2 | ⬜ |
| Instructor scoped to assigned Netrunners/Syndicates | 3 | ⬜ |
| 403 on cross-role data access (not 404) | 3 | ⬜ |
| Login brute force protection | 4 | ⬜ |
| IP-based rate limiting | 4 | ⬜ |
| CSRF protection | 4 | ⬜ |
| Input validation on all endpoints | 4 | ⬜ |
| Security headers (HSTS, CSP, etc.) | 4 | ⬜ |
| Full audit logging | 4 | ⬜ |
| Admin sudo mode for sensitive actions | 4 | ⬜ |
| Role changes logged + no self-apply | 4 | ⬜ |

---

## Tips for Each Claude Code Session

1. **Start each session** by pasting the master context prompt first, then the session prompt
2. **Review visuals** before functional changes — design drift is easier to fix early
3. **Test `docker-compose up`** after each session
4. **Give specific feedback** — "the CLASSIFIED rarity pulse is too fast, slow it to 2s" not just "fix the card"
5. **Don't skip sessions** — each builds on the last
6. **Calibrate BC values** — for a 4-hour event, make sure total BC across all contracts is achievable

---

## Master Context Prompt (paste at start of every Claude Code session)

```
This is DEADNET — a custom CTF competition platform built from scratch.
NO CTFd, no open-source CTF frameworks.

Theme: Cyberpunk underground bounty network. Basic academic competition level.
- Challenges = Contracts | Points = Bounty Credits (BC) | Submit flag = Claim Contract
- Players = Netrunners | Teams = Syndicates
- Categories stay standard: Web, Cryptography, Forensics, Pwn, Misc, OSINT
- Admin / Supervisor / Instructor role names unchanged

Bounty mechanics:
- Contract Rarity: COMMON (easy, grey glow) | RARE (medium, blue glow) | CLASSIFIED (hard, red pulse)
- Bounty Decay: 100% → 90% (1hr) → 75% (3hr) → 60% (3hr+), floor 50%
- Intel Broker: dark web NPC chat page, intel drops cost BC, written in flavor text
- Clearance Levels: NOVICE → GHOST → PHANTOM → SPECTER → LEGEND (by BC earned)

Design: Red-orange (#FF4500, #FF6B00) on void black (#0A0A0F).
Glitch on headings, neon glow on interactive elements, scanlines, sharp edges.
Fonts: Rajdhani (UI), JetBrains Mono (mono/code).

Stack: React + Tailwind + Framer Motion | FastAPI + PostgreSQL + Redis | Docker + docker-compose.
Local dev only. Hot reload enabled.

Roles (JWT, server-side enforced):
ADMIN — full access
SUPERVISOR — contract management + announcements
INSTRUCTOR — read-only, assigned Netrunners/Syndicates only, intel drops free
NETRUNNER — competes, claims contracts, buys intel, joins Syndicates

Security is first-class. Role enforcement is non-negotiable.
Maintain full design consistency with all previous sessions.
```
Session 6: 

This is Session 5 of DEADNET — competition readiness additions.
Do not change any existing functionality, only add what's listed.

1. ATTEMPT COUNTER (Netrunner-facing)
   - On each contract modal, show attempt counter below the flag input:
     "ATTEMPTS: 3 / 10" in JetBrains Mono, ghost color
   - If max attempts is set to 0 (unlimited) in settings, show "ATTEMPTS: 3" with no denominator
   - When max attempts is reached, disable the flag input and [ CLAIM CONTRACT ] button
   - Show message: "MAX ATTEMPTS REACHED — CONTRACT LOCKED" in red mono
   - Track attempts per contract per Netrunner in the database

2. PRE/POST COMPETITION LOCKED STATES
   Before competition starts (before start time):
   - Contract board shows a full-page overlay: "DEADNET OFFLINE"
   - Large countdown timer: "CONTRACTS GO LIVE IN [ HH : MM : SS ]"
   - Netrunners can still log in, view their profile and Syndicate, but cannot see contracts
   - Bounty Board shows "COMPETITION NOT STARTED" state

   After competition ends (after end time):
   - Contract board becomes read-only — contracts visible but flag input disabled
   - Banner across top: "COMPETITION CLOSED — CONTRACTS LOCKED"
   - Bounty Board unfreezes automatically and shows final rankings
   - "COMPETITION CLOSED" badge on navbar

   Admin/Supervisor/Instructor are not affected by these states — they see everything always

3. DOWNLOADABLE SCOREBOARD
   - On the Bounty Board page, Admin and Supervisor see an [ EXPORT CSV ] button
   - CSV export includes: final rank, callsign, Syndicate name, BC earned,
     contracts claimed, clearance level, registration date
   - Filename format: "DEADNET_final_scoreboard_[date].csv"
   - Also add [ EXPORT PDF ] that generates a clean formatted table
     (use a simple PDF library — no heavy dependencies)
   - Both exports respect the current tab (Netrunners or Syndicates)

4. GLOBAL SOLVE FEED
   - Add a live feed panel on the Bounty Board page (side panel or below the table)
   - Shows recent contract claims: "[callsign] claimed [contract title] for [BC] BC"
   - Feed entries appear with a 30 second delay after actual claim
     (prevents real-time tipping off of which contracts are being solved)
   - Maximum 20 entries visible, oldest drop off
   - Style as a terminal log: dark background, mono font, ember highlight on BC value
   - Contract Seized (first blood) entries get special styling:
     "⚡ [callsign] SEIZED [contract title] — FIRST BLOOD — [BC] BC" in full ember red
   - Feed visible to all roles

5. CONTRACT SEARCH AND TAGS
   - Add a tags field to contracts (set by Supervisor on creation/edit)
   - Example tags: beginner, scripting, network, steganography, reverse, web-app, crypto-classic
   - Tags shown as small monospace badges on contract cards below the category tag
   - Add a search bar above the contract board: searches by title and tags in real time
   - Tags are also filterable — clicking a tag filters the board to matching contracts
   - Backend: add tags column (array/JSON) to contracts table

6. NETRUNNER ACTIVITY TRACKING
   - Track last_seen timestamp per Netrunner in Redis (update on every authenticated request)
   - "Online" = last seen within 5 minutes
   - Bounty Board shows total active count at top: "[ 14 NETRUNNERS ONLINE ]" pulsing ember badge
   - Admin console Operators tab: show green/grey online dot next to each Netrunner's callsign
   - Instructor dashboard: show online dot next to assigned Netrunners only
   - Netrunners cannot see other Netrunners' online status anywhere

7. COMPETITION STATISTICS PAGE
   Accessible at /stats
   - Admin, Supervisor, Instructor: visible during AND after competition
   - Netrunner: visible ONLY after competition ends (redirect to "STATS UNAVAILABLE — 
     COMPETITION IN PROGRESS" if accessed during competition)

   Stats to show:
   OVERVIEW section:
   - Total BC distributed
   - Total contract claims
   - Total unique Netrunners who claimed at least one contract
   - Most active category (most claims)
   - Hardest contract (fewest solves, highest attempt count)
   - Easiest contract (most solves, lowest attempt count)
   - Fastest solve (shortest time between competition start and first claim)
   - Total intel drops purchased

   TOP PERFORMERS section:
   - First blood hall: list of all Contract Seized achievements (contract + Netrunner + time)
   - Most contracts claimed (top 5 Netrunners)
   - Highest BC earned (top 5 Netrunners)

   CATEGORY BREAKDOWN section:
   - Bar chart: claims per category
   - Bar chart: average BC earned per category

   Style: same dark DEADNET aesthetic, Bounty Board-style tables,
   Recharts for all graphs, ember accent colors
   Add [ EXPORT STATS PDF ] button for Admin only — good for adviser presentation

   This is Session 7 of DEADNET — admin panel improvements, 
Netrunner onboarding flow, and profile completeness.
Do not break any existing functionality.

═══════════════════════════════════
PART A — ADMIN CONSOLE IMPROVEMENTS
═══════════════════════════════════s

1. OPERATORS TABLE REDESIGN
   Remove from main table: BC column, email column
   
   New column order:
   # | Callsign | Role (dropdown) | Status badge | 
   Registered date | Actions (VIEW · PWD · BAN)

   Status badge:
   - ACTIVE: ghost grey, rectangular monospace
   - BANNED: red, rectangular monospace
   - UNVERIFIED: orange, if email not yet verified

   Online indicator:
   - Small green/grey dot next to callsign
   - Green = last seen within 5 minutes (from Redis)
   - Grey = offline

2. USER DETAIL SLIDE-OUT PANEL
   Clicking VIEW on any row opens a panel sliding in 
   from the right side. Dark surface, 3px ember top border.
   
   Panel shows:
   IDENTITY section:
   - Callsign + online status dot
   - Full name (OPERATIVE NAME)
   - Email (full, not truncated)
   - Student ID (OPERATOR ID)
   - Section (ASSIGNED UNIT)
   - Year level (DEPLOYMENT CYCLE)
   - Registration date
   - Last login timestamp
   - Last known IP address

   PERFORMANCE section:
   - Current clearance level badge
   - Total BC earned
   - Contracts claimed count
   - Intel drops purchased
   - Current Syndicate (if any, clickable)

   ACCOUNT section:
   - Account status (ACTIVE/BANNED/UNVERIFIED)
   - [ RESET PASSWORD ] button — generates temp password,
     shows it to admin in a confirmation modal with copy button
     styled as: "TEMP ACCESS CODE: [XXXX-XXXX]"
   - [ BAN ACCOUNT ] / [ UNBAN ACCOUNT ] toggle button
   - [ FORCE LOGOUT ] button — invalidates all active 
     JWT tokens for this user via Redis blacklist

3. SETTINGS PAGE IMPROVEMENTS
   Replace ISO text inputs with datetime-local pickers
   styled to DEADNET design (dark bg, ember focus border,
   mono font for time display)

   Add these missing fields grouped into labeled sections
   separated by thin ember divider lines:

   COMPETITION INFO:
   - Competition Name
   - Competition Start (datetime picker)
   - Competition End (datetime picker)
   - Competition Timezone (dropdown, default Asia/Manila)

   REGISTRATION:
   - Registration Open (toggle)
   - Syndicate Registration Open (toggle)
   - Allow Solo Competitors (toggle, default ON)

   SYNDICATE CONFIG:
   - Max Syndicate Size (number input, default 4)

   SCORING CONFIG:
   - Max Flag Attempts Per Contract (number, 0 = unlimited)
     Helper text: "0 = unlimited, recommended 10-20 
     for academic competition"

   BOUNTY DECAY: (existing fields, add helper text)
   - Decay @ 1HR (%) — "recommended: 80-95%"
   - Decay @ 3HR (%) — "recommended: 65-80%"
   - Decay After 3HR (%) — "recommended: 50-70%"
   - Decay Floor (%) — "recommended: 40-60%"

   CLEARANCE LEVELS: (existing fields, no changes)

   SAVE SETTINGS button:
   - Change from outlined red to filled ember red
   - On click: show confirmation dialog
     "Changing decay or clearance settings during an 
     active competition affects ongoing scoring. Confirm?"
     [ CONFIRM SAVE ] and [ CANCEL ]

═══════════════════════════════════════════
PART B — NETRUNNER REGISTRATION & ONBOARDING
═══════════════════════════════════════════

4. UPDATED REGISTRATION FORM
   Registration collects only:
   - Callsign (username)
   - Email
   - Password
   - Confirm Password
   
   Everything else collected in onboarding after first login.
   Add onboarding_complete boolean field to users table
   (default false on registration, true after onboarding done)

5. FIRST-TIME LOGIN ONBOARDING FLOWread
   Triggered when onboarding_complete = false.
   Full-screen flow, cannot be skipped entirely but 
   each step can be navigated back/forward.
   Dark background, cyberpunk styling throughout.

   STEP 1 — OPERATOR INITIALIZATION SEQUENCE
   Full-screen terminal animation, text types out line by line
   with realistic typing speed and cursor blink:
   
   > CONNECTING TO DEADNET...
   > ESTABLISHING ENCRYPTED TUNNEL...
   > IDENTITY VERIFIED: [CALLSIGN]
   > CLEARANCE LEVEL: NOVICE
   > OPERATOR DOSSIER: INCOMPLETE
   > ACTION REQUIRED: COMPLETE OPERATOR PROFILE
   > ...
   
   After 3-4 seconds (or on keypress/click to skip):
   fade transition to Step 2
   
   STEP 2 — COMPLETE YOUR DOSSIER
   Styled as filling out a classified operator file.
   Dark surface card with ember top border, 
   file/dossier aesthetic.
   
   Fields:
   - OPERATIVE NAME (full name, required)
   - OPERATOR ID (student ID, required)
   - ASSIGNED UNIT (section, required, text input)
   - DEPLOYMENT CYCLE (year level, dropdown:
     1st Year / 2nd Year / 3rd Year / 4th Year)
   
   [ SUBMIT DOSSIER ] button — ember filled, Bebas Neue
   
   STEP 3 — SYNDICATE SELECTION
   After dossier submitted. Two options presented:
   
   Left card: [ JOIN A SYNDICATE ]
   - Enter invite code input
   - "Join your crew and share the bounties"
   
   Right card: [ OPERATE SOLO ]  
   - "Go dark. No Syndicate. No split."
   - Subtle note: "You can join a Syndicate later"
   
   Cards separated by "OR" in ember
   Flavor text below: "Syndicates pool intel and split 
   bounty rankings. Choose wisely, Netrunner."
   
   STEP 4 — MISSION BRIEFING
   Quick orientation — 4 info cards in a 2x2 grid:
   
   Card 1 — CONTRACTS
   Icon: target/crosshair
   "Contracts are hacking challenges. Claim them by 
   submitting the correct flag. Harder contracts = 
   more BC."
   
   Card 2 — BOUNTY CREDITS
   Icon: currency/coin
   "BC is your score. Earn it by claiming contracts. 
   Claim early for maximum payout — bounties decay 
   after first blood."
   
   Card 3 — INTEL DROPS
   Icon: message/chat
   "Stuck? Visit THE BROKER. Purchase intel drops 
   for BC. Flavor-text hints from a shady contact. 
   Spend wisely."
   
   Card 4 — CLEARANCE LEVELS
   Icon: shield/badge
   "Earn BC to rank up: NOVICE → GHOST → PHANTOM → 
   SPECTER → LEGEND. Your level shows next to your 
   callsign."
   
   Large [ ENTER DEADNET ] button below grid
   Ember filled, Bebas Neue, full width
   
   On click: set onboarding_complete = true via API,
   redirect to Contract Board (or pre-competition 
   locked state if competition hasn't started)

6. PROFILE SETTINGS PAGE (for all Netrunners)
   Accessible from navbar dropdown → "OPERATOR SETTINGS"
   
   Sections:
   
   IDENTITY (editable):
   - Callsign (username) — editable, unique check
   - Full name
   - Student ID (read-only after set — admin can override)
   - Section
   - Year level
   
   ACCOUNT SECURITY:
   - Change email (requires current password confirm)
   - Change password (current password + new + confirm)
   - Active sessions list: shows all active JWT sessions
     with device/IP + [ REVOKE ] button per session
   
   DANGER ZONE section (red border):
   - [ DELETE ACCOUNT ] — only available before 
     competition starts, disabled during/after competition
   
   Save button per section — not one global save
   Each section saves independently with success toast

7. ADMIN USER DETAIL — SHOW ONBOARDING FIELDS
   Update the slide-out detail panel from Part A 
   to also show the onboarding fields:
   - Full name (OPERATIVE NAME)
   - Student ID (OPERATOR ID)  
   - Section (ASSIGNED UNIT)
   - Year level (DEPLOYMENT CYCLE)
   - Onboarding complete: YES / NO badge
   
   If onboarding not complete, show:
   [ SEND REMINDER ] button that triggers a 
   Network Transmission to that specific Netrunner:
   "Complete your operator dossier to participate 
   in DEADNET. Visit your profile settings."

   This is Session 7 of DEADNET — Competition Reset System 
and Season Management. Do not break existing functionality.

═══════════════════════════════════
PART A — SEASON / COMPETITION MODEL
═══════════════════════════════════

1. DATABASE SCHEMA UPDATES
   Add seasons table:
   - id, name, status (ACTIVE/ARCHIVED/DRAFT)
   - created_at, started_at, ended_at
   - created_by (admin user_id)
   - reset_level used (if created via reset)
   - settings snapshot (JSON — copy of settings at time 
     of archive)

   Add season_id foreign key to:
   - contracts
   - claims
   - intel_purchases
   - bc_events
   - syndicates
   - syndicate_members
   
   All existing data gets assigned season_id = 1 
   (migration script)
   
   Users table does NOT get season_id — accounts 
   are global across seasons

2. ACTIVE SEASON CONTEXT
   All queries for contracts, claims, BC, scoreboard 
   automatically filter by current active season_id
   No existing functionality changes — it just scopes 
   to active season transparently

═══════════════════════════════════
PART B — RESET FLOW
═══════════════════════════════════

3. RESET BUTTON LOCATION
   Admin Console → Settings tab → bottom section 
   labeled "COMPETITION MANAGEMENT" with red/danger 
   section styling (subtle red border, warning icon)
   
   Show current season info:
   - Season name, start date, status
   - Item counts: X contracts, X netrunners, 
     X claims, X syndicates
   
   [ START NEW COMPETITION ] button
   - Filled red, Bebas Neue
   - Disabled with tooltip if competition is 
     currently ACTIVE: 
     "End the competition before resetting"
   - Only enabled when competition status is 
     ENDED or NOT STARTED

4. THREE RESET LEVELS (shown as selectable cards)

   LEVEL 1 — SOFT RESET
   Label: "NEW SEASON — KEEP CONTRACTS"
   Description: "Archives all scores and claims. 
   Keeps all contracts published and ready. 
   Keeps Syndicates intact. 
   Use for: same challenges, new competitors."
   What resets: BC, claims, clearance levels, 
   intel purchases
   What carries forward: contracts, syndicates, 
   netrunner accounts

   LEVEL 2 — MEDIUM RESET  
   Label: "NEW SEASON — CLEAR CONTRACTS"
   Description: "Archives all scores and claims. 
   Moves all contracts to draft (unpublished). 
   Keeps Syndicates and accounts.
   Use for: new semester, new challenges."
   What resets: BC, claims, clearance levels, 
   intel purchases, contracts → draft
   What carries forward: netrunner accounts, 
   syndicates (empty of stats)

   LEVEL 3 — HARD RESET
   Label: "FULL WIPE — KEEP ACCOUNTS ONLY"
   Description: "Archives everything. Deletes all 
   contracts. Dissolves all Syndicates. Resets all 
   Netrunner stats, BC, clearance levels, and 
   onboarding status. User login accounts preserved."
   What resets: everything except user accounts
   Warning badge: "MOST DESTRUCTIVE" in red

5. THREE-STEP CONFIRMATION FLOW

   STEP 1 — SELECT RESET LEVEL
   Show the 3 level cards, admin selects one
   Selected card gets ember border highlight
   [ CONTINUE ] button

   STEP 2 — TYPE TO CONFIRM
   Show summary of what will be affected:
   "This action will archive:
   - [X] contracts
   - [X] claims  
   - [X] BC event records
   - [X] Syndicate records
   - [X] Intel purchase records"
   
   Text input: "Type the competition name to confirm"
   Input must exactly match current competition name
   [ CONFIRM ] button disabled until text matches
   [ CANCEL ] button always visible

   STEP 3 — FINAL WARNING + AUTO BACKUP
   Before executing, system generates backup:
   "Generating data snapshot before reset..."
   Progress indicator while backup generates
   
   Once backup ready:
   "Backup complete. Download before proceeding."
   [ DOWNLOAD BACKUP ] button (JSON bundle)
   
   Checkbox: "I have downloaded or do not need 
   the backup" — must be checked to proceed
   
   [ EXECUTE RESET ] button — red filled, only 
   enabled after checkbox checked
   [ ABORT ] button

6. RESET EXECUTION
   Show progress screen while reset runs:
   Terminal-style output:
   > ARCHIVING CURRENT SEASON...
   > MIGRATING CLAIMS TO ARCHIVE...
   > RESETTING BC RECORDS...
   > CLEARING CONTRACTS... (Level 2/3 only)
   > DISSOLVING SYNDICATES... (Level 3 only)
   > RESETTING NETRUNNER PROFILES... (Level 3 only)
   > INITIALIZING NEW SEASON...
   > RESET COMPLETE.
   
   After completion:
   - New season created with status DRAFT
   - Admin redirected to Settings to configure 
     new competition name + dates
   - Success banner: "NEW SEASON INITIALIZED — 
     Configure competition settings to begin"
   - 5 minute cooldown on reset button after 
     completion (countdown shown)

7. AUDIT LOG ENTRY
   Permanent, undeletable log entry on reset:
   - Timestamp
   - Admin callsign
   - Reset level used
   - Items affected (counts)
   - Backup generated: yes/no
   - Season archived: season name + id

═══════════════════════════════════
PART C — SEASON ARCHIVE VIEWER
═══════════════════════════════════

8. ARCHIVE PAGE
   Location: Admin Console → new tab "SEASONS"
   
   Shows list of all past seasons:
   - Season name, dates, status (ARCHIVED)
   - Final stats: total BC distributed, 
     contracts count, netrunners participated
   - [ VIEW ] button per season

9. ARCHIVED SEASON VIEW
   Read-only view of a past season showing:
   - Final Bounty Board (Netrunner + Syndicate tabs)
   - Competition Stats page (same as /stats)
   - Contract list (read-only, shows solve counts)
   - Timeline of competition events
   
   All data is read-only — nothing editable
   
   Export options (Admin only):
   [ EXPORT SCOREBOARD CSV ]
   [ EXPORT FULL STATS PDF ]
   [ EXPORT RAW DATA JSON ]
   
   Style: same DEADNET aesthetic but with a subtle 
   "ARCHIVED SEASON" banner across the top to make 
   clear this is historical data

10. NAVBAR SEASON INDICATOR
    Small indicator in admin navbar showing:
    "SEASON 2 — ACTIVE" or "SEASON 1 — ARCHIVED"
    in mono ghost text
    Clicking it opens season selector dropdown 
    (for admins to switch archive view context)

    This is Session 9 of DEADNET — The Architect Account.
A hardcoded shadow account that exists outside the normal
role system. Invisible to all other roles including Admin.
Architect callsign: s0L

═══════════════════════════════════════
PART A — ARCHITECT ACCOUNT IMPLEMENTATION
═══════════════════════════════════════

1. HARDCODED CREDENTIALS (no database entry)
   Store in .env file only:
   
   ARCHITECT_CALLSIGN=s0L
   ARCHITECT_PASSWORD=[ you set this — strong password ]
   ARCHITECT_SECRET=[ random 64 char string for JWT signing ]
   
   The Architect account has NO row in the users table.
   It does not exist in the database at all.
   It cannot be found by any database query.

2. ARCHITECT AUTH MIDDLEWARE
   Before normal auth flow, add a check:
   
   On POST /api/auth/login:
   - If credentials match ARCHITECT_CALLSIGN + 
     ARCHITECT_PASSWORD from .env:
     * Do NOT process through normal user auth
     * Issue a special architect JWT signed with 
       ARCHITECT_SECRET (separate from normal JWT_SECRET)
     * JWT payload: 
       { role: "ARCHITECT", sub: "s0L", iat, exp }
     * Normal users can never receive this role value
     * Return same response shape as normal login
       so nothing looks different from outside
   
   - Normal login proceeds as usual for all other credentials

3. ARCHITECT JWT VERIFICATION
   Add architect token check to all protected routes:
   - Check if token is signed with ARCHITECT_SECRET
   - If yes: grant full access, bypass all role checks
   - If no: proceed with normal role verification
   
   Architect token never touches the users table.
   No DB query is made to verify architect identity —
   it's purely cryptographic.

4. ARCHITECT SESSION
   - Architect tokens expire in 8 hours (shorter than normal)
   - No refresh token for architect — re-login required
   - Architect login is NOT logged in the main audit log
   - Architect actions logged to separate architect_log table:
     (id, action, target, metadata, timestamp)
   - architect_log never appears in Admin audit log viewer

═══════════════════════════════════════
PART B — INVISIBILITY RULES
═══════════════════════════════════════

5. THE ARCHITECT IS INVISIBLE EVERYWHERE

   Every query that lists, counts, or searches users
   must never return the Architect — but since the 
   Architect has no DB row, this is automatic.
   
   Additional invisibility rules:
   
   - Bounty Board: Architect never appears
     (no DB row = not in any ranking query)
   
   - Online indicators: Architect last_seen 
     never written to Redis
   
   - Admin Operators table: Architect never appears
   
   - Audit log: Architect actions go to architect_log
     only — never main audit_logs table
   
   - Network Transmissions: Architect cannot 
     send transmissions (would show sender name)
   
   - Stats page: Architect excluded from all counts
     (automatic — no DB row)
   
   - Season reset: Architect account unaffected
     by any reset — it's not in the DB
   
   - The /v01d page: Architect can access normally
     when logged in — auth check passes since 
     architect JWT is valid

6. LOGIN PAGE BEHAVIOR
   Login page looks and behaves identically 
   for Architect credentials vs normal credentials.
   No visual difference. No special UI.
   Failed login shows same generic error as always.
   Success redirects to Architect dashboard.

═══════════════════════════════════════
PART C — ARCHITECT DASHBOARD
═══════════════════════════════════════

7. ARCHITECT DASHBOARD ROUTE: /architect/dashboard

   This route:
   - Returns 404 for everyone except Architect JWT
   - Not linked anywhere in the platform
   - Not in any nav, sitemap, or route list
   
   The dashboard is a superset of Admin Console
   with additional sections only Architect sees.
   
   Architect navbar (replaces normal navbar when 
   Architect is logged in):
   - No role badge shown (no [ NETRUNNER ] or [ ADMIN ])
   - Callsign shows as: s0L
   - A subtle [ ◈ ] symbol next to callsign — 
     no label, no tooltip
   - Navigation: same as admin + V01D tab
   - [ GO DARK ] logout

8. ARCHITECT CONSOLE TABS:
   
   OPERATORS (same as Admin — full user management)
   COMMS (same as Admin — transmissions)
   SETTINGS (same as Admin — platform config)
   ASSIGNMENTS (same as Admin — instructor links)
   SYNDICATES (same as Admin — syndicate management)
   AUDIT LOG (same as Admin — main audit log)
   
   ARCHITECT LOG (exclusive — Admin cannot see):
   - Shows architect_log entries only
   - Timestamped list of all architect actions
   - Architect can clear this log (Admin cannot)
   
   [ V01D ] TAB (exclusive — Admin cannot see):
   - Full VO1D management (moved from Admin here)
   - List of all 4 VO1D contracts with claim counts
   - Who has V01D ACCESS badge (callsign + timestamp)
   - Who has claimed each contract
   - Enable/disable per contract toggle
   - Total void BC distributed
   - Void attempt counts per Netrunner per contract
   - [ RESET ATTEMPTS ] button per Netrunner 
     per contract (Admin cannot do this)

═══════════════════════════════════════
PART D — ADMIN CONSOLE CHANGES
═══════════════════════════════════════

9. REMOVE FROM ADMIN CONSOLE:
   - Remove [ V01D ] tab entirely from Admin Console
   - Admin can no longer see void_claims data
   - Admin can no longer see V01D ACCESS badge 
     status in user detail panel
   - Remove void_bc from Admin user detail panel
   - The [ V ] badge on Bounty Board is hidden 
     from Admin view — Admin sees normal BC totals only
   - Admin exported CSV shows main_bc only 
     (already the case — no change needed)

10. ADMIN RETAINS:
    Everything else unchanged:
    - Full user management
    - Platform settings including decay thresholds
    - Bounty Board freeze
    - Instructor assignments
    - Season management
    - Main audit log
    - Announcements

═══════════════════════════════════════
PART E — TERMINAL EASTER EGG UPDATE
═══════════════════════════════════════

11. UPDATE HIDDEN TERMINAL cd /architect COMMAND
    
    Current behavior for all users:
    "ACCESS DENIED — this directory belongs to s0L.
    you are not s0L."
    
    New behavior — check if logged in user is Architect:
    
    IF Architect JWT detected:
    "> IDENTITY CONFIRMED — WELCOME HOME, s0L"
    "> ARCHITECT CONSOLE AVAILABLE"
    "> REDIRECTING TO /architect/dashboard..."
    (closes terminal, navigates to /architect/dashboard)
    
    IF normal user:
    (keep existing response unchanged)
    "ACCESS DENIED — this directory belongs to s0L.
    you are not s0L."
    
    This means the terminal behaves differently 
    depending on who is logged in — a detail only 
    the Architect would ever witness.

═══════════════════════════════════════
PART F — SECURITY NOTES
═══════════════════════════════════════

12. SECURITY REQUIREMENTS:

    - ARCHITECT_SECRET must be different from JWT_SECRET
      — architect tokens cannot be forged using the 
      normal secret even if JWT_SECRET is compromised
    
    - ARCHITECT_PASSWORD must be set to a strong 
      password in .env — not a default value
      Add validation on startup: if ARCHITECT_PASSWORD 
      is missing or equals a default placeholder, 
      refuse to start and log an error
    
    - Rate limit architect login attempts same as 
      normal login (10 attempts before lockout)
      but lockout stored in Redis with separate key:
      "architect_lockout" not mixed with user lockouts
    
    - Architect JWT contains no exploitable user_id —
      sub claim is just the string "s0L", not a DB ID
      Backend never does a DB lookup on architect JWT
    
    - Add to .env.example:
      ARCHITECT_CALLSIGN=s0L
      ARCHITECT_PASSWORD=CHANGE_THIS_BEFORE_DEPLOYMENT
      ARCHITECT_SECRET=GENERATE_64_CHAR_RANDOM_STRING
      With comment: # ARCHITECT — do not share these values

13. DO NOT:
    - Store architect credentials anywhere in the DB
    - Log architect login attempts in main audit_log
    - Include architect in any user count or statistic
    - Allow architect password reset through any UI
    - Show any UI hint that an architect account exists
    - Allow normal JWT_SECRET to verify architect tokens