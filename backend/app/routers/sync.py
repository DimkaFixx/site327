from fastapi import APIRouter, HTTPException, Request, status

from app.services.sync import sync_all_tables
from app.utils.security import require_sync_secret

router = APIRouter(prefix="/api/system")


@router.post("/sync")
async def force_sync(request: Request) -> dict:
    require_sync_secret(request)
    result = await sync_all_tables()
    if result["errors"] and not any(result[key] for key in ("soldiers", "competencies", "online", "medals")):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail={"message": "Не удалось обновить ни один лист", "errors": result["errors"]},
        )
    return result
