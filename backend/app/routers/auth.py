import re

from fastapi import APIRouter, Body, HTTPException, Request, Response, status

from app.config import get_settings
from app.repositories.sessions import is_refresh_token_active, revoke_refresh_token, revoke_user_refresh_tokens
from app.repositories.users import ensure_user, set_user_password
from app.repositories.verification import can_resend_verification, create_verification, generate_code, get_active_verification, mark_code_resent, verify_code
from app.schemas.models import LoginRequest, LoginResponse, PasswordPayload, RefreshRequest, VerificationCodePayload
from app.services.auth import authenticate_login, build_login_response
from app.services.discord import send_verification_code
from app.services.sheets import find_soldier
from app.utils.rate_limit import clear_rate_limit, client_ip, hit_rate_limit
from app.utils.security import clear_auth_cookies, decode_token, get_session

router = APIRouter(prefix="/api/auth")

DISCORD_ID_KEYS = {
    "discord id",
    "discord_id",
    "discordid",
    "дискорд id",
    "дискорд айди",
    "дс id",
    "дс айди",
    "discord user id",
}


def _clean_key(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().casefold())


def _find_discord_id(raw: dict) -> str:
    for key, value in raw.items():
        clean_key = _clean_key(str(key).replace("_", " "))
        text = str(value or "").strip()
        if clean_key in DISCORD_ID_KEYS and re.fullmatch(r"\d{15,25}", text):
            return text
    for value in raw.values():
        text = str(value or "").strip()
        if re.fullmatch(r"\d{17,25}", text):
            return text
    return ""


def _verification_state(nickname: str) -> tuple[int, int]:
    settings = get_settings()
    verification = get_active_verification(nickname)
    if not verification:
        return 0, settings.discord_code_max_sends
    can_resend, wait_seconds, _ = can_resend_verification(verification)
    remaining = max(0, settings.discord_code_max_sends - int(verification["send_count"]))
    return 0 if can_resend else wait_seconds, remaining


async def _ensure_discord_code_sent(soldier) -> tuple[int, int, bool]:
    settings = get_settings()
    discord_id = _find_discord_id(soldier.raw)
    if not discord_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "В таблице не найден Discord ID для этого ника")
    verification = get_active_verification(soldier.nickname)
    if verification:
        wait_seconds, sends_remaining = _verification_state(soldier.nickname)
        return wait_seconds, sends_remaining, False
    code = generate_code()
    create_verification(soldier.nickname, discord_id, code)
    delivery_failed = False
    try:
        await send_verification_code(discord_id, soldier.nickname, code)
    except HTTPException:
        delivery_failed = True
    return settings.discord_code_resend_cooldown_seconds, settings.discord_code_max_sends - 1, delivery_failed


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, request: Request, response: Response) -> LoginResponse:
    ip = client_ip(request)
    nickname_key = f"login:{ip}:{payload.nickname.strip().casefold()}"
    hit_rate_limit(nickname_key)
    soldier = find_soldier(payload.nickname)
    if soldier is None:
        settings = get_settings()
        hit_rate_limit(
            f"unknown-nickname:{ip}",
            max_attempts=settings.unknown_nickname_max_attempts,
            window_seconds=settings.login_rate_limit_window_seconds,
        )
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Никнейм не найден в таблице")
    user, requires_password_setup = authenticate_login(payload, soldier)
    clear_rate_limit(nickname_key)
    if requires_password_setup:
        wait_seconds, sends_remaining, delivery_failed = await _ensure_discord_code_sent(soldier)
        return build_login_response(
            soldier,
            user,
            False,
            response,
            requires_discord_verification=True,
            verification_resend_available_in=wait_seconds,
            verification_sends_remaining=sends_remaining,
            discord_delivery_failed=delivery_failed,
        )
    return build_login_response(soldier, user, requires_password_setup, response)


@router.post("/refresh", response_model=LoginResponse)
async def refresh_session(request: Request, response: Response, payload: RefreshRequest | None = Body(default=None)) -> LoginResponse:
    refresh_token = (payload.refresh_token if payload else "") or request.cookies.get("star327_refresh", "")
    if not refresh_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token required")
    session = decode_token(refresh_token, expected_type="refresh")
    if not is_refresh_token_active(refresh_token):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token revoked")
    revoke_refresh_token(refresh_token)
    soldier = find_soldier(str(session.get("nickname", "")))
    if soldier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Профиль больше не найден")
    user = ensure_user(soldier.nickname)
    return build_login_response(soldier, user, response=response)


@router.post("/password", response_model=LoginResponse)
async def set_password(payload: PasswordPayload, request: Request, response: Response) -> LoginResponse:
    session = get_session(request)
    if session.get("setup_required") and not session.get("discord_verified"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Discord verification required")
    set_user_password(session["nickname"], payload.password)
    revoke_user_refresh_tokens(session["nickname"])
    soldier = find_soldier(session["nickname"])
    if soldier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Профиль больше не найден")
    user = ensure_user(soldier.nickname)
    return build_login_response(soldier, user, False, response)


@router.post("/verification/resend", response_model=LoginResponse)
async def resend_verification_code(request: Request, response: Response) -> LoginResponse:
    session = get_session(request)
    if not session.get("setup_required") or session.get("discord_verified"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Discord verification is not required")
    soldier = find_soldier(str(session.get("nickname", "")))
    if soldier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Профиль больше не найден")
    discord_id = _find_discord_id(soldier.raw)
    if not discord_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "В таблице не найден Discord ID для этого ника")
    verification = get_active_verification(soldier.nickname)
    if not verification:
        code = generate_code()
        create_verification(soldier.nickname, discord_id, code)
        delivery_failed = False
        try:
            await send_verification_code(discord_id, soldier.nickname, code)
        except HTTPException:
            delivery_failed = True
    else:
        can_resend, wait_seconds, message = can_resend_verification(verification)
        if not can_resend:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, message)
        code = generate_code()
        mark_code_resent(int(verification["id"]), code)
        delivery_failed = False
        try:
            await send_verification_code(discord_id, soldier.nickname, code)
        except HTTPException:
            delivery_failed = True
    user = ensure_user(soldier.nickname)
    wait_seconds, sends_remaining = _verification_state(soldier.nickname)
    return build_login_response(
        soldier,
        user,
        False,
        response,
        requires_discord_verification=True,
        verification_resend_available_in=wait_seconds,
        verification_sends_remaining=sends_remaining,
        discord_delivery_failed=delivery_failed,
    )


@router.post("/verification/confirm", response_model=LoginResponse)
async def confirm_verification_code(payload: VerificationCodePayload, request: Request, response: Response) -> LoginResponse:
    session = get_session(request)
    if not session.get("setup_required") or session.get("discord_verified"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Discord verification is not required")
    nickname = str(session.get("nickname", ""))
    verified, lockout_seconds = verify_code(nickname, payload.code)
    if not verified:
        if lockout_seconds > 0:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Слишком много неверных попыток. Новый код можно запросить через {lockout_seconds} сек.",
            )
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Неверный или истёкший код")
    soldier = find_soldier(nickname)
    if soldier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Профиль больше не найден")
    user = ensure_user(soldier.nickname)
    return build_login_response(soldier, user, True, response, discord_verified=True)


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict[str, bool]:
    refresh_token = request.cookies.get("star327_refresh", "")
    if refresh_token:
        revoke_refresh_token(refresh_token)
    clear_auth_cookies(response)
    return {"ok": True}
