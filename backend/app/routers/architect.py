"""
Architect-exclusive endpoints.
All routes under /architect/* return 404 to non-architect users.
"""
import csv
import hashlib
import io
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from uuid import UUID
from sqlalchemy import delete, func, or_, select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_architect
from app.models.audit import ArchitectLog
from app.models.settings import PlatformSettings
from app.models.contract import Claim, Contract, IntelDrop
from app.models.event import Event, EventStatus
from app.models.event_registration import EventRegistration
from app.models.organization import Organization
from app.models.user import AccountStatus, User, UserRole
from app.redis_client import check_email_rate_limit
from app.services.email_service import send_admin_invitation_email, send_password_reset_email
from app.utils.security import hash_password

_INVITE_TOKEN_TTL = timedelta(hours=72)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class InviteAdminBody(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., max_length=255)

router = APIRouter()


_CATEGORY_KEYWORDS = {
    "USERS":     ["USER", "ADMIN", "INVITE", "BAN", "ROLE", "VERIFY", "RESET_PW"],
    "EVENTS":    ["EVENT", "RESET", "ARCHIVE", "HALT", "RESUME"],
    "CONTRACTS": ["CONTRACT", "VOID", "INTEL"],
    "SETTINGS":  ["SETTING", "CLEAR", "LOG", "ORG"],
}


def _row_to_dict(r: ArchitectLog, org_map: dict) -> dict:
    org = org_map.get(r.org_id)
    return {
        "id":           str(r.id),
        "action":       r.action,
        "target":       r.target,
        "extra":        r.extra,
        "org_id":       r.org_id,
        "org_code":     org.org_code if org else None,
        "org_name":     org.name if org else None,
        "performed_by": (r.extra or {}).get("performed_by", "s0L"),
        "ip":           (r.extra or {}).get("ip"),
        "timestamp":    r.timestamp.isoformat(),
    }


@router.get("/log")
async def get_architect_log(
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
    org_id: Optional[int]  = Query(None),
    category: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str]   = Query(None),
):
    """Retrieve the architect action log with optional filters."""
    q = select(ArchitectLog).order_by(ArchitectLog.timestamp.desc()).limit(1000)
    if org_id is not None:
        q = q.where(ArchitectLog.org_id == org_id)
    if date_from:
        try:
            q = q.where(ArchitectLog.timestamp >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.where(ArchitectLog.timestamp <= datetime.fromisoformat(date_to))
        except ValueError:
            pass

    rows = (await db.execute(q)).scalars().all()

    # Filter by category client-side (action keyword matching)
    if category and category.upper() in _CATEGORY_KEYWORDS:
        kws = _CATEGORY_KEYWORDS[category.upper()]
        rows = [r for r in rows if any(k in r.action.upper() for k in kws)]

    # Build org lookup
    org_ids = {r.org_id for r in rows if r.org_id}
    orgs = {}
    if org_ids:
        org_rows = (await db.execute(
            select(Organization).where(Organization.id.in_(org_ids))
        )).scalars().all()
        orgs = {o.id: o for o in org_rows}

    return [_row_to_dict(r, orgs) for r in rows]


@router.get("/log/export")
async def export_architect_log(
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
    org_id: Optional[int]  = Query(None),
    category: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str]   = Query(None),
):
    """Export filtered architect log as CSV."""
    # Reuse same filtering logic
    q = select(ArchitectLog).order_by(ArchitectLog.timestamp.desc()).limit(5000)
    if org_id is not None:
        q = q.where(ArchitectLog.org_id == org_id)
    if date_from:
        try:
            q = q.where(ArchitectLog.timestamp >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.where(ArchitectLog.timestamp <= datetime.fromisoformat(date_to))
        except ValueError:
            pass

    rows = (await db.execute(q)).scalars().all()

    if category and category.upper() in _CATEGORY_KEYWORDS:
        kws = _CATEGORY_KEYWORDS[category.upper()]
        rows = [r for r in rows if any(k in r.action.upper() for k in kws)]

    org_ids = {r.org_id for r in rows if r.org_id}
    orgs = {}
    if org_ids:
        org_rows = (await db.execute(
            select(Organization).where(Organization.id.in_(org_ids))
        )).scalars().all()
        orgs = {o.id: o for o in org_rows}

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["TIMESTAMP", "ORG", "ACTION", "TARGET", "PERFORMED BY", "IP", "DETAILS"])
    for r in rows:
        d = _row_to_dict(r, orgs)
        details = str(r.extra) if r.extra else ""
        writer.writerow([
            d["timestamp"], d["org_code"] or "", d["action"],
            d["target"] or "", d["performed_by"], d["ip"] or "", details,
        ])

    buf.seek(0)
    fname = f"change-logs-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.delete("/log")
async def clear_architect_log(
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    """Wipe all architect log entries. Logs the clear itself first."""
    from datetime import datetime
    db.add(ArchitectLog(
        action="CLEAR_LOG",
        target="architect_log",
        extra={"note": "Architect cleared their own log"},
    ))
    await db.execute(delete(ArchitectLog).where(
        ArchitectLog.action != "CLEAR_LOG"  # keep this one entry
    ))
    await db.commit()
    return {"cleared": True}


@router.get("/me")
async def architect_me(arch=Depends(require_architect)):
    """Confirm architect identity. Returns minimal info."""
    return {"callsign": arch.username, "role": "ARCHITECT"}


@router.get("/search")
async def architect_search(
    q: str = Query(..., min_length=2, max_length=100),
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    """Global search across operators, organizations, and events."""
    like = f"%{q.lower()}%"

    # Operators — match username or email
    user_rows = (await db.execute(
        select(User, Organization.org_code)
        .join(Organization, Organization.id == User.org_id, isouter=True)
        .where(or_(
            func.lower(User.username).like(like),
            func.lower(User.email).like(like),
        ))
        .order_by(User.username)
        .limit(6)
    )).all()

    # Organizations — match name or org_code
    org_rows = (await db.execute(
        select(Organization)
        .where(or_(
            func.lower(Organization.name).like(like),
            func.lower(Organization.org_code).like(like),
        ))
        .limit(5)
    )).scalars().all()

    # Events — match name
    event_rows = (await db.execute(
        select(Event)
        .where(func.lower(Event.name).like(like))
        .order_by(Event.created_at.desc())
        .limit(5)
    )).scalars().all()

    return {
        "operators": [
            {
                "id": str(u.id),
                "username": u.username,
                "email": u.email,
                "role": u.role.value if hasattr(u.role, "value") else str(u.role),
                "org_code": org_code,
                "org_id": u.org_id,
                "is_banned": u.is_banned,
            }
            for u, org_code in user_rows
        ],
        "organizations": [
            {
                "id": o.id,
                "name": o.name,
                "org_code": o.org_code,
                "is_active": o.is_active,
                "logo_url": o.logo_url,
            }
            for o in org_rows
        ],
        "events": [
            {
                "id": e.id,
                "name": e.name,
                "status": e.status,
                "event_type": e.event_type,
                "org_id": e.org_id,
            }
            for e in event_rows
        ],
    }


@router.get("/overview")
async def architect_overview(
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    """Global stats and per-organization summary cards for the Architect Overview tab."""
    # Global counts
    total_organizations = (await db.execute(select(func.count(Organization.id)))).scalar() or 0
    total_users = (await db.execute(select(func.count(User.id)))).scalar() or 0
    active_events_count = (await db.execute(
        select(func.count(Event.id)).where(Event.status == EventStatus.ACTIVE.value)
    )).scalar() or 0

    organizations = (await db.execute(
        select(Organization).order_by(Organization.created_at)
    )).scalars().all()

    if not organizations:
        return {
            "stats": {
                "total_organizations": total_organizations,
                "total_users": total_users,
                "active_events": active_events_count,
            },
            "organizations": [],
        }

    univ_ids = [u.id for u in organizations]

    # User counts per organization
    user_counts = {
        r[0]: r[1]
        for r in (await db.execute(
            select(User.org_id, func.count(User.id))
            .where(User.org_id.in_(univ_ids))
            .group_by(User.org_id)
        )).all()
    }

    # Event counts per organization
    event_counts = {
        r[0]: r[1]
        for r in (await db.execute(
            select(Event.org_id, func.count(Event.id))
            .where(Event.org_id.in_(univ_ids))
            .group_by(Event.org_id)
        )).all()
    }

    # Active events per organization (one per organization max)
    active_event_rows = (await db.execute(
        select(Event).where(
            Event.org_id.in_(univ_ids),
            Event.status == EventStatus.ACTIVE.value,
        )
    )).scalars().all()
    active_events_by_univ = {e.org_id: e for e in active_event_rows}

    # Participant counts for active events
    participant_counts: dict = {}
    if active_event_rows:
        active_event_ids = [e.id for e in active_event_rows]
        participant_counts = {
            r[0]: r[1]
            for r in (await db.execute(
                select(EventRegistration.event_id, func.count(EventRegistration.id))
                .where(
                    EventRegistration.event_id.in_(active_event_ids),
                    EventRegistration.status == "ACTIVE",
                )
                .group_by(EventRegistration.event_id)
            )).all()
        }

    # First ADMIN callsign per organization
    admin_rows = (await db.execute(
        select(User.org_id, User.username)
        .where(User.role == UserRole.ADMIN, User.org_id.in_(univ_ids))
        .order_by(User.org_id, User.created_at)
    )).all()
    admin_by_univ: dict = {}
    for univ_id, username in admin_rows:
        if univ_id not in admin_by_univ:
            admin_by_univ[univ_id] = username

    univ_summaries = []
    for u in organizations:
        ae = active_events_by_univ.get(u.id)
        univ_summaries.append({
            "id": u.id,
            "name": u.name,
            "org_code": u.org_code,
            "is_active": u.is_active,
            "logo_url": u.logo_url,
            "updated_at": u.updated_at.isoformat() if u.updated_at else None,
            "admin_callsign": admin_by_univ.get(u.id),
            "user_count": user_counts.get(u.id, 0),
            "event_count": event_counts.get(u.id, 0),
            "active_event": {
                "id": ae.id,
                "name": ae.name,
                "participant_count": participant_counts.get(ae.id, 0),
            } if ae else None,
        })

    return {
        "stats": {
            "total_organizations": total_organizations,
            "total_users": total_users,
            "active_events": active_events_count,
        },
        "organizations": univ_summaries,
    }


# ---------------------------------------------------------------------------
# POST /architect/organizations/{univ_id}/invite-admin
# Creates an ADMIN account and sends an invitation email.
# ---------------------------------------------------------------------------

@router.post("/organizations/{univ_id}/invite-admin", status_code=201)
async def invite_admin(
    univ_id: int,
    body: InviteAdminBody,
    background_tasks: BackgroundTasks,
    arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    """Create an Admin account for a organization and send an activation invitation."""
    # Verify organization exists
    organization = (await db.execute(
        select(Organization).where(Organization.id == univ_id)
    )).scalar_one_or_none()
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Rate limit: 3 invitations per hour per organization (keyed by organization id)
    allowed = await check_email_rate_limit("arch_invite", str(univ_id))
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many invitations sent for this organization. Try again later.",
        )

    # Username uniqueness
    username_clash = (await db.execute(
        select(User).where(User.username == body.username)
    )).scalar_one_or_none()
    if username_clash:
        raise HTTPException(status_code=409, detail="USERNAME_TAKEN")

    # Email uniqueness
    email_clash = (await db.execute(
        select(User).where(User.email == body.email)
    )).scalar_one_or_none()
    if email_clash:
        raise HTTPException(status_code=409, detail="EMAIL_TAKEN")

    # Generate invitation token (raw → email, hash → DB via password_reset_token field)
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = datetime.utcnow() + _INVITE_TOKEN_TTL

    # Create admin account
    admin = User(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(secrets.token_urlsafe(16)),  # unusable until activated
        role=UserRole.ADMIN,
        org_id=univ_id,
        is_verified=True,
        account_status=AccountStatus.PENDING_PASSWORD_SET.value,
        onboarding_complete=False,
        password_reset_token=token_hash,
        password_reset_expires=expires_at,
    )
    db.add(admin)
    await db.commit()
    await db.refresh(admin)

    # Log the action
    db.add(ArchitectLog(
        action="INVITE_ADMIN",
        target=body.username,
        extra={"org_id": univ_id, "organization_name": organization.name, "email": body.email},
    ))
    await db.commit()

    # Send invitation email in background
    background_tasks.add_task(
        send_admin_invitation_email,
        email=body.email,
        callsign=body.username,
        organization_name=organization.name,
        token=raw_token,
    )

    return {
        "id": str(admin.id),
        "username": admin.username,
        "email": admin.email,
        "org_id": univ_id,
        "organization_name": organization.name,
        "account_status": admin.account_status,
        "expires_at": expires_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# POST /architect/organizations/{univ_id}/admins/{admin_id}/send-reset
# Re-sends a password reset email to an existing Admin account.
# ---------------------------------------------------------------------------

_RESET_TOKEN_TTL = timedelta(hours=1)


@router.post("/organizations/{univ_id}/admins/{admin_id}/send-reset", status_code=200)
async def send_admin_reset(
    univ_id: int,
    admin_id: str,
    background_tasks: BackgroundTasks,
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    """Generate a password reset token and email it to an Admin belonging to the organization."""
    from uuid import UUID as _UUID
    try:
        uid = _UUID(admin_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    admin = (await db.execute(
        select(User).where(
            User.id == uid,
            User.role == UserRole.ADMIN,
            User.org_id == univ_id,
        )
    )).scalar_one_or_none()
    if not admin:
        raise HTTPException(status_code=404, detail="Admin not found in this organization")

    raw_token = secrets.token_urlsafe(32)
    admin.password_reset_token = _hash_token(raw_token)
    admin.password_reset_expires = datetime.utcnow() + _RESET_TOKEN_TTL
    admin.password_reset_requested_at = datetime.utcnow()
    await db.commit()

    background_tasks.add_task(send_password_reset_email, admin.email, admin.username, raw_token)

    return {"sent": True, "callsign": admin.username, "email": admin.email}


# ---------------------------------------------------------------------------
# GET /architect/system-status — live health of DB + Redis
# ---------------------------------------------------------------------------

@router.get("/system-status")
async def get_system_status(
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime
    from app.redis_client import redis_client

    db_status = "ONLINE"
    try:
        await db.execute(select(func.now()))
    except Exception:
        db_status = "ERROR"

    redis_status = "ONLINE"
    try:
        await redis_client.ping()
    except Exception:
        redis_status = "ERROR"

    return {
        "api":        "ONLINE",
        "db":         db_status,
        "redis":      redis_status,
        "checked_at": datetime.utcnow().isoformat(),
    }


# ---------------------------------------------------------------------------
# Architect global views — accounts, SMTP info, test email
# ---------------------------------------------------------------------------

@router.get("/accounts")
async def list_architect_accounts(_arch=Depends(require_architect)):
    """Return all configured Architect callsigns (no passwords)."""
    from app.utils.architect import load_architects
    return [{"callsign": a["callsign"]} for a in load_architects()]


@router.get("/smtp-info")
async def get_smtp_info(_arch=Depends(require_architect)):
    """Return current SMTP configuration (password omitted)."""
    from app.config import settings as app_settings
    return {
        "host": app_settings.SMTP_HOST,
        "port": app_settings.SMTP_PORT,
        "from_name": app_settings.SMTP_FROM_NAME,
        "from_email": app_settings.SMTP_FROM_EMAIL,
        "username": app_settings.SMTP_USERNAME,
        "tls": app_settings.SMTP_TLS,
        "ssl": app_settings.SMTP_SSL,
    }


class TestEmailBody(BaseModel):
    to_email: str


@router.post("/test-email")
async def send_test_email_endpoint(
    body: TestEmailBody,
    _arch=Depends(require_architect),
):
    """Send a test email to verify SMTP configuration. Runs synchronously so result is returned."""
    from app.services.email_service import send_test_email
    ok = await send_test_email(body.to_email)
    if not ok:
        raise HTTPException(status_code=500, detail="EMAIL_SEND_FAILED")
    return {"sent": True, "to": body.to_email}


# ---------------------------------------------------------------------------
# GET /architect/library — all contracts across all orgs (no event filter)
# ---------------------------------------------------------------------------

@router.get("/library")
async def get_library(
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
    org_id: Optional[int]  = Query(None),
    status: Optional[str]  = Query(None),   # "published" | "unpublished"
    category: Optional[str] = Query(None),
    search: Optional[str]  = Query(None),
):
    """Return every non-void contract across all organizations with org/event/claim metadata."""
    q = (
        select(Contract)
        .where(Contract.is_void == False)
        .order_by(Contract.created_at.desc())
    )
    if org_id is not None:
        q = q.where(Contract.org_id == org_id)
    if status == "published":
        q = q.where(Contract.is_published == True)
    elif status == "unpublished":
        q = q.where(Contract.is_published == False)
    if category:
        q = q.where(Contract.category == category)
    if search:
        pattern = f"%{search}%"
        from sqlalchemy import or_
        q = q.where(or_(
            Contract.title.ilike(pattern),
            Contract.description.ilike(pattern),
        ))

    contracts = (await db.execute(q)).scalars().all()
    if not contracts:
        return []

    # Batch-fetch orgs
    org_ids = {c.org_id for c in contracts if c.org_id}
    orgs: dict[int, Organization] = {}
    if org_ids:
        rows = (await db.execute(select(Organization).where(Organization.id.in_(org_ids)))).scalars().all()
        orgs = {o.id: o for o in rows}

    # Batch-fetch events
    event_ids = {c.event_id for c in contracts if c.event_id}
    events: dict[int, Event] = {}
    if event_ids:
        rows = (await db.execute(select(Event).where(Event.id.in_(event_ids)))).scalars().all()
        events = {e.id: e for e in rows}

    # Claim counts
    claim_rows = (await db.execute(
        select(Claim.contract_id, func.count(Claim.id)).group_by(Claim.contract_id)
    )).all()
    claim_counts = {str(r[0]): r[1] for r in claim_rows}

    # Intel drop counts
    intel_rows = (await db.execute(
        select(IntelDrop.contract_id, func.count(IntelDrop.id)).group_by(IntelDrop.contract_id)
    )).all()
    intel_counts = {str(r[0]): r[1] for r in intel_rows}

    # Batch-fetch creators
    creator_ids = {c.created_by for c in contracts if c.created_by}
    creators: dict = {}
    if creator_ids:
        rows = (await db.execute(select(User.id, User.username).where(User.id.in_(creator_ids)))).all()
        creators = {str(r[0]): r[1] for r in rows}

    result = []
    for c in contracts:
        org = orgs.get(c.org_id) if c.org_id else None
        evt = events.get(c.event_id) if c.event_id else None
        result.append({
            "id":               str(c.id),
            "title":            c.title,
            "category":         c.category.value if hasattr(c.category, "value") else c.category,
            "rarity":           c.rarity.value if hasattr(c.rarity, "value") else c.rarity,
            "base_bc_value":    c.base_bc_value,
            "is_published":     c.is_published,
            "tags":             c.tags or [],
            "attachments":      len(c.attachments or []),
            "claim_count":      claim_counts.get(str(c.id), 0),
            "intel_count":      intel_counts.get(str(c.id), 0),
            "org_id":           c.org_id,
            "org_name":         org.name if org else None,
            "org_code":         org.org_code if org else None,
            "event_id":         c.event_id,
            "event_name":       evt.name if evt else None,
            "event_status":     evt.status.value if evt and hasattr(evt.status, "value") else (evt.status if evt else None),
            "creator_username": creators.get(str(c.created_by)) if c.created_by else None,
            "first_claimed_at": c.first_claimed_at.isoformat() if c.first_claimed_at else None,
            "created_at":       c.created_at.isoformat() if c.created_at else None,
            "updated_at":       c.updated_at.isoformat() if c.updated_at else None,
        })
    return result


# ---------------------------------------------------------------------------
# Architect platform settings — GET and PATCH
# ---------------------------------------------------------------------------

_ARCH_SETTING_KEYS = {
    # decay
    "decay_mode", "decay_tier_1_hours", "decay_tier_1_percent",
    "decay_tier_2_hours", "decay_tier_2_percent",
    "decay_tier_3_hours", "decay_tier_3_percent", "decay_floor_percent",
    # clearance thresholds
    "cl_ghost", "cl_phantom", "cl_specter", "cl_legend",
    # feature flags
    "void_mode_enabled", "bounty_board_public", "maintenance_mode",
    # platform identity
    "term_operator", "term_team", "term_handler", "term_contractor",
    # org caps
    "max_organizations", "max_events_per_org", "max_operators_per_org",
    # registration gateway
    "platform_registration_locked",
    # file limits
    "max_upload_mb", "allowed_file_types",
}


@router.get("/settings")
async def get_architect_settings(
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    """Return all architect-managed platform settings as a flat key→value dict."""
    rows = (await db.execute(
        select(PlatformSettings).where(PlatformSettings.key.in_(_ARCH_SETTING_KEYS))
    )).scalars().all()
    return {r.key: r.value for r in rows}


class PatchSettingsBody(BaseModel):
    settings: dict = Field(..., description="Flat key→value dict of settings to update")


# ---------------------------------------------------------------------------
# Verification endpoints — global (no org restriction)
# ---------------------------------------------------------------------------

class BulkVerifyBody(BaseModel):
    user_ids: list[UUID]


@router.post("/users/bulk-verify", status_code=200)
async def bulk_verify_global(
    body: BulkVerifyBody,
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    if not body.user_ids:
        raise HTTPException(status_code=400, detail="No users provided")
    result = await db.execute(
        sa_update(User)
        .where(User.id.in_(body.user_ids))
        .values(is_verified=True, verification_token=None, verification_token_expires=None)
    )
    await db.execute(
        sa_update(User)
        .where(User.id.in_(body.user_ids), User.account_status == AccountStatus.PENDING_VERIFICATION.value)
        .values(account_status=AccountStatus.ACTIVE.value)
    )
    await db.commit()
    return {"verified": result.rowcount}


@router.post("/users/{user_id}/verify", status_code=200)
async def verify_user_global(
    user_id: UUID,
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.is_verified = True
    target.verification_token = None
    target.verification_token_expires = None
    if target.account_status == AccountStatus.PENDING_VERIFICATION.value:
        target.account_status = AccountStatus.ACTIVE.value
    await db.commit()
    return {"message": f"{target.username} verified", "is_verified": True}


@router.post("/users/{user_id}/unverify", status_code=200)
async def unverify_user_global(
    user_id: UUID,
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.is_verified = False
    if target.account_status == AccountStatus.ACTIVE.value:
        target.account_status = AccountStatus.PENDING_VERIFICATION.value
    await db.commit()
    return {"message": f"{target.username} unverified", "is_verified": False}


@router.patch("/settings")
async def patch_architect_settings(
    body: PatchSettingsBody,
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    """Batch-update architect-managed platform settings."""
    unknown = set(body.settings.keys()) - _ARCH_SETTING_KEYS
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown settings keys: {sorted(unknown)}")

    existing = {
        r.key: r
        for r in (await db.execute(
            select(PlatformSettings).where(PlatformSettings.key.in_(body.settings.keys()))
        )).scalars().all()
    }

    changed: list[str] = []
    for key, value in body.settings.items():
        str_val = str(value)
        if key in existing:
            if existing[key].value != str_val:
                existing[key].value = str_val
                changed.append(key)
        else:
            db.add(PlatformSettings(key=key, value=str_val))
            changed.append(key)

    if changed:
        db.add(ArchitectLog(
            action="UPDATE_SETTINGS",
            target=", ".join(changed),
            extra={"keys": changed, "performed_by": _arch.username if hasattr(_arch, "username") else "s0L"},
        ))
        await db.commit()

    return {"updated": changed}
