This is Session 14 of DEADNET — Event System Overhaul.
This replaces the existing Season system entirely.
Architect: s0L

IMPORTANT BEFORE STARTING:
This session renames "season" to "event" everywhere
in the codebase — database, backend, frontend, 
all variable names, all UI copy.
Do a full find-and-replace of:
- season → event
- season_id → event_id  
- seasons table → events table
- SEASONS tab → removed (replaced by /events page)
- "season" in all UI strings → "event"
Keep the logic intact — only naming changes
unless specified otherwise below.

═══════════════════════════════════════
PART A — DATABASE SCHEMA
═══════════════════════════════════════

1. RENAME seasons table → events table
   
   Updated columns:
   - id: integer primary key
   - name: string NOT NULL
     (custom admin-input name e.g. "CCS Week CTF 2026")
   - status: enum
     UPCOMING / ACTIVE / CLOSED
     default: UPCOMING
   - registration_open: boolean default false
   - start_time: timestamp nullable
     (if set, auto-starts at this time)
   - end_time: timestamp nullable
     (if set, auto-closes at this time)
   - created_by: integer FK → users.id
   - created_at: timestamp default now
   - closed_at: timestamp nullable
   - archived_at: timestamp nullable
   - reset_level: enum nullable
     SOFT / MEDIUM / HARD
     (set when admin archives)
   - export_generated: boolean default false
   - participant_count: integer default 0
     (denormalized count, updated on registration)
   - description: string nullable
     (optional event description shown to Netrunners)

2. UPDATE all tables that had season_id:
   Rename season_id → event_id on:
   - contracts
   - bc_events  
   - void_claims
   - corrupted_contracts
   - corrupted_claims
   - operator_requests
   - registration_requests
   - syndicates (now tied to specific event)
   
   Syndicates additional change:
   Add event_id FK → events.id NOT NULL
   A syndicate belongs to one event only.
   When new event starts fresh syndicates 
   are created — old ones archived with event.

3. Add event_registrations table:
   (this will be fully built in Session 15
   but create the table now for FK integrity)
   
   id: uuid primary key
   event_id: integer FK → events.id
   user_id: integer FK → users.id
   registered_at: timestamp default now
   registered_by: string
   (SELF / ADMIN — who registered them)
   UNIQUE constraint: (event_id, user_id)

═══════════════════════════════════════
PART B — BACKEND — EVENT MANAGEMENT
═══════════════════════════════════════

4. UPDATE /api/admin/events endpoints
   (renamed from /api/admin/seasons):

   GET /api/events
   Returns all events ordered by created_at DESC
   Includes: id, name, status, participant_count,
   start_time, end_time, created_at, closed_at
   Auth: ADMIN, SUPERVISOR, INSTRUCTOR

   GET /api/events/active
   Returns currently ACTIVE event or null
   Used by all frontend pages to determine
   current event context
   Auth: any authenticated role
   
   GET /api/events/{id}
   Full event details including stats
   Auth: ADMIN only

5. CREATE EVENT
   POST /api/events
   Auth: ADMIN only
   
   Body:
   {
     "name": "CCS Week CTF 2026",
     "description": "optional description",
     "start_time": "2026-03-15T08:00:00",
     "end_time": "2026-03-15T17:00:00",
     "registration_open": true
   }
   
   Validations:
   - name required, 3-100 characters
   - Cannot create new event if one is 
     currently ACTIVE
   - start_time must be in the future 
     if provided
   - end_time must be after start_time
   
   Creates event with status: UPCOMING
   Logs in audit_log:
   EVENT_CREATED: "[name]" by [admin]

6. UPDATE EVENT
   PATCH /api/events/{id}
   Auth: ADMIN only
   
   Can update: name, description, 
   start_time, end_time, registration_open
   
   Cannot update if status = CLOSED
   
   Logs in audit_log:
   EVENT_UPDATED: "[name]" by [admin]

7. MANUALLY START EVENT
   POST /api/events/{id}/start
   Auth: ADMIN only
   
   - Sets status: ACTIVE
   - Sets start_time: now (if not already set)
   - Cannot start if another event is ACTIVE
   - Cannot start if status = CLOSED
   - Broadcasts Network Transmission:
     "> [EVENT NAME] — COMPETITION ACTIVE"
     "> DEADNET IS NOW LIVE"
     "> GOOD LUCK, NETRUNNERS"
   - Logs in audit_log:
     EVENT_STARTED: "[name]" manually by [admin]

8. AUTO-START BACKGROUND TASK
   Runs every 60 seconds:
   
   Check for UPCOMING events where:
   start_time <= NOW() AND start_time IS NOT NULL
   AND status = UPCOMING
   
   For each found:
   - Set status: ACTIVE
   - Broadcast Network Transmission (same as manual)
   - Log: EVENT_AUTOSTARTED: "[name]"

9. HALT EVENT (temporary pause)
   POST /api/events/{id}/halt
   Auth: ADMIN only
   
   - Sets competition_active = false
     (existing halt mechanism — keep as is)
   - Does NOT change event status to CLOSED
   - Event remains ACTIVE but competition paused
   - Broadcasts: 
     "> [EVENT NAME] — OPERATIONS HALTED"
     "> COMPETITION TEMPORARILY SUSPENDED"
   - Confirmation required (existing behavior)

10. RESUME EVENT
    POST /api/events/{id}/resume  
    Auth: ADMIN only
    
    - Sets competition_active = true
    - Broadcasts:
      "> [EVENT NAME] — OPERATIONS RESUMED"
      "> COMPETITION IS BACK ONLINE"

11. CLOSE EVENT (begins archive flow)
    POST /api/events/{id}/close
    Auth: ADMIN only
    
    - Sets status: CLOSED
    - Sets closed_at: now
    - Sets competition_active: false
    - Freezes Bounty Board automatically
    - Does NOT archive yet — 
      admin must complete archive flow
    - Broadcasts:
      "> [EVENT NAME] — COMPETITION CLOSED"
      "> FINAL STANDINGS NOW LOCKED"
    - Logs: EVENT_CLOSED: "[name]" by [admin]

12. AUTO-CLOSE BACKGROUND TASK
    Runs every 60 seconds:
    
    Check for ACTIVE events where:
    end_time <= NOW() AND end_time IS NOT NULL
    
    For each found:
    - Execute same as manual close
    - Log: EVENT_AUTOCLOSED: "[name]"

13. ARCHIVE EVENT
    POST /api/events/{id}/archive
    Auth: ADMIN only
    
    Body:
    {
      "reset_level": "SOFT",
      "export_first": true
    }
    
    Only allowed if status = CLOSED
    
    Reset levels (same logic as before):
    
    SOFT — New event, keep contracts:
    - Archive all BC, claims, clearance levels
    - Keep contracts published
    - Dissolve syndicates (tied to event)
    - Keep Netrunner accounts
    
    MEDIUM — New event, clear contracts:
    - Archive all BC, claims
    - Move contracts to DRAFT
    - Dissolve syndicates
    - Keep accounts
    
    HARD — Full wipe, keep accounts:
    - Archive everything
    - Delete contracts
    - Dissolve syndicates
    - Reset all Netrunner stats/BC/clearance
    - Keep login accounts only
    
    On archive:
    - Set archived_at: now
    - Set reset_level on event record
    - Reset relevant data per level
    - Create new UPCOMING event placeholder
      or leave it to admin to create manually
    - Log: EVENT_ARCHIVED: "[name]" 
      level: [SOFT/MEDIUM/HARD] by [admin]
    
    If export_first = true:
    Generate CSV export before resetting
    Store export file linked to event record
    Admin can download anytime from history

═══════════════════════════════════════
PART C — FRONTEND — /events PAGE
═══════════════════════════════════════

14. CREATE /events page
    Admin only — returns 404 for other roles
    Linked in Admin navbar header only
    
    Page header: "DEADNET EVENTS"
    Subtitle: "Manage competition events 
    and view historical results."

15. CURRENT EVENT SECTION
    Shows at top if any event exists 
    in UPCOMING or ACTIVE or CLOSED state:
    
    UPCOMING state card:
    ┌────────────────────────────────────────┐
    │ [ UPCOMING ]  CCS Week CTF 2026        │
    │ Starts: Mar 15 2026 at 8:00 AM         │
    │ Ends:   Mar 15 2026 at 5:00 PM         │
    │ Registration: OPEN • 12 registered     │
    │                                        │
    │ [ COMMENCE HACKING ] [ EDIT EVENT ]    │
    └────────────────────────────────────────┘
    
    ACTIVE state card:
    ┌────────────────────────────────────────┐
    │ [ ● LIVE ]  CCS Week CTF 2026          │
    │ Started: Mar 15 2026 at 8:00 AM        │
    │ Ends in: 04:32:15 ← live countdown     │
    │ Participants: 31 registered            │
    │                                        │
    │ [ HALT OPERATIONS ] [ CLOSE EVENT ]    │
    │ [ FREEZE BOUNTY BOARD ] [ MANAGE ]     │
    └────────────────────────────────────────┘
    
    CLOSED state card (pending archive):
    ┌────────────────────────────────────────┐
    │ [ CLOSED ]  CCS Week CTF 2026          │
    │ Ended: Mar 15 2026 at 5:00 PM          │
    │ Participants: 31 • Winner: mash        │
    │ ⚠ Pending archive                      │
    │                                        │
    │ [ ARCHIVE EVENT ] [ EXPORT RESULTS ]   │
    └────────────────────────────────────────┘
    
    Card styling:
    UPCOMING: border #FF6B00 orange
    ACTIVE: border #00FF88 green, 
            subtle pulse animation on border
    CLOSED: border #6B6B85 ghost

16. [ + CREATE NEW EVENT ] button
    Below current event section
    Disabled (greyed out) if event is ACTIVE
    Tooltip when disabled:
    "Close current event before creating a new one"
    
    Opens creation modal:
    
    "CREATE NEW EVENT"
    
    Fields:
    EVENT NAME *
    Input, placeholder: "e.g. CCS Week CTF 2026"
    Max 100 characters
    
    DESCRIPTION (optional)
    Textarea, placeholder: 
    "Brief description shown to Netrunners"
    Max 300 characters
    
    START TIME (optional)
    datetime-local picker
    Helper: "Leave empty to start manually"
    
    END TIME (optional)  
    datetime-local picker
    Helper: "Leave empty to close manually"
    
    REGISTRATION
    Toggle: [ OPEN ] / [ CLOSED ]
    Default: OPEN
    Helper: "Controls whether Netrunners 
    can register for this event"
    
    [ CREATE EVENT ] button — ember filled
    [ CANCEL ] — ghost

17. MANAGE EVENT modal/panel
    Opens when clicking [ MANAGE ] on 
    active event card:
    
    Shows full event details with edit options:
    - Name (editable inline)
    - Description (editable)
    - Start/end times (editable if not passed)
    - Registration toggle
    - Participant list link
    
    [ SAVE CHANGES ] button

18. ARCHIVE EVENT flow
    Opens when clicking [ ARCHIVE EVENT ]:
    
    Multi-step modal:
    
    STEP 1 — EXPORT:
    "Export results before archiving?"
    [ EXPORT CSV ] [ EXPORT PDF ] [ SKIP ]
    
    STEP 2 — RESET LEVEL:
    "Select archive level for 
    [EVENT NAME]:"
    
    Three cards to select:
    
    ┌─────────────────────────────┐
    │ SOFT RESET                  │
    │ Keep contracts published    │
    │ Archive scores only         │
    │ Best for: same challenges,  │
    │ new group of competitors    │
    └─────────────────────────────┘
    
    ┌─────────────────────────────┐
    │ MEDIUM RESET                │
    │ Move contracts to draft     │
    │ Archive scores              │
    │ Best for: new semester,     │
    │ fresh set of challenges     │
    └─────────────────────────────┘
    
    ┌─────────────────────────────┐
    │ HARD RESET                  │
    │ Delete contracts            │
    │ Wipe all competition data   │
    │ Best for: completely fresh  │
    │ start from scratch          │
    └─────────────────────────────┘
    
    STEP 3 — CONFIRMATION:
    "You are about to archive [EVENT NAME].
    Reset level: [SELECTED LEVEL]
    This will affect:
    - [X] contracts
    - [X] participants  
    - [X] syndicates
    
    Type the event name to confirm:
    [________________________]
    
    [ CONFIRM ARCHIVE ] [ ABORT ]"
    
    Confirm button only activates when 
    typed name matches exactly.
    
    STEP 4 — PROGRESS:
    Terminal-style progress output:
    "> Archiving event data..."
    "> Exporting results..."
    "> Applying [LEVEL] reset..."
    "> Dissolving syndicates..."
    "> Archive complete."
    "> EVENT [NAME] archived successfully."
    
    [ DONE ] button closes modal.

19. EVENT HISTORY section
    Below create button:
    
    Header: "EVENT HISTORY"
    
    Shows all CLOSED + ARCHIVED events
    Ordered by closed_at DESC
    
    Each row:
    ┌──────────────────────────────────────────┐
    │ CCS Week CTF 2026          Mar 15 2026   │
    │ 31 participants • Winner: mash           │
    │ Reset: MEDIUM                            │
    │               [ VIEW ] [ EXPORT ]        │
    └──────────────────────────────────────────┘
    
    [ VIEW ] opens read-only archived event:
    - Final Bounty Board standings
    - Competition stats
    - Contract list with solve counts
    - Timeline of events
    
    [ EXPORT ] downloads results CSV/PDF
    (re-generates if not previously exported)

═══════════════════════════════════════
PART D — ADMIN CONSOLE CHANGES
═══════════════════════════════════════

20. REMOVE SEASONS tab from Admin Console
    entirely. Replace with nothing —
    that tab is gone.
    
    Admin Console tabs after removal:
    COMPETITION | OPERATORS | COMMS | 
    SETTINGS | SYNDICATES
    
    COMPETITION tab update:
    Remove season/event management from here.
    Keep only:
    - Platform status overview
    - Quick stats for current event
    - Link to /events page:
      "Manage events at [ EVENTS ] →"
    
    SETTINGS tab:
    Remove event-specific fields.
    Keep only platform-wide settings:
    - Bounty decay percentage
    - Max flag attempts  
    - Intel drop costs
    - Clearance level thresholds
    - SMTP configuration

21. ADMIN HEADER NAVIGATION UPDATE
    
    Add [ EVENTS ] link to admin navbar:
    
    Current admin navbar:
    DEADNET | [nav items] | ADMIN CONSOLE
    
    New admin navbar:
    DEADNET | [nav items] | [ EVENTS ] | 
    ADMIN CONSOLE
    
    [ EVENTS ] styled differently from 
    regular nav items — ember outlined button
    or subtle highlight to distinguish it
    as an action-oriented page not just 
    a content page.
    
    If event is ACTIVE:
    Show live indicator next to EVENTS:
    [ EVENTS ● ] where ● is green pulsing dot
    So admin always knows at a glance if 
    a competition is running.

═══════════════════════════════════════
PART E — NETRUNNER LOCKED STATES
═══════════════════════════════════════

22. When no ACTIVE event exists
    (status is UPCOMING, CLOSED, or no events):
    
    Netrunner tries to access:
    /contracts → locked state
    /bounty-board → locked state
    /intel-broker → locked state
    /syndicates → locked state
    
    Do NOT redirect to 404.
    Show an inline locked/offline state 
    on each page:
    
    CONTRACTS locked state:
    Terminal aesthetic, centered on page:
    "> CONTRACT BOARD OFFLINE"
    "> NO ACTIVE COMPETITION"
    ">"
    If upcoming event exists:
    "> NEXT EVENT: [EVENT NAME]"
    "> COMMENCING IN: [countdown HH:MM:SS]"
    Else:
    "> Awaiting event initialization."
    ">"
    "> Stand by, Netrunner."
    
    BOUNTY BOARD locked state:
    "> BOUNTY BOARD OFFLINE"  
    "> NO ACTIVE COMPETITION"
    "> Rankings will be available once
       the competition goes live."
    If upcoming event:
    "> NEXT EVENT: [EVENT NAME]"
    "> [countdown]"
    
    INTEL BROKER locked state:
    "> BROKER OFFLINE"
    "> THE BROKER: I'm not taking clients 
       right now. Come back when the 
       competition is live."
    
    SYNDICATES locked state:
    "> SYNDICATE REGISTRY OFFLINE"
    "> Syndicates are formed per event.
       Register for an upcoming event 
       to join or create a syndicate."
    
    Netrunner CAN still access:
    - Their profile/settings
    - Request system
    - Notifications
    - Account settings

23. UPCOMING EVENT BANNER
    When an UPCOMING event exists and 
    registration is open:
    
    Show banner on Netrunner dashboard:
    
    ┌──────────────────────────────────────────┐
    │ ⚡ UPCOMING EVENT: CCS Week CTF 2026     │
    │ Mar 15 2026 • Registration Open          │
    │ [ REGISTER FOR EVENT ]                   │
    └──────────────────────────────────────────┘
    
    Ember border, dark background.
    This banner is the entry point for 
    Session 15 registration flow —
    for now just show it, button can be 
    a placeholder that says "Coming Soon"
    or links to a basic registration page.
    
    If Netrunner is already registered:
    ┌──────────────────────────────────────────┐
    │ ✓ REGISTERED: CCS Week CTF 2026          │
    │ Mar 15 2026 • You're in                  │
    │ Starts in: 02:14:33                      │
    └──────────────────────────────────────────┘
    Green border.

═══════════════════════════════════════
PART F — SYNDICATES TIED TO EVENT
═══════════════════════════════════════

24. Syndicates now belong to a specific event.
    
    Schema change (already in Part A):
    syndicates.event_id FK → events.id
    
    Behavior changes:
    
    Creating a syndicate:
    - Only allowed during ACTIVE event
    - Or during UPCOMING event if 
      registration is open
    - Automatically tagged with current event_id
    
    Viewing syndicates:
    - Only current event's syndicates visible
    - Past event syndicates viewable in 
      event archive only
    
    Syndicate dissolution on archive:
    - All syndicates dissolved when event archived
    - Members notified via platform notification:
      "Syndicate [NAME] has been dissolved.
       The event has concluded."
    - Syndicate history preserved in archive
    
    Syndicate page locked state:
    (same as Part E — show offline message
     when no active event)

═══════════════════════════════════════
PART G — GLOBAL EVENT CONTEXT
═══════════════════════════════════════

25. All queries that previously filtered 
    by active season_id now filter by 
    active event_id.
    
    Create a helper function/dependency:
    get_active_event() → returns current 
    ACTIVE event or None
    
    Used in:
    - Contract queries
    - Bounty Board queries  
    - BC event queries
    - Stats queries
    - Corrupted contract queries
    - Syndicate queries
    - Intel broker queries
    
    If get_active_event() returns None:
    Protected endpoints return 403:
    {
      "detail": "NO_ACTIVE_EVENT",
      "message": "No competition is currently active."
    }
    
    Exceptions (always accessible):
    - Auth endpoints
    - Profile/settings endpoints
    - Notification endpoints
    - Request system endpoints
    - Admin event management endpoints

26. PLATFORM HEADER — show current event name
    
    When event is ACTIVE:
    Show event name subtly in the platform:
    
    Under "DEADNET" logo/header:
    "[EVENT NAME]" in small ghost mono text
    
    Example:
    DEADNET
    CCS WEEK CTF 2026  ← small, ghost color
    
    When no active event:
    No subtitle shown — just DEADNET

═══════════════════════════════════════
PART H — BOUNTY BOARD EVENT FILTER
═══════════════════════════════════════

27. Update Bounty Board query:
    
    ACTIVE event:
    - Filter by current event_id
    - Filter by event_registrations 
      (only registered participants)
      NOTE: event_registrations table exists
      but is empty until Session 15 —
      for now show all users with bc > 0
      in current event as fallback
    - Order by (main_bc + void_bc) DESC
    - Tiebreaker: first_claim_at ASC
    - Hide zero-BC participants
    
    CLOSED/no event:
    - Return empty array with state indicator
    
    Add state field to response:
    {
      "state": "ACTIVE",
      "event_name": "CCS Week CTF 2026",
      "event_ends_at": "...",
      "rankings": [...]
    }