import time
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_contractor
from app.models.contract import Claim, Contract, ContractCategory, ContractRarity, IntelDrop
from app.models.event import Event
from app.models.major_event import MajorEventContractor
from app.models.user import User
from app.utils.decay import get_current_bc, get_next_decay_info
from app.models.settings import PlatformSettings
from app.redis_client import get_halt_started, get_paused_seconds
from app.utils.event import get_active_event, get_current_event_id
from app.utils.roles import get_organization_scope

router = APIRouter()

UPLOAD_DIR = "/app/uploads"
MAX_FILE_SIZE = 50 * 1024 * 1024


class IntelDropUpdate(BaseModel):
    content: str
    cost_bc: int = 30


class ContractUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[ContractCategory] = None
    rarity: Optional[ContractRarity] = None
    base_bc_value: Optional[int] = None
    flag: Optional[str] = None
    is_published: Optional[bool] = None
    tags: Optional[List[str]] = None
    intel_drops: Optional[List[IntelDropUpdate]] = None  # replaces all existing drops
    max_attempts: Optional[int] = None


class ContractCreateRequest(BaseModel):
    title: str
    description: str = ""
    category: ContractCategory = ContractCategory.MISC
    rarity: ContractRarity = ContractRarity.COMMON
    base_bc_value: int = 100
    flag: str
    is_published: bool = False
    tags: Optional[List[str]] = None
    intel_drops: Optional[List[IntelDropUpdate]] = None
    event_id: Optional[int] = None  # override current event (for borrowed contractors)
    max_attempts: int = 0


async def _get_decay_settings(db: AsyncSession) -> dict:
    result = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key.like("decay_%"))
    )
    return {row.key: row.value for row in result.scalars().all()}


async def _can_edit_contract(
    db: AsyncSession,
    contract: Contract,
    contractor_org_id: Optional[int],
) -> bool:
    """Return True if this contractor may edit/delete/publish the given contract."""
    if not contract.event_id:
        return True  # no event — no restriction
    event = (await db.execute(
        select(Event).where(Event.id == contract.event_id)
    )).scalar_one_or_none()
    if not event or (event.event_type or "LOCAL") != "MAJOR":
        return True  # LOCAL event — no restriction
    if contractor_org_id is None:
        return False
    # MAJOR event: host org has full access
    if event.host_org_id == contractor_org_id:
        return True
    # Borrowed contractor: only their own contributed challenges
    return contract.contributing_org_id == contractor_org_id


# ---------------------------------------------------------------------------
# GET /contractor/events  — events this contractor is authorized for
# ---------------------------------------------------------------------------

@router.get("/events")
async def list_contractor_events(
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    """Return events this contractor can create challenges for."""
    contractor_org_id = getattr(current_user, "org_id", None)
    events = []
    seen_ids: set = set()

    # Events belonging to their own org — exclude CLOSED/ARCHIVED
    if contractor_org_id:
        own_rows = (await db.execute(
            select(Event)
            .where(
                Event.org_id == contractor_org_id,
                Event.status.notin_(["CLOSED", "ARCHIVED"]),
            )
            .order_by(Event.id.desc())
        )).scalars().all()
        for e in own_rows:
            seen_ids.add(e.id)
            events.append({
                "id": e.id,
                "name": e.name,
                "status": e.status,
                "event_type": e.event_type or "LOCAL",
                "is_host": (e.event_type or "LOCAL") == "MAJOR" and e.host_org_id == contractor_org_id,
                "allowed_categories": e.allowed_categories or [],
            })

    # MAJOR events they've been borrowed into (different org)
    if getattr(current_user, "id", None):
        borrowed_rows = (await db.execute(
            select(MajorEventContractor, Event)
            .join(Event, Event.id == MajorEventContractor.event_id)
            .where(
                MajorEventContractor.contractor_id == current_user.id,
                MajorEventContractor.status == "ACTIVE",
                Event.status.notin_(["CLOSED", "ARCHIVED"]),
            )
        )).all()
        for _mc, e in borrowed_rows:
            if e.id not in seen_ids:
                seen_ids.add(e.id)
                events.append({
                    "id": e.id,
                    "name": e.name,
                    "status": e.status,
                    "event_type": e.event_type or "LOCAL",
                    "is_host": False,
                    "allowed_categories": e.allowed_categories or [],
                })

    return events


# ---------------------------------------------------------------------------
# POST /contractor/contracts  — create new contract
# ---------------------------------------------------------------------------

@router.post("/contracts", status_code=201)
async def create_contract(
    body: ContractCreateRequest,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    contractor_org_id = getattr(current_user, "org_id", None)

    # Resolve event_id: explicit override → org-scoped active event → global fallback
    if body.event_id is not None:
        event_id = body.event_id
    elif contractor_org_id:
        org_event = (await db.execute(
            select(Event)
            .where(
                Event.org_id == contractor_org_id,
                Event.status.in_(["ACTIVE", "UPCOMING"]),
            )
            .order_by(Event.id.desc())
            .limit(1)
        )).scalar_one_or_none()
        event_id = org_event.id if org_event else await get_current_event_id(db)
    else:
        event_id = await get_current_event_id(db)

    c = Contract(
        title=body.title,
        description=body.description,
        category=body.category,
        rarity=body.rarity,
        base_bc_value=body.base_bc_value,
        flag=body.flag,
        is_published=body.is_published,
        attachments=[],
        tags=body.tags or [],
        event_id=event_id,
        org_id=contractor_org_id,
        contributing_org_id=contractor_org_id,
        is_blocked_for_own_org=False,
        created_by=current_user.id,
        max_attempts=body.max_attempts,
    )
    db.add(c)
    await db.flush()   # populate c.id

    for i, drop in enumerate((body.intel_drops or [])[:3]):
        if drop.content.strip():
            db.add(IntelDrop(
                contract_id=c.id,
                content=drop.content,
                cost_bc=drop.cost_bc,
                order_index=i,
            ))

    await db.commit()
    return {"id": str(c.id), "message": "Contract created"}


# ---------------------------------------------------------------------------
# GET /contractor/contracts  — all contracts including drafts
# ---------------------------------------------------------------------------

@router.get("/contracts")
async def list_all_contracts(
    org_id: Optional[int] = None,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    event_id = await get_current_event_id(db)
    contractor_org_id = getattr(current_user, "org_id", None)

    # Determine if this contractor is a host of the current MAJOR event
    is_host_contractor = False
    cur_event = None
    if event_id:
        cur_event = (await db.execute(
            select(Event).where(Event.id == event_id)
        )).scalar_one_or_none()
        if cur_event and (cur_event.event_type or "LOCAL") == "MAJOR":
            is_host_contractor = (cur_event.host_org_id == contractor_org_id)

    scope = get_organization_scope(current_user, org_id)
    sup_q = (
        select(Contract)
        .where(Contract.event_id == event_id, Contract.is_void == False)
        .order_by(Contract.category, Contract.rarity, Contract.title)
    )
    # Host contractor of a MAJOR event sees ALL contracts; others see own org only
    if not is_host_contractor and scope is not None:
        sup_q = sup_q.where(Contract.org_id == scope)
    result = await db.execute(sup_q)
    contracts = result.scalars().all()

    decay_settings_raw = await _get_decay_settings(db)
    active_event = await get_active_event(db)
    paused_secs = 0.0
    if active_event:
        paused_secs = await get_paused_seconds(active_event.id)
        halt_at = await get_halt_started(active_event.id)
        if halt_at is not None:
            paused_secs += time.time() - halt_at

    counts_result = await db.execute(
        select(Claim.contract_id, func.count(Claim.id)).group_by(Claim.contract_id)
    )
    claim_counts = {str(r[0]): r[1] for r in counts_result.all()}

    # Intel drop counts per contract
    drop_counts_result = await db.execute(
        select(IntelDrop.contract_id, func.count(IntelDrop.id)).group_by(IntelDrop.contract_id)
    )
    drop_counts = {str(r[0]): r[1] for r in drop_counts_result.all()}

    def _can_edit(c: Contract) -> bool:
        if not cur_event or (cur_event.event_type or "LOCAL") != "MAJOR":
            return True  # LOCAL event — no restriction
        if is_host_contractor:
            return True  # host contractor: full access
        return c.contributing_org_id == contractor_org_id  # borrowed: own only

    return [
        {
            "id": str(c.id),
            "title": c.title,
            "category": c.category,
            "rarity": c.rarity,
            "base_bc_value": c.base_bc_value,
            "current_bc_value": get_current_bc(c.base_bc_value, active_event, decay_settings_raw, paused_secs, c.first_claimed_at),
            "flag": "••••••••",   # never expose plain flag to frontend
            "is_published": c.is_published,
            "tags": c.tags or [],
            "claim_count": claim_counts.get(str(c.id), 0),
            "intel_drop_count": drop_counts.get(str(c.id), 0),
            "attachments": c.attachments or [],
            "created_at": c.created_at,
            "contributing_org_id": c.contributing_org_id,
            "is_blocked_for_own_org": c.is_blocked_for_own_org or False,
            "max_attempts": c.max_attempts or 0,
            "can_edit": _can_edit(c),
        }
        for c in contracts
    ]


# ---------------------------------------------------------------------------
# GET /contractor/contracts/{id}  — full contract detail (for edit form)
# ---------------------------------------------------------------------------

@router.get("/contracts/{contract_id}")
async def get_contract_detail(
    contract_id: UUID,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Contract).where(Contract.id == contract_id))
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Contract not found")

    drops_result = await db.execute(
        select(IntelDrop)
        .where(IntelDrop.contract_id == contract_id)
        .order_by(IntelDrop.order_index)
    )
    drops = drops_result.scalars().all()

    return {
        "id": str(c.id),
        "title": c.title,
        "description": c.description,
        "category": c.category,
        "rarity": c.rarity,
        "base_bc_value": c.base_bc_value,
        "flag": "••••••••",   # never expose plain flag to frontend
        "is_published": c.is_published,
        "tags": c.tags or [],
        "attachments": c.attachments or [],
        "contributing_org_id": c.contributing_org_id,
        "is_blocked_for_own_org": c.is_blocked_for_own_org or False,
        "max_attempts": c.max_attempts or 0,
        "intel_drops": [
            {"content": d.content, "cost_bc": d.cost_bc}
            for d in drops
        ],
    }


# ---------------------------------------------------------------------------
# PUT /contractor/contracts/{id}  — update contract
# ---------------------------------------------------------------------------

@router.put("/contracts/{contract_id}")
async def update_contract(
    contract_id: UUID,
    body: ContractUpdateRequest,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Contract).where(Contract.id == contract_id).with_for_update()
    )
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    contractor_org_id = getattr(current_user, "org_id", None)
    if not await _can_edit_contract(db, contract, contractor_org_id):
        raise HTTPException(status_code=403, detail="CANNOT_EDIT_OTHER_ORG_CONTRACT")

    if body.title is not None:
        contract.title = body.title
    if body.description is not None:
        contract.description = body.description
    if body.category is not None:
        contract.category = body.category
    if body.rarity is not None:
        contract.rarity = body.rarity
    if body.base_bc_value is not None:
        contract.base_bc_value = body.base_bc_value
    if body.flag is not None:
        contract.flag = body.flag
    if body.is_published is not None:
        contract.is_published = body.is_published
    if body.tags is not None:
        contract.tags = body.tags
    if body.max_attempts is not None:
        contract.max_attempts = max(0, body.max_attempts)

    # Replace intel drops if provided
    if body.intel_drops is not None:
        drops_result = await db.execute(
            select(IntelDrop).where(IntelDrop.contract_id == contract_id)
        )
        for drop in drops_result.scalars().all():
            await db.delete(drop)
        await db.flush()
        for i, drop in enumerate(body.intel_drops[:3]):
            db.add(IntelDrop(
                contract_id=contract_id,
                content=drop.content,
                cost_bc=drop.cost_bc,
                order_index=i,
            ))

    await db.commit()
    return {"id": str(contract.id), "message": "Contract updated"}


# ---------------------------------------------------------------------------
# PATCH /contractor/contracts/{id}/publish  — toggle published
# ---------------------------------------------------------------------------

@router.patch("/contracts/{contract_id}/publish")
async def toggle_publish(
    contract_id: UUID,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Contract).where(Contract.id == contract_id).with_for_update()
    )
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    contractor_org_id = getattr(current_user, "org_id", None)
    if not await _can_edit_contract(db, contract, contractor_org_id):
        raise HTTPException(status_code=403, detail="CANNOT_EDIT_OTHER_ORG_CONTRACT")

    contract.is_published = not contract.is_published
    await db.commit()
    return {"id": str(contract.id), "is_published": contract.is_published}


# ---------------------------------------------------------------------------
# DELETE /contractor/contracts/{id}  — delete contract
# ---------------------------------------------------------------------------

@router.delete("/contracts/{contract_id}", status_code=204)
async def delete_contract(
    contract_id: UUID,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Contract).where(Contract.id == contract_id))
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    contractor_org_id = getattr(current_user, "org_id", None)
    if not await _can_edit_contract(db, contract, contractor_org_id):
        raise HTTPException(status_code=403, detail="CANNOT_DELETE_OTHER_ORG_CONTRACT")

    await db.delete(contract)
    await db.commit()
