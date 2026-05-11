"""
Central application settings. Every external dependency is toggled here.
Values are read from environment variables (with nested `__` delimiter for LLMConfig).
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal, Optional

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class LLMConfig(BaseModel):
    provider: Literal["groq", "gemini", "openai", "ollama", "together", "mock"] = "groq"
    model: str = "groq/llama-3.1-8b-instant"
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    temperature: float = Field(default=0.3, ge=0.0, le=1.0)
    max_tokens: int = Field(default=1024, ge=100, le=4096)
    timeout: int = 30
    confidence_threshold: float = Field(default=0.75, ge=0.0, le=1.0)


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_nested_delimiter="__",
        extra="ignore",
        case_sensitive=False,
    )

    # App
    app_name: str = "Finance Collections Agent"
    debug: bool = True
    api_key: str = "dev-secret-key"

    # Data source: "sheets" = Google Sheets is master, "csv" = upload CSV, process, download
    data_source: Literal["sheets", "csv"] = "csv"

    # Human-in-the-loop: route low-confidence + stage-4 to review queue
    human_in_loop: bool = True
    # Auto-dispatch: auto-send stage 1-3 emails (when off, ALL go to review queue)
    auto_dispatch: bool = True

    # LLM
    llm: LLMConfig = LLMConfig()

    # Email
    email_mode: Literal["mock", "sandbox", "live"] = "mock"
    email_from: Optional[str] = None
    # Resend (live)
    resend_api_key: Optional[str] = None
    resend_from: str = "Finance Collections <onboarding@resend.dev>"
    # Mailtrap (sandbox preset)
    mailtrap_host: str = "sandbox.smtp.mailtrap.io"
    mailtrap_port: int = 2525
    mailtrap_user: Optional[str] = None
    mailtrap_pass: Optional[str] = None
    # Generic SMTP override (Gmail / Zoho / your own SMTP)
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_pass: Optional[str] = None
    smtp_use_tls: bool = True

    # CORS
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Queue
    redis_url: str = "redis://localhost:6379/0"
    celery_eager: bool = True

    # Sheets
    sheets_enabled: bool = False
    sheets_credentials_path: str = "credentials.json"
    sheets_invoice_id: Optional[str] = None
    sheets_audit_id: Optional[str] = None

    # Langfuse
    langfuse_enabled: bool = False
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: str = "https://cloud.langfuse.com"

    # Rate limits
    max_emails_per_minute: int = 10
    max_llm_calls_per_minute: int = 20

    # DB
    database_url: str = "sqlite:///./data/finance.db"


@lru_cache
def get_settings() -> AppSettings:
    return AppSettings()


def reload_settings() -> AppSettings:
    """Used by /api/config endpoints after mutation."""
    get_settings.cache_clear()
    return get_settings()
