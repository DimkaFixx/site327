import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse

from app.config import get_settings
from app.repositories.home_store import home_page_references_upload
from app.utils.security import require_ready_session


router = APIRouter(prefix="/api")
UPLOAD_FILENAME_RE = re.compile(r"^[a-f0-9]{32}\.(png|jpg|jpeg|webp)$")


def _upload_path(filename: str) -> Path:
    if not UPLOAD_FILENAME_RE.fullmatch(filename):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    uploads_path = Path(get_settings().uploads_path).resolve()
    target = (uploads_path / filename).resolve()
    if uploads_path not in target.parents:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    return target


@router.get("/uploads/{filename}")
async def uploaded_file(filename: str, request: Request) -> FileResponse:
    target = _upload_path(filename)
    if not target.exists() or not target.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    if not home_page_references_upload(filename):
        require_ready_session(request)
    return FileResponse(target)
