import asyncio
from contextlib import suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.repositories.database import init_db
from app.routers import admin, auth, docs, forms, health, home, soldiers, uploads
from app.services.sheets import has_cached_soldiers, seconds_until_next_sync, sync_soldiers_from_sheet
from app.utils.security import verify_csrf


settings = get_settings()
app = FastAPI(title="327 Star Corp API", version="0.1.0")
sync_task: asyncio.Task | None = None

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
    csrf_exempt_paths = {"/api/auth/login", "/api/auth/refresh", "/api/auth/logout"}
    if request.method in {"POST", "PATCH", "DELETE"} and request.url.path not in csrf_exempt_paths:
        verify_csrf(request)
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
    if not has_cached_soldiers():
        await sync_soldiers_from_sheet()
    sync_task = asyncio.create_task(soldiers_sync_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    if sync_task:
        sync_task.cancel()
        with suppress(asyncio.CancelledError):
            await sync_task


async def soldiers_sync_loop() -> None:
    while True:
        await asyncio.sleep(seconds_until_next_sync())
        with suppress(Exception):
            await sync_soldiers_from_sheet()
