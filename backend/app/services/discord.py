import logging

import httpx
from fastapi import HTTPException, status

from app.config import get_settings


DISCORD_API_URL = "https://discord-bot-proxy.dimkafixx.ru/v10"
logger = logging.getLogger(__name__)


async def send_verification_code(discord_id: str, nickname: str, code: str) -> None:
    settings = get_settings()
    headers = {
        "Authorization": f"Bot {settings.discord_bot_token}",
        "X-Relay-Token": settings.discord_bot_proxy_auth_token,
        "Content-Type": "application/json",
    }
    message = (
        f"Код подтверждения для 327 Star Corp: **{code}**\n"
        f"Ник: `{nickname}`\n"
        "Код действует ограниченное время. Если вы не запрашивали вход, просто проигнорируйте это сообщение."
    )
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            channel_response = await client.post(
                f"{DISCORD_API_URL}/users/@me/channels",
                headers=headers,
                json={"recipient_id": discord_id},
            )
            channel_response.raise_for_status()
            channel_id = channel_response.json()["id"]
            message_response = await client.post(
                f"{DISCORD_API_URL}/channels/{channel_id}/messages",
                headers=headers,
                json={"content": message},
            )
            message_response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        try:
            payload = exc.response.json()
        except ValueError:
            payload = {}
        discord_code = payload.get("code")
        logger.warning(
            "Discord proxy request failed: status=%s discord_code=%s path=%s",
            status_code,
            discord_code,
            exc.request.url.path if exc.request else "unknown",
        )
        if discord_code == 50278:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Discord не даёт отправить ЛС: у бота и пользователя нет общего сервера. Попросите код у администратора.",
            ) from exc
        if discord_code == 50007:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Discord не даёт отправить ЛС этому пользователю. Попросите код у администратора.",
            ) from exc
        if status_code in (403, 404):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Discord не работает или недоступен. Попросите код у администратора.",
            ) from exc
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Discord не работает или не принял сообщение. Попросите код у администратора.") from exc
    except (httpx.HTTPError, KeyError) as exc:
        logger.warning("Discord proxy connection/response failed: error=%s", type(exc).__name__)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Discord не работает или недоступен. Попросите код у администратора.") from exc
