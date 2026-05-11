"""Diagnostics router — let the user verify each external service from
the Settings page without leaking credentials.

GET  /api/diagnostics/health-deep   → richer health: db, redis, llm, email, sheets
POST /api/diagnostics/test/llm      → 1 LLM call to verify keys + parse round-trip
POST /api/diagnostics/test/email    → send a test email to the caller's address
POST /api/diagnostics/test/redis    → ping redis broker
POST /api/diagnostics/test/sheets   → read first row of configured sheet
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr

from app.api.auth import verify_api_key
from app.api.envelope import Envelope, ok
from app.config import get_settings
from app.email.dispatcher import dispatch_email

log = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/diagnostics",
    tags=["diagnostics"],
    dependencies=[Depends(verify_api_key)],
)


def _result(ok_: bool, message: str, latency_ms: int = 0, **extra) -> dict:
    return {"ok": ok_, "message": message, "latency_ms": latency_ms, **extra}


@router.get("/health-deep", response_model=Envelope)
def health_deep():
    s = get_settings()
    out = {
        "app": s.app_name,
        "data_source": s.data_source,
        "human_in_loop": s.human_in_loop,
        "auto_dispatch": s.auto_dispatch,
        "email_mode": s.email_mode,
        "celery_eager": s.celery_eager,
        "llm": {
            "provider": s.llm.provider,
            "model": s.llm.model,
            "has_api_key": bool(s.llm.api_key),
            "is_mock": s.llm.provider == "mock" or not s.llm.api_key,
        },
        "database": {"url": s.database_url, "kind": s.database_url.split("://")[0]},
        "redis": {"url": s.redis_url},
        "sheets": {"enabled": s.sheets_enabled},
        "langfuse": {"enabled": s.langfuse_enabled},
    }
    return ok(out)


@router.post("/test/llm", response_model=Envelope)
def test_llm():
    s = get_settings()
    if s.llm.provider == "mock" or not s.llm.api_key:
        return ok(_result(True, "LLM in MOCK mode (no real call). Set LLM__API_KEY to test live.", 0))
    try:
        from app.llm.gateway import LLMGateway
        from app.pipeline.prompts import build_prompts
        from app.models.invoice import InvoiceRecord

        gw = LLMGateway()
        start = time.time()
        
        # tiny canned invoice for the round-trip
        inv = InvoiceRecord(
            invoice_id="INV-2099-001",
            client_name="Test Client",
            client_email="test@example.com",
            amount=1000.0,
            currency="INR",
            due_date="2025-01-01",
            days_overdue=5,
            payment_link="https://pay.example.com/test",
            stage="STAGE_1",
            followup_count=0,
            status="ACTIVE"
        )
        sys_p, user_p = build_prompts(stage=1, invoice=inv.model_dump(mode="json"))

        email, tokens, latency = gw.complete(
            invoice_id=inv.invoice_id,
            client_name=inv.client_name,
            amount=inv.amount,
            currency=inv.currency,
            due_date=str(inv.due_date),
            days_overdue=inv.days_overdue,
            payment_link=inv.payment_link,
            stage=1,
            followup_count=inv.followup_count,
            system_prompt=sys_p,
            user_prompt=user_p,
        )
        return ok(_result(
            True,
            f"OK · {gw.model_info} · {tokens} tokens",
            int((time.time() - start) * 1000),
            model=gw.model_info,
            tokens=tokens,
            sample_subject=email.subject[:80],
        ))
    except Exception as exc:
        log.exception("LLM test failed")
        return ok(_result(False, f"FAIL: {exc}", 0))


class EmailTestRequest(BaseModel):
    to_email: EmailStr
    subject: Optional[str] = None
    body: Optional[str] = None


@router.post("/test/email", response_model=Envelope)
def test_email(payload: EmailTestRequest):
    start = time.time()
    result = dispatch_email(
        to_email=payload.to_email,
        subject=payload.subject or "Test email from Finance Collections Agent",
        body=payload.body or (
            "This is a connectivity test from your Finance Collections Agent. "
            "If you can read this, your email pipeline is wired correctly."
        ),
    )
    return ok(_result(
        result.status.value not in ("FAILED",),
        f"{result.provider}: {result.message}",
        int((time.time() - start) * 1000),
        provider=result.provider,
        status=result.status.value,
        provider_message_id=result.provider_message_id,
    ))


@router.post("/test/redis", response_model=Envelope)
def test_redis():
    s = get_settings()
    try:
        import redis as redis_lib  # type: ignore
        import ssl as ssl_module

        start = time.time()
        url = s.redis_url
        # Strip ssl_cert_reqs from URL if present (we handle it programmatically)
        clean_url = url.split("?")[0] if "?" in url else url
        kwargs: dict = dict(socket_connect_timeout=5, socket_timeout=5)
        if clean_url.startswith("rediss://"):
            kwargs["connection_class"] = redis_lib.connection.SSLConnection
            kwargs["ssl_cert_reqs"] = "none"
        client = redis_lib.from_url(clean_url, **kwargs)
        pong = client.ping()
        return ok(_result(bool(pong), f"PING → {pong}", int((time.time() - start) * 1000)))
    except Exception as exc:
        return ok(_result(False, f"FAIL: {exc}", 0))


@router.post("/test/sheets", response_model=Envelope)
def test_sheets():
    s = get_settings()
    if not s.sheets_enabled:
        return ok(_result(False, "Sheets sync is disabled.", 0))
    try:
        from app.services.sheets import _open_sheet  # noqa: WPS437

        start = time.time()
        sheet = _open_sheet(s.sheets_invoice_id)
        rows = sheet.get_all_values()[:1] if sheet else []
        return ok(_result(
            bool(sheet),
            f"Connected · {len(rows)} header row read",
            int((time.time() - start) * 1000),
        ))
    except Exception as exc:
        log.exception("sheets test failed")
        return ok(_result(False, f"FAIL: {exc}", 0))
