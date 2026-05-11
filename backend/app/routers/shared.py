from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_authenticated
from app.models.user import User, UserRole

router = APIRouter()


@router.get("/ping")
async def ping(_user: User = Depends(require_authenticated)):
    """Health check for authenticated routes."""
    return {"status": "online"}


# ---------------------------------------------------------------------------
# Staff onboarding — CONTRACTOR/HANDLER only
# Separate from /operative/complete-onboarding which requires OPERATIVE role
# ---------------------------------------------------------------------------

class StaffProfileRequest(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100)
    department: Optional[str] = Field(None, max_length=100)   # stored as school
    employee_id: Optional[str] = Field(None, max_length=50)   # stored as student_id


@router.patch("/staff-profile")
async def update_staff_profile(
    body: StaffProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in (UserRole.CONTRACTOR, UserRole.HANDLER):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Contractor or Handler only")
    current_user.full_name = body.full_name.strip()
    if body.department is not None:
        current_user.school = body.department.strip() or None
    if body.employee_id is not None:
        current_user.student_id = body.employee_id.strip() or None
    await db.commit()
    return {"ok": True}


@router.post("/staff-complete-onboarding")
async def staff_complete_onboarding(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in (UserRole.CONTRACTOR, UserRole.HANDLER):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Contractor or Handler only")
    current_user.onboarding_complete = True
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Admin onboarding — ADMIN role only
# ---------------------------------------------------------------------------

class AdminProfileRequest(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100)
    position: Optional[str] = Field(None, max_length=100)  # stored as section


@router.patch("/admin-profile")
async def update_admin_profile(
    body: AdminProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != UserRole.ADMIN:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Admin only")
    current_user.full_name = body.full_name.strip()
    if body.position is not None:
        current_user.section = body.position.strip() or None
    await db.commit()
    return {"ok": True}


@router.post("/admin-complete-onboarding")
async def admin_complete_onboarding(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != UserRole.ADMIN:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Admin only")
    current_user.onboarding_complete = True
    await db.commit()
    return {"ok": True}
