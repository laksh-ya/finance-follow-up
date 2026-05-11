from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.auth import verify_api_key
from app.api.envelope import Envelope, ok
from app.db import repos
from app.email.dispatcher import send_for_invoice
from app.models.email_output import HumanReviewAction
from app.models.enums import DeliveryStatus, days_overdue_to_stage

router = APIRouter(prefix="/api/human-queue", tags=["human-queue"], dependencies=[Depends(verify_api_key)])


def _row_to_dict(r) -> dict:
    return {
        "id": r.id,
        "invoice_id": r.invoice_id,
        "queued_at": r.queued_at.isoformat(),
        "reason": r.reason,
        "confidence_score": r.confidence_score,
        "risk_level": r.risk_level,
        "email_subject": r.email_subject,
        "email_body": r.email_body,
        "email_tone": r.email_tone.value,
        "status": r.status.value,
        "reviewer_note": r.reviewer_note,
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
    }


@router.get("", response_model=Envelope)
def list_pending(pending_only: bool = True):
    rows = repos.list_human_queue(pending_only=pending_only)
    return ok([_row_to_dict(r) for r in rows])


@router.post("/{queue_id}/action", response_model=Envelope)
def act(queue_id: int, payload: HumanReviewAction):
    rows = [r for r in repos.list_human_queue(pending_only=False) if r.id == queue_id]
    if not rows:
        raise HTTPException(404, "queue item not found")
    row = rows[0]

    invoice = repos.get_invoice(row.invoice_id)

    if payload.action in ("approve", "edit"):
        subject = payload.edited_subject or row.email_subject
        body = payload.edited_body or row.email_body
        edited = bool(
            (payload.edited_subject and payload.edited_subject != row.email_subject)
            or (payload.edited_body and payload.edited_body != row.email_body)
        )
        if not invoice:
            raise HTTPException(404, "linked invoice missing")
        stage_enum = days_overdue_to_stage(invoice.days_overdue)
        result = send_for_invoice(
            invoice_id=invoice.invoice_id,
            to_email=invoice.client_email,
            subject=subject,
            body=body,
            tone=row.email_tone,
            stage=stage_enum,
            confidence_score=row.confidence_score,
            human_approved=True,
            edited_by_human=edited,
            reviewer_note=payload.reviewer_note,
        )
        repos.resolve_human_queue(
            queue_id,
            DeliveryStatus.HUMAN_APPROVED,
            reviewer_note=payload.reviewer_note,
            edited_subject=subject,
            edited_body=body,
        )
        repos.push_activity(
            "human_approved",
            f"{row.invoice_id} approved → {result.status.value} via {result.provider}"
            + (" (edited)" if edited else ""),
            invoice_id=row.invoice_id,
            level="success" if result.status != DeliveryStatus.FAILED else "error",
        )
        repos.update_invoice_email_cache(
            invoice.invoice_id,
            subject=subject,
            body=body,
            tone=row.email_tone,
            confidence=row.confidence_score,
        )
        # Write back to Google Sheets
        try:
            from app.services.sheets import update_invoice_on_sheet
            update_invoice_on_sheet(
                invoice.invoice_id,
                followup_count=(invoice.followup_count or 0) + 1,
                last_email_date=__import__('datetime').datetime.utcnow().isoformat(),
                last_email_tone=row.email_tone.value,
            )
        except Exception:
            pass

    elif payload.action == "reject":
        repos.resolve_human_queue(
            queue_id, DeliveryStatus.HUMAN_REJECTED, reviewer_note=payload.reviewer_note
        )
        repos.push_activity(
            "human_rejected",
            f"{row.invoice_id} rejected by reviewer",
            invoice_id=row.invoice_id,
            level="warn",
        )

    elif payload.action == "regenerate":
        from app.pipeline.graph import run_for_invoice
        run_for_invoice(row.invoice_id)
        repos.resolve_human_queue(queue_id, DeliveryStatus.HUMAN_REJECTED, reviewer_note="regenerated")

    elif payload.action == "flag":
        from app.models.enums import InvoiceStatus, AuditAction
        from app.db.tables import AuditTable
        import uuid
        repos.update_invoice_status(row.invoice_id, InvoiceStatus.LEGAL, payload.reviewer_note)
        repos.resolve_human_queue(queue_id, DeliveryStatus.HUMAN_REJECTED, reviewer_note=payload.reviewer_note)
        # Write audit entry for legal escalation
        audit = AuditTable(
            id=str(uuid.uuid4()),
            invoice_id=row.invoice_id,
            action=AuditAction.STAGE_ESCALATED,
            stage=invoice.stage if invoice else "ESCALATED",
            delivery_status=DeliveryStatus.HUMAN_REJECTED,
            human_override=True,
            override_reason=f"Flagged LEGAL by reviewer: {payload.reviewer_note or 'No reason given'}",
        )
        repos.add_audit(audit)
        # Write to Google Sheets audit log
        try:
            from app.services.sheets import append_audit_row
            from app.models.audit import AuditEntry as AuditPydantic
            pydantic_entry = AuditPydantic(
                id=audit.id, invoice_id=row.invoice_id,
                action=AuditAction.STAGE_ESCALATED,
                stage=invoice.stage if invoice else "ESCALATED",
                delivery_status=DeliveryStatus.HUMAN_REJECTED,
                human_override=True,
                override_reason=f"Flagged LEGAL: {payload.reviewer_note or 'No reason given'}",
            )
            append_audit_row(pydantic_entry.to_sheets_row())
        except Exception:
            pass
        repos.push_activity(
            "flagged_legal",
            f"{row.invoice_id} flagged for legal review" + (f": {payload.reviewer_note}" if payload.reviewer_note else ""),
            invoice_id=row.invoice_id,
            level="error",
        )
        # Write back to Google Sheets
        try:
            from app.services.sheets import update_invoice_on_sheet
            update_invoice_on_sheet(row.invoice_id, status="LEGAL")
        except Exception:
            pass
    else:
        raise HTTPException(400, f"unknown action {payload.action}")

    return ok({"action": payload.action, "queue_id": queue_id})
