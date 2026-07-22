from fastapi import APIRouter, HTTPException, Request, status

from app.repositories.audit import log_admin_event
from app.repositories.docs_store import resolve_doc_access
from app.repositories.forms_store import resolve_access
from app.schemas.models import LoginResponse, Soldier
from app.services.sheets import fetch_soldiers, find_soldier, sync_soldiers_from_sheet
from app.utils.security import is_current_admin, require_admin, require_ready_session

router = APIRouter(prefix="/api")


@router.get("/me", response_model=LoginResponse)
async def me(request: Request) -> LoginResponse:
    session = require_ready_session(request)
    soldier = find_soldier(session["nickname"])
    if soldier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Профиль больше не найден")
    is_admin = is_current_admin(soldier.nickname)
    form_access = resolve_access(soldier, is_admin)
    doc_access = resolve_doc_access(soldier, is_admin)
    return LoginResponse(
        token="",
        profile=soldier,
        is_admin=is_admin,
        is_officer=bool(form_access["is_officer"]) or bool(doc_access["is_officer"]),
        is_instructor=bool(form_access["is_instructor"]) or bool(doc_access["is_instructor"]),
        access_groups=list(form_access["groups"]),
        form_access_groups=list(form_access["groups"]),
        doc_access_groups=list(doc_access["groups"]),
    )


@router.get("/soldiers", response_model=list[Soldier])
async def soldiers(request: Request) -> list[Soldier]:
    require_ready_session(request)
    return fetch_soldiers()


@router.post("/admin/soldiers-sync")
async def admin_sync_soldiers(request: Request) -> dict[str, int]:
    require_admin(request)
    synced = await sync_soldiers_from_sheet()
    log_admin_event(request, "sync_soldiers", details={"synced": synced})
    return {"synced": synced}
