import re
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.config import get_settings
from app.repositories.docs_store import load_docs_store
from app.repositories.home_store import home_page_references_upload, load_home_page
from app.repositories.regulations_store import load_regulations_store
from app.utils.security import require_ready_session


router = APIRouter(prefix="/api")
UPLOAD_FILENAME_RE = re.compile(r"^[a-f0-9]{32}\.(png|jpg|jpeg|webp|gif)$")
UPLOAD_URL_RE = re.compile(r"/api/uploads/([a-f0-9]{32}\.(?:png|jpg|jpeg|webp|gif))")
# A browser may have an image only in an unsaved draft for a while.
ORPHAN_GRACE_SECONDS = 60 * 60


def _upload_path(filename: str) -> Path:
    if not UPLOAD_FILENAME_RE.fullmatch(filename):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    uploads_path = Path(get_settings().uploads_path).resolve()
    target = (uploads_path / filename).resolve()
    if uploads_path not in target.parents:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    return target


def _referenced_uploads() -> set[str]:
    texts = [load_home_page().content, load_docs_store().model_dump_json(), load_regulations_store().model_dump_json()]
    return {filename for text in texts for filename in UPLOAD_URL_RE.findall(text)}


def cleanup_unused_uploads() -> int:
    """Delete old uploads that no longer occur in home, docs, or regulations."""
    uploads_path = Path(get_settings().uploads_path).resolve()
    if not uploads_path.exists():
        return 0
    referenced = _referenced_uploads()
    cutoff = time.time() - ORPHAN_GRACE_SECONDS
    deleted = 0
    for file_path in uploads_path.iterdir():
        if not file_path.is_file() or not UPLOAD_FILENAME_RE.fullmatch(file_path.name):
            continue
        if file_path.name in referenced or file_path.stat().st_mtime > cutoff:
            continue
        file_path.unlink(missing_ok=True)
        deleted += 1
    return deleted


@router.get("/uploads/{filename}")
async def uploaded_file(filename: str, request: Request) -> FileResponse:
    target = _upload_path(filename)
    if not target.exists() or not target.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    if not home_page_references_upload(filename):
        require_ready_session(request)
    return FileResponse(target)
