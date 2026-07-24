import re
import uuid
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import delete, select

from app.config import get_settings
from app.repositories.home_store import home_page_references_upload
from app.repositories.audit import log_admin_event
from app.repositories.database import db_session, photo_host_images
from app.utils.security import require_admin, require_ready_session


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


def _photo_host_path(filename: str) -> Path:
    if not UPLOAD_FILENAME_RE.fullmatch(filename):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    root = (Path(get_settings().uploads_path) / "photo-host").resolve()
    target = (root / filename).resolve()
    if root not in target.parents:
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


@router.get("/photo-host/{filename}")
async def hosted_photo(filename: str) -> FileResponse:
    target = _photo_host_path(filename)
    with db_session() as db:
        exists = db.execute(select(photo_host_images.c.id).where(photo_host_images.c.filename == filename)).scalar_one_or_none()
    if exists is None or not target.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Изображение не найдено")
    return FileResponse(target, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/admin/photo-host")
async def admin_list_hosted_photos(request: Request) -> list[dict[str, str]]:
    require_admin(request)
    with db_session() as db:
        rows = db.execute(select(photo_host_images.c.filename, photo_host_images.c.created_at).order_by(photo_host_images.c.created_at.desc())).mappings().all()
    return [{"filename": row["filename"], "url": f"/api/photo-host/{row['filename']}", "created_at": row["created_at"].isoformat()} for row in rows]


@router.post("/admin/photo-host")
async def admin_upload_hosted_photo(request: Request, file: UploadFile = File(...)) -> dict[str, str]:
    require_admin(request)
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Можно загружать только изображения")
    formats = {"image/png": ("PNG", ".png"), "image/jpeg": ("JPEG", ".jpg"), "image/webp": ("WEBP", ".webp"), "image/gif": ("PNG", ".png")}
    target_format = formats.get(file.content_type)
    if target_format is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Поддерживаются PNG, JPG, WEBP и GIF")
    content = await file.read(get_settings().max_upload_bytes + 1)
    if len(content) > get_settings().max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Файл слишком большой")
    try:
        with Image.open(BytesIO(content)) as source:
            source.verify()
        with Image.open(BytesIO(content)) as source:
            image = ImageOps.exif_transpose(source)
            if target_format[0] == "JPEG" and image.mode != "RGB":
                image = image.convert("RGB")
            elif image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if target_format[0] in {"PNG", "WEBP"} else "RGB")
            output = BytesIO()
            image.save(output, format=target_format[0], **({"quality": 88} if target_format[0] in {"JPEG", "WEBP"} else {}))
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Файл не является корректным изображением") from exc
    filename = f"{uuid.uuid4().hex}{target_format[1]}"
    path = _photo_host_path(filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(output.getvalue())
    with db_session() as db:
        db.execute(photo_host_images.insert().values(filename=filename))
    log_admin_event(request, "upload_hosted_photo", filename)
    return {"filename": filename, "url": f"/api/photo-host/{filename}"}


@router.delete("/admin/photo-host/{filename}")
async def admin_delete_hosted_photo(filename: str, request: Request) -> dict[str, bool]:
    require_admin(request)
    target = _photo_host_path(filename)
    with db_session() as db:
        deleted = db.execute(delete(photo_host_images).where(photo_host_images.c.filename == filename)).rowcount > 0
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Изображение не найдено")
    if target.exists():
        target.unlink()
    log_admin_event(request, "delete_hosted_photo", filename)
    return {"deleted": True}
