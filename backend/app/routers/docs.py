from fastapi import APIRouter, HTTPException, Request, status

from app.repositories.audit import log_admin_event
from app.repositories.docs_store import create_doc, create_docs_section, delete_doc, delete_docs_section, get_doc_for_view, list_docs_sections, move_doc, move_docs_section, resolve_doc_access, update_doc
from app.schemas.models import DocItem, DocPayload, DocsSection, DocsSectionPayload, MovePayload
from app.services.sheets import find_soldier
from app.utils.security import is_current_admin, require_admin, require_ready_session

router = APIRouter(prefix="/api")


@router.get("/docs", response_model=list[DocsSection])
async def docs(request: Request) -> list[DocsSection]:
    session = require_ready_session(request)
    soldier = find_soldier(str(session.get("nickname", "")))
    if soldier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Профиль больше не найден")
    is_admin = is_current_admin(soldier.nickname)
    access = resolve_doc_access(soldier, is_admin)
    return list_docs_sections(
        is_admin,
        list(access["groups"]),
        bool(access["is_officer"]),
        bool(access["is_instructor"]),
    )


@router.get("/docs/{doc_id}", response_model=DocItem)
async def doc(doc_id: str, request: Request) -> DocItem:
    session = require_ready_session(request)
    soldier = find_soldier(str(session.get("nickname", "")))
    if soldier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Профиль больше не найден")
    is_admin = is_current_admin(soldier.nickname)
    access = resolve_doc_access(soldier, is_admin)
    found = get_doc_for_view(
        doc_id,
        is_admin,
        list(access["groups"]),
        bool(access["is_officer"]),
        bool(access["is_instructor"]),
    )
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Документ не найден")
    return found


@router.post("/admin/docs-sections", response_model=DocsSection)
async def admin_create_docs_section(payload: DocsSectionPayload, request: Request) -> DocsSection:
    require_admin(request)
    section = create_docs_section(payload)
    log_admin_event(request, "create_docs_section", section.id, {"title": section.title, "audience": section.audience})
    return section


@router.delete("/admin/docs-sections/{section_id}")
async def admin_delete_docs_section(section_id: str, request: Request) -> dict[str, bool]:
    require_admin(request)
    if not delete_docs_section(section_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Раздел документации не найден")
    log_admin_event(request, "delete_docs_section", section_id)
    return {"deleted": True}


@router.post("/admin/docs-sections/{section_id}/move")
async def admin_move_docs_section(section_id: str, payload: MovePayload, request: Request) -> dict[str, bool]:
    require_admin(request)
    if not move_docs_section(section_id, payload.direction):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Невозможно переместить раздел")
    log_admin_event(request, "move_docs_section", section_id, {"direction": payload.direction})
    return {"moved": True}


@router.post("/admin/docs", response_model=DocItem)
async def admin_create_doc(payload: DocPayload, request: Request) -> DocItem:
    require_admin(request)
    doc = create_doc(payload)
    log_admin_event(request, "create_doc", doc.id, {"title": doc.title, "section_id": doc.section_id})
    return doc


@router.patch("/admin/docs/{doc_id}", response_model=DocItem)
async def admin_update_doc(doc_id: str, payload: DocPayload, request: Request) -> DocItem:
    require_admin(request)
    updated = update_doc(doc_id, payload)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Документ не найден")
    log_admin_event(request, "update_doc", doc_id, {"title": updated.title, "section_id": updated.section_id})
    return updated


@router.post("/admin/docs/{doc_id}/move")
async def admin_move_doc(doc_id: str, payload: MovePayload, request: Request) -> dict[str, bool]:
    require_admin(request)
    if not move_doc(doc_id, payload.direction):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Невозможно переместить документ")
    log_admin_event(request, "move_doc", doc_id, {"direction": payload.direction})
    return {"moved": True}


@router.delete("/admin/docs/{doc_id}")
async def admin_delete_doc(doc_id: str, request: Request) -> dict[str, bool]:
    require_admin(request)
    if not delete_doc(doc_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Документ не найден")
    log_admin_event(request, "delete_doc", doc_id)
    return {"deleted": True}
