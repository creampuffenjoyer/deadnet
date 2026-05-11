from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_operative
from app.models.contract import Claim, Contract
from app.models.settings import PlatformSettings
from app.models.team import Team, TeamMembership
from app.models.user import User, UserRole
from app.routers.organizations import validate_organization_active
from app.utils.clearance import get_clearance_level
from app.utils.event import get_current_event_id

router = APIRouter()


def _clearance_progress(bc: int, settings: dict) -> dict:
    """Return current level, next level, and % progress toward next."""
    try:
        thresholds = [
            (0,    "NOVICE",  int(settings.get("cl_ghost",   501))),
            (int(settings.get("cl_ghost",   501)),  "GHOST",   int(settings.get("cl_phantom", 1501))),
            (int(settings.get("cl_phantom", 1501)), "PHANTOM", int(settings.get("cl_specter", 3001))),
            (int(settings.get("cl_specter", 3001)), "SPECTER", int(settings.get("cl_legend",  6001))),
            (int(settings.get("cl_legend",  6001)), "HACKER",  None),
        ]
    except (ValueError, TypeError):
        thresholds = [
            (0, "NOVICE", 501), (501, "GHOST", 1501),
            (1501, "PHANTOM", 3001), (3001, "SPECTER", 6001),
            (6001, "HACKER", None),
        ]

    for floor, level, ceiling in thresholds:
        if ceiling is None or bc < ceiling:
            if ceiling is None:
                return {"level": level, "next_level": None, "progress_pct": 100, "bc_to_next": 0}
            progress = round(((bc - floor) / (ceiling - floor)) * 100)
            return {
                "level": level,
                "next_level": thresholds[thresholds.index((floor, level, ceiling)) + 1][1],
                "progress_pct": max(0, min(100, progress)),
                "bc_to_next": max(0, ceiling - bc),
            }

    return {"level": "HACKER", "next_level": None, "progress_pct": 100, "bc_to_next": 0}


@router.get("/ping")
async def ping(_user: User = Depends(require_operative)):
    return {"status": "operative online"}


# ---------------------------------------------------------------------------
# GET /operative/dashboard  — combined dashboard summary
# ---------------------------------------------------------------------------

@router.get("/dashboard")
async def operative_dashboard(
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    # Platform settings for clearance thresholds
    settings_result = await db.execute(select(PlatformSettings))
    settings = {row.key: row.value for row in settings_result.scalars().all()}

    event_id = await get_current_event_id(db)
    bc = current_user.bc_total or 0

    # Rank: how many operatives have more BC?
    rank_result = await db.execute(
        select(func.count(User.id)).where(
            User.role == UserRole.OPERATIVE,
            User.bc_total > bc,
            User.is_banned == False,
        )
    )
    rank = (rank_result.scalar() or 0) + 1

    # Total operative count
    total_result = await db.execute(
        select(func.count(User.id)).where(
            User.role == UserRole.OPERATIVE, User.is_banned == False
        )
    )
    total_operatives = total_result.scalar() or 0

    # Claim count (current event)
    claim_cnt_result = await db.execute(
        select(func.count(Claim.id)).where(
            Claim.operative_id == current_user.id,
            Claim.event_id == event_id,
        )
    )
    claim_count = claim_cnt_result.scalar() or 0

    # Recent 5 claims (current event)
    recent_result = await db.execute(
        select(Claim, Contract)
        .join(Contract, Contract.id == Claim.contract_id)
        .where(Claim.operative_id == current_user.id, Claim.event_id == event_id)
        .order_by(Claim.claimed_at.desc())
        .limit(5)
    )
    recent_claims = [
        {
            "contract_id": str(ct.id),
            "contract_title": ct.title,
            "contract_category": ct.category,
            "contract_rarity": ct.rarity,
            "bc_earned": cl.bc_earned,
            "is_first_blood": cl.is_first_blood,
            "claimed_at": cl.claimed_at,
        }
        for cl, ct in recent_result.all()
    ]

    # Team membership (current event only)
    mem_result = await db.execute(
        select(TeamMembership, Team)
        .join(Team, Team.id == TeamMembership.team_id)
        .where(
            TeamMembership.operative_id == current_user.id,
            TeamMembership.event_id == event_id,
        )
    )
    mem_row = mem_result.one_or_none()
    team_info = None
    if mem_row:
        mem, syn = mem_row
        # Team rank (current event)
        bc_result = await db.execute(
            select(Claim.team_id, func.sum(Claim.bc_earned))
            .where(Claim.team_id.isnot(None), Claim.event_id == event_id)
            .group_by(Claim.team_id)
        )
        all_syn_bc = {str(r[0]): int(r[1]) for r in bc_result.all()}
        this_bc = all_syn_bc.get(str(syn.id), 0)
        syn_rank = sum(1 for v in all_syn_bc.values() if v > this_bc) + 1

        # Member count
        mem_cnt_result = await db.execute(
            select(func.count(TeamMembership.id))
            .where(TeamMembership.team_id == syn.id)
        )
        mem_count = mem_cnt_result.scalar() or 0

        # Captain's school/section for display name
        captain_school = None
        captain_section = None
        if syn.captain_id:
            cap_res = await db.execute(select(User).where(User.id == syn.captain_id))
            cap = cap_res.scalar_one_or_none()
            if cap:
                captain_school = cap.school
                captain_section = cap.section

        team_info = {
            "id": str(syn.id),
            "name": syn.name,
            "captain_school": captain_school,
            "captain_section": captain_section,
            "invite_code": syn.invite_code,
            "captain_id": str(syn.captain_id) if syn.captain_id else None,
            "is_captain": str(syn.captain_id) == str(current_user.id),
            "total_bc": this_bc,
            "rank": syn_rank,
            "member_count": mem_count,
        }

    return {
        "username": current_user.username,
        "bc_total": bc,
        "rank": rank,
        "total_operatives": total_operatives,
        "claim_count": claim_count,
        "clearance": _clearance_progress(bc, settings),
        "recent_claims": recent_claims,
        "team": team_info,
        "school": current_user.school,
        "section": current_user.section,
    }


class SettingsUpdateRequest(BaseModel):
    school: Optional[str] = Field(None, max_length=100)
    section: Optional[str] = Field(None, max_length=100)


@router.patch("/settings")
async def update_settings(
    body: SettingsUpdateRequest,
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    if body.school is not None:
        current_user.school = body.school.strip() or None
    if body.section is not None:
        current_user.section = body.section.strip() or None
    await db.commit()
    return {"school": current_user.school, "section": current_user.section}


# ---------------------------------------------------------------------------
# POST /operative/complete-onboarding
# ---------------------------------------------------------------------------

class OnboardingRequest(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100)
    student_id: str = Field(..., min_length=1, max_length=50)
    section: str = Field(..., min_length=1, max_length=100)
    year_level: str = Field(..., max_length=20)
    org_id: Optional[int] = None
    invite_code: Optional[str] = None


@router.post("/complete-onboarding")
async def complete_onboarding(
    body: OnboardingRequest,
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    current_user.full_name = body.full_name.strip()
    current_user.student_id = body.student_id.strip()
    current_user.section = body.section.strip()
    current_user.year_level = body.year_level
    current_user.onboarding_complete = True

    if body.org_id is not None and not current_user.org_id:
        await validate_organization_active(body.org_id, db)
        current_user.org_id = body.org_id

    if body.invite_code:
        # Try to join team with invite code
        syn_result = await db.execute(
            select(Team).where(Team.invite_code == body.invite_code.strip().upper())
        )
        syn = syn_result.scalar_one_or_none()
        if syn:
            onboard_event_id = await get_current_event_id(db)
            existing = await db.execute(
                select(TeamMembership).where(
                    TeamMembership.operative_id == current_user.id,
                    TeamMembership.event_id == onboard_event_id,
                )
            )
            if not existing.scalar_one_or_none():
                db.add(TeamMembership(
                    team_id=syn.id,
                    operative_id=current_user.id,
                    event_id=onboard_event_id,
                ))

    await db.commit()
    return {"message": "Onboarding complete", "onboarding_complete": True}


# ---------------------------------------------------------------------------
# PATCH /operative/profile — update identity fields
# ---------------------------------------------------------------------------

class ProfileUpdateRequest(BaseModel):
    username: Optional[str] = Field(None, max_length=30)
    full_name: Optional[str] = Field(None, max_length=100)
    school: Optional[str] = Field(None, max_length=100)
    section: Optional[str] = Field(None, max_length=100)
    year_level: Optional[str] = Field(None, max_length=20)


@router.get("/profile")
async def get_profile(current_user: User = Depends(require_operative)):
    return {
        "username": current_user.username,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "student_id": current_user.student_id,
        "school": current_user.school,
        "section": current_user.section,
        "year_level": current_user.year_level,
        "onboarding_complete": current_user.onboarding_complete,
    }


@router.patch("/profile")
async def update_profile(
    body: ProfileUpdateRequest,
    current_user: User = Depends(require_operative),
    db: AsyncSession = Depends(get_db),
):
    import re
    if body.username is not None:
        new_username = body.username.strip()
        if len(new_username) < 3:
            raise HTTPException(status_code=400, detail="CALLSIGN_TOO_SHORT")
        if not re.match(r"^[a-zA-Z0-9_\-]+$", new_username):
            raise HTTPException(status_code=400, detail="CALLSIGN_INVALID")
        if new_username != current_user.username:
            existing = await db.execute(select(User).where(User.username == new_username))
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="CALLSIGN_TAKEN")
            current_user.username = new_username
    if body.full_name is not None:
        current_user.full_name = body.full_name.strip() or None
    if body.school is not None:
        current_user.school = body.school.strip() or None
    if body.section is not None:
        current_user.section = body.section.strip() or None
    if body.year_level is not None:
        current_user.year_level = body.year_level or None
    await db.commit()
    return {
        "username": current_user.username,
        "full_name": current_user.full_name,
        "school": current_user.school,
        "section": current_user.section,
        "year_level": current_user.year_level,
    }
