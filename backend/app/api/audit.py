from __future__ import annotations

import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.api.auth import verify_api_key
from app.api.envelope import Envelope, ok
from app.db import repos
from app.models.enums import AuditAction

router = APIRouter(prefix="/api/audit", tags=["audit"], dependencies=[Depends(verify_api_key)])


def _row_to_dict(r) -> dict:
    return {
        "id": r.id,
        "invoice_id": r.invoice_id,
        "timestamp": r.timestamp.isoformat(),
        "action": r.action.value,
        "stage": r.stage.value,
        "tone_used": r.tone_used.value if r.tone_used else None,
        "email_subject": r.email_subject,
        "confidence_score": r.confidence_score,
        "risk_level": r.risk_level,
        "tokens_used": r.tokens_used,
        "latency_ms": r.latency_ms,
        "retry_count": r.retry_count,
        "fallback_used": r.fallback_used,
        "delivery_status": r.delivery_status.value,
        "human_override": r.human_override,
        "override_reason": r.override_reason,
        "validation_errors": r.validation_errors.split("|") if r.validation_errors else [],
        "error_message": r.error_message,
        "model_used": r.model_used,
    }


@router.get("", response_model=Envelope)
def list_audit(
    invoice_id: Optional[str] = None,
    action: Optional[AuditAction] = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    rows = repos.list_audit(invoice_id=invoice_id, action=action, limit=limit, offset=offset)
    return ok([_row_to_dict(r) for r in rows])


@router.get("/export")
def export_csv(invoice_id: Optional[str] = None, action: Optional[AuditAction] = None):
    rows = repos.list_audit(invoice_id=invoice_id, action=action, limit=5000)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "id", "invoice_id", "timestamp", "action", "stage", "tone_used",
        "email_subject", "confidence_score", "risk_level", "tokens_used",
        "latency_ms", "retry_count", "fallback_used", "delivery_status",
        "human_override", "override_reason", "validation_errors",
        "error_message", "model_used",
    ])
    for r in rows:
        writer.writerow([
            r.id, r.invoice_id, r.timestamp.isoformat(), r.action.value, r.stage.value,
            r.tone_used.value if r.tone_used else "", r.email_subject or "",
            r.confidence_score or "", r.risk_level or "", r.tokens_used or "",
            r.latency_ms or "", r.retry_count, r.fallback_used, r.delivery_status.value,
            r.human_override, r.override_reason or "", r.validation_errors,
            r.error_message or "", r.model_used or "",
        ])
    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit_log.csv"},
    )
