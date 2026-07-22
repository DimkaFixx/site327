from io import BytesIO
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import get_settings
from app.repositories.audit import list_audit_events, log_admin_event
from app.repositories.docs_store import create_doc_access_group, delete_doc_access_group, get_doc_access_rules, load_docs_store, update_doc_access_group
from app.repositories.forms_store import create_access_group, delete_access_group, get_access_rules, load_store, update_access_group
from app.repositories.sessions import revoke_user_refresh_tokens
from app.repositories.users import list_users, reset_user_password, set_user_roles
from app.repositories.verification import delete_verifications, list_active_verification_codes, reset_verifications
from app.schemas.models import AccessGroup, AccessGroupPayload, AccessRules, AuditEventItem, UserAccount, UserRolesPayload, VerificationCodeAdminItem
from app.utils.security import require_admin

router = APIRouter(prefix="/api/admin")
uploads_path = Path(get_settings().uploads_path)


@router.get("/forms-store")
async def admin_forms_store(request: Request):
    require_admin(request)
    return load_store()


@router.get("/docs-store")
async def admin_docs_store(request: Request):
    require_admin(request)
    return load_docs_store()


@router.post("/uploads/image")
async def admin_upload_image(request: Request, file: UploadFile = File(...)) -> dict[str, str]:
    settings = get_settings()
    require_admin(request)
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Можно загружать только изображения")

    format_by_type = {
        "image/png": ("PNG", ".png"),
        "image/jpeg": ("JPEG", ".jpg"),
        "image/webp": ("WEBP", ".webp"),
        "image/gif": ("PNG", ".png"),
    }
    output_format = format_by_type.get(file.content_type)
    if output_format is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Поддерживаются PNG, JPG, WEBP и GIF")

    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Файл слишком большой")

    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
        with Image.open(BytesIO(content)) as image:
            image = ImageOps.exif_transpose(image)
            if output_format[0] == "JPEG" and image.mode != "RGB":
                image = image.convert("RGB")
            elif image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if output_format[0] in {"PNG", "WEBP"} else "RGB")
            output = BytesIO()
            save_kwargs = {"quality": 88} if output_format[0] in {"JPEG", "WEBP"} else {}
            image.save(output, format=output_format[0], **save_kwargs)
            sanitized_content = output.getvalue()
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Файл не является корректным изображением") from exc

    uploads_path.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{output_format[1]}"
    destination = uploads_path / filename
    with destination.open("wb") as output:
        output.write(sanitized_content)
    log_admin_event(request, "upload_image", filename, {"content_type": file.content_type, "size": len(sanitized_content)})
    return {"url": f"/api/uploads/{filename}"}


@router.get("/access-rules", response_model=AccessRules)
async def admin_access_rules(request: Request) -> AccessRules:
    require_admin(request)
    return get_access_rules()


@router.get("/doc-access-rules", response_model=AccessRules)
async def admin_doc_access_rules(request: Request) -> AccessRules:
    require_admin(request)
    return get_doc_access_rules()


@router.post("/access-groups", response_model=AccessGroup)
async def admin_create_access_group(payload: AccessGroupPayload, request: Request) -> AccessGroup:
    require_admin(request)
    group = create_access_group(payload)
    log_admin_event(request, "create_form_access_group", group.id, {"title": group.title})
    return group


@router.patch("/access-groups/{group_id}", response_model=AccessGroup)
async def admin_update_access_group(group_id: str, payload: AccessGroupPayload, request: Request) -> AccessGroup:
    require_admin(request)
    updated = update_access_group(group_id, payload)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Группа доступа не найдена")
    log_admin_event(request, "update_form_access_group", group_id, {"title": updated.title})
    return updated


@router.delete("/access-groups/{group_id}")
async def admin_delete_access_group(group_id: str, request: Request) -> dict[str, bool]:
    require_admin(request)
    if not delete_access_group(group_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Группа доступа не найдена")
    log_admin_event(request, "delete_form_access_group", group_id)
    return {"deleted": True}


@router.post("/doc-access-groups", response_model=AccessGroup)
async def admin_create_doc_access_group(payload: AccessGroupPayload, request: Request) -> AccessGroup:
    require_admin(request)
    group = create_doc_access_group(payload)
    log_admin_event(request, "create_doc_access_group", group.id, {"title": group.title})
    return group


@router.patch("/doc-access-groups/{group_id}", response_model=AccessGroup)
async def admin_update_doc_access_group(group_id: str, payload: AccessGroupPayload, request: Request) -> AccessGroup:
    require_admin(request)
    updated = update_doc_access_group(group_id, payload)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Группа доступа документации не найдена")
    log_admin_event(request, "update_doc_access_group", group_id, {"title": updated.title})
    return updated


@router.delete("/doc-access-groups/{group_id}")
async def admin_delete_doc_access_group(group_id: str, request: Request) -> dict[str, bool]:
    require_admin(request)
    if not delete_doc_access_group(group_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Группа доступа документации не найдена")
    log_admin_event(request, "delete_doc_access_group", group_id)
    return {"deleted": True}


@router.get("/users", response_model=list[UserAccount])
async def admin_users(request: Request) -> list[UserAccount]:
    settings = get_settings()
    require_admin(request)
    return [
        UserAccount(
            nickname=user["nickname"],
            has_password=bool(user.get("password_hash")),
            is_admin=bool(user.get("is_admin")) or user["normalized_nickname"] == settings.default_admin_name,
            is_default_admin=user["normalized_nickname"] == settings.default_admin_name,
        )
        for user in list_users()
    ]


@router.get("/verification-codes", response_model=list[VerificationCodeAdminItem])
async def admin_verification_codes(request: Request) -> list[VerificationCodeAdminItem]:
    require_admin(request)
    log_admin_event(request, "view_verification_codes")
    return [
        VerificationCodeAdminItem(
            nickname=item["normalized_nickname"],
            discord_id=item["discord_id"],
            code=item["code_plain"],
            send_count=int(item["send_count"]),
            attempt_count=int(item["attempt_count"]),
            expires_at=item["expires_at"],
            locked_until=item.get("locked_until"),
        )
        for item in list_active_verification_codes()
    ]


@router.delete("/verification-codes/{nickname}")
async def admin_delete_verification_codes(nickname: str, request: Request) -> dict[str, int]:
    require_admin(request)
    deleted = delete_verifications(nickname)
    log_admin_event(request, "delete_verification_codes", nickname, {"deleted": deleted})
    return {"deleted": deleted}


@router.patch("/users/{nickname}/roles", response_model=UserAccount)
async def admin_update_user_roles(nickname: str, payload: UserRolesPayload, request: Request) -> UserAccount:
    settings = get_settings()
    require_admin(request)
    normalized = nickname.strip().strip("`").strip().casefold()
    is_default_admin = normalized == settings.default_admin_name
    saved = set_user_roles(nickname, payload.is_admin)
    if not saved:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    revoke_user_refresh_tokens(nickname)
    log_admin_event(request, "update_user_roles", nickname, {"is_admin": payload.is_admin})
    return UserAccount(
        nickname=nickname,
        has_password=bool(next((user for user in list_users() if user["normalized_nickname"] == normalized), {}).get("password_hash")),
        is_admin=payload.is_admin or is_default_admin,
        is_default_admin=is_default_admin,
    )


@router.delete("/users/{nickname}/password")
async def admin_reset_user_password(nickname: str, request: Request) -> dict[str, bool]:
    require_admin(request)
    if not reset_user_password(nickname):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    revoke_user_refresh_tokens(nickname)
    reset_verifications(nickname)
    log_admin_event(request, "reset_user_password", nickname)
    return {"reset": True}


@router.get("/audit", response_model=list[AuditEventItem])
async def admin_audit_events(request: Request, limit: int = 200) -> list[AuditEventItem]:
    require_admin(request)
    return [AuditEventItem(**item) for item in list_audit_events(limit)]
