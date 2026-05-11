import hashlib
import re
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_token_payload, get_current_user
from app.models.notification import Notification
from app.models.registration_request import RegistrationRequest, RegRequestStatus
from app.models.settings import PlatformSettings
from app.models.user import AccountStatus, User, UserRole
from app.redis_client import (
    blacklist_token,
    check_email_rate_limit,
    check_reg_rate_limit,
    clear_architect_failures,
    is_architect_locked,
    record_architect_failure,
    set_deny_delete,
    set_force_logout_after,
)
from app.services.email_service import (
    send_admin_notification_email,
    send_already_registered_email,
    send_approval_email,
    send_denial_email,
    send_password_reset_email,
    send_staff_verification_email,
    send_verification_email,
)
from app.utils.rate_limit import (
    check_rate_limit,
    clear_login_failures,
    is_login_locked,
    record_failed_login,
)
from app.schemas.auth import (
    AccessTokenResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserOut,
)
from app.utils.jwt_utils import (
    create_access_token,
    create_architect_token,
    create_pending_token,
    create_refresh_token,
    decode_token,
)
from app.routers.organizations import validate_organization_active
from app.utils.roles import get_organization_scope
from app.utils.security import constant_time_compare, hash_password, verify_password


def _hash_token(raw: str) -> str:
    """SHA-256 hex digest of a raw token string."""
    return hashlib.sha256(raw.encode()).hexdigest()

router = APIRouter()
_bearer = HTTPBearer()


_VERIFY_TOKEN_TTL = timedelta(hours=24)
_SUCCESS_MSG = "Verification email dispatched. Activate your account to access DEADNET."

_PASSWORD_RE_LETTER = re.compile(r"[a-zA-Z]")
_PASSWORD_RE_DIGIT  = re.compile(r"[0-9]")


def _validate_password_strength(password: str) -> None:
    """Raise HTTPException if password doesn't meet minimum requirements."""
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="PASSWORD_TOO_SHORT")
    if not _PASSWORD_RE_LETTER.search(password):
        raise HTTPException(status_code=400, detail="PASSWORD_NEEDS_LETTER")
    if not _PASSWORD_RE_DIGIT.search(password):
        raise HTTPException(status_code=400, detail="PASSWORD_NEEDS_NUMBER")


@router.post("/register", status_code=201)
async def register(
    body: RegisterRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    # IP rate limit: 20 attempts per hour
    ip = request.client.host if request.client else "unknown"
    if not await check_rate_limit(f"op_reg_attempt:{ip}", max_calls=20, window_seconds=3600):
        raise HTTPException(status_code=429, detail="Too many registration attempts. Try again later.")

    # Check master registration lock (Architect override — blocks all registrations)
    lock_row = (await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "platform_registration_locked")
    )).scalar_one_or_none()
    if lock_row and lock_row.value.lower() == "true":
        raise HTTPException(status_code=403, detail="ENLISTMENT_CLOSED")

    # Check registration window
    result = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "registration_open")
    )
    setting = result.scalar_one_or_none()
    if setting and setting.value.lower() != "true":
        raise HTTPException(status_code=403, detail="ENLISTMENT_CLOSED")

    # Username uniqueness — OK to reveal (callsigns are public)
    if (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none():
        raise HTTPException(status_code=400, detail="CALLSIGN_TAKEN")

    # Email enumeration protection — if email exists, notify that account silently
    existing = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if existing:
        background_tasks.add_task(
            send_already_registered_email, existing.email, existing.username
        )
        return {"message": _SUCCESS_MSG}

    # Generate verification token (raw goes in email, hash stored in DB)
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = datetime.utcnow() + _VERIFY_TOKEN_TTL

    user = User(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
        role=UserRole.OPERATIVE,
        is_verified=False,
        account_status=AccountStatus.PENDING_VERIFICATION.value,
        verification_token=token_hash,
        verification_token_expires=expires_at,
    )
    db.add(user)
    await db.commit()

    background_tasks.add_task(send_verification_email, user.email, user.username, raw_token)
    return {"message": _SUCCESS_MSG}


_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,20}$")
_STAFF_REG_MSG = (
    "Verification email dispatched. Verify your email to submit your "
    "request for admin approval."
)


class StaffRegisterRequest(BaseModel):
    callsign: str = Field(..., min_length=3, max_length=20)
    email: str
    password: str = Field(..., min_length=8)
    full_name: str = Field(..., min_length=1, max_length=100)
    org_id: Optional[int] = None
    reason: str = Field(..., min_length=10, max_length=500)


async def _register_staff(
    body: StaffRegisterRequest,
    role: UserRole,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession,
):
    # IP rate limit — 3 attempts per 24h
    ip = request.client.host if request.client else "unknown"
    if not await check_reg_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Too many registration attempts. Try again later.")

    # Callsign validation
    if not _USERNAME_RE.match(body.callsign):
        raise HTTPException(status_code=400, detail="CALLSIGN_INVALID")
    if (await db.execute(select(User).where(User.username == body.callsign))).scalar_one_or_none():
        raise HTTPException(status_code=400, detail="CALLSIGN_TAKEN")

    # Password strength
    _validate_password_strength(body.password)

    # Email enumeration protection
    existing = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if existing:
        background_tasks.add_task(send_already_registered_email, existing.email, existing.username)
        return {"message": _STAFF_REG_MSG}

    # Validate organization if provided
    if body.org_id is not None:
        await validate_organization_active(body.org_id, db)

        # Enforce max_operators_per_org cap (0 = unlimited)
        cap_row = (await db.execute(
            select(PlatformSettings).where(PlatformSettings.key == "max_operators_per_org")
        )).scalar_one_or_none()
        cap = int((cap_row.value if cap_row else None) or "0")
        if cap > 0:
            org_user_count = (await db.execute(
                select(func.count(User.id)).where(User.org_id == body.org_id)
            )).scalar() or 0
            if org_user_count >= cap:
                raise HTTPException(status_code=409, detail=f"Organization operator cap reached ({cap})")

    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = datetime.utcnow() + _VERIFY_TOKEN_TTL

    user = User(
        username=body.callsign,
        email=body.email,
        hashed_password=hash_password(body.password),
        role=role,
        full_name=body.full_name,
        org_id=body.org_id,
        registration_reason=body.reason,
        is_verified=False,
        account_status=AccountStatus.PENDING_VERIFICATION.value,
        verification_token=token_hash,
        verification_token_expires=expires_at,
    )
    db.add(user)
    db.add(RegistrationRequest(
        callsign=body.callsign,
        email=body.email,
        role_requested=role.value,
        reason=body.reason,
        status=RegRequestStatus.PENDING.value,
        org_id=body.org_id,
    ))
    await db.commit()

    background_tasks.add_task(
        send_staff_verification_email, user.email, user.username, role.value, raw_token
    )
    return {"message": _STAFF_REG_MSG}


@router.post("/register/contractor", status_code=201)
async def register_contractor(
    body: StaffRegisterRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    return await _register_staff(body, UserRole.CONTRACTOR, request, background_tasks, db)


@router.post("/register/handler", status_code=201)
async def register_handler(
    body: StaffRegisterRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    return await _register_staff(body, UserRole.HANDLER, request, background_tasks, db)


@router.get("/verify-email")
async def verify_email(
    background_tasks: BackgroundTasks,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    token_hash = _hash_token(token)
    result = await db.execute(
        select(User).where(User.verification_token == token_hash)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=400, detail="INVALID_OR_EXPIRED")

    is_staff = user.role in (UserRole.CONTRACTOR, UserRole.HANDLER)

    # Already verified — idempotent
    if user.is_verified:
        if is_staff and user.account_status == AccountStatus.PENDING_APPROVAL.value:
            # Still pending — return pending token again
            pending_token = create_pending_token(
                user.username, user.email, user.role.value, user.account_status
            )
            return {"status": "PENDING_APPROVAL", "pending_token": pending_token}
        if is_staff and user.account_status == AccountStatus.ACTIVE.value:
            # Already approved — direct to login
            return {"status": "ACTIVE", "message": "Account already approved. Please log in."}
        # OPERATIVE already verified → full JWT
        token_data = {"sub": str(user.id), "role": user.role.value}
        return {
            "access_token": create_access_token(token_data),
            "refresh_token": create_refresh_token(token_data),
            "token_type": "bearer",
            "username": user.username,
        }

    if user.verification_token_expires and datetime.utcnow() > user.verification_token_expires:
        raise HTTPException(status_code=400, detail="INVALID_OR_EXPIRED")

    # Mark verified and clear token fields
    user.is_verified = True
    user.verification_token = None
    user.verification_token_expires = None

    if is_staff:
        # Move to PENDING_APPROVAL instead of ACTIVE
        user.account_status = AccountStatus.PENDING_APPROVAL.value
        await db.commit()

        # Notify all admins
        admin_res = await db.execute(select(User).where(User.role == UserRole.ADMIN))
        admins = admin_res.scalars().all()
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
        reason = user.registration_reason or ""
        for admin in admins:
            background_tasks.add_task(
                send_admin_notification_email,
                admin.email, user.username, user.role.value, reason, user.email, timestamp,
            )
            db.add(Notification(
                user_id=admin.id,
                message=(
                    f"New {user.role.value} registration request from "
                    f"{user.username} — awaiting your approval."
                ),
            ))
        await db.commit()

        pending_token = create_pending_token(
            user.username, user.email, user.role.value, AccountStatus.PENDING_APPROVAL.value
        )
        return {
            "verified": True,
            "status": "PENDING_APPROVAL",
            "pending_token": pending_token,
            "message": (
                "Email verified. Your request is now pending administrator approval. "
                "You will be notified by email when a decision has been made."
            ),
        }

    # OPERATIVE — set ACTIVE and issue JWT
    user.account_status = AccountStatus.ACTIVE.value
    await db.commit()

    token_data = {"sub": str(user.id), "role": user.role.value}
    return {
        "access_token": create_access_token(token_data),
        "refresh_token": create_refresh_token(token_data),
        "token_type": "bearer",
        "username": user.username,
    }


class ResendVerificationRequest(BaseModel):
    email: str


@router.post("/resend-verification")
async def resend_verification(
    body: ResendVerificationRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    _RESEND_MSG = {"message": "If unverified, a new link has been dispatched."}

    # Rate limit: 3 per hour per email
    allowed = await check_email_rate_limit("resend_verification", body.email)
    if not allowed:
        # Still return success-looking response — don't reveal rate limit
        return _RESEND_MSG

    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or user.is_verified:
        return _RESEND_MSG

    raw_token = secrets.token_urlsafe(32)
    user.verification_token = _hash_token(raw_token)
    user.verification_token_expires = datetime.utcnow() + _VERIFY_TOKEN_TTL
    await db.commit()

    background_tasks.add_task(send_verification_email, user.email, user.username, raw_token)
    return _RESEND_MSG


@router.post("/login", response_model=TokenResponse)
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    from app.config import settings as _settings

    # ── Architect intercept — must come before normal user lookup ──
    from app.utils.architect import load_architects
    _architects = load_architects()
    _arch_callsigns = {a["callsign"] for a in _architects}
    if body.username in _arch_callsigns:
        if await is_architect_locked():
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")
        for arch in _architects:
            if arch["callsign"] == body.username and constant_time_compare(body.password, arch["password"]):
                await clear_architect_failures()
                return {
                    "access_token": create_architect_token(arch["callsign"]),
                    "refresh_token": "",  # Architect has no refresh token
                    "token_type": "bearer",
                }
        await record_architect_failure()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # ── Normal user login ──
    if await is_login_locked(body.username):
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Try again later.",
        )

    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        await record_failed_login(body.username)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="Account suspended")

    status = user.account_status or AccountStatus.ACTIVE.value
    if status == AccountStatus.PENDING_VERIFICATION.value:
        raise HTTPException(status_code=403, detail="EMAIL_NOT_VERIFIED")
    if status == AccountStatus.PENDING_APPROVAL.value:
        raise HTTPException(status_code=403, detail="PENDING_APPROVAL")
    if status == AccountStatus.PENDING_PASSWORD_SET.value:
        raise HTTPException(status_code=403, detail="PENDING_ACTIVATION")
    if status == AccountStatus.DENIED.value:
        raise HTTPException(status_code=403, detail="ACCOUNT_DENIED")

    await clear_login_failures(body.username)

    user.last_login = datetime.utcnow()
    user.last_ip = request.client.host if request.client else None
    await db.commit()

    token_data = {"sub": str(user.id), "role": user.role.value}
    return {
        "access_token": create_access_token(token_data),
        "refresh_token": create_refresh_token(token_data),
        "token_type": "bearer",
    }


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _validate_password_strength(body.new_password)
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.hashed_password = hash_password(body.new_password)
    await db.commit()
    return {"message": "Password updated"}


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    from app.redis_client import is_token_blacklisted

    if await is_token_blacklisted(payload.get("jti", "")):
        raise HTTPException(status_code=401, detail="Refresh token revoked")

    result = await db.execute(select(User).where(User.id == payload.get("sub")))
    user = result.scalar_one_or_none()
    if not user or user.is_banned:
        raise HTTPException(status_code=401, detail="User not found or suspended")
    _restricted = (AccountStatus.DENIED.value, AccountStatus.PENDING_APPROVAL.value)
    if (user.account_status or AccountStatus.ACTIVE.value) in _restricted:
        raise HTTPException(status_code=403, detail="Account access restricted")

    token_data = {"sub": str(user.id), "role": user.role.value}
    return {"access_token": create_access_token(token_data), "token_type": "bearer"}


@router.post("/logout")
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    payload: dict = Depends(get_current_token_payload),
    _user: User = Depends(get_current_user),
):
    jti = payload.get("jti", "")
    exp = payload.get("exp", 0)
    expires_in = int(exp - datetime.utcnow().timestamp())
    await blacklist_token(jti, expires_in)
    return {"message": "Gone dark"}


@router.get("/me")
async def me(current_user=Depends(get_current_user)):
    from app.deps import ArchitectUser
    if isinstance(current_user, ArchitectUser):
        return {
            "id": None,
            "username": "s0L",
            "email": None,
            "role": "ARCHITECT",
            "is_banned": False,
            "is_verified": True,
            "bc_total": 0,
            "void_bc": 0,
            "void_access": True,
            "onboarding_complete": True,
            "full_name": "s0L",
            "student_id": None,
            "school": None,
            "section": None,
            "year_level": None,
            "org_id": None,
            "account_status": "ACTIVE",
        }
    return {
        "id": str(current_user.id),
        "username": current_user.username,
        "email": current_user.email,
        "role": current_user.role,
        "is_banned": current_user.is_banned,
        "is_verified": current_user.is_verified,
        "bc_total": current_user.bc_total or 0,
        "void_bc": current_user.void_bc or 0,
        "void_access": current_user.void_access or False,
        "onboarding_complete": current_user.onboarding_complete or False,
        "full_name": current_user.full_name,
        "student_id": current_user.student_id,
        "school": current_user.school,
        "section": current_user.section,
        "year_level": current_user.year_level,
        "org_id": current_user.org_id,
        "account_status": current_user.account_status,
    }


@router.post("/revoke-sessions")
async def revoke_sessions(current_user: User = Depends(get_current_user)):
    """Invalidate all active sessions for the current user."""
    await set_force_logout_after(str(current_user.id))
    return {"message": "All sessions revoked"}


_RESET_TOKEN_TTL = timedelta(hours=1)
_FORGOT_MSG = {"message": "If that email is registered, a reset link has been dispatched."}

class ForgotPasswordRequest(BaseModel):
    email: str


@router.post("/forgot-password")
async def forgot_password(
    body: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    # Rate limit: 3 per hour per email — silently enforce
    allowed = await check_email_rate_limit("forgot_password", body.email)
    if not allowed:
        return _FORGOT_MSG

    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    # Always return same response — never reveal if email exists
    if not user:
        return _FORGOT_MSG

    raw_token = secrets.token_urlsafe(32)
    user.password_reset_token = _hash_token(raw_token)
    user.password_reset_expires = datetime.utcnow() + _RESET_TOKEN_TTL
    user.password_reset_requested_at = datetime.utcnow()
    await db.commit()

    background_tasks.add_task(send_password_reset_email, user.email, user.username, raw_token)
    return _FORGOT_MSG


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str
    confirm_password: str


@router.post("/reset-password")
async def reset_password(
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=400, detail="PASSWORDS_DO_NOT_MATCH")

    _validate_password_strength(body.new_password)

    token_hash = _hash_token(body.token)
    result = await db.execute(
        select(User).where(User.password_reset_token == token_hash)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=400, detail="INVALID_OR_EXPIRED")
    if user.password_reset_expires and datetime.utcnow() > user.password_reset_expires:
        raise HTTPException(status_code=400, detail="INVALID_OR_EXPIRED")

    # Update password, clear reset token fields (single-use)
    user.hashed_password = hash_password(body.new_password)
    user.password_reset_token = None
    user.password_reset_expires = None
    user.password_reset_requested_at = None
    await db.commit()

    # Invalidate all existing sessions
    await set_force_logout_after(str(user.id))

    # Issue fresh JWT so user is logged in immediately
    token_data = {"sub": str(user.id), "role": user.role.value}
    return {
        "access_token": create_access_token(token_data),
        "refresh_token": create_refresh_token(token_data),
        "token_type": "bearer",
        "username": user.username,
    }


# ---------------------------------------------------------------------------
# Admin invitation activation
# ---------------------------------------------------------------------------

@router.get("/validate-invite")
async def validate_invite(
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Validate an Architect-issued admin invitation token.
    Returns callsign and organization name if valid."""
    token_hash = _hash_token(token)
    user = (await db.execute(
        select(User).where(
            User.password_reset_token == token_hash,
            User.account_status == AccountStatus.PENDING_PASSWORD_SET.value,
        )
    )).scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=400, detail="INVALID_OR_EXPIRED")
    if user.password_reset_expires and datetime.utcnow() > user.password_reset_expires:
        raise HTTPException(status_code=400, detail="INVALID_OR_EXPIRED")

    organization_name = None
    if user.org_id:
        from app.models.organization import Organization
        univ = (await db.execute(
            select(Organization).where(Organization.id == user.org_id)
        )).scalar_one_or_none()
        if univ:
            organization_name = univ.name

    return {
        "valid": True,
        "callsign": user.username,
        "organization_name": organization_name,
    }


class ActivateAdminRequest(BaseModel):
    token: str
    new_password: str
    confirm_password: str


@router.post("/activate-admin")
async def activate_admin(
    body: ActivateAdminRequest,
    db: AsyncSession = Depends(get_db),
):
    """Activate an Admin account via invitation token. Sets password, marks ACTIVE, issues JWT."""
    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=400, detail="PASSWORDS_DO_NOT_MATCH")

    _validate_password_strength(body.new_password)

    token_hash = _hash_token(body.token)
    user = (await db.execute(
        select(User).where(
            User.password_reset_token == token_hash,
            User.account_status == AccountStatus.PENDING_PASSWORD_SET.value,
        )
    )).scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=400, detail="INVALID_OR_EXPIRED")
    if user.password_reset_expires and datetime.utcnow() > user.password_reset_expires:
        raise HTTPException(status_code=400, detail="INVALID_OR_EXPIRED")

    user.hashed_password = hash_password(body.new_password)
    user.account_status = AccountStatus.ACTIVE.value
    user.password_reset_token = None
    user.password_reset_expires = None
    user.password_reset_requested_at = None
    await db.commit()

    token_data = {"sub": str(user.id), "role": user.role.value}
    return {
        "access_token": create_access_token(token_data),
        "refresh_token": create_refresh_token(token_data),
        "token_type": "bearer",
        "username": user.username,
    }


@router.delete("/account", status_code=204)
async def delete_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Hard-delete own account. Only allowed before competition starts."""
    from datetime import datetime
    from app.models.team import Team, TeamMembership

    # Block if competition has started
    start_row = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "competition_start")
    )
    start_setting = start_row.scalar_one_or_none()
    if start_setting and start_setting.value:
        try:
            start_dt = datetime.fromisoformat(start_setting.value)
            if datetime.utcnow() >= start_dt:
                raise HTTPException(
                    status_code=403, detail="COMPETITION_STARTED_CANNOT_DELETE"
                )
        except (ValueError, TypeError):
            pass

    user_id = current_user.id

    # Clean up memberships and team captaincy
    mem = await db.execute(select(TeamMembership).where(TeamMembership.operative_id == user_id))
    for row in mem.scalars().all():
        await db.delete(row)

    syn_res = await db.execute(select(Team).where(Team.captain_id == user_id))
    for syn in syn_res.scalars().all():
        syn.captain_id = None

    await db.delete(current_user)
    await db.commit()


# ---------------------------------------------------------------------------
# Pending status — accepts pending JWT only (not full access JWT)
# ---------------------------------------------------------------------------

@router.get("/pending-status")
async def pending_status(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
):
    """Check current approval status for CONTRACTOR/HANDLER accounts.
    Accepts a pending JWT (type='pending') only."""
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "pending":
        raise HTTPException(status_code=401, detail="Invalid token")

    callsign = payload.get("callsign")
    result = await db.execute(select(User).where(User.username == callsign))
    user = result.scalar_one_or_none()

    if not user:
        # Account deleted (denied+cleaned up) — show denied state
        return {
            "callsign": callsign,
            "email": payload.get("email", ""),
            "role": payload.get("role", ""),
            "status": AccountStatus.DENIED.value,
            "denied_reason": "Account has been removed.",
        }

    return {
        "callsign": user.username,
        "email": user.email,
        "role": user.role.value,
        "status": user.account_status,
        "denied_reason": user.denied_reason,
    }


# ---------------------------------------------------------------------------
# Registration request management — ADMIN only
# ---------------------------------------------------------------------------

class RegistrationActionRequest(BaseModel):
    admin_response: str = Field(..., min_length=5, max_length=300)


@router.get("/registration-requests")
async def list_registration_requests(
    status: str = Query("PENDING"),
    org_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")

    scope = get_organization_scope(current_user, org_id)
    query = select(RegistrationRequest)
    if scope is not None:
        query = query.where(RegistrationRequest.org_id == scope)
    if status != "ALL":
        query = query.where(RegistrationRequest.status == status.upper())
    query = query.order_by(RegistrationRequest.requested_at.desc()).limit(100)

    result = await db.execute(query)
    rows = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "callsign": r.callsign,
            "email": r.email,
            "role_requested": r.role_requested,
            "reason": r.reason,
            "status": r.status,
            "admin_callsign": r.admin_callsign,
            "admin_reason": r.admin_reason,
            "requested_at": r.requested_at.isoformat() if r.requested_at else None,
            "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
        }
        for r in rows
    ]


@router.get("/registration-requests/pending-count")
async def registration_requests_pending_count(
    org_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    from sqlalchemy import func
    scope = get_organization_scope(current_user, org_id)
    reg_pending_q = select(func.count(RegistrationRequest.id)).where(
        RegistrationRequest.status == RegRequestStatus.PENDING.value
    )
    if scope is not None:
        reg_pending_q = reg_pending_q.where(RegistrationRequest.org_id == scope)
    res = await db.execute(reg_pending_q)
    return {"count": res.scalar() or 0}


@router.patch("/registration-requests/{reg_id}/approve")
async def approve_registration(
    reg_id: str,
    body: RegistrationActionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")

    reg = (await db.execute(
        select(RegistrationRequest).where(RegistrationRequest.id == reg_id)
    )).scalar_one_or_none()
    if not reg or reg.status != RegRequestStatus.PENDING.value:
        raise HTTPException(status_code=404, detail="Request not found or already resolved")

    user = (await db.execute(select(User).where(User.username == reg.callsign))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User account not found")

    # Approve — set org_id from request (if any) or fall back to approving admin's
    if not user.org_id:
        uid = reg.org_id or getattr(current_user, "org_id", None)
        if uid:
            user.org_id = uid
    user.account_status = AccountStatus.ACTIVE.value
    reg.status = RegRequestStatus.APPROVED.value
    reg.admin_callsign = current_user.username
    reg.admin_reason = body.admin_response
    reg.resolved_at = datetime.utcnow()
    await db.commit()

    background_tasks.add_task(
        send_approval_email, user.email, user.username, user.role.value, body.admin_response
    )
    return {"approved": True, "callsign": reg.callsign}


@router.patch("/registration-requests/{reg_id}/deny")
async def deny_registration(
    reg_id: str,
    body: RegistrationActionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")

    reg = (await db.execute(
        select(RegistrationRequest).where(RegistrationRequest.id == reg_id)
    )).scalar_one_or_none()
    if not reg or reg.status != RegRequestStatus.PENDING.value:
        raise HTTPException(status_code=404, detail="Request not found or already resolved")

    user = (await db.execute(select(User).where(User.username == reg.callsign))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User account not found")

    # Deny
    user.account_status = AccountStatus.DENIED.value
    user.denied_reason = body.admin_response
    reg.status = RegRequestStatus.DENIED.value
    reg.admin_callsign = current_user.username
    reg.admin_reason = body.admin_response
    reg.resolved_at = datetime.utcnow()
    await db.commit()

    # Set 24h deletion gate
    await set_deny_delete(str(user.id))

    background_tasks.add_task(
        send_denial_email, user.email, user.username, user.role.value, body.admin_response
    )
    return {"denied": True, "callsign": reg.callsign}


@router.delete("/registration-requests", status_code=200)
async def clear_resolved_registration_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    result = await db.execute(
        delete(RegistrationRequest).where(
            RegistrationRequest.status != RegRequestStatus.PENDING.value
        )
    )
    await db.commit()
    return {"deleted": result.rowcount}
