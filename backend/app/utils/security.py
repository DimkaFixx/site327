import base64
import binascii
import hashlib
import hmac
import json
import secrets
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, Request, Response, status

from app.config import get_settings
from app.repositories.users import get_user, normalize_nickname


CSRF_COOKIE_NAME = "star327_csrf"
CSRF_HEADER_NAME = "x-csrf-token"


def _b64encode(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).decode("utf-8").rstrip("=")


def _b64decode(payload: str) -> bytes:
    padding = "=" * (-len(payload) % 4)
    return base64.urlsafe_b64decode(payload + padding)


def create_token(
    nickname: str,
    is_admin: bool,
    is_officer: bool = False,
    is_instructor: bool = False,
    access_groups: list[str] | None = None,
    form_access_groups: list[str] | None = None,
    doc_access_groups: list[str] | None = None,
    setup_required: bool = False,
    discord_verified: bool = False,
    token_type: str = "access",
    ttl_seconds: int | None = None,
) -> str:
    settings = get_settings()
    issued_at = int(time.time())
    body = {
        "typ": token_type,
        "nickname": nickname,
        "is_admin": is_admin,
        "is_officer": is_officer,
        "is_instructor": is_instructor,
        "access_groups": access_groups or [],
        "form_access_groups": form_access_groups or access_groups or [],
        "doc_access_groups": doc_access_groups or [],
        "setup_required": setup_required,
        "discord_verified": discord_verified,
        "jti": uuid.uuid4().hex,
        "iat": issued_at,
        "exp": issued_at + (ttl_seconds if ttl_seconds is not None else settings.token_ttl_seconds),
    }
    encoded_body = _b64encode(json.dumps(body, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(
        settings.token_secret.encode("utf-8"),
        encoded_body.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return f"{encoded_body}.{_b64encode(signature)}"


def create_refresh_token(nickname: str) -> str:
    settings = get_settings()
    return create_token(
        nickname=nickname,
        is_admin=False,
        is_officer=False,
        is_instructor=False,
        setup_required=False,
        discord_verified=False,
        token_type="refresh",
        ttl_seconds=settings.refresh_token_ttl_seconds,
    )


def token_expires_at(token: str) -> datetime:
    payload = decode_token(token, expected_type="refresh")
    return datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc)


def decode_token(token: str, expected_type: str = "access") -> dict[str, Any]:
    settings = get_settings()
    try:
        encoded_body, encoded_signature = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc

    expected = hmac.new(
        settings.token_secret.encode("utf-8"),
        encoded_body.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    try:
        actual = _b64decode(encoded_signature)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc
    if not hmac.compare_digest(expected, actual):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    try:
        payload = json.loads(_b64decode(encoded_body))
    except (binascii.Error, json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc
    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    token_type = payload.get("typ")
    if expected_type == "refresh" and token_type != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token type")
    if expected_type == "access" and token_type not in (None, "access"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token type")
    return payload


def get_session(request: Request) -> dict[str, Any]:
    token = request.cookies.get("star327_access")
    auth = request.headers.get("Authorization", "")
    if not token and auth.startswith("Bearer "):
        token = auth.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authorization required")
    return decode_token(token)


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    settings = get_settings()
    cookie_args = {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "path": "/",
    }
    response.set_cookie("star327_access", access_token, max_age=settings.token_ttl_seconds, **cookie_args)
    response.set_cookie("star327_refresh", refresh_token, max_age=settings.refresh_token_ttl_seconds, **cookie_args)
    response.set_cookie(
        CSRF_COOKIE_NAME,
        secrets.token_urlsafe(32),
        max_age=settings.refresh_token_ttl_seconds,
        httponly=False,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    settings = get_settings()
    cookie_args = {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "path": "/",
    }
    response.delete_cookie("star327_access", **cookie_args)
    response.delete_cookie("star327_refresh", **cookie_args)
    response.delete_cookie(
        CSRF_COOKIE_NAME,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )


def verify_csrf(request: Request) -> None:
    cookie_token = request.cookies.get(CSRF_COOKIE_NAME, "")
    header_token = request.headers.get(CSRF_HEADER_NAME, "")
    if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF validation failed")


def is_current_admin(nickname: str) -> bool:
    settings = get_settings()
    normalized = normalize_nickname(nickname)
    if normalized == settings.default_admin_name:
        return True
    user = get_user(nickname)
    return bool(user and user.get("is_admin"))


def require_admin(request: Request) -> dict[str, Any]:
    session = get_session(request)
    if session.get("setup_required"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Password setup required")
    if not is_current_admin(str(session.get("nickname", ""))):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return session


def require_ready_session(request: Request) -> dict[str, Any]:
    session = get_session(request)
    if session.get("setup_required"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Password setup required")
    return session
