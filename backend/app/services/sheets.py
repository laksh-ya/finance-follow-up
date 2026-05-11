"""Google Sheets — two-way sync for invoice data + audit writeback.

Sheets Mode Architecture:
  - Invoice Sheet = source of truth for client data
  - App reads from it, processes, writes back status/stage/followup changes
  - Audit Sheet = append-only log of every action taken

The sheet MUST have these columns (auto-added if missing on first sync):
  invoice_id, client_name, client_email, amount, currency, due_date,
  status, stage, followup_count, last_email_date, last_email_tone,
  payment_link, notes
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Optional

from app.config import get_settings

log = logging.getLogger(__name__)

_last_sync_at: Optional[datetime] = None
_last_row_count: int = 0

# Required columns for the invoice sheet. Missing ones are auto-added.
REQUIRED_COLUMNS = [
    "invoice_id", "client_name", "client_email", "amount", "currency",
    "due_date", "status", "stage", "followup_count", "last_email_date",
    "last_email_tone", "payment_link", "notes",
]


def _get_gc():
    """Return an authenticated gspread client."""
    import gspread  # type: ignore
    s = get_settings()
    return gspread.service_account(filename=s.sheets_credentials_path)


def _open_invoice_sheet():
    """Return the invoice worksheet, or None on failure."""
    s = get_settings()
    if not s.sheets_enabled or not s.sheets_invoice_id:
        return None
    try:
        gc = _get_gc()
        return gc.open_by_key(s.sheets_invoice_id).sheet1
    except Exception:
        log.exception("sheets: failed to open invoice sheet")
        return None


def _ensure_columns(ws) -> list[str]:
    """Check that the invoice sheet has all required columns. Add missing ones."""
    headers = ws.row_values(1)
    headers_lower = [h.strip().lower() for h in headers]
    missing = [col for col in REQUIRED_COLUMNS if col.lower() not in headers_lower]
    if missing:
        # Append missing columns to the right
        start_col = len(headers) + 1
        for i, col in enumerate(missing):
            ws.update_cell(1, start_col + i, col)
        headers = ws.row_values(1)  # re-read
        log.info("sheets: auto-added columns: %s", missing)
    return [h.strip().lower() for h in headers]


def sync_status() -> dict:
    return {
        "enabled": get_settings().sheets_enabled,
        "last_sync_at": _last_sync_at.isoformat() if _last_sync_at else None,
        "last_row_count": _last_row_count,
    }


def sync_invoices_from_sheets() -> dict:
    """Pull rows from the invoice sheet into DB. Respects sheet values for
    status, stage, followup_count — so the sheet is always the master."""
    global _last_sync_at, _last_row_count
    s = get_settings()
    if not s.sheets_enabled:
        return {"synced": 0, "skipped": True, "reason": "SHEETS_ENABLED=false"}

    try:
        from app.db import repos
        from app.models.invoice import InvoiceRecord
        from app.models.enums import InvoiceStatus, EscalationStage, days_overdue_to_stage

        ws = _open_invoice_sheet()
        if not ws:
            return {"synced": 0, "error": "Could not open sheet"}

        headers = _ensure_columns(ws)
        rows = ws.get_all_records()

        today = date.today()
        synced_count = 0
        for row in rows:
            if not row.get("invoice_id"):
                continue
            try:
                due_date_str = str(row["due_date"])
                due_date_obj = date.fromisoformat(due_date_str)
                days_overdue = max(0, (today - due_date_obj).days)

                # Read status from sheet if present, default ACTIVE
                status_raw = str(row.get("status", "ACTIVE")).strip().upper()
                try:
                    status = InvoiceStatus(status_raw)
                except ValueError:
                    status = InvoiceStatus.ACTIVE

                # Read followup_count from sheet
                fc_raw = row.get("followup_count", 0)
                followup_count = int(fc_raw) if fc_raw not in (None, "", " ") else 0

                # Stage from sheet if valid, otherwise compute from days
                stage_raw = str(row.get("stage", "")).strip().upper()
                try:
                    stage = EscalationStage(stage_raw)
                except ValueError:
                    stage = days_overdue_to_stage(days_overdue)

                record = InvoiceRecord(
                    invoice_id=str(row["invoice_id"]),
                    client_name=str(row["client_name"]),
                    client_email=str(row["client_email"]),
                    amount=float(row["amount"]),
                    currency=str(row.get("currency", "INR")),
                    due_date=due_date_obj,
                    days_overdue=days_overdue,
                    stage=stage,
                    status=status,
                    followup_count=followup_count,
                    payment_link=str(row.get("payment_link", "")) if row.get("payment_link") else None,
                    notes=str(row.get("notes", "")) if row.get("notes") else None,
                )
                repos.upsert_invoice(record)
                synced_count += 1
            except Exception as e:
                log.error("Failed to parse row %s: %s", row.get("invoice_id"), e)

        _last_row_count = synced_count
        _last_sync_at = datetime.utcnow()
        return {"synced": synced_count, "skipped": False}
    except Exception as exc:
        log.exception("sheets sync failed")
        return {"synced": 0, "error": str(exc), "skipped": False}


def update_invoice_on_sheet(
    invoice_id: str,
    *,
    status: Optional[str] = None,
    stage: Optional[str] = None,
    followup_count: Optional[int] = None,
    last_email_date: Optional[str] = None,
    last_email_tone: Optional[str] = None,
) -> bool:
    """Write back invoice changes to the Google Sheet. Finds the row by
    invoice_id and updates the relevant columns. Returns True on success."""
    s = get_settings()
    if not s.sheets_enabled or not s.sheets_invoice_id:
        return False
    try:
        ws = _open_invoice_sheet()
        if not ws:
            return False

        headers = [h.strip().lower() for h in ws.row_values(1)]

        # Find the row by invoice_id
        id_col_idx = headers.index("invoice_id") + 1  # 1-based
        all_ids = ws.col_values(id_col_idx)
        row_idx = None
        for i, val in enumerate(all_ids):
            if str(val).strip() == str(invoice_id).strip():
                row_idx = i + 1  # 1-based
                break

        if row_idx is None:
            log.warning("sheets: invoice_id %s not found on sheet", invoice_id)
            return False

        # Build updates
        updates = {}
        if status is not None and "status" in headers:
            updates[headers.index("status") + 1] = status
        if stage is not None and "stage" in headers:
            updates[headers.index("stage") + 1] = stage
        if followup_count is not None and "followup_count" in headers:
            updates[headers.index("followup_count") + 1] = str(followup_count)
        if last_email_date is not None and "last_email_date" in headers:
            updates[headers.index("last_email_date") + 1] = last_email_date
        if last_email_tone is not None and "last_email_tone" in headers:
            updates[headers.index("last_email_tone") + 1] = last_email_tone

        for col, val in updates.items():
            ws.update_cell(row_idx, col, val)

        log.info("sheets: updated invoice %s on sheet (cols: %s)", invoice_id, list(updates.keys()))
        return True
    except Exception:
        log.exception("sheets: writeback failed for %s", invoice_id)
        return False


def append_audit_row(row: list) -> None:
    s = get_settings()
    if not s.sheets_enabled or not s.sheets_audit_id:
        return
    try:
        gc = _get_gc()
        sheet = gc.open_by_key(s.sheets_audit_id).sheet1
        sheet.append_row(row)
    except Exception:
        log.exception("sheets audit append failed")
