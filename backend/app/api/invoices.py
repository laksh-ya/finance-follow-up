"""Invoices API — CRUD, CSV upload with validation, CSV export, status changes with sheets writeback."""
from __future__ import annotations

import io
import uuid
import logging
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from app.api.auth import verify_api_key
from app.api.envelope import Envelope, ok
from app.db import repos
from app.db.tables import AuditTable
from app.models.enums import (
    AuditAction,
    DeliveryStatus,
    EscalationStage,
    InvoiceStatus,
    days_overdue_to_stage,
)
from app.models.invoice import InvoiceRecord, InvoiceStatusUpdate

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/invoices", tags=["invoices"], dependencies=[Depends(verify_api_key)])
_public_router = APIRouter(tags=["invoices-public"])

# Required CSV columns (order doesn't matter)
REQUIRED_CSV_COLUMNS = {"invoice_id", "client_name", "client_email", "amount", "due_date"}
OPTIONAL_CSV_COLUMNS = {"currency", "followup_count", "status", "stage", "payment_link", "notes"}
ALL_CSV_COLUMNS = REQUIRED_CSV_COLUMNS | OPTIONAL_CSV_COLUMNS


def _row_to_dict(r, *, delivery_map: dict | None = None) -> dict:
    """Serialise an InvoiceTable row.

    ``delivery_map`` (optional) is the pre-fetched output of
    ``repos.last_delivery_status_map`` so list views don't N+1.
    """
    delivery = (delivery_map or {}).get(r.invoice_id) or {}
    return {
        "invoice_id": r.invoice_id,
        "client_name": r.client_name,
        "client_email": r.client_email,
        "amount": r.amount,
        "currency": r.currency,
        "due_date": r.due_date.isoformat(),
        "days_overdue": r.days_overdue,
        "followup_count": r.followup_count,
        "stage": r.stage.value,
        "status": r.status.value,
        "payment_link": r.payment_link,
        "notes": r.notes,
        "last_email_subject": r.last_email_subject,
        "last_email_body": r.last_email_body,
        "last_email_tone": r.last_email_tone.value if r.last_email_tone else None,
        "last_confidence": r.last_confidence,
        "last_processed_at": r.last_processed_at.isoformat() if r.last_processed_at else None,
        # Surfaced for the Invoices table to show success/failure pills without
        # an extra round-trip. Null = nothing dispatched yet.
        "last_delivery_status": delivery.get("status"),
        "last_delivery_error": delivery.get("error_message"),
        "last_delivery_provider": delivery.get("provider"),
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


# ---- Public (no auth) ----

@_public_router.get("/api/invoices/sample-csv")
def sample_csv():
    return FileResponse("../sample_data/invoices_sample.csv", media_type="text/csv", filename="invoices_sample.csv")


# ---- CRUD ----

@router.get("", response_model=Envelope)
def list_invoices(
    status: Optional[InvoiceStatus] = None,
    stage: Optional[EscalationStage] = None,
    limit: int = 200,
    offset: int = 0,
):
    rows = repos.list_invoices(status=status, stage=stage, limit=limit, offset=offset)
    # Single batched lookup so the table doesn't fan out N+1 queries.
    delivery_map = repos.last_delivery_status_map([r.invoice_id for r in rows])
    return ok([_row_to_dict(r, delivery_map=delivery_map) for r in rows])


# ---- CSV Export (MUST be before /{invoice_id}) ----

@router.get("/export", response_model=None)
def export_invoices():
    """Download current invoice state as CSV — includes status, stage, followup_count, last email info."""
    rows = repos.list_invoices(limit=10000)
    output = io.StringIO()
    output.write("invoice_id,client_name,client_email,amount,currency,due_date,days_overdue,"
                 "status,stage,followup_count,last_email_date,last_email_tone,payment_link,notes\n")
    for r in rows:
        last_date = r.last_processed_at.isoformat() if r.last_processed_at else ""
        last_tone = r.last_email_tone.value if r.last_email_tone else ""
        output.write(
            f"{r.invoice_id},{r.client_name},{r.client_email},{r.amount},{r.currency},"
            f"{r.due_date.isoformat()},{r.days_overdue},{r.status.value},{r.stage.value},"
            f"{r.followup_count},{last_date},{last_tone},"
            f"{r.payment_link or ''},{r.notes or ''}\n"
        )
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=invoices_export.csv"},
    )


@router.get("/{invoice_id}", response_model=Envelope)
def get_invoice(invoice_id: str):
    row = repos.get_invoice(invoice_id)
    if not row:
        raise HTTPException(404, "Invoice not found")
    delivery_map = repos.last_delivery_status_map([row.invoice_id])
    return ok(_row_to_dict(row, delivery_map=delivery_map))


@router.get("/{invoice_id}/timeline", response_model=Envelope)
def invoice_timeline(invoice_id: str, limit: int = 200):
    return ok(repos.invoice_timeline(invoice_id, limit=limit))


# ---- Status change — writes back to sheets ----

@router.patch("/{invoice_id}/status", response_model=Envelope)
def update_status(invoice_id: str, payload: InvoiceStatusUpdate):
    row = repos.update_invoice_status(invoice_id, payload.status, payload.notes)
    if not row:
        raise HTTPException(404, "Invoice not found")

    # Determine event severity
    level = "info"
    action = AuditAction.HUMAN_OVERRIDE
    if payload.status == InvoiceStatus.LEGAL:
        level = "error"
        action = AuditAction.STAGE_ESCALATED
    elif payload.status == InvoiceStatus.PAID:
        level = "success"
    elif payload.status == InvoiceStatus.DISPUTED:
        level = "warn"

    # Write audit entry for EVERY status change (visible in Audit tab)
    audit = AuditTable(
        id=str(uuid.uuid4()),
        invoice_id=invoice_id,
        action=action,
        stage=row.stage,
        delivery_status=DeliveryStatus.HUMAN_PENDING if payload.status == InvoiceStatus.LEGAL else DeliveryStatus.SENT,
        human_override=True,
        override_reason=f"Status → {payload.status.value}" + (f": {payload.notes}" if payload.notes else ""),
    )
    repos.add_audit(audit)

    # Write audit to sheets too
    try:
        from app.services.sheets import append_audit_row
        from app.models.audit import AuditEntry as AuditPydantic
        pydantic_entry = AuditPydantic(
            id=audit.id, invoice_id=invoice_id,
            action=action, stage=row.stage,
            delivery_status=audit.delivery_status,
            human_override=True,
            override_reason=audit.override_reason,
        )
        append_audit_row(pydantic_entry.to_sheets_row())
    except Exception:
        pass

    # Write back to Google Sheets immediately
    try:
        from app.services.sheets import update_invoice_on_sheet
        update_invoice_on_sheet(
            invoice_id,
            status=payload.status.value,
            stage=row.stage.value if row.stage else None,
        )
    except Exception:
        log.exception("sheets writeback failed for status change")

    repos.push_activity("status_change", f"{invoice_id} → {payload.status.value}", invoice_id=invoice_id, level=level)
    delivery_map = repos.last_delivery_status_map([row.invoice_id])
    return ok(_row_to_dict(row, delivery_map=delivery_map))


# ---- CSV Upload with validation ----

@router.post("/upload", response_model=Envelope)
async def upload_invoices(file: UploadFile = File(...)):
    contents = await file.read()
    name = (file.filename or "").lower()

    # Parse file
    try:
        if name.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents))
        elif name.endswith((".xls", ".xlsx")):
            df = pd.read_excel(io.BytesIO(contents))
        else:
            raise HTTPException(400, "Upload must be .csv, .xls, or .xlsx")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"Could not parse file: {exc}")

    # Validate columns
    actual_cols = {c.strip().lower() for c in df.columns}
    missing = REQUIRED_CSV_COLUMNS - actual_cols
    if missing:
        raise HTTPException(
            400,
            f"Missing required columns: {', '.join(sorted(missing))}. "
            f"Required: {', '.join(sorted(REQUIRED_CSV_COLUMNS))}. "
            f"Optional: {', '.join(sorted(OPTIONAL_CSV_COLUMNS))}. "
            f"Download the sample CSV for the correct format.",
        )

    # Normalize column names
    df.columns = [c.strip().lower() for c in df.columns]

    if len(df) == 0:
        raise HTTPException(400, "CSV is empty — no data rows found")

    inserted = 0
    errors: list[str] = []
    today = date.today()
    for i, raw in df.iterrows():
        try:
            due = raw.get("due_date")
            if pd.isna(due):
                errors.append(f"row {i}: due_date is empty")
                continue
            due = pd.to_datetime(due).date()
            days = max(0, (today - due).days)

            # Handle optional fields with NaN
            payment_link = raw.get("payment_link")
            if pd.isna(payment_link):
                payment_link = None
            elif payment_link:
                payment_link = str(payment_link).strip() or None
            notes = raw.get("notes")
            if pd.isna(notes):
                notes = None
            elif notes:
                notes = str(notes).strip() or None

            # Read followup_count
            fc_raw = raw.get("followup_count", 0)
            followup_count = int(fc_raw) if not pd.isna(fc_raw) else 0

            # Read status
            status_raw = raw.get("status", "ACTIVE")
            if pd.isna(status_raw):
                status_raw = "ACTIVE"
            try:
                status = InvoiceStatus(str(status_raw).strip().upper())
            except ValueError:
                status = InvoiceStatus.ACTIVE

            record = InvoiceRecord(
                invoice_id=str(raw["invoice_id"]).strip(),
                client_name=str(raw["client_name"]).strip(),
                client_email=str(raw["client_email"]).strip(),
                amount=float(raw["amount"]),
                currency=str(raw.get("currency", "INR")).strip(),
                due_date=due,
                days_overdue=days,
                followup_count=followup_count,
                stage=days_overdue_to_stage(days),
                status=status,
                payment_link=payment_link,
                notes=notes,
            )
            repos.upsert_invoice(record)
            inserted += 1
        except Exception as exc:
            errors.append(f"row {i}: {exc}")

    repos.push_activity("upload", f"Uploaded {inserted} invoices from {file.filename}")
    return ok({"inserted": inserted, "errors": errors})

