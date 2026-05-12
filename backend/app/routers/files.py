import mimetypes
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_authenticated
from app.models.file_storage import FileStorage
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

    # Check disk first — works automatically when a volume is mounted later
    file_path = os.path.join(UPLOAD_DIR, filename)
    if os.path.isfile(file_path):
        return FileResponse(file_path)

    # Fall back to DB storage
    result = await db.execute(select(FileStorage).where(FileStorage.filename == filename))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")

    media_type = (
        row.content_type
        or mimetypes.guess_type(filename)[0]
        or "application/octet-stream"
    )
    disposition = f'attachment; filename="{row.original_name or filename}"'
    return Response(
        content=row.content,
        media_type=media_type,
        headers={"Content-Disposition": disposition},
    )
