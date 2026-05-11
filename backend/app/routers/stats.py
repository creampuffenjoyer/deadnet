from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_authenticated
from app.models.contract import Claim, Contract, ContractAttempt, IntelPurchase
from app.models.settings import PlatformSettings
from app.models.team import Team
from app.models.user import User, UserRole
from app.utils.clearance import get_clearance_level
from app.utils.event import get_current_event_id
from app.utils.roles import get_organization_scope

router = APIRouter()


async def _get_settings(db: AsyncSession) -> dict:
    result = await db.execute(select(PlatformSettings))
    return {row.key: row.value for row in result.scalars().all()}


@router.get("/")
async def get_stats(
    event_id: Optional[int] = None,
    org_id: Optional[int] = None,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == UserRole.OPERATIVE:
        raise HTTPException(status_code=403, detail="STATS_UNAVAILABLE")

    current_sid = await get_current_event_id(db)
    target_sid = event_id if event_id is not None else current_sid

    settings = await _get_settings(db)
    scope = get_organization_scope(current_user, org_id)

    cl_settings = {k: v for k, v in settings.items() if k.startswith("cl_")}

    # ── OVERVIEW ─────────────────────────────────────────────────────────────

    total_bc_q = select(func.sum(Claim.bc_earned)).where(Claim.event_id == target_sid)
    if scope is not None:
        total_bc_q = total_bc_q.join(User, User.id == Claim.operative_id).where(User.org_id == scope)
    total_bc_row = await db.execute(total_bc_q)
    total_bc = int(total_bc_row.scalar() or 0)

    total_claims_q = select(func.count(Claim.id)).where(Claim.event_id == target_sid)
    if scope is not None:
        total_claims_q = total_claims_q.join(User, User.id == Claim.operative_id).where(User.org_id == scope)
    total_claims_row = await db.execute(total_claims_q)
    total_claims = int(total_claims_row.scalar() or 0)

    unique_solvers_q = select(func.count(func.distinct(Claim.operative_id))).where(Claim.event_id == target_sid)
    if scope is not None:
        unique_solvers_q = unique_solvers_q.join(User, User.id == Claim.operative_id).where(User.org_id == scope)
    unique_solvers_row = await db.execute(unique_solvers_q)
    unique_solvers = int(unique_solvers_row.scalar() or 0)

    total_intel_q = select(func.count(IntelPurchase.id)).where(IntelPurchase.event_id == target_sid)
    if scope is not None:
        total_intel_q = total_intel_q.join(User, User.id == IntelPurchase.operative_id).where(User.org_id == scope)
    total_intel_row = await db.execute(total_intel_q)
    total_intel_purchases = int(total_intel_row.scalar() or 0)

    # Most active category (event-filtered)
    cat_q = (
        select(Contract.category, func.count(Claim.id).label("cnt"))
        .join(Claim, Claim.contract_id == Contract.id)
        .where(Claim.event_id == target_sid)
        .group_by(Contract.category)
        .order_by(func.count(Claim.id).desc())
        .limit(1)
    )
    if scope is not None:
        cat_q = cat_q.where(Contract.org_id == scope)
    cat_result = await db.execute(cat_q)
    cat_row = cat_result.first()
    most_active_category = cat_row[0] if cat_row else None

    # Hardest contract: fewest solves, highest total attempts (event-filtered)
    hard_q = (
        select(
            Contract.id,
            Contract.title,
            Contract.category,
            func.count(Claim.id).label("solve_count"),
            func.coalesce(func.sum(ContractAttempt.attempt_count), 0).label("total_attempts"),
        )
        .outerjoin(Claim, (Claim.contract_id == Contract.id) & (Claim.event_id == target_sid))
        .outerjoin(ContractAttempt, ContractAttempt.contract_id == Contract.id)
        .where(Contract.is_published == True, Contract.event_id == target_sid)
        .group_by(Contract.id, Contract.title, Contract.category)
        .order_by(func.count(Claim.id).asc(), func.coalesce(func.sum(ContractAttempt.attempt_count), 0).desc())
        .limit(1)
    )
    if scope is not None:
        hard_q = hard_q.where(Contract.org_id == scope)
    hard_result = await db.execute(hard_q)
    hard_row = hard_result.first()
    hardest_contract = None
    if hard_row:
        hardest_contract = {
            "id": str(hard_row[0]),
            "title": hard_row[1],
            "category": hard_row[2],
            "solve_count": hard_row[3],
            "total_attempts": hard_row[4],
        }

    # Easiest contract: most solves, lowest total attempts (event-filtered)
    easy_q = (
        select(
            Contract.id,
            Contract.title,
            Contract.category,
            func.count(Claim.id).label("solve_count"),
            func.coalesce(func.sum(ContractAttempt.attempt_count), 0).label("total_attempts"),
        )
        .outerjoin(Claim, (Claim.contract_id == Contract.id) & (Claim.event_id == target_sid))
        .outerjoin(ContractAttempt, ContractAttempt.contract_id == Contract.id)
        .where(Contract.is_published == True, Contract.event_id == target_sid)
        .having(func.count(Claim.id) > 0)
        .group_by(Contract.id, Contract.title, Contract.category)
        .order_by(func.count(Claim.id).desc(), func.coalesce(func.sum(ContractAttempt.attempt_count), 0).asc())
        .limit(1)
    )
    if scope is not None:
        easy_q = easy_q.where(Contract.org_id == scope)
    easy_result = await db.execute(easy_q)
    easy_row = easy_result.first()
    easiest_contract = None
    if easy_row:
        easiest_contract = {
            "id": str(easy_row[0]),
            "title": easy_row[1],
            "category": easy_row[2],
            "solve_count": easy_row[3],
            "total_attempts": easy_row[4],
        }

    # Fastest solve: time from competition_start to first claim
    start_str = settings.get("competition_start", "")
    fastest_solve = None
    fastest_q = (
        select(Claim, Contract, User)
        .join(Contract, Contract.id == Claim.contract_id)
        .join(User, User.id == Claim.operative_id)
        .where(Claim.is_first_blood == True, Claim.event_id == target_sid)
        .order_by(Claim.claimed_at.asc())
        .limit(1)
    )
    if scope is not None:
        fastest_q = fastest_q.where(User.org_id == scope)
    first_claim_result = await db.execute(fastest_q)
    first_claim_row = first_claim_result.first()
    if first_claim_row:
        cl, ct, u = first_claim_row
        elapsed = None
        if start_str:
            try:
                start_dt = datetime.fromisoformat(start_str)
                elapsed_secs = int((cl.claimed_at - start_dt).total_seconds())
                mins, secs = divmod(elapsed_secs, 60)
                elapsed = f"{mins}m {secs}s"
            except (ValueError, TypeError):
                pass
        fastest_solve = {
            "operative_username": u.username,
            "contract_title": ct.title,
            "claimed_at": cl.claimed_at,
            "elapsed": elapsed,
        }

    # ── TOP PERFORMERS ────────────────────────────────────────────────────────

    # First blood hall (event-filtered)
    fb_q = (
        select(Claim, Contract, User)
        .join(Contract, Contract.id == Claim.contract_id)
        .join(User, User.id == Claim.operative_id)
        .where(Claim.is_first_blood == True, Claim.event_id == target_sid)
        .order_by(Claim.claimed_at.asc())
    )
    if scope is not None:
        fb_q = fb_q.where(User.org_id == scope)
    fb_result = await db.execute(fb_q)
    first_blood_hall = [
        {
            "operative_username": u.username,
            "contract_title": ct.title,
            "bc_earned": cl.bc_earned,
            "claimed_at": cl.claimed_at,
        }
        for cl, ct, u in fb_result.all()
    ]

    # Top 5 by contracts claimed (event-filtered)
    top_claims_q = (
        select(User.id, User.username, func.count(Claim.id).label("cnt"))
        .join(Claim, (Claim.operative_id == User.id) & (Claim.event_id == target_sid))
        .group_by(User.id, User.username)
        .order_by(func.count(Claim.id).desc())
        .limit(5)
    )
    if scope is not None:
        top_claims_q = top_claims_q.where(User.org_id == scope)
    top_claims_result = await db.execute(top_claims_q)
    top_by_contracts = [
        {"username": r[1], "claim_count": r[2]}
        for r in top_claims_result.all()
    ]

    # Top 5 by BC earned
    top_bc_q = select(User).where(User.role == UserRole.OPERATIVE, User.is_banned == False).order_by(User.bc_total.desc()).limit(5)
    if scope is not None:
        top_bc_q = top_bc_q.where(User.org_id == scope)
    top_bc_result = await db.execute(top_bc_q)
    top_by_bc = [
        {
            "username": u.username,
            "bc_total": u.bc_total or 0,
            "clearance_level": get_clearance_level(u.bc_total or 0, cl_settings),
        }
        for u in top_bc_result.scalars().all()
    ]

    # ── CATEGORY BREAKDOWN ────────────────────────────────────────────────────

    cat_breakdown_q = (
        select(
            Contract.category,
            func.count(Claim.id).label("claim_count"),
            func.coalesce(func.avg(Claim.bc_earned), 0).label("avg_bc"),
        )
        .outerjoin(Claim, (Claim.contract_id == Contract.id) & (Claim.event_id == target_sid))
        .where(Contract.is_published == True, Contract.event_id == target_sid)
        .group_by(Contract.category)
        .order_by(func.count(Claim.id).desc())
    )
    if scope is not None:
        cat_breakdown_q = cat_breakdown_q.where(Contract.org_id == scope)
    cat_breakdown_result = await db.execute(cat_breakdown_q)
    category_breakdown = [
        {
            "category": r[0],
            "claim_count": r[1],
            "avg_bc_earned": round(float(r[2]), 1),
        }
        for r in cat_breakdown_result.all()
    ]

    return {
        "overview": {
            "total_bc_distributed": total_bc,
            "total_claims": total_claims,
            "unique_solvers": unique_solvers,
            "most_active_category": most_active_category,
            "hardest_contract": hardest_contract,
            "easiest_contract": easiest_contract,
            "fastest_solve": fastest_solve,
            "total_intel_purchases": total_intel_purchases,
        },
        "top_performers": {
            "first_blood_hall": first_blood_hall,
            "top_by_contracts": top_by_contracts,
            "top_by_bc": top_by_bc,
        },
        "category_breakdown": category_breakdown,
    }
