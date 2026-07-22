from functools import lru_cache
import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    google_sheet_id: str
    google_sheet_gid: str
    google_sheet_csv_url: str
    google_sheet_range: str
    google_service_account_file: str
    admin_nickname: str
    admin_password: str
    token_secret: str
    token_ttl_seconds: int
    refresh_token_ttl_seconds: int
    forms_store_path: str
    docs_store_path: str
    uploads_path: str
    database_url: str
    cors_origins: str = Field()
    cookie_secure: bool
    cookie_samesite: str
    max_upload_bytes: int
    login_rate_limit_window_seconds: int
    login_rate_limit_max_attempts: int
    unknown_nickname_max_attempts: int
    discord_bot_token: str
    discord_bot_proxy_auth_token: str
    discord_code_ttl_seconds: int
    discord_code_resend_cooldown_seconds: int
    discord_code_max_sends: int
    discord_code_max_attempts: int
    discord_code_failed_lockout_seconds: int
    trusted_proxy_ips: str = Field(default="")

    model_config = SettingsConfigDict(env_file=(".env", "backend/.env"), env_file_encoding="utf-8")

    @property
    def sheet_csv_url(self) -> str:
        if self.google_sheet_csv_url:
            return self.google_sheet_csv_url
        return (
            f"https://docs.google.com/spreadsheets/d/{self.google_sheet_id}/"
            f"export?format=csv&gid={self.google_sheet_gid}"
        )

    @property
    def google_credentials_path(self) -> Path:
        path = Path(self.google_service_account_file)
        if path.is_absolute():
            return path
        return Path.cwd() / path

    @property
    def default_admin_name(self) -> str:
        return self.admin_nickname.strip().casefold()

    @property
    def default_admin_password(self) -> str:
        return self.admin_password

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def trusted_proxy_ip_list(self) -> list[str]:
        return [item.strip() for item in self.trusted_proxy_ips.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    has_env_file = any(Path(path).exists() for path in (".env", "backend/.env"))
    has_injected_env = all(os.getenv(key) for key in ("GOOGLE_SHEET_ID", "ADMIN_NICKNAME", "ADMIN_PASSWORD", "TOKEN_SECRET"))
    if not has_env_file and not has_injected_env:
        raise RuntimeError("Missing .env file. Backend startup is blocked until environment is configured.")
    return Settings()
