import os
import time
import uuid as _uuid
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.deps import require_active_event, require_authenticated, require_operative, require_contractor
from app.models.contract import (
    BcEvent,
    BcEventType,
    Claim,
    Contract,
    ContractAttempt,
    IntelDrop,
    IntelPurchase,
)
from app.models.event_registration import EventRegistration
from app.models.settings import PlatformSettings
from app.models.team import ContractAssignment, TeamMembership
from app.models.user import User, UserRole
from app.schemas.contract import ClaimRequest, ContractCreateRequest, IntelDropCreate
from app.utils.decay import get_current_bc, get_next_decay_info
from app.redis_client import get_halt_started, get_paused_seconds
from app.utils.rate_limit import check_claim_rate_limit
from app.utils.event import get_active_event, get_competition_state, get_current_event_id
from app.utils.roles import get_organization_scope
from app.utils.security import constant_time_compare

router = APIRouter()

UPLOAD_DIR = "/app/uploads"
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


async def _get_decay_settings(db: AsyncSession) -> dict:
    result = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key.like("decay_%"))
    )
    return {row.key: row.value for row in result.scalars().all()}


async def _decay_context(db: AsyncSession):
    """Return (settings_dict, active_event_or_None, paused_seconds)."""
    settings = await _get_decay_settings(db)
    event = await get_active_event(db)
    paused_secs = 0.0
    if event:
        paused_secs = await get_paused_seconds(event.id)
        # If currently halted, include in-progress halt duration
        halt_at = await get_halt_started(event.id)
        if halt_at is not None:
            paused_secs += time.time() - halt_at
    return settings, event, paused_secs


async def _get_claim_settings(db: AsyncSession) -> dict:
    """Fetch max_flag_attempts and other claim settings."""
    result = await db.execute(
        select(PlatformSettings).where(
            PlatformSettings.key.in_([
                "max_flag_attempts",
                "allow_solo",
                "competition_start", "competition_end",
                "competition_active", "competition_manual_end",
            ])
        )
    )
    return {row.key: row.value for row in result.scalars().all()}



# ---------------------------------------------------------------------------
# GET /contracts
# ---------------------------------------------------------------------------

@router.get("/")
async def list_contracts(
    org_id: Optional[int] = None,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    # Block operatives when competition is not active
    if current_user.role == UserRole.OPERATIVE:
        state = await get_competition_state(db)
        if not state["can_submit"]:
            raise HTTPException(status_code=403, detail=state["reason"])

    event_id = await get_current_event_id(db)

    decay_settings, active_event, paused_secs = await _decay_context(db)

    # MAJOR events: operatives see all partner-org contracts (cross-org visibility)
    is_major_event = (
        active_event is not None
        and (active_event.event_type or "LOCAL") == "MAJOR"
        and current_user.role == UserRole.OPERATIVE
    )

    scope = get_organization_scope(current_user, org_id)
    contract_q = (
        select(Contract)
        .where(Contract.is_published == True, Contract.event_id == event_id, Contract.is_void == False)
        .order_by(Contract.category, Contract.rarity)
    )
    if scope is not None and not is_major_event:
        contract_q = contract_q.where(Contract.org_id == scope)
    result = await db.execute(contract_q)
    contracts = result.scalars().all()

    # Filter by event's allowed_categories if set.
    # Use .value (the stored string e.g. "Web") rather than str() which returns
    # "ContractCategory.WEB" in Python 3.12 and would never match.
    if active_event and active_event.allowed_categories:
        _allowed = set(active_event.allowed_categories)
        contracts = [c for c in contracts if c.category.value in _allowed]
    decay_mode_out = (
        (active_event.decay_mode_override or decay_settings.get("decay_mode", "TIME_BASED"))
        if active_event else decay_settings.get("decay_mode", "TIME_BASED")
    )

    # Claim counts per contract (current event only)
    counts_result = await db.execute(
        select(Claim.contract_id, func.count(Claim.id))
        .where(Claim.event_id == event_id)
        .group_by(Claim.contract_id)
    )
    claim_counts = {str(r[0]): r[1] for r in counts_result.all()}

    # Which contracts this operative has already claimed (current event)
    claimed_ids: set = set()
    if current_user.role == UserRole.OPERATIVE:
        my_claims = await db.execute(
            select(Claim.contract_id).where(
                Claim.operative_id == current_user.id,
                Claim.event_id == event_id,
            )
        )
        claimed_ids = {str(r[0]) for r in my_claims.all()}

    # Team assignment working/solved indicators (operatives in a team only)
    team_working_map: dict[str, list[str]] = {}
    team_solved_map: dict[str, list[str]] = {}
    my_assignment_id_map: dict[str, str] = {}
    if current_user.role == UserRole.OPERATIVE and event_id:
        my_team_row = await db.execute(
            select(TeamMembership.team_id).where(
                TeamMembership.operative_id == current_user.id,
                TeamMembership.event_id == event_id,
            )
        )
        my_team_id = my_team_row.scalar_one_or_none()
        if my_team_id:
            assign_res = await db.execute(
                select(ContractAssignment, User)
                .join(User, User.id == ContractAssignment.assigned_to_id)
                .where(ContractAssignment.team_id == my_team_id)
            )
            for assign, u in assign_res.all():
                cid = str(assign.contract_id)
                if assign.status == "ACTIVE":
                    team_working_map.setdefault(cid, []).append(u.username)
                    if str(assign.assigned_to_id) == str(current_user.id):
                        my_assignment_id_map[cid] = str(assign.id)
                elif assign.status == "SOLVED":
                    team_solved_map.setdefault(cid, []).append(u.username)

    # Batch-fetch first blood usernames
    fb_ids = [c.first_blood_operative_id for c in contracts if c.first_blood_operative_id]
    fb_username_map: dict = {}
    if fb_ids:
        fb_users = await db.execute(select(User.id, User.username).where(User.id.in_(fb_ids)))
        fb_username_map = {str(r[0]): r[1] for r in fb_users.all()}

    rows = []
    for c in contracts:
        cur_bc = get_current_bc(c.base_bc_value, active_event, decay_settings, paused_secs, c.first_claimed_at)
        next_at, next_bc = get_next_decay_info(c.base_bc_value, active_event, decay_settings, paused_secs, c.first_claimed_at)
        rows.append({
            "id": str(c.id),
            "title": c.title,
            "category": c.category,
            "rarity": c.rarity,
            "tags": c.tags or [],
            "base_bc_value": c.base_bc_value,
            "current_bc_value": cur_bc,
            "decay_mode": decay_mode_out,
            "next_decay_at": next_at.isoformat() if next_at else None,
            "next_decay_bc": next_bc,
            "is_published": c.is_published,
            "claim_count": claim_counts.get(str(c.id), 0),
            "is_first_blood_taken": c.first_claimed_at is not None,
            "first_blood_username": fb_username_map.get(str(c.first_blood_operative_id)) if c.first_blood_operative_id else None,
            "is_claimed_by_me": str(c.id) in claimed_ids,
            "attachments": c.attachments or [],
            "created_at": c.created_at,
            "contributing_org_id": c.contributing_org_id,
            "is_blocked_for_own_org": (
                (c.contributing_org_id is not None and c.contributing_org_id == getattr(current_user, "org_id", None))
                if is_major_event else (c.is_blocked_for_own_org or False)
            ),
            "team_working": team_working_map.get(str(c.id), []),
            "team_solved": team_solved_map.get(str(c.id), []),
            "my_assignment_id": my_assignment_id_map.get(str(c.id)),
        })
    return rows


# ---------------------------------------------------------------------------
# GET /contracts/{id}
# ---------------------------------------------------------------------------

@router.get("/{contract_id}")
async def get_contract(
    contract_id: UUID,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Contract).where(
            Contract.id == contract_id, Contract.is_published == True, Contract.is_void == False
        )
    )
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    decay_settings, active_event, paused_secs = await _decay_context(db)

    is_claimed_by_me = False
    my_attempt_count = 0
    if current_user.role == UserRole.OPERATIVE:
        chk = await db.execute(
            select(Claim).where(
                Claim.contract_id == contract_id,
                Claim.operative_id == current_user.id,
            )
        )
        is_claimed_by_me = chk.scalar_one_or_none() is not None

        att_row = await db.execute(
            select(ContractAttempt.attempt_count).where(
                ContractAttempt.operative_id == current_user.id,
                ContractAttempt.contract_id == contract_id,
            )
        )
        my_attempt_count = att_row.scalar_one_or_none() or 0

    count_result = await db.execute(
        select(func.count(Claim.id)).where(Claim.contract_id == contract_id)
    )
    claim_count = count_result.scalar() or 0

    # First blood username
    first_blood_username = None
    if contract.first_blood_operative_id:
        fb_row = await db.execute(
            select(User.username).where(User.id == contract.first_blood_operative_id)
        )
        first_blood_username = fb_row.scalar_one_or_none()

    cur_bc = get_current_bc(contract.base_bc_value, active_event, decay_settings, paused_secs, contract.first_claimed_at)
    next_at, next_bc = get_next_decay_info(contract.base_bc_value, active_event, decay_settings, paused_secs, contract.first_claimed_at)
    decay_mode_out = (
        (active_event.decay_mode_override or decay_settings.get("decay_mode", "TIME_BASED"))
        if active_event else decay_settings.get("decay_mode", "TIME_BASED")
    )

    return {
        "id": str(contract.id),
        "title": contract.title,
        "description": contract.description,
        "category": contract.category,
        "rarity": contract.rarity,
        "tags": contract.tags or [],
        "base_bc_value": contract.base_bc_value,
        "current_bc_value": cur_bc,
        "decay_mode": decay_mode_out,
        "next_decay_at": next_at.isoformat() if next_at else None,
        "next_decay_bc": next_bc,
        "is_published": contract.is_published,
        "claim_count": claim_count,
        "is_first_blood_taken": contract.first_claimed_at is not None,
        "first_blood_username": first_blood_username,
        "is_claimed_by_me": is_claimed_by_me,
        "my_attempt_count": my_attempt_count,
        "attachments": contract.attachments or [],
        "created_at": contract.created_at,
        "contributing_org_id": contract.contributing_org_id,
        "is_blocked_for_own_org": contract.is_blocked_for_own_org or False,
    }


# ---------------------------------------------------------------------------
# POST /contracts/{id}/claim  (OPERATIVE only)
# ---------------------------------------------------------------------------

@router.post("/{contract_id}/claim")
async def claim_contract(
    contract_id: UUID,
    body: ClaimRequest,
    current_user: User = Depends(require_operative),
    _event=Depends(require_active_event),
    db: AsyncSession = Depends(get_db),
):
    claim_cfg = await _get_claim_settings(db)
    event_id = await get_current_event_id(db)

    # Unified competition state check
    state = await get_competition_state(db)
    if not state["can_submit"]:
        raise HTTPException(status_code=403, detail=state["reason"])

    # Registration check — Operative must have ACTIVE registration for current event
    if event_id:
        reg = (await db.execute(
            select(EventRegistration).where(
                EventRegistration.user_id == current_user.id,
                EventRegistration.event_id == event_id,
                EventRegistration.status == "ACTIVE",
            )
        )).scalar_one_or_none()
        if not reg:
            raise HTTPException(status_code=403, detail="NOT_REGISTERED")

    # Solo enforcement — if allow_solo is disabled, operative must be on a team
    if claim_cfg.get("allow_solo", "true").lower() == "false" and event_id:
        team_row = (await db.execute(
            select(TeamMembership.team_id).where(
                TeamMembership.operative_id == current_user.id,
                TeamMembership.event_id == event_id,
            )
        )).scalar_one_or_none()
        if not team_row:
            raise HTTPException(status_code=403, detail="SOLO_NOT_ALLOWED")

    # Rate limit: 5 attempts / min / operative / contract
    if not await check_claim_rate_limit(str(current_user.id), str(contract_id)):
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Wait before trying again.",
        )

    # Enforce max_flag_attempts (0 = unlimited) — check DB counter
    max_attempts_str = claim_cfg.get("max_flag_attempts", "0")
    max_attempts = int(max_attempts_str) if max_attempts_str.isdigit() else 0
    if max_attempts > 0:
        att_row = await db.execute(
            select(ContractAttempt.attempt_count).where(
                ContractAttempt.operative_id == current_user.id,
                ContractAttempt.contract_id == contract_id,
            )
        )
        attempts_so_far = att_row.scalar_one_or_none() or 0
        if attempts_so_far >= max_attempts:
            raise HTTPException(status_code=429, detail="MAX_ATTEMPTS_REACHED")

    # Lock contract row to prevent race conditions on first_claimed_at
    result = await db.execute(
        select(Contract)
        .where(Contract.id == contract_id, Contract.is_published == True, Contract.is_void == False)
        .with_for_update()
    )
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    # MAJOR events: block operatives from claiming their own org's contributed contracts
    active_event = (await _decay_context(db))[1]
    if (
        active_event is not None
        and (active_event.event_type or "LOCAL") == "MAJOR"
        and contract.contributing_org_id is not None
        and contract.contributing_org_id == getattr(current_user, "org_id", None)
    ):
        raise HTTPException(status_code=403, detail="BLOCKED_OWN_ORG_CONTRACT")

    # Flag comparison — always use the single shared flag
    flag_ok = constant_time_compare(body.flag.strip(), contract.flag.strip())

    if not flag_ok:
        # Upsert wrong-attempt counter in DB (always track, display when max_attempts > 0)
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        _now = datetime.utcnow()
        stmt = pg_insert(ContractAttempt).values(
            operative_id=current_user.id,
            contract_id=contract_id,
            attempt_count=1,
            last_attempt_at=_now,
        ).on_conflict_do_update(
            constraint="uq_attempt_operative_contract",
            set_={
                "attempt_count": ContractAttempt.attempt_count + 1,
                "last_attempt_at": _now,
            },
        )
        await db.execute(stmt)
        await db.commit()
        raise HTTPException(status_code=400, detail="INVALID_FLAG")

    # Check already claimed
    existing = await db.execute(
        select(Claim).where(
            Claim.contract_id == contract_id,
            Claim.operative_id == current_user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="ALREADY_CLAIMED")

    decay_settings, active_event, paused_secs = await _decay_context(db)
    is_first_blood = contract.first_claimed_at is None
    # First blood always earns full BC (decay hasn't started yet).
    # Subsequent solvers earn decayed BC based on time since first blood.
    bc_earned = get_current_bc(
        contract.base_bc_value, active_event, decay_settings, paused_secs,
        first_blood_at=None if is_first_blood else contract.first_claimed_at,
    )

    # Look up current team for this operative (current event only)
    syn_result = await db.execute(
        select(TeamMembership.team_id).where(
            TeamMembership.operative_id == current_user.id,
            TeamMembership.event_id == event_id,
        )
    )
    team_id_val = syn_result.scalar_one_or_none()

    # Atomic: update contract + claim + user BC + bc_event
    if is_first_blood:
        contract.first_claimed_at         = datetime.utcnow()
        contract.first_blood_operative_id = current_user.id

    new_bc_total = (current_user.bc_total or 0) + bc_earned
    current_user.bc_total = new_bc_total

    db.add(Claim(
        contract_id=contract_id,
        operative_id=current_user.id,
        team_id=team_id_val,
        bc_earned=bc_earned,
        is_first_blood=is_first_blood,
        event_id=event_id,
    ))
    db.add(BcEvent(
        operative_id=current_user.id,
        team_id=team_id_val,
        event_type=BcEventType.CONTRACT_CLAIMED,
        bc_delta=bc_earned,
        bc_total_after=new_bc_total,
        contract_id=contract_id,
        event_id=event_id,
    ))

    # Mark any ACTIVE assignments for this operative+contract as SOLVED
    from sqlalchemy import update as sa_update
    await db.execute(
        sa_update(ContractAssignment)
        .where(
            ContractAssignment.contract_id == contract_id,
            ContractAssignment.assigned_to_id == current_user.id,
            ContractAssignment.status == "ACTIVE",
        )
        .values(status="SOLVED")
    )

    await db.commit()

    return {
        "bc_earned": bc_earned,
        "is_first_blood": is_first_blood,
        "bc_total": new_bc_total,
        "message": "CONTRACT SEIZED" if is_first_blood else "CONTRACT CLAIMED",
    }


# ---------------------------------------------------------------------------
# GET /contracts/{id}/solvers  — ordered solver history for current event
# ---------------------------------------------------------------------------

@router.get("/{contract_id}/solvers")
async def get_solvers(
    contract_id: UUID,
    current_user=Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    chk = await db.execute(
        select(Contract.id).where(
            Contract.id == contract_id, Contract.is_published == True, Contract.is_void == False
        )
    )
    if not chk.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Contract not found")

    event_id = await get_current_event_id(db)

    q = (
        select(Claim, User.username)
        .join(User, User.id == Claim.operative_id)
        .where(Claim.contract_id == contract_id)
    )
    if event_id is not None:
        q = q.where(Claim.event_id == event_id)
    q = q.order_by(Claim.claimed_at.asc())

    rows = (await db.execute(q)).all()
    return [
        {
            "username": username,
            "claimed_at": claim.claimed_at,
            "is_first_blood": claim.is_first_blood,
            "bc_earned": claim.bc_earned,
        }
        for claim, username in rows
    ]


# ---------------------------------------------------------------------------
# GET /contracts/{id}/intel
# ---------------------------------------------------------------------------

@router.get("/{contract_id}/intel")
async def get_intel_drops(
    contract_id: UUID,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    chk = await db.execute(
        select(Contract.id).where(
            Contract.id == contract_id, Contract.is_published == True, Contract.is_void == False
        )
    )
    if not chk.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Contract not found")

    drops_result = await db.execute(
        select(IntelDrop)
        .where(IntelDrop.contract_id == contract_id)
        .order_by(IntelDrop.order_index)
    )
    drops = drops_result.scalars().all()

    # Privileged roles see content for free (no purchase needed)
    is_privileged = current_user.role in (
        UserRole.ADMIN, UserRole.CONTRACTOR, UserRole.HANDLER
    )

    purchased_ids: set = set()
    if not is_privileged and drops:
        pur_result = await db.execute(
            select(IntelPurchase.intel_drop_id).where(
                IntelPurchase.operative_id == current_user.id,
                IntelPurchase.intel_drop_id.in_([d.id for d in drops]),
            )
        )
        purchased_ids = {str(r[0]) for r in pur_result.all()}

    return [
        {
            "id": str(d.id),
            "cost_bc": d.cost_bc,
            "order_index": d.order_index,
            "is_purchased": is_privileged or str(d.id) in purchased_ids,
            "content": d.content if (is_privileged or str(d.id) in purchased_ids) else None,
        }
        for d in drops
    ]


# ---------------------------------------------------------------------------
# POST /contracts/{id}/intel/{drop_id}/purchase  (OPERATIVE only)
# ---------------------------------------------------------------------------

@router.post("/{contract_id}/intel/{drop_id}/purchase")
async def purchase_intel(
    contract_id: UUID,
    drop_id: UUID,
    current_user: User = Depends(require_operative),
    _event=Depends(require_active_event),
    db: AsyncSession = Depends(get_db),
):
    event_id = await get_current_event_id(db)

    # Unified competition state check
    state = await get_competition_state(db)
    if not state["can_submit"]:
        raise HTTPException(status_code=403, detail=state["reason"])

    # Lock drop row
    result = await db.execute(
        select(IntelDrop)
        .where(IntelDrop.id == drop_id, IntelDrop.contract_id == contract_id)
        .with_for_update()
    )
    drop = result.scalar_one_or_none()
    if not drop:
        raise HTTPException(status_code=404, detail="Intel drop not found")

    # Already purchased?
    existing = await db.execute(
        select(IntelPurchase).where(
            IntelPurchase.intel_drop_id == drop_id,
            IntelPurchase.operative_id == current_user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="ALREADY_PURCHASED")

    current_bc = current_user.bc_total or 0
    if current_bc < drop.cost_bc:
        raise HTTPException(status_code=400, detail="INSUFFICIENT_BC")

    # Atomic: deduct BC + purchase record + bc_event — all in one transaction.
    # If db.commit() fails, PostgreSQL rolls back all three writes automatically.
    new_bc_total = current_bc - drop.cost_bc
    current_user.bc_total = new_bc_total

    db.add(IntelPurchase(
        intel_drop_id=drop_id,
        operative_id=current_user.id,
        bc_spent=drop.cost_bc,
        event_id=event_id,
    ))
    db.add(BcEvent(
        operative_id=current_user.id,
        event_type=BcEventType.INTEL_PURCHASED,
        bc_delta=-drop.cost_bc,
        bc_total_after=new_bc_total,
        contract_id=contract_id,
        event_id=event_id,
    ))

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail="PURCHASE_FAILED")

    return {
        "content": drop.content,
        "bc_spent": drop.cost_bc,
        "bc_total": new_bc_total,
    }


# ---------------------------------------------------------------------------
# POST /contracts  (Contractor/Admin: create contract)
# ---------------------------------------------------------------------------

@router.post("/", status_code=201)
async def create_contract(
    body: ContractCreateRequest,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    event_id = await get_current_event_id(db)
    contract = Contract(
        title=body.title,
        description=body.description,
        category=body.category,
        rarity=body.rarity,
        base_bc_value=body.base_bc_value,
        flag=body.flag,
        is_published=body.is_published,
        attachments=[],
        event_id=event_id,
        created_by=current_user.id,
    )
    db.add(contract)
    await db.flush()  # get the ID before adding drops

    for i, drop in enumerate(body.intel_drops[:3]):  # max 3 intel drops
        db.add(IntelDrop(
            contract_id=contract.id,
            content=drop.content,
            cost_bc=drop.cost_bc,
            order_index=i,
        ))

    await db.commit()
    return {"id": str(contract.id), "message": "Contract created"}


# ---------------------------------------------------------------------------
# POST /contracts/{id}/attachments  (Contractor/Admin: upload file)
# ---------------------------------------------------------------------------

@router.post("/{contract_id}/attachments")
async def upload_attachment(
    contract_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Contract).where(Contract.id == contract_id).with_for_update()
    )
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    contents = await file.read()

    # Dynamic file limits from platform settings
    _max_mb_row = (await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "max_upload_mb")
    )).scalar_one_or_none()
    max_bytes = int((_max_mb_row.value if _max_mb_row else None) or "50") * 1024 * 1024
    if len(contents) > max_bytes:
        mb = max_bytes // (1024 * 1024)
        raise HTTPException(status_code=400, detail=f"File too large (max {mb}MB)")

    _types_row = (await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "allowed_file_types")
    )).scalar_one_or_none()
    allowed_exts_raw = (_types_row.value if _types_row else None) or "zip,pdf,txt,png,jpg,bin"
    allowed_exts = {f".{x.strip().lstrip('.')}" for x in allowed_exts_raw.split(",") if x.strip()}

    original_name = file.filename or "file"
    ext = os.path.splitext(original_name)[1].lower() or ".bin"
    if allowed_exts and ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"File type not allowed: {ext}")
    stored_name = f"{_uuid.uuid4()}{ext}"

    # Always persist to DB (works on Railway without a volume).
    # If /app/uploads is later mounted as a persistent volume, the serve
    # endpoint will find the file on disk first and bypass the DB lookup.
    from app.models.file_storage import FileStorage
    db_file = FileStorage(
        filename=stored_name,
        content=contents,
        original_name=original_name,
        content_type=file.content_type or "application/octet-stream",
        file_size=len(contents),
    )
    db.add(db_file)

    # Also write to disk if the uploads dir is available (best-effort; no crash if it fails)
    try:
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        with open(os.path.join(UPLOAD_DIR, stored_name), "wb") as f:
            f.write(contents)
    except OSError:
        pass

    attachments = list(contract.attachments or [])
    attachments.append({"stored": stored_name, "original": original_name, "size": len(contents)})
    contract.attachments = attachments
    flag_modified(contract, "attachments")  # force SQLAlchemy to track JSON mutation

    await db.commit()
    return {"stored": stored_name, "original": original_name, "size": len(contents)}
