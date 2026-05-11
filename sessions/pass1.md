This is Pass 1 of DEADNET — Platform-Wide 
Renames and UI Updates based on adviser review.

This is purely a rename and UI update pass.
No logic changes. No new features.
All existing functionality stays identical.

CRITICAL: Do a thorough find-and-replace 
across ALL files — frontend, backend, 
database, emails, comments, variable names,
API responses, UI copy, error messages,
placeholder text, and documentation.

═══════════════════════════════════════
PART A — ROLE RENAMES
═══════════════════════════════════════

1. NETRUNNER → OPERATIVE

   Find and replace ALL instances of:
   - "Netrunner" → "Operative"
   - "NETRUNNER" → "OPERATIVE"
   - "netrunner" → "operative"
   - "netrunner_id" → "operative_id"
   - Variable names, DB columns, 
     API fields, UI copy — everything
   
   Examples of affected places:
   - Role enum value in DB
   - JWT role claim
   - UI badges [ NETRUNNER ] → [ OPERATIVE ]
   - "Enlist as Netrunner" → "Enlist as Operative"
   - "NETRUNNER dashboard" → "OPERATIVE dashboard"
   - Error messages referencing Netrunner
   - Email templates
   - Onboarding flow copy
   - Bounty Board column headers
   - Admin Operators table role labels

2. SUPERVISOR → CONTRACTOR

   Find and replace ALL instances of:
   - "Supervisor" → "Contractor"
   - "SUPERVISOR" → "CONTRACTOR"
   - "supervisor" → "contractor"
   - "supervisor_id" → "contractor_id"
   
   Examples:
   - Role enum value in DB
   - JWT role claim
   - [ SUPERVISOR ] badge → [ CONTRACTOR ]
   - "Enlist as Supervisor" → 
     "Enlist as Contractor"
   - Contractor dashboard header
   - Admin role labels
   - Registration pages
   - Approval emails
   - Onboarding copy

3. INSTRUCTOR → HANDLER

   Find and replace ALL instances of:
   - "Instructor" → "Handler"
   - "INSTRUCTOR" → "HANDLER"
   - "instructor" → "handler"
   - "instructor_id" → "handler_id"
   
   Examples:
   - Role enum value in DB
   - JWT role claim
   - [ INSTRUCTOR ] badge → [ HANDLER ]
   - "Enlist as Instructor" → 
     "Enlist as Handler"
   - Handler dashboard header
   - Admin role labels
   - Registration pages
   - Approval emails
   - Onboarding copy

4. SYNDICATE → TEAM

   Find and replace ALL instances of:
   - "Syndicate" → "Team"
   - "SYNDICATE" → "TEAM"
   - "syndicate" → "team"
   - "syndicate_id" → "team_id"
   - "syndicates" table → "teams" table
   
   Examples:
   - DB table name
   - All FK references to syndicates table
   - API endpoints: /api/syndicates → /api/teams
   - UI: "Create a Syndicate" → "Create a Team"
   - "Join a Syndicate" → "Join a Team"
   - "Syndicate Registry" → "Team Registry"
   - "SYNDICATE" tab in Admin Console
   - Invite code copy
   - Bounty Board team rankings section
   - Dashboard syndicate card → team card

═══════════════════════════════════════
PART B — ENTITY RENAMES
═══════════════════════════════════════

5. UNIVERSITY → ORGANIZATION / ORG

   Find and replace ALL instances of:
   - "University" → "Organization"
   - "UNIVERSITY" → "ORGANIZATION"  
   - "university" → "organization"
   - "university_id" → "org_id"
   - "universities" table → "organizations" table
   - Short references: "Univ" → "Org"
   - "UNIV" → "ORG"
   
   Examples:
   - DB table name
   - All FK references
   - API endpoints: /api/universities → 
     /api/organizations
   - Architect dashboard "UNIVERSITIES" tab →
     "ORGANIZATIONS" tab
   - "University Name" field → 
     "Organization Name"
   - Email templates
   - UI badges [LSPU] stays as org code
     but label says "ORG" not "UNIV"
   - Bounty Board org tags

6. SHORT NAME → ORG CODE
   
   Find and replace:
   - "Short Name" → "Org Code"
   - "short_name" → "org_code"
   - "SHORT NAME" → "ORG CODE"
   
   Remove character limit on org_code field:
   - Previously had a character limit
   - Now accepts any length
   - Update DB column: remove length constraint
   - Update frontend validation: 
     remove max length restriction
   - Keep required: true

7. SEASON → EVENT (if not already renamed)

   Find and replace ALL remaining instances:
   - "Season" → "Event"
   - "SEASON" → "EVENT"
   - "season" → "event"
   - "season_id" → "event_id"
   - "seasons" table → "events" table
     (if not already renamed in Sessions 14-16)
   
   Check entire codebase for any remaining
   "season" references and replace them all.

═══════════════════════════════════════
PART C — UI COPY CHANGES
═══════════════════════════════════════

8. ACCESS CODE → PASS CODE

   Find and replace in ALL UI copy:
   - "Access Code" → "Pass Code"
   - "ACCESS CODE" → "PASS CODE"
   - "access_code" stays as variable name
     (no backend change needed)
   - Only UI-facing copy changes
   
   Affected places:
   - Login page: "Enter your Access Code" →
     "Enter your Pass Code"
   - Password reset page copy
   - Admin activation page
   - Onboarding Step 1 copy
   - Change password section
   - Any tooltip or helper text

9. SOLO COMPETITORS → SOLO OPERATORS

   Find and replace in UI copy:
   - "Solo Competitors" → "Solo Operators"
   - "SOLO COMPETITORS" → "SOLO OPERATORS"
   - Any toggle or option that says 
     "Allow Solo Competitors" →
     "Allow Solo Operators"

10. COMPETITION TAB → EVENTS TAB

    In Admin Console navigation:
    - Rename "COMPETITION" tab → "EVENTS"
    - Update tab label only
    - No content changes inside the tab
    - Update any breadcrumbs or page titles
      that reference "Competition" in this
      context → "Events"

11. CONTRACT BOARD COPY
    
    Update any remaining copy that says:
    - "Challenges" → "Contracts" 
      (if any exist from early implementation)
    - "Points" → "Bounty Credits" or "BC"
      (if any exist)
    - "Players" → "Operatives"
      (if any exist)
    - "Teams" is already the new Syndicate name
    
    Scan all UI text for old terminology
    that may have been missed.

═══════════════════════════════════════
PART D — LOGOUT BUTTON
═══════════════════════════════════════

12. Update the GO DARK / logout button
    across ALL roles and ALL pages:
    
    New appearance:
    Text: "LOGOUT"
    Color: #FF2D2D (bright red)
    Glow effect: 
      text-shadow: 0 0 8px #FF2D2D,
                   0 0 16px #FF2D2D
    Font: JetBrains Mono, uppercase
    
    On hover:
      text-shadow: 0 0 12px #FF2D2D,
                   0 0 24px #FF2D2D,
                   0 0 40px #FF2D2D
      (stronger glow on hover)
    
    Border: 1px solid #FF2D2D
    Background: transparent
    Padding: same as current GO DARK button
    
    No icon needed — text only with glow.
    
    Apply to:
    - Netrunner (Operative) navbar
    - Admin navbar
    - Contractor navbar
    - Handler navbar
    - Architect terminal navbar
    - Mobile nav if exists

═══════════════════════════════════════
PART E — ADMIN CONSOLE UPDATES
═══════════════════════════════════════

13. REMOVE from Admin user management:
    
    In the user detail slide-out panel:
    - Remove [ FORCE LOGOUT ] button
    - Remove [ SEND DOSSIER REMINDER ] button
      Replace with: [ SEND VERIFICATION REMINDER ]
      (keeps the functionality of sending 
       a reminder email but correct copy)
    - Remove [ CHANGE ROLE ] dropdown
      Role changes now only via 
      Operator Requests system
    - Remove LAST IP field from user details
    
    Keep everything else unchanged.

14. ADD Admin Overview section:
    
    Admin Console → first thing visible
    on the OVERVIEW/home tab:
    
    ORGANIZATION PROFILE card:
    ┌────────────────────────────────────────┐
    │ ORGANIZATION PROFILE                   │
    │ ─────────────────────────────────────  │
    │ NAME: LSPU Siniloan                    │
    │ ORG CODE: LSPU                         │
    │ DESCRIPTION: [org description]         │
    │ MEMBER SINCE: February 2026            │
    │ ─────────────────────────────────────  │
    │ OVERALL STATISTICS                     │
    │ Total Events: 3                        │
    │ Total Operatives: 45                   │
    │ Total BC Distributed: 12,400           │
    │ Active Event: CCS Week CTF 2026        │
    └────────────────────────────────────────┘
    
    Styling:
    Dark background #0E0E1A
    Border 1px solid #2A2A42
    Ember left border 3px
    All text in JetBrains Mono
    Labels in ghost color #6B6B85
    Values in white #E8E8F0
    
    Stats pull from:
    - organizations table for profile data
    - COUNT of events WHERE org_id = admin's org
    - COUNT of users WHERE org_id = admin's org
    - SUM of bc_events WHERE org_id = admin's org
    - Current active event name if exists

═══════════════════════════════════════
PART F — ARCHITECT TERMINAL UPDATES
═══════════════════════════════════════

15. ADD Change Logs per Organization
    to Architect Terminal:
    
    New tab in Architect dashboard:
    "CHANGE LOGS"
    
    Page layout:
    
    Left sidebar — org selector:
    [ ALL ORGANIZATIONS ]
    [ LSPU Siniloan      ]
    [ PLM Manila         ]
    [ UST                ]
    (list of all orgs, click to filter)
    
    Main content — log entries:
    
    Filter bar:
    [ ALL ] [ USERS ] [ EVENTS ] 
    [ CONTRACTS ] [ SETTINGS ]
    Date range picker
    
    Log entries table:
    ┌──────────────────────────────────────────────┐
    │ TIMESTAMP    │ ORG   │ ACTION    │ PERFORMED BY│
    │ Mar 15 14:32 │ [LSPU]│ USER_BANNED│ admin_lspu │
    │ Mar 15 14:28 │ [PLM] │ EVENT_START│ admin_plm  │
    │ Mar 15 14:15 │ [LSPU]│ ROLE_CHANGE│ admin_lspu │
    └──────────────────────────────────────────────┘
    
    Clicking a log entry expands it:
    Shows full details of the action:
    - What changed
    - Old value → new value
    - Affected user/resource
    - IP address of performer
    
    This pulls from existing audit_logs table
    filtered by org_id.
    
    Architect-only — not visible to Admin.
    
    Export button:
    [ EXPORT LOGS ] — exports filtered 
    log entries as CSV
    Per org or all orgs.

16. UPDATE Org View tab in Architect Terminal:
    
    When Architect views a specific org:
    Add [ + CREATE ADMIN ACCOUNT ] button
    prominently in the org view header.
    
    Currently this is only accessible via
    the ORGANIZATIONS tab → MANAGE panel.
    Add it as a shortcut in the org view too.
    
    Button opens same Admin creation modal
    as in Session 17 — no new flow needed,
    just an additional entry point.

═══════════════════════════════════════
PART G — VERIFICATION CHECKLIST
═══════════════════════════════════════

17. After all changes verify:

    ROLE RENAMES:
    [ ] "Netrunner" appears nowhere in UI
    [ ] "Supervisor" appears nowhere in UI
    [ ] "Instructor" appears nowhere in UI
    [ ] "Syndicate" appears nowhere in UI
    [ ] All role badges show new names
    [ ] All email templates use new names
    [ ] All error messages use new names
    [ ] DB role enum values updated
    [ ] JWT role claims updated
    [ ] API responses use new role names

    ENTITY RENAMES:
    [ ] "University" appears nowhere in UI
    [ ] "university_id" → "org_id" in all queries
    [ ] Org Code field has no character limit
    [ ] Season → Event fully renamed

    UI COPY:
    [ ] "Access Code" → "Pass Code" in all UI
    [ ] "Solo Competitors" → "Solo Operators"
    [ ] Competition tab → Events tab
    [ ] GO DARK → LOGOUT with red glow

    ADMIN CONSOLE:
    [ ] Force Logout removed
    [ ] Send Dossier Reminder → 
        Send Verification Reminder
    [ ] Change Role removed from user panel
    [ ] Last IP removed from user panel
    [ ] Admin Overview section shows 
        org profile + statistics

    ARCHITECT TERMINAL:
    [ ] CHANGE LOGS tab exists
    [ ] Logs sortable by org
    [ ] Logs filterable by action type
    [ ] Export works
    [ ] [ + CREATE ADMIN ACCOUNT ] in org view

    FUNCTIONALITY:
    [ ] Login still works for all roles
    [ ] All existing features unchanged
    [ ] No broken references from renames
    [ ] No 404s from renamed API endpoints
    [ ] Email flows still work
    [ ] Team (syndicate) features 