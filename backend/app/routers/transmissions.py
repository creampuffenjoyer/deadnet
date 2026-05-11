from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import require_authenticated, require_contractor, require_admin
from app.models.notification import Notification
from app.models.transmission import NetworkTransmission
from app.models.user import User, UserRole
from app.utils.roles import get_organization_scope

router = APIRouter()

_STAFF_ROLES = {"ADMIN", "ARCHITECT", "CONTRACTOR", "HANDLER"}
_TARGETABLE_ROLES = ["OPERATIVE", "CONTRACTOR", "HANDLER", "ARCHITECT"]


class TransmissionRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=1000)
    # Mutually exclusive targeting — backend enforces precedence: specific > roles > all
    recipient_ids: Optional[List[UUID]] = None        # specific operatives by ID
    target_roles:  Optional[List[str]]  = None        # e.g. ["OPERATIVE", "HANDLER"]


@router.get("/")
async def list_transmissions(
    org_id: Optional[int] = None,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    scope = get_organization_scope(current_user, org_id)
    tx_q = (
        select(NetworkTransmission)
        .options(
            selectinload(NetworkTransmission.author),
            selectinload(NetworkTransmission.recipient),
        )
        .order_by(NetworkTransmission.created_at.desc())
        .limit(50)
    )
    if scope is not None:
        tx_q = tx_q.where(NetworkTransmission.org_id == scope)

    # Non-staff: filter to only transmissions relevant to them
    if current_user.role.value not in _STAFF_ROLES:
        role_val = current_user.role.value
        tx_q = tx_q.where(
            or_(
                # Targeted directly to this user
                NetworkTransmission.recipient_id == current_user.id,
                # Global broadcast (no recipient, no role restriction)
                and_(
                    NetworkTransmission.recipient_id.is_(None),
                    NetworkTransmission.target_roles.is_(None),
                ),
                # Role-restricted broadcast that includes this user's role
                # Use PostgreSQL ? operator: jsonb_array ? 'element'
                and_(
                    NetworkTransmission.recipient_id.is_(None),
                    NetworkTransmission.target_roles.isnot(None),
                    NetworkTransmission.target_roles.op('?')(role_val),
                ),
            )
        )

    result = await db.execute(tx_q)
    items = result.scalars().all()
    return [
        {
            "id": str(t.id),
            "content": t.content,
            "author_id": str(t.author_id) if t.author_id else None,
            "author_username": t.author.username if t.author else "[REDACTED]",
            "recipient_id": str(t.recipient_id) if t.recipient_id else None,
            "recipient_username": t.recipient.username if t.recipient else None,
            "target_roles": t.target_roles,
            "created_at": t.created_at,
        }
        for t in items
    ]


@router.delete("/", status_code=200)
async def clear_all_transmissions(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(delete(NetworkTransmission))
    await db.commit()
    return {"deleted": result.rowcount}


@router.delete("/{transmission_id}", status_code=200)
async def delete_transmission(
    transmission_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    tx_result = await db.execute(
        select(NetworkTransmission).where(NetworkTransmission.id == transmission_id)
    )
    tx = tx_result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transmission not found")

    # Non-architect admins can only delete transmissions scoped to their own org
    caller_role = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    if caller_role != "ARCHITECT":
        caller_org = getattr(current_user, "org_id", None)
        if tx.org_id != caller_org:
            raise HTTPException(status_code=403, detail="Cannot delete transmissions outside your organization")

    await db.execute(delete(NetworkTransmission).where(NetworkTransmission.id == transmission_id))
    await db.commit()
    return {"deleted": True}


def _notify(db, user_ids, content: str, sender_username: str):
    """Bulk-create Notification records for a list of user IDs."""
    for uid in user_ids:
        db.add(Notification(
            user_id=uid,
            message=content,
            from_callsign=sender_username,
            kind="TX",
        ))


@router.post("/", status_code=201)
async def broadcast_transmission(
    body: TransmissionRequest,
    current_user: User = Depends(require_contractor),
    db: AsyncSession = Depends(get_db),
):
    org_id = getattr(current_user, "org_id", None)
    sender = current_user.username

    if body.recipient_ids:
        # Specific users — one transmission record + one notification per recipient
        ops_result = await db.execute(
            select(User).where(
                User.id.in_(body.recipient_ids),
                User.is_banned == False,
            )
        )
        valid_ops = {u.id: u for u in ops_result.scalars().all()}

        created = []
        for rid in body.recipient_ids:
            if rid not in valid_ops:
                continue
            db.add(NetworkTransmission(
                content=body.content,
                author_id=current_user.id,
                org_id=org_id,
                recipient_id=rid,
                target_roles=None,
            ))
            created.append(str(rid))

        _notify(db, valid_ops.keys(), body.content, sender)
        await db.commit()
        return {"targeted": True, "recipients": created}

    elif body.target_roles:
        # Role-restricted broadcast
        valid_roles = [r for r in body.target_roles if r in _TARGETABLE_ROLES]
        db.add(NetworkTransmission(
            content=body.content,
            author_id=current_user.id,
            org_id=org_id,
            recipient_id=None,
            target_roles=valid_roles or None,
        ))

        # Notify all users whose role is in the target list
        if valid_roles:
            role_enums = [UserRole(r) for r in valid_roles if r in UserRole._value2member_map_]
            users_result = await db.execute(
                select(User.id).where(
                    User.role.in_(role_enums),
                    User.is_banned == False,
                    User.id != current_user.id,
                )
            )
            _notify(db, users_result.scalars().all(), body.content, sender)

        await db.commit()
        return {"ok": True, "target_roles": valid_roles}

    else:
        # Global broadcast — notify everyone except sender
        db.add(NetworkTransmission(
            content=body.content,
            author_id=current_user.id,
            org_id=org_id,
            recipient_id=None,
            target_roles=None,
        ))

        users_result = await db.execute(
            select(User.id).where(
                User.is_banned == False,
                User.id != current_user.id,
            )
        )
        _notify(db, users_result.scalars().all(), body.content, sender)

        await db.commit()
        return {"ok": True, "broadcast": True}
