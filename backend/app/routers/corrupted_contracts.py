"""
Corrupted Contracts — time-limited surprise challenges with contractor-set BC payout.
"""
import os
import re
import shutil
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_authenticated, require_operative, require_contractor
from app.models.contract import BcEvent, BcEventType, ContractCategory
from app.models.corrupted_contract import CCStatus, CorruptedAttempt, CorruptedClaim, CorruptedContract
from app.models.settings import PlatformSettings
from app.models.team import TeamMembership
from app.models.transmission import NetworkTransmission
from app.models.user import User, UserRole
from app.redis_client import check_cc_rate_limit, check_cc_download_rate_limit
from app.utils.event import get_competition_state, get_current_event_id
from app.utils.roles import get_organization_scope
from app.utils.security import constant_time_compare

CC_UPLOAD_DIR    = "/app/uploads/corrupted"
CC_MAX_FILE_SIZE = 50 * 1024 * 1024          # 50 MB per file
CC_MAX_TOTAL     = 200 * 1024 * 1024         # 200 MB total per event
CC_ALLOWED_EXTS  = {
    ".zip", ".tar", ".gz", ".txt", ".pdf", ".png", ".jpg",
    ".jpeg", ".pcap", ".bin", ".exe", ".py", ".js", ".php",
}

def _sanitize_filename(filename: str) -> str:
    filename = os.path.basename(filename)               # strip any path
    filename = re.sub(r"[^\w.\-]", "_", filename)       # safe chars only
    return filename[:100]

def _cc_dir(cc_id: UUID) -> str:
    return os.path.join(CC_UPLOAD_DIR, str(cc_id))

def _total_cc_storage() -> int:
    """Sum of bytes across all CC upload directories."""
    total = 0
    if not os.path.isdir(CC_UPLOAD_DIR):
        return 0
    for dirpath, _, filenames in os.walk(CC_UPLOAD_DIR):
        for fn in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, fn))
            except OSError:
                pass
    return total

router = APIRouter()

_VALID_DURATIONS  = {15, 30, 45, 60}
_VALID_BC_REWARDS = {50, 100, 200, 300, 400, 500}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _assert_competition_active(db: AsyncSession) -> None:
    """Raise 403 if competition is not currently active."""
    state = await get_competition_state(db)
    if not state["can_submit"]:
        raise HTTPException(status_code=403, detail=state["reason"])


def _serialize(cc: CorruptedContract, claim_count: int = 0, bc_distributed: int = 0) -> dict:
    return {
        "id":                  str(cc.id),
        "title":               cc.title,
        "description":         cc.description or "",
        "category":            cc.category,
        "duration_minutes":    cc.duration_minutes,
        "activated_at":        cc.activated_at.isoformat() + "Z" if cc.activated_at else None,
        "expires_at":          cc.expires_at.isoformat() + "Z" if cc.expires_at else None,
        "status":              cc.status.value,
        "max_attempts":        cc.max_attempts,
        "created_at":          cc.created_at.isoformat() + "Z",
        "claim_count":         claim_count,
        "bc_distributed":      bc_distributed,
        "has_attachment":      bool(cc.has_attachment),
        "attachment_filename": cc.attachment_filename,
        "attachment_size":     cc.attachment_size,
    }


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CCCreateBody(BaseModel):
    title:            str
    description:      str = ""
    flag:             str
    category:         ContractCategory
    duration_minutes: int
    bc_reward:        int = 100

    @field_validator("duration_minutes")
    @classmethod
    def valid_duration(cls, v: int) -> int:
        if v not in _VALID_DURATIONS:
            raise ValueError("duration_minutes must be 15, 30, 45, or 60")
        return v

    @field_validator("bc_reward")
    @classmethod
    def valid_bc_reward(cls, v: int) -> int:
        if v not in _VALID_BC_REWARDS:
            raise ValueError("bc_reward must be 50, 100, 200, 300, 400, or 500")
        return v

    @field_validator("title")
    @classmethod
    def title_nonempty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title is required")
        return v

    @field_validator("flag")
    @classmethod
    def flag_nonempty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("flag is required")
        return v


class CCClaimBody(BaseModel):
    flag: str


# ---------------------------------------------------------------------------
# POST / — create corrupted contract (DRAFT)
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def create_corrupted_contract(
    body: CCCreateBody,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    event_id = await get_current_event_id(db)

    cc = CorruptedContract(
        title=body.title,
        description=body.description,
        flag=body.flag.strip(),
        category=body.category.value,
        duration_minutes=body.duration_minutes,
        bc_reward=body.bc_reward,
        status=CCStatus.DRAFT,
        created_by=current_user.id if current_user.id else None,
        event_id=event_id,
        org_id=getattr(current_user, "org_id", None),
    )
    db.add(cc)
    await db.commit()
    await db.refresh(cc)
    return {**_serialize(cc), "bc_reward": cc.bc_reward}


# ---------------------------------------------------------------------------
# POST /{id}/activate — make it live
# ---------------------------------------------------------------------------

@router.post("/{cc_id}/activate")
async def activate_corrupted_contract(
    cc_id: UUID,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    # Only one CC can be ACTIVE at a time
    active_check = await db.execute(
        select(CorruptedContract).where(CorruptedContract.status == CCStatus.ACTIVE)
    )
    if active_check.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="ANOTHER_CC_ALREADY_ACTIVE")

    res = await db.execute(
        select(CorruptedContract).where(CorruptedContract.id == cc_id).with_for_update()
    )
    cc = res.scalar_one_or_none()
    if not cc:
        raise HTTPException(status_code=404, detail="Contract not found")
    if cc.status != CCStatus.DRAFT:
        raise HTTPException(status_code=422, detail="Only DRAFT contracts can be activated")

    now = datetime.utcnow()
    cc.status       = CCStatus.ACTIVE
    cc.activated_at = now
    cc.expires_at   = datetime.utcnow().replace(
        second=0, microsecond=0
    )  # round; overridden below
    from datetime import timedelta
    cc.expires_at = now + timedelta(minutes=cc.duration_minutes)

    db.add(NetworkTransmission(
        content=(
            f"CORRUPTED CONTRACT DETECTED — {cc.title} | "
            f"{cc.duration_minutes} MINUTES REMAINING\n"
            f"BC REWARD: UNKNOWN — CLAIM AT YOUR OWN RISK"
        ),
        author_id=None,
    ))

    await db.commit()
    await db.refresh(cc)
    return _serialize(cc)


# ---------------------------------------------------------------------------
# POST /{id}/close — manually close (Contractor or Admin)
# ---------------------------------------------------------------------------

@router.post("/{cc_id}/close")
async def close_corrupted_contract(
    cc_id: UUID,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(CorruptedContract).where(CorruptedContract.id == cc_id).with_for_update()
    )
    cc = res.scalar_one_or_none()
    if not cc:
        raise HTTPException(status_code=404, detail="Contract not found")
    if cc.status not in (CCStatus.ACTIVE, CCStatus.DRAFT):
        raise HTTPException(status_code=422, detail="Contract is already resolved")

    cc.status     = CCStatus.CLOSED
    cc.expires_at = datetime.utcnow()   # marks effective close time for recent-close query

    db.add(NetworkTransmission(
        content=f"CORRUPTED CONTRACT {cc.title} — SIGNAL TERMINATED.",
        author_id=None,
    ))

    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# GET /active — currently live CC (any authenticated user)
# ---------------------------------------------------------------------------

@router.get("/active")
async def get_active_cc(
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    from datetime import timedelta

    now = datetime.utcnow()

    # Try ACTIVE first
    res = await db.execute(
        select(CorruptedContract).where(CorruptedContract.status == CCStatus.ACTIVE)
    )
    cc = res.scalar_one_or_none()

    is_recently_closed = False
    claimed_by_username: str | None = None

    if not cc:
        # Check for recently closed/expired CC (within 120 seconds)
        cutoff = now - timedelta(seconds=120)
        recent_res = await db.execute(
            select(CorruptedContract)
            .where(
                CorruptedContract.status.in_([CCStatus.EXPIRED, CCStatus.CLOSED]),
                CorruptedContract.expires_at >= cutoff,
            )
            .order_by(CorruptedContract.expires_at.desc())
            .limit(1)
        )
        cc = recent_res.scalar_one_or_none()
        if not cc:
            return None
        is_recently_closed = True

    time_remaining = max(0, int((cc.expires_at - now).total_seconds())) if cc.expires_at else 0

    # Claim info
    claim_res = await db.execute(
        select(CorruptedClaim, User.username)
        .join(User, User.id == CorruptedClaim.operative_id)
        .where(CorruptedClaim.contract_id == cc.id)
        .limit(1)
    )
    claim_row = claim_res.first()
    claim_count = 1 if claim_row else 0
    claimed_by_username = claim_row[1] if claim_row else None

    current_user_claimed   = False
    current_user_bc        = None
    current_user_attempts  = 0

    if current_user.id and claim_row:
        current_user_claimed = (claim_row[0].operative_id == current_user.id)
        if current_user_claimed:
            current_user_bc = claim_row[0].bc_awarded

    if current_user.id and not is_recently_closed:
        att_res = await db.execute(
            select(CorruptedAttempt.attempts).where(
                CorruptedAttempt.contract_id == cc.id,
                CorruptedAttempt.operative_id == current_user.id,
            )
        )
        current_user_attempts = att_res.scalar_one_or_none() or 0

    return {
        **_serialize(cc, claim_count=claim_count),
        "time_remaining_seconds":  time_remaining if not is_recently_closed else 0,
        "current_user_claimed":    current_user_claimed,
        "current_user_bc":         current_user_bc,
        "current_user_attempts":   current_user_attempts,
        "is_recently_closed":      is_recently_closed,
        "claimed_by_username":     claimed_by_username,
    }


# ---------------------------------------------------------------------------
# POST /{id}/claim — submit flag (OPERATIVE only)
# ---------------------------------------------------------------------------

@router.post("/{cc_id}/claim")
async def claim_corrupted_contract(
    cc_id: UUID,
    body: CCClaimBody,
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    # Rate limit: 10 submissions per minute per user per CC
    if not await check_cc_rate_limit(str(current_user.id), str(cc_id)):
        raise HTTPException(status_code=429, detail="TOO_MANY_ATTEMPTS")

    res = await db.execute(
        select(CorruptedContract).where(CorruptedContract.id == cc_id).with_for_update()
    )
    cc = res.scalar_one_or_none()
    if not cc:
        raise HTTPException(status_code=404, detail="Contract not found")
    if cc.status != CCStatus.ACTIVE:
        raise HTTPException(status_code=403, detail="CC_NOT_ACTIVE")

    now = datetime.utcnow()
    if cc.expires_at and now > cc.expires_at:
        raise HTTPException(status_code=403, detail="CC_EXPIRED")

    event_id = await get_current_event_id(db)

    # Race mechanic: only ONE operative can claim the entire CC — first correct flag wins
    global_claim_check = await db.execute(
        select(func.count(CorruptedClaim.id)).where(CorruptedClaim.contract_id == cc_id)
    )
    if (global_claim_check.scalar() or 0) > 0:
        raise HTTPException(status_code=403, detail="CC_ALREADY_CLAIMED")

    # Attempt limit per CC (max_attempts)
    att_res = await db.execute(
        select(CorruptedAttempt).where(
            CorruptedAttempt.contract_id == cc_id,
            CorruptedAttempt.operative_id == current_user.id,
        ).with_for_update()
    )
    att_row = att_res.scalar_one_or_none()
    attempts_so_far = att_row.attempts if att_row else 0

    if attempts_so_far >= cc.max_attempts:
        raise HTTPException(
            status_code=429,
            detail={"correct": False, "attempts_remaining": 0, "locked": True},
        )

    # Flag check (constant-time)
    if not constant_time_compare(body.flag.strip(), cc.flag.strip()):
        # Upsert attempt counter
        stmt = pg_insert(CorruptedAttempt).values(
            contract_id=cc_id,
            operative_id=current_user.id,
            attempts=1,
        ).on_conflict_do_update(
            constraint="uq_cc_attempt",
            set_={"attempts": CorruptedAttempt.attempts + 1},
        )
        await db.execute(stmt)
        await db.commit()

        new_attempts = attempts_so_far + 1
        remaining = cc.max_attempts - new_attempts
        if remaining <= 0:
            return {"correct": False, "attempts_remaining": 0, "locked": True}
        return {"correct": False, "attempts_remaining": remaining}

    # ── Correct flag ────────────────────────────────────────────────────────

    bc_awarded = cc.bc_reward

    # Team lookup (current event only)
    syn_res = await db.execute(
        select(TeamMembership.team_id).where(
            TeamMembership.operative_id == current_user.id,
            TeamMembership.event_id == event_id,
        )
    )
    team_id_val = syn_res.scalar_one_or_none()

    # Insert CC claim
    db.add(CorruptedClaim(
        contract_id=cc_id,
        operative_id=current_user.id,
        event_id=event_id,
        bc_awarded=bc_awarded,
    ))

    # Update user BC
    new_bc_total = (current_user.bc_total or 0) + bc_awarded
    current_user.bc_total = new_bc_total

    # BC event (goes to main board)
    db.add(BcEvent(
        operative_id=current_user.id,
        team_id=team_id_val,
        event_type=BcEventType.CONTRACT_CLAIMED,
        bc_delta=bc_awarded,
        bc_total_after=new_bc_total,
        contract_id=None,
        event_id=event_id,
    ))

    # Auto-close CC after first claim — race mechanic
    cc.status     = CCStatus.CLOSED
    cc.expires_at = datetime.utcnow()   # marks the effective close time for recent-close query

    # Broadcast win
    db.add(NetworkTransmission(
        content=f"CORRUPTED CONTRACT SEIZED — {current_user.username} extracted {bc_awarded} BC from [{cc.title}]",
        author_id=None,
    ))

    await db.commit()

    return {
        "correct":    True,
        "bc_awarded": bc_awarded,
        "message":    f"CONTRACT CLAIMED — {bc_awarded} BC CREDITED",
    }


# ---------------------------------------------------------------------------
# GET /user/{user_id} — CC claim history for a specific user
# ---------------------------------------------------------------------------

@router.get("/user/{user_id}")
async def get_user_cc_history(
    user_id: UUID,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    # Self, admin, contractor, or handler may view
    if (current_user.id != user_id and
            current_user.role not in (UserRole.ADMIN, UserRole.CONTRACTOR, UserRole.HANDLER)):
        raise HTTPException(status_code=403, detail="Forbidden")

    res = await db.execute(
        select(CorruptedClaim, CorruptedContract)
        .join(CorruptedContract, CorruptedContract.id == CorruptedClaim.contract_id)
        .where(CorruptedClaim.operative_id == user_id)
        .order_by(CorruptedClaim.claimed_at.desc())
    )
    return [
        {
            "contract_title": row[1].title,
            "category":       row[1].category,
            "bc_awarded":     row[0].bc_awarded,
            "claimed_at":     row[0].claimed_at.isoformat() + "Z",
        }
        for row in res.all()
    ]


# ---------------------------------------------------------------------------
# GET / — CC history for active event (Contractor / Admin)
# ---------------------------------------------------------------------------

@router.get("")
async def list_corrupted_contracts(
    org_id: Optional[int] = None,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    event_id = await get_current_event_id(db)
    scope = get_organization_scope(current_user, org_id)
    cc_list_q = (
        select(CorruptedContract)
        .where(CorruptedContract.event_id == event_id)
        .order_by(CorruptedContract.created_at.desc())
    )
    if scope is not None:
        cc_list_q = cc_list_q.where(CorruptedContract.org_id == scope)
    res = await db.execute(cc_list_q)
    contracts = res.scalars().all()

    if not contracts:
        return []

    cc_ids = [cc.id for cc in contracts]

    # Claim counts
    claim_count_res = await db.execute(
        select(CorruptedClaim.contract_id, func.count(CorruptedClaim.id))
        .where(CorruptedClaim.contract_id.in_(cc_ids))
        .group_by(CorruptedClaim.contract_id)
    )
    claim_counts = {str(r[0]): r[1] for r in claim_count_res.all()}

    # BC distributed
    bc_dist_res = await db.execute(
        select(CorruptedClaim.contract_id, func.sum(CorruptedClaim.bc_awarded))
        .where(CorruptedClaim.contract_id.in_(cc_ids))
        .group_by(CorruptedClaim.contract_id)
    )
    bc_distributed = {str(r[0]): r[1] for r in bc_dist_res.all()}

    return [
        {
            **_serialize(
                cc,
                claim_count=claim_counts.get(str(cc.id), 0),
                bc_distributed=bc_distributed.get(str(cc.id), 0),
            ),
            "bc_reward": cc.bc_reward,
        }
        for cc in contracts
    ]


# ---------------------------------------------------------------------------
# GET /{id}/claims — claim details for a specific CC (Contractor / Admin)
# ---------------------------------------------------------------------------

@router.get("/{cc_id}/claims")
async def get_cc_claims(
    cc_id: UUID,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(CorruptedContract).where(CorruptedContract.id == cc_id)
    )
    if not res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Contract not found")

    claims_res = await db.execute(
        select(CorruptedClaim, User.username)
        .join(User, CorruptedClaim.operative_id == User.id)
        .where(CorruptedClaim.contract_id == cc_id)
        .order_by(CorruptedClaim.claimed_at)
    )
    return [
        {
            "operative":  row[1],
            "bc_awarded": row[0].bc_awarded,
            "claimed_at": row[0].claimed_at.isoformat() + "Z",
        }
        for row in claims_res.all()
    ]


# ---------------------------------------------------------------------------
# POST /{id}/upload — attach file (Contractor only)
# ---------------------------------------------------------------------------

@router.post("/{cc_id}/upload")
async def upload_cc_attachment(
    cc_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(CorruptedContract).where(CorruptedContract.id == cc_id).with_for_update()
    )
    cc = res.scalar_one_or_none()
    if not cc:
        raise HTTPException(status_code=404, detail="Contract not found")
    if cc.status not in (CCStatus.DRAFT, CCStatus.ACTIVE):
        raise HTTPException(status_code=422, detail="Cannot attach file to a resolved contract")

    # Validate extension
    original_name = file.filename or "file"
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in CC_ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"File type not allowed: {ext}")

    contents = await file.read()
    if len(contents) > CC_MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")

    # Total storage guard (200MB)
    current_total = _total_cc_storage()
    existing_size = cc.attachment_size or 0
    if (current_total - existing_size + len(contents)) > CC_MAX_TOTAL:
        raise HTTPException(
            status_code=413,
            detail="STORAGE LIMIT REACHED — Delete existing CC files to upload new ones",
        )

    # Remove old file if replacing
    if cc.attachment_path and os.path.isfile(cc.attachment_path):
        try:
            os.remove(cc.attachment_path)
        except OSError:
            pass

    # Write new file
    safe_name   = _sanitize_filename(original_name)
    stored_name = f"cc_{cc_id}_{safe_name}"
    dir_path    = _cc_dir(cc_id)
    os.makedirs(dir_path, exist_ok=True)
    full_path   = os.path.join(dir_path, stored_name)

    with open(full_path, "wb") as f:
        f.write(contents)

    cc.has_attachment      = True
    cc.attachment_filename = safe_name
    cc.attachment_path     = full_path
    cc.attachment_size     = len(contents)

    await db.commit()
    return {
        "filename": safe_name,
        "size":     len(contents),
    }


# ---------------------------------------------------------------------------
# GET /{id}/download — download file (any authenticated user)
# ---------------------------------------------------------------------------

@router.get("/{cc_id}/download")
async def download_cc_attachment(
    cc_id: UUID,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    # Rate limit: 10/min per user
    if not await check_cc_download_rate_limit(str(current_user.id)):
        raise HTTPException(status_code=429, detail="TOO_MANY_DOWNLOADS")

    res = await db.execute(
        select(CorruptedContract).where(CorruptedContract.id == cc_id)
    )
    cc = res.scalar_one_or_none()
    if not cc:
        raise HTTPException(status_code=404, detail="Contract not found")

    if not cc.has_attachment or not cc.attachment_path:
        raise HTTPException(status_code=404, detail="No attachment on this contract")

    if cc.status not in (CCStatus.ACTIVE,):
        raise HTTPException(status_code=403, detail="SIGNAL LOST — FILE UNAVAILABLE")

    if not os.path.isfile(cc.attachment_path):
        raise HTTPException(status_code=404, detail="File not found on server")

    return FileResponse(
        path=cc.attachment_path,
        filename=cc.attachment_filename or "challenge_file",
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{cc.attachment_filename}"'},
    )


# ---------------------------------------------------------------------------
# DELETE /{id}/attachment — remove attachment (Contractor/Admin)
# ---------------------------------------------------------------------------

@router.delete("/{cc_id}/attachment")
async def delete_cc_attachment(
    cc_id: UUID,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(CorruptedContract).where(CorruptedContract.id == cc_id).with_for_update()
    )
    cc = res.scalar_one_or_none()
    if not cc:
        raise HTTPException(status_code=404, detail="Contract not found")
    if not cc.has_attachment:
        raise HTTPException(status_code=404, detail="No attachment to delete")

    if cc.attachment_path and os.path.isfile(cc.attachment_path):
        try:
            os.remove(cc.attachment_path)
            # Clean up empty dir
            dir_path = _cc_dir(cc_id)
            if os.path.isdir(dir_path) and not os.listdir(dir_path):
                shutil.rmtree(dir_path, ignore_errors=True)
        except OSError:
            pass

    cc.has_attachment      = False
    cc.attachment_filename = None
    cc.attachment_path     = None
    cc.attachment_size     = None

    await db.commit()
    return {"ok": True}
