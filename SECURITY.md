# DEADNET Platform — Security Overview

A plain-language summary of the security controls built into this platform and how each one works.

---

## Authentication

**JWT (JSON Web Tokens)**
Users receive a short-lived access token (15 minutes) and a longer refresh token (7 days) on login. The access token is signed with a 256-bit random secret key. Refresh tokens can be revoked via logout or session invalidation.

**Architect Tokens**
The Architect shadow role uses a completely separate signing secret from regular users. Architect tokens cannot be forged using the regular JWT key, and regular tokens claiming the Architect role are explicitly rejected — even if they carry a valid signature.

**Token Blacklisting**
On logout, the token's unique ID (JTI) is stored in Redis until expiry. Every authenticated request checks this blacklist, so logged-out tokens are immediately dead.

**Force Logout**
Admins can forcibly invalidate all active sessions for a user by writing a timestamp to Redis. Any token issued before that timestamp is rejected on the next request.

---

## Brute-Force Protection

**Login Lockout**
After 5 failed login attempts within 5 minutes, the account is locked for 15 minutes. Successful login clears the counter. Tracked per username in Redis.

**Architect Lockout**
The Architect login uses a separate lockout counter — 10 failures in 5 minutes triggers a 15-minute lockout. This prevents low-and-slow password guessing against the shadow accounts.

**Rate Limiting on Sensitive Endpoints**
- Flag submission: 5 attempts per minute per user per contract
- Email actions (verification resend, forgot password): 3 per hour per email address
- Operative registration: 20 per hour per IP address
- Staff registration (Contractor/Handler): 3 per 24 hours per IP address

---

## Password Security

**Hashing**
All passwords are hashed with bcrypt (cost factor 12) via passlib. Plain-text passwords are never stored or logged.

**Strength Requirements**
Passwords must be at least 8 characters and contain at least one letter and one digit. This applies to registration, password reset, admin activation, and password change.

**Constant-Time Comparison**
Architect password checks use a constant-time comparison function to prevent timing attacks that could reveal credentials character by character.

**Password Reset Flow**
Reset tokens are single-use, expire after 1 hour, and are stored as SHA-256 hashes in the database (the raw token only travels via email). A successful reset invalidates all existing sessions.

---

## Account Status Enforcement

Every authenticated request checks three things beyond token validity:

1. The user's email must be verified
2. The account must not be banned
3. The account status must not be `DENIED` or `PENDING_APPROVAL`

This means denied or pending accounts cannot use existing tokens to access the platform, even if the token itself has not yet expired.

---

## Role-Based Access Control

Five distinct roles exist: Operative, Handler, Contractor, Admin, and Architect. Each API endpoint explicitly declares which roles are permitted. Architect routes return 404 (not 403) to non-Architect users to avoid revealing their existence.

---

## File Handling

**Upload Validation**
Uploaded files are checked against an admin-configurable extension allowlist (default: zip, pdf, txt, png, jpg, bin). File size is capped at a configurable limit (default 50 MB). Uploaded files are stored with UUID-based names to prevent filename collisions or guessing.

**Download Protection**
File downloads require authentication. Operatives can only download files when a competition is active. The filename is validated to block path traversal — slashes, backslashes, and `..` sequences are rejected before the path is constructed.

---

## Secrets Management

**Environment Variables**
All secrets (JWT keys, database credentials, SMTP password) are stored in a `.env` file that is excluded from version control via `.gitignore`. Default values are not used in production deployments.

**Separate Architect Secret**
The Architect JWT signing key is independent of the main application secret. Compromise of one does not compromise the other.

---

## Security Headers

Every HTTP response includes the following headers:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | geolocation, camera, microphone blocked |
| `Content-Security-Policy` | Restricts script, style, font, and connection sources |

---

## Email Security

**Enumeration Protection**
Registration and forgot-password endpoints return identical responses regardless of whether an email address exists in the system, preventing attackers from discovering registered accounts.

**Token Hashing**
Verification and reset tokens are generated with `secrets.token_urlsafe` (cryptographically random) and stored as SHA-256 hashes. Only the raw token travels via email and it is never stored.

---

## Competition Integrity

**Flag Comparison**
Flags are compared using constant-time string comparison to prevent timing-based flag recovery.

**Attempt Tracking**
Wrong flag submissions are tracked per user per contract. An optional maximum attempt limit can be configured globally by admins.

**First Blood Locking**
First-blood status is set using a database row lock (`SELECT FOR UPDATE`) to prevent race conditions when multiple users solve a contract simultaneously.

**Intel Drop Gating**
Hint content is only returned in API responses after a user has purchased the hint. Unpurchased hints return null content, not an empty string.

---

## Void Layer (Easter Egg)

The hidden `/v01d` section requires a valid session token (any authenticated user). Void contracts enforce a hard 5-attempt limit per user. The Architect role has unrestricted access to void admin endpoints, while regular Admins can only manage void contracts within their organization scope.
