This is Session 13 of DEADNET — Supervisor and 
Instructor Registration with Admin Approval Flow.

Architect: s0L
Affected roles: SUPERVISOR, INSTRUCTOR, ADMIN

═══════════════════════════════════════
PART A — DATABASE SCHEMA
═══════════════════════════════════════

1. UPDATE users table:
   Add columns:
   - account_status: enum
     PENDING_VERIFICATION (email not verified)
     PENDING_APPROVAL (verified, awaiting admin)
     ACTIVE (approved, can log in)
     DENIED (rejected, will be deleted)
     BANNED (existing functionality)
     Default: ACTIVE for NETRUNNER role
     Default: PENDING_VERIFICATION for 
     SUPERVISOR and INSTRUCTOR roles
   
   - registration_reason: string nullable
     max 500 characters
     Only populated for SUPERVISOR/INSTRUCTOR
   
   - denied_reason: string nullable
     Populated by admin on denial
     Kept briefly before account deletion

2. UPDATE existing is_verified flow:
   For NETRUNNER:
   - Register → PENDING_VERIFICATION
   - Verify email → ACTIVE (existing behavior)
   
   For SUPERVISOR/INSTRUCTOR:
   - Register → PENDING_VERIFICATION
   - Verify email → PENDING_APPROVAL
   - Admin approves → ACTIVE
   - Admin denies → DENIED → delete after 
     sending denial email (background task,
     delete 24 hours after denial so email 
     has time to arrive)

3. Add registration_requests table for 
   audit trail (survives account deletion):
   
   id: uuid primary key
   callsign: string
   email: string
   role_requested: string (SUPERVISOR/INSTRUCTOR)
   reason: string
   status: enum (PENDING, APPROVED, DENIED)
   admin_callsign: string nullable
   admin_reason: string nullable
   requested_at: timestamp
   resolved_at: timestamp nullable
   
   This table is never deleted —
   permanent audit trail regardless of 
   what happens to the account.

═══════════════════════════════════════
PART B — REGISTRATION PAGES
═══════════════════════════════════════

4. UPDATE existing /register page (Netrunner):
   
   Keep exactly as is — no changes to 
   Netrunner registration flow.
   
   Add at the bottom of the page below 
   the existing [ ENLIST AS NETRUNNER ] button:
   
   A subtle divider line then:
   "Not a Netrunner?"
   Ghost color #6B6B85, small mono font
   
   Two links side by side:
   [ Enlist as Supervisor ] [ Enlist as Instructor ]
   Ghost outlined, small, not prominent
   These link to /register/supervisor 
   and /register/instructor respectively
   
   Styling intent: visible but not competing 
   with the main Netrunner CTA. A Netrunner 
   shouldn't accidentally click these.

5. CREATE /register/supervisor page:
   
   Page header:
   "SUPERVISOR ENLISTMENT"
   Subtitle ghost color:
   "Supervisor accounts require administrator 
    approval before access is granted."
   
   Form fields:
   
   CALLSIGN (same as Netrunner register)
   Validation: unique, alphanumeric + underscore
   3-20 characters
   
   EMAIL ADDRESS
   Validation: valid email format
   Must be unique in system
   
   PASSWORD
   Validation: 8+ chars, 1 letter, 1 number
   Password strength indicator
   
   CONFIRM PASSWORD
   
   ── IDENTITY VERIFICATION ──
   Subheader in ghost color, separator line
   
   FULL NAME
   Required — real name for admin verification
   
   REASON FOR ACCESS REQUEST
   Textarea, required, 50-500 characters
   Placeholder:
   "Explain your role and why you need 
    Supervisor access. Include your position,
    department, or course you are handling."
   Character counter: "0/500"
   
   [ REQUEST SUPERVISOR ACCESS ] button
   Ember filled — different copy from 
   Netrunner's "ENLIST" to feel more formal
   
   Back link at bottom:
   "← Return to Netrunner Registration"
   Links back to /register

6. CREATE /register/instructor page:
   
   Identical structure to Supervisor page but:
   
   Page header: "INSTRUCTOR ENLISTMENT"
   Subtitle: "Instructor accounts require 
    administrator approval before access 
    is granted."
   
   REASON placeholder:
   "Explain your role and why you need 
    Instructor access. Include the course 
    or section you are monitoring."
   
   Button: [ REQUEST INSTRUCTOR ACCESS ]
   
   Back link: "← Return to Netrunner Registration"

7. DO NOT link /register/supervisor or 
   /register/instructor from:
   - Navbar
   - robots.txt
   - Any other page except /register
   - They exist but are not advertised

═══════════════════════════════════════
PART C — REGISTRATION BACKEND
═══════════════════════════════════════

8. UPDATE POST /api/auth/register endpoint
   OR create separate endpoints:
   POST /api/auth/register/supervisor
   POST /api/auth/register/instructor
   
   Either approach acceptable — separate 
   endpoints are cleaner for validation.
   
   For SUPERVISOR/INSTRUCTOR registration:
   
   Body:
   {
     "callsign": "string",
     "email": "string",
     "password": "string",
     "full_name": "string",
     "reason": "string"
   }
   
   On submission:
   a) Validate all fields
   b) Check callsign + email uniqueness
   c) Create user with:
      role: SUPERVISOR or INSTRUCTOR
      account_status: PENDING_VERIFICATION
      is_verified: false
      onboarding_complete: false
   d) Create registration_requests record
   e) Send verification email (same template 
      as Netrunner but subject line:
      "DEADNET — Verify your [Role] Account Request")
   f) Return 201:
      {
        "message": "Verification email dispatched.
          Verify your email to submit your 
          request for admin approval."
      }
   
   After email verification 
   (GET /api/auth/verify-email?token=):
   
   For SUPERVISOR/INSTRUCTOR specifically:
   - Set is_verified = true
   - Set account_status = PENDING_APPROVAL
   - Do NOT issue JWT yet (cannot log in)
   - Trigger admin notifications (Part D)
   - Show pending approval screen instead 
     of logging them in
   - Return special response:
     {
       "verified": true,
       "status": "PENDING_APPROVAL",
       "message": "Email verified. Your request 
         is now pending administrator approval.
         You will be notified by email when 
         a decision has been made."
     }

9. LOGIN ENFORCEMENT for pending accounts:
   
   POST /api/auth/login
   
   After credential check add status check:
   
   If account_status = PENDING_VERIFICATION:
   Return 403:
   {
     "detail": "EMAIL_NOT_VERIFIED",
     "message": "Please verify your email first."
   }
   
   If account_status = PENDING_APPROVAL:
   Return 403:
   {
     "detail": "PENDING_APPROVAL",
     "message": "Your account is pending 
       administrator approval. You will be 
       notified by email once approved."
   }
   
   If account_status = DENIED:
   Return 403:
   {
     "detail": "ACCOUNT_DENIED",
     "message": "Your registration request 
       was not approved."
   }
   
   If account_status = ACTIVE:
   Proceed with normal login (existing behavior)

═══════════════════════════════════════
PART D — ADMIN NOTIFICATIONS
═══════════════════════════════════════

10. When account_status changes to PENDING_APPROVAL
    trigger two notifications:

    A) EMAIL to ALL Admin accounts:
    Subject: "DEADNET — New [Role] Registration Request"
    
    Body:
    "A new [SUPERVISOR/INSTRUCTOR] registration 
     request requires your approval.
     
     Callsign: [callsign]
     Email: [email]
     Role Requested: [role]
     Reason: [reason]
     Submitted: [timestamp]
     
     [ REVIEW REQUEST ]
     (links to admin console COMMS tab)
     
     Log in to DEADNET Admin Console to 
     approve or deny this request.
     
     — DEADNET SYSTEM"
    
    B) PLATFORM NOTIFICATION to all Admin accounts:
    Use existing notifications table:
    Message: "New [ROLE] registration request 
    from [callsign] — awaiting your approval."
    
    Shows in Admin notification bell/indicator
    with unread count badge.

11. COMMS TAB — REGISTRATION REQUESTS section:
    
    Add new sub-section in COMMS tab below 
    existing OPERATOR REQUESTS section:
    
    Header: "REGISTRATION REQUESTS"
    
    Sub-filter tabs:
    [ PENDING X ] [ APPROVED ] [ DENIED ] [ ALL ]
    
    Each request card:
    ┌──────────────────────────────────────────┐
    │ SUPERVISOR REQUEST          5 mins ago   │
    │ Callsign: john_doe                       │
    │ Email: john@school.edu.ph                │
    │ ──────────────────────────────────────── │
    │ REASON:                                  │
    │ "I am the course instructor for CS       │
    │  Elective 2, handling Section A and B"   │
    │ ──────────────────────────────────────── │
    │ ADMIN RESPONSE:                          │
    │ [________________________] 0/300         │
    │                                          │
    │ [ APPROVE ]          [ DENY ]            │
    └──────────────────────────────────────────┘
    
    Card styling:
    Same as operator requests:
    PENDING: left border 2px #FF6B00
    APPROVED: left border 2px #00FF88
    DENIED: left border 2px #FF2D2D
    
    APPROVE button: #00FF88
    DENY button: #FF2D2D
    
    Both buttons DISABLED until admin_response 
    field has at least 1 character typed.
    Tooltip on disabled state: "Response required"
    
    APPROVE confirmation dialog:
    "Approve [ROLE] account for [callsign]?
    They will receive an email and can 
    log in immediately after approval.
    Response they will see: [admin_response]"
    [ CONFIRM APPROVE ] [ ABORT ]
    
    DENY confirmation dialog:
    "Deny registration for [callsign]?
    Their account will be deleted 24 hours 
    after notification is sent.
    Response they will see: [admin_response]"
    [ CONFIRM DENY ] [ ABORT ]

12. APPROVE ENDPOINT
    PATCH /api/auth/registration-requests/{id}/approve
    Auth: ADMIN only
    Body: { "admin_response": "Welcome aboard." }
    
    Actions:
    - Set account_status = ACTIVE
    - Set registration_requests.status = APPROVED
    - Set resolved_by, resolved_at
    - Issue a one-time activation token
      (different from login JWT)
    - Send approval email to user:
      Subject: "DEADNET — Registration Approved"
      Body:
      "Your [ROLE] account has been approved.
       
       Callsign: [callsign]
       Message from Admin: [admin_response]
       
       [ ACCESS DEADNET ]
       (links to /login)
       
       You may now log in and complete 
       your operator profile.
       
       — DEADNET SYSTEM"
    - Log in audit_log:
      REGISTRATION_APPROVED: [callsign] 
      [ROLE] approved by [admin_callsign]

13. DENY ENDPOINT
    PATCH /api/auth/registration-requests/{id}/deny
    Auth: ADMIN only
    Body: { "admin_response": "Reason for denial" }
    
    Actions:
    - Set account_status = DENIED
    - Set denied_reason = admin_response
    - Set registration_requests.status = DENIED
    - Set resolved_by, resolved_at
    - Send denial email to user:
      Subject: "DEADNET — Registration Request Denied"
      Body:
      "Your [ROLE] registration request 
       was not approved.
       
       Callsign: [callsign]
       Reason: [admin_response]
       
       If you believe this is an error,
       please contact your administrator 
       directly.
       
       — DEADNET SYSTEM"
    - Schedule account deletion:
      Background task fires after 24 hours:
      DELETE user WHERE id = {user_id}
      AND account_status = DENIED
      Log in audit_log:
      REGISTRATION_DENIED_DELETED: [callsign]
    - Log in audit_log immediately:
      REGISTRATION_DENIED: [callsign]
      [ROLE] denied by [admin_callsign]
      Reason: [admin_response]

═══════════════════════════════════════
PART E — PENDING APPROVAL SCREEN
═══════════════════════════════════════

14. After email verification for 
    SUPERVISOR/INSTRUCTOR show a dedicated
    waiting screen instead of logging them in.
    
    Route: /pending-approval
    
    Only accessible if account_status = 
    PENDING_APPROVAL and user has valid 
    session indicator (not full JWT).
    
    Page design — DEADNET terminal aesthetic:
    
    Terminal types out:
    "> IDENTITY VERIFIED"
    "> ROLE REQUEST: [SUPERVISOR/INSTRUCTOR]"
    "> TRANSMISSION SENT TO ADMINISTRATOR"
    "> AWAITING AUTHORIZATION..."
    "> [BLINKING CURSOR]"
    
    Below terminal output:
    Status indicator:
    "REQUEST STATUS: PENDING"
    Orange pulsing dot + text
    
    Info text in ghost color:
    "Your request has been transmitted to 
     the DEADNET administrator for review.
     You will receive an email notification 
     once a decision has been made.
     This process may take some time."
    
    Callsign and role shown:
    "OPERATIVE: [callsign]"
    "ROLE REQUESTED: [role]"
    "EMAIL: [masked email — first 3 chars + ***]"
    
    Single button at bottom:
    [ RETURN TO LOGIN ] — ghost outlined
    
    If user comes back to this page after 
    approval — redirect to /login automatically
    If user comes back after denial —
    show denial message and reason:
    "> REQUEST DENIED"
    "> REASON: [admin_response]"
    "> This account has been scheduled 
       for deletion."
    [ RETURN TO LOGIN ] button

═══════════════════════════════════════
PART F — ONBOARDING AFTER APPROVAL
═══════════════════════════════════════

15. SUPERVISOR/INSTRUCTOR first login after 
    approval triggers 2-step onboarding.
    
    Triggered by: onboarding_complete = false
    after account_status = ACTIVE
    
    STEP 1 — COMPLETE YOUR PROFILE
    
    Header based on role:
    SUPERVISOR: "SYSTEM ACCESS AUTHORIZED"
    INSTRUCTOR: "OBSERVER ACCESS GRANTED"
    
    Subtitle:
    SUPERVISOR: "Complete your operator profile 
     to begin managing the competition."
    INSTRUCTOR: "Complete your observer profile 
     to begin monitoring operatives."
    
    Form fields:
    - FULL NAME (pre-filled from registration,
      editable)
    - DEPARTMENT / FACULTY
      Text input
      Placeholder: "e.g. College of Computing"
    - EMPLOYEE / FACULTY ID
      Text input
    
    [ PROCEED ] button — ember filled
    
    STEP 2 — ROLE BRIEFING
    
    Header:
    SUPERVISOR: "SUPERVISOR CLEARANCE"
    INSTRUCTOR: "INSTRUCTOR CLEARANCE"
    
    For SUPERVISOR — show capability cards:
    
    ┌─────────────────────────┐
    │ CONTRACT MANAGEMENT     │
    │ Create, publish, and    │
    │ manage contracts for    │
    │ the competition.        │
    └─────────────────────────┘
    
    ┌─────────────────────────┐
    │ CORRUPTED CONTRACTS     │
    │ Deploy time-limited     │
    │ surprise contracts with │
    │ random BC rewards.      │
    └─────────────────────────┘
    
    ┌─────────────────────────┐
    │ COMPETITION CONTROL     │
    │ Monitor competition     │
    │ progress and manage     │
    │ the bounty board.       │
    └─────────────────────────┘
    
    For INSTRUCTOR — show capability cards:
    
    ┌─────────────────────────┐
    │ MONITOR NETRUNNERS      │
    │ View all registered     │
    │ operatives and their    │
    │ competition progress.   │
    └─────────────────────────┘
    
    ┌─────────────────────────┐
    │ CONTRACT VISIBILITY     │
    │ View all contracts and  │
    │ solve statistics during │
    │ the competition.        │
    └─────────────────────────┘
    
    ┌─────────────────────────┐
    │ BOUNTY BOARD ACCESS     │
    │ Monitor live rankings   │
    │ and competition         │
    │ statistics.             │
    └─────────────────────────┘
    
    Card styling:
    Dark background #0E0E1A
    Border 1px #2A2A42
    Ember left border 2px on hover
    Icon at top of each card
    
    Below cards:
    Single large button:
    [ ENTER DEADNET ] — ember filled, full width
    
    On click:
    - Set onboarding_complete = true
    - Redirect to role dashboard
    SUPERVISOR → /supervisor/dashboard
    INSTRUCTOR → /instructor/dashboard

═══════════════════════════════════════
PART G — ADMIN OPERATORS TABLE UPDATE
═══════════════════════════════════════

16. UPDATE Operators table to show 
    PENDING_APPROVAL accounts:
    
    Add PENDING tab to primary role tabs:
    [ ALL ] [ NETRUNNER ] [ INSTRUCTOR ] 
    [ SUPERVISOR ] [ ADMIN ] [ PENDING X ]
    
    PENDING tab shows all accounts with
    account_status = PENDING_APPROVAL
    
    Count badge on PENDING tab:
    Shows number — turns ember color when > 0
    to draw attention
    
    Each pending row in table:
    - Status badge: "PENDING" in orange
    - No BAN or DEL buttons on pending rows
    - Actions: [ VIEW ] [ APPROVE ] [ DENY ]
      Quick approve/deny directly from table
      Both require confirmation dialog
      Same flow as COMMS tab approval
    
    VIEW panel for pending accounts shows:
    - Full registration details
    - Reason for request
    - Registration timestamp
    - Email verification status
    - [ APPROVE ] [ DENY ] buttons with 
      response field

═══════════════════════════════════════
PART H — SECURITY
═══════════════════════════════════════

17. SECURITY RULES:
    
    Rate limiting on registration:
    - Max 3 SUPERVISOR/INSTRUCTOR registration 
      attempts per IP per 24 hours (Redis)
    - Prevents spam registration requests
    - Key: reg_attempt:{ip} TTL 24hrs
    
    Callsign/email uniqueness:
    - PENDING_APPROVAL accounts still hold 
      their callsign and email
    - Cannot register with same callsign 
      even if another account is pending
    - Frees up on deletion after denial
    
    Pending accounts cannot:
    - Log in
    - Access any API endpoint
    - Reset their password
    - Request role changes
    
    Admin response required:
    - Both approve and deny require 
      non-empty admin_response
    - Minimum 5 characters
    - Maximum 300 characters
    - Cannot action without it
    
    Audit trail permanent:
    - registration_requests table never deleted
    - Even after account deletion the request 
      record remains with full details
    - Admin can always see history of all 
      registration decisions
    
    Email notifications:
    - All emails sent via BackgroundTasks
    - Non-blocking — registration response 
      not delayed by email sending
    - If email fails: log error, 
      platform notification still sent