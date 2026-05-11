"""Celery tasks. In eager mode these just run inline (no worker needed)."""
from __future__ import annotations

import logging

from app.db import repos
from app.models.enums import InvoiceStatus
from app.pipeline.graph import run_for_invoice
from app.services import mock_seed, sheets
from app.tasks.celery_app import celery

log = logging.getLogger(__name__)


@celery.task(bind=True, max_retries=3, name="tasks.process_invoice")
def process_invoice(self, invoice_id: str, tone_override: int | None = None):
    try:
        log.info("process_invoice start invoice=%s", invoice_id)
        result = run_for_invoice(invoice_id, tone_override=tone_override)
        log.info("process_invoice done invoice=%s", invoice_id)
        return {"status": "completed", "invoice_id": invoice_id, "stage": result.get("stage")}
    except Exception as exc:
        log.exception("process_invoice failed")
        try:
            countdown = 60 * (2 ** self.request.retries)
            raise self.retry(exc=exc, countdown=countdown)
        except self.MaxRetriesExceededError:
            repos.mark_dead_letter(invoice_id, str(exc), retry_count=self.max_retries)
            return {"status": "dead_letter", "invoice_id": invoice_id, "error": str(exc)}


@celery.task(name="tasks.scan_and_enqueue")
def scan_and_enqueue(force: bool = False, failed_only: bool = False):
    """Fetch overdue actives + kick off pipeline for each.

    Behaviour matrix:
      - default            → skip invoices that were already processed
      - force=True         → reprocess everything (still skipping PAID/PAUSED/LEGAL)
      - failed_only=True   → reprocess ONLY invoices whose latest delivery FAILED
                              (overrides force; used by the "Resend Failed" button)
    """
    repos.recompute_days_overdue()

    if failed_only:
        failed_ids = set(repos.list_failed_invoice_ids())
        if not failed_ids:
            repos.push_activity("scan", "Resend failed: no failed invoices found", level="info")
            return {"enqueued": 0, "skipped": 0, "failed_only": True}
        enqueued = 0
        for inv_id in failed_ids:
            inv = repos.get_invoice(inv_id)
            if not inv or inv.status in (InvoiceStatus.PAID, InvoiceStatus.PAUSED, InvoiceStatus.LEGAL):
                continue
            process_invoice.apply_async(
                args=[inv.invoice_id],
                queue="high_priority" if inv.days_overdue >= 15 else "default",
            )
            enqueued += 1
        repos.push_activity("scan", f"Resend failed — {enqueued} retried", level="warn")
        return {"enqueued": enqueued, "skipped": 0, "failed_only": True}

    invoices = repos.get_overdue_invoices()
    enqueued = 0
    skipped = 0
    for inv in invoices:
        if inv.status in (InvoiceStatus.PAID, InvoiceStatus.PAUSED, InvoiceStatus.LEGAL):
            continue
        if not force and inv.last_processed_at is not None:
            skipped += 1
            continue
        process_invoice.apply_async(
            args=[inv.invoice_id],
            queue="high_priority" if inv.days_overdue >= 15 else "default",
        )
        enqueued += 1
    msg = f"Scan complete — {enqueued} invoices enqueued"
    if skipped:
        msg += f" ({skipped} already processed, skipped)"
    repos.push_activity("scan", msg, level="info")
    return {"enqueued": enqueued, "skipped": skipped}


@celery.task(name="tasks.sync_google_sheets")
def sync_google_sheets():
    return sheets.sync_invoices_from_sheets()


@celery.task(name="tasks.retry_dead_letter")
def retry_dead_letter():
    rows = repos.list_dead_letter(unresolved_only=True)
    for row in rows:
        process_invoice.apply_async(args=[row.invoice_id])
        repos.resolve_dead_letter(row.id)  # type: ignore[arg-type]
    return {"retried": len(rows)}


@celery.task(name="tasks.seed_mock")
def seed_mock_invoices():
    return {"seeded": mock_seed.seed_invoices()}
