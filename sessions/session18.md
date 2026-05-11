This is Session 18 of DEADNET — Major Event 
/ Partnership System.

This session introduces two event types:
LOCAL EVENT (existing, single org)
MAJOR EVENT (new, multi-org partnership)

Architects: s0L, UNIV_1, UNIV_2
Anti-cheat: Dynamic flags per org only.
DO NOT implement integrity pledge or 
suspicious solve detection in this session.

═══════════════════════════════════════
PART A — DATABASE SCHEMA
═══════════════════════════════════════

1. UPDATE events table:
   Add columns:
   
   - event_type: enum
     'LOCAL' / 'MAJOR'
     default: 'LOCAL'
   
   - is_host: boolean default false
     True for the org that created 
     the Major Event
   
   - host_org_id: integer nullable
     FK → organizations.id
     Set for MAJOR events — identifies host
     NULL for LOCAL events
   
   - major_event_invite_code: string nullable
     Auto-generated for MAJOR events
     Format: MJ-XXXX-XXXX
     NULL for LOCAL events
   
   - invite_code_regenerated_at: 
     timestamp nullable

2. CREATE major_event_partners table:
   Tracks partner orgs in a Major Event:
   
   id: uuid primary key
   event_id: integer FK → events.id
   org_id: integer FK → organizations.id
   joined_at: timestamp default now
   joined_by: string (Admin callsign)
   status: enum ('ACTIVE' / 'WITHDRAWN')
   default: 'ACTIVE'
   UNIQUE constraint: (event_id, org_id)

3. CREATE major_event_contractors table:
   Tracks borrowed Contractors per Major Event:
   
   id: uuid primary key
   event_id: integer FK → events.id
   contractor_id: integer FK → users.id
   org_id: integer FK → organizations.id
     (the org this Contractor belongs to)
   added_at: timestamp default now
   added_by: string (Admin callsign)
   status: enum ('ACTIVE' / 'REMOVED')
   UNIQUE constraint: (event_id, contractor_id)

4. DYNAMIC FLAGS — add per-org flag variants:
   
   CREATE contract_org_flags table:
   Stores unique flag variant per org 
   per contract for Major Events:
   
   id: uuid primary key
   contract_id: uuid FK → contracts.id
   org_id: integer FK → organizations.id
   flag_hash: string
     (bcrypt hash of the org-specific flag)
   created_at: timestamp default now
   UNIQUE constraint: (contract_id, org_id)
   
   For LOCAL events:
   Use existing contracts.flag_hash directly
   No org-specific variants needed
   
   For MAJOR events:
   Each org gets a unique flag variant
   Stored in contract_org_flags
   Original contracts.flag_hash still stored
   as the "base" but never used for 
   MAJOR event submissions

5. UPDATE contracts table:
   Add columns:
   
   - contributing_org_id: integer nullable
     FK → organizations.id
     For MAJOR events — which org's 
     Contractor created this challenge
     NULL for LOCAL event contracts
   
   - is_blocked_for_own_org: boolean 
     default false
     True for MAJOR event contracts —
     the contributing org cannot solve 
     their own challenges

═══════════════════════════════════════
PART B — BACKEND — MAJOR EVENT MANAGEMENT
═══════════════════════════════════════

6. CREATE MAJOR EVENT
   POST /api/events/major
   Auth: ARCHITECT or ADMIN
   
   Body:
   {
     "name": "Regional CTF Championship 2026",
     "description": "string",
     "start_time": "timestamp",
     "end_time": "timestamp",
     "host_org_id": integer
       (required if Architect creating —
        Architect specifies which org hosts)
       (auto-set to own org if Admin creating)
   }
   
   Validations:
   - If Admin: can only set host_org_id 
     to their own org_id
   - If Architect: can set any org as host
   - Cannot create if org already has 
     an ACTIVE MAJOR event as host
   - name required, 3-100 characters
   
   Actions:
   - Create event with:
     event_type: 'MAJOR'
     is_host: true
     host_org_id: specified org
     status: 'UPCOMING'
     org_id: host org (for scoping)
   - Auto-generate major_event_invite_code:
     Format: MJ-XXXX-XXXX
     Same character set as registration key
   - Add host org to major_event_partners
     automatically with status ACTIVE
   - Log: MAJOR_EVENT_CREATED: 
     "[name]" by [callsign]
     hosted by [org name]

7. REGENERATE MAJOR EVENT INVITE CODE
   POST /api/events/{id}/regenerate-major-invite
   Auth: ARCHITECT or HOST Admin only
   
   - Generate new major_event_invite_code
   - Set invite_code_regenerated_at: now
   - Existing partners unaffected
   - Log: MAJOR_EVENT_CODE_REGENERATED:
     "[name]" by [callsign]

8. JOIN MAJOR EVENT AS PARTNER
   POST /api/events/{id}/partner/join
   Auth: ADMIN only
   
   Body: { "invite_code": "MJ-XXXX-XXXX" }
   
   Validations:
   - Event must be MAJOR type
   - Event must be UPCOMING or ACTIVE
   - invite_code must match
     (case-insensitive)
   - Org not already a partner
   - Rate limit: 5 wrong attempts per 
     10 minutes per Admin (Redis)
   
   Actions:
   - Create major_event_partners record
   - Status: ACTIVE immediately on join
     (no approval needed — immediate access)
   - Notify host Admin:
     "[ORG NAME] has joined [EVENT NAME]
      as a partner organization."
   - Notify joining Admin:
     "Successfully joined [EVENT NAME].
      You can now manage your participants
      and lend Contractors to the host."
   - Notify Architect:
     "[ORG NAME] joined [EVENT NAME]"
   - Log: MAJOR_EVENT_PARTNER_JOINED:
     "[org name]" joined "[event name]"

9. WITHDRAW PARTNER ORG
   DELETE /api/events/{id}/partner/{org_id}
   Auth: ARCHITECT or HOST Admin only
   
   Body: { "reason": "string" }
   
   Actions:
   - Set major_event_partners.status: WITHDRAWN
   - Remove all their Operatives' 
     event registrations
   - Remove all their borrowed Contractors
   - Notify withdrawn org Admin:
     "Your organization has been withdrawn
      from [EVENT NAME]."
   - Log: MAJOR_EVENT_PARTNER_WITHDRAWN:
     "[org name]" from "[event name]"
     Reason: [reason]

10. ADD BORROWED CONTRACTOR
    POST /api/events/{id}/contractors
    Auth: HOST Admin or ARCHITECT
    
    Body: { "contractor_id": integer }
    
    Validations:
    - User must have CONTRACTOR role
    - User must belong to a partner org
      (cannot borrow from non-partner org)
    - User not already in 
      major_event_contractors for this event
    - Event must be UPCOMING or ACTIVE
    
    Auto-approved — no approval flow needed.
    
    Actions:
    - Create major_event_contractors record
    - Notify borrowed Contractor:
      "You have been added as a Contractor
       for [EVENT NAME] hosted by [HOST ORG].
       You can now create challenges for 
       this event."
    - Log: CONTRACTOR_BORROWED:
      "[callsign]" from "[org]" 
      added to "[event name]"

11. REMOVE BORROWED CONTRACTOR
    DELETE /api/events/{id}/contractors/{id}
    Auth: HOST Admin or ARCHITECT
    
    - Set status: REMOVED
    - Their created challenges remain
      (challenges are not deleted on removal)
    - Notify removed Contractor:
      "You have been removed as a Contractor
       from [EVENT NAME]."
    - Log: CONTRACTOR_REMOVED:
      "[callsign]" from "[event name]"

12. GET MAJOR EVENT DETAILS
    GET /api/events/{id}/major
    Auth: ARCHITECT, HOST Admin,
    Partner Org Admin/Contractor/Handler
    
    Returns:
    {
      event details,
      host_org: { name, org_code },
      partners: [
        { org_id, name, org_code,
          participant_count,
          joined_at, status }
      ],
      borrowed_contractors: [
        { contractor_id, callsign,
          org_name, org_code,
          challenges_created }
      ],
      total_participants: integer,
      total_challenges: integer
    }
    
    Non-participating orgs get 404.

═══════════════════════════════════════
PART C — DYNAMIC FLAGS BACKEND
═══════════════════════════════════════

13. GENERATE ORG-SPECIFIC FLAGS
    
    When a challenge is created for a 
    MAJOR event — either by Host Contractor
    or Borrowed Contractor:
    
    Automatically generate unique flag 
    variants for each partner org:
    
    Base flag entered by Contractor:
    FLAG{sql_injection_master}
    
    System generates per-org variants:
    LSPU: FLAG{sql_injection_master_a3f8k2}
    PLM:  FLAG{sql_injection_master_b9k2m4}
    UST:  FLAG{sql_injection_master_c7m1p8}
    
    Generation:
    import secrets
    org_suffix = secrets.token_hex(3)
    org_flag = f"{base_flag}_{org_suffix}"
    
    Store each variant hashed in 
    contract_org_flags table.
    
    IMPORTANT: Base flag stored in 
    contracts.flag_hash as normal.
    Org variants stored in 
    contract_org_flags only.
    
    When new partner joins AFTER challenges
    already created:
    Auto-generate flag variants for the
    new partner org for all existing
    challenges in the event.
    
    Flag variants shown to Contractor:
    After creating a challenge in a MAJOR event
    show a table of generated org flags:
    
    "FLAG VARIANTS GENERATED"
    ┌──────────────────────────────────────┐
    │ ORG   │ FLAG                         │
    │ LSPU  │ FLAG{sql_..._a3f8k2}         │
    │ PLM   │ FLAG{sql_..._b9k2m4}         │
    │ UST   │ FLAG{sql_..._c7m1p8}         │
    └──────────────────────────────────────┘
    
    "Keep these flags secure. 
     Each org receives their unique variant.
     Do not share flags across organizations."
    
    [ COPY ALL ] [ DOWNLOAD CSV ] [ CLOSE ]
    
    This is the ONLY time flags are visible.
    After closing — Contractor cannot 
    retrieve them again (only update).

14. FLAG SUBMISSION FOR MAJOR EVENTS
    POST /api/contracts/{id}/claim
    
    For MAJOR event contracts:
    
    Step 1 — Check org block:
    Get submitting Operative's org_id
    Get contract's contributing_org_id
    
    If they match:
    Return 403:
    {
      "detail": "OWN_CONTRACT_BLOCKED",
      "message": "You cannot solve your 
        own organization's challenges."
    }
    
    Step 2 — Check flag against org variant:
    Look up contract_org_flags WHERE:
    contract_id = this contract
    org_id = operative's org_id
    
    Compare submitted flag against 
    that org's specific flag_hash.
    
    If no org variant exists:
    Fall back to contracts.flag_hash
    (for edge cases where variant 
     wasn't generated)
    
    Step 3 — Normal claim flow:
    If correct: award BC, update scores,
    update team scores, feed entry
    If incorrect: increment attempts

15. ORG BLOCK DISPLAY ON CONTRACT BOARD
    
    For MAJOR event contracts:
    
    If contract.contributing_org_id matches
    current Operative's org_id:
    
    Show contract card with locked overlay:
    "[ YOUR ORG'S CONTRACT ]"
    Grey overlay on card
    Cannot click to open
    BC value hidden: shows "—"
    Tooltip: "Your organization created 
    this challenge. You cannot solve it."
    
    Contract still visible (they know it exists)
    but completely unclaimable.

═══════════════════════════════════════
PART D — CONTRACTOR CHALLENGE CREATION
═══════════════════════════════════════

16. UPDATE challenge creation for 
    MAJOR events:
    
    When Contractor creates a challenge:
    Event selector includes MAJOR events
    they are authorized for:
    - Their own org's MAJOR events (if host)
    - MAJOR events they've been borrowed into
    
    If MAJOR event selected:
    - Show notice:
      "Creating challenge for MAJOR EVENT.
       Unique flag variants will be 
       automatically generated per 
       participating organization."
    - After save: show flag variants table
      (point 13)
    
    Borrowed Contractor restrictions:
    - Can CREATE new challenges
    - CANNOT edit challenges created 
      by other Contractors
    - CANNOT delete other Contractors' 
      challenges
    - CANNOT publish/unpublish other 
      Contractors' challenges
    - Their challenges attributed to 
      their own org (contributing_org_id 
      = their org_id)
    
    Host Contractor full access:
    - Can create challenges
    - Can edit/delete/publish any challenge
      in their hosted MAJOR event
    - Contributing org set to host org

17. FLAG VISIBILITY IN MAJOR EVENTS:
    
    Contractor views their own challenges:
    - Can see their own challenge list
    - Flag field shows: "••••••••"
    - [ UPDATE FLAG ] button available
    - CANNOT see other Contractors' flags
    - Cannot see org variant flags after 
      initial creation screen
    
    On [ UPDATE FLAG ]:
    - Enter new base flag
    - System regenerates ALL org variants
    - Shows new variants table once
    - Old variants immediately invalidated

═══════════════════════════════════════
PART E — PARTICIPANT MANAGEMENT
═══════════════════════════════════════

18. OPERATIVE REGISTRATION FOR MAJOR EVENTS:
    
    Each org's Admin manages their own 
    Operatives for the Major Event.
    
    Registration key system:
    Each partner org gets their OWN 
    registration key for the Major Event:
    
    When org joins as partner:
    Auto-generate a partner registration key:
    Stored in major_event_partners.registration_key
    Format: same as local event keys
    
    HOST org uses the event's main 
    registration_key from events table.
    
    Operative registration flow:
    Same as LOCAL event registration
    But Operative's key is validated against
    their org's partner registration key
    OR the host's main key.
    
    This means:
    - LSPU Operatives use LSPU's key
    - PLM Operatives use PLM's key
    - Keys are different per org
    - Admin shares only their own key 
      with their own Operatives

19. ADMIN PARTICIPANT MANAGEMENT:
    
    Partner Admin manages ONLY their own 
    org's Operatives for the Major Event.
    Cannot see other orgs' participants.
    
    Host Admin manages their own Operatives
    AND has a read-only view of all 
    partner orgs' participant counts.
    (Not individual details — just counts)
    
    HOST Admin Major Event view:
    ┌────────────────────────────────────────┐
    │ Regional CTF 2026 — YOUR EVENT         │
    │ Total Participants: 87                 │
    │                                        │
    │ YOUR OPERATIVES: 31                    │
    │ [ MANAGE YOUR PARTICIPANTS ]           │
    │                                        │
    │ PARTNER PARTICIPANTS:                  │
    │ PLM Manila: 28 operatives              │
    │ UST: 28 operatives                     │
    │                                        │
    │ [ MANAGE BORROWED CONTRACTORS ]        │
    │ [ EVENT CONTROLS ]                     │
    └────────────────────────────────────────┘

═══════════════════════════════════════
PART F — BOUNTY BOARD FOR MAJOR EVENTS
═══════════════════════════════════════

20. INTERCAMPUS BOUNTY BOARD:
    
    Toggle at top of Bounty Board page:
    [ INDIVIDUAL ] [ ORGANIZATION ]
    
    INDIVIDUAL VIEW:
    Combined ranking all orgs together:
    
    ┌──────────────────────────────────────────┐
    │ #  │ CALLSIGN    │ ORG    │ BC           │
    │ 1  │ mash        │ [LSPU] │ 2,400        │
    │ 2  │ cry0x       │ [PLM]  │ 1,800        │
    │ 3  │ testrunner  │ [LSPU] │ 1,200        │
    └──────────────────────────────────────────┘
    
    Org badge colors:
    Auto-assigned from color palette on join:
    Cycle through:
    #FF4500 (ember), #4A9EFF (blue),
    #FFD700 (gold), #00FF88 (green),
    #FF6B00 (orange), #9B59B6 (purple)
    
    Filter pills above table:
    [ ALL ] [ LSPU ] [ PLM ] [ UST ]
    Clicking filters to that org only
    
    ORGANIZATION VIEW:
    Team rankings:
    
    ┌──────────────────────────────────────────┐
    │ #  │ ORGANIZATION  │ MEMBERS │ TEAM BC   │
    │ 1  │ LSPU Siniloan │   31    │ 18,400    │
    │ 2  │ PLM Manila    │   28    │ 14,200    │
    │ 3  │ UST           │   28    │ 12,100    │
    └──────────────────────────────────────────┘
    
    Expandable rows:
    Click org row → shows top 3 performers:
    ▼ LSPU Siniloan         18,400 BC
      1. mash               2,400 BC
      2. testrunner         1,200 BC
      3. operative3         900 BC
      + 28 more participants
    
    Tiebreaker for org rankings:
    Equal BC → more contracts claimed wins
    Still tied → earliest last claim wins

21. BOUNTY BOARD VISIBILITY:
    
    LOCAL event:
    Only that org's participants see board
    Same as current behavior
    
    MAJOR event:
    All participating orgs' Operatives 
    see the combined board
    Non-participating orgs → 404 on board
    
    Org-blocked contracts (own org's):
    Still appear in contract board 
    with locked overlay (point 15)
    NOT in solve feed when own org 
    Operative attempts them

22. SOLVE FEED FOR MAJOR EVENTS:
    
    Feed shows claims from ALL orgs
    with org tag:
    
    "mash [LSPU] claimed SQL Injection 
     Basics +200 BC"
    
    First blood entry:
    "CONTRACT SEIZED — cry0x [PLM] 
     was first to claim HTTP Handshake
     +300 BC"
    
    Org tag styling:
    Small pill badge matching org color
    Same as Bounty Board org badges

═══════════════════════════════════════
PART G — FRONTEND — EVENTS PAGE UPDATES
═══════════════════════════════════════

23. UPDATE /events page to distinguish
    LOCAL vs MAJOR events:
    
    Event type badge on all event cards:
    LOCAL: ghost badge [ LOCAL ]
    MAJOR: ember badge [ MAJOR EVENT ]
    
    [ + CREATE EVENT ] existing button
    stays for LOCAL events
    
    Add new button:
    [ + HOST MAJOR EVENT ]
    Only visible to: Admin + Architect
    Ember outlined — distinct from 
    regular create button
    
    Disabled with tooltip if org already
    has an active MAJOR event as host:
    "You are already hosting a Major Event"

24. CREATE MAJOR EVENT modal:
    
    "HOST A MAJOR EVENT"
    Subtitle: "A partnership competition 
    across multiple organizations."
    
    If Architect creating:
    Extra field: HOST ORGANIZATION
    Dropdown of all active orgs
    
    If Admin creating:
    Host org auto-set to their own org
    No dropdown shown
    
    Fields:
    EVENT NAME *
    e.g. "Regional CTF Championship 2026"
    
    DESCRIPTION (optional)
    
    START TIME (optional)
    END TIME (optional)
    
    Note:
    "After creating the event an invite code
     will be generated. Share it with partner
     organization Admins so they can join."
    
    [ HOST MAJOR EVENT ] — ember filled
    
    On creation — show invite code:
    ┌────────────────────────────────────────┐
    │ MAJOR EVENT CREATED                    │
    │                                        │
    │ INVITE CODE:                           │
    │  MJ-DEAD-N3T5        [ COPY ]         │
    │                                        │
    │ Share this code with partner org       │
    │ Admins to invite them to compete.      │
    │                                        │
    │ [ MANAGE EVENT ] [ DONE ]              │
    └────────────────────────────────────────┘

25. MAJOR EVENT MANAGEMENT page:
    Route: /events/{id}/manage
    
    Tabs:
    OVERVIEW | PARTNERS | CONTRACTORS | 
    CHALLENGES | BOUNTY BOARD | SETTINGS
    
    OVERVIEW tab:
    Event status, timer, total participants
    Quick stats per partner org (mini cards)
    [ COMMENCE HACKING ] / [ HALT ] buttons
    [ FREEZE BOUNTY BOARD ] button
    
    PARTNERS tab:
    ┌────────────────────────────────────────┐
    │ PARTNER ORGANIZATIONS                  │
    │                                        │
    │ INVITE CODE: MJ-DEAD-N3T5  [ COPY ]   │
    │             [ REGENERATE CODE ]        │
    ├────────────────────────────────────────┤
    │ LSPU (HOST)   31 operatives   ACTIVE  │
    │ PLM           28 operatives   ACTIVE  │
    │ UST           28 operatives   ACTIVE  │
    │                        [ WITHDRAW ]   │
    └────────────────────────────────────────┘
    
    CONTRACTORS tab:
    Lists all Contractors for this event:
    Host Contractors + Borrowed Contractors
    
    ┌────────────────────────────────────────┐
    │ HOST CONTRACTORS (LSPU)                │
    │ contractor1  3 challenges created      │
    │ contractor2  2 challenges created      │
    ├────────────────────────────────────────┤
    │ BORROWED CONTRACTORS                   │
    │ plm_ctf  [PLM]  1 challenge created   │
    │                              [ REMOVE ]│
    │ [ + ADD BORROWED CONTRACTOR ]          │
    └────────────────────────────────────────┘
    
    [ + ADD BORROWED CONTRACTOR ] opens search:
    Search by callsign
    Only shows Contractors from partner orgs
    Click to add
    
    CHALLENGES tab:
    All challenges grouped by contributing org:
    
    ── LSPU CHALLENGES (HOST) ──
    [challenge cards with manage options]
    
    ── PLM CHALLENGES (BORROWED) ──
    [challenge cards - read only for non-PLM]
    
    Each challenge shows:
    Title, category, BC, published status
    Org badge on each card
    
    Host Admin can publish/unpublish any
    Borrowed Contractors can only edit their own
    
    BOUNTY BOARD tab:
    Embedded combined board (points 20-21)
    
    SETTINGS tab:
    Event name, times, invite code management

26. ADMIN VIEW — joining a Major Event:
    
    In /events page for Partner Admin:
    
    Add section at top:
    "JOIN A MAJOR EVENT"
    "Have an invite code from a host 
     organization? Enter it below."
    
    Input: placeholder "MJ-XXXX-XXXX"
    [ JOIN AS PARTNER ] button
    
    On valid code and successful join:
    Event appears in their events list
    with [ MAJOR EVENT ] badge and
    "Participating as: PARTNER" label
    
    Partner Admin event card:
    ┌────────────────────────────────────────┐
    │ [ MAJOR EVENT ] Regional CTF 2026      │
    │ Hosted by: LSPU Siniloan               │
    │ Participating as: PARTNER              │
    │ Your Operatives: 28                    │
    │                                        │
    │ [ MANAGE MY PARTICIPANTS ]             │
    │ [ VIEW BOUNTY BOARD ]                  │
    │ [ LEND A CONTRACTOR ]                  │
    └────────────────────────────────────────┘
    
    [ LEND A CONTRACTOR ] opens modal:
    Lists their org's Contractors
    Click to lend to host event
    Auto-approved — immediate access

═══════════════════════════════════════
PART H — HANDLER VIEW FOR MAJOR EVENTS
═══════════════════════════════════════

27. Handler sees Major Event like Local Event
    but with org context:
    
    Handler from Partner Org:
    - Sees combined Bounty Board
    - Can filter to their own org only
    - Sees ONLY their own org's 
      Operatives' details
    - Cannot see other orgs' Operative details
    - Cannot see any flags
    - Same coaching/monitoring role
      as in local events
    
    Handler dashboard for Major Event:
    Shows event name with 
    "[ MAJOR EVENT ] Hosted by [HOST ORG]"
    indicator at top.

═══════════════════════════════════════
PART I — SECURITY
═══════════════════════════════════════

28. SECURITY RULES:

    Major Event access:
    - Non-partner orgs get 404 on all 
      Major Event endpoints
    - Check major_event_partners on 
      every Major Event API call
    - Partner status must be ACTIVE
    - WITHDRAWN orgs treated same as 
      non-partners immediately

    Flag isolation:
    - contract_org_flags never returned 
      in any API response
    - Flag variants only shown to 
      creating Contractor once
    - Submission comparison server-side only
    - Base flag in contracts.flag_hash
      never used for MAJOR event submissions
      (org variants always used)

    Own org blocking:
    - contributing_org_id check happens
      BEFORE flag comparison
    - Blocked operatives get clear error
      not a generic wrong flag error
    - Cannot bypass by guessing the flag

    Contractor isolation:
    - Borrowed Contractors can only edit
      challenges they personally created
    - contributing_org_id check enforced
      on all challenge edit endpoints
    - Cannot access other Contractors' 
      flag hashes

    Registration key isolation:
    - Each org's partner registration key
      only works for their own Operatives
    - Host key and partner keys are different
    - Rate limit: 5 wrong key attempts 
      per 10 min per user (Redis)

═══════════════════════════════════════
PART J — VERIFICATION CHECKLIST
═══════════════════════════════════════

29. After implementation verify:

    MAJOR EVENT CREATION:
    [ ] Admin can create Major Event
    [ ] Architect can create for any org
    [ ] Invite code generated (MJ-XXXX-XXXX)
    [ ] Host org auto-added as partner
    [ ] Event appears in /events page
        with [ MAJOR EVENT ] badge

    PARTNER MANAGEMENT:
    [ ] Partner Admin can join with valid code
    [ ] Invalid code rejected with rate limit
    [ ] Partner gets immediate access on join
    [ ] Host Admin notified on partner join
    [ ] Partner withdrawal works correctly
    [ ] Withdrawn org loses access immediately

    CONTRACTOR SYSTEM:
    [ ] Host Contractors can create challenges
    [ ] Borrowed Contractor added correctly
    [ ] Borrowed Contractor can only edit 
        their own challenges
    [ ] Borrowed Contractor cannot edit 
        host or other borrowed challenges
    [ ] Remove borrowed Contractor works

    DYNAMIC FLAGS:
    [ ] Org variants generated on challenge creation
    [ ] Correct variant used per org on submission
    [ ] Own org contract blocked correctly
    [ ] Blocked contract shows locked overlay
    [ ] New partner joining gets variants 
        generated for existing challenges
    [ ] Flag update regenerates all variants

    BOUNTY BOARD:
    [ ] Individual view shows org badges
    [ ] Org filter pills work correctly
    [ ] Organization view shows team rankings
    [ ] Expandable rows show top performers
    [ ] Non-partner orgs cannot access board
    [ ] Solve feed shows org tags

    EXISTING FUNCTIONALITY:
    [ ] LOCAL events completely unaffected
    [ ] All existing features still work
    [ ] No regression from Major Event additions