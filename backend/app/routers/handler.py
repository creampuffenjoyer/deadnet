from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_handler
from app.models.team import Team, TeamMembership
from app.models.user import User, UserRole
from app.redis_client import is_online
from app.utils.clearance import get_clearance_level
from app.models.settings import PlatformSettings
from app.utils.roles import get_organization_scope

router = APIRouter()


async def _get_cl_settings(db: AsyncSession) -> dict:
    result = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key.like("cl_%"))
    )
    return {row.key: row.value for row in result.scalars().all()}


@router.get("/ping")
async def ping(_user: User = Depends(require_handler)):
    return {"status": "handler online"}


# ---------------------------------------------------------------------------
# GET /handler/my-operatives  — assigned operatives only (403 otherwise)
# ---------------------------------------------------------------------------

@router.get("/my-operatives")
async def my_operatives(
    current_user: User = Depends(require_handler),
    db: AsyncSession = Depends(get_db),
):
    scope = get_organization_scope(current_user)
    q = select(User).where(User.role == UserRole.OPERATIVE, User.is_banned == False)
    if scope is not None:
        q = q.where(User.org_id == scope)
    q = q.order_by(User.bc_total.desc())
    result = await db.execute(q)
    runners = result.scalars().all()

    cl_settings = await _get_cl_settings(db)

    rows = []
    for r in runners:
        try:
            online = await is_online(str(r.id))
        except Exception:
            online = False
        rows.append({
            "id": str(r.id),
            "username": r.username,
            "bc_total": r.bc_total or 0,
            "clearance_level": get_clearance_level(r.bc_total or 0, cl_settings),
            "is_online": online,
        })
    return rows


# ---------------------------------------------------------------------------
# GET /handler/my-teams  — assigned teams only (403 otherwise)
# ---------------------------------------------------------------------------

@router.get("/my-teams")
async def my_teams(
    current_user: User = Depends(require_handler),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import func
    from app.models.contract import Claim

    scope = get_organization_scope(current_user)
    team_q = select(Team).order_by(Team.name)
    if scope is not None:
        team_q = team_q.where(Team.org_id == scope)
    result = await db.execute(team_q)
    teams = result.scalars().all()

    # Member counts
    mem_result = await db.execute(
        select(TeamMembership.team_id, func.count(TeamMembership.id))
        .group_by(TeamMembership.team_id)
    )
    member_counts = {str(r[0]): r[1] for r in mem_result.all()}

    # BC per team
    bc_result = await db.execute(
        select(Claim.team_id, func.sum(Claim.bc_earned))
        .where(Claim.team_id.isnot(None))
        .group_by(Claim.team_id)
    )
    team_bc = {str(r[0]): int(r[1]) for r in bc_result.all()}

    return [
        {
            "id": str(s.id),
            "name": s.name,
            "member_count": member_counts.get(str(s.id), 0),
            "total_bc": team_bc.get(str(s.id), 0),
        }
        for s in teams
    ]
