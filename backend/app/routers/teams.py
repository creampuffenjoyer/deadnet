from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_authenticated, require_operative
from app.models.contract import Claim, Contract
from app.models.event import Event, EventStatus
from app.models.settings import PlatformSettings
from app.models.team import ContractAssignment, Team, TeamMembership
from app.models.user import User
from app.utils.event import get_current_event_id
from app.utils.roles import get_organization_scope

router = APIRouter()


class CreateTeamRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=100)


class JoinTeamRequest(BaseModel):
    invite_code: str


class TransferRequest(BaseModel):
    new_captain_id: UUID


class AssignContractRequest(BaseModel):
    contract_id: UUID
    assigned_to_id: UUID


class BookmarkRequest(BaseModel):
    contract_id: UUID


async def _require_event_open_for_teams(db: AsyncSession) -> int:
    """
    Verify that team creation/joining is allowed given the current event state.
    Returns the event_id to tag the new team/membership with.
    Raises HTTPException if no event is active/open.
    """
    # Check ACTIVE event first
    active = (await db.execute(
        select(Event)
        .where(Event.status == EventStatus.ACTIVE.value)
        .order_by(Event.id.desc()).limit(1)
    )).scalar_one_or_none()
    if active:
        return active.id

    # Check UPCOMING event with registration open
    upcoming = (await db.execute(
        select(Event)
        .where(Event.status == EventStatus.UPCOMING.value)
        .order_by(Event.id.desc()).limit(1)
    )).scalar_one_or_none()
    if upcoming:
        if not upcoming.registration_open:
            raise HTTPException(status_code=403, detail="REGISTRATION_CLOSED")
        return upcoming.id

    raise HTTPException(status_code=403, detail="NO_ACTIVE_EVENT")


async def _get_team_settings(db: AsyncSession) -> dict:
    """Fetch team-relevant platform settings."""
    result = await db.execute(
        select(PlatformSettings).where(
            PlatformSettings.key.in_(["team_registration_open", "max_team_size"])
        )
    )
    return {row.key: row.value for row in result.scalars().all()}


async def _get_my_team(operative_id: UUID, event_id: int, db: AsyncSession):
    """Return (TeamMembership, Team) or (None, None) for the given event."""
    result = await db.execute(
        select(TeamMembership)
        .where(
            TeamMembership.operative_id == operative_id,
            TeamMembership.event_id == event_id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        return None, None
    syn_result = await db.execute(
        select(Team).where(Team.id == membership.team_id)
    )
    return membership, syn_result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# GET /teams/  — list all teams
# ---------------------------------------------------------------------------

@router.get("/")
async def list_teams(
    org_id: Optional[int] = None,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    event_id = await get_current_event_id(db)
    scope = get_organization_scope(current_user, org_id)
    syn_list_q = select(Team).where(Team.event_id == event_id).order_by(Team.name)
    if scope is not None:
        syn_list_q = syn_list_q.where(Team.org_id == scope)
    result = await db.execute(syn_list_q)
    teams = result.scalars().all()

    mem_result = await db.execute(
        select(TeamMembership.team_id, func.count(TeamMembership.id))
        .group_by(TeamMembership.team_id)
    )
    member_counts = {str(r[0]): r[1] for r in mem_result.all()}

    # Current user's team
    my_mem, _ = await _get_my_team(current_user.id, event_id, db)
    my_syn_id = str(my_mem.team_id) if my_mem else None

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
            "invite_code": s.invite_code if (my_syn_id == str(s.id)) else None,
            "captain_id": str(s.captain_id) if s.captain_id else None,
            "captain_school": captain_map[str(s.captain_id)].school if s.captain_id and str(s.captain_id) in captain_map else None,
            "captain_section": captain_map[str(s.captain_id)].section if s.captain_id and str(s.captain_id) in captain_map else None,
            "member_count": member_counts.get(str(s.id), 0),
            "is_mine": my_syn_id == str(s.id),
            "created_at": s.created_at,
        }
        for s in teams
    ]


# ---------------------------------------------------------------------------
# POST /teams/  — create a new team (OPERATIVE only)
# ---------------------------------------------------------------------------

@router.post("/", status_code=201)
async def create_team(
    body: CreateTeamRequest,
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    # Enforce event state (raises 403 if no ACTIVE/UPCOMING+reg_open event)
    event_id = await _require_event_open_for_teams(db)

    cfg = await _get_team_settings(db)
    if cfg.get("team_registration_open", "true").lower() != "true":
        raise HTTPException(status_code=403, detail="TEAM_REGISTRATION_CLOSED")

    # Must not already be in a team for this event
    existing_mem, _ = await _get_my_team(current_user.id, event_id, db)
    if existing_mem:
        raise HTTPException(status_code=400, detail="ALREADY_IN_TEAM")

    # Name must be unique within this event
    name_check = await db.execute(
        select(Team).where(Team.name == body.name, Team.event_id == event_id)
    )
    if name_check.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="NAME_TAKEN")
    team = Team(name=body.name, captain_id=current_user.id, event_id=event_id, org_id=getattr(current_user, "org_id", None))
    db.add(team)
    await db.flush()

    db.add(TeamMembership(
        team_id=team.id,
        operative_id=current_user.id,
        event_id=event_id,
    ))
    await db.commit()

    return {
        "id": str(team.id),
        "name": team.name,
        "invite_code": team.invite_code,
        "message": "Team created",
    }


# ---------------------------------------------------------------------------
# POST /teams/join  — join via invite code (OPERATIVE only)
# ---------------------------------------------------------------------------

@router.post("/join")
async def join_team(
    body: JoinTeamRequest,
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    # Enforce event state (raises 403 if no ACTIVE/UPCOMING+reg_open event)
    event_id = await _require_event_open_for_teams(db)

    cfg = await _get_team_settings(db)
    if cfg.get("team_registration_open", "true").lower() != "true":
        raise HTTPException(status_code=403, detail="TEAM_REGISTRATION_CLOSED")

    existing_mem, _ = await _get_my_team(current_user.id, event_id, db)
    if existing_mem:
        raise HTTPException(status_code=400, detail="ALREADY_IN_TEAM")

    result = await db.execute(
        select(Team).where(Team.invite_code == body.invite_code.upper())
    )
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="INVALID_INVITE_CODE")

    # Enforce max team size
    max_size_str = cfg.get("max_team_size", "0")
    max_size = int(max_size_str) if max_size_str.isdigit() else 0
    if max_size > 0:
        count_result = await db.execute(
            select(func.count(TeamMembership.id))
            .where(TeamMembership.team_id == team.id)
        )
        current_size = count_result.scalar() or 0
        if current_size >= max_size:
            raise HTTPException(status_code=400, detail="TEAM_FULL")

    db.add(TeamMembership(
        team_id=team.id,
        operative_id=current_user.id,
        event_id=event_id,
    ))
    await db.commit()

    return {
        "id": str(team.id),
        "name": team.name,
        "message": "Joined team",
    }


# ---------------------------------------------------------------------------
# GET /teams/{id}  — team detail (all authenticated)
# ---------------------------------------------------------------------------

@router.get("/{team_id}")
async def get_team(
    team_id: UUID,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Members with user info
    mem_result = await db.execute(
        select(TeamMembership, User)
        .join(User, User.id == TeamMembership.operative_id)
        .where(TeamMembership.team_id == team_id)
        .order_by(User.bc_total.desc())
    )
    memberships = mem_result.all()

    event_id = await get_current_event_id(db)

    # Total BC from claims where this team contributed (event-filtered)
    bc_result = await db.execute(
        select(func.sum(Claim.bc_earned))
        .where(Claim.team_id == team_id, Claim.event_id == event_id)
    )
    total_bc = int(bc_result.scalar() or 0)

    # Claim count (event-filtered)
    claim_cnt = await db.execute(
        select(func.count(Claim.id)).where(
            Claim.team_id == team_id, Claim.event_id == event_id
        )
    )
    claim_count = int(claim_cnt.scalar() or 0)

    # Recent claims (with contract info, event-filtered)
    from app.models.contract import Contract  # noqa: avoid circular at module level
    claims_result = await db.execute(
        select(Claim, Contract, User)
        .join(Contract, Contract.id == Claim.contract_id)
        .join(User, User.id == Claim.operative_id)
        .where(Claim.team_id == team_id, Claim.event_id == event_id)
        .order_by(Claim.claimed_at.desc())
        .limit(20)
    )
    recent_claims = [
        {
            "contract_id": str(cl.id),
            "contract_title": ct.title,
            "contract_category": ct.category,
            "operative_username": u.username,
            "bc_earned": cl.bc_earned,
            "is_first_blood": cl.is_first_blood,
            "claimed_at": cl.claimed_at,
        }
        for cl, ct, u in claims_result.all()
    ]

    # Is current user a member?
    my_mem, _ = await _get_my_team(current_user.id, event_id, db)
    is_mine = my_mem is not None and str(my_mem.team_id) == str(team_id)
    is_captain = str(team.captain_id) == str(current_user.id)

    # Captain's school/section (from members list)
    captain_user = next((u for _mem, u in memberships if str(u.id) == str(team.captain_id)), None)

    return {
        "id": str(team.id),
        "name": team.name,
        "captain_school": captain_user.school if captain_user else None,
        "captain_section": captain_user.section if captain_user else None,
        "invite_code": team.invite_code if (is_mine) else None,
        "captain_id": str(team.captain_id) if team.captain_id else None,
        "total_bc": total_bc,
        "claim_count": claim_count,
        "created_at": team.created_at,
        "is_mine": is_mine,
        "is_captain": is_captain,
        "members": [
            {
                "id": str(u.id),
                "username": u.username,
                "bc_total": u.bc_total or 0,
                "is_captain": str(u.id) == str(team.captain_id),
                "joined_at": mem.joined_at,
            }
            for mem, u in memberships
        ],
        "recent_claims": recent_claims,
    }


# ---------------------------------------------------------------------------
# POST /teams/{id}/leave  — leave team (OPERATIVE, captain must transfer first)
# ---------------------------------------------------------------------------

@router.post("/{team_id}/leave")
async def leave_team(
    team_id: UUID,
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    mem_result = await db.execute(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.operative_id == current_user.id,
        )
    )
    membership = mem_result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Not a member of this team")

    syn_result = await db.execute(select(Team).where(Team.id == team_id))
    team = syn_result.scalar_one_or_none()

    # Captain must transfer before leaving (unless they're the last member)
    if str(team.captain_id) == str(current_user.id):
        # Count other members
        count_result = await db.execute(
            select(func.count(TeamMembership.id))
            .where(TeamMembership.team_id == team_id)
        )
        member_count = count_result.scalar()
        if member_count > 1:
            raise HTTPException(status_code=400, detail="CAPTAIN_MUST_TRANSFER")
        # Last member leaving — disband
        await db.delete(team)
        await db.commit()
        return {"message": "Team disbanded"}

    # Auto-remove this operative's ACTIVE assignments before leaving
    await db.execute(
        delete(ContractAssignment).where(
            ContractAssignment.team_id == team_id,
            ContractAssignment.assigned_to_id == current_user.id,
            ContractAssignment.status == "ACTIVE",
        )
    )
    await db.delete(membership)
    await db.commit()
    return {"message": "Left team"}


# ---------------------------------------------------------------------------
# POST /teams/{id}/transfer  — transfer captaincy
# ---------------------------------------------------------------------------

@router.post("/{team_id}/transfer")
async def transfer_captaincy(
    team_id: UUID,
    body: TransferRequest,
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    syn_result = await db.execute(
        select(Team).where(Team.id == team_id).with_for_update()
    )
    team = syn_result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    if str(team.captain_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Forbidden")

    # New captain must be a member
    mem_check = await db.execute(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.operative_id == body.new_captain_id,
        )
    )
    if not mem_check.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="NOT_A_MEMBER")

    team.captain_id = body.new_captain_id
    await db.commit()
    return {"message": "Captaincy transferred"}


# ---------------------------------------------------------------------------
# POST /teams/{id}/assignments  — assign a contract to a teammate (any member)
# ---------------------------------------------------------------------------

@router.post("/{team_id}/assignments", status_code=201)
async def create_assignment(
    team_id: UUID,
    body: AssignContractRequest,
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    event_id = await get_current_event_id(db)

    # Caller must be in the team
    my_mem = (await db.execute(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.operative_id == current_user.id,
            TeamMembership.event_id == event_id,
        )
    )).scalar_one_or_none()
    if not my_mem:
        raise HTTPException(status_code=403, detail="NOT_IN_TEAM")

    # Assignee must also be in the team
    target_mem = (await db.execute(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.operative_id == body.assigned_to_id,
            TeamMembership.event_id == event_id,
        )
    )).scalar_one_or_none()
    if not target_mem:
        raise HTTPException(status_code=400, detail="ASSIGNEE_NOT_IN_TEAM")

    # Contract must exist and be published
    contract = (await db.execute(
        select(Contract).where(Contract.id == body.contract_id, Contract.is_published == True)
    )).scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="CONTRACT_NOT_FOUND")

    # No duplicate ACTIVE assignment for same team + contract + assignee
    existing = (await db.execute(
        select(ContractAssignment).where(
            ContractAssignment.team_id == team_id,
            ContractAssignment.contract_id == body.contract_id,
            ContractAssignment.assigned_to_id == body.assigned_to_id,
            ContractAssignment.status == "ACTIVE",
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="ALREADY_ASSIGNED")

    assignment = ContractAssignment(
        team_id=team_id,
        contract_id=body.contract_id,
        assigned_by_id=current_user.id,
        assigned_to_id=body.assigned_to_id,
        event_id=event_id,
        status="ACTIVE",
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    target_user = (await db.execute(select(User).where(User.id == body.assigned_to_id))).scalar_one()

    return {
        "id": str(assignment.id),
        "contract_id": str(body.contract_id),
        "contract_title": contract.title,
        "contract_category": contract.category.value,
        "assigned_to_id": str(body.assigned_to_id),
        "assigned_to_username": target_user.username,
        "assigned_by_id": str(current_user.id),
        "assigned_by_username": current_user.username,
        "status": "ACTIVE",
        "created_at": assignment.created_at,
        "can_remove": True,
    }


# ---------------------------------------------------------------------------
# GET /teams/{id}/assignments  — list all assignments for a team
# ---------------------------------------------------------------------------

@router.get("/{team_id}/assignments")
async def get_assignments(
    team_id: UUID,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    event_id = await get_current_event_id(db)

    # Operatives must be team members; staff roles get free access
    if current_user.role and current_user.role.value == "OPERATIVE":
        my_mem = (await db.execute(
            select(TeamMembership).where(
                TeamMembership.team_id == team_id,
                TeamMembership.operative_id == current_user.id,
                TeamMembership.event_id == event_id,
            )
        )).scalar_one_or_none()
        if not my_mem:
            raise HTTPException(status_code=403, detail="NOT_IN_TEAM")

    team = (await db.execute(select(Team).where(Team.id == team_id))).scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    is_captain = team and str(team.captain_id) == str(current_user.id)

    assignments_result = await db.execute(
        select(ContractAssignment, Contract)
        .join(Contract, Contract.id == ContractAssignment.contract_id)
        .where(ContractAssignment.team_id == team_id)
        .order_by(ContractAssignment.created_at.desc())
    )
    rows = assignments_result.all()

    user_ids = set()
    for a, _ in rows:
        user_ids.add(a.assigned_by_id)
        user_ids.add(a.assigned_to_id)
    user_map: dict[str, str] = {}
    if user_ids:
        users_res = await db.execute(select(User).where(User.id.in_(user_ids)))
        user_map = {str(u.id): u.username for u in users_res.scalars().all()}

    return [
        {
            "id": str(a.id),
            "contract_id": str(a.contract_id),
            "contract_title": c.title,
            "contract_category": c.category.value,
            "assigned_by_id": str(a.assigned_by_id),
            "assigned_by_username": user_map.get(str(a.assigned_by_id), "UNKNOWN"),
            "assigned_to_id": str(a.assigned_to_id),
            "assigned_to_username": user_map.get(str(a.assigned_to_id), "UNKNOWN"),
            "status": a.status,
            "created_at": a.created_at,
            "can_remove": is_captain or str(a.assigned_by_id) == str(current_user.id),
        }
        for a, c in rows
    ]


# ---------------------------------------------------------------------------
# DELETE /teams/{id}/assignments/{assignment_id}  — remove an assignment
# ---------------------------------------------------------------------------

@router.delete("/{team_id}/assignments/{assignment_id}", status_code=204)
async def delete_assignment(
    team_id: UUID,
    assignment_id: UUID,
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    assignment = (await db.execute(
        select(ContractAssignment).where(
            ContractAssignment.id == assignment_id,
            ContractAssignment.team_id == team_id,
        )
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="ASSIGNMENT_NOT_FOUND")

    team = (await db.execute(select(Team).where(Team.id == team_id))).scalar_one_or_none()
    is_captain = team and str(team.captain_id) == str(current_user.id)
    is_assigner = str(assignment.assigned_by_id) == str(current_user.id)

    if not is_captain and not is_assigner:
        raise HTTPException(status_code=403, detail="FORBIDDEN")

    await db.delete(assignment)
    await db.commit()


# ---------------------------------------------------------------------------
# POST /teams/bookmark  — self-assign to a contract (bookmark "I'm working on this")
# ---------------------------------------------------------------------------

@router.post("/bookmark", status_code=201)
async def bookmark_contract(
    body: BookmarkRequest,
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    event_id = await get_current_event_id(db)

    my_mem = (await db.execute(
        select(TeamMembership).where(
            TeamMembership.operative_id == current_user.id,
            TeamMembership.event_id == event_id,
        )
    )).scalar_one_or_none()
    if not my_mem:
        raise HTTPException(status_code=403, detail="NOT_IN_TEAM")

    contract = (await db.execute(
        select(Contract).where(Contract.id == body.contract_id, Contract.is_published == True)
    )).scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="CONTRACT_NOT_FOUND")

    existing = (await db.execute(
        select(ContractAssignment).where(
            ContractAssignment.team_id == my_mem.team_id,
            ContractAssignment.contract_id == body.contract_id,
            ContractAssignment.assigned_to_id == current_user.id,
            ContractAssignment.status == "ACTIVE",
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="ALREADY_ASSIGNED")

    assignment = ContractAssignment(
        team_id=my_mem.team_id,
        contract_id=body.contract_id,
        assigned_by_id=current_user.id,
        assigned_to_id=current_user.id,
        event_id=event_id,
        status="ACTIVE",
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    return {"id": str(assignment.id), "contract_id": str(body.contract_id)}


# ---------------------------------------------------------------------------
# DELETE /teams/assignments/{assignment_id}  — remove by assignment ID only
# (used by bookmark toggle — no team_id needed in URL)
# Note: `assignments` is not a valid UUID so this never conflicts with
# DELETE /{team_id}/assignments/{assignment_id} (team_id is UUID-typed)
# ---------------------------------------------------------------------------

@router.delete("/assignments/{assignment_id}", status_code=204)
async def remove_assignment_by_id(
    assignment_id: UUID,
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    assignment = (await db.execute(
        select(ContractAssignment).where(ContractAssignment.id == assignment_id)
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="NOT_FOUND")

    team = (await db.execute(select(Team).where(Team.id == assignment.team_id))).scalar_one_or_none()
    is_captain = team and str(team.captain_id) == str(current_user.id)
    is_assigned_to = str(assignment.assigned_to_id) == str(current_user.id)
    is_assigner = str(assignment.assigned_by_id) == str(current_user.id)

    if not (is_captain or is_assigned_to or is_assigner):
        raise HTTPException(status_code=403, detail="FORBIDDEN")

    await db.delete(assignment)
    await db.commit()
