"""Repository helpers — thin wrappers over SQLModel sessions."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlmodel import select

from app.db.database import db_session
from app.db.tables import (
    ActivityEventTable,
    AuditTable,
    DeadLetterTable,
    HumanQueueTable,
    InvoiceTable,
    SentEmailTable,
)
from app.models.enums import (
    AuditAction,
    DeliveryStatus,
    EscalationStage,
    InvoiceStatus,
    ToneLevel,
    days_overdue_to_stage,
)
from app.models.invoice import InvoiceRecord


# ---- Invoices -------------------------------------------------------

def list_invoices(
    *,
    status: Optional[InvoiceStatus] = None,
    stage: Optional[EscalationStage] = None,
    limit: int = 200,
    offset: int = 0,
) -> list[InvoiceTable]:
    with db_session() as s:
        q = select(InvoiceTable).order_by(InvoiceTable.days_overdue.desc())
        if status:
            q = q.where(InvoiceTable.status == status)
        if stage:
            q = q.where(InvoiceTable.stage == stage)
        q = q.offset(offset).limit(limit)
        return list(s.exec(q).all())


def get_invoice(invoice_id: str) -> Optional[InvoiceTable]:
    with db_session() as s:
        return s.get(InvoiceTable, invoice_id)


def get_overdue_invoices() -> list[InvoiceTable]:
    with db_session() as s:
        q = select(InvoiceTable).where(
            InvoiceTable.status == InvoiceStatus.ACTIVE,
            InvoiceTable.days_overdue > 0,
        )
        return list(s.exec(q).all())


def upsert_invoice(record: InvoiceRecord) -> InvoiceTable:
    now = datetime.utcnow()
    with db_session() as s:
        existing = s.get(InvoiceTable, record.invoice_id)
        if existing:
            existing.client_name = record.client_name
            existing.client_email = record.client_email
            existing.amount = record.amount
            existing.currency = record.currency
            existing.due_date = record.due_date
            existing.days_overdue = record.days_overdue
            existing.followup_count = record.followup_count
            existing.stage = record.stage
            existing.status = record.status
            existing.payment_link = record.payment_link
            existing.notes = record.notes
            existing.updated_at = now
            s.add(existing)
            return existing
        row = InvoiceTable(
            invoice_id=record.invoice_id,
            client_name=record.client_name,
            client_email=record.client_email,
            amount=record.amount,
            currency=record.currency,
            due_date=record.due_date,
            days_overdue=record.days_overdue,
            followup_count=record.followup_count,
            stage=record.stage,
            status=record.status,
            payment_link=record.payment_link,
            notes=record.notes,
        )
        s.add(row)
        return row


def update_invoice_status(invoice_id: str, status: InvoiceStatus, notes: Optional[str] = None) -> Optional[InvoiceTable]:
    with db_session() as s:
        row = s.get(InvoiceTable, invoice_id)
        if not row:
            return None
        row.status = status
        if notes is not None:
            row.notes = notes
        row.updated_at = datetime.utcnow()
        s.add(row)
        return row


def update_invoice_email_cache(
    invoice_id: str,
    *,
    subject: str,
    body: str,
    tone: ToneLevel,
    confidence: float,
    success: bool = True,
) -> None:
    """Update the invoice's last-email cache.

    When ``success=False`` we still record that we *attempted* a draft (so the
    operator sees the failed subject/body and can resend) BUT we do not bump
    ``followup_count`` — that counter must only reflect deliveries that
    actually went out. The frontend reads ``last_delivery_status`` separately
    to decide whether to render a success or failure pill.
    """
    with db_session() as s:
        row = s.get(InvoiceTable, invoice_id)
        if not row:
            return
        row.last_email_subject = subject
        row.last_email_body = body
        row.last_email_tone = tone
        row.last_confidence = confidence
        row.last_processed_at = datetime.utcnow()
        if success:
            row.followup_count = (row.followup_count or 0) + 1
        s.add(row)


def recompute_days_overdue() -> int:
    today = date.today()
    touched = 0
    with db_session() as s:
        rows = list(s.exec(select(InvoiceTable)).all())
        for r in rows:
            delta = (today - r.due_date).days
            r.days_overdue = max(0, delta)
            r.stage = days_overdue_to_stage(r.days_overdue)
            s.add(r)
            touched += 1
    return touched


# ---- Audit ----------------------------------------------------------

def add_audit(entry: AuditTable) -> AuditTable:
    with db_session() as s:
        s.add(entry)
    return entry


def list_audit(
    *,
    invoice_id: Optional[str] = None,
    action: Optional[AuditAction] = None,
    limit: int = 200,
    offset: int = 0,
) -> list[AuditTable]:
    with db_session() as s:
        q = select(AuditTable).order_by(AuditTable.timestamp.desc())
        if invoice_id:
            q = q.where(AuditTable.invoice_id == invoice_id)
        if action:
            q = q.where(AuditTable.action == action)
        q = q.offset(offset).limit(limit)
        return list(s.exec(q).all())


# ---- Human queue ----------------------------------------------------

def enqueue_human(row: HumanQueueTable) -> HumanQueueTable:
    with db_session() as s:
        s.add(row)
    return row


def list_human_queue(pending_only: bool = True) -> list[HumanQueueTable]:
    with db_session() as s:
        q = select(HumanQueueTable).order_by(HumanQueueTable.queued_at.desc())
        if pending_only:
            q = q.where(HumanQueueTable.status == DeliveryStatus.HUMAN_PENDING)
        return list(s.exec(q).all())


def cancel_pending_human_queue(invoice_id: str, reason: str = "superseded by new draft") -> int:
    """Resolve any HUMAN_PENDING entries for this invoice as REJECTED with a
    'superseded' note. Used right before enqueueing a fresh draft so that the
    Review Queue never accumulates duplicates for the same invoice.

    Returns the number of rows cancelled.
    """
    cancelled = 0
    with db_session() as s:
        rows = list(s.exec(
            select(HumanQueueTable).where(
                HumanQueueTable.invoice_id == invoice_id,
                HumanQueueTable.status == DeliveryStatus.HUMAN_PENDING,
            )
        ).all())
        for r in rows:
            r.status = DeliveryStatus.HUMAN_REJECTED
            r.reviewer_note = reason
            r.reviewed_at = datetime.utcnow()
            s.add(r)
            cancelled += 1
    return cancelled


def resolve_human_queue(
    queue_id: int,
    new_status: DeliveryStatus,
    reviewer_note: Optional[str] = None,
    edited_subject: Optional[str] = None,
    edited_body: Optional[str] = None,
) -> Optional[HumanQueueTable]:
    with db_session() as s:
        row = s.get(HumanQueueTable, queue_id)
        if not row:
            return None
        row.status = new_status
        row.reviewed_at = datetime.utcnow()
        if reviewer_note:
            row.reviewer_note = reviewer_note
        if edited_subject:
            row.email_subject = edited_subject
        if edited_body:
            row.email_body = edited_body
        s.add(row)
        return row


# ---- Dead letter ----------------------------------------------------

def mark_dead_letter(invoice_id: str, error: str, retry_count: int = 0) -> DeadLetterTable:
    with db_session() as s:
        row = DeadLetterTable(invoice_id=invoice_id, error_message=error, retry_count=retry_count)
        s.add(row)
    return row


def list_dead_letter(unresolved_only: bool = True) -> list[DeadLetterTable]:
    with db_session() as s:
        q = select(DeadLetterTable).order_by(DeadLetterTable.failed_at.desc())
        if unresolved_only:
            q = q.where(DeadLetterTable.resolved == False)  # noqa: E712
        return list(s.exec(q).all())


def resolve_dead_letter(dl_id: int) -> Optional[DeadLetterTable]:
    with db_session() as s:
        row = s.get(DeadLetterTable, dl_id)
        if not row:
            return None
        row.resolved = True
        s.add(row)
        return row


# ---- Activity feed --------------------------------------------------

def push_activity(
    event_type: str,
    message: str,
    *,
    invoice_id: Optional[str] = None,
    level: str = "info",
) -> None:
    with db_session() as s:
        s.add(ActivityEventTable(
            event_type=event_type,
            message=message,
            invoice_id=invoice_id,
            level=level,
        ))


def list_activity(limit: int = 20) -> list[ActivityEventTable]:
    with db_session() as s:
        q = select(ActivityEventTable).order_by(ActivityEventTable.timestamp.desc()).limit(limit)
        return list(s.exec(q).all())


# ---- Metrics helpers ------------------------------------------------

def metrics_snapshot() -> dict:
    with db_session() as s:
        invoices = list(s.exec(select(InvoiceTable)).all())
        total = len(invoices)
        overdue = sum(1 for i in invoices if i.days_overdue > 0 and i.status == InvoiceStatus.ACTIVE)
        paid = sum(1 for i in invoices if i.status == InvoiceStatus.PAID)
        stage_counts = {s_.value: 0 for s_ in EscalationStage}
        for i in invoices:
            stage_counts[i.stage.value] = stage_counts.get(i.stage.value, 0) + 1

        today = datetime.utcnow().date()
        sent_today = 0
        audits = list(s.exec(select(AuditTable).where(AuditTable.action == AuditAction.EMAIL_SENT)).all())
        for a in audits:
            if a.timestamp.date() == today:
                sent_today += 1

        human_pending = len(list(s.exec(
            select(HumanQueueTable).where(HumanQueueTable.status == DeliveryStatus.HUMAN_PENDING)
        ).all()))
        dead_letters = len(list(s.exec(
            select(DeadLetterTable).where(DeadLetterTable.resolved == False)  # noqa: E712
        ).all()))

        # confidence distribution (from latest cached)
        buckets = {"low": 0, "medium": 0, "high": 0}
        for i in invoices:
            if i.last_confidence is None:
                continue
            if i.last_confidence < 0.5:
                buckets["low"] += 1
            elif i.last_confidence < 0.75:
                buckets["medium"] += 1
            else:
                buckets["high"] += 1

        return {
            "totals": {
                "invoices": total,
                "overdue": overdue,
                "paid": paid,
                "sent_today": sent_today,
                "human_pending": human_pending,
                "dead_letters": dead_letters,
            },
            "stage_counts": stage_counts,
            "confidence_distribution": buckets,
        }


def reset_all() -> None:
    """Danger: wipes all domain tables (used by Settings → Clear DB)."""
    from sqlalchemy import delete
    with db_session() as s:
        for Tbl in (
            ActivityEventTable,
            SentEmailTable,
            DeadLetterTable,
            HumanQueueTable,
            AuditTable,
            InvoiceTable,
        ):
            s.exec(delete(Tbl))


# ---- Sent emails (source of truth for what we actually dispatched) -

def add_sent_email(row: SentEmailTable) -> SentEmailTable:
    with db_session() as s:
        s.add(row)
    return row


def list_sent_emails(
    *,
    invoice_id: Optional[str] = None,
    status: Optional[DeliveryStatus] = None,
    limit: int = 200,
    offset: int = 0,
) -> list[SentEmailTable]:
    with db_session() as s:
        q = select(SentEmailTable).order_by(SentEmailTable.sent_at.desc())
        if invoice_id:
            q = q.where(SentEmailTable.invoice_id == invoice_id)
        if status:
            q = q.where(SentEmailTable.status == status)
        q = q.offset(offset).limit(limit)
        return list(s.exec(q).all())


def get_sent_email(sent_id: int) -> Optional[SentEmailTable]:
    with db_session() as s:
        return s.get(SentEmailTable, sent_id)


def last_delivery_status_map(invoice_ids: list[str]) -> dict[str, dict]:
    """For each given invoice_id, return the most recent SentEmailTable row's
    delivery_status, sent_at, provider and error_message.

    Returns dict: invoice_id → {status, sent_at, provider, error_message}.
    Used by the Invoices table view to render success/failure pills without
    requiring a join in the application layer.
    """
    if not invoice_ids:
        return {}
    out: dict[str, dict] = {}
    with db_session() as s:
        rows = list(s.exec(
            select(SentEmailTable)
            .where(SentEmailTable.invoice_id.in_(invoice_ids))  # type: ignore[attr-defined]
            .order_by(SentEmailTable.sent_at.desc())
        ).all())
        # Take the first (newest) entry per invoice_id.
        for r in rows:
            if r.invoice_id not in out:
                out[r.invoice_id] = {
                    "status": r.status.value,
                    "sent_at": r.sent_at.isoformat() if r.sent_at else None,
                    "provider": r.provider,
                    "error_message": r.error_message,
                }
    return out


def list_failed_invoice_ids() -> list[str]:
    """Return invoice_ids whose most-recent SentEmailTable row has status=FAILED.
    Powers the 'Resend Failed' button on the Invoices page.
    """
    failed: list[str] = []
    seen: set[str] = set()
    with db_session() as s:
        rows = list(s.exec(
            select(SentEmailTable).order_by(SentEmailTable.sent_at.desc())
        ).all())
        for r in rows:
            if r.invoice_id in seen:
                continue
            seen.add(r.invoice_id)
            if r.status == DeliveryStatus.FAILED:
                failed.append(r.invoice_id)
    return failed


def invoice_timeline(invoice_id: str, limit: int = 200) -> list[dict]:
    """Unified chronological feed for one invoice: audit + sent + activity."""
    items: list[dict] = []
    with db_session() as s:
        audits = list(s.exec(
            select(AuditTable)
            .where(AuditTable.invoice_id == invoice_id)
            .order_by(AuditTable.timestamp.desc())
            .limit(limit)
        ).all())
        for a in audits:
            items.append({
                "kind": "audit",
                "id": a.id,
                "timestamp": a.timestamp.isoformat(),
                "action": a.action.value,
                "stage": a.stage.value,
                "delivery_status": a.delivery_status.value,
                "model_used": a.model_used,
                "tokens_used": a.tokens_used,
                "latency_ms": a.latency_ms,
                "confidence_score": a.confidence_score,
                "fallback_used": a.fallback_used,
                "human_override": a.human_override,
                "validation_errors": a.validation_errors.split("|") if a.validation_errors else [],
                "error_message": a.error_message,
                "subject": a.email_subject,
            })

        sents = list(s.exec(
            select(SentEmailTable)
            .where(SentEmailTable.invoice_id == invoice_id)
            .order_by(SentEmailTable.sent_at.desc())
            .limit(limit)
        ).all())
        for em in sents:
            items.append({
                "kind": "sent_email",
                "id": em.id,
                "timestamp": em.sent_at.isoformat(),
                "to_email": em.to_email,
                "from_email": em.from_email,
                "subject": em.subject,
                "body": em.body,
                "tone": em.tone.value,
                "stage": em.stage.value,
                "provider": em.provider,
                "provider_message_id": em.provider_message_id,
                "status": em.status.value,
                "error_message": em.error_message,
                "human_approved": em.human_approved,
                "edited_by_human": em.edited_by_human,
                "reviewer_note": em.reviewer_note,
                "model_used": em.model_used,
                "tokens_used": em.tokens_used,
                "confidence_score": em.confidence_score,
            })

        events = list(s.exec(
            select(ActivityEventTable)
            .where(ActivityEventTable.invoice_id == invoice_id)
            .order_by(ActivityEventTable.timestamp.desc())
            .limit(limit)
        ).all())
        for e in events:
            items.append({
                "kind": "activity",
                "id": e.id,
                "timestamp": e.timestamp.isoformat(),
                "event_type": e.event_type,
                "message": e.message,
                "level": e.level,
            })

    items.sort(key=lambda x: x["timestamp"], reverse=True)
    return items[:limit]
