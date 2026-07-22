import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, insert, select, update

from app.config import get_settings
from app.repositories.database import db_session, verification_codes
from app.repositories.users import normalize_nickname


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def hash_code(code: str) -> str:
    settings = get_settings()
    return hashlib.sha256(f"{settings.token_secret}:{code}".encode("utf-8")).hexdigest()


def generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def get_active_verification(nickname: str) -> dict[str, Any] | None:
    normalized = normalize_nickname(nickname)
    now = _now()
    with db_session() as db:
        rows = (
            db.execute(
                select(verification_codes)
                .where(verification_codes.c.normalized_nickname == normalized, verification_codes.c.used_at.is_(None))
                .order_by(verification_codes.c.id.desc())
            )
            .mappings()
            .all()
        )
        for row in rows:
            item = dict(row)
            locked_until = item.get("locked_until")
            if _aware(item["expires_at"]) >= now or (locked_until and _aware(locked_until) >= now):
                return item
    return None


def create_verification(nickname: str, discord_id: str, code: str) -> dict[str, Any]:
    settings = get_settings()
    now = _now()
    expires_at = now + timedelta(seconds=settings.discord_code_ttl_seconds)
    normalized = normalize_nickname(nickname)
    with db_session() as db:
        db.execute(
            update(verification_codes)
            .where(verification_codes.c.normalized_nickname == normalized, verification_codes.c.used_at.is_(None))
            .values(used_at=now)
        )
        result = db.execute(
            insert(verification_codes)
            .values(
                normalized_nickname=normalized,
                discord_id=discord_id,
                code_hash=hash_code(code),
                code_plain=code,
                send_count=1,
                attempt_count=0,
                expires_at=expires_at,
                last_sent_at=now,
            )
        )
        verification_id = result.inserted_primary_key[0]
        row = db.execute(select(verification_codes).where(verification_codes.c.id == verification_id)).mappings().one()
        return dict(row)


def reset_verifications(nickname: str) -> None:
    normalized = normalize_nickname(nickname)
    now = _now()
    with db_session() as db:
        db.execute(
            update(verification_codes)
            .where(verification_codes.c.normalized_nickname == normalized, verification_codes.c.used_at.is_(None))
            .values(used_at=now, code_plain=None)
        )


def delete_verifications(nickname: str) -> int:
    """Delete every verification attempt for a user, including expired ones."""
    normalized = normalize_nickname(nickname)
    with db_session() as db:
        result = db.execute(delete(verification_codes).where(verification_codes.c.normalized_nickname == normalized))
    return int(result.rowcount or 0)


def can_resend_verification(verification: dict[str, Any]) -> tuple[bool, int, str]:
    settings = get_settings()
    locked_until = verification.get("locked_until")
    if locked_until and _aware(locked_until) >= _now():
        wait_seconds = max(0, int((_aware(locked_until) - _now()).total_seconds()))
        return False, wait_seconds, f"Слишком много неверных попыток. Новый код можно запросить через {wait_seconds} сек."
    if int(verification["send_count"]) >= settings.discord_code_max_sends:
        return False, 0, "Достигнут лимит отправок кода"
    elapsed = (_now() - _aware(verification["last_sent_at"])).total_seconds()
    wait_seconds = max(0, settings.discord_code_resend_cooldown_seconds - int(elapsed))
    if wait_seconds > 0:
        return False, wait_seconds, f"Повторная отправка будет доступна через {wait_seconds} сек."
    return True, 0, ""


def mark_code_resent(verification_id: int, code: str) -> dict[str, Any]:
    settings = get_settings()
    now = _now()
    expires_at = now + timedelta(seconds=settings.discord_code_ttl_seconds)
    with db_session() as db:
        db.execute(
            update(verification_codes)
            .where(verification_codes.c.id == verification_id)
            .values(
                code_hash=hash_code(code),
                code_plain=code,
                send_count=verification_codes.c.send_count + 1,
                attempt_count=0,
                expires_at=expires_at,
                last_sent_at=now,
                locked_until=None,
            )
        )
        row = db.execute(select(verification_codes).where(verification_codes.c.id == verification_id)).mappings().one()
        return dict(row)


def verify_code(nickname: str, code: str) -> tuple[bool, int]:
    verification = get_active_verification(nickname)
    if not verification:
        return False, 0
    settings = get_settings()
    locked_until = verification.get("locked_until")
    if locked_until and _aware(locked_until) >= _now():
        return False, max(0, int((_aware(locked_until) - _now()).total_seconds()))
    if int(verification["attempt_count"]) >= settings.discord_code_max_attempts:
        return False, 0
    now = _now()
    expected = verification["code_hash"]
    actual = hash_code(code.strip())
    with db_session() as db:
        if secrets.compare_digest(expected, actual):
            db.execute(
                update(verification_codes)
                .where(verification_codes.c.id == verification["id"])
                .values(used_at=now, code_plain=None)
            )
            return True, 0
        next_attempt_count = int(verification["attempt_count"]) + 1
        values = {"attempt_count": verification_codes.c.attempt_count + 1}
        lockout_seconds = 0
        if next_attempt_count >= settings.discord_code_max_attempts:
            locked_until = now + timedelta(seconds=settings.discord_code_failed_lockout_seconds)
            lockout_seconds = settings.discord_code_failed_lockout_seconds
            values["locked_until"] = locked_until
            values["expires_at"] = locked_until
        db.execute(
            update(verification_codes)
            .where(verification_codes.c.id == verification["id"])
            .values(**values)
        )
    return False, lockout_seconds


def list_active_verification_codes() -> list[dict[str, Any]]:
    now = _now()
    with db_session() as db:
        rows = (
            db.execute(
                select(verification_codes)
                .where(verification_codes.c.used_at.is_(None), verification_codes.c.code_plain.is_not(None))
                .order_by(verification_codes.c.created_at.desc())
            )
            .mappings()
            .all()
        )
        result: list[dict[str, Any]] = []
        expired_ids: list[int] = []
        for row in rows:
            item = dict(row)
            locked_until = item.get("locked_until")
            if _aware(item["expires_at"]) >= now or (locked_until and _aware(locked_until) >= now):
                result.append(item)
            else:
                expired_ids.append(int(item["id"]))
        if expired_ids:
            db.execute(
                update(verification_codes)
                .where(verification_codes.c.id.in_(expired_ids))
                .values(used_at=now, code_plain=None)
            )
    return result
