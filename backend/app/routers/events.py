"""Event management router — /events prefix."""
import json
import secrets
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_admin, require_authenticated
from app.models.audit import ArchitectLog
from app.models.contract import BcEvent, Claim, Contract
from app.models.event import Event, EventStatus, ResetLevel
from app.models.event_registration import EventRegistration, EventRemoval
from app.models.major_event import MajorEventContractor, MajorEventPartner
from app.models.notification import Notification
from app.models.organization import Organization
from app.models.settings import PlatformSettings
from app.models.team import Team, TeamMembership
from app.models.transmission import NetworkTransmission
from app.models.user import User, UserRole
from app.redis_client import (
    check_key_attempt_rate_limit, get_key_attempt_ttl,
    check_key_regen_rate_limit, get_key_regen_count,
    set_halt_started, get_halt_started, clear_halt_started, add_paused_seconds,
    check_major_invite_rate_limit, get_major_invite_ttl,
)
from app.utils.event import get_current_event_id
from app.utils.roles import get_organization_scope

router = APIRouter()


# ── helpers ──────────────────────────────────────────────────────────────────

async def _get_setting(db: AsyncSession, key: str) -> Optional[str]:
    r = await db.execute(select(PlatformSettings.value).where(PlatformSettings.key == key))
    return r.scalar_one_or_none()


async def _set_setting(db: AsyncSession, key: str, value: str) -> None:
    r = await db.execute(select(PlatformSettings).where(PlatformSettings.key == key))
    row = r.scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(PlatformSettings(key=key, value=value))


async def _event_stats(db: AsyncSession, event_id: int) -> dict:
    contracts = (await db.execute(
        select(func.count(Contract.id)).where(Contract.event_id == event_id)
    )).scalar() or 0
    claims = (await db.execute(
        select(func.count(Claim.id)).where(Claim.event_id == event_id)
    )).scalar() or 0
    teams = (await db.execute(
        select(func.count(Team.id)).where(Team.event_id == event_id)
    )).scalar() or 0
    # top player by bc_total
    top = (await db.execute(
        select(User.username)
        .join(Claim, Claim.operative_id == User.id)
        .where(Claim.event_id == event_id)
        .group_by(User.id, User.username)
        .order_by(func.sum(Claim.bc_earned).desc())
        .limit(1)
    )).scalar_one_or_none()
    return {
        "contract_count": contracts,
        "claim_count": claims,
        "team_count": teams,
        "top_player": top,
    }


def _event_out(e: Event, stats: Optional[dict] = None, include_key: bool = False) -> dict:
    d = {
        "id": e.id,
        "name": e.name,
        "status": e.status,
        "registration_open": e.registration_open,
        "description": e.description,
        "start_time": e.start_time.isoformat() if e.start_time else None,
        "end_time": e.end_time.isoformat() if e.end_time else None,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "closed_at": e.closed_at.isoformat() if e.closed_at else None,
        "archived_at": e.archived_at.isoformat() if e.archived_at else None,
        "reset_level": e.reset_level,
        "export_generated": e.export_generated,
        "participant_count": e.participant_count,
        "email_domain_restriction": e.email_domain_restriction,
        "key_regenerated_at": e.key_regenerated_at.isoformat() if e.key_regenerated_at else None,
        "decay_mode_override": e.decay_mode_override,
        "decay_tier_1_hours_override": float(e.decay_tier_1_hours_override) if e.decay_tier_1_hours_override is not None else None,
        "decay_tier_1_percent_override": e.decay_tier_1_percent_override,
        "decay_tier_2_hours_override": float(e.decay_tier_2_hours_override) if e.decay_tier_2_hours_override is not None else None,
        "decay_tier_2_percent_override": e.decay_tier_2_percent_override,
        "decay_tier_3_hours_override": float(e.decay_tier_3_hours_override) if e.decay_tier_3_hours_override is not None else None,
        "decay_tier_3_percent_override": e.decay_tier_3_percent_override,
        "decay_floor_percent_override": e.decay_floor_percent_override,
        # Session 18 — Major Event fields
        "event_type": e.event_type or "LOCAL",
        "is_host": e.is_host or False,
        "host_org_id": e.host_org_id,
        "major_event_invite_code": e.major_event_invite_code,
        "invite_code_regenerated_at": e.invite_code_regenerated_at.isoformat() if e.invite_code_regenerated_at else None,
        # Allowed categories (None = all allowed)
        "allowed_categories": e.allowed_categories or None,
    }
    if include_key:
        d["registration_key"] = e.registration_key
    if stats:
        d.update(stats)
    return d


async def _broadcast(db: AsyncSession, lines: list[str]) -> None:
    db.add(NetworkTransmission(content="\n".join(lines), author_id=None))


def _generate_reg_key() -> str:
    """Generate a XXXX-XXXX-XXXX registration key using unambiguous chars."""
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "-".join(
        "".join(secrets.choice(chars) for _ in range(4))
        for _ in range(3)
    )


# ── GET /events ───────────────────────────────────────────────────────────────

@router.get("")
async def list_events(
    org_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role.value not in ('ADMIN', 'CONTRACTOR', 'HANDLER', 'ARCHITECT'):
        raise HTTPException(status_code=403, detail="Forbidden")
    scope = get_organization_scope(current_user, org_id)
    q = select(Event).order_by(Event.created_at.desc())
    if scope is not None:
        q = q.where(Event.org_id == scope)
    result = await db.execute(q)
    own_events = result.scalars().all()

    out = []
    own_event_ids = {e.id for e in own_events}
    for e in own_events:
        s = await _event_stats(db, e.id)
        entry = _event_out(e, s, include_key=True)
        entry["participating_as"] = "HOST"
        out.append(entry)

    # For org-scoped Admins: also include MAJOR events where their org is an active partner
    if scope is not None and current_user.role.value == "ADMIN":
        partner_ids = (await db.execute(
            select(MajorEventPartner.event_id).where(
                MajorEventPartner.org_id == scope,
                MajorEventPartner.status == "ACTIVE",
            )
        )).scalars().all()
        partner_only_ids = [eid for eid in partner_ids if eid not in own_event_ids]
        if partner_only_ids:
            extra = (await db.execute(
                select(Event).where(Event.id.in_(partner_only_ids))
            )).scalars().all()
            for e in extra:
                s = await _event_stats(db, e.id)
                entry = _event_out(e, s, include_key=False)
                entry["participating_as"] = "PARTNER"
                # Attach host org info for display
                if e.host_org_id:
                    host_org = (await db.execute(
                        select(Organization).where(Organization.id == e.host_org_id)
                    )).scalar_one_or_none()
                    if host_org:
                        entry["host_org_name"] = host_org.name
                        entry["host_org_code"] = host_org.org_code
                # Attach partner's own registration key
                partner_row = (await db.execute(
                    select(MajorEventPartner).where(
                        MajorEventPartner.event_id == e.id,
                        MajorEventPartner.org_id == scope,
                    )
                )).scalar_one_or_none()
                if partner_row:
                    entry["registration_key"] = partner_row.registration_key
                out.append(entry)

    return out


# ── GET /events/active ────────────────────────────────────────────────────────

@router.get("/active")
async def get_active_event(
    org_id: Optional[int] = None,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    scope = get_organization_scope(current_user, org_id)
    active_q = select(Event).where(Event.status == EventStatus.ACTIVE.value).order_by(Event.id.desc()).limit(1)
    upcoming_q = select(Event).where(Event.status == EventStatus.UPCOMING.value).order_by(Event.id.desc()).limit(1)
    if scope is not None:
        active_q = active_q.where(Event.org_id == scope)
        upcoming_q = upcoming_q.where(Event.org_id == scope)
    result = await db.execute(active_q)
    e = result.scalar_one_or_none()

    # If no result and caller belongs to an org, check if they're a partner in an active MAJOR event
    if not e and scope is not None:
        partner_event_ids = (await db.execute(
            select(MajorEventPartner.event_id).where(
                MajorEventPartner.org_id == scope,
                MajorEventPartner.status == "ACTIVE",
            )
        )).scalars().all()
        if partner_event_ids:
            partner_active = (await db.execute(
                select(Event).where(
                    Event.id.in_(partner_event_ids),
                    Event.status == EventStatus.ACTIVE.value,
                ).order_by(Event.id.desc()).limit(1)
            )).scalar_one_or_none()
            if partner_active:
                # Enrich with host org info
                out = _event_out(partner_active)
                if partner_active.host_org_id:
                    host_org = (await db.execute(
                        select(Organization).where(Organization.id == partner_active.host_org_id)
                    )).scalar_one_or_none()
                    if host_org:
                        out["host_org_name"] = host_org.name
                        out["host_org_code"] = host_org.org_code
                out["participating_as"] = "PARTNER"
                return {"active": out, "upcoming": None}

    if not e:
        # Also return upcoming events so frontend can show countdown
        upcoming = (await db.execute(upcoming_q)).scalar_one_or_none()
        # Check partner upcoming if still no result
        if not upcoming and scope is not None:
            partner_event_ids = (await db.execute(
                select(MajorEventPartner.event_id).where(
                    MajorEventPartner.org_id == scope,
                    MajorEventPartner.status == "ACTIVE",
                )
            )).scalars().all()
            if partner_event_ids:
                upcoming = (await db.execute(
                    select(Event).where(
                        Event.id.in_(partner_event_ids),
                        Event.status == EventStatus.UPCOMING.value,
                    ).order_by(Event.id.desc()).limit(1)
                )).scalar_one_or_none()
                if upcoming:
                    out = _event_out(upcoming)
                    if upcoming.host_org_id:
                        host_org = (await db.execute(
                            select(Organization).where(Organization.id == upcoming.host_org_id)
                        )).scalar_one_or_none()
                        if host_org:
                            out["host_org_name"] = host_org.name
                            out["host_org_code"] = host_org.org_code
                    out["participating_as"] = "PARTNER"
                    return {"active": None, "upcoming": out}
        return {"active": None, "upcoming": _event_out(upcoming) if upcoming else None}

    out = _event_out(e)
    # For HOST of a MAJOR event, also attach host_org_name
    if (e.event_type or "LOCAL") == "MAJOR" and e.host_org_id:
        host_org = (await db.execute(
            select(Organization).where(Organization.id == e.host_org_id)
        )).scalar_one_or_none()
        if host_org:
            out["host_org_name"] = host_org.name
            out["host_org_code"] = host_org.org_code
    return {"active": out, "upcoming": None}


# ── GET /events/{id} ──────────────────────────────────────────────────────────

@router.get("/{event_id}")
async def get_event(
    event_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    e = result.scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    s = await _event_stats(db, event_id)
    return _event_out(e, s, include_key=True)


# ── POST /events ──────────────────────────────────────────────────────────────

class CreateEventRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=100)
    description: Optional[str] = Field(None, max_length=300)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    registration_open: bool = True
    allowed_categories: Optional[list[str]] = None  # None = all categories allowed
    # Per-event decay overrides (None = use platform default)
    decay_mode_override: Optional[str] = None
    decay_tier_1_hours_override: Optional[float] = None
    decay_tier_1_percent_override: Optional[int] = None
    decay_tier_2_hours_override: Optional[float] = None
    decay_tier_2_percent_override: Optional[int] = None
    decay_tier_3_hours_override: Optional[float] = None
    decay_tier_3_percent_override: Optional[int] = None
    decay_floor_percent_override: Optional[int] = None


@router.post("", status_code=201)
async def create_event(
    body: CreateEventRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Enforce max_events_per_org cap (0 = unlimited)
    org_id = getattr(current_user, "org_id", None)
    if org_id:
        cap_row = (await db.execute(
            select(PlatformSettings).where(PlatformSettings.key == "max_events_per_org")
        )).scalar_one_or_none()
        cap = int((cap_row.value if cap_row else None) or "0")
        if cap > 0:
            event_count = (await db.execute(
                select(func.count(Event.id)).where(Event.org_id == org_id)
            )).scalar() or 0
            if event_count >= cap:
                raise HTTPException(status_code=409, detail=f"Event cap reached for this organization ({cap})")

    # Cannot create if one is currently ACTIVE
    active = (await db.execute(
        select(Event).where(Event.status == EventStatus.ACTIVE.value).limit(1)
    )).scalar_one_or_none()
    if active:
        raise HTTPException(status_code=409, detail="Cannot create event while one is ACTIVE")

    now = datetime.utcnow()
    if body.start_time and body.start_time <= now:
        raise HTTPException(status_code=400, detail="start_time must be in the future")
    if body.start_time and body.end_time and body.end_time <= body.start_time:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    e = Event(
        name=body.name,
        description=body.description,
        status=EventStatus.UPCOMING.value,
        registration_open=body.registration_open,
        start_time=body.start_time,
        end_time=body.end_time,
        created_by=current_user.id,
        created_at=now,
        registration_key=_generate_reg_key(),
        org_id=getattr(current_user, "org_id", None),
        allowed_categories=body.allowed_categories or None,
        decay_mode_override=body.decay_mode_override,
        decay_tier_1_hours_override=body.decay_tier_1_hours_override,
        decay_tier_1_percent_override=body.decay_tier_1_percent_override,
        decay_tier_2_hours_override=body.decay_tier_2_hours_override,
        decay_tier_2_percent_override=body.decay_tier_2_percent_override,
        decay_tier_3_hours_override=body.decay_tier_3_hours_override,
        decay_tier_3_percent_override=body.decay_tier_3_percent_override,
        decay_floor_percent_override=body.decay_floor_percent_override,
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return _event_out(e, include_key=True)


# ── PATCH /events/{id} ────────────────────────────────────────────────────────

class UpdateEventRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=3, max_length=100)
    description: Optional[str] = Field(None, max_length=300)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    registration_open: Optional[bool] = None
    allowed_categories: Optional[list[str]] = None  # empty list = clear restriction (all allowed)
    clear_allowed_categories: bool = False            # True = remove restriction entirely
    # Decay override — send decay_mode_override to set; clear_decay_overrides=True to remove all
    clear_decay_overrides: bool = False
    decay_mode_override: Optional[str] = None
    decay_tier_1_hours_override: Optional[float] = None
    decay_tier_1_percent_override: Optional[int] = None
    decay_tier_2_hours_override: Optional[float] = None
    decay_tier_2_percent_override: Optional[int] = None
    decay_tier_3_hours_override: Optional[float] = None
    decay_tier_3_percent_override: Optional[int] = None
    decay_floor_percent_override: Optional[int] = None


@router.patch("/{event_id}")
async def update_event(
    event_id: int,
    body: UpdateEventRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    e = result.scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e.status == EventStatus.CLOSED.value:
        raise HTTPException(status_code=400, detail="Cannot update a CLOSED event")

    if body.name is not None:
        e.name = body.name
    if body.description is not None:
        e.description = body.description
    if body.start_time is not None:
        e.start_time = body.start_time
    if body.end_time is not None:
        e.end_time = body.end_time
    if body.registration_open is not None:
        e.registration_open = body.registration_open

    # Allowed categories
    if body.clear_allowed_categories:
        e.allowed_categories = None
    elif body.allowed_categories is not None:
        e.allowed_categories = body.allowed_categories if body.allowed_categories else None

    # Decay overrides
    if body.clear_decay_overrides:
        e.decay_mode_override = None
        e.decay_tier_1_hours_override = None
        e.decay_tier_1_percent_override = None
        e.decay_tier_2_hours_override = None
        e.decay_tier_2_percent_override = None
        e.decay_tier_3_hours_override = None
        e.decay_tier_3_percent_override = None
        e.decay_floor_percent_override = None
    elif body.decay_mode_override is not None:
        e.decay_mode_override = body.decay_mode_override
        e.decay_tier_1_hours_override = body.decay_tier_1_hours_override
        e.decay_tier_1_percent_override = body.decay_tier_1_percent_override
        e.decay_tier_2_hours_override = body.decay_tier_2_hours_override
        e.decay_tier_2_percent_override = body.decay_tier_2_percent_override
        e.decay_tier_3_hours_override = body.decay_tier_3_hours_override
        e.decay_tier_3_percent_override = body.decay_tier_3_percent_override
        e.decay_floor_percent_override = body.decay_floor_percent_override

    await db.commit()
    return _event_out(e)


# ── POST /events/{id}/start ───────────────────────────────────────────────────

@router.post("/{event_id}/start")
async def start_event(
    event_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    e = result.scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e.status == EventStatus.CLOSED.value:
        raise HTTPException(status_code=400, detail="Cannot start a CLOSED event")
    if e.status == EventStatus.ACTIVE.value:
        raise HTTPException(status_code=400, detail="Event is already ACTIVE")

    # No other event can be active
    other = (await db.execute(
        select(Event).where(Event.status == EventStatus.ACTIVE.value, Event.id != event_id).limit(1)
    )).scalar_one_or_none()
    if other:
        raise HTTPException(status_code=409, detail="Another event is already ACTIVE")

    now = datetime.utcnow()
    e.status = EventStatus.ACTIVE.value
    if not e.start_time:
        e.start_time = now

    await _set_setting(db, "competition_active", "true")
    await _set_setting(db, "board_frozen", "false")
    await _broadcast(db, [
        f"> {e.name.upper()} — COMPETITION ACTIVE",
        "> DEADNET IS NOW LIVE",
        "> GOOD LUCK, OPERATIVES",
    ])
    await db.commit()
    return _event_out(e)


# ── POST /events/{id}/halt ────────────────────────────────────────────────────

@router.post("/{event_id}/halt")
async def halt_event(
    event_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    e = result.scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e.status != EventStatus.ACTIVE.value:
        raise HTTPException(status_code=400, detail="Event is not ACTIVE")

    await _set_setting(db, "competition_active", "false")
    await _set_setting(db, "board_frozen", "true")
    await _set_setting(db, "competition_halted_by", current_user.username or "SYSTEM")
    await set_halt_started(event_id)
    await _broadcast(db, [
        f"> {e.name.upper()} — OPERATIONS HALTED",
        "> COMPETITION TEMPORARILY SUSPENDED",
    ])
    await db.commit()
    return {"ok": True, "event": _event_out(e)}


# ── POST /events/{id}/resume ──────────────────────────────────────────────────

@router.post("/{event_id}/resume")
async def resume_event(
    event_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    e = result.scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e.status != EventStatus.ACTIVE.value:
        raise HTTPException(status_code=400, detail="Event is not ACTIVE")

    import time as _time
    halt_at = await get_halt_started(event_id)
    if halt_at is not None:
        await add_paused_seconds(event_id, _time.time() - halt_at)
        await clear_halt_started(event_id)

    await _set_setting(db, "competition_active", "true")
    await _set_setting(db, "board_frozen", "false")
    await _set_setting(db, "competition_halted_by", "")
    await _broadcast(db, [
        f"> {e.name.upper()} — OPERATIONS RESUMED",
        "> COMPETITION IS BACK ONLINE",
    ])
    await db.commit()
    return {"ok": True, "event": _event_out(e)}


# ── POST /events/{id}/close ───────────────────────────────────────────────────

@router.post("/{event_id}/close")
async def close_event(
    event_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    e = result.scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e.status == EventStatus.CLOSED.value:
        raise HTTPException(status_code=400, detail="Event is already CLOSED")

    now = datetime.utcnow()
    e.status = EventStatus.CLOSED.value
    e.closed_at = now
    if not e.end_time:
        e.end_time = now

    await _set_setting(db, "board_frozen", "true")
    await _broadcast(db, [
        f"> {e.name.upper()} — COMPETITION CLOSED",
        "> FINAL STANDINGS NOW LOCKED",
    ])
    await db.commit()
    return _event_out(e)


# ── POST /events/{id}/archive ─────────────────────────────────────────────────

class ArchiveEventRequest(BaseModel):
    reset_level: str = Field(..., pattern="^(SOFT|MEDIUM|HARD)$")
    export_first: bool = False


@router.post("/{event_id}/archive")
async def archive_event(
    event_id: int,
    body: ArchiveEventRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    e = result.scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e.status != EventStatus.CLOSED.value:
        raise HTTPException(status_code=400, detail="Event must be CLOSED before archiving")

    now = datetime.utcnow()

    # ── SOFT: keep contracts published, reset BC ──
    if body.reset_level == "SOFT":
        await db.execute(text(
            "UPDATE contracts SET first_claimed_at = NULL WHERE event_id = :eid AND is_void = false"
        ), {"eid": event_id})
        await db.execute(text("UPDATE users SET bc_total = 0 WHERE role = 'OPERATIVE'"))

    # ── MEDIUM: unpublish contracts, reset BC ──
    elif body.reset_level == "MEDIUM":
        await db.execute(text(
            "UPDATE contracts SET is_published = false, first_claimed_at = NULL WHERE event_id = :eid AND is_void = false"
        ), {"eid": event_id})
        await db.execute(text("UPDATE users SET bc_total = 0 WHERE role = 'OPERATIVE'"))

    # ── HARD: delete contracts, full wipe ──
    elif body.reset_level == "HARD":
        await db.execute(text(
            "DELETE FROM contracts WHERE event_id = :eid AND is_void = false"
        ), {"eid": event_id})
        await db.execute(text(
            "UPDATE users SET bc_total = 0, void_bc = 0, onboarding_complete = false WHERE role = 'OPERATIVE'"
        ))
        await db.execute(text("UPDATE teams SET void_bc = 0"))

    # Dissolve teams for this event — notify members first
    teams_res = await db.execute(
        select(Team.id, Team.name).where(Team.event_id == event_id)
    )
    teams_to_dissolve = teams_res.all()  # list of (id, name)
    team_ids = [r[0] for r in teams_to_dissolve]
    if team_ids:
        # Collect all member IDs with their team name
        members_res = await db.execute(
            select(TeamMembership.operative_id, TeamMembership.team_id)
            .where(TeamMembership.team_id.in_(team_ids))
        )
        syn_name_map = {r[0]: r[1] for r in teams_to_dissolve}
        for member_id, syn_id in members_res.all():
            syn_name = syn_name_map.get(syn_id, "your team")
            db.add(Notification(
                user_id=member_id,
                message=f"Team {syn_name} has been dissolved. The event has concluded.",
            ))
        await db.execute(text(
            "DELETE FROM team_memberships WHERE team_id = ANY(:ids)"
        ), {"ids": team_ids})
        await db.execute(text(
            "DELETE FROM teams WHERE id = ANY(:ids)"
        ), {"ids": team_ids})

    # Mark event as archived
    e.archived_at = now
    e.reset_level = body.reset_level
    if body.export_first:
        e.export_generated = True

    await db.commit()
    return {
        "ok": True,
        "event": _event_out(e),
        "reset_level": body.reset_level,
    }


# ── DELETE /events/{id} — permanently delete a CLOSED event ──────────────────

@router.delete("/{event_id}", status_code=200)
async def delete_event(
    event_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    e = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e.status not in (EventStatus.CLOSED.value, "ARCHIVED"):
        raise HTTPException(status_code=400, detail="Only CLOSED or ARCHIVED events can be deleted")
    await db.delete(e)
    await db.commit()
    return {"deleted": True, "event_name": e.name}


# ── POST /events/{id}/regenerate-key ─────────────────────────────────────────

@router.post("/{event_id}/regenerate-key")
async def regenerate_event_key(
    event_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    e = result.scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e.status == EventStatus.CLOSED.value:
        raise HTTPException(status_code=400, detail="Cannot regenerate key for a CLOSED event")

    allowed = await check_key_regen_rate_limit(event_id)
    if not allowed:
        raise HTTPException(status_code=429, detail="KEY_REGEN_LIMIT_REACHED")

    e.registration_key = _generate_reg_key()
    e.key_regenerated_at = datetime.utcnow()
    await db.commit()
    regen_count = await get_key_regen_count(event_id)
    return {
        "registration_key": e.registration_key,
        "key_regenerated_at": e.key_regenerated_at.isoformat(),
        "regen_count": regen_count,
    }


# ── POST /events/{id}/validate-key ───────────────────────────────────────────

class ValidateKeyRequest(BaseModel):
    key: str


@router.post("/{event_id}/validate-key")
async def validate_event_key(
    event_id: int,
    body: ValidateKeyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Operative submits registration key to self-register for an event."""
    if current_user.role.value not in ("OPERATIVE",):
        raise HTTPException(status_code=403, detail="Only Operatives can register with a key")

    # Rate limit check
    user_id_str = str(current_user.id)
    allowed = await check_key_attempt_rate_limit(user_id_str, event_id)
    if not allowed:
        ttl = await get_key_attempt_ttl(user_id_str, event_id)
        raise HTTPException(
            status_code=429,
            detail=f"TOO_MANY_ATTEMPTS|{ttl}",
        )

    result = await db.execute(select(Event).where(Event.id == event_id))
    e = result.scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if e.status != EventStatus.ACTIVE.value:
        raise HTTPException(status_code=403, detail="EVENT_NOT_ACTIVE")

    # Key comparison — MAJOR events support per-org partner keys
    submitted = body.key.upper().replace(" ", "")
    if (e.event_type or "LOCAL") == "MAJOR":
        operative_org_id = getattr(current_user, "org_id", None)
        if not operative_org_id:
            raise HTTPException(status_code=403, detail="NO_ORG — must belong to a participating org")
        # Try host key (valid only if Operative belongs to host org or event's org)
        host_match = (
            e.registration_key and submitted == e.registration_key.upper()
            and operative_org_id in (e.host_org_id, e.org_id)
        )
        # Try partner org keys
        if not host_match:
            partner = (await db.execute(
                select(MajorEventPartner).where(
                    MajorEventPartner.event_id == event_id,
                    MajorEventPartner.org_id == operative_org_id,
                    MajorEventPartner.status == "ACTIVE",
                )
            )).scalar_one_or_none()
            partner_match = (
                partner is not None
                and partner.registration_key is not None
                and submitted == partner.registration_key.upper()
            )
            if not partner_match:
                raise HTTPException(status_code=403, detail="INVALID_KEY")
    else:
        if not e.registration_key or submitted != e.registration_key.upper():
            raise HTTPException(status_code=403, detail="INVALID_KEY")

    # Domain restriction check
    if e.email_domain_restriction:
        domain = e.email_domain_restriction.lstrip("@")
        if not current_user.email.lower().endswith("@" + domain.lower()):
            raise HTTPException(status_code=403, detail="EMAIL_DOMAIN_RESTRICTED")

    # Check if already registered (active or removed)
    existing = (await db.execute(
        select(EventRegistration).where(
            EventRegistration.event_id == event_id,
            EventRegistration.user_id == current_user.id,
        )
    )).scalar_one_or_none()

    if existing:
        if existing.status == "REMOVED":
            raise HTTPException(status_code=403, detail="REGISTRATION_REVOKED")
        raise HTTPException(status_code=400, detail="ALREADY_REGISTERED")

    # Register
    reg = EventRegistration(
        event_id=event_id,
        user_id=current_user.id,
        registered_by="SELF",
        status="ACTIVE",
    )
    db.add(reg)
    e.participant_count = (e.participant_count or 0) + 1
    db.add(Notification(
        user_id=current_user.id,
        message=f"You have been registered for {e.name}. Good luck, {current_user.username}.",
    ))
    await db.commit()
    return {"registered": True, "event_name": e.name}


# ── GET /events/{id}/registration/me ─────────────────────────────────────────

@router.get("/{event_id}/registration/me")
async def get_my_registration(
    event_id: int,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    # For MAJOR events: caller's org must be an active partner
    event = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
    if event and (event.event_type or "LOCAL") == "MAJOR":
        await _assert_active_partner(db, event_id, current_user)

    reg = (await db.execute(
        select(EventRegistration).where(
            EventRegistration.event_id == event_id,
            EventRegistration.user_id == current_user.id,
        )
    )).scalar_one_or_none()

    if not reg:
        return {"registered": False, "status": None, "registered_at": None, "registered_by": None}
    return {
        "registered": reg.status == "ACTIVE",
        "status": reg.status,
        "registered_at": reg.registered_at.isoformat() if reg.registered_at else None,
        "registered_by": reg.registered_by,
    }


# ── GET /events/{id}/registrations ───────────────────────────────────────────

@router.get("/{event_id}/registrations")
async def list_registrations(
    event_id: int,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role.value not in ('ADMIN', 'CONTRACTOR', 'HANDLER', 'ARCHITECT'):
        raise HTTPException(status_code=403, detail="Forbidden")

    # For MAJOR events: enforce partner membership + scope data to own org
    # For LOCAL events: enforce org ownership (non-ARCHITECT can only see their own org's event)
    event = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    org_scope: Optional[int] = None
    if (event.event_type or "LOCAL") == "MAJOR":
        await _assert_active_partner(db, event_id, current_user)
        if current_user.role.value not in ("ARCHITECT",):
            org_scope = getattr(current_user, "org_id", None)
    else:
        # LOCAL event: only ARCHITECT or the owning org's staff can see registrations
        if current_user.role.value not in ("ARCHITECT",):
            caller_org = getattr(current_user, "org_id", None)
            if event.org_id and caller_org != event.org_id:
                raise HTTPException(status_code=403, detail="Not authorized for this event")

    q = (
        select(EventRegistration, User)
        .join(User, User.id == EventRegistration.user_id)
        .where(EventRegistration.event_id == event_id)
    )
    if org_scope is not None:
        q = q.where(User.org_id == org_scope)
    if status and status != "ALL":
        q = q.where(EventRegistration.status == status.upper())

    q = q.order_by(EventRegistration.registered_at.asc())
    q = q.offset((page - 1) * limit).limit(limit)

    rows = (await db.execute(q)).all()

    # BC earned per user in this event
    bc_map = {}
    bc_rows = (await db.execute(
        select(BcEvent.operative_id, func.sum(BcEvent.bc_delta))
        .where(BcEvent.event_id == event_id)
        .group_by(BcEvent.operative_id)
    )).all()
    bc_map = {str(r[0]): int(r[1] or 0) for r in bc_rows}

    # Claim counts
    claim_rows = (await db.execute(
        select(Claim.operative_id, func.count(Claim.id))
        .where(Claim.event_id == event_id)
        .group_by(Claim.operative_id)
    )).all()
    claim_map = {str(r[0]): int(r[1]) for r in claim_rows}

    # Team memberships
    from app.models.team import TeamMembership, Team as Syn
    syn_rows = (await db.execute(
        select(TeamMembership.operative_id, Syn.name)
        .join(Syn, Syn.id == TeamMembership.team_id)
        .where(TeamMembership.event_id == event_id)
    )).all()
    syn_map = {str(r[0]): r[1] for r in syn_rows}

    out = []
    for i, (reg, user) in enumerate(rows):
        uid = str(user.id)
        out.append({
            "rank": i + 1 + (page - 1) * limit,
            "callsign": user.username,
            "email": user.email,
            "registered_at": reg.registered_at.isoformat() if reg.registered_at else None,
            "registered_by": reg.registered_by,
            "status": reg.status,
            "removed_at": reg.removed_at.isoformat() if reg.removed_at else None,
            "removed_by": reg.removed_by,
            "removal_reason": reg.removal_reason,
            "bc_earned": bc_map.get(uid, 0),
            "contracts_claimed": claim_map.get(uid, 0),
            "team_name": syn_map.get(uid),
            "user_id": uid,
        })
    return out


# ── POST /events/{id}/registrations (admin manual add) ───────────────────────

class ManualRegRequest(BaseModel):
    user_id: UUID


@router.post("/{event_id}/registrations", status_code=201)
async def admin_add_registration(
    event_id: int,
    body: ManualRegRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    e = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")

    # MAJOR event: calling Admin must be an active partner; can only add their own org's users
    if (e.event_type or "LOCAL") == "MAJOR":
        await _assert_active_partner(db, event_id, current_user)
        caller_org = getattr(current_user, "org_id", None)
        if current_user.role.value != "ARCHITECT" and caller_org:
            # Verify target user belongs to calling Admin's org
            target_check = (await db.execute(
                select(User).where(User.id == body.user_id)
            )).scalar_one_or_none()
            if target_check and target_check.org_id != caller_org:
                raise HTTPException(
                    status_code=403,
                    detail="You can only manage participants from your own organization",
                )

    target = (await db.execute(select(User).where(User.id == body.user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    existing = (await db.execute(
        select(EventRegistration).where(
            EventRegistration.event_id == event_id,
            EventRegistration.user_id == body.user_id,
        )
    )).scalar_one_or_none()

    if existing:
        if existing.status == "ACTIVE":
            raise HTTPException(status_code=400, detail="ALREADY_REGISTERED")
        # Re-activate if previously removed
        existing.status = "ACTIVE"
        existing.removed_at = None
        existing.removed_by = None
        existing.removal_reason = None
    else:
        db.add(EventRegistration(
            event_id=event_id,
            user_id=body.user_id,
            registered_by="ADMIN",
            status="ACTIVE",
        ))
        e.participant_count = (e.participant_count or 0) + 1

    db.add(Notification(
        user_id=body.user_id,
        message=f"You have been registered for {e.name} by the administrator.",
    ))
    await db.commit()
    return {"registered": True, "callsign": target.username}


# ── DELETE /events/{id}/registrations/{user_id} (admin remove) ───────────────

class RemoveRegRequest(BaseModel):
    reason: str = Field(..., min_length=10)


@router.delete("/{event_id}/registrations/{user_id}")
async def admin_remove_registration(
    event_id: int,
    user_id: UUID,
    body: RemoveRegRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    e = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")

    # MAJOR event: calling Admin must be an active partner; can only remove their own org's users
    if (e.event_type or "LOCAL") == "MAJOR":
        await _assert_active_partner(db, event_id, current_user)
        caller_org = getattr(current_user, "org_id", None)
        if current_user.role.value != "ARCHITECT" and caller_org:
            target_org_check = (await db.execute(
                select(User.org_id).where(User.id == user_id)
            )).scalar_one_or_none()
            if target_org_check is not None and target_org_check != caller_org:
                raise HTTPException(
                    status_code=403,
                    detail="You can only manage participants from your own organization",
                )

    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    reg = (await db.execute(
        select(EventRegistration).where(
            EventRegistration.event_id == event_id,
            EventRegistration.user_id == user_id,
        )
    )).scalar_one_or_none()

    if not reg or reg.status == "REMOVED":
        raise HTTPException(status_code=404, detail="Active registration not found")

    now = datetime.utcnow()

    # Calculate BC to wipe — sum of all bc_events for this user in this event
    bc_result = await db.execute(
        select(func.sum(BcEvent.bc_delta))
        .where(BcEvent.operative_id == user_id, BcEvent.event_id == event_id)
    )
    bc_wiped = int(bc_result.scalar() or 0)

    # Atomic removal:
    # a) Mark registration removed
    reg.status = "REMOVED"
    reg.removed_at = now
    reg.removed_by = current_user.username
    reg.removal_reason = body.reason

    # b/c) Wipe BC events and recalculate user bc
    await db.execute(text(
        "DELETE FROM bc_events WHERE operative_id = :uid AND event_id = :eid"
    ), {"uid": str(user_id), "eid": event_id})

    # d) Recalculate user bc_total from remaining bc_events
    remaining_bc = (await db.execute(
        select(func.sum(BcEvent.bc_delta)).where(BcEvent.operative_id == user_id)
    )).scalar() or 0
    target.bc_total = max(0, int(remaining_bc))

    # e/f) Remove from team and update team BC
    syn_mem = (await db.execute(
        select(TeamMembership).where(
            TeamMembership.operative_id == user_id,
            TeamMembership.event_id == event_id,
        )
    )).scalar_one_or_none()

    if syn_mem:
        # Null out team_id on all claims for this user/event so the team
        # board (which sums Claim.bc_earned) no longer counts their contributions.
        await db.execute(text(
            "UPDATE claims SET team_id = NULL "
            "WHERE operative_id = :uid AND event_id = :eid"
        ), {"uid": str(user_id), "eid": event_id})
        await db.delete(syn_mem)

    # g) Record in event_removals
    db.add(EventRemoval(
        event_id=event_id,
        user_id=user_id,
        callsign=target.username,
        removed_by=current_user.username,
        removal_reason=body.reason,
        bc_wiped=bc_wiped,
        removed_at=now,
    ))

    # h) Notify user
    db.add(Notification(
        user_id=user_id,
        message=(
            f"> ACCESS REVOKED\n"
            f"> You have been removed from {e.name}.\n"
            f"> Reason: {body.reason}\n"
            f"> Contact your administrator if you believe this is an error."
        ),
    ))

    await db.commit()
    return {"removed": True, "bc_wiped": bc_wiped, "callsign": target.username}


# ── GET /events/{id}/major-summary — MAJOR event participant overview ─────────

@router.get("/{event_id}/major-summary")
async def major_event_summary(
    event_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns participant counts for a MAJOR event.
    Host Admin sees all orgs; Partner Admin sees only own totals.
    """
    e = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")
    if (e.event_type or "LOCAL") != "MAJOR":
        raise HTTPException(status_code=400, detail="Not a MAJOR event")

    # Security: only participating orgs may view this summary
    await _assert_active_partner(db, event_id, current_user)

    admin_org_id = getattr(current_user, "org_id", None)
    is_host = (
        admin_org_id is not None
        and admin_org_id in (e.host_org_id, e.org_id)
    ) or current_user.role.value == "ARCHITECT"

    # Own org participant count
    own_count = (await db.execute(
        select(func.count(EventRegistration.id))
        .join(User, User.id == EventRegistration.user_id)
        .where(
            EventRegistration.event_id == event_id,
            EventRegistration.status == "ACTIVE",
            User.org_id == admin_org_id,
        )
    )).scalar() or 0

    # Total participants
    total_count = (await db.execute(
        select(func.count(EventRegistration.id))
        .where(
            EventRegistration.event_id == event_id,
            EventRegistration.status == "ACTIVE",
        )
    )).scalar() or 0

    result = {
        "event_id": event_id,
        "event_name": e.name,
        "is_host": is_host,
        "total_participants": total_count,
        "own_count": own_count,
        "partner_counts": [],
    }

    if is_host:
        # Get all ACTIVE partners
        partners = (await db.execute(
            select(MajorEventPartner, Organization)
            .join(Organization, Organization.id == MajorEventPartner.org_id)
            .where(
                MajorEventPartner.event_id == event_id,
                MajorEventPartner.status == "ACTIVE",
            )
        )).all()

        for p, org in partners:
            if org.id == admin_org_id:
                continue  # already counted in own_count
            count = (await db.execute(
                select(func.count(EventRegistration.id))
                .join(User, User.id == EventRegistration.user_id)
                .where(
                    EventRegistration.event_id == event_id,
                    EventRegistration.status == "ACTIVE",
                    User.org_id == org.id,
                )
            )).scalar() or 0
            result["partner_counts"].append({
                "org_id": org.id,
                "org_name": org.name,
                "org_code": org.org_code,
                "count": count,
            })

    return result


# ── GET /events/all-time  — cumulative BC across all events (admin only) ──────

@router.get("/all-time")
async def all_time_standings(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Sum all bc_events per user across all events (void BC excluded from bc_events)
    rows = (await db.execute(
        select(
            BcEvent.operative_id,
            func.sum(BcEvent.bc_delta).label("total_bc"),
            func.count(BcEvent.event_id.distinct()).label("event_count"),
        )
        .where(BcEvent.operative_id.isnot(None))
        .group_by(BcEvent.operative_id)
        .order_by(func.sum(BcEvent.bc_delta).desc())
        .limit(100)
    )).all()

    if not rows:
        return []

    user_ids = [r[0] for r in rows]
    users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    user_map = {str(u.id): u for u in users_result.scalars().all()}

    # Best rank per user: lowest rank number across all events from BcEvent ordering
    # Approximate from all events
    best_rank: dict[str, Optional[int]] = {}

    out = []
    for rank, (uid, total_bc, event_count) in enumerate(rows, start=1):
        u = user_map.get(str(uid))
        if not u:
            continue
        out.append({
            "rank": rank,
            "callsign": u.username,
            "events": int(event_count),
            "total_bc": int(total_bc or 0),
        })
    return out


# ── GET /events/{id}/export ───────────────────────────────────────────────────

@router.get("/{event_id}/export")
async def export_event(
    event_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    e = result.scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Event not found")

    contracts_res = await db.execute(select(Contract).where(Contract.event_id == event_id))
    claims_res = await db.execute(select(Claim).where(Claim.event_id == event_id))
    bc_res = await db.execute(select(BcEvent).where(BcEvent.event_id == event_id))
    synd_res = await db.execute(select(Team).where(Team.event_id == event_id))

    payload = {
        "event": _event_out(e),
        "contracts": [
            {
                "id": str(c.id), "title": c.title, "category": c.category.value,
                "rarity": c.rarity.value, "base_bc_value": c.base_bc_value,
                "is_published": c.is_published,
                "first_claimed_at": c.first_claimed_at.isoformat() if c.first_claimed_at else None,
                "created_at": c.created_at.isoformat(),
            }
            for c in contracts_res.scalars().all()
        ],
        "claims": [
            {
                "id": str(c.id), "contract_id": str(c.contract_id),
                "operative_id": str(c.operative_id), "bc_earned": c.bc_earned,
                "is_first_blood": c.is_first_blood,
                "claimed_at": c.claimed_at.isoformat(),
            }
            for c in claims_res.scalars().all()
        ],
        "bc_events": [
            {
                "id": str(b.id), "operative_id": str(b.operative_id),
                "event_type": str(b.event_type), "bc_delta": b.bc_delta,
                "bc_total_after": b.bc_total_after,
                "timestamp": b.timestamp.isoformat(),
            }
            for b in bc_res.scalars().all()
        ],
        "teams": [
            {
                "id": str(s.id), "name": s.name,
                "captain_id": str(s.captain_id) if s.captain_id else None,
                "created_at": s.created_at.isoformat(),
            }
            for s in synd_res.scalars().all()
        ],
        "exported_at": datetime.utcnow().isoformat(),
        "exported_by": current_user.username,
    }

    if not e.export_generated:
        e.export_generated = True
        await db.commit()

    json_bytes = json.dumps(payload, indent=2).encode("utf-8")
    return StreamingResponse(
        iter([json_bytes]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="deadnet-event-{event_id}.json"'},
    )


# ═══════════════════════════════════════════════════════════════════════════════
# MAJOR EVENT — Session 18
# ═══════════════════════════════════════════════════════════════════════════════

def _generate_major_invite_code() -> str:
    """Generate MJ-XXXX-XXXX invite code using unambiguous chars."""
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "MJ-" + "-".join(
        "".join(secrets.choice(chars) for _ in range(4))
        for _ in range(2)
    )


def _is_host_admin(current_user, event: Event) -> bool:
    return (
        current_user.role.value == "ADMIN"
        and getattr(current_user, "org_id", None) == event.host_org_id
    )


async def _assert_admin_or_architect(current_user) -> None:
    if current_user.role.value not in ("ADMIN", "ARCHITECT"):
        raise HTTPException(status_code=403, detail="Forbidden")


async def _assert_host_or_architect(current_user, event: Event) -> None:
    """Raise 403 unless caller is the Architect or the host-org Admin."""
    if current_user.role.value == "ARCHITECT":
        return
    if _is_host_admin(current_user, event):
        return
    raise HTTPException(status_code=403, detail="Only the host organization can perform this action")


async def _assert_active_partner(
    db: AsyncSession,
    event_id: int,
    current_user,
    event: Optional["Event"] = None,
) -> None:
    """
    Raise 404 unless the caller is:
    - Architect (global access), OR
    - A member of an ACTIVE partner org for this event.

    Passes for both host and partner admins — use _assert_host_or_architect
    when host-only access is needed.
    """
    if current_user.role.value == "ARCHITECT":
        return
    caller_org = getattr(current_user, "org_id", None)
    if not caller_org:
        raise HTTPException(status_code=404, detail="Not found")
    partner = await _get_active_partner(db, event_id, caller_org)
    if not partner:
        raise HTTPException(status_code=404, detail="Not found")


async def _notify_org_admins(
    db: AsyncSession,
    org_id: int,
    message: str,
    from_callsign: Optional[str] = None,
) -> None:
    admins = (await db.execute(
        select(User).where(
            User.org_id == org_id,
            User.role == UserRole.ADMIN,
            User.is_banned == False,
        )
    )).scalars().all()
    for admin in admins:
        db.add(Notification(user_id=admin.id, message=message, from_callsign=from_callsign))


async def _get_major_event_or_404(db: AsyncSession, event_id: int) -> Event:
    e = (await db.execute(
        select(Event).where(Event.id == event_id)
    )).scalar_one_or_none()
    if not e or (e.event_type or "LOCAL") != "MAJOR":
        raise HTTPException(status_code=404, detail="Major event not found")
    return e


async def _get_active_partner(db: AsyncSession, event_id: int, org_id: int) -> Optional[MajorEventPartner]:
    return (await db.execute(
        select(MajorEventPartner).where(
            MajorEventPartner.event_id == event_id,
            MajorEventPartner.org_id == org_id,
            MajorEventPartner.status == "ACTIVE",
        )
    )).scalar_one_or_none()


# ── POST /events/major — create Major Event ───────────────────────────────────

class CreateMajorEventRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=100)
    description: Optional[str] = Field(None, max_length=300)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    host_org_id: Optional[int] = None   # Architect only — sets the host org


@router.post("/major", status_code=201)
async def create_major_event(
    body: CreateMajorEventRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _assert_admin_or_architect(current_user)

    is_architect = current_user.role.value == "ARCHITECT"

    if is_architect:
        if not body.host_org_id:
            raise HTTPException(status_code=400, detail="host_org_id required when creating as Architect")
        host_org_id = body.host_org_id
    else:
        host_org_id = getattr(current_user, "org_id", None)
        if not host_org_id:
            raise HTTPException(status_code=400, detail="Admin has no associated organization")

    org = (await db.execute(
        select(Organization).where(Organization.id == host_org_id)
    )).scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Host organization not found")

    # Block if org already hosts an active Major Event
    conflict = (await db.execute(
        select(Event).where(
            Event.event_type == "MAJOR",
            Event.host_org_id == host_org_id,
            Event.status.in_([EventStatus.UPCOMING.value, EventStatus.ACTIVE.value]),
        )
    )).scalar_one_or_none()
    if conflict:
        raise HTTPException(status_code=409, detail="Organization is already hosting an active Major Event")

    now = datetime.utcnow()
    invite_code = _generate_major_invite_code()

    e = Event(
        name=body.name,
        description=body.description,
        status=EventStatus.UPCOMING.value,
        registration_open=False,
        start_time=body.start_time,
        end_time=body.end_time,
        created_by=current_user.id,   # None for Architect — nullable column
        created_at=now,
        registration_key=_generate_reg_key(),
        org_id=host_org_id,
        event_type="MAJOR",
        is_host=True,
        host_org_id=host_org_id,
        major_event_invite_code=invite_code,
    )
    db.add(e)
    await db.flush()   # populate e.id before adding partner row

    # Auto-add host org as ACTIVE partner with its own registration key
    db.add(MajorEventPartner(
        event_id=e.id,
        org_id=host_org_id,
        joined_by=current_user.username,
        status="ACTIVE",
        registration_key=_generate_reg_key(),
    ))

    await _notify_org_admins(
        db, host_org_id,
        f'Major Event "{body.name}" has been created. Your organization is the host.',
        from_callsign=current_user.username,
    )

    db.add(ArchitectLog(
        action="MAJOR_EVENT_CREATED",
        target=f'"{body.name}" hosted by {org.name}',
        extra={"event_id": e.id, "host_org_id": host_org_id, "by": current_user.username},
        org_id=host_org_id,
    ))

    await db.commit()
    await db.refresh(e)
    return _event_out(e, include_key=True)


# ── POST /events/{id}/regenerate-major-invite ─────────────────────────────────

@router.post("/{event_id}/regenerate-major-invite")
async def regenerate_major_invite(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    e = await _get_major_event_or_404(db, event_id)
    await _assert_host_or_architect(current_user, e)

    e.major_event_invite_code = _generate_major_invite_code()
    e.invite_code_regenerated_at = datetime.utcnow()

    db.add(ArchitectLog(
        action="MAJOR_EVENT_CODE_REGENERATED",
        target=f'"{e.name}"',
        extra={"event_id": event_id, "by": current_user.username},
        org_id=e.host_org_id,
    ))

    await db.commit()
    return {"major_event_invite_code": e.major_event_invite_code}


# ── POST /events/major-join — join by invite code (no event_id needed) ────────

class MajorJoinByCodeRequest(BaseModel):
    invite_code: str


@router.post("/major-join", status_code=200)
async def join_major_event_by_code(
    body: MajorJoinByCodeRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Partner Admin joins a MAJOR event using only the invite code."""
    org_id = getattr(current_user, "org_id", None)
    if not org_id:
        raise HTTPException(status_code=400, detail="Admin has no associated organization")

    cleaned = body.invite_code.strip().upper()
    e = (await db.execute(
        select(Event).where(Event.major_event_invite_code == cleaned)
    )).scalar_one_or_none()

    if not e or (e.event_type or "LOCAL") != "MAJOR":
        # Rate-limit on invalid code: use a dummy event_id=0
        if not await check_major_invite_rate_limit(str(current_user.id), 0):
            ttl = await get_major_invite_ttl(str(current_user.id), 0)
            raise HTTPException(status_code=429, detail=f"RATE_LIMITED")
        raise HTTPException(status_code=400, detail="INVALID_CODE")

    if e.status not in (EventStatus.UPCOMING.value, EventStatus.ACTIVE.value):
        raise HTTPException(status_code=400, detail="Event is not accepting partners")

    # Check not already a partner
    existing = (await db.execute(
        select(MajorEventPartner).where(
            MajorEventPartner.event_id == e.id,
            MajorEventPartner.org_id == org_id,
        )
    )).scalar_one_or_none()
    if existing:
        if existing.status == "ACTIVE":
            raise HTTPException(status_code=409, detail="ALREADY_PARTNER")
        existing.status = "ACTIVE"
        existing.role = "PARTICIPANT"
    else:
        db.add(MajorEventPartner(
            event_id=e.id,
            org_id=org_id,
            joined_by=current_user.username,
            status="ACTIVE",
            role="PARTICIPANT",
            registration_key=_generate_reg_key(),
        ))

    org = (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalar_one_or_none()
    org_name = org.name if org else str(org_id)

    await _notify_org_admins(
        db, e.host_org_id,
        f"{org_name} has joined {e.name} as a participant organization.",
        from_callsign=current_user.username,
    )

    db.add(Notification(
        user_id=current_user.id,
        message=(
            f"Successfully joined {e.name} as a participant. "
            f"You can manage your operatives' registrations."
        ),
    ))

    db.add(ArchitectLog(
        action="MAJOR_EVENT_PARTICIPANT_JOINED",
        target=f'"{org_name}" joined "{e.name}" as PARTICIPANT',
        extra={"event_id": e.id, "org_id": org_id, "by": current_user.username},
        org_id=org_id,
    ))

    await db.commit()
    return {"joined": True, "event_name": e.name}


# ── POST /events/{id}/add-partner — host admin directly adds a partner org ────

class AddPartnerRequest(BaseModel):
    org_id: int


@router.post("/{event_id}/add-partner", status_code=201)
async def add_partner_org(
    event_id: int,
    body: AddPartnerRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Host admin (or Architect) directly adds an org as a PARTNER (can lend contractors)."""
    e = await _get_major_event_or_404(db, event_id)
    await _assert_host_or_architect(current_user, e)

    if e.status not in (EventStatus.UPCOMING.value, EventStatus.ACTIVE.value):
        raise HTTPException(status_code=400, detail="Event is not accepting partners")

    # Cannot add the host org (already a partner)
    if body.org_id == e.host_org_id:
        raise HTTPException(status_code=400, detail="Host organization is already a partner")

    org = (await db.execute(
        select(Organization).where(Organization.id == body.org_id)
    )).scalar_one_or_none()
    if not org or not org.is_active:
        raise HTTPException(status_code=404, detail="Active organization not found")

    existing = (await db.execute(
        select(MajorEventPartner).where(
            MajorEventPartner.event_id == event_id,
            MajorEventPartner.org_id == body.org_id,
        )
    )).scalar_one_or_none()

    if existing:
        if existing.status == "ACTIVE":
            raise HTTPException(status_code=409, detail="ALREADY_PARTNER")
        # Re-activate and promote to PARTNER if previously withdrawn
        existing.status = "ACTIVE"
        existing.role = "PARTNER"
        existing.joined_by = current_user.username
    else:
        db.add(MajorEventPartner(
            event_id=event_id,
            org_id=body.org_id,
            joined_by=current_user.username,
            status="ACTIVE",
            role="PARTNER",
            registration_key=_generate_reg_key(),
        ))

    await _notify_org_admins(
        db, body.org_id,
        f'Your organization has been added as a partner for the Major Event "{e.name}". Your contractors can now contribute challenges.',
        from_callsign=current_user.username,
    )

    db.add(ArchitectLog(
        action="MAJOR_EVENT_PARTNER_ADDED",
        target=f'"{org.name}" added to "{e.name}" as PARTNER',
        extra={"event_id": event_id, "org_id": body.org_id, "by": current_user.username},
        org_id=e.host_org_id,
    ))

    await db.commit()
    return {"added": True, "org_name": org.name, "org_code": org.org_code}


# ── POST /events/{id}/partner/join ────────────────────────────────────────────

class JoinMajorEventRequest(BaseModel):
    invite_code: str


@router.post("/{event_id}/partner/join")
async def join_major_event(
    event_id: int,
    body: JoinMajorEventRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    e = await _get_major_event_or_404(db, event_id)

    if e.status not in (EventStatus.UPCOMING.value, EventStatus.ACTIVE.value):
        raise HTTPException(status_code=400, detail="Event is not accepting partners")

    org_id = getattr(current_user, "org_id", None)
    if not org_id:
        raise HTTPException(status_code=400, detail="Admin has no associated organization")

    if (e.major_event_invite_code or "").upper() != body.invite_code.strip().upper():
        # Rate limit on wrong attempts
        if not await check_major_invite_rate_limit(str(current_user.id), event_id):
            ttl = await get_major_invite_ttl(str(current_user.id), event_id)
            raise HTTPException(
                status_code=429,
                detail=f"Too many invalid attempts. Try again in {ttl} seconds.",
            )
        raise HTTPException(status_code=400, detail="INVALID_INVITE_CODE")

    # Check not already a partner
    existing = (await db.execute(
        select(MajorEventPartner).where(
            MajorEventPartner.event_id == event_id,
            MajorEventPartner.org_id == org_id,
        )
    )).scalar_one_or_none()
    if existing:
        if existing.status == "ACTIVE":
            raise HTTPException(status_code=409, detail="Organization is already a participant")
        # Re-activate if previously withdrawn (still as PARTICIPANT via code)
        existing.status = "ACTIVE"
        existing.role = "PARTICIPANT"
    else:
        db.add(MajorEventPartner(
            event_id=event_id,
            org_id=org_id,
            joined_by=current_user.username,
            status="ACTIVE",
            role="PARTICIPANT",
            registration_key=_generate_reg_key(),
        ))

    org = (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalar_one_or_none()
    org_name = org.name if org else str(org_id)

    # Notify host org admins
    await _notify_org_admins(
        db, e.host_org_id,
        f"{org_name} has joined {e.name} as a participant organization.",
        from_callsign=current_user.username,
    )

    # Notify joining admin
    db.add(Notification(
        user_id=current_user.id,
        message=(
            f"Successfully joined {e.name} as a participant. "
            f"You can manage your operatives' registrations."
        ),
    ))

    # Architect log (serves as "notify architect")
    db.add(ArchitectLog(
        action="MAJOR_EVENT_PARTICIPANT_JOINED",
        target=f'"{org_name}" joined "{e.name}" as PARTICIPANT',
        extra={"event_id": event_id, "org_id": org_id, "by": current_user.username},
        org_id=org_id,
    ))

    await db.commit()
    return {"joined": True, "event_name": e.name}


# ── DELETE /events/{id}/partner/{org_id} — withdraw partner ──────────────────

class WithdrawPartnerRequest(BaseModel):
    reason: str = ""


@router.delete("/{event_id}/partner/{partner_org_id}")
async def withdraw_partner(
    event_id: int,
    partner_org_id: int,
    body: WithdrawPartnerRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    e = await _get_major_event_or_404(db, event_id)
    await _assert_host_or_architect(current_user, e)

    # Cannot withdraw the host org
    if partner_org_id == e.host_org_id:
        raise HTTPException(status_code=400, detail="Cannot withdraw the host organization")

    partner = (await db.execute(
        select(MajorEventPartner).where(
            MajorEventPartner.event_id == event_id,
            MajorEventPartner.org_id == partner_org_id,
        )
    )).scalar_one_or_none()
    if not partner or partner.status != "ACTIVE":
        raise HTTPException(status_code=404, detail="Active partner not found")

    partner.status = "WITHDRAWN"

    # Remove all their Operatives' event registrations
    partner_operatives = (await db.execute(
        select(User.id).where(
            User.org_id == partner_org_id,
            User.role == UserRole.OPERATIVE,
        )
    )).scalars().all()
    if partner_operatives:
        regs = (await db.execute(
            select(EventRegistration).where(
                EventRegistration.event_id == event_id,
                EventRegistration.user_id.in_(partner_operatives),
                EventRegistration.status == "ACTIVE",
            )
        )).scalars().all()
        for reg in regs:
            reg.status = "REMOVED"
            reg.removed_by = current_user.username
            reg.removed_at = datetime.utcnow()
            reg.removal_reason = f"Organization withdrawn from event. {body.reason}".strip()

    # Remove all their borrowed contractors
    borrowed = (await db.execute(
        select(MajorEventContractor).where(
            MajorEventContractor.event_id == event_id,
            MajorEventContractor.org_id == partner_org_id,
            MajorEventContractor.status == "ACTIVE",
        )
    )).scalars().all()
    for bc in borrowed:
        bc.status = "REMOVED"

    org = (await db.execute(
        select(Organization).where(Organization.id == partner_org_id)
    )).scalar_one_or_none()
    org_name = org.name if org else str(partner_org_id)

    # Notify withdrawn org's admins
    await _notify_org_admins(
        db, partner_org_id,
        f"Your organization has been withdrawn from {e.name}.",
        from_callsign=current_user.username,
    )

    db.add(ArchitectLog(
        action="MAJOR_EVENT_PARTNER_WITHDRAWN",
        target=f'"{org_name}" from "{e.name}"',
        extra={"event_id": event_id, "org_id": partner_org_id, "reason": body.reason, "by": current_user.username},
        org_id=partner_org_id,
    ))

    await db.commit()
    return {"withdrawn": True, "org_name": org_name}


# ── POST /events/{id}/contractors — add borrowed contractor ───────────────────

class AddContractorRequest(BaseModel):
    contractor_id: UUID


@router.get("/{event_id}/contractors")
async def list_contractors(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all contractors for a MAJOR event. Only active partners may view."""
    e = await _get_major_event_or_404(db, event_id)
    await _assert_active_partner(db, event_id, current_user)

    rows = (await db.execute(
        select(MajorEventContractor, User, Organization)
        .join(User, User.id == MajorEventContractor.contractor_id)
        .join(Organization, Organization.id == MajorEventContractor.org_id)
        .where(MajorEventContractor.event_id == event_id)
        .order_by(MajorEventContractor.added_at.asc())
    )).all()

    # Challenge count per contributing org (proxy for per-contractor counts)
    from sqlalchemy import func as _func
    challenge_counts_by_org = {
        r[0]: r[1]
        for r in (await db.execute(
            select(Contract.contributing_org_id, _func.count(Contract.id))
            .where(Contract.event_id == event_id)
            .group_by(Contract.contributing_org_id)
        )).all()
    }

    caller_org = getattr(current_user, "org_id", None)
    is_host_or_arch = (
        current_user.role.value == "ARCHITECT"
        or (caller_org is not None and caller_org in (e.host_org_id, e.org_id))
    )

    return [
        {
            "contractor_id": str(row.MajorEventContractor.contractor_id),
            "callsign": row.User.username,
            "org_id": row.Organization.id,
            "org_name": row.Organization.name,
            "org_code": row.Organization.org_code,
            "is_host_org": row.Organization.id == e.host_org_id,
            "status": row.MajorEventContractor.status,
            "added_at": row.MajorEventContractor.added_at.isoformat() if row.MajorEventContractor.added_at else None,
            "challenges_created": challenge_counts_by_org.get(row.Organization.id, 0),
            "can_remove": is_host_or_arch and row.MajorEventContractor.status == "ACTIVE"
                          and row.Organization.id != e.host_org_id,
        }
        for row in rows
    ]


@router.post("/{event_id}/contractors", status_code=201)
async def add_borrowed_contractor(
    event_id: int,
    body: AddContractorRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    e = await _get_major_event_or_404(db, event_id)
    await _assert_host_or_architect(current_user, e)

    if e.status not in (EventStatus.UPCOMING.value, EventStatus.ACTIVE.value):
        raise HTTPException(status_code=400, detail="Event is not accepting contractors")

    contractor = (await db.execute(
        select(User).where(User.id == body.contractor_id)
    )).scalar_one_or_none()
    if not contractor or contractor.role != UserRole.CONTRACTOR:
        raise HTTPException(status_code=404, detail="Contractor not found")

    # Contractor must belong to a partner org
    if not contractor.org_id:
        raise HTTPException(status_code=400, detail="Contractor has no associated organization")
    partner = await _get_active_partner(db, event_id, contractor.org_id)
    if not partner:
        raise HTTPException(status_code=400, detail="Contractor's organization is not a partner in this event")
    if partner.role != "PARTNER":
        raise HTTPException(status_code=403, detail="Only PARTNER organizations (not participants) can lend contractors")

    # Not already borrowed
    existing = (await db.execute(
        select(MajorEventContractor).where(
            MajorEventContractor.event_id == event_id,
            MajorEventContractor.contractor_id == body.contractor_id,
        )
    )).scalar_one_or_none()
    if existing:
        if existing.status == "ACTIVE":
            raise HTTPException(status_code=409, detail="Contractor is already in this event")
        existing.status = "ACTIVE"
    else:
        db.add(MajorEventContractor(
            event_id=event_id,
            contractor_id=body.contractor_id,
            org_id=contractor.org_id,
            added_by=current_user.username,
            status="ACTIVE",
        ))

    host_org = (await db.execute(
        select(Organization).where(Organization.id == e.host_org_id)
    )).scalar_one_or_none()
    host_org_name = host_org.name if host_org else "the host"

    db.add(Notification(
        user_id=contractor.id,
        message=(
            f"You have been added as a Contractor for {e.name} hosted by {host_org_name}. "
            f"You can now create challenges for this event."
        ),
        from_callsign=current_user.username,
    ))

    db.add(ArchitectLog(
        action="CONTRACTOR_BORROWED",
        target=f'"{contractor.username}" from org {contractor.org_id} added to "{e.name}"',
        extra={"event_id": event_id, "contractor_id": str(body.contractor_id), "by": current_user.username},
        org_id=e.host_org_id,
    ))

    await db.commit()
    return {"added": True, "callsign": contractor.username}


# ── DELETE /events/{id}/contractors/{contractor_id} — remove borrowed ─────────

@router.delete("/{event_id}/contractors/{contractor_id}")
async def remove_borrowed_contractor(
    event_id: int,
    contractor_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    e = await _get_major_event_or_404(db, event_id)
    await _assert_host_or_architect(current_user, e)

    record = (await db.execute(
        select(MajorEventContractor).where(
            MajorEventContractor.event_id == event_id,
            MajorEventContractor.contractor_id == contractor_id,
            MajorEventContractor.status == "ACTIVE",
        )
    )).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Active borrowed contractor not found")

    record.status = "REMOVED"

    contractor = (await db.execute(
        select(User).where(User.id == contractor_id)
    )).scalar_one_or_none()
    if contractor:
        db.add(Notification(
            user_id=contractor.id,
            message=f"You have been removed as a Contractor from {e.name}.",
            from_callsign=current_user.username,
        ))

    db.add(ArchitectLog(
        action="CONTRACTOR_REMOVED",
        target=f'"{contractor.username if contractor else contractor_id}" from "{e.name}"',
        extra={"event_id": event_id, "contractor_id": str(contractor_id), "by": current_user.username},
        org_id=e.host_org_id,
    ))

    await db.commit()
    return {"removed": True}


# ── GET /events/{id}/major — full Major Event details ─────────────────────────

@router.get("/{event_id}/major")
async def get_major_event_details(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    e = await _get_major_event_or_404(db, event_id)

    # Access: Architect, or member of a partner org (ACTIVE only)
    if current_user.role.value != "ARCHITECT":
        caller_org = getattr(current_user, "org_id", None)
        if not caller_org:
            raise HTTPException(status_code=404, detail="Not found")
        partner = await _get_active_partner(db, event_id, caller_org)
        if not partner:
            raise HTTPException(status_code=404, detail="Not found")

    # Host org info
    host_org = (await db.execute(
        select(Organization).where(Organization.id == e.host_org_id)
    )).scalar_one_or_none()

    # Partners list
    partners_rows = (await db.execute(
        select(MajorEventPartner, Organization).join(
            Organization, Organization.id == MajorEventPartner.org_id
        ).where(MajorEventPartner.event_id == event_id)
    )).all()

    # Participant count per org from event_registrations
    reg_counts_rows = (await db.execute(
        select(User.org_id, func.count(EventRegistration.id))
        .join(User, User.id == EventRegistration.user_id)
        .where(EventRegistration.event_id == event_id, EventRegistration.status == "ACTIVE")
        .group_by(User.org_id)
    )).all()
    reg_counts = {r[0]: r[1] for r in reg_counts_rows}

    partners_out = []
    for p, org in partners_rows:
        partners_out.append({
            "org_id": p.org_id,
            "name": org.name,
            "org_code": org.org_code,
            "is_host": p.org_id == e.host_org_id,
            "role": p.role or "PARTNER",
            "participant_count": reg_counts.get(p.org_id, 0),
            "joined_at": p.joined_at.isoformat() if p.joined_at else None,
            "status": p.status,
            "registration_key": p.registration_key if (
                current_user.role.value in ("ARCHITECT", "ADMIN")
                and (current_user.role.value == "ARCHITECT" or getattr(current_user, "org_id", None) == p.org_id)
            ) else None,
        })

    # Borrowed contractors with challenge counts
    contractor_rows = (await db.execute(
        select(MajorEventContractor, User, Organization).join(
            User, User.id == MajorEventContractor.contractor_id
        ).join(
            Organization, Organization.id == MajorEventContractor.org_id
        ).where(
            MajorEventContractor.event_id == event_id,
            MajorEventContractor.status == "ACTIVE",
        )
    )).all()

    challenge_counts_rows = (await db.execute(
        select(Contract.org_id, func.count(Contract.id))
        .where(Contract.event_id == event_id)
        .group_by(Contract.org_id)
    )).all()
    challenge_counts = {r[0]: r[1] for r in challenge_counts_rows}

    borrowed_out = []
    for mc, user, org in contractor_rows:
        borrowed_out.append({
            "contractor_id": str(user.id),
            "callsign": user.username,
            "org_id": mc.org_id,
            "org_name": org.name,
            "org_code": org.org_code,
            "challenges_created": challenge_counts.get(mc.org_id, 0),
            "added_at": mc.added_at.isoformat() if mc.added_at else None,
        })

    total_participants = sum(reg_counts.values())
    total_challenges = (await db.execute(
        select(func.count(Contract.id)).where(Contract.event_id == event_id)
    )).scalar() or 0

    return {
        **_event_out(e, include_key=(current_user.role.value in ("ARCHITECT", "ADMIN"))),
        "host_org": {"id": host_org.id, "name": host_org.name, "org_code": host_org.org_code} if host_org else None,
        "partners": partners_out,
        "borrowed_contractors": borrowed_out,
        "total_participants": total_participants,
        "total_challenges": int(total_challenges),
    }
