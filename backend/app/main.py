import asyncio
import logging
from contextlib import suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.repositories.database import init_db
from app.routers import admin, auth, docs, forms, health, home, soldiers, uploads
from app.services.sheets import has_cached_competencies, has_cached_medals, has_cached_online, has_cached_soldiers, sync_competencies_from_sheet, sync_medals_from_sheet, sync_online_from_sheet, sync_soldiers_from_sheet
from app.utils.security import verify_csrf


settings = get_settings()
app = FastAPI(title="327 Star Corp API", version="0.1.0")
sync_task: asyncio.Task | None = None
logger = logging.getLogger(__name__)
TABLE_SYNC_INTERVAL_SECONDS = 5 * 60

uploads_path = Path(settings.uploads_path)
uploads_path.mkdir(parents=True, exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
)


@app.middleware("http")
async def csrf_middleware(request, call_next):
    # Refresh validates Origin in its own handler.  Exempting it here lets
    # sessions created before the CSRF cookie was introduced recover once and
    # receive a fresh CSRF cookie instead of being trapped in an auth loop.
    csrf_exempt_paths = {"/api/auth/login", "/api/auth/refresh"}
    if request.method in {"POST", "PATCH", "DELETE"} and request.url.path not in csrf_exempt_paths:
        try:
            verify_csrf(request)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return await call_next(request)

app.include_router(health.router)
app.include_router(home.router)
app.include_router(auth.router)
app.include_router(soldiers.router)
app.include_router(forms.router)
app.include_router(docs.router)
app.include_router(uploads.router)
app.include_router(admin.router)


@app.on_event("startup")
async def startup() -> None:
    global sync_task
    init_db()
    if not has_cached_soldiers() or not has_cached_competencies() or (settings.google_online_sheet_gid.strip() and not has_cached_online()) or (settings.google_medals_sheet_gid.strip() and not has_cached_medals()):
        await sync_tables()
    sync_task = asyncio.create_task(soldiers_sync_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    if sync_task:
        sync_task.cancel()
        with suppress(asyncio.CancelledError):
            await sync_task


async def soldiers_sync_loop() -> None:
    while True:
        await asyncio.sleep(TABLE_SYNC_INTERVAL_SECONDS)
        await sync_tables()


async def sync_tables() -> None:
    try:
        soldiers_count = await sync_soldiers_from_sheet()
        competencies_rows = await sync_competencies_from_sheet()
        online_rows = await sync_online_from_sheet()
        medals_rows = await sync_medals_from_sheet()
        logger.info("Таблицы обновлены автоматически: состав — %s, компетенции — %s строк, онлайн — %s строк, медали — %s строк", soldiers_count, competencies_rows, online_rows, medals_rows)
    except Exception:
        logger.exception("Не удалось обновить таблицы автоматически")
