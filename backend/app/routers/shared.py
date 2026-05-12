import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
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
        raise HTTPException(status_code=403, detail="Admin only")
    current_user.onboarding_complete = True
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# GET/PATCH /shared/profile — profile settings for all staff roles
# ---------------------------------------------------------------------------

class StaffSettingsUpdate(BaseModel):
    username:   Optional[str] = Field(None, min_length=3, max_length=50)
    full_name:  Optional[str] = Field(None, max_length=100)
    school:     Optional[str] = Field(None, max_length=200)
    section:    Optional[str] = Field(None, max_length=100)
    year_level: Optional[str] = Field(None, max_length=20)


@router.get("/profile")
async def get_profile(current_user: User = Depends(require_authenticated)):
    return {
        "username":    current_user.username,
        "email":       current_user.email,
        "full_name":   current_user.full_name,
        "student_id":  current_user.student_id,
        "school":      current_user.school,
        "section":     current_user.section,
        "year_level":  current_user.year_level,
    }


@router.patch("/profile")
async def update_profile(
    body: StaffSettingsUpdate,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    if body.username is not None:
        new_un = body.username.strip()
        if len(new_un) < 3:
            raise HTTPException(status_code=400, detail="CALLSIGN_TOO_SHORT")
        if not re.match(r"^[a-zA-Z0-9_\-]+$", new_un):
            raise HTTPException(status_code=400, detail="CALLSIGN_INVALID")
        if new_un != current_user.username:
            taken = (await db.execute(select(User).where(User.username == new_un))).scalar_one_or_none()
            if taken:
                raise HTTPException(status_code=400, detail="CALLSIGN_TAKEN")
            current_user.username = new_un
    if body.full_name  is not None: current_user.full_name  = body.full_name.strip()  or None
    if body.school     is not None: current_user.school     = body.school.strip()     or None
    if body.section    is not None: current_user.section    = body.section.strip()    or None
    if body.year_level is not None: current_user.year_level = body.year_level         or None
    await db.commit()
    return {
        "username":   current_user.username,
        "full_name":  current_user.full_name,
        "school":     current_user.school,
        "section":    current_user.section,
        "year_level": current_user.year_level,
    }
