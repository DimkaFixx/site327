import base64
import hashlib
import hmac
import os
from datetime import datetime
from typing import Any

from sqlalchemy import delete, insert, select, update

from app.repositories.database import db_session, users


def normalize_nickname(nickname: str) -> str:
    return nickname.strip().strip("`").strip().casefold()


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 210_000)
    return "pbkdf2_sha256$210000${}${}".format(
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt, expected = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            base64.b64decode(salt),
            int(iterations),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(base64.b64encode(digest).decode("ascii"), expected)


def get_user(nickname: str) -> dict[str, Any] | None:
    normalized = normalize_nickname(nickname)
    with db_session() as db:
        row = db.execute(select(users).where(users.c.normalized_nickname == normalized)).mappings().first()
        return dict(row) if row else None


def ensure_user(nickname: str) -> dict[str, Any]:
    normalized = normalize_nickname(nickname)
    existing = get_user(nickname)
    if existing:
        return existing

    with db_session() as db:
        db.execute(insert(users).values(nickname=nickname.strip(), normalized_nickname=normalized))
    created = get_user(nickname)
    if created is None:
        raise RuntimeError("User was not created")
    return created


def set_user_password(nickname: str, password: str) -> None:
    normalized = normalize_nickname(nickname)
    with db_session() as db:
        db.execute(
            update(users)
            .where(users.c.normalized_nickname == normalized)
            .values(password_hash=hash_password(password), updated_at=datetime.utcnow())
        )


def reset_user_password(nickname: str) -> bool:
    normalized = normalize_nickname(nickname)
    with db_session() as db:
        result = db.execute(
            update(users)
            .where(users.c.normalized_nickname == normalized)
            .values(password_hash=None, updated_at=datetime.utcnow())
        )
        return result.rowcount > 0


def set_user_roles(nickname: str, is_admin: bool) -> bool:
    normalized = normalize_nickname(nickname)
    with db_session() as db:
        result = db.execute(
            update(users)
            .where(users.c.normalized_nickname == normalized)
            .values(is_admin=is_admin, updated_at=datetime.utcnow())
        )
        return result.rowcount > 0


def delete_user(nickname: str) -> bool:
    normalized = normalize_nickname(nickname)
    with db_session() as db:
        result = db.execute(delete(users).where(users.c.normalized_nickname == normalized))
        return result.rowcount > 0


def list_users() -> list[dict[str, Any]]:
    with db_session() as db:
        rows = db.execute(select(users).order_by(users.c.nickname)).mappings().all()
        return [dict(row) for row in rows]
