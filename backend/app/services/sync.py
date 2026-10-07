import logging
from datetime import datetime, timezone

from app.services.sheets import (
    sync_competencies_from_sheet,
    sync_medals_from_sheet,
    sync_online_from_sheet,
    sync_soldiers_from_sheet,
)

logger = logging.getLogger(__name__)

SYNC_JOBS = (
    ("soldiers", "состав", sync_soldiers_from_sheet),
    ("competencies", "компетенции", sync_competencies_from_sheet),
    ("online", "онлайн", sync_online_from_sheet),
    ("medals", "медали", sync_medals_from_sheet),
)


async def sync_all_tables() -> dict:
    synced: dict[str, int] = {}
    errors: dict[str, str] = {}
    for key, name, sync_job in SYNC_JOBS:
        try:
            synced[key] = await sync_job()
        except Exception as exc:
            errors[key] = str(exc)
            logger.exception("Не удалось обновить лист: %s", name)
    if synced:
        logger.info("Таблицы обновлены: %s", ", ".join(f"{key} — {value} строк" for key, value in synced.items()))
    return {
        "soldiers": synced.get("soldiers", 0),
        "competencies": synced.get("competencies", 0),
        "online": synced.get("online", 0),
        "medals": synced.get("medals", 0),
        "errors": errors,
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }
