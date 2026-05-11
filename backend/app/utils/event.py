"""Event utility: resolve current active event."""
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event, EventStatus


async def get_active_event(db: AsyncSession) -> Optional[Event]:
    """Return the currently ACTIVE event object, or None."""
    result = await db.execute(
        select(Event)
        .where(Event.status == EventStatus.ACTIVE.value)
        .order_by(Event.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_current_event_id(db: AsyncSession) -> Optional[int]:
    """Return the ACTIVE event ID, or the latest non-CLOSED event ID as fallback."""
    # Prefer ACTIVE
    result = await db.execute(
        select(Event.id)
        .where(Event.status == EventStatus.ACTIVE.value)
        .order_by(Event.id.desc())
        .limit(1)
    )
    event_id = result.scalar_one_or_none()
    if event_id:
        return event_id
    # Fallback: latest UPCOMING
    result = await db.execute(
        select(Event.id)
        .where(Event.status == EventStatus.UPCOMING.value)
        .order_by(Event.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_competition_state(db: AsyncSession) -> dict:
    """
    Unified competition state check for all submission endpoints.
    Returns {"can_submit": bool, "reason": str}
    Reasons: ACTIVE | NO_EVENT | HALTED | EVENT_ENDED
    """
    from app.models.settings import PlatformSettings  # avoid circular import

    event = await get_active_event(db)
    if not event:
        return {"can_submit": False, "reason": "NO_EVENT"}

    # Manual halt/resume check
    row = await db.execute(
        select(PlatformSettings).where(PlatformSettings.key == "competition_active")
    )
    setting = row.scalar_one_or_none()
    if setting and setting.value == "false":
        return {"can_submit": False, "reason": "HALTED"}

    # Event end_time check
    if event.end_time and datetime.utcnow() > event.end_time:
        return {"can_submit": False, "reason": "EVENT_ENDED"}

    return {"can_submit": True, "reason": "ACTIVE"}
