from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.auth import verify_api_key
from app.api.envelope import Envelope, ok
from app.db import repos

router = APIRouter(prefix="/api/metrics", tags=["metrics"], dependencies=[Depends(verify_api_key)])


@router.get("", response_model=Envelope)
def metrics():
    return ok(repos.metrics_snapshot())


@router.get("/confidence-dist", response_model=Envelope)
def confidence_dist():
    snap = repos.metrics_snapshot()
    return ok(snap["confidence_distribution"])


@router.get("/activity-feed", response_model=Envelope)
def activity_feed(limit: int = 20):
    rows = repos.list_activity(limit=limit)
    return ok([
        {
            "id": r.id,
            "timestamp": r.timestamp.isoformat(),
            "invoice_id": r.invoice_id,
            "event_type": r.event_type,
            "message": r.message,
            "level": r.level,
        }
        for r in rows
    ])


@router.get("/dead-letter", response_model=Envelope)
def dead_letter():
    rows = repos.list_dead_letter(unresolved_only=False)
    return ok([
        {
            "id": r.id,
            "invoice_id": r.invoice_id,
            "error_message": r.error_message,
            "failed_at": r.failed_at.isoformat(),
            "retry_count": r.retry_count,
            "resolved": r.resolved,
        }
        for r in rows
    ])
