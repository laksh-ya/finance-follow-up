from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.auth import verify_api_key
from app.api.envelope import Envelope, ok
from app.services import sheets

router = APIRouter(prefix="/api/sheets", tags=["sheets"], dependencies=[Depends(verify_api_key)])


@router.get("/status", response_model=Envelope)
def status():
    return ok(sheets.sync_status())


@router.post("/sync", response_model=Envelope)
def sync():
    return ok(sheets.sync_invoices_from_sheets())
