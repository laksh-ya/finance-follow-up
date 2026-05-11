"""Mutable runtime config — backs the Settings page in the UI."""
from __future__ import annotations

import logging
import os
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.auth import verify_api_key
from app.api.envelope import Envelope, ok
from app.config import get_settings, reload_settings
from app.db import repos
from app.services import mock_seed

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/config", tags=["config"], dependencies=[Depends(verify_api_key)])


class ConfigSnapshot(BaseModel):
    data_source: str  # "sheets" or "csv"
    human_in_loop: bool
    auto_dispatch: bool
    email_mode: Literal["mock", "sandbox", "live"]
    sheets_enabled: bool
    langfuse_enabled: bool
    celery_eager: bool
    llm: dict


class ConfigPatch(BaseModel):
    data_source: Optional[Literal["sheets", "csv"]] = None
    human_in_loop: Optional[bool] = None
    auto_dispatch: Optional[bool] = None
    email_mode: Optional[Literal["mock", "sandbox", "live"]] = None
    sheets_enabled: Optional[bool] = None
    langfuse_enabled: Optional[bool] = None
    celery_eager: Optional[bool] = None

    # LLM
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None
    llm_temperature: Optional[float] = Field(None, ge=0.0, le=1.0)
    llm_confidence_threshold: Optional[float] = Field(None, ge=0.0, le=1.0)


def _snapshot() -> ConfigSnapshot:
    s = get_settings()
    return ConfigSnapshot(
        data_source=s.data_source,
        human_in_loop=s.human_in_loop,
        auto_dispatch=s.auto_dispatch,
        email_mode=s.email_mode,
        sheets_enabled=s.sheets_enabled,
        langfuse_enabled=s.langfuse_enabled,
        celery_eager=s.celery_eager,
        llm={
            "provider": s.llm.provider,
            "model": s.llm.model,
            "has_api_key": bool(s.llm.api_key),
            "temperature": s.llm.temperature,
            "confidence_threshold": s.llm.confidence_threshold,
        },
    )


_ENV_MAP = {
    "data_source": "DATA_SOURCE",
    "human_in_loop": "HUMAN_IN_LOOP",
    "auto_dispatch": "AUTO_DISPATCH",
    "email_mode": "EMAIL_MODE",
    "sheets_enabled": "SHEETS_ENABLED",
    "langfuse_enabled": "LANGFUSE_ENABLED",
    "celery_eager": "CELERY_EAGER",
    "llm_provider": "LLM__PROVIDER",
    "llm_model": "LLM__MODEL",
    "llm_api_key": "LLM__API_KEY",
    "llm_temperature": "LLM__TEMPERATURE",
    "llm_confidence_threshold": "LLM__CONFIDENCE_THRESHOLD",
}


@router.get("", response_model=Envelope)
def get_config():
    return ok(_snapshot().model_dump())


@router.patch("", response_model=Envelope)
def patch_config(patch: ConfigPatch):
    data = patch.model_dump(exclude_none=True)
    old_source = get_settings().data_source
    
    for k, v in data.items():
        env_key = _ENV_MAP.get(k)
        if not env_key:
            continue
        os.environ[env_key] = str(v).lower() if isinstance(v, bool) else str(v)

    # When switching to sheets mode, auto-enable sheets
    if data.get("data_source") == "sheets":
        os.environ["SHEETS_ENABLED"] = "true"
    elif data.get("data_source") == "csv":
        os.environ["SHEETS_ENABLED"] = "false"

    reload_settings()
    
    new_source = data.get("data_source")
    # Switching modes → clean slate
    if new_source and new_source != old_source:
        repos.reset_all()
        log.info("Mode switched %s → %s — DB cleared for clean session", old_source, new_source)
        repos.push_activity("mode_switch", f"Switched to {new_source.upper()} mode — fresh session started", level="info")

    return ok(_snapshot().model_dump())


@router.post("/seed", response_model=Envelope)
def seed():
    seeded = mock_seed.seed_invoices()
    repos.push_activity("seed", f"Loaded {seeded} sample invoices")
    return ok({"seeded": seeded})


@router.post("/reset", response_model=Envelope)
def reset():
    """Clear everything — fresh session."""
    repos.reset_all()
    repos.push_activity("reset", "Session cleared — all data removed", level="warn")
    return ok({"reset": True})
