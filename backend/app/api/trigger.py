from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.auth import verify_api_key
from app.api.envelope import Envelope, ok
from app.tasks.invoice_tasks import process_invoice, scan_and_enqueue

router = APIRouter(prefix="/api/trigger", tags=["trigger"], dependencies=[Depends(verify_api_key)])


@router.post("/scan", response_model=Envelope)
def trigger_scan(force: bool = False, failed_only: bool = False):
    """Process overdue invoices.

    - default                → only unprocessed ones
    - ``force=true``         → re-process all (except PAID/PAUSED/LEGAL)
    - ``failed_only=true``   → re-process only invoices whose latest send FAILED
    """
    result = scan_and_enqueue.apply(args=[force, failed_only]).get()
    return ok(result)


@router.post("/invoice/{invoice_id}", response_model=Envelope)
def trigger_single(invoice_id: str):
    result = process_invoice.apply(args=[invoice_id]).get()
    return ok(result)
