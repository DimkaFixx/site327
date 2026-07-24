from typing import Any, Literal
from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator


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


class MovePayload(BaseModel):
    direction: Literal["up", "down"]


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
    document_type: Literal["page", "link"] = "page"
    url: HttpUrl | None = None
    content: str = Field(default="", max_length=200_000)
    description: str = Field(default="", max_length=500)
    active: bool = True

    @field_validator("url", mode="before")
    @classmethod
    def empty_url_as_none(cls, value: Any) -> Any:
        return None if value == "" else value

    @model_validator(mode="after")
    def validate_link_document(self) -> "DocPayload":
        if self.document_type == "link" and self.url is None:
            raise ValueError("Для документа-ссылки укажите HTTPS-адрес")
        if self.url is not None and self.url.scheme != "https":
            raise ValueError("Разрешены только HTTPS-ссылки")
        return self


class DocItem(DocPayload):
    id: str


class DocsSection(DocsSectionPayload):
    id: str
    docs: list[DocItem] = Field(default_factory=list)


class MarkdownSettings(BaseModel):
    font_size: int = Field(default=16, ge=12, le=28)
    line_height: float = Field(default=1.65, ge=1.2, le=2.2)
    content_padding: int = Field(default=28, ge=16, le=64)
    h1_font_size: int = Field(default=38, ge=24, le=64)
    h2_font_size: int = Field(default=34, ge=20, le=56)
    h3_font_size: int = Field(default=26, ge=18, le=48)
    code_font_size: int = Field(default=14, ge=10, le=24)
    paragraph_spacing: int = Field(default=16, ge=6, le=32)
    heading_margin_top: int = Field(default=28, ge=8, le=64)
    heading_margin_bottom: int = Field(default=14, ge=4, le=40)


class DocsStore(BaseModel):
    access_rules: AccessRules = Field(default_factory=AccessRules)
    sections: list[DocsSection] = Field(default_factory=list)
    markdown_settings: MarkdownSettings = Field(default_factory=MarkdownSettings)


class HomePage(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    content: str = Field(default="", max_length=200_000)
