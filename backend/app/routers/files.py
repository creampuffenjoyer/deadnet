import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_authenticated
from app.models.user import User, UserRole
from app.utils.event import get_competition_state

router = APIRouter()

UPLOAD_DIR = "/app/uploads"


@router.get("/{filename}")
async def serve_file(
    filename: str,
    current_user: User = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    # Block file downloads for operatives when competition is not active
    if current_user.role == UserRole.OPERATIVE:
        state = await get_competition_state(db)
        if not state["can_submit"]:
            raise HTTPException(status_code=403, detail=state["reason"])

    # Prevent path traversal attacks
    if any(c in filename for c in ("/", "\\", "..")):
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path)
