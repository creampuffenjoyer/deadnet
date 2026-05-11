from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.settings import PlatformSettings
from app.models.organization import Organization

router = APIRouter()

_PUBLIC_KEYS = [
    "registration_open",
    "team_registration_open",
    "competition_start",
    "competition_end",
    "competition_name",
    "competition_format",
    "show_section_in_name",
    "allow_solo",
    "max_flag_attempts",
    "max_team_size",
    "solve_feed_delay_seconds",
    "competition_active",
    "competition_manual_end",
    "competition_halted_by",
    # Architect-controlled — read by frontend for UI/terminology
    "term_operator",
    "term_team",
    "term_handler",
    "term_contractor",
    "maintenance_mode",
    "bounty_board_public",
    "void_mode_enabled",
    "platform_registration_locked",
]


@router.get("/settings")
async def get_public_settings(db: AsyncSession = Depends(get_db)):
    """Returns platform settings needed by the public-facing UI (no auth required)."""
    result = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key.in_(_PUBLIC_KEYS))
    )
    rows = result.scalars().all()
    data = {row.key: row.value for row in rows}

    return {
        "competition_name": data.get("competition_name", "DEADNET"),
        "registration_open": data.get("registration_open", "true").lower() == "true",
        "team_registration_open": data.get("team_registration_open", "true").lower() == "true",
        "competition_start": data.get("competition_start") or None,
        "competition_end": data.get("competition_end") or None,
        "competition_format": data.get("competition_format", "local"),
        "show_section_in_name": data.get("show_section_in_name", "true"),
        "allow_solo": data.get("allow_solo", "true").lower() == "true",
        "max_flag_attempts": int(data.get("max_flag_attempts", "0") or "0"),
        "max_team_size": int(data.get("max_team_size", "0") or "0"),
        "solve_feed_delay_seconds": int(data.get("solve_feed_delay_seconds", "30") or "30"),
        "competition_active": data.get("competition_active", "") or None,
        "competition_manual_end": data.get("competition_manual_end", "") or None,
        "competition_halted_by": data.get("competition_halted_by", "") or None,
        "term_operator": data.get("term_operator", "Operative"),
        "term_team": data.get("term_team", "Team"),
        "term_handler": data.get("term_handler", "Handler"),
        "term_contractor": data.get("term_contractor", "Contractor"),
        "maintenance_mode": data.get("maintenance_mode", "false").lower() == "true",
        "bounty_board_public": data.get("bounty_board_public", "false").lower() == "true",
        "void_mode_enabled": data.get("void_mode_enabled", "true").lower() == "true",
        "platform_registration_locked": data.get("platform_registration_locked", "false").lower() == "true",
    }


@router.get("/organizations")
async def get_public_organizations(db: AsyncSession = Depends(get_db)):
    """Returns active organizations for registration dropdowns (no auth required)."""
    result = await db.execute(
        select(Organization)
        .where(Organization.is_active == True)
        .order_by(Organization.name)
    )
    organizations = result.scalars().all()
    return [
        {"id": u.id, "name": u.name, "org_code": u.org_code}
        for u in organizations
    ]
