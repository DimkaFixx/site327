from typing import Any
from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel, Field, HttpUrl, field_validator


class Soldier(BaseModel):
    id: str
    nickname: str
    rank: str = ""
    number: str = ""
    combat_deployments: str = ""
    service_time: str = ""
    unit: str = ""
    position: str = ""
    status: str = ""
    raw: dict[str, Any] = Field(default_factory=dict)


class LoginRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=80)
    password: str | None = Field(default=None, min_length=4, max_length=120)


class LoginResponse(BaseModel):
    token: str
    refresh_token: str = ""
    profile: Soldier
    is_admin: bool
    is_officer: bool = False
    is_instructor: bool = False
    access_groups: list[str] = Field(default_factory=list)
    form_access_groups: list[str] = Field(default_factory=list)
    doc_access_groups: list[str] = Field(default_factory=list)
    requires_password_setup: bool = False
    requires_discord_verification: bool = False
    verification_resend_available_in: int = 0
    verification_sends_remaining: int = 0
    discord_delivery_failed: bool = False


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class PasswordPayload(BaseModel):
    password: str = Field(min_length=4, max_length=120)


class VerificationCodePayload(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class UserAccount(BaseModel):
    nickname: str
    has_password: bool
    is_admin: bool = False
    is_default_admin: bool = False


class UserRolesPayload(BaseModel):
    is_admin: bool = False


class VerificationCodeAdminItem(BaseModel):
    nickname: str
    discord_id: str
    code: str
    send_count: int
    attempt_count: int
    expires_at: datetime
    locked_until: datetime | None = None


class AuditEventItem(BaseModel):
    id: int
    actor: str
    action: str
    target: str = ""
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


Audience = str


class AccessRule(BaseModel):
    ranks: list[str] = Field(default_factory=list)
    specializations: list[str] = Field(default_factory=list)
    positions: list[str] = Field(default_factory=list)


class AccessGroup(AccessRule):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=80)


class AccessGroupPayload(AccessRule):
    title: str = Field(min_length=1, max_length=80)
    id: str | None = Field(default=None, max_length=80)


class AccessRules(BaseModel):
    groups: list[AccessGroup] = Field(default_factory=list)
    instructors: AccessRule = Field(default_factory=AccessRule)
    officers: AccessRule = Field(default_factory=AccessRule)


class TabPayload(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    audience: Audience = "public"


class FormPayload(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    url: HttpUrl
    tab_id: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    audience: Audience = "public"
    active: bool = True

    @field_validator("url")
    @classmethod
    def validate_google_form_url(cls, value: HttpUrl) -> HttpUrl:
        parsed = urlparse(str(value))
        if parsed.scheme != "https" or parsed.hostname != "docs.google.com" or "/forms/" not in parsed.path:
            raise ValueError("Разрешены только ссылки Google Forms на docs.google.com/forms")
        return value


class FormItem(FormPayload):
    id: str


class FormTab(TabPayload):
    id: str
    forms: list[FormItem] = Field(default_factory=list)


class FormsStore(BaseModel):
    access_rules: AccessRules = Field(default_factory=AccessRules)
    tabs: list[FormTab] = Field(default_factory=list)


class DocsSectionPayload(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    audience: Audience = "public"


class DocPayload(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    section_id: str = Field(min_length=1, max_length=80)
    audience: Audience = "public"
    content: str = Field(default="", max_length=200_000)
    description: str = Field(default="", max_length=500)
    active: bool = True


class DocItem(DocPayload):
    id: str


class DocsSection(DocsSectionPayload):
    id: str
    docs: list[DocItem] = Field(default_factory=list)


class DocsStore(BaseModel):
    access_rules: AccessRules = Field(default_factory=AccessRules)
    sections: list[DocsSection] = Field(default_factory=list)


class HomePage(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    content: str = Field(default="", max_length=200_000)
