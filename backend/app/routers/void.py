"""
VO1D — Secret parallel layer of DEADNET.
Not linked from any UI. Not documented publicly.
Discovery is the challenge.
"""
import base64
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models.contract import Contract, VoidAttempt, VoidClaim
from app.models.team import Team, TeamMembership
from app.models.user import User
from app.redis_client import refresh_void_session, set_void_session
from app.utils.event import get_current_event_id
from app.utils.security import constant_time_compare

router = APIRouter()

_VOID_BC = 500
_MAX_ATTEMPTS = 5


# ---------------------------------------------------------------------------
# POST /v01d/authorize — called by terminal before redirecting to VoidBoard
# Opens a 10-minute Redis session gate for the user
# ---------------------------------------------------------------------------

@router.post("/authorize")
async def void_authorize(current_user: User = Depends(get_current_user)):
    user_id = "ARCHITECT" if current_user.role.value == "ARCHITECT" else str(current_user.id)
    await set_void_session(user_id)
    return {"authorized": True}


# ---------------------------------------------------------------------------
# GET /v01d/verify — called by VoidBoard on mount and every 5 min to refresh gate
# ---------------------------------------------------------------------------

@router.get("/verify")
async def void_verify(current_user: User = Depends(get_current_user)):
    # Architect always has access
    if current_user.role.value == "ARCHITECT":
        return {"authorized": True}
    user_id = str(current_user.id)
    exists = await refresh_void_session(user_id)
    if not exists:
        raise HTTPException(status_code=404, detail="Not found")
    return {"authorized": True}


# ---------------------------------------------------------------------------
# GET /v01d/signal — hidden endpoint for CONTRACT 1 (SHELL IN THE GHOST)
# Flag is base64-encoded in the X-V01D-SIGNAL response header
# ---------------------------------------------------------------------------

@router.get("/signal")
async def void_signal(current_user: User = Depends(get_current_user)):
    flag_b64 = base64.b64encode(b"V01D{s0L_h34d3r_w4s_h3r3}").decode()
    return JSONResponse(
        content={"status": "noise"},
        headers={"X-V01D-SIGNAL": flag_b64},
    )


# ---------------------------------------------------------------------------
# GET /v01d/contracts — list published VO1D contracts (auth required)
# ---------------------------------------------------------------------------

@router.get("/contracts")
async def list_void_contracts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Contract)
        .where(Contract.is_void.is_(True), Contract.is_published.is_(True))
        .order_by(Contract.created_at)
    )
    contracts = result.scalars().all()

    # Which ones has this user already claimed?
    claimed_result = await db.execute(
        select(VoidClaim.contract_id).where(VoidClaim.operative_id == current_user.id)
    )
    claimed_ids = {str(r) for r in claimed_result.scalars().all()}

    # Attempt counts for this user per contract
    attempts_result = await db.execute(
        select(VoidAttempt.contract_id, VoidAttempt.attempts)
        .where(VoidAttempt.operative_id == current_user.id)
    )
    attempts_map = {str(r[0]): r[1] for r in attempts_result.all()}

    return [
        {
            "id": str(c.id),
            "title": c.title,
            "description": c.description,
            "bc_value": _VOID_BC,
            "is_claimed": str(c.id) in claimed_ids,
            "attempts": attempts_map.get(str(c.id), 0),
            "locked": (
                attempts_map.get(str(c.id), 0) >= _MAX_ATTEMPTS
                and str(c.id) not in claimed_ids
            ),
        }
        for c in contracts
    ]


# ---------------------------------------------------------------------------
# POST /v01d/contracts/{id}/claim — claim a VO1D contract
# ---------------------------------------------------------------------------

@router.post("/contracts/{contract_id}/claim")
async def claim_void_contract(
    contract_id: UUID,
    body: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Only OPERATIVEs can claim
    if current_user.role.value not in ("OPERATIVE",):
        raise HTTPException(status_code=403, detail="Only Operatives can claim contracts.")

    # Fetch contract
    result = await db.execute(
        select(Contract).where(
            Contract.id == contract_id,
            Contract.is_void.is_(True),
            Contract.is_published.is_(True),
        )
    )
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found.")

    # Already claimed?
    existing = await db.execute(
        select(VoidClaim).where(
            VoidClaim.contract_id == contract_id,
            VoidClaim.operative_id == current_user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Already claimed.")

    # Get or create attempt record (with row lock to prevent races)
    attempt_result = await db.execute(
        select(VoidAttempt).where(
            VoidAttempt.contract_id == contract_id,
            VoidAttempt.operative_id == current_user.id,
        ).with_for_update()
    )
    attempt_row = attempt_result.scalar_one_or_none()
    if attempt_row is None:
        attempt_row = VoidAttempt(
            contract_id=contract_id,
            operative_id=current_user.id,
            attempts=0,
        )
        db.add(attempt_row)
        await db.flush()

    # Hard attempt limit
    if attempt_row.attempts >= _MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="VOID CONTRACT LOCKED — SIGNAL LOST",
        )

    # Flag check
    flag = (body.get("flag") or "").strip()
    if not constant_time_compare(flag, contract.flag):
        attempt_row.attempts += 1
        await db.commit()
        # Return attempts count so the frontend can update its counter
        return JSONResponse(
            status_code=400,
            content={
                "detail": "Incorrect flag.",
                "attempts": attempt_row.attempts,
            },
        )

    # Correct flag — find team membership scoped to the current event
    current_event_id = await get_current_event_id(db)
    mem_q = (
        select(TeamMembership)
        .join(Team, Team.id == TeamMembership.team_id)
        .where(TeamMembership.operative_id == current_user.id)
    )
    if current_event_id is not None:
        mem_q = mem_q.where(Team.event_id == current_event_id)
    mem_result = await db.execute(mem_q)
    membership = mem_result.scalars().first()
    team_id = membership.team_id if membership else None

    # Record claim
    db.add(VoidClaim(
        contract_id=contract_id,
        operative_id=current_user.id,
        team_id=team_id,
    ))

    # Update user bc_total (void is now regular BC) + mark void_access
    result_u = await db.execute(
        select(User).where(User.id == current_user.id).with_for_update()
    )
    user = result_u.scalar_one()
    user.bc_total = (user.bc_total or 0) + _VOID_BC
    if not user.void_access:
        user.void_access = True

    await db.commit()

    return {
        "message": "VO1D CONTRACT CLAIMED.",
        "bc_earned": _VOID_BC,
        "void_access": True,
    }


# ---------------------------------------------------------------------------
# GET /v01d/contracts/{id}/intel — always returns broker denial message
# ---------------------------------------------------------------------------

@router.get("/contracts/{contract_id}/intel")
async def void_intel(
    contract_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Contract).where(Contract.id == contract_id, Contract.is_void.is_(True))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Contract not found.")
    return {
        "drops": [],
        "broker_message": "THE BROKER: I don't know what you're talking about, Operative.",
    }


# ---------------------------------------------------------------------------
# Admin — overview
# ---------------------------------------------------------------------------

@router.get("/admin/overview")
async def void_admin_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role.value != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin only.")

    total_claims_result = await db.execute(select(func.count(VoidClaim.id)))
    total_claims = total_claims_result.scalar_one() or 0

    access_count_result = await db.execute(
        select(func.count(User.id)).where(User.void_access.is_(True))
    )
    access_count = access_count_result.scalar_one() or 0

    locked_count_result = await db.execute(
        select(func.count(VoidAttempt.id)).where(VoidAttempt.attempts >= _MAX_ATTEMPTS)
    )
    locked_count = locked_count_result.scalar_one() or 0

    return {
        "total_void_bc_distributed": total_claims * _VOID_BC,
        "total_void_claims": total_claims,
        "operatives_with_access": access_count,
        "locked_operatives": locked_count,
    }


# ---------------------------------------------------------------------------
# Admin — contracts list with claim details + locked operators
# ---------------------------------------------------------------------------

@router.get("/admin/contracts")
async def void_admin_contracts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role.value != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin only.")

    contracts_result = await db.execute(
        select(Contract).where(Contract.is_void.is_(True)).order_by(Contract.created_at)
    )
    contracts = contracts_result.scalars().all()

    # All successful claims with solvers
    claims_result = await db.execute(
        select(VoidClaim, User.username)
        .join(User, VoidClaim.operative_id == User.id)
        .order_by(VoidClaim.claimed_at.desc())
    )
    claims_by_contract: dict[str, list] = {}
    claimed_operative_ids: dict[str, set] = {}
    for claim, username in claims_result.all():
        cid = str(claim.contract_id)
        nid = str(claim.operative_id)
        claims_by_contract.setdefault(cid, []).append({
            "operative_id": nid,
            "callsign": username,
            "claimed_at": claim.claimed_at.isoformat(),
            "attempts": 0,  # filled in below
        })
        claimed_operative_ids.setdefault(cid, set()).add(nid)

    # All void attempt rows (wrong guesses)
    attempts_result = await db.execute(
        select(
            VoidAttempt.contract_id,
            VoidAttempt.operative_id,
            VoidAttempt.attempts,
            User.username,
        ).join(User, VoidAttempt.operative_id == User.id)
    )
    attempts_rows = attempts_result.all()

    # Build attempt map and identify locked-but-unclaimed operators
    attempts_map: dict[tuple, int] = {}
    locked_per_contract: dict[str, list] = {}
    for cid, nid, att, uname in attempts_rows:
        cid_str, nid_str = str(cid), str(nid)
        attempts_map[(cid_str, nid_str)] = att
        if att >= _MAX_ATTEMPTS and nid_str not in claimed_operative_ids.get(cid_str, set()):
            locked_per_contract.setdefault(cid_str, []).append({
                "operative_id": nid_str,
                "callsign": uname,
                "attempts": att,
            })

    # Attach attempt count to each successful claim row
    for cid, claim_list in claims_by_contract.items():
        for cl in claim_list:
            cl["attempts"] = attempts_map.get((cid, cl["operative_id"]), 0)

    claim_counts = {cid: len(v) for cid, v in claims_by_contract.items()}

    return [
        {
            "id": str(c.id),
            "title": c.title,
            "is_published": c.is_published,
            "claim_count": claim_counts.get(str(c.id), 0),
            "claims": claims_by_contract.get(str(c.id), []),
            "locked_operatives": locked_per_contract.get(str(c.id), []),
        }
        for c in contracts
    ]


# ---------------------------------------------------------------------------
# Admin — toggle contract published state
# ---------------------------------------------------------------------------

@router.patch("/admin/contracts/{contract_id}/toggle")
async def void_admin_toggle(
    contract_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role.value != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin only.")

    result = await db.execute(
        select(Contract).where(
            Contract.id == contract_id, Contract.is_void.is_(True)
        ).with_for_update()
    )
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="VO1D contract not found.")

    contract.is_published = not contract.is_published
    await db.commit()
    return {"id": str(contract.id), "is_published": contract.is_published}


# ---------------------------------------------------------------------------
# Admin — reset void attempt count for a specific operative + contract
# ---------------------------------------------------------------------------

@router.delete("/admin/attempts/{operative_id}/{contract_id}")
async def void_admin_reset_attempts(
    operative_id: UUID,
    contract_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Wipe the attempt record so a locked operative can try again."""
    if current_user.role.value != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin only.")

    result = await db.execute(
        select(VoidAttempt).where(
            VoidAttempt.operative_id == operative_id,
            VoidAttempt.contract_id == contract_id,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()
    return {"reset": True}


# ---------------------------------------------------------------------------
# Admin — operatives with void access
# ---------------------------------------------------------------------------

@router.get("/admin/operatives")
async def void_admin_operatives(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role.value != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin only.")

    result = await db.execute(
        select(User).where(User.void_access.is_(True)).order_by(User.void_bc.desc())
    )
    users = result.scalars().all()

    counts_result = await db.execute(
        select(VoidClaim.operative_id, func.count(VoidClaim.id)).group_by(VoidClaim.operative_id)
    )
    claim_counts = {str(r[0]): r[1] for r in counts_result.all()}

    first_result = await db.execute(
        select(VoidClaim.operative_id, func.min(VoidClaim.claimed_at)).group_by(VoidClaim.operative_id)
    )
    first_access = {str(r[0]): r[1] for r in first_result.all()}

    return [
        {
            "id": str(u.id),
            "callsign": u.username,
            "void_bc": u.void_bc,
            "contracts_solved": claim_counts.get(str(u.id), 0),
            "first_access": first_access.get(str(u.id), None),
        }
        for u in users
    ]
