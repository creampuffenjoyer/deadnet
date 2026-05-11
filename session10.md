This is Session 10 of DEADNET — Email Verification 
and Password Reset using Gmail SMTP.

Email provider: Gmail with App Password.
Frontend URL is configurable via .env for both 
local and LAN deployment.

═══════════════════════════════════════
PART A — EMAIL SERVICE SETUP
═══════════════════════════════════════

1. Install fastapi-mail in backend:
   Add to requirements.txt:
   fastapi-mail==1.4.1
   
   Rebuild backend container after adding:
   docker-compose up --build backend

2. Add to .env (fill in your actual values):
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USERNAME=your_deadnet_gmail@gmail.com
   SMTP_PASSWORD=your_16_char_app_password
   SMTP_FROM_NAME=DEADNET
   SMTP_FROM_EMAIL=your_deadnet_gmail@gmail.com
   SMTP_TLS=true
   SMTP_SSL=false
   FRONTEND_URL=http://localhost:5173

   Add to .env.example with placeholders:
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USERNAME=YOUR_DEADNET_GMAIL@gmail.com
   SMTP_PASSWORD=YOUR_16_CHAR_APP_PASSWORD
   SMTP_FROM_NAME=DEADNET
   SMTP_FROM_EMAIL=YOUR_DEADNET_GMAIL@gmail.com
   SMTP_TLS=true
   SMTP_SSL=false/p
   # FRONTEND_URL controls where email links point
   # Local dev:       http://localhost:5173
   # University LAN:  http://192.168.1.XXX:5173
   # Production:      https://yourdomain.com
   FRONTEND_URL=http://localhost:5173

3. Create email service module:
   backend/app/services/email_service.py
   
   Functions needed:
   - send_verification_email(email, callsign, token)
   - send_password_reset_email(email, callsign, token)
   
   Email sending must be async and non-blocking —
   use FastAPI BackgroundTasks so registration
   response is not delayed by email sending.
   
   All email links must use FRONTEND_URL from .env:
   Verification: {FRONTEND_URL}/verify-email?token={token}
   Password reset: {FRONTEND_URL}/reset-password?token={token}
   
   If email fails to send:
   - Log the error server-side only
   - Never expose SMTP errors to the user
   - User always sees success message regardless

═══════════════════════════════════════
PART B — DATABASE SCHEMA UPDATES
═══════════════════════════════════════

4. Add to users table via Alembic migration:
   - is_verified: boolean, default false
   - verification_token: string, nullable
     (store SHA-256 hash of token, not raw token)
   - verification_token_expires: timestamp, nullable
   - password_reset_token: string, nullable
     (store SHA-256 hash of token, not raw token)
   - password_reset_expires: timestamp, nullable
   - password_reset_requested_at: timestamp, nullable

5. Token generation rules:
   - Use secrets.token_urlsafe(32) for all tokens
   - Hash with SHA-256 before storing in DB:
     import hashlib
     stored = hashlib.sha256(raw_token.encode()).hexdigest()
   - Raw token goes in email link only
   - On verify/reset: hash incoming token, compare to DB
   
   Token expiry:
   - Email verification token: 24 hours
   - Password reset token: 1 hour

═══════════════════════════════════════
PART C — EMAIL VERIFICATION FLOW
═══════════════════════════════════════

6. UPDATE REGISTRATION ENDPOINT
   POST /api/auth/register
   
   New behavior:
   - Create account with is_verified = false
   - Generate raw token via secrets.token_urlsafe(32)
   - Store SHA-256 hash + expiry in users table
   - Send verification email via BackgroundTasks
   - Return 201:
     {
       "message": "Verification email dispatched 
         to [email]. Activate your account to 
         access DEADNET."
     }
   - Do NOT issue JWT on registration
   - User must verify email before any login

7. EMAIL ENUMERATION PROTECTION on registration:
   If email already exists in DB:
   - Do NOT say "email already registered"
   - Send a "someone tried to register" 
     notification to the existing account email
   - Return same 201 success message as normal
   - User cannot tell if email exists or not

8. VERIFICATION ENDPOINT
   GET /api/auth/verify-email?token={token}
   
   - Hash incoming token with SHA-256
   - Look up hash in users table
   - Check token not expired
   - If valid:
     * Set is_verified = true
     * Clear verification_token fields
     * Issue JWT (log user in automatically)
     * Return { token, user } same as login response
   - If invalid or expired:
     * Return 400: { "detail": "INVALID_OR_EXPIRED" }
   - If already verified:
     * Return 200 success (idempotent)

9. RESEND VERIFICATION ENDPOINT
   POST /api/auth/resend-verification
   Body: { "email": "student@gmail.com" }
   
   - Rate limit: 3 requests per hour per email (Redis)
     Key: resend_verification:{email}
   - Find unverified account
   - Generate new token (invalidates old one)
   - Send new verification email
   - Always return same response:
     { "message": "If unverified, a new link 
       has been dispatched." }

10. LOGIN ENFORCEMENT
    POST /api/auth/login
    
    After credentials pass:
    - Check is_verified = true
    - If false return 403:
      {
        "detail": "EMAIL_NOT_VERIFIED",
        "message": "Verify your email before 
          accessing DEADNET."
      }
    - Frontend detects EMAIL_NOT_VERIFIED
      and shows resend option automatically

═══════════════════════════════════════
PART D — PASSWORD RESET FLOW
═══════════════════════════════════════

11. FORGOT PASSWORD ENDPOINT
    POST /api/auth/forgot-password
    Body: { "email": "student@gmail.com" }
    
    - Rate limit: 3 requests per hour per email (Redis)
      Key: forgot_password:{email}
    - Find account (verified or not)
    - Generate raw token, store SHA-256 hash + expiry
    - Send reset email via BackgroundTasks
    - ALWAYS return same response:
      { "message": "If that email is registered, 
        a reset link has been dispatched." }
    - Never reveal if email exists in system

12. RESET PASSWORD ENDPOINT
    POST /api/auth/reset-password
    Body: {
      "token": "raw_token_from_email",
      "new_password": "newpassword123",
      "confirm_password": "newpassword123"
    }
    
    - Hash incoming token, look up in DB
    - Validate token not expired
    - Validate passwords match
    - Validate password strength:
      * Minimum 8 characters
      * At least one number
      * At least one letter
    - Hash new password with bcrypt/argon2
    - Update users table
    - Clear reset token fields
    - Invalidate ALL existing sessions:
      Set Redis key: force_logout_after:{user_id}
      = current timestamp
      (same mechanism as admin Force Logout)
    - Issue new JWT
    - Log in audit_log:
      PASSWORD_RESET: {callsign} reset via email

═══════════════════════════════════════
PART E — FRONTEND PAGES
═══════════════════════════════════════

13. UPDATE REGISTRATION PAGE

    After successful registration:
    Replace redirect to dashboard with 
    a full success screen:
    
    DEADNET styled, terminal aesthetic:
    "> ENLISTMENT RECEIVED"
    "> VERIFICATION REQUIRED"
    "> A verification signal has been dispatched"
    "> to [email]"
    "> Check your inbox and click the link"
    "> to activate your operator account."
    "> Link expires in 24 hours."
    
    Two links below:
    "Didn't receive it? [ RESEND ]"
    "Already verified? [ ACCESS DEADNET ]"

14. VERIFICATION SUCCESS PAGE
    Route: /verify-email (frontend handles token param)
    
    On page load: call GET /api/auth/verify-email?token
    
    Loading state (while API call runs):
    "> VERIFYING SIGNAL..."
    Blinking cursor
    
    On success:
    Terminal types out:
    "> IDENTITY CONFIRMED"
    "> OPERATOR STATUS: ACTIVE"
    "> WELCOME TO DEADNET, [CALLSIGN]"
    Auto-redirect to onboarding (if first time)
    or dashboard after 2 seconds
    
    On failure (invalid/expired token):
    "> VERIFICATION FAILED"
    "> SIGNAL CORRUPTED OR EXPIRED"
    [ REQUEST NEW LINK ] button
    Links to login page with resend option visible

15. UPDATE LOGIN PAGE

    Add below password field:
    "[ FORGOT ACCESS CODE? ]" 
    Ghost color, mono, small — subtle link
    
    Opens inline modal (not new page):
    - Input: "ENTER YOUR REGISTERED EMAIL"
    - [ DISPATCH RESET LINK ] button — ember filled
    - On success:
      "> RESET SIGNAL DISPATCHED"
      "> Check your inbox. Expires in 1 hour."
    - [ ABORT ] closes modal
    
    On EMAIL_NOT_VERIFIED login error:
    Show below error message:
    "Account unverified — check your inbox"
    [ RESEND VERIFICATION ] button — ghost outlined

16. PASSWORD RESET PAGE
    Route: /reset-password (frontend handles token param)
    
    On load: validate token exists in URL
    If no token: redirect to login
    
    Form:
    - NEW ACCESS CODE (password input)
    - CONFIRM ACCESS CODE (confirm input)
    - Password strength bar below input:
      Weak (red) / Medium (orange) / Strong (green)
      Based on length + complexity
    - [ SET NEW ACCESS CODE ] button — ember filled
    
    On success:
    Terminal types out:
    "> ACCESS CODE UPDATED"
    "> ALL ACTIVE SESSIONS TERMINATED"
    "> REDIRECTING TO LOGIN..."
    Auto-redirect to /login after 2 seconds
    
    On failure (expired/invalid token):
    "> RESET SIGNAL EXPIRED"
    "> Request a new reset link from login page."
    [ RETURN TO LOGIN ] button

═══════════════════════════════════════
PART F — EMAIL TEMPLATES
═══════════════════════════════════════

17. VERIFICATION EMAIL
    Subject: "DEADNET — Verify Your Operator Account"
    
    HTML email — dark themed:
    Background: #0A0A0F
    Accent: #FF4500
    Font: monospace system fallback
    
    Content:
    ──────────────────────────────
    DEADNET
    OPERATOR VERIFICATION
    
    Callsign: [CALLSIGN]
    
    Your enlistment has been received.
    Click below to verify your identity
    and activate your operator account.
    
    [ VERIFY OPERATOR ACCOUNT ]
    (large ember button, links to verify URL)
    
    This link expires in 24 hours.
    Single use only.
    
    If you did not register for DEADNET
    ignore this message.
    
    — DEADNET SYSTEM
    ──────────────────────────────
    
    Plain text fallback required.

18. PASSWORD RESET EMAIL
    Subject: "DEADNET — Access Code Reset Request"
    
    Same dark styling.
    
    Content:
    ──────────────────────────────
    DEADNET
    ACCESS CODE RESET
    
    Callsign: [CALLSIGN]
    
    A reset request was received for 
    this operator account.
    
    [ RESET ACCESS CODE ]
    (large ember button, links to reset URL)
    
    This link expires in 1 hour.
    Single use — cannot be reused.
    
    If you did not request this reset,
    your account credentials may be 
    compromised. Change your password 
    immediately.
    
    — DEADNET SYSTEM
    ──────────────────────────────
    
    Plain text fallback required.

═══════════════════════════════════════
PART G — ADMIN CONTROLS
═══════════════════════════════════════

19. MANUAL VERIFICATION IN ADMIN CONSOLE
    
    Operators table → user detail slide-out panel:
    
    Show verification status badge:
    - VERIFIED: green badge
    - UNVERIFIED: orange badge
    
    If unverified show:
    [ VERIFY MANUALLY ] button
    Confirmation: "Manually verify [callsign]?
    This bypasses email verification."
    On confirm: set is_verified = true
    Log in audit_log:
    MANUAL_VERIFY: [callsign] by [admin_callsign]
    
    This is the competition day safety net —
    if a student cannot receive their email,
    Admin verifies them in seconds from console.

20. OPERATORS TABLE FILTER UPDATE
    
    Add filter tabs above operators table:
    [ ALL ] [ ACTIVE ] [ UNVERIFIED ] [ BANNED ]
    
    UNVERIFIED tab shows only is_verified = false
    Orange status badge on unverified rows
    
    Bulk action for admin:
    Checkbox per row + [ VERIFY SELECTED ] button
    Useful before competition starts to manually
    activate all accounts at once if needed.

═══════════════════════════════════════
PART H — SECURITY CHECKLIST
═══════════════════════════════════════

21. Verify all of these are implemented:

    [ ] secrets.token_urlsafe(32) for token generation
    [ ] SHA-256 hashing before storing tokens in DB
    [ ] Tokens are single-use (cleared after use)
    [ ] Expired tokens return same error as invalid
    [ ] Registration never reveals if email exists
    [ ] Forgot password never reveals if email exists
    [ ] Rate limiting on all email endpoints (Redis)
    [ ] Email sending is non-blocking (BackgroundTasks)
    [ ] Password reset invalidates all existing sessions
    [ ] FRONTEND_URL used for all email links
    [ ] Plain text fallback on all HTML emails
    [ ] SMTP credentials only in .env never hardcoded