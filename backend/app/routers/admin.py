import json
import secrets
import string
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from pydantic import BaseModel, Field
from sqlalchemy import func, nullslast, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_admin
from app.models.contract import BcEvent, BcEventType, Claim, Contract, IntelDrop, IntelPurchase
from app.models.event import Event, EventStatus
from app.models.settings import PlatformSettings
from app.models.team import Team, TeamMembership
from app.models.organization import Organization
from app.models.user import AccountStatus, User, UserRole
from app.redis_client import (
    is_online, set_force_logout_after,
    set_halt_started, get_halt_started, clear_halt_started, add_paused_seconds,
)
from app.utils.clearance import get_clearance_level
from app.utils.event import get_current_event_id
from app.utils.roles import get_organization_scope
from app.utils.security import hash_password


def _generate_temp_password() -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$"
    return ''.join(secrets.choice(alphabet) for _ in range(12))


def _check_organization_access(current_user, target_org_id, allow_unassigned: bool = False) -> None:
    """Raise 404 if a non-Architect admin is accessing another organization's resource.
    Architect bypasses all organization checks; Admins are always scoped to their own.
    Set allow_unassigned=True to permit access to users with no org yet (target_org_id is None).
    """
    rv = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)
    if rv == 'ARCHITECT':
        return
    if allow_unassigned and target_org_id is None:
        return
    if getattr(current_user, 'org_id', None) != target_org_id:
        raise HTTPException(status_code=404, detail="Not found")

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class UserUpdateRequest(BaseModel):
    role: Optional[UserRole] = None
    is_banned: Optional[bool] = None


class ResetPasswordRequest(BaseModel):
    new_password: Optional[str] = Field(None, min_length=8)


class SettingsUpdateRequest(BaseModel):
    settings: dict  # {key: value}


class BoardFreezeRequest(BaseModel):
    frozen: bool


class BulkVerifyRequest(BaseModel):
    user_ids: list[UUID]


# ── Helper ───────────────────────────────────────────────────────────────────

async def _get_all_settings(db: AsyncSession) -> dict:
    result = await db.execute(select(PlatformSettings))
    return {row.key: row.value for row in result.scalars().all()}


# ── Users ────────────────────────────────────────────────────────────────────

@router.get("/organization")
async def get_admin_organization(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return the current admin's organization info + overview stats."""
    if not current_user.org_id:
        raise HTTPException(status_code=404, detail="No organization assigned")
    org = (await db.execute(
        select(Organization).where(Organization.id == current_user.org_id)
    )).scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    oid = current_user.org_id

    # Overview stats
    total_events = (await db.execute(
        select(func.count(Event.id)).where(Event.org_id == oid)
    )).scalar_one() or 0

    total_operatives = (await db.execute(
        select(func.count(User.id)).where(
            User.org_id == oid, User.role == UserRole.OPERATIVE
        )
    )).scalar_one() or 0

    total_bc = (await db.execute(
        select(func.coalesce(func.sum(BcEvent.bc_delta), 0)).where(BcEvent.org_id == oid)
    )).scalar_one() or 0

    active_event_row = (await db.execute(
        select(Event.name).where(
            Event.org_id == oid,
            Event.status == EventStatus.ACTIVE.value,
        ).limit(1)
    )).scalar_one_or_none()

    return {
        "id": org.id,
        "name": org.name,
        "org_code": org.org_code,
        "description": org.description,
        "created_at": org.created_at.isoformat() if org.created_at else None,
        "is_active": org.is_active,
        "stats": {
            "total_events": total_events,
            "total_operatives": total_operatives,
            "total_bc_distributed": total_bc,
            "active_event": active_event_row,
        },
    }


@router.get("/users")
async def list_users(
    org_id: Optional[int] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Non-Architect admins are always scoped to their own org.
    # get_organization_scope ignores the org_id query param for non-Architect users,
    # so an admin can never enumerate users from a different org by passing ?org_id=X.
    scope = get_organization_scope(current_user, org_id)
    q = select(User).order_by(User.created_at)
    if scope is not None:
        # Include unassigned users (org_id IS NULL) so admins can see and verify new registrants
        q = q.where((User.org_id == scope) | (User.org_id == None))
    elif getattr(current_user, "org_id", None) is not None:
        # Safety net: if scope is somehow None but admin has an org, force the filter
        q = q.where((User.org_id == current_user.org_id) | (User.org_id == None))
    result = await db.execute(q)
    users = result.scalars().all()

    async def _online(u: User) -> bool:
        try:
            return await is_online(str(u.id))
        except Exception:
            return False

    rows = []
    for u in users:
        rows.append({
            "id": str(u.id),
            "username": u.username,
            "email": u.email,
            "role": u.role,
            "is_banned": u.is_banned,
            "created_at": u.created_at,
            "last_login": u.last_login,
            "onboarding_complete": u.onboarding_complete,
            "is_online": await _online(u),
            "is_verified": u.is_verified,
            "account_status": u.account_status or "ACTIVE",
            "registration_reason": u.registration_reason,
        })
    return rows


@router.get("/users/{user_id}/detail")
async def get_user_detail(
    user_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _check_organization_access(current_user, target.org_id)

    # BC earned from contract claims
    bc_result = await db.execute(
        select(func.sum(BcEvent.bc_delta))
        .where(BcEvent.operative_id == user_id)
        .where(BcEvent.event_type == BcEventType.CONTRACT_CLAIMED)
    )
    bc_earned = int(bc_result.scalar() or 0)

    # Claim count
    claim_result = await db.execute(
        select(func.count(Claim.id)).where(Claim.operative_id == user_id)
    )
    claim_count = int(claim_result.scalar() or 0)

    # Intel purchase count
    intel_result = await db.execute(
        select(func.count(IntelPurchase.id)).where(IntelPurchase.operative_id == user_id)
    )
    intel_count = int(intel_result.scalar() or 0)

    # Current team
    syn_result = await db.execute(
        select(Team)
        .join(TeamMembership, TeamMembership.team_id == Team.id)
        .where(TeamMembership.operative_id == user_id)
    )
    syn = syn_result.scalar_one_or_none()

    cl_settings = await _get_all_settings(db)

    online = False
    try:
        online = await is_online(str(user_id))
    except Exception:
        pass

    return {
        "id": str(target.id),
        "username": target.username,
        "email": target.email,
        "role": target.role,
        "is_banned": target.is_banned,
        "is_online": online,
        "full_name": target.full_name,
        "student_id": target.student_id,
        "year_level": target.year_level,
        "onboarding_complete": target.onboarding_complete,
        "school": target.school,
        "section": target.section,
        "last_login": target.last_login,
        "last_ip": target.last_ip,
        "created_at": target.created_at,
        "bc_earned": bc_earned,
        "claim_count": claim_count,
        "intel_purchase_count": intel_count,
        "team": {"id": str(syn.id), "name": syn.name} if syn else None,
        "clearance_level": get_clearance_level(target.bc_total or 0, cl_settings)
            if target.role == UserRole.OPERATIVE else None,
        "is_verified": target.is_verified,
        # VO1D fields — admin always sees these
        "void_bc": target.void_bc or 0,
        "void_access": target.void_access or False,
    }


@router.post("/users/bulk-verify", status_code=200)
async def bulk_verify_users(
    body: BulkVerifyRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if not body.user_ids:
        raise HTTPException(status_code=400, detail="No users provided")
    rv = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)
    # Two-step: mark verified + promote PENDING_VERIFICATION → ACTIVE
    base_where = [User.id.in_(body.user_ids)]
    if rv != 'ARCHITECT' and getattr(current_user, 'org_id', None) is not None:
        # Allow own-org users AND unassigned users (org_id IS NULL)
        base_where.append((User.org_id == current_user.org_id) | (User.org_id == None))
    result = await db.execute(
        update(User)
        .where(*base_where)
        .values(is_verified=True, verification_token=None, verification_token_expires=None)
    )
    # Promote account_status for users still in PENDING_VERIFICATION
    await db.execute(
        update(User)
        .where(*base_where, User.account_status == AccountStatus.PENDING_VERIFICATION.value)
        .values(account_status=AccountStatus.ACTIVE.value)
    )
    await db.commit()
    return {"verified": result.rowcount}


@router.post("/users/{user_id}/verify", status_code=200)
async def verify_user_manually(
    user_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _check_organization_access(current_user, target.org_id, allow_unassigned=True)
    target.is_verified = True
    target.verification_token = None
    target.verification_token_expires = None
    if target.account_status == AccountStatus.PENDING_VERIFICATION.value:
        target.account_status = AccountStatus.ACTIVE.value
    await db.commit()
    return {"message": f"{target.username} verified"}


@router.patch("/users/{user_id}")
async def update_user(
    user_id: UUID,
    body: UserUpdateRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id).with_for_update())
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _check_organization_access(current_user, target.org_id)

    if body.role is not None:
        # Non-Architects cannot assign ADMIN role
        rv = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)
        if body.role == UserRole.ADMIN and rv != 'ARCHITECT':
            raise HTTPException(status_code=403, detail="CANNOT_ASSIGN_ADMIN_ROLE")
        # Prevent demoting the last admin
        if target.role == UserRole.ADMIN and body.role != UserRole.ADMIN:
            admin_count = await db.execute(
                select(func.count(User.id)).where(User.role == UserRole.ADMIN)
            )
            if (admin_count.scalar() or 0) <= 1:
                raise HTTPException(status_code=400, detail="LAST_ADMIN")
        target.role = body.role

    if body.is_banned is not None:
        # Cannot ban yourself or another admin
        if str(target.id) == str(current_user.id):
            raise HTTPException(status_code=400, detail="CANNOT_BAN_SELF")
        if target.role == UserRole.ADMIN:
            raise HTTPException(status_code=400, detail="CANNOT_BAN_ADMIN")
        target.is_banned = body.is_banned

    await db.commit()
    return {"id": str(target.id), "role": target.role, "is_banned": target.is_banned}


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if str(user_id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="CANNOT_DELETE_SELF")

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _check_organization_access(current_user, target.org_id)
    if target.role == UserRole.ADMIN:
        raise HTTPException(status_code=400, detail="CANNOT_DELETE_ADMIN")

    # Cascade-delete all user activity
    await db.execute(text("DELETE FROM claims WHERE operative_id = :uid"), {"uid": user_id})
    await db.execute(text("DELETE FROM bc_events WHERE operative_id = :uid"), {"uid": user_id})
    await db.execute(text("DELETE FROM intel_purchases WHERE operative_id = :uid"), {"uid": user_id})

    # Remove memberships and assignments
    mem = await db.execute(select(TeamMembership).where(TeamMembership.operative_id == user_id))
    for row in mem.scalars().all():
        await db.delete(row)

    # Clear captaincy from teams they own
    syn_res = await db.execute(select(Team).where(Team.captain_id == user_id))
    for syn in syn_res.scalars().all():
        syn.captain_id = None

    await db.delete(target)
    await db.commit()


@router.post("/users/{user_id}/reset-password")
async def reset_password(
    user_id: UUID,
    body: Optional[ResetPasswordRequest] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _check_organization_access(current_user, target.org_id)
    temp_pw = (body.new_password if body and body.new_password else None) or _generate_temp_password()
    target.hashed_password = hash_password(temp_pw)
    await db.commit()
    return {"temp_password": temp_pw, "username": target.username}


@router.post("/users/{user_id}/force-logout", status_code=200)
async def force_logout_user(
    user_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _check_organization_access(current_user, target.org_id)
    if str(user_id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="CANNOT_FORCE_LOGOUT_SELF")
    await set_force_logout_after(str(user_id))
    return {"message": f"All sessions for {target.username} have been invalidated"}


class SendReminderRequest(BaseModel):
    pass


@router.post("/users/{user_id}/send-reminder", status_code=200)
async def send_onboarding_reminder(
    user_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.models.transmission import NetworkTransmission
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _check_organization_access(current_user, target.org_id)
    tx = NetworkTransmission(
        content=(
            f"@{target.username} — Complete your operator dossier to participate in DEADNET. "
            "Visit OPERATOR SETTINGS from your dashboard."
        ),
        author_id=current_user.id,
    )
    db.add(tx)
    await db.commit()
    return {"message": "Reminder sent"}


# ── Platform settings ─────────────────────────────────────────────────────────

@router.get("/settings")
async def get_settings(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await _get_all_settings(db)


@router.patch("/settings")
async def update_settings(
    body: SettingsUpdateRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    for key, value in body.settings.items():
        result = await db.execute(
            select(PlatformSettings).where(PlatformSettings.key == key)
        )
        row = result.scalar_one_or_none()
        if row:
            row.value = str(value)
        else:
            db.add(PlatformSettings(key=key, value=str(value)))
    await db.commit()
    return {"message": "Settings updated"}


@router.post("/board-freeze")
async def set_board_freeze(
    body: BoardFreezeRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "board_frozen")
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = "true" if body.frozen else "false"
    else:
        db.add(PlatformSettings(key="board_frozen", value="true" if body.frozen else "false"))
    await db.commit()
    return {"frozen": body.frozen}


# ── Teams management ─────────────────────────────────────────────────────

@router.get("/teams")
async def list_teams_admin(
    org_id: Optional[int] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    scope = get_organization_scope(current_user, org_id)
    q = select(Team).order_by(Team.name)
    if scope is not None:
        q = q.where(Team.org_id == scope)
    result = await db.execute(q)
    teams = result.scalars().all()

    mem_result = await db.execute(
        select(TeamMembership.team_id, func.count(TeamMembership.id))
        .group_by(TeamMembership.team_id)
    )
    member_counts = {str(r[0]): r[1] for r in mem_result.all()}

    bc_result = await db.execute(
        select(Claim.team_id, func.sum(Claim.bc_earned))
        .where(Claim.team_id.isnot(None))
        .group_by(Claim.team_id)
    )
    team_bc = {str(r[0]): int(r[1]) for r in bc_result.all()}

    # Batch-fetch captain school/section
    captain_ids = [s.captain_id for s in teams if s.captain_id]
    captain_map: dict[str, User] = {}
    if captain_ids:
        cap_result = await db.execute(select(User).where(User.id.in_(captain_ids)))
        captain_map = {str(u.id): u for u in cap_result.scalars().all()}

    return [
        {
            "id": str(s.id),
            "name": s.name,
            "invite_code": s.invite_code,
            "captain_id": str(s.captain_id) if s.captain_id else None,
            "captain_school": captain_map[str(s.captain_id)].school if s.captain_id and str(s.captain_id) in captain_map else None,
            "captain_section": captain_map[str(s.captain_id)].section if s.captain_id and str(s.captain_id) in captain_map else None,
            "member_count": member_counts.get(str(s.id), 0),
            "total_bc": team_bc.get(str(s.id), 0),
            "created_at": s.created_at,
        }
        for s in teams
    ]


@router.delete("/teams/{team_id}", status_code=204)
async def disband_team(
    team_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    _check_organization_access(current_user, team.org_id)
    await db.delete(team)
    await db.commit()


# Event management endpoints moved to /events router (app/routers/events.py)


# ---------------------------------------------------------------------------
# POST /admin/competition/start — manually start with a duration
# POST /admin/competition/stop  — manually halt all competition activity
# ---------------------------------------------------------------------------

class CompetitionStartRequest(BaseModel):
    duration_minutes: int = Field(0, ge=0, le=10080)  # 0 = resume from pause


async def _upsert_setting(db: AsyncSession, key: str, value: str) -> None:
    row = await db.execute(select(PlatformSettings).where(PlatformSettings.key == key))
    existing = row.scalar_one_or_none()
    if existing:
        existing.value = value
    else:
        db.add(PlatformSettings(key=key, value=value))


@router.post("/competition/start")
async def start_competition(
    body: CompetitionStartRequest,
    _user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Check for a paused state to resume from
    paused_result = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "competition_paused_remaining_seconds")
    )
    paused_row = paused_result.scalar_one_or_none()
    paused_seconds = int(paused_row.value) if paused_row and paused_row.value else 0

    if paused_seconds > 0:
        # Resume from paused remaining time
        duration_seconds = paused_seconds
        await _upsert_setting(db, "competition_paused_remaining_seconds", "0")
    else:
        if body.duration_minutes < 1:
            raise HTTPException(status_code=400, detail="Set a duration first")
        duration_seconds = body.duration_minutes * 60

    end_dt = datetime.utcnow() + timedelta(seconds=duration_seconds)
    await _upsert_setting(db, "competition_active", "true")
    await _upsert_setting(db, "competition_manual_end", end_dt.isoformat() + "Z")
    await _upsert_setting(db, "board_frozen", "false")
    await _upsert_setting(db, "competition_halted_by", "")
    # Settle halt period for decay timer
    import time as _time
    from app.utils.event import get_current_event_id as _get_eid
    active_eid = await _get_eid(db)
    if active_eid:
        halt_at = await get_halt_started(active_eid)
        if halt_at is not None:
            await add_paused_seconds(active_eid, _time.time() - halt_at)
            await clear_halt_started(active_eid)
    await db.commit()
    return {"competition_active": True, "competition_manual_end": end_dt.isoformat() + "Z"}


@router.post("/competition/stop")
async def stop_competition(
    _user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Compute remaining time before pausing
    end_result = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "competition_manual_end")
    )
    end_row = end_result.scalar_one_or_none()
    remaining_seconds = 0
    if end_row and end_row.value:
        try:
            end_dt = datetime.fromisoformat(end_row.value.rstrip("Z"))
            remaining_seconds = max(0, int((end_dt - datetime.utcnow()).total_seconds()))
        except (ValueError, TypeError):
            pass

    await _upsert_setting(db, "competition_active", "false")
    await _upsert_setting(db, "competition_paused_remaining_seconds", str(remaining_seconds))
    await _upsert_setting(db, "board_frozen", "true")
    await _upsert_setting(db, "competition_halted_by", getattr(_user, "username", "SYSTEM") or "SYSTEM")
    # Track halt start for decay timer pause
    from app.utils.event import get_current_event_id as _get_eid
    active_eid = await _get_eid(db)
    if active_eid:
        await set_halt_started(active_eid)
    await db.commit()
    return {"competition_active": False, "paused_remaining_seconds": remaining_seconds}


@router.post("/competition/force-resume")
async def force_resume_competition(
    current_user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Force-clear the halted state regardless of event status.
    Use when competition_active is stuck at false with no active event to resume via."""
    import time as _time
    from app.models.event import Event as _Event

    # Clear all competition halt settings
    await _upsert_setting(db, "competition_active", "true")
    await _upsert_setting(db, "board_frozen", "false")
    await _upsert_setting(db, "competition_halted_by", "")
    await _upsert_setting(db, "competition_paused_remaining_seconds", "0")
    await _upsert_setting(db, "competition_manual_end", "")

    # Clear halt_started Redis keys for ALL non-archived events
    all_events = (await db.execute(
        select(_Event).where(_Event.status.in_(["UPCOMING", "ACTIVE", "CLOSED"]))
    )).scalars().all()
    for ev in all_events:
        halt_at = await get_halt_started(ev.id)
        if halt_at is not None:
            await add_paused_seconds(ev.id, _time.time() - halt_at)
            await clear_halt_started(ev.id)

    await db.commit()
    return {"ok": True, "competition_active": True}


# ---------------------------------------------------------------------------
# Contract archive system
# ---------------------------------------------------------------------------

class RedeployRequest(BaseModel):
    event_id: int
    publish: bool = False


@router.get("/contracts/archive")
async def list_archived_contracts(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return all archived contracts scoped to this admin's org."""
    scope = get_organization_scope(current_user, None)
    q = (
        select(Contract)
        .where(Contract.is_archived == True, Contract.is_void == False)
        .order_by(nullslast(Contract.archived_at.desc()))
    )
    if scope is not None:
        q = q.where(Contract.org_id == scope)

    contracts = (await db.execute(q)).scalars().all()
    if not contracts:
        return []

    cids = [c.id for c in contracts]

    # Batch-fetch events
    event_ids = {c.event_id for c in contracts if c.event_id}
    events_map: dict = {}
    if event_ids:
        rows = (await db.execute(select(Event).where(Event.id.in_(event_ids)))).scalars().all()
        events_map = {e.id: e for e in rows}

    # Claim counts (historical — all events)
    claim_rows = (await db.execute(
        select(Claim.contract_id, func.count(Claim.id))
        .where(Claim.contract_id.in_(cids))
        .group_by(Claim.contract_id)
    )).all()
    claim_counts = {str(r[0]): r[1] for r in claim_rows}

    # Intel drop counts
    intel_rows = (await db.execute(
        select(IntelDrop.contract_id, func.count(IntelDrop.id))
        .where(IntelDrop.contract_id.in_(cids))
        .group_by(IntelDrop.contract_id)
    )).all()
    intel_counts = {str(r[0]): r[1] for r in intel_rows}

    # Creator usernames
    creator_ids = {c.created_by for c in contracts if c.created_by}
    creators: dict = {}
    if creator_ids:
        rows = (await db.execute(select(User.id, User.username).where(User.id.in_(creator_ids)))).all()
        creators = {str(r[0]): r[1] for r in rows}

    result = []
    for c in contracts:
        evt = events_map.get(c.event_id) if c.event_id else None
        result.append({
            "id": str(c.id),
            "title": c.title,
            "category": c.category.value if hasattr(c.category, "value") else c.category,
            "rarity": c.rarity.value if hasattr(c.rarity, "value") else c.rarity,
            "base_bc_value": c.base_bc_value,
            "tags": c.tags or [],
            "attachment_count": len(c.attachments or []),
            "intel_count": intel_counts.get(str(c.id), 0),
            "claim_count": claim_counts.get(str(c.id), 0),
            "archived_at": c.archived_at.isoformat() if c.archived_at else None,
            "event_id": c.event_id,
            "event_name": evt.name if evt else None,
            "event_status": evt.status.value if evt and hasattr(evt.status, "value") else (evt.status if evt else None),
            "creator_username": creators.get(str(c.created_by)) if c.created_by else None,
            "source_contract_id": str(c.source_contract_id) if c.source_contract_id else None,
        })
    return result


@router.post("/contracts/{contract_id}/archive")
async def toggle_contract_archive(
    contract_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Toggle the archived flag on a contract. Unpublishes it when archiving."""
    contract = (await db.execute(
        select(Contract).where(Contract.id == contract_id, Contract.is_void == False)
    )).scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
    _check_organization_access(current_user, contract.org_id)

    contract.is_archived = not contract.is_archived
    if contract.is_archived:
        contract.archived_at = datetime.utcnow()
        contract.is_published = False  # always unpublish on archive
    else:
        contract.archived_at = None

    await db.commit()
    return {
        "is_archived": contract.is_archived,
        "archived_at": contract.archived_at.isoformat() if contract.archived_at else None,
    }


@router.post("/events/{event_id}/archive-contracts")
async def bulk_archive_event_contracts(
    event_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Archive all non-void, non-archived contracts from the given event."""
    event = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    _check_organization_access(current_user, event.org_id)

    scope = get_organization_scope(current_user, None)

    # Count total eligible contracts before org scope to compute skipped
    total_q = select(func.count(Contract.id)).where(
        Contract.event_id == event_id,
        Contract.is_void == False,
        Contract.is_archived == False,
    )
    total_eligible: int = (await db.execute(total_q)).scalar() or 0

    q = select(Contract).where(
        Contract.event_id == event_id,
        Contract.is_void == False,
        Contract.is_archived == False,
    )
    if scope is not None:
        q = q.where(Contract.org_id == scope)

    contracts = (await db.execute(q)).scalars().all()
    now = datetime.utcnow()
    for c in contracts:
        c.is_archived = True
        c.archived_at = now
        c.is_published = False

    await db.commit()
    return {"archived": len(contracts), "skipped": total_eligible - len(contracts)}


@router.post("/contracts/{contract_id}/redeploy", status_code=201)
async def redeploy_contract(
    contract_id: UUID,
    body: RedeployRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create an exact copy of an archived contract in the target event as a DRAFT."""
    source = (await db.execute(
        select(Contract).where(Contract.id == contract_id, Contract.is_archived == True)
    )).scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Archived contract not found")
    _check_organization_access(current_user, source.org_id)

    target_event = (await db.execute(
        select(Event).where(Event.id == body.event_id)
    )).scalar_one_or_none()
    if not target_event:
        raise HTTPException(status_code=404, detail="Target event not found")
    _check_organization_access(current_user, target_event.org_id)
    _ev_status = target_event.status.value if hasattr(target_event.status, 'value') else str(target_event.status)
    if _ev_status in ('CLOSED', 'ARCHIVED'):
        raise HTTPException(status_code=400, detail="Cannot redeploy to a closed or archived event")

    import uuid as _uuid
    copy = Contract(
        id=_uuid.uuid4(),
        event_id=body.event_id,
        org_id=source.org_id,
        title=source.title,
        description=source.description,
        category=source.category,
        rarity=source.rarity,
        base_bc_value=source.base_bc_value,
        flag=source.flag,
        is_published=body.publish,
        is_void=False,
        is_archived=False,
        max_attempts=source.max_attempts,
        attachments=list(source.attachments or []),
        tags=list(source.tags or []),
        contributing_org_id=source.contributing_org_id,
        is_blocked_for_own_org=source.is_blocked_for_own_org,
        created_by=source.created_by,
        source_contract_id=source.id,
    )
    db.add(copy)
    await db.flush()

    # Copy intel drops with fresh UUIDs
    drops = (await db.execute(
        select(IntelDrop)
        .where(IntelDrop.contract_id == source.id)
        .order_by(IntelDrop.order_index)
    )).scalars().all()
    for drop in drops:
        db.add(IntelDrop(
            contract_id=copy.id,
            content=drop.content,
            cost_bc=drop.cost_bc,
            order_index=drop.order_index,
        ))

    await db.commit()
    return {
        "id": str(copy.id),
        "title": copy.title,
        "event_id": copy.event_id,
        "message": "Contract redeployed as draft",
    }
