import time
from ipaddress import ip_address, ip_network

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, insert, select, update

from app.config import get_settings
from app.repositories.database import db_session, rate_limits
from app.repositories.sessions import hash_token


def client_ip(request: Request) -> str:
    direct_ip = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("x-forwarded-for", "")
    trusted_proxies = get_settings().trusted_proxy_ip_list
    if forwarded and any(_is_trusted_proxy(direct_ip, proxy) for proxy in trusted_proxies):
        return forwarded.split(",", 1)[0].strip()
    return direct_ip


def _is_trusted_proxy(address: str, proxy: str) -> bool:
    try:
        return ip_address(address) in ip_network(proxy, strict=False)
    except ValueError:
        return address == proxy


def hit_rate_limit(key: str, max_attempts: int | None = None, window_seconds: int | None = None) -> None:
    settings = get_settings()
    limit = max_attempts if max_attempts is not None else settings.login_rate_limit_max_attempts
    window = window_seconds if window_seconds is not None else settings.login_rate_limit_window_seconds
    now = time.time()
    key_hash = hash_token(key)
    cutoff = now - window
    with db_session() as db:
        row = db.execute(select(rate_limits).where(rate_limits.c.key_hash == key_hash)).mappings().first()
        hits = [float(item) for item in (row["hits"] if row else []) if float(item) > cutoff]
        if len(hits) >= limit:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много попыток, попробуйте позже")
        hits.append(now)
        if row:
            db.execute(update(rate_limits).where(rate_limits.c.key_hash == key_hash).values(hits=hits))
        else:
            db.execute(insert(rate_limits).values(key_hash=key_hash, hits=hits))


def clear_rate_limit(key: str) -> None:
    with db_session() as db:
        db.execute(delete(rate_limits).where(rate_limits.c.key_hash == hash_token(key)))
