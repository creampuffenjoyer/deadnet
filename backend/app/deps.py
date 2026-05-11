from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import AccountStatus, User, UserRole
from app.redis_client import get_force_logout_after, is_token_blacklisted, update_last_seen
from app.utils.jwt_utils import decode_architect_token, decode_token

_PRIVILEGED_ROLES = {"ADMIN", "CONTRACTOR", "HANDLER", "ARCHITECT"}

security = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Architect virtual user — no DB row, purely credential-based
# ---------------------------------------------------------------------------

class _ArchitectRole:
    value = "ARCHITECT"


class ArchitectUser:
    """Sentinel object returned by get_current_user when architect JWT is detected.
    Carries the callsign from the JWT so audit logs show the correct identity."""
    def __init__(self, callsign: str = "s0L"):
        self.id = None
        self.username = callsign
        self.email = None
        self.role = _ArchitectRole()
        self.is_banned = False
        self.bc_total = 0
        self.void_bc = 0
        self.void_access = True
        self.school = None
        self.section = None
        self.org_id = None
        self.onboarding_complete = True
        self.full_name = callsign
        self.student_id = None
        self.year_level = None


# ---------------------------------------------------------------------------
# Token resolution
# ---------------------------------------------------------------------------

async def get_current_token_payload(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """Decode and validate an access token. Tries architect secret first."""
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Try architect token before normal token — different signing secret
    arch_payload = decode_architect_token(credentials.credentials)
    if arch_payload and arch_payload.get("type") == "access":
        return arch_payload

    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    # Regular tokens must never claim ARCHITECT — architect tokens use a separate secret
    if payload.get("role") == "ARCHITECT":
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


async def get_current_user(
    payload: dict = Depends(get_current_token_payload),
    db: AsyncSession = Depends(get_db),
):
    """Resolve current authenticated user. Returns ArchitectUser for architect JWTs."""
    # Architect short-circuit — no DB lookup, no last_seen update
    if payload.get("role") == "ARCHITECT":
        jti = payload.get("jti")
        if jti and await is_token_blacklisted(jti):
            raise HTTPException(status_code=401, detail="Token has been revoked")
        callsign = payload.get("sub", "s0L")
        return ArchitectUser(callsign)

    # Normal user flow
    jti = payload.get("jti")
    if await is_token_blacklisted(jti):
        raise HTTPException(status_code=401, detail="Token has been revoked")

    user_id = payload.get("sub")
    token_iat = payload.get("iat", 0)
    try:
        force_ts = await get_force_logout_after(str(user_id))
        if force_ts and token_iat < force_ts:
            raise HTTPException(status_code=401, detail="Session invalidated")
    except HTTPException:
        raise
    except Exception:
        pass

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_verified:
        raise HTTPException(status_code=403, detail="EMAIL_NOT_VERIFIED")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="Account suspended")
    _restricted = (AccountStatus.DENIED.value, AccountStatus.PENDING_APPROVAL.value)
    if (user.account_status or AccountStatus.ACTIVE.value) in _restricted:
        raise HTTPException(status_code=403, detail="Account access restricted")

    try:
        await update_last_seen(str(user.id))
    except Exception:
        pass

    return user


# ---------------------------------------------------------------------------
# Role enforcement
# ---------------------------------------------------------------------------

def require_roles(*roles: UserRole):
    """Factory: dependency that enforces one of the given roles.
    Architect automatically passes ALL role checks."""

    async def _check(current_user=Depends(get_current_user)):
        if current_user.role.value == "ARCHITECT":
            return current_user
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return current_user

    return _check


async def require_architect(current_user=Depends(get_current_user)):
    """Dependency that only allows the Architect. Returns 404 to hide the route."""
    if current_user.role.value != "ARCHITECT":
        raise HTTPException(status_code=404, detail="Not found")
    return current_user


# Convenience role dependencies
require_admin = require_roles(UserRole.ADMIN)
require_contractor = require_roles(UserRole.ADMIN, UserRole.CONTRACTOR)
require_handler = require_roles(UserRole.ADMIN, UserRole.HANDLER)
require_operative = require_roles(UserRole.OPERATIVE)
require_authenticated = require_roles(*list(UserRole))


async def require_bounty_board_access(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
):
    """Allow access when bounty_board_public=true OR the user is authenticated."""
    from app.models.settings import PlatformSettings
    row = (await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "bounty_board_public")
    )).scalar_one_or_none()
    is_public = row and row.value.lower() == "true"

    if credentials:
        # Try to resolve user normally (may raise 401 if invalid)
        try:
            from app.utils.jwt_utils import decode_architect_token, decode_token
            arch = decode_architect_token(credentials.credentials)
            if arch and arch.get("type") == "access":
                from app.deps import ArchitectUser
                return ArchitectUser(arch.get("sub", "s0L"))
            payload = decode_token(credentials.credentials)
            if payload and payload.get("type") == "access":
                user = (await db.execute(
                    select(User).where(User.id == payload["sub"])
                )).scalar_one_or_none()
                if user:
                    return user
        except Exception:
            pass

    if is_public:
        return None  # anonymous access allowed

    raise HTTPException(status_code=401, detail="Authentication required")


async def require_active_event(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Dependency: requires an ACTIVE event to exist.
    Privileged roles (ADMIN, CONTRACTOR, HANDLER, ARCHITECT) bypass this check.
    OPERATIVEs get 403 NO_ACTIVE_EVENT if no competition is currently running.
    Returns the active Event object (or None for privileged roles).
    """
    if current_user.role.value in _PRIVILEGED_ROLES:
        return None  # privileged — no event required

    from app.utils.event import get_active_event  # avoid circular at module level
    event = await get_active_event(db)
    if not event:
        raise HTTPException(
            status_code=403,
            detail="NO_ACTIVE_EVENT",
        )
    return event
