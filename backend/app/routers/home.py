from fastapi import APIRouter, Request

from app.repositories.audit import log_admin_event
from app.repositories.home_store import load_home_page, save_home_page
from app.schemas.models import HomePage
from app.utils.security import require_admin


router = APIRouter(prefix="/api")


@router.get("/home", response_model=HomePage)
async def home_page() -> HomePage:
    return load_home_page()


@router.patch("/admin/home", response_model=HomePage)
async def admin_update_home_page(payload: HomePage, request: Request) -> HomePage:
    require_admin(request)
    page = save_home_page(payload)
    log_admin_event(request, "update_home_page", "home", {"title": page.title})
    return page
