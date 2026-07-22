from fastapi import APIRouter, HTTPException, Request, status

from app.repositories.audit import log_admin_event
from app.repositories.forms_store import create_form, create_tab, delete_form, delete_tab, list_tabs, resolve_access
from app.schemas.models import FormItem, FormPayload, FormTab, TabPayload
from app.services.sheets import find_soldier
from app.utils.security import is_current_admin, require_admin, require_ready_session

router = APIRouter(prefix="/api")


@router.get("/forms", response_model=list[FormTab])
async def forms(request: Request) -> list[FormTab]:
    session = require_ready_session(request)
    soldier = find_soldier(str(session.get("nickname", "")))
    if soldier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Профиль больше не найден")
    is_admin = is_current_admin(soldier.nickname)
    access = resolve_access(soldier, is_admin)
    return list_tabs(
        is_admin,
        list(access["groups"]),
        bool(access["is_officer"]),
        bool(access["is_instructor"]),
    )


@router.post("/admin/tabs", response_model=FormTab)
async def admin_create_tab(payload: TabPayload, request: Request) -> FormTab:
    require_admin(request)
    tab = create_tab(payload.title, payload.audience)
    log_admin_event(request, "create_form_tab", tab.id, {"title": tab.title, "audience": tab.audience})
    return tab


@router.delete("/admin/tabs/{tab_id}")
async def admin_delete_tab(tab_id: str, request: Request) -> dict[str, bool]:
    require_admin(request)
    if not delete_tab(tab_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Вкладка не найдена")
    log_admin_event(request, "delete_form_tab", tab_id)
    return {"deleted": True}


@router.post("/admin/forms", response_model=FormItem)
async def admin_create_form(payload: FormPayload, request: Request) -> FormItem:
    require_admin(request)
    form = create_form(payload.model_dump(mode="json"))
    log_admin_event(request, "create_form", form.id, {"title": form.title, "tab_id": form.tab_id})
    return form


@router.delete("/admin/forms/{form_id}")
async def admin_delete_form(form_id: str, request: Request) -> dict[str, bool]:
    require_admin(request)
    if not delete_form(form_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Форма не найдена")
    log_admin_event(request, "delete_form", form_id)
    return {"deleted": True}
