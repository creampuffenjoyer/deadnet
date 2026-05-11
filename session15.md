This is Session 15 of DEADNET — Event Registration 
System with Registration Key.
Architect: s0L

Depends on Session 14 (Event System) being 
fully implemented first.

═══════════════════════════════════════
PART A — DATABASE SCHEMA
═══════════════════════════════════════

1. UPDATE event_registrations table
   (created in Session 14, now fully implement):
   
   id: uuid primary key
   event_id: integer FK → events.id
   user_id: integer FK → users.id
   registered_at: timestamp default now
   registered_by: enum (SELF / ADMIN)
   status: enum (ACTIVE / REMOVED)
   default: ACTIVE
   removed_at: timestamp nullable
   removed_by: string nullable (admin callsign)
   removal_reason: string nullable
   UNIQUE constraint: (event_id, user_id)

2. UPDATE events table:
   Add columns:
   - registration_key: string unique
     (auto-generated on event creation)
     Format: [4 chars]-[4 chars]-[4 chars]
     Example: DEAD-N3T5-2026
     Uppercase alphanumeric, no ambiguous chars
     (no 0/O, no 1/I confusion)
   - key_regenerated_at: timestamp nullable
   - email_domain_restriction: string nullable
     Example: "school.edu.ph"
     If set: only emails ending in this domain
     can register — null means no restriction

3. REMOVAL AUDIT:
   Add event_removals table:
   (permanent record even after re-registration)
   
   id: uuid primary key
   event_id: integer FK → events.id
   user_id: integer FK → users.id
   callsign: string (denormalized)
   removed_by: string (admin callsign)
   removal_reason: string
   bc_wiped: integer (amount wiped)
   removed_at: timestamp

═══════════════════════════════════════
PART B — REGISTRATION KEY SYSTEM
═══════════════════════════════════════

4. KEY GENERATION on event creation:
   
   Auto-generate registration_key when 
   event is created:
   
   Format: XXXX-XXXX-XXXX
   Characters: ABCDEFGHJKLMNPQRSTUVWXYZ23456789
   (no 0, O, 1, I to avoid confusion)
   
   Python generation:
   import secrets
   import string
   chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
   key = '-'.join(
     ''.join(secrets.choice(chars) for _ in range(4))
     for _ in range(3)
   )
   
   Key stored in events table.
   Key is NEVER exposed in any API response
   that Netrunners can access.
   Key only visible to ADMIN in Events page.

5. REGENERATE KEY ENDPOINT
   POST /api/events/{id}/regenerate-key
   Auth: ADMIN only
   
   - Generate new registration_key
   - Set key_regenerated_at: now
   - Existing registrations unaffected
     (already registered Netrunners stay in)
   - Old key immediately invalid
   - Log in audit_log:
     EVENT_KEY_REGENERATED: "[event name]" 
     by [admin]
   - Return new key in response
   
   Confirmation required before regenerating:
   "Regenerating the key will invalidate 
   the current key immediately. 
   Already registered participants 
   are not affected."
   [ CONFIRM ] [ ABORT ]

6. KEY VALIDATION ENDPOINT
   POST /api/events/{id}/validate-key
   Auth: any authenticated NETRUNNER
   
   Body: { "key": "DEAD-N3T5-2026" }
   
   Validations:
   - Event must be ACTIVE
   - Key must match events.registration_key
     (case-insensitive comparison)
   - Netrunner not already registered
   - Netrunner not previously removed 
     from this event
   - Email domain check if restriction set:
     user.email must end with 
     email_domain_restriction
   
   Rate limit: 5 attempts per 10 minutes (Redis)
   Key: key_attempt:{user_id}:{event_id}
   
   On too many attempts:
   "TOO MANY ATTEMPTS — 
    Wait 10 minutes before trying again."
   
   On valid key:
   - Create event_registrations record
   - Update events.participant_count += 1
   - Return { "registered": true }
   - Trigger welcome notification to Netrunner
   - Log: EVENT_REGISTERED: [callsign] 
     SELF-registered for "[event name]"
   
   On invalid key:
   - Return 403:
     { "detail": "INVALID_KEY",
       "message": "Invalid access code. 
       Contact your administrator." }
   - Never reveal if key is close/almost right

═══════════════════════════════════════
PART C — BACKEND ENDPOINTS
═══════════════════════════════════════

7. GET REGISTRATION STATUS
   GET /api/events/{id}/registration/me
   Auth: any authenticated role
   
   Returns current user's registration 
   status for this event:
   {
     "registered": true/false,
     "status": "ACTIVE" / "REMOVED" / null,
     "registered_at": "...",
     "registered_by": "SELF" / "ADMIN"
   }
   
   Frontend uses this to show correct 
   state on dashboard and locked pages.

8. ADMIN — GET ALL REGISTRATIONS
   GET /api/events/{id}/registrations
   Auth: ADMIN, SUPERVISOR, INSTRUCTOR
   
   Returns all registrations for event
   Query params:
   - status: ACTIVE / REMOVED / ALL
   - page, limit
   
   Each registration includes:
   callsign, email, registered_at,
   registered_by, status, bc_earned,
   contracts_claimed, syndicate_name

9. ADMIN — MANUALLY ADD NETRUNNER
   POST /api/events/{id}/registrations
   Auth: ADMIN only
   
   Body: { "user_id": 123 }
   
   - Bypasses key requirement
   - Creates registration with 
     registered_by: ADMIN
   - Works even if registration_open = false
   - Netrunner gets platform notification:
     "You have been registered for 
     [EVENT NAME] by the administrator."
   - Log: EVENT_REGISTERED: [callsign]
     ADMIN-registered by [admin_callsign]

10. ADMIN — REMOVE NETRUNNER
    DELETE /api/events/{id}/registrations/{user_id}
    Auth: ADMIN only
    
    Body: { "reason": "string" }
    reason required, min 10 chars
    
    Actions (all atomic — all or nothing):
    a) Set registration status: REMOVED
    b) Set removed_at, removed_by
    c) Wipe ALL bc_events for this user
       WHERE event_id = {event_id}
    d) Set user.main_bc -= wiped_amount
       (recalculate from remaining bc_events)
    e) Set syndicate.main_bc -= wiped_amount
       if user is in a syndicate
    f) Remove user from syndicate if in one
    g) Record in event_removals table
    h) Send platform notification to removed user:
       "> ACCESS REVOKED"
       "> You have been removed from 
          [EVENT NAME]."
       "> Reason: [reason]"
       "> Contact your administrator 
          if you believe this is an error."
    i) Log in audit_log:
       EVENT_REMOVED: [callsign] from 
       "[event name]" by [admin]
       BC wiped: [amount]
       Reason: [reason]
    
    Confirmation dialog before executing:
    "Remove [callsign] from [EVENT NAME]?
    This will:
    • Lock them out of competition immediately
    • Wipe [X] BC earned this event
    • Remove them from Bounty Board
    • Remove them from their Syndicate
    This cannot be undone.
    
    Reason: [required textarea]
    
    [ CONFIRM REMOVE ] [ ABORT ]"

11. REMOVED NETRUNNER ACCESS:
    When a removed Netrunner tries to access
    any competition feature:
    
    Show locked state with specific message:
    "> ACCESS REVOKED"
    "> You have been removed from the 
       current event."
    "> Contact your administrator 
       for more information."
    
    They can still access:
    - Profile/settings
    - Request system (to contact admin)
    - Notifications
    Cannot access:
    - Contracts, Bounty Board, Intel Broker,
      Syndicates, any competition feature

═══════════════════════════════════════
PART D — FRONTEND — REGISTRATION FLOW
═══════════════════════════════════════

12. DASHBOARD — Registration Banner
    Replace Session 14 placeholder button
    with full registration flow:
    
    UNREGISTERED state (event ACTIVE, 
    registration open):
    ┌──────────────────────────────────────────┐
    │ /ACTIVE EVENT: CCS Week CTF 2026       │
    │ Competition is live — register to        │
    │ compete and access contracts.            │
    │                    [ ENTER ACCESS CODE ] │
    └──────────────────────────────────────────┘
    
    [ ENTER ACCESS CODE ] opens inline 
    registration modal — see point 13.
    
    REGISTERED state:
    ┌──────────────────────────────────────────┐
    │ ✓ REGISTERED: CCS Week CTF 2026          │
    │ Competition is live • You're competing   │
    │ Good luck, [callsign]                    │
    └──────────────────────────────────────────┘
    Green border, no button needed.
    
    REMOVED state:
    ┌──────────────────────────────────────────┐
    │ ✗ ACCESS REVOKED: CCS Week CTF 2026      │
    │ You have been removed from this event.   │
    │ Contact admin via [ REQUEST SYSTEM ]     │
    └──────────────────────────────────────────┘
    Red border.
    
    Registration closed (event active but 
    registration_open = false):
    ┌──────────────────────────────────────────┐
    │ CCS Week CTF 2026 — IN PROGRESS          │
    │ Registration is closed.                  │
    │ Contact your administrator to join.      │
    └──────────────────────────────────────────┘
    Ghost border.

13. REGISTRATION MODAL:
    
    Opens from [ ENTER ACCESS CODE ] button.
    
    Header: "EVENT REGISTRATION"
    Subheader: "CCS Week CTF 2026"
    
    Terminal intro text types out:
    "> IDENTITY VERIFIED: [callsign]"
    "> EVENT: CCS WEEK CTF 2026"
    "> ENTER ACCESS CODE TO REGISTER"
    
    Input field:
    Large, centered, mono font
    Placeholder: "XXXX-XXXX-XXXX"
    Auto-formats as user types:
    After 4 chars: auto-adds dash
    After 8 chars: auto-adds dash
    Max 14 chars (including dashes)
    Auto-uppercase as user types
    
    [ REGISTER ] button — ember filled
    Disabled until 14 chars entered
    
    Rate limit feedback:
    If 5 failed attempts:
    "> TOO MANY ATTEMPTS"
    "> Wait 10 minutes before retrying."
    Input disabled for visual feedback.
    
    On success:
    Terminal types out:
    "> ACCESS CODE ACCEPTED"
    "> REGISTRATION CONFIRMED"
    "> WELCOME TO [EVENT NAME], [CALLSIGN]"
    "> Redirecting to competition..."
    
    Auto-close modal after 2 seconds
    Redirect to /contracts
    
    On failure:
    Red shake animation on input
    "> INVALID ACCESS CODE"
    "> Verify your code and try again."
    Input clears, ready for retry.

14. LOCKED PAGES UPDATE
    (update Session 14 locked states)
    
    Add registration check to locked state logic:
    
    If event ACTIVE but Netrunner NOT registered:
    Show registration prompt on locked pages:
    
    "> [PAGE] RESTRICTED"
    "> You are not registered for 
       CCS Week CTF 2026."
    "> Enter your access code to compete."
    [ ENTER ACCESS CODE ] button
    (opens same registration modal)
    
    If event ACTIVE and Netrunner REMOVED:
    Show revoked state (see point 11)
    
    If event ACTIVE and Netrunner REGISTERED:
    Show full page content normally

═══════════════════════════════════════
PART E — EVENTS PAGE UPDATE (Admin)
═══════════════════════════════════════

15. UPDATE Events page — add registration 
    key management to event cards:
    
    UPCOMING/ACTIVE event card additions:
    
    REGISTRATION KEY section:
    ┌────────────────────────────────────┐
    │ REGISTRATION KEY                   │
    │ DEAD-N3T5-2026    [ COPY ] [ 👁 ] │
    │ [ REGENERATE KEY ]                 │
    │                                    │
    │ EMAIL RESTRICTION (optional)       │
    │ [ ] Restrict to: [@_____________] │
    └────────────────────────────────────┘
    
    Key display:
    - Hidden by default (shows ****-****-****)
    - [ 👁 ] toggles visibility
    - [ COPY ] copies to clipboard
      shows "COPIED ✓" for 2 seconds
    - [ REGENERATE KEY ] with confirmation
    
    Email domain restriction:
    - Checkbox to enable
    - Text input for domain: "school.edu.ph"
    - Helper: "Only emails ending in this 
      domain can register with the key"
    - Leave blank for no restriction

16. PARTICIPANTS section in event management:
    
    Inside [ MANAGE ] panel add:
    
    PARTICIPANTS tab:
    Shows all registered Netrunners:
    
    ┌────────────────────────────────────────┐
    │ PARTICIPANTS — 31 registered           │
    │ [ + ADD PARTICIPANT ]                  │
    ├────────────────────────────────────────┤
    │ # │ CALLSIGN │ REGISTERED │ BC │ REMOVE│
    │ 1 │ mash     │ self 8:03  │450 │  [×]  │
    │ 2 │ cry0x    │ admin      │300 │  [×]  │
    └────────────────────────────────────────┘
    
    [ + ADD PARTICIPANT ] opens search modal:
    Search by callsign or email
    Shows matching verified NETRUNNER accounts
    that are not already registered
    Click to add → registered_by: ADMIN
    
    [ × ] remove button per row
    Opens confirmation dialog with reason field
    (same flow as point 10)
    
    Filter: [ ACTIVE ] [ REMOVED ]
    REMOVED tab shows removed participants
    with removal reason and BC wiped

═══════════════════════════════════════
PART F — BOUNTY BOARD FINAL UPDATE
═══════════════════════════════════════

17. Bounty Board query — fully registration-aware:
    
    ACTIVE event:
    SELECT users WHERE:
    - user has ACTIVE registration for 
      current event_id
    - (main_bc + void_bc) > 0
    ORDER BY (main_bc + void_bc) DESC,
    first_claim_at ASC
    
    Removed participants:
    - Not in query at all
    - Zero trace on board
    
    Admin/Supervisor/Instructor Bounty Board:
    - Same filtered view as Netrunners
    - BUT Admin sees removed participants
      in a separate collapsed section:
      "REMOVED PARTICIPANTS (X)"
      Grey, collapsed by default
      Shows their callsign + BC wiped
      Not counted in rankings

18. ALL-TIME HALL OF FAME (Admin only)
    
    Add to Events page bottom section:
    
    Header: "ALL-TIME STANDINGS"
    Subtitle: "Cumulative performance 
    across all events"
    
    Table:
    ┌──────────────────────────────────────────────┐
    │ # │ CALLSIGN │ EVENTS │ TOTAL BC │ BEST RANK │
    │ 1 │ mash     │   3    │  4,200   │  #1 (S2)  │
    │ 2 │ cry0x    │   2    │  2,800   │  #3 (S1)  │
    └──────────────────────────────────────────────┘
    
    Calculated from bc_events across all 
    event_ids — not just current event.
    
    Only visible to ADMIN — not public.
    Not linked anywhere except Events page.
    
    Export button:
    [ EXPORT ALL-TIME CSV ]
    Generates CSV of all-time standings.

═══════════════════════════════════════
PART G — SECURITY
═══════════════════════════════════════

19. SECURITY RULES:
    
    Registration key:
    - Never returned in any Netrunner-accessible
      API endpoint
    - Only returned to ADMIN role
    - Stored as plaintext (it's not a secret 
      like a password — it's meant to be shared
      with participants, just not publicly)
    - Case-insensitive comparison on validation
    - Rate limited: 5 attempts per 10 min per user
    
    Removal is atomic:
    - BC wipe + registration status + 
      syndicate removal all happen in one
      database transaction
    - If any step fails: entire removal 
      rolls back — no partial state
    
    Re-registration after removal:
    - Removed Netrunner CANNOT re-register
      even with valid key
    - Check event_registrations for any 
      record (ACTIVE or REMOVED) before 
      allowing registration
    - Admin can re-add manually if needed
      (override for edge cases)
    
    Key regeneration:
    - Old key invalid immediately on regeneration
    - No grace period
    - Existing registrations unaffected
    - Rate limit: max 5 regenerations per 
      event (prevents abuse)
    
    Domain restriction:
    - Checked at registration time only
    - If restriction added after some people 
      already registered: existing registrations
      unaffected, new registrations must comply
    - Domain comparison: 
      email.endswith("@" + domain)