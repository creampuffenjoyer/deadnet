"""
Notifications — user-facing alerts for resolved operator requests.
"""
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends

from app.database import get_db
from app.deps import require_roles
from app.models.notification import Notification
from app.models.user import User, UserRole

router = APIRouter()


def _serialize(n: Notification) -> dict:
    return {
        "id":            str(n.id),
        "message":       n.message,
        "from_callsign": n.from_callsign,
        "kind":          n.kind,
        "read":          n.read,
        "created_at":    n.created_at.isoformat() + "Z",
    }


@router.get("/mine")
async def get_my_notifications(
    current_user: User = Depends(require_roles(*list(UserRole))),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(20)
    )
    return [_serialize(n) for n in res.scalars().all()]


@router.post("/read-all", status_code=200)
async def mark_all_read(
    current_user: User = Depends(require_roles(*list(UserRole))),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(Notification)
        .where(Notification.user_id == current_user.id, Notification.read.is_(False))
        .values(read=True)
    )
    await db.commit()
    return {"ok": True}


@router.delete("/mine", status_code=200)
async def clear_all_notifications(
    current_user: User = Depends(require_roles(*list(UserRole))),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        delete(Notification).where(Notification.user_id == current_user.id)
    )
    await db.commit()
    return {"deleted": result.rowcount}
