This is Session 16 of DEADNET — Multi-University 
Architecture Phase 1: Foundation Layer.

Architects: s0L, UNIV_1, UNIV_2
Default university: LSPU Siniloan

This session has two parts:
1. Multi-Architect .env authentication update
2. University data layer foundation

All existing functionality must continue 
working exactly as before after this session.
No major UI changes — purely backend/database
and auth layer updates.

═══════════════════════════════════════
PART 0 — MULTI-ARCHITECT AUTH UPDATE
(do this first before anything else)
═══════════════════════════════════════

Update Architect authentication to support
multiple Architect accounts via .env.

Current single architect setup:
ARCHITECT_CALLSIGN=s0L
ARCHITECT_PASSWORD=...
ARCHITECT_SECRET=...

Replace with multiple architect support:

ARCHITECT_SECRET=your_existing_secret
(one shared JWT secret for all architects)

ARCHITECT_1_CALLSIGN=s0L
ARCHITECT_1_PASSWORD=your_existing_password

ARCHITECT_2_CALLSIGN=UNIV_1
ARCHITECT_2_PASSWORD=set_a_strong_password

ARCHITECT_3_CALLSIGN=UNIV_2
ARCHITECT_3_PASSWORD=set_a_strong_password

Update auth middleware:
Instead of checking one ARCHITECT_CALLSIGN,
load all ARCHITECT_N_CALLSIGN entries
dynamically:

architects = []
i = 1
while True:
    callsign = os.getenv(f"ARCHITECT_{i}_CALLSIGN")
    password = os.getenv(f"ARCHITECT_{i}_PASSWORD")
    if not callsign or not password:
        break
    architects.append({
        "callsign": callsign,
        "password": password
    })
    i += 1

On login — check against all architect entries:
for arch in architects:
    if (credentials.callsign == arch["callsign"]
        and verify_password(credentials.password,
                           arch["password"])):
        issue_architect_jwt(arch["callsign"])
        break

JWT payload stays the same:
{ role: "ARCHITECT", sub: callsign, iat, exp }

Each Architect gets their own callsign
in the JWT so audit logs show who did what:
s0L action → logged as s0L
UNIV_1 action → logged as UNIV_1
UNIV_2 action → logged as UNIV_2

Update .env with new structure:
ARCHITECT_SECRET=your_existing_secret
ARCHITECT_1_CALLSIGN=s0L
ARCHITECT_1_PASSWORD=your_existing_s0L_password
ARCHITECT_2_CALLSIGN=UNIV_1
ARCHITECT_2_PASSWORD=set_strong_password_here
ARCHITECT_3_CALLSIGN=UNIV_2
ARCHITECT_3_PASSWORD=set_strong_password_here

Update .env.example:
ARCHITECT_SECRET=GENERATE_64_CHAR_RANDOM_STRING
ARCHITECT_1_CALLSIGN=s0L
ARCHITECT_1_PASSWORD=CHANGE_THIS
ARCHITECT_2_CALLSIGN=UNIV_1
ARCHITECT_2_PASSWORD=CHANGE_THIS
ARCHITECT_3_CALLSIGN=UNIV_2
ARCHITECT_3_PASSWORD=CHANGE_THIS
# Add more architects by incrementing the number
# ARCHITECT_4_CALLSIGN=...
# ARCHITECT_4_PASSWORD=...

Startup validation:
If any ARCHITECT_N_PASSWORD equals
"CHANGE_THIS" or is empty:
Log a warning but do NOT refuse to start.
Warning format:
"WARNING: ARCHITECT_{N} password is 
using default value — change before 
deploying to production"

Remove the old startup validation that
refused to start on default password —
replace with warning log only.

Verify after this part:
[ ] s0L can still log in as Architect
[ ] UNIV_1 can log in as Architect
[ ] UNIV_2 can log in as Architect
[ ] Each gets correct callsign in JWT
[ ] Audit logs show correct callsign 
    per Architect action
[ ] Old ARCHITECT_CALLSIGN / 
    ARCHITECT_PASSWORD vars removed

═══════════════════════════════════════
PART A — DATABASE SCHEMA
═══════════════════════════════════════

1. CREATE universities table:

   id: integer primary key autoincrement
   name: string NOT NULL unique
     e.g. "LSPU Siniloan"
   short_name: string nullable
     e.g. "LSPU"
   description: string nullable
   is_active: boolean default true
   created_by: string 
     (Architect callsign — not FK since 
      Architect has no DB row)
   created_at: timestamp default now
   updated_at: timestamp nullable

2. ADD university_id to these tables:
   
   users:
   - university_id: integer FK → universities.id
     nullable — NULL means Architect level
     (no university affiliation)
   
   events:
   - university_id: integer FK → universities.id
     NOT NULL — every event belongs to a university
   
   contracts:
   - university_id: integer FK → universities.id
     NOT NULL
   
   syndicates:
   - university_id: integer FK → universities.id
     NOT NULL
   
   operator_requests:
   - university_id: integer FK → universities.id
     NOT NULL
   
   registration_requests:
   - university_id: integer FK → universities.id
     NOT NULL
   
   corrupted_contracts:
   - university_id: integer FK → universities.id
     NOT NULL
   
   bc_events:
   - university_id: integer FK → universities.id
     NOT NULL
   
   audit_logs:
   - university_id: integer FK → universities.id
     nullable (Architect actions have NULL)

3. DATA MIGRATION — run once on startup:

   Step 1: Create default university
   INSERT INTO universities (name, short_name, 
   created_by, created_at)
   VALUES ('LSPU Siniloan', 'LSPU', 's0L', NOW())
   
   Store the resulting ID as DEFAULT_UNIVERSITY_ID
   
   Step 2: Update all existing users
   UPDATE users 
   SET university_id = DEFAULT_UNIVERSITY_ID
   WHERE university_id IS NULL
   AND role != 'ARCHITECT'
   
   Architect has no DB row so unaffected.
   
   Step 3: Update all existing events
   UPDATE events
   SET university_id = DEFAULT_UNIVERSITY_ID
   WHERE university_id IS NULL
   
   Step 4: Update all existing contracts
   UPDATE contracts
   SET university_id = DEFAULT_UNIVERSITY_ID
   WHERE university_id IS NULL
   
   Step 5: Update all existing syndicates
   UPDATE syndicates
   SET university_id = DEFAULT_UNIVERSITY_ID
   WHERE university_id IS NULL
   
   Step 6: Update all other affected tables
   Same pattern — set DEFAULT_UNIVERSITY_ID
   where university_id IS NULL
   
   Step 7: After migration verify:
   SELECT COUNT(*) FROM users 
   WHERE university_id IS NULL
   Should return 0 (excluding Architect 
   who has no DB row anyway)
   
   Migration must be idempotent —
   safe to run multiple times without 
   duplicating data or errors.

═══════════════════════════════════════
PART B — ROLE HIERARCHY DEFINITION
═══════════════════════════════════════

4. Define role hierarchy constants in backend:

   ROLE_HIERARCHY = {
     'ARCHITECT': 99,  # above all
     'ADMIN': 50,      # university level
     'SUPERVISOR': 30, # event level
     'INSTRUCTOR': 20, # observer level
     'NETRUNNER': 10   # competitor level
   }
   
   Architect JWT (type: "architect") 
   automatically gets level 99.
   
   Regular JWT role field maps to hierarchy.

5. Create get_university_scope() helper:
   
   Takes current user as input.
   Returns university filter to apply:
   
   If Architect JWT:
   → return None (no filter — sees everything)
   
   If ADMIN role:
   → return user.university_id
   
   If SUPERVISOR/INSTRUCTOR/NETRUNNER:
   → return user.university_id
   
   Usage in every scoped query:
   scope = get_university_scope(current_user)
   if scope:
     query = query.filter(
       Model.university_id == scope
     )
   # If scope is None (Architect): no filter

═══════════════════════════════════════
PART C — QUERY SCOPING
═══════════════════════════════════════

6. Apply university scope to ALL endpoints
   that return lists or aggregated data.
   
   Use get_university_scope() helper on:
   
   USERS/OPERATORS:
   GET /api/admin/users
   → filter by university_id if not Architect
   
   EVENTS:
   GET /api/events
   → filter by university_id if not Architect
   
   GET /api/events/active
   → filter by university_id if not Architect
   
   CONTRACTS:
   GET /api/contracts
   → filter by university_id if not Architect
   
   BOUNTY BOARD:
   GET /api/bounty-board
   → filter by university_id if not Architect
   
   SYNDICATES:
   GET /api/syndicates
   → filter by university_id if not Architect
   
   STATS:
   GET /api/stats
   → filter by university_id if not Architect
   
   AUDIT LOG:
   GET /api/admin/audit-log
   → filter by university_id if not Architect
   
   OPERATOR REQUESTS:
   GET /api/requests
   → filter by university_id if not Architect
   
   REGISTRATION REQUESTS:
   GET /api/auth/registration-requests
   → filter by university_id if not Architect
   
   CORRUPTED CONTRACTS:
   GET /api/corrupted-contracts
   → filter by university_id if not Architect
   
   SOLVE FEED:
   GET /api/solve-feed
   → filter by university_id if not Architect
   
   NETWORK TRANSMISSIONS:
   GET /api/transmissions
   → filter by university_id if not Architect

7. Apply university_id on ALL creation endpoints:
   
   When any non-Architect user creates:
   - An event
   - A contract
   - A syndicate
   - A transmission
   - A request
   - Anything with university_id field
   
   Automatically set:
   university_id = current_user.university_id
   
   Never allow user to set university_id 
   themselves — always derived from their 
   own university_id.
   
   Exception: Architect can specify any 
   university_id when creating resources.

═══════════════════════════════════════
PART D — ADMIN ROLE SCOPING
═══════════════════════════════════════

8. ADMIN role is now university-scoped.
   
   Admin can only:
   - See users WHERE university_id = their own
   - See events WHERE university_id = their own
   - See contracts WHERE university_id = their own
   - Approve requests WHERE university_id = their own
   - View audit log WHERE university_id = their own
   
   Admin CANNOT:
   - Query or access any data outside 
     their university_id
   - Set university_id on created resources
     (auto-set from their own)
   - Access /api/universities endpoints
     (Architect only)
   - See other universities exist at all
   
   This is enforced by get_university_scope()
   returning their university_id — all queries
   automatically filtered.

9. ARCHITECT scope — no filter:
   
   Architect JWT bypasses all university filters.
   get_university_scope() returns None for Architect.
   All queries return data across all universities.
   
   Architect can optionally filter by university
   using query param: ?university_id=1
   For example to view one university's data:
   GET /api/events?university_id=1
   
   This is for Architect management use —
   not available to any other role.

═══════════════════════════════════════
PART E — UNIVERSITY API ENDPOINTS
═══════════════════════════════════════

10. These endpoints are Architect-only:

    GET /api/universities
    Returns all universities
    {
      id, name, short_name, is_active,
      created_at, user_count, event_count
    }
    Auth: Architect JWT only
    
    POST /api/universities
    Create new university
    Body: { name, short_name, description }
    Auth: Architect JWT only
    
    PATCH /api/universities/{id}
    Update university details
    Auth: Architect JWT only
    
    DELETE /api/universities/{id}
    Soft delete — sets is_active = false
    Cannot delete if university has 
    active users or events
    Auth: Architect JWT only
    
    GET /api/universities/{id}/stats
    University-specific stats:
    - Total users, events, BC distributed
    - Active event if any
    - Top performers
    Auth: Architect JWT only

11. UNIVERSITY VALIDATION on user creation:
    
    When creating a new user (any role):
    If university_id is provided:
    - Verify university exists
    - Verify university is_active = true
    
    If university_id is not provided 
    and creator is Admin:
    - Auto-assign creator's university_id
    
    If university_id is not provided 
    and creator is Architect:
    - Require explicit university_id
      (Architect must specify which 
       university the user belongs to)

═══════════════════════════════════════
PART F — REGISTRATION WITH UNIVERSITY
═══════════════════════════════════════

12. UPDATE registration flow to capture
    university affiliation:
    
    NETRUNNER registration:
    - If an active event exists for a university:
      university_id set from that event's 
      university_id automatically
    - If multiple universities have active events:
      Netrunner selects their university 
      during registration (dropdown)
    - If no active events:
      university_id set to null until 
      they register for an event
      (at event registration: 
       set university_id from event)
    
    SUPERVISOR/INSTRUCTOR registration:
    - Add university selection to 
      /register/supervisor and /register/instructor
    - Dropdown of active universities
    - Required field
    - Stored in registration_requests.university_id
    - Admin who approves must be from 
      same university

13. UPDATE Netrunner onboarding Step 1
    (Complete Your Dossier):
    
    Add university field:
    UNIVERSITY / INSTITUTION
    Dropdown of active universities
    Pre-filled if already set
    Required
    
    This replaces the free-text 
    "School / Institution" field 
    currently in Operator Settings.

═══════════════════════════════════════
PART G — ARCHITECT DASHBOARD ADDITIONS
═══════════════════════════════════════

14. Add to Architect dashboard 
    (accessible via /architect/dashboard):
    
    New section: UNIVERSITIES
    
    Shows summary cards per university:
    ┌─────────────────────────────────┐
    │ LSPU Siniloan                   │
    │ 12 users • 1 active event       │
    │ 31 registered participants      │
    │ Admin: [callsign]               │
    │ [ VIEW ] [ MANAGE ]             │
    └─────────────────────────────────┘
    
    [ VIEW ] → shows that university's 
    data in a filtered Architect view
    
    [ MANAGE ] → opens university 
    management panel (Phase 2)
    
    For now [ MANAGE ] can show:
    "University management coming soon"
    placeholder — full implementation 
    in Session 17 (Phase 2)
    
    Also add global stats at top:
    TOTAL UNIVERSITIES: X
    TOTAL USERS: X (across all)
    TOTAL EVENTS: X (across all)
    ACTIVE EVENTS: X

═══════════════════════════════════════
PART H — VERIFICATION CHECKLIST
═══════════════════════════════════════

15. After implementation verify:

    MIGRATION:
    [ ] universities table created with 
        LSPU Siniloan as first entry
    [ ] All existing users have 
        university_id = LSPU Siniloan's id
    [ ] All existing events have university_id
    [ ] All existing contracts have university_id
    [ ] No NULL university_id on any 
        non-Architect data
    
    SCOPING:
    [ ] Admin login only sees LSPU data
    [ ] Architect login sees all data
    [ ] Creating an event as Admin 
        auto-assigns their university_id
    [ ] Creating a contract as Supervisor
        auto-assigns their university_id
    
    EXISTING FUNCTIONALITY:
    [ ] Flag submission still works
    [ ] Bounty Board still loads
    [ ] Contract board still loads
    [ ] Event management still works
    [ ] All existing features unchanged
    [ ] No regression from migration
    
    ARCHITECT:
    [ ] /architect/dashboard shows 
        universities section
    [ ] Architect sees all universities' data
    [ ] Architect can filter by university_id