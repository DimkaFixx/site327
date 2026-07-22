from typing import Any

from fastapi import Request
from sqlalchemy import insert, select

from app.repositories.database import audit_events, db_session
from app.utils.security import get_session


def log_admin_event(request: Request, action: str, target: str = "", details: dict[str, Any] | None = None) -> None:
    try:
        session = get_session(request)
        actor = str(session.get("nickname", "unknown"))
    except Exception:
        actor = "unknown"
    with db_session() as db:
        db.execute(
            insert(audit_events).values(
                actor=actor,
                action=action,
                target=target,
                details=details or {},
            )
        )


def list_audit_events(limit: int = 200) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 1000))
    with db_session() as db:
        rows = (
            db.execute(select(audit_events).order_by(audit_events.c.id.desc()).limit(safe_limit))
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]
