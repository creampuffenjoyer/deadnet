"""
Organizations router — Architect-only.
All endpoints require a valid Architect JWT.
"""
from datetime import datetime
from typing import Optional

import os

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_architect
from app.models.contract import BcEvent, BcEventType, Claim
from app.models.corrupted_contract import CorruptedClaim
from app.models.event import Event, EventStatus
from app.models.team import Team
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.utils.clearance import get_clearance_level
from app.models.settings import PlatformSettings

router = APIRouter()


# ---------------------------------------------------------------------------
# Shared utility — importable by other routers
# ---------------------------------------------------------------------------

async def validate_organization_active(org_id: int, db: AsyncSession) -> Organization:
    """Raise 400 if the organization doesn't exist or is inactive."""
    u = (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=400, detail="INVALID_ORGANIZATION")
    if not u.is_active:
        raise HTTPException(status_code=400, detail="ORGANIZATION_INACTIVE")
    return u


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreateOrganizationBody(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    org_code: Optional[str] = Field(None)
    description: Optional[str] = Field(None, max_length=500)


class UpdateOrganizationBody(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=200)
    org_code: Optional[str] = Field(None)
    description: Optional[str] = Field(None, max_length=500)
    is_active: Optional[bool] = None


# ---------------------------------------------------------------------------
# GET /organizations — list all
# ---------------------------------------------------------------------------

@router.get("")
async def list_organizations(
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Organization).order_by(Organization.created_at))
    organizations = result.scalars().all()

    if not organizations:
        return []

    univ_ids = [u.id for u in organizations]

    # User counts per organization (all roles)
    user_count_res = await db.execute(
        select(User.org_id, func.count(User.id))
        .where(User.org_id.in_(univ_ids))
        .group_by(User.org_id)
    )
    user_counts = {r[0]: r[1] for r in user_count_res.all()}

    # Event counts per organization (all statuses)
    event_count_res = await db.execute(
        select(Event.org_id, func.count(Event.id))
        .where(Event.org_id.in_(univ_ids))
        .group_by(Event.org_id)
    )
    event_counts = {r[0]: r[1] for r in event_count_res.all()}

    # Active event name per organization (None if no active event)
    active_event_res = await db.execute(
        select(Event.org_id, Event.name)
        .where(
            Event.org_id.in_(univ_ids),
            Event.status == EventStatus.ACTIVE.value,
        )
    )
    active_event_names = {r[0]: r[1] for r in active_event_res.all()}

    # Team counts per organization
    team_count_res = await db.execute(
        select(Team.org_id, func.count(Team.id))
        .where(Team.org_id.in_(univ_ids))
        .group_by(Team.org_id)
    )
    team_counts = {r[0]: r[1] for r in team_count_res.all()}

    # First admin callsign per organization
    admin_res = await db.execute(
        select(User.org_id, User.username)
        .where(
            User.org_id.in_(univ_ids),
            User.role == UserRole.ADMIN,
            User.is_banned == False,
        )
        .order_by(User.org_id, User.username)
    )
    admin_map: dict = {}
    for org_id, username in admin_res.all():
        if org_id not in admin_map:
            admin_map[org_id] = username

    return [
        {
            "id": u.id,
            "name": u.name,
            "org_code": u.org_code,
            "description": u.description,
            "is_active": u.is_active,
            "logo_url": u.logo_url,
            "created_by": u.created_by,
            "created_at": u.created_at,
            "updated_at": u.updated_at,
            "user_count": user_counts.get(u.id, 0),
            "event_count": event_counts.get(u.id, 0),
            "team_count": team_counts.get(u.id, 0),
            "active_event_name": active_event_names.get(u.id),
            "admin_callsign": admin_map.get(u.id),
        }
        for u in organizations
    ]


# ---------------------------------------------------------------------------
# POST /organizations — create
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def create_organization(
    body: CreateOrganizationBody,
    arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    # Enforce max_organizations cap (0 = unlimited)
    cap_row = (await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "max_organizations")
    )).scalar_one_or_none()
    cap = int((cap_row.value if cap_row else None) or "0")
    if cap > 0:
        current_count = (await db.execute(select(func.count(Organization.id)))).scalar() or 0
        if current_count >= cap:
            raise HTTPException(status_code=409, detail=f"Organization cap reached ({cap})")

    # Check for duplicate name
    existing = (await db.execute(
        select(Organization).where(Organization.name == body.name)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Organization name already exists")

    u = Organization(
        name=body.name,
        org_code=body.org_code,
        description=body.description,
        is_active=True,
        created_by=arch.username,
        created_at=datetime.utcnow(),
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return {
        "id": u.id,
        "name": u.name,
        "org_code": u.org_code,
        "description": u.description,
        "is_active": u.is_active,
        "logo_url": u.logo_url,
        "created_by": u.created_by,
        "created_at": u.created_at,
    }


# ---------------------------------------------------------------------------
# PATCH /organizations/{id} — update
# ---------------------------------------------------------------------------

@router.patch("/{univ_id}")
async def update_organization(
    univ_id: int,
    body: UpdateOrganizationBody,
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    u = (await db.execute(select(Organization).where(Organization.id == univ_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="Organization not found")

    if body.name is not None:
        # Ensure new name is unique (excluding self)
        clash = (await db.execute(
            select(Organization).where(Organization.name == body.name, Organization.id != univ_id)
        )).scalar_one_or_none()
        if clash:
            raise HTTPException(status_code=409, detail="Organization name already taken")
        u.name = body.name

    if body.org_code is not None:
        u.org_code = body.org_code
    if body.description is not None:
        u.description = body.description
    if body.is_active is not None:
        u.is_active = body.is_active

    u.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(u)
    return {
        "id": u.id,
        "name": u.name,
        "org_code": u.org_code,
        "description": u.description,
        "is_active": u.is_active,
        "logo_url": u.logo_url,
        "updated_at": u.updated_at,
    }


# ---------------------------------------------------------------------------
# GET /organizations/{id}/logo — serve logo image (public, no auth)
# Filename is read from the DB — not taken from the URL — so no traversal risk.
# ---------------------------------------------------------------------------

@router.get("/{univ_id}/logo")
async def get_organization_logo(
    univ_id: int,
    db: AsyncSession = Depends(get_db),
):
    u = (await db.execute(select(Organization).where(Organization.id == univ_id))).scalar_one_or_none()
    if not u or not u.logo_url:
        raise HTTPException(status_code=404, detail="No logo")

    file_path = os.path.join(_UPLOAD_DIR, u.logo_url)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path)


# ---------------------------------------------------------------------------
# POST /organizations/{id}/logo — upload / replace organization logo
# ---------------------------------------------------------------------------

_UPLOAD_DIR = "/app/uploads"
_ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}
_MAX_LOGO_BYTES = 5 * 1024 * 1024  # 5 MB


@router.post("/{univ_id}/logo")
async def upload_organization_logo(
    univ_id: int,
    file: UploadFile = File(...),
    arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    u = (await db.execute(select(Organization).where(Organization.id == univ_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Validate extension
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail="Only image files are allowed (jpg, png, webp, gif, svg)")

    content = await file.read()
    if len(content) > _MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="Logo too large — max 5 MB")

    os.makedirs(_UPLOAD_DIR, exist_ok=True)

    # Remove old logo file if it was stored under a different extension
    if u.logo_url:
        old_path = os.path.join(_UPLOAD_DIR, u.logo_url)
        if os.path.isfile(old_path):
            try:
                os.remove(old_path)
            except OSError:
                pass

    filename = f"org_logo_{univ_id}{ext}"
    with open(os.path.join(_UPLOAD_DIR, filename), "wb") as fh:
        fh.write(content)

    u.logo_url = filename
    u.updated_at = datetime.utcnow()
    await db.commit()
    return {"logo_url": filename, "updated_at": u.updated_at.isoformat()}


# ---------------------------------------------------------------------------
# DELETE /organizations/{id} — permanent hard delete
# All FK children use ondelete="SET NULL" or "CASCADE" so the DB handles cleanup.
# Only Architect can do this. Confirmation is enforced on the frontend.
# ---------------------------------------------------------------------------

@router.delete("/{univ_id}", status_code=200)
async def delete_organization(
    univ_id: int,
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    u = (await db.execute(select(Organization).where(Organization.id == univ_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="Organization not found")

    org_name = u.name
    await db.delete(u)
    await db.commit()
    return {"id": univ_id, "deleted": True, "name": org_name}


# ---------------------------------------------------------------------------
# GET /organizations/{id}/stats — per-organization stats
# ---------------------------------------------------------------------------

@router.get("/{univ_id}/stats")
async def get_organization_stats(
    univ_id: int,
    _arch=Depends(require_architect),
    db: AsyncSession = Depends(get_db),
):
    u = (await db.execute(select(Organization).where(Organization.id == univ_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="Organization not found")

    # User breakdown
    user_rows = (await db.execute(
        select(User.role, func.count(User.id))
        .where(User.org_id == univ_id)
        .group_by(User.role)
    )).all()
    user_by_role = {str(r[0].value): r[1] for r in user_rows}
    total_users = sum(user_by_role.values())

    # Event counts
    event_count = (await db.execute(
        select(func.count(Event.id)).where(Event.org_id == univ_id)
    )).scalar() or 0

    # Active event
    active_event = (await db.execute(
        select(Event)
        .where(Event.org_id == univ_id, Event.status == EventStatus.ACTIVE.value)
        .limit(1)
    )).scalar_one_or_none()

    # Total BC distributed (all claims for this organization's contracts)
    total_bc = (await db.execute(
        select(func.sum(Claim.bc_earned))
        .join(User, User.id == Claim.operative_id)
        .where(User.org_id == univ_id)
    )).scalar() or 0

    # Corrupted contract BC
    cc_bc = (await db.execute(
        select(func.sum(CorruptedClaim.bc_awarded))
        .join(User, User.id == CorruptedClaim.operative_id)
        .where(User.org_id == univ_id)
    )).scalar() or 0

    # Team count
    team_count = (await db.execute(
        select(func.count(Team.id)).where(Team.org_id == univ_id)
    )).scalar() or 0

    # Top 5 performers by bc_total
    cl_settings_rows = (await db.execute(
        select(PlatformSettings).where(PlatformSettings.key.like("cl_%"))
    )).scalars().all()
    cl_settings = {row.key: row.value for row in cl_settings_rows}

    top_runners = (await db.execute(
        select(User)
        .where(
            User.org_id == univ_id,
            User.role == UserRole.OPERATIVE,
            User.is_banned == False,
        )
        .order_by((User.bc_total + User.void_bc).desc())
        .limit(5)
    )).scalars().all()

    top_performers = [
        {
            "username": u.username,
            "bc_total": (u.bc_total or 0) + (u.void_bc or 0),
            "clearance_level": get_clearance_level((u.bc_total or 0) + (u.void_bc or 0), cl_settings),
        }
        for u in top_runners
    ]

    return {
        "organization": {
            "id": u.id,
            "name": u.name,
            "org_code": u.org_code,
            "is_active": u.is_active,
        },
        "users": {
            "total": total_users,
            "by_role": user_by_role,
        },
        "events": {
            "total": event_count,
            "active": {
                "id": active_event.id,
                "name": active_event.name,
                "ends_at": active_event.end_time.isoformat() if active_event and active_event.end_time else None,
            } if active_event else None,
        },
        "bc_distributed": int(total_bc) + int(cc_bc),
        "teams": team_count,
        "top_performers": top_performers,
    }
