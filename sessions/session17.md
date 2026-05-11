This is Session 17 of DEADNET — Multi-University
Architecture Phase 2: University & Admin Management.

Depends on Session 16 (Foundation Layer) 
being fully implemented first.

Architects: s0L, UNIV_1, UNIV_2
Default university: LSPU Siniloan

═══════════════════════════════════════
PART A — ARCHITECT DASHBOARD OVERHAUL
═══════════════════════════════════════

1. /architect/dashboard is the Architect's
   exclusive management hub.
   Only accessible with Architect JWT.
   Returns 404 for all other roles.
   
   Page structure:
   
   Header:
   "ARCHITECT'S TERMINAL"
   Subtitle: "s0L" (or logged-in architect callsign)
   Small [ ◈ ] symbol next to callsign
   
   Navigation tabs:
   OVERVIEW | UNIVERSITIES | OPERATORS | 
   EVENTS | V01D | ARCHITECT LOG | SETTINGS

2. OVERVIEW TAB:
   
   Global stats cards at top:
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │ UNIVERSITIES │ │ TOTAL USERS  │ │ ACTIVE EVENTS│
   │     3        │ │     127      │ │      2       │
   └──────────────┘ └──────────────┘ └──────────────┘
   
   Below stats — university summary cards:
   One card per university:
   
   ┌─────────────────────────────────────────┐
   │ LSPU SINILOAN                    ACTIVE │
   │ ─────────────────────────────────────── │
   │ Admin: [callsign]                        │
   │ Users: 45  •  Events: 3                 │
   │ Active Event: CCS Week CTF 2026         │
   │ Participants: 31                        │
   │                                         │
   │ [ VIEW ] [ MANAGE ]                     │
   └─────────────────────────────────────────┘
   
   Card status colors:
   ACTIVE event: green left border
   No active event: ghost left border
   Inactive university: red left border
   
   [ VIEW ] → scopes Architect view to 
   that university (see point 3)
   [ MANAGE ] → opens university management
   panel (see point 7)

3. ARCHITECT UNIVERSITY SCOPE VIEW:
   
   When Architect clicks [ VIEW ] on a 
   university card:
   
   Show a scoped view of that university's
   Admin Console — same tabs as Admin sees
   but Architect is viewing it:
   
   Header changes to:
   "ARCHITECT'S TERMINAL"
   "Viewing: LSPU SINILOAN" 
   ← ghost color, smaller
   
   [ ← BACK TO ALL UNIVERSITIES ] link
   at top left
   
   All data shown filtered to that university.
   Architect can perform any Admin action
   on behalf of that university from here.
   
   This is essentially Architect 
   impersonating Admin view for support
   and oversight purposes.

═══════════════════════════════════════
PART B — UNIVERSITIES TAB
═══════════════════════════════════════

4. UNIVERSITIES TAB content:
   
   Header: "UNIVERSITIES"
   [ + CREATE UNIVERSITY ] button — ember filled
   
   Table of all universities:
   
   ┌──────────────────────────────────────────────────┐
   │ # │ NAME          │ SHORT │ USERS │ EVENTS │ STATUS│ ACTIONS│
   │ 1 │ LSPU Siniloan │ LSPU  │  45   │   3    │ ● ON  │ MANAGE │
   │ 2 │ PLM Manila    │ PLM   │  23   │   1    │ ● ON  │ MANAGE │
   └──────────────────────────────────────────────────┘
   
   STATUS:
   ● ON → is_active = true, green dot
   ● OFF → is_active = false, red dot
   
   [ MANAGE ] opens university management
   slide-out panel (point 7)

5. CREATE UNIVERSITY flow:
   
   [ + CREATE UNIVERSITY ] opens modal:
   
   STEP 1 — UNIVERSITY DETAILS:
   
   UNIVERSITY NAME *
   Input, e.g. "PLM Manila"
   Max 100 characters
   
   SHORT NAME
   Input, e.g. "PLM"
   Max 10 characters
   Used as badge label throughout platform
   
   DESCRIPTION (optional)
   Textarea, max 300 characters
   
   [ NEXT ] button → goes to Step 2
   [ CANCEL ]

6. University created on [ NEXT ]:
   - Creates university record
   - Returns new university_id
   - Shows Step 2 immediately
   
   STEP 2 — CREATE ADMIN ACCOUNT:
   
   Header: "University created. 
   Now create an Admin account for 
   [UNIVERSITY NAME]."
   
   You can also skip this and create 
   an Admin later.
   
   ADMIN CALLSIGN *
   Input — unique across platform
   
   ADMIN EMAIL *
   Input — university email preferred
   
   [ CREATE ADMIN & SEND INVITATION ]
   ember filled button
   
   [ SKIP — CREATE ADMIN LATER ]
   ghost text link
   
   On [ CREATE ADMIN & SEND INVITATION ]:
   - Creates user account:
     role: ADMIN
     university_id: new university id
     account_status: PENDING_PASSWORD_SET
     is_verified: true (email verified 
     via invitation flow instead)
   - Generates invitation token 
     (same as password reset token)
     expires in 72 hours
   - Sends invitation email (see Part D)
   - Shows success:
     "> UNIVERSITY CREATED: [NAME]"
     "> ADMIN ACCOUNT: [CALLSIGN]"
     "> INVITATION SENT TO: [EMAIL]"
     "> They have 72 hours to set 
        their password."
   
   [ DONE ] closes modal

═══════════════════════════════════════
PART C — UNIVERSITY MANAGEMENT PANEL
═══════════════════════════════════════

7. UNIVERSITY MANAGEMENT slide-out panel
   Opens from [ MANAGE ] button:
   
   Tabs inside panel:
   DETAILS | ADMINS | STATS
   
   DETAILS tab:
   - University name (editable)
   - Short name (editable)
   - Description (editable)
   - Active status toggle with confirmation
   - [ SAVE CHANGES ] button
   
   Deactivating a university:
   Confirmation dialog:
   "Deactivating [NAME] will:
   • Prevent their users from logging in
   • Hide their events from the platform
   • Not delete any data
   Are you sure?"
   [ CONFIRM ] [ ABORT ]
   
   ADMINS tab:
   Lists all Admin accounts for this university:
   
   ┌────────────────────────────────────────┐
   │ CALLSIGN  │ EMAIL    │ STATUS │ ACTIONS│
   │ lspu_adm  │ @lspu... │ ACTIVE │ RESET  │
   └────────────────────────────────────────┘
   
   [ + ADD ADMIN ] button
   Opens mini form:
   - Callsign input
   - Email input
   - [ CREATE & INVITE ] button
   Same flow as Step 2 of Create University
   
   [ RESET ] per admin row:
   Sends a new password reset email
   to that admin account
   Confirmation: "Send password reset 
   email to [callsign]?"
   
   STATS tab:
   University-specific stats:
   - Total users registered
   - Total events run
   - Total BC distributed
   - Most active Netrunner (all time)
   - Events list with participant counts
   - [ EXPORT UNIVERSITY REPORT ] button
     Generates PDF/CSV of all-time stats

═══════════════════════════════════════
PART D — ADMIN INVITATION EMAIL
═══════════════════════════════════════

8. Send invitation email when Admin 
   account is created by Architect:
   
   Subject: 
   "DEADNET — You have been granted 
    Admin access for [UNIVERSITY NAME]"
   
   HTML email — dark DEADNET theme:
   ──────────────────────────────────
   DEADNET
   ADMIN ACCESS GRANTED
   
   University: [UNIVERSITY NAME]
   Callsign: [CALLSIGN]
   
   You have been granted administrator
   access to DEADNET for [UNIVERSITY NAME].
   
   Click below to set your password
   and activate your account:
   
   [ ACTIVATE ADMIN ACCOUNT ]
   (links to /admin/activate?token=[token])
   
   This link expires in 72 hours.
   Single use only.
   
   Once activated you can log in at:
   [FRONTEND_URL]/login
   
   — DEADNET SYSTEM / s0L
   ──────────────────────────────────
   
   Plain text fallback required.

9. ADMIN ACTIVATION PAGE:
   Route: /admin/activate?token=[token]
   
   On load: validate token
   If invalid/expired:
   "> ACTIVATION LINK INVALID OR EXPIRED"
   "> Contact the platform architect 
      to request a new invitation."
   
   If valid — show password setup form:
   
   Terminal intro:
   "> TOKEN VERIFIED"
   "> UNIVERSITY: [UNIVERSITY NAME]"
   "> CALLSIGN: [CALLSIGN]"
   "> SET YOUR ACCESS CODE TO ACTIVATE"
   
   Form fields:
   NEW ACCESS CODE (password)
   CONFIRM ACCESS CODE
   Password strength indicator
   
   [ ACTIVATE ACCOUNT ] button — ember filled
   
   On success:
   - Set password hash
   - Set account_status: ACTIVE
   - Clear invitation token
   - Issue JWT → log Admin in automatically
   - Redirect to /admin with 2-step onboarding
   
   Terminal success animation:
   "> ACCESS CODE SET"
   "> ADMIN ACCOUNT ACTIVATED"
   "> UNIVERSITY: [UNIVERSITY NAME]"
   "> REDIRECTING TO ADMIN CONSOLE..."

═══════════════════════════════════════
PART E — ADMIN ONBOARDING (2-STEP)
═══════════════════════════════════════

10. First login after activation triggers
    Admin onboarding — separate from 
    Supervisor/Instructor onboarding.
    
    Triggered by: 
    onboarding_complete = false
    AND role = ADMIN
    
    STEP 1 — COMPLETE YOUR PROFILE:
    
    Header: "ADMIN ACCESS AUTHORIZED"
    Subtitle: "Complete your administrator 
    profile for [UNIVERSITY NAME]"
    
    Form fields:
    - FULL NAME (required)
    - POSITION / TITLE
      e.g. "Faculty Member", "IT Administrator"
    - CONTACT EMAIL (pre-filled, editable)
    
    [ PROCEED ] button
    
    STEP 2 — ADMIN BRIEFING:
    
    Header: "ADMIN CLEARANCE"
    Subtitle: "Your responsibilities for 
    [UNIVERSITY NAME]"
    
    Capability cards:
    
    ┌─────────────────────────────┐
    │ EVENT MANAGEMENT            │
    │ Create and manage           │
    │ competition events for      │
    │ your university.            │
    └─────────────────────────────┘
    
    ┌─────────────────────────────┐
    │ OPERATOR MANAGEMENT         │
    │ Manage Netrunner,           │
    │ Supervisor and Instructor   │
    │ accounts for your           │
    │ university.                 │
    └─────────────────────────────┘
    
    ┌─────────────────────────────┐
    │ COMPETITION OVERSIGHT       │
    │ Monitor live competition,   │
    │ view stats, and export      │
    │ results for your adviser.   │
    └─────────────────────────────┘
    
    ┌─────────────────────────────┐
    │ SCOPED ACCESS               │
    │ You manage [UNIVERSITY NAME]│
    │ only. Your data is fully    │
    │ isolated from other         │
    │ universities.               │
    └─────────────────────────────┘
    
    [ ENTER ADMIN CONSOLE ] — ember filled
    
    On click:
    - Set onboarding_complete = true
    - Redirect to /admin

═══════════════════════════════════════
PART F — ADMIN CONSOLE UI UPDATES
═══════════════════════════════════════

11. UPDATE Admin Console header to show
    university branding:
    
    Current:
    "ADMIN CONSOLE"
    
    New:
    "ADMIN CONSOLE"
    "[UNIVERSITY SHORT NAME]" 
    ← small badge, ghost color #6B6B85
    mono font, below the title
    OR next to it as a small pill badge
    
    Example:
    ADMIN CONSOLE  [LSPU]
    
    Badge styling:
    Background: transparent
    Border: 1px solid #6B6B85
    Text: #6B6B85
    Font: JetBrains Mono 10px
    Padding: 2px 6px
    
    This badge is always visible on 
    every Admin Console tab so Admin
    always knows which university 
    context they are operating in.

12. ADMIN CONSOLE — data is now scoped:
    
    All tabs automatically show only
    this university's data due to 
    Session 16 university scoping:
    
    OPERATORS tab:
    Only shows users WHERE 
    university_id = admin's university_id
    
    EVENTS tab / link to /events:
    Only shows events WHERE
    university_id = admin's university_id
    
    COMMS tab:
    Only shows requests and transmissions
    WHERE university_id = admin's university_id
    
    SETTINGS tab:
    Shows platform-wide settings (read access)
    Admin cannot change global settings —
    show a note: 
    "Platform settings are managed by 
     the DEADNET Architect."
    
    SYNDICATES tab:
    Only shows syndicates WHERE
    university_id = admin's university_id

13. REMOVE from Admin Console for Admin role:
    - V01D tab (Architect only)
    - Any cross-university data views
    - Global platform settings editing
    
    Admin Settings tab becomes read-only
    for platform-wide settings.
    Admin can still manage:
    - Their event-specific settings
    - Registration key
    - Competition timing

═══════════════════════════════════════
PART G — ARCHITECT GLOBAL VIEWS
═══════════════════════════════════════

14. EVENTS TAB on Architect dashboard:
    
    Shows ALL events across ALL universities:
    
    Filter bar:
    [ ALL UNIVERSITIES ] dropdown
    or [ LSPU ] [ PLM ] etc. filter pills
    
    Event list with university badge:
    ┌────────────────────────────────────────┐
    │ CCS Week CTF 2026    [LSPU]  ● ACTIVE  │
    │ Intrams CTF 2026     [PLM]   UPCOMING  │
    │ CCS Week 2025        [LSPU]  CLOSED    │
    └────────────────────────────────────────┘
    
    Clicking an event: opens that event's
    details in read-only Architect view.

15. OPERATORS TAB on Architect dashboard:
    
    Shows ALL users across ALL universities:
    
    Primary filter tabs:
    [ ALL ] [ LSPU ] [ PLM ] etc.
    (university tabs instead of role tabs
     at the top level)
    
    Inside each university tab:
    Same role/status filters as Admin Console
    
    Architect can perform any user action
    on any user regardless of university.

16. SETTINGS TAB on Architect dashboard:
    
    Platform-wide settings that only 
    Architect can change:
    
    PLATFORM SETTINGS:
    - Bounty decay percentage
    - Max flag attempts
    - Intel drop costs
    - Clearance level thresholds
    
    EMAIL SETTINGS:
    - SMTP configuration
    - Test email button
    
    ARCHITECT SETTINGS:
    - View current Architect accounts
      (callsigns only — no passwords shown)
    - Note: "To add/modify Architect accounts,
      update the .env file and redeploy."

═══════════════════════════════════════
PART H — SECURITY
═══════════════════════════════════════

17. SECURITY RULES:
    
    University isolation:
    - Admin API calls ALWAYS filtered by
      their university_id — no exceptions
    - Admin cannot pass university_id 
      as a query parameter to override scope
    - Backend ignores any university_id 
      in request body from Admin role
      Always uses current_user.university_id
    
    Admin account creation:
    - Only Architect can create Admin accounts
    - Admin cannot create other Admin accounts
    - Admin cannot escalate their own role
    
    Invitation token:
    - SHA-256 hashed before storing (same as 
      email verification tokens)
    - Single use — cleared after activation
    - 72 hour expiry
    - Rate limit: Architect can only send 
      3 invitation emails per hour per university
    
    Cross-university data leakage:
    Add integration test assertions:
    - Admin from university A cannot access
      any endpoint and receive university B data
    - Test: login as LSPU admin, call 
      GET /api/events — verify only LSPU 
      events returned, zero PLM events
    
    Architect impersonation scope:
    - When Architect views a university's data
      via [ VIEW ] — it's read access only
      by default
    - Destructive actions (delete, ban, wipe)
      still require explicit Architect 
      confirmation even in scoped view

═══════════════════════════════════════
PART I — VERIFICATION CHECKLIST
═══════════════════════════════════════

18. After implementation verify:

    UNIVERSITY CREATION:
    [ ] Architect can create a university
    [ ] University appears in UNIVERSITIES tab
    [ ] Architect can create Admin for university
    [ ] Invitation email sent to Admin email
    [ ] Admin can activate via email link
    [ ] Admin onboarding completes correctly
    [ ] Admin redirected to Admin Console
    
    UNIVERSITY SCOPING:
    [ ] LSPU Admin only sees LSPU data
    [ ] PLM Admin only sees PLM data
    [ ] Architect sees all universities
    [ ] University badge shows in Admin Console
    [ ] Admin cannot access /architect/dashboard
    
    ARCHITECT DASHBOARD:
    [ ] Overview shows all universities
    [ ] [ VIEW ] scopes to that university
    [ ] [ MANAGE ] opens management panel
    [ ] UNIVERSITIES tab shows full list
    [ ] EVENTS tab shows all events with badges
    [ ] OPERATORS tab shows all users
    
    EXISTING FUNCTIONALITY:
    [ ] LSPU Siniloan Admin Console unchanged
    [ ] All existing features still work
    [ ] No regression from university scoping
    [ ] s0L Architect access unchanged