import hmac

from fastapi import HTTPException, status

from app.config import get_settings
from app.repositories.docs_store import resolve_doc_access
from app.repositories.forms_store import resolve_access
from app.repositories.sessions import store_refresh_token
from app.repositories.users import ensure_user, verify_password
from app.schemas.models import LoginRequest, LoginResponse, Soldier
from app.utils.security import create_refresh_token, create_token, set_auth_cookies, token_expires_at


def build_login_response(
    soldier: Soldier,
    user: dict,
    requires_password_setup: bool | None = None,
    response=None,
    discord_verified: bool = False,
    requires_discord_verification: bool = False,
    verification_resend_available_in: int = 0,
    verification_sends_remaining: int = 0,
    discord_delivery_failed: bool = False,
) -> LoginResponse:
    settings = get_settings()
    is_default_admin = soldier.nickname.casefold() == settings.default_admin_name
    is_admin = is_default_admin or bool(user.get("is_admin"))
    form_access = resolve_access(soldier, is_admin)
    doc_access = resolve_doc_access(soldier, is_admin)
    setup_required = (not is_default_admin and not bool(user.get("password_hash"))) if requires_password_setup is None else requires_password_setup
    setup_required = setup_required or requires_discord_verification
    token = create_token(
        nickname=soldier.nickname,
        is_admin=is_admin,
        is_officer=bool(form_access["is_officer"]) or bool(doc_access["is_officer"]),
        is_instructor=bool(form_access["is_instructor"]) or bool(doc_access["is_instructor"]),
        access_groups=list(form_access["groups"]),
        form_access_groups=list(form_access["groups"]),
        doc_access_groups=list(doc_access["groups"]),
        setup_required=setup_required,
        discord_verified=discord_verified,
    )
    refresh_token = create_refresh_token(soldier.nickname)
    store_refresh_token(refresh_token, soldier.nickname, token_expires_at(refresh_token))
    if response is not None:
        set_auth_cookies(response, token, refresh_token)
    return LoginResponse(
        token="",
        refresh_token="",
        profile=soldier,
        is_admin=is_admin,
        is_officer=bool(form_access["is_officer"]) or bool(doc_access["is_officer"]),
        is_instructor=bool(form_access["is_instructor"]) or bool(doc_access["is_instructor"]),
        access_groups=list(form_access["groups"]),
        form_access_groups=list(form_access["groups"]),
        doc_access_groups=list(doc_access["groups"]),
        requires_password_setup=requires_password_setup if requires_password_setup is not None else setup_required,
        requires_discord_verification=requires_discord_verification,
        verification_resend_available_in=verification_resend_available_in,
        verification_sends_remaining=verification_sends_remaining,
        discord_delivery_failed=discord_delivery_failed,
    )


def authenticate_login(payload: LoginRequest, soldier: Soldier) -> tuple[dict, bool]:
    settings = get_settings()
    user = ensure_user(soldier.nickname)
    stored_password = user.get("password_hash")
    is_default_admin = soldier.nickname.casefold() == settings.default_admin_name
    if is_default_admin:
        if not payload.password or not hmac.compare_digest(payload.password, settings.default_admin_password):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужен правильный пароль")
    elif stored_password:
        if not payload.password or not verify_password(payload.password, stored_password):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужен правильный пароль")
    return user, False if is_default_admin else not bool(stored_password)
