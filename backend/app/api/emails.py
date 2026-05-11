from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import verify_api_key
from app.api.envelope import Envelope, ok
from app.db import repos
from app.pipeline.graph import run_for_invoice

router = APIRouter(prefix="/api/emails", tags=["emails"], dependencies=[Depends(verify_api_key)])


class RegeneratePayload(BaseModel):
    tone_override: Optional[int] = None  # 1..4


@router.get("/preview/{invoice_id}", response_model=Envelope)
def preview_email(invoice_id: str):
    row = repos.get_invoice(invoice_id)
    if not row:
        raise HTTPException(404, "Invoice not found")
    if not row.last_email_subject:
        return ok(None)
    return ok({
        "subject": row.last_email_subject,
        "body": row.last_email_body,
        "tone": row.last_email_tone.value if row.last_email_tone else None,
        "confidence_score": row.last_confidence,
        "processed_at": row.last_processed_at.isoformat() if row.last_processed_at else None,
    })


@router.post("/regenerate/{invoice_id}", response_model=Envelope)
def regenerate(invoice_id: str, payload: RegeneratePayload | None = None):
    row = repos.get_invoice(invoice_id)
    if not row:
        raise HTTPException(404, "Invoice not found")
    tone = payload.tone_override if payload else None
    state = run_for_invoice(invoice_id, tone_override=tone)
    em = state.get("generated_email")
    return ok({
        "generated_email": em,
        "confidence_score": state.get("confidence_score"),
        "risk_level": state.get("risk_level"),
        "requires_human": state.get("requires_human"),
        "model_used": state.get("model_used"),
        "tokens_used": state.get("tokens_used"),
        "latency_ms": state.get("latency_ms"),
        "validation_errors": state.get("validation_errors"),
        "hallucination_check": state.get("hallucination_check"),
    })
