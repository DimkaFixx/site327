import hashlib
from datetime import datetime, timezone

from sqlalchemy import insert, select, update

from app.repositories.database import db_session, refresh_sessions
from app.repositories.users import normalize_nickname


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def store_refresh_token(token: str, nickname: str, expires_at: datetime) -> None:
    with db_session() as db:
        db.execute(
            insert(refresh_sessions).values(
                token_hash=hash_token(token),
                nickname=normalize_nickname(nickname),
                expires_at=expires_at,
            )
        )


def is_refresh_token_active(token: str) -> bool:
    now = datetime.now(timezone.utc)
    with db_session() as db:
        row = (
            db.execute(select(refresh_sessions).where(refresh_sessions.c.token_hash == hash_token(token)))
            .mappings()
            .first()
        )
        if not row:
            return False
        expires_at = row["expires_at"]
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return row["revoked_at"] is None and expires_at >= now


def revoke_refresh_token(token: str) -> None:
    with db_session() as db:
        db.execute(
            update(refresh_sessions)
            .where(refresh_sessions.c.token_hash == hash_token(token), refresh_sessions.c.revoked_at.is_(None))
            .values(revoked_at=datetime.now(timezone.utc))
        )


def revoke_user_refresh_tokens(nickname: str) -> None:
    with db_session() as db:
        db.execute(
            update(refresh_sessions)
            .where(refresh_sessions.c.nickname == normalize_nickname(nickname), refresh_sessions.c.revoked_at.is_(None))
            .values(revoked_at=datetime.now(timezone.utc))
        )
