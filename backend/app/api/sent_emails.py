"""Sent-emails router — every email actually dispatched (or attempted),
with full preview content. Powers the dashboard's `/sent` view.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import verify_api_key
from app.api.envelope import Envelope, ok
from app.db import repos
from app.db.tables import SentEmailTable
from app.models.enums import DeliveryStatus

router = APIRouter(prefix="/api/sent-emails", tags=["sent-emails"], dependencies=[Depends(verify_api_key)])


def _row(em: SentEmailTable) -> dict:
    return {
        "id": em.id,
        "invoice_id": em.invoice_id,
        "audit_id": em.audit_id,
        "sent_at": em.sent_at.isoformat(),
        "to_email": em.to_email,
        "from_email": em.from_email,
        "subject": em.subject,
        "body": em.body,
        "tone": em.tone.value,
        "stage": em.stage.value,
        "confidence_score": em.confidence_score,
        "provider": em.provider,
        "provider_message_id": em.provider_message_id,
        "status": em.status.value,
        "error_message": em.error_message,
        "human_approved": em.human_approved,
        "edited_by_human": em.edited_by_human,
        "reviewer_note": em.reviewer_note,
        "model_used": em.model_used,
        "tokens_used": em.tokens_used,
    }


@router.get("", response_model=Envelope)
def list_sent(
    invoice_id: Optional[str] = None,
    status: Optional[DeliveryStatus] = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    rows = repos.list_sent_emails(invoice_id=invoice_id, status=status, limit=limit, offset=offset)
    return ok([_row(r) for r in rows])


@router.get("/{sent_id}", response_model=Envelope)
def get_sent(sent_id: int):
    row = repos.get_sent_email(sent_id)
    if not row:
        raise HTTPException(404, "Sent email not found")
    return ok(_row(row))


@router.get("/export/csv", response_model=None)
def export_sent_emails():
    """Download all sent emails as CSV."""
    import io
    from fastapi.responses import StreamingResponse
    rows = repos.list_sent_emails(limit=10000)
    output = io.StringIO()
    output.write("invoice_id,sent_at,to_email,subject,tone,stage,status,provider,human_approved\n")
    for r in rows:
        subject_clean = r.subject.replace(",", ";").replace("\n", " ")
        output.write(
            f"{r.invoice_id},{r.sent_at.isoformat()},{r.to_email},"
            f'"{subject_clean}",{r.tone.value},{r.stage.value},'
            f"{r.status.value},{r.provider},{r.human_approved}\n"
        )
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sent_emails_export.csv"},
    )
