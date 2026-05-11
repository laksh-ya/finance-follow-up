"""SQLModel ORM tables. Keep separate from the Pydantic DTOs in app/models/."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlmodel import Field, SQLModel

from app.models.enums import (
    AuditAction,
    DeliveryStatus,
    EscalationStage,
    InvoiceStatus,
    ToneLevel,
)


class InvoiceTable(SQLModel, table=True):
    __tablename__ = "invoices"

    invoice_id: str = Field(primary_key=True)
    client_name: str
    client_email: str
    amount: float
    currency: str = "INR"
    due_date: date
    days_overdue: int = 0
    followup_count: int = 0
    stage: EscalationStage = EscalationStage.PENDING
    status: InvoiceStatus = InvoiceStatus.ACTIVE
    payment_link: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # latest generated email cache (JSON-encoded)
    last_email_subject: Optional[str] = None
    last_email_body: Optional[str] = None
    last_email_tone: Optional[ToneLevel] = None
    last_confidence: Optional[float] = None
    last_processed_at: Optional[datetime] = None


class AuditTable(SQLModel, table=True):
    __tablename__ = "audit_entries"

    id: str = Field(primary_key=True)
    invoice_id: str = Field(index=True)
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)
    action: AuditAction
    stage: EscalationStage
    tone_used: Optional[ToneLevel] = None
    email_subject: Optional[str] = None
    confidence_score: Optional[float] = None
    risk_level: Optional[str] = None
    tokens_used: Optional[int] = None
    latency_ms: Optional[int] = None
    retry_count: int = 0
    fallback_used: bool = False
    delivery_status: DeliveryStatus = DeliveryStatus.QUEUED
    human_override: bool = False
    override_reason: Optional[str] = None
    validation_errors: str = ""  # pipe-joined
    error_message: Optional[str] = None
    model_used: Optional[str] = None


class HumanQueueTable(SQLModel, table=True):
    __tablename__ = "human_queue"

    id: Optional[int] = Field(default=None, primary_key=True)
    invoice_id: str = Field(index=True)
    queued_at: datetime = Field(default_factory=datetime.utcnow)
    reason: str
    confidence_score: float = 0.0
    risk_level: str = "MEDIUM"
    email_subject: str
    email_body: str
    email_tone: ToneLevel
    status: DeliveryStatus = DeliveryStatus.HUMAN_PENDING
    reviewer_note: Optional[str] = None
    reviewed_at: Optional[datetime] = None


class DeadLetterTable(SQLModel, table=True):
    __tablename__ = "dead_letter"

    id: Optional[int] = Field(default=None, primary_key=True)
    invoice_id: str = Field(index=True)
    error_message: str
    failed_at: datetime = Field(default_factory=datetime.utcnow)
    retry_count: int = 0
    resolved: bool = False


class ActivityEventTable(SQLModel, table=True):
    """Lightweight event feed for the live dashboard."""
    __tablename__ = "activity_events"

    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)
    invoice_id: Optional[str] = None
    event_type: str  # e.g. "email_sent", "stage_escalated", "human_pending"
    message: str
    level: str = "info"  # info | warn | error | success


class SentEmailTable(SQLModel, table=True):
    """Source of truth for every email actually dispatched (or attempted).

    Both pipeline auto-dispatch and human-queue approve/edit funnel through
    here so the dashboard can show 'what did we send to this customer'.
    """

    __tablename__ = "sent_emails"

    id: Optional[int] = Field(default=None, primary_key=True)
    invoice_id: str = Field(index=True)
    audit_id: Optional[str] = Field(default=None, index=True)  # FK to AuditTable.id
    sent_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    to_email: str  # full address (kept for reviewer; PII-masked in logs)
    from_email: str
    subject: str
    body: str  # full body, used for the dashboard preview
    tone: ToneLevel
    stage: EscalationStage
    confidence_score: Optional[float] = None
    provider: str  # "resend" | "smtp" | "mailtrap" | "mock"
    provider_message_id: Optional[str] = None
    status: DeliveryStatus = DeliveryStatus.QUEUED
    error_message: Optional[str] = None
    human_approved: bool = False
    reviewer_note: Optional[str] = None
    edited_by_human: bool = False  # True if reviewer changed subject/body
    model_used: Optional[str] = None
    tokens_used: Optional[int] = None
