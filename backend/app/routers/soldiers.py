from fastapi import APIRouter, HTTPException, Request, status

from app.repositories.audit import log_admin_event
from app.repositories.docs_store import resolve_doc_access
from app.repositories.forms_store import resolve_access
from app.repositories.regulations_store import get_equipment_for_soldier
from app.schemas.models import CompetenciesResponse, EquipmentResponse, LoginResponse, Soldier
from app.services.sheets import fetch_soldiers, find_soldier, get_competencies_for_soldier, public_soldier, sync_competencies_from_sheet, sync_medals_from_sheet, sync_online_from_sheet, sync_soldiers_from_sheet
from app.utils.security import is_current_admin, is_docs_manager, require_admin, require_ready_session

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
        profile=public_soldier(soldier),
        is_admin=is_admin,
        is_docs_manager=is_docs_manager(soldier.nickname),
        is_officer=bool(form_access["is_officer"]) or bool(doc_access["is_officer"]),
        is_instructor=bool(form_access["is_instructor"]) or bool(doc_access["is_instructor"]),
        access_groups=list(form_access["groups"]),
        form_access_groups=list(form_access["groups"]),
        doc_access_groups=list(doc_access["groups"]),
    )


@router.get("/soldiers", response_model=list[Soldier])
async def soldiers(request: Request) -> list[Soldier]:
    require_ready_session(request)
    return [public_soldier(soldier) for soldier in fetch_soldiers()]


@router.get("/equipment", response_model=EquipmentResponse)
async def equipment(request: Request) -> EquipmentResponse:
    session = require_ready_session(request)
    soldier = find_soldier(str(session.get("nickname", "")))
    if soldier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Профиль больше не найден")
    return get_equipment_for_soldier(soldier)


@router.get("/competencies", response_model=CompetenciesResponse)
async def competencies(request: Request) -> CompetenciesResponse:
    session = require_ready_session(request)
    soldier = find_soldier(str(session.get("nickname", "")))
    if soldier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Профиль больше не найден")
    return await get_competencies_for_soldier(soldier)


@router.post("/admin/soldiers-sync")
async def admin_sync_soldiers(request: Request) -> dict[str, int]:
    require_admin(request)
    soldiers_synced = await sync_soldiers_from_sheet()
    online_rows = await sync_online_from_sheet()
    log_admin_event(request, "sync_soldiers", details={"soldiers": soldiers_synced, "online_rows": online_rows})
    return {"soldiers": soldiers_synced, "online_rows": online_rows}


@router.post("/admin/competencies-sync")
async def admin_sync_competencies(request: Request) -> dict[str, int]:
    require_admin(request)
    rows_synced = await sync_competencies_from_sheet()
    medals_rows = await sync_medals_from_sheet()
    log_admin_event(request, "sync_competencies", details={"rows": rows_synced, "medals_rows": medals_rows})
    return {"rows": rows_synced, "medals_rows": medals_rows}
