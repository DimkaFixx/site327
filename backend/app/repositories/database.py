from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import Boolean, Column, DateTime, Integer, JSON, MetaData, String, Table, create_engine, false, func, text, true
from sqlalchemy.engine import Engine

from app.config import get_settings


metadata = MetaData()

users = Table(
    "users",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("nickname", String(80), nullable=False),
    Column("normalized_nickname", String(80), nullable=False, unique=True, index=True),
    Column("password_hash", String(255), nullable=True),
    Column("is_admin", Boolean, nullable=False, server_default=false()),
    Column("is_active", Boolean, nullable=False, server_default=true()),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()),
)

soldiers_cache = Table(
    "soldiers_cache",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("sheet_row_id", String(20), nullable=False),
    Column("nickname", String(120), nullable=False),
    Column("normalized_nickname", String(120), nullable=False, unique=True, index=True),
    Column("rank", String(80), nullable=False, server_default=""),
    Column("number", String(80), nullable=False, server_default=""),
    Column("combat_deployments", String(80), nullable=False, server_default=""),
    Column("service_time", String(80), nullable=False, server_default=""),
    Column("unit", String(120), nullable=False, server_default=""),
    Column("position", String(120), nullable=False, server_default=""),
    Column("status", String(120), nullable=False, server_default=""),
    Column("raw", JSON, nullable=False),
    Column("synced_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

refresh_sessions = Table(
    "refresh_sessions",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("token_hash", String(64), nullable=False, unique=True, index=True),
    Column("nickname", String(120), nullable=False, index=True),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("revoked_at", DateTime(timezone=True), nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

rate_limits = Table(
    "rate_limits",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("key_hash", String(64), nullable=False, unique=True, index=True),
    Column("hits", JSON, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()),
)

audit_events = Table(
    "audit_events",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("actor", String(120), nullable=False, index=True),
    Column("action", String(120), nullable=False, index=True),
    Column("target", String(255), nullable=False, server_default=""),
    Column("details", JSON, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

verification_codes = Table(
    "verification_codes",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("normalized_nickname", String(120), nullable=False, index=True),
    Column("discord_id", String(32), nullable=False, index=True),
    Column("code_hash", String(64), nullable=False),
    Column("code_plain", String(6), nullable=True),
    Column("send_count", Integer, nullable=False, server_default="1"),
    Column("attempt_count", Integer, nullable=False, server_default="0"),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("last_sent_at", DateTime(timezone=True), nullable=False),
    Column("locked_until", DateTime(timezone=True), nullable=True),
    Column("used_at", DateTime(timezone=True), nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)


def _connect_args(database_url: str) -> dict[str, object]:
    if database_url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


def create_db_engine() -> Engine:
    settings = get_settings()
    return create_engine(settings.database_url, connect_args=_connect_args(settings.database_url))


engine = create_db_engine()


def init_db() -> None:
    metadata.create_all(engine)
    with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            columns = {row[1] for row in connection.execute(text("PRAGMA table_info(users)"))}
            if "is_admin" not in columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0"))
            verification_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(verification_codes)"))}
            if verification_columns and "locked_until" not in verification_columns:
                connection.execute(text("ALTER TABLE verification_codes ADD COLUMN locked_until DATETIME"))
            if verification_columns and "code_plain" not in verification_columns:
                connection.execute(text("ALTER TABLE verification_codes ADD COLUMN code_plain VARCHAR(6)"))


@contextmanager
def db_session() -> Generator:
    with engine.begin() as connection:
        yield connection
