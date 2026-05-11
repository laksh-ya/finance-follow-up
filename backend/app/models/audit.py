from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from .enums import AuditAction, DeliveryStatus, EscalationStage, ToneLevel


class AuditEntry(BaseModel):
    id: str
    invoice_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
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
    validation_errors: list[str] = []
    error_message: Optional[str] = None
    model_used: Optional[str] = None

    def to_sheets_row(self) -> list:
        return [
            self.id, self.invoice_id, self.timestamp.isoformat(),
            self.action.value, self.stage.value,
            self.tone_used.value if self.tone_used else "",
            self.email_subject or "",
            str(self.confidence_score or ""),
            str(self.tokens_used or ""),
            str(self.latency_ms or ""),
            str(self.retry_count), str(self.fallback_used),
            self.delivery_status.value, str(self.human_override),
            self.override_reason or "",
            "|".join(self.validation_errors),
            self.error_message or "", self.model_used or "",
        ]
