from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_authenticated
from app.models.contract import Claim, Contract
from app.models.settings import PlatformSettings
from app.models.team import Team, TeamMembership
from app.models.user import User, UserRole
from app.utils.clearance import get_clearance_level
from app.utils.event import get_active_event

router = APIRouter()


async def _get_cl_settings(db: AsyncSession) -> dict:
    result = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key.like("cl_%"))
    )
    return {row.key: row.value for row in result.scalars().all()}


# ---------------------------------------------------------------------------
# GET /operatives/  — list all operatives (all authenticated)
# ---------------------------------------------------------------------------

@router.get("/")
async def list_operatives(
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .where(User.role == UserRole.OPERATIVE, User.is_banned == False)
        .order_by(User.bc_total.desc())
    )
    runners = result.scalars().all()
    cl_settings = await _get_cl_settings(db)

    return [
        {
            "id": str(r.id),
            "username": r.username,
            "bc_total": r.bc_total or 0,
            "clearance_level": get_clearance_level(r.bc_total or 0, cl_settings),
        }
        for r in runners
    ]


# ---------------------------------------------------------------------------
# GET /operatives/{id}  — operative profile (all authenticated)
# ---------------------------------------------------------------------------

@router.get("/{operative_id}")
async def get_operative_profile(
    operative_id: UUID,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.id == operative_id, User.role == UserRole.OPERATIVE)
    )
    runner = result.scalar_one_or_none()
    if not runner:
        raise HTTPException(status_code=404, detail="Operative not found")

    cl_settings = await _get_cl_settings(db)

    # Rank — how many operatives have more BC?
    rank_result = await db.execute(
        select(func.count(User.id)).where(
            User.role == UserRole.OPERATIVE,
            User.bc_total > (runner.bc_total or 0),
            User.is_banned == False,
        )
    )
    rank = (rank_result.scalar() or 0) + 1

    # Claim history with contract info
    claims_result = await db.execute(
        select(Claim, Contract)
        .join(Contract, Contract.id == Claim.contract_id)
        .where(Claim.operative_id == operative_id)
        .order_by(Claim.claimed_at.desc())
    )
    raw_claims = claims_result.all()

    claims = [
        {
            "contract_id": str(cl.id),
            "contract_title": ct.title,
            "contract_category": ct.category,
            "contract_rarity": ct.rarity,
            "bc_earned": cl.bc_earned,
            "is_first_blood": cl.is_first_blood,
            "claimed_at": cl.claimed_at,
        }
        for cl, ct in raw_claims
    ]

    # Category stats for radar chart
    # Count claims per category from actual solved contracts
    claim_counts_raw: dict[str, int] = {}
    for cl, ct in raw_claims:
        claim_counts_raw[ct.category.value] = claim_counts_raw.get(ct.category.value, 0) + 1

    # Use current event's allowed_categories if set; otherwise only show categories with >0 claims
    active_event = await get_active_event(db)
    allowed = active_event.allowed_categories if active_event and active_event.allowed_categories else None

    if allowed:
        radar_data = [
            {"category": cat, "count": claim_counts_raw.get(cat, 0)}
            for cat in allowed
        ]
    else:
        radar_data = [
            {"category": cat, "count": cnt}
            for cat, cnt in claim_counts_raw.items()
        ]

    # Team membership — scope to current active event to avoid MultipleResultsFound
    from app.models.event import EventStatus as ES  # noqa
    event_id_for_team = active_event.id if active_event else None
    team_q = (
        select(TeamMembership, Team)
        .join(Team, Team.id == TeamMembership.team_id)
        .where(TeamMembership.operative_id == operative_id)
    )
    if event_id_for_team:
        team_q = team_q.where(Team.event_id == event_id_for_team)
    mem_result = await db.execute(team_q)
    mem_row = mem_result.first()
    team_info = None
    if mem_row:
        mem, syn = mem_row
        team_info = {
            "id": str(syn.id),
            "name": syn.name,
            "is_captain": str(syn.captain_id) == str(operative_id),
        }

    # VO1D fields — visible to the Operative themselves + Admin only
    is_self = str(current_user.id) == str(operative_id)
    is_admin = current_user.role.value == "ADMIN"
    bc_total = runner.bc_total or 0

    response: dict = {
        "id": str(runner.id),
        "username": runner.username,
        "bc_total": bc_total,
        "clearance_level": get_clearance_level(bc_total, cl_settings),
        "rank": rank,
        "claim_count": len(claims),
        "claims": claims,
        "radar_data": radar_data,
        "team": team_info,
    }

    if is_self or is_admin:
        response["void_access"] = runner.void_access or False

    return response
