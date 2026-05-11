"""
Operator Requests — in-platform request system for all roles to contact Admin.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models.notification import Notification
from app.models.request import OperatorRequest, RequestStatus, RequestType
from app.models.user import User, UserRole
from app.redis_client import increment_request_daily
from app.utils.event import get_current_event_id
from app.utils.roles import get_organization_scope

router = APIRouter()

_DAILY_LIMIT   = 5
_PENDING_LIMIT = 3


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SubmitRequestBody(BaseModel):
    request_type:   RequestType
    reason:         str
    requested_role: str | None = None

    @field_validator("reason")
    @classmethod
    def reason_length(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 10:
            raise ValueError("Reason must be at least 10 characters")
        if len(v) > 300:
            raise ValueError("Reason must be at most 300 characters")
        return v

    @field_validator("requested_role")
    @classmethod
    def role_valid(cls, v: str | None) -> str | None:
        if v is None:
            return v
        valid = {"OPERATIVE", "HANDLER", "CONTRACTOR", "ADMIN"}
        if v.upper() not in valid:
            raise ValueError(f"requested_role must be one of {valid}")
        return v.upper()


class ResolveBody(BaseModel):
    status:         RequestStatus
    admin_response: str

    @field_validator("status")
    @classmethod
    def must_be_terminal(cls, v: RequestStatus) -> RequestStatus:
        if v not in (RequestStatus.APPROVED, RequestStatus.DENIED):
            raise ValueError("status must be APPROVED or DENIED")
        return v

    @field_validator("admin_response")
    @classmethod
    def response_length(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1:
            raise ValueError("Admin response is required")
        if len(v) > 300:
            raise ValueError("Admin response must be at most 300 characters")
        return v


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize(req: OperatorRequest) -> dict:
    return {
        "id":             str(req.id),
        "request_type":   req.request_type.value,
        "requested_role": req.requested_role,
        "reason":         req.reason,
        "status":         req.status.value,
        "admin_response": req.admin_response,
        "resolved_by":    req.resolved_by,
        "resolved_at":    req.resolved_at.isoformat() + "Z" if req.resolved_at else None,
        "created_at":     req.created_at.isoformat() + "Z",
        "sender_id":      str(req.sender_id),
        "sender_callsign":req.sender_callsign,
        "sender_role":    req.sender_role,
        "event_id":      req.event_id,
    }


# ---------------------------------------------------------------------------
# POST /requests — submit a new request
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def submit_request(
    body: SubmitRequestBody,
    current_user: User = Depends(require_roles(*list(UserRole))),
    db: AsyncSession = Depends(get_db),
):
    uid = str(current_user.id)

    # Rate limit: 5 per 24 hours
    daily_count = await increment_request_daily(uid)
    if daily_count > _DAILY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="TRANSMISSION_LIMIT_REACHED",
        )

    # Validate ROLE_CHANGE requirements
    if body.request_type == RequestType.ROLE_CHANGE:
        if not body.requested_role:
            raise HTTPException(status_code=422, detail="requested_role is required for ROLE_CHANGE requests")
        if body.requested_role == current_user.role.value:
            raise HTTPException(status_code=422, detail="Requested role is the same as your current role")

        # Block if a ROLE_CHANGE is already pending
        existing_rc = await db.execute(
            select(OperatorRequest).where(
                OperatorRequest.sender_id == current_user.id,
                OperatorRequest.request_type == RequestType.ROLE_CHANGE,
                OperatorRequest.status == RequestStatus.PENDING,
            )
        )
        if existing_rc.scalar_one_or_none():
            raise HTTPException(status_code=422, detail="PENDING_ROLE_CHANGE_EXISTS")

    # Count open PENDING requests
    pending_count_res = await db.execute(
        select(func.count()).where(
            OperatorRequest.sender_id == current_user.id,
            OperatorRequest.status == RequestStatus.PENDING,
        )
    )
    pending_count = pending_count_res.scalar() or 0
    if pending_count >= _PENDING_LIMIT:
        raise HTTPException(status_code=429, detail="TOO_MANY_OPEN_REQUESTS")

    event_id = await get_current_event_id(db)
    req = OperatorRequest(
        sender_id=current_user.id,
        sender_callsign=current_user.username,
        sender_role=current_user.role.value,
        request_type=body.request_type,
        requested_role=body.requested_role,
        reason=body.reason,
        status=RequestStatus.PENDING,
        event_id=event_id,
        org_id=getattr(current_user, "org_id", None),
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return _serialize(req)


# ---------------------------------------------------------------------------
# GET /requests/pending-count — admin badge data (no heavy query, just count)
# ---------------------------------------------------------------------------

@router.get("/pending-count")
async def get_pending_count(
    org_id: Optional[int] = None,
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    scope = get_organization_scope(current_user, org_id)
    pending_q = select(func.count()).where(OperatorRequest.status == RequestStatus.PENDING)
    if scope is not None:
        pending_q = pending_q.where(OperatorRequest.org_id == scope)
    res = await db.execute(pending_q)
    return {"count": res.scalar() or 0}


# ---------------------------------------------------------------------------
# GET /requests/mine — sender's own requests
# ---------------------------------------------------------------------------

@router.get("/mine")
async def get_my_requests(
    current_user: User = Depends(require_roles(*list(UserRole))),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(OperatorRequest)
        .where(
            OperatorRequest.sender_id == current_user.id,
            OperatorRequest.status != RequestStatus.CANCELLED,  # hide cancelled
        )
        .order_by(OperatorRequest.created_at.desc())
        .limit(10)
    )
    return [_serialize(r) for r in res.scalars().all()]


# ---------------------------------------------------------------------------
# DELETE /requests/{id} — cancel a pending request (owner only)
# ---------------------------------------------------------------------------

@router.delete("/{request_id}", status_code=200)
async def cancel_request(
    request_id: UUID,
    current_user: User = Depends(require_roles(*list(UserRole))),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(OperatorRequest).where(OperatorRequest.id == request_id)
    )
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if req.status != RequestStatus.PENDING:
        raise HTTPException(status_code=422, detail="Only PENDING requests can be cancelled")
    req.status = RequestStatus.CANCELLED
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# GET /requests — admin: list all with filters
# ---------------------------------------------------------------------------

@router.get("")
async def list_all_requests(
    status: str = Query("PENDING"),
    type:   str = Query("ALL"),
    page:   int = Query(1, ge=1),
    limit:  int = Query(20, ge=1, le=100),
    org_id: Optional[int] = None,
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    scope = get_organization_scope(current_user, org_id)
    q = select(OperatorRequest)
    if scope is not None:
        q = q.where(OperatorRequest.org_id == scope)

    if status != "ALL":
        try:
            s = RequestStatus(status)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid status: {status}")
        q = q.where(OperatorRequest.status == s)
    else:
        # ALL still hides nothing — admins can see CANCELLED too
        pass

    if type != "ALL":
        try:
            t = RequestType(type)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid type: {type}")
        q = q.where(OperatorRequest.request_type == t)

    # PENDING always floated to top
    q = q.order_by(
        case((OperatorRequest.status == RequestStatus.PENDING, 0), else_=1),
        OperatorRequest.created_at.desc(),
    )

    total_res = await db.execute(select(func.count()).select_from(q.subquery()))
    total = total_res.scalar() or 0

    q = q.offset((page - 1) * limit).limit(limit)
    res = await db.execute(q)
    items = [_serialize(r) for r in res.scalars().all()]
    return {"items": items, "total": total, "page": page, "limit": limit}


# ---------------------------------------------------------------------------
# PATCH /requests/{id}/resolve — admin: approve or deny
# ---------------------------------------------------------------------------

@router.patch("/{request_id}/resolve")
async def resolve_request(
    request_id: UUID,
    body: ResolveBody,
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(OperatorRequest).where(OperatorRequest.id == request_id)
    )
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != RequestStatus.PENDING:
        raise HTTPException(status_code=422, detail="Request is already resolved")

    if body.status == RequestStatus.APPROVED and req.request_type == RequestType.ROLE_CHANGE:
        # Fetch sender to execute role change
        sender_res = await db.execute(select(User).where(User.id == req.sender_id))
        sender = sender_res.scalar_one_or_none()
        if sender:
            if sender.role.value == req.requested_role:
                body.admin_response = body.admin_response.strip() + " [Role already updated]"
            else:
                try:
                    sender.role = UserRole(req.requested_role)
                except ValueError:
                    raise HTTPException(status_code=422, detail=f"Invalid role: {req.requested_role}")

    req.status        = body.status
    req.admin_response = body.admin_response.strip()
    req.resolved_by   = current_user.username
    req.resolved_at   = datetime.utcnow()

    # Create notification for the sender
    type_label = req.request_type.value.replace("_", " ")
    if body.status == RequestStatus.APPROVED:
        msg = f"Your {type_label} request has been approved. {body.admin_response.strip()}"
    else:
        msg = f"Your {type_label} request has been denied. {body.admin_response.strip()}"
    db.add(Notification(user_id=req.sender_id, message=msg[:500], from_callsign=current_user.username))

    await db.commit()
    await db.refresh(req)
    return _serialize(req)


# ---------------------------------------------------------------------------
# DELETE /requests — admin: clear all resolved (non-pending) requests
# ---------------------------------------------------------------------------

@router.delete("", status_code=200)
async def clear_resolved_requests(
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        delete(OperatorRequest).where(OperatorRequest.status != RequestStatus.PENDING)
    )
    await db.commit()
    return {"deleted": result.rowcount}
