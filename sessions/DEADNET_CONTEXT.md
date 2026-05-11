# DEADNET — Project Context Document
> Paste this at the start of a new Claude Code conversation to resume development.
> Working directory: `E:/Code/deadnet`

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite, Tailwind CSS, Framer Motion, Recharts |
| Backend | FastAPI (Python 3.12), async SQLAlchemy, Pydantic v2 |
| Database | PostgreSQL 16 |
| Cache / Sessions | Redis 7 |
| Auth | JWT (access 15min + refresh 7d), Redis blacklist on logout |
| Email | fastapi-mail (SMTP) |
| Deployment | Docker Compose (4 services: frontend :5173, backend :8000, postgres, redis) |

**Key pins:** `bcrypt==4.0.1` (passlib incompatible with 4.1+ on Python 3.12)

---

## Terminology (in-universe)

| Real term | DEADNET term |
|-----------|-------------|
| Challenges | Contracts |
| Points | BC (Bounty Credits) |
| Submit Flag | Claim |
| Teams | Syndicates |
| Player | Netrunner |
| Hints | Intel Drops |
| Scoreboard | Bounty Board |
| First Blood | Contract Seized |
| Logout | Go Dark |
| Admin panel | Dashboard |

---

## Roles (hierarchy highest → lowest)

| Role | Notes |
|------|-------|
| **ARCHITECT** | Virtual role — no DB row, credential-only JWT (`s0L`). Returns 404 to all non-Architect users. Full platform visibility across all universities. |
| **ADMIN** | DB user. Full access within their university scope. |
| **SUPERVISOR** | DB user. Contract CRUD, stats. Scoped to their university. |
| **INSTRUCTOR** | DB user. Read-only board, assigned roster. Scoped to their university. |
| **NETRUNNER** | DB user. Competition participant. Scoped to their university. |

`ROLE_HIERARCHY` dict: ARCHITECT=99, ADMIN=50, SUPERVISOR=30, INSTRUCTOR=20, NETRUNNER=10

`ArchitectUser` sentinel (in `deps.py`) — returned by `get_current_user` for Architect JWTs. Has `.username`, `.role.value == "ARCHITECT"`, `.university_id = None`.

Staff (SUPERVISOR/INSTRUCTOR) require email verification → admin approval before ACTIVE.

---

## University Scoping (Session 16 — multi-university architecture)

Every list/aggregate endpoint accepts `university_id: Optional[int] = None` query param.

`get_university_scope(current_user, architect_override=None)` in `app/utils/roles.py`:
- ARCHITECT → returns `architect_override` (None = all data, int = narrow to one university)
- Everyone else → returns `current_user.university_id`

Pattern used everywhere:
```python
scope = get_university_scope(current_user, university_id)
if scope is not None:
    query = query.where(Model.university_id == scope)
```

Tables with `university_id` FK (nullable, SET NULL on delete):
`users`, `events`, `contracts`, `syndicates`, `operator_requests`, `registration_requests`, `corrupted_contracts`, `bc_events`, `architect_log`, `transmissions`

---

## Database Models

### Core
- **User** — UUID PK, username, email, hashed_password, role enum, university_id FK, is_banned, is_verified, account_status, bc_total, void_bc, void_access, school, section, student_id, full_name, year_level, onboarding_complete, last_login, last_ip, force_logout_after
- **University** — Integer PK, name (unique), short_name, description, is_active, created_by (callsign string), created_at, updated_at
- **PlatformSettings** — key/value string pairs

### Competition
- **Contract** — id, title, description, flag, category, difficulty, bc_value, is_published, is_void, first_blood_id, event_id, season_id, university_id
- **IntelDrop** — id, contract_id, content, bc_cost, order_index
- **Claim** — id, netrunner_id, contract_id, event_id, season_id, bc_earned, claimed_at
- **IntelPurchase** — id, netrunner_id, intel_drop_id, event_id, season_id, bc_spent
- **BcEvent** — id, netrunner_id, syndicate_id, event_type, bc_delta, bc_total_after, contract_id, event_id, season_id, university_id
- **ContractAttempt** — failed flag attempts
- **CorruptedContract** / **CorruptedClaim** / **CorruptedAttempt** — parallel challenge type

### Social
- **Syndicate** — id, name, invite_code, captain_id, event_id, season_id, university_id, bc_total
- **SyndicateMembership** — syndicate_id, netrunner_id, event_id, season_id, university_id
- **NetworkTransmission** — id, title, body, pinned, author_id, university_id, created_at

### Events & Seasons
- **Event** — id, name, status (DRAFT/ACTIVE/COMPLETED), university_id, start_at, end_at
- **EventRegistration** / **EventRemoval** — per-event participant tracking
- **Season** — Integer PK, name, status (DRAFT/ACTIVE/ARCHIVED), reset_level_used, settings_snapshot JSON, created_by FK
- **RegistrationRequest** — staff approval audit trail (survives account deletion), university_id FK
- **OperatorRequest** — in-competition requests from Netrunners

### Auth / Admin
- **Notification** — user_id, message, is_read, created_at
- **ArchitectLog** — action, target, extra JSON, timestamp, university_id

### V01D (Easter Egg)
- **VoidClaim** / **VoidAttempt** — separate from regular claims
- VO1D contracts: `season_id=NULL` (immune to resets), `is_void=True`

---

## Backend File Structure

```
backend/app/
├── main.py              # FastAPI app, lifespan/migrations/_seed, all router registration
├── config.py            # pydantic-settings from .env
├── database.py          # async SQLAlchemy engine + Base + get_db
├── deps.py              # get_current_user, ArchitectUser sentinel, require_* dependencies
├── redis_client.py      # blacklist, force_logout, rate limits, reset timestamps
├── models/
│   ├── user.py          # User, UserRole, AccountStatus
│   ├── university.py    # University
│   ├── contract.py      # Contract, IntelDrop, Claim, IntelPurchase, BcEvent, VoidClaim, VoidAttempt, ContractAttempt
│   ├── corrupted_contract.py
│   ├── syndicate.py     # Syndicate, SyndicateMembership
│   ├── event.py         # Event, EventStatus
│   ├── event_registration.py
│   ├── season.py        # Season, SeasonStatus
│   ├── settings.py      # PlatformSettings
│   ├── transmission.py  # NetworkTransmission
│   ├── registration_request.py
│   ├── request.py       # OperatorRequest
│   ├── notification.py
│   └── audit.py         # ArchitectLog
├── routers/
│   ├── auth.py          # /auth/* — register, login, verify, refresh, logout, me, change-password, forgot/reset-password, staff registration, registration requests
│   ├── public.py        # /public/settings, /public/universities (no auth)
│   ├── contracts.py     # /contracts/* — list, detail, claim, intel, attachments
│   ├── files.py         # /files/{filename} — auth-gated file serving
│   ├── bounty_board.py  # /bounty-board/netrunners, /syndicates, /graph, /syndicate-graph, /feed
│   ├── syndicates.py    # /syndicates/* — CRUD, join, leave, transfer captaincy
│   ├── netrunners.py    # /netrunners/ — public profiles
│   ├── netrunner.py     # /netrunner/* — dashboard, settings, complete-onboarding, profile
│   ├── transmissions.py # /transmissions/*
│   ├── admin.py         # /admin/* — users, settings, assignments, board-freeze, seasons, reset
│   ├── supervisor.py    # /supervisor/contracts/*
│   ├── instructor.py    # /instructor/my-netrunners, /my-syndicates
│   ├── stats.py         # /stats (ADMIN/SUPERVISOR/INSTRUCTOR only)
│   ├── requests.py      # /requests/* — OperatorRequests
│   ├── notifications.py # /notifications/*
│   ├── events.py        # /events/* — event CRUD + registration
│   ├── universities.py  # /universities/* — Architect-only CRUD + stats
│   ├── architect.py     # /architect/log, /architect/me
│   ├── void.py          # /v01d/* — VO1D contracts, claims, admin
│   ├── corrupted_contracts.py  # /corrupted-contracts/*
│   └── shared.py        # placeholder
├── schemas/
│   ├── auth.py          # RegisterRequest, LoginRequest, TokenResponse, UserOut
│   └── contract.py      # ContractOut, ContractDetailOut, IntelDropOut, ClaimRequest/Response
├── services/
│   └── email_service.py # send_verification_email, send_password_reset_email, send_approval_email, etc.
└── utils/
    ├── security.py      # hash_password, verify_password, constant_time_compare
    ├── jwt_utils.py     # create/decode access/refresh/pending/architect tokens
    ├── decay.py         # BC decay schedule (calculate_bc_earned, current_bc_value)
    ├── rate_limit.py    # claim rate limit, brute-force lockout, flag attempt tracking
    ├── clearance.py     # get_clearance_level(bc_total, settings) → NOVICE/GHOST/PHANTOM/SPECTER/LEGEND
    ├── event.py         # get_current_event_id(db)
    ├── season.py        # get_current_season_id(db)
    ├── roles.py         # ROLE_HIERARCHY, get_university_scope()
    └── architect.py     # validate_architect_passwords()
```

---

## Frontend File Structure

```
frontend/src/
├── main.jsx             # Console signature, ↑↑↓↓ hint
├── App.jsx              # All routes, PrivateRoute/RoleRoute/ArchitectRoute
├── api/client.js        # axios instance, /auth/refresh interceptor on 401
├── context/AuthContext.jsx  # login/logout/register, loginWithTokens, _needsOnboarding flag
├── router/
│   ├── PrivateRoute.jsx
│   ├── RoleRoute.jsx
│   └── ArchitectRoute.jsx
├── hooks/
│   ├── useEventStatus.js
│   ├── useMyRegistration.js
│   └── usePlatformFormat.js
├── components/
│   ├── ui/              # Button, Card, Input, Badge, Modal, Navbar, Footer, OfflineLock, RegistrationModal
│   ├── effects/         # GlitchText, Scanlines, VoidTerminal (↑↑↓↓S0L key sequence)
│   ├── cc/CCBanner.jsx
│   └── ContractModal.jsx
├── pages/
│   ├── Landing.jsx      # Countdown, fragment hints
│   ├── Login.jsx        # ForgotModal, unverified resend inline
│   ├── Register.jsx     # Netrunner registration + SuccessScreen
│   ├── RegisterSupervisor.jsx  # StaffRegisterPage (role=supervisor), university dropdown
│   ├── RegisterInstructor.jsx  # Same pattern as supervisor, university dropdown
│   ├── VerifyEmail.jsx
│   ├── ResetPassword.jsx
│   ├── PendingApproval.jsx
│   ├── Onboarding.jsx   # 4-step: terminal → dossier (university dropdown) → syndicate → briefing
│   ├── StaffOnboarding.jsx
│   ├── ContractBoard.jsx
│   ├── IntelBroker.jsx
│   ├── BountyBoard.jsx  # Recharts LineChart, 30s poll, freeze overlay
│   ├── SyndicatePage.jsx
│   ├── NetrunnerProfile.jsx  # RadarChart, void badges
│   ├── Events.jsx
│   ├── Stats.jsx        # ADMIN/SUPERVISOR/INSTRUCTOR only
│   ├── ProfileSettings.jsx  # identity edit, change-password, revoke-sessions, delete-account
│   ├── VoidBoard.jsx    # /v01d route — 4 VO1D contracts
│   ├── NotFound.jsx     # Fragment 2 in JSX
│   ├── NullGate.jsx     # /null/gate — fake Apache 500 with flag in comment
│   └── dashboards/
│       ├── NetrunnerDashboard.jsx  # OVERVIEW + SETTINGS tabs
│       ├── InstructorDashboard.jsx
│       ├── SupervisorDashboard.jsx
│       ├── AdminDashboard.jsx      # OPERATORS/COMMS/SETTINGS/ASSIGNMENTS/SYNDICATES/SEASONS tabs
│       └── ArchitectDashboard.jsx  # OPERATORS/COMMS/SETTINGS/ASSIGNMENTS/SYNDICATES/SEASONS/UNIVERSITIES/ARCH LOG/V01D tabs
```

---

## Design System (Tailwind tokens)

```
void    #0A0A0F   — page background
abyss   #12121A   — surface/card background
ember   #FF4500   — primary accent
flare   #FF6B00   — secondary accent
bone    #F0F0F0   — primary text
ghost   #6B6B80   — muted text
danger  #FF2D2D
success #00FF88
Border radius: max 2px everywhere (sharp edges)
Fonts: Rajdhani (UI), JetBrains Mono (mono)
```

---

## Auth Flow

1. **Netrunner**: register → email verify → active → onboarding (4 steps, sets university_id) → /contracts
2. **Staff** (SUPERVISOR/INSTRUCTOR): register (picks university) → email verify → PENDING_APPROVAL → admin approves → ACTIVE
3. **Admin/Architect**: seeded manually or via admin panel
4. **Architect**: credential-only login (`/auth/architect-login`), special JWT, ArchitectUser sentinel, no DB row

JWT payload: `{ sub, role, iat }` + force_logout_after Redis key for session invalidation.

---

## Key Architectural Decisions

- **University scoping**: Every list endpoint filters by `current_user.university_id` unless ARCHITECT. Pattern: `get_university_scope(user, override)`.
- **File attachments**: zip/pdf/txt/binary, 50MB max, `/app/uploads` Docker volume, served auth-gated via `/files/{filename}`.
- **BC decay**: decay schedule in `utils/decay.py`, applied at claim time.
- **Polling**: 30s poll (not WebSocket) for bounty board live feed.
- **Season vs Event**: Seasons = archive/reset periods (admin-managed). Events = live competitions with registration (per-university).
- **Void contracts**: `season_id=NULL`, immune to all resets, separate claim table.
- **Circular import guard**: `validate_university_active` lives in `routers/universities.py` and is imported by `auth.py` and `netrunner.py` — verified no circular imports since `universities.py` only imports from `app.deps`, `app.models`, and `app.utils`.
- **RegistrationRequest**: permanent audit trail, survives user deletion, no FK to users table.
- **`bcrypt==4.0.1`** pinned — passlib incompatible with 4.1+ on Python 3.12.
- **Email validator**: relaxed regex (not `EmailStr`) to allow `.local` domains.

---

## Platform Settings (key/value in DB)

`registration_open`, `syndicate_registration_open`, `competition_start`, `competition_end`, `competition_name`, `competition_format` (local/multi), `show_section_in_name`, `allow_solo`, `max_flag_attempts`, `max_syndicate_size`, `solve_feed_delay_seconds`, `competition_active`, `competition_manual_end`, clearance thresholds (ghost_threshold, phantom_threshold, etc.)

---

## Default Credentials

- **Admin**: username=`admin`, password=`Admin@Deadnet1`
- **Architect**: credential-only, stored in environment/utils/architect.py

---

## Completed Sessions Summary

| Session | What was built |
|---------|---------------|
| 1 | Project scaffold, Docker Compose, DB models, JWT auth, basic CRUD |
| 2 | Contract board, flag claiming, BC decay, intel drops |
| 3 | Bounty board (Recharts), syndicates, netrunner profiles |
| 4 Part 1 | Admin/Supervisor/Instructor/Netrunner dashboards (full CRUD) |
| 4 Part 2 | Security hardening: brute-force lockout, security headers, settings enforcement, Docker polish |
| 7 | Stats page (staff-only), admin user management (full_name/student_id/year_level), onboarding flow, ProfileSettings page, force-logout, send-reminder |
| 8 | Competition reset system: Season model, season_id FK on 6 tables, reset L1/L2/L3, admin SEASONS tab, backup download |
| 9 | VO1D Easter egg: HTTP headers, Vite banner, VoidTerminal (↑↑↓↓S0L), /v01d route, 4 VO1D contracts, void_claims/void_attempts tables, fragment chain (5 fragments), LSB steg image, /null/gate, robots.txt |
| 10 | Email verification + password reset: fastapi-mail, 6 User columns, verify/resend/forgot/reset endpoints, VerifyEmail.jsx/ResetPassword.jsx |
| 16 | Multi-university architecture: University model, university_id FK on 10 tables, get_university_scope() utility, all list/aggregate endpoints scoped, GET/POST/PATCH/DELETE /universities (Architect-only), GET /public/universities, registration flows updated (university dropdown in all 3 registration pages + onboarding), ArchitectDashboard UNIVERSITIES tab with full CRUD + stats |

---

## V01D Easter Egg Details

- Key sequence: ↑↑↓↓S0L on any page → opens VoidTerminal overlay
- Terminal commands: `whoami`, `help`, `ls`, `cd /v01d`, `clear`, `exit`
- `/v01d` route: 4 contracts — SHELL IN THE GHOST, DEAD MEN TELL NOT TALE, DEADN3T, I AM NULL (all 500 BC, no decay)
- Fragment chain: index.html comment → NotFound.jsx → Landing data-sig hidden div → 5× rapid logo click console.log → robots.txt
- LSB steg: `frontend/public/deadnet-bg.png` (flag: `V01D{pr3tty_b4s1c_f0r_a_d3ad_m4n}`)
- `/null/gate`: fake Apache 500 page with flag in HTML comment
- Admin can manage VO1D from ArchitectDashboard → V01D tab

---

## Known Bugs / Issues

None currently tracked. All Session 16 verification checks passed (15/15 Python syntax, 5/5 JSX balance, 16/16 token checks, 10/10 DB migrations).

---

## Next Planned Session: Session 17

**Suggested scope** (to be confirmed with user):
- **Events dashboard**: Supervisor/Admin UI for creating and managing events (currently Events.jsx exists but may be incomplete)
- **Event registration flow**: Netrunner registers for a specific event; university_id set from event at registration time
- **Multi-event bounty board**: filter board by event, show per-event rankings
- **Corrupted Contracts**: flesh out the CC challenge type (currently has model + router stub but may lack frontend)
- **Notifications**: frontend NotificationBell / inbox component (model + backend exist, frontend may be stub)

> Confirm with user which of the above to prioritize.

---

## Docker Compose Services

```
frontend   :5173  (Vite dev server, proxies /files/ → backend)
backend    :8000  (FastAPI, healthcheck at /health)
postgres   :5432
redis      :6379
```

All services: `restart: unless-stopped`. Memory limits: frontend/backend 512M, postgres 256M, redis 128M.

---

## Environment Variables (.env)

`DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`, `REFRESH_SECRET_KEY`, `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`, `SMTP_*`, `FRONTEND_URL`, `ARCHITECT_*` (credential storage)
