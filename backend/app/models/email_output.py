from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from .enums import RiskLevel, ToneLevel


class GeneratedEmail(BaseModel):
    """Schema the LLM MUST produce. Used in JSON / structured-output mode."""
    subject: str = Field(..., min_length=5, max_length=200)
    body: str = Field(..., min_length=50, max_length=3000)
    tone: ToneLevel
    escalation_stage: int = Field(..., ge=1, le=4)
    confidence_score: float = Field(..., ge=0.0, le=1.0)

    # Anti-hallucination — cross-checked against source invoice
    invoice_id_used: str
    client_name_used: str
    amount_used: float
    days_overdue_used: int

    @field_validator("body")
    @classmethod
    def no_hallucination_placeholders(cls, v: str) -> str:
        placeholders = ["[INSERT", "[YOUR", "{{", "}}", "PLACEHOLDER", "TBD", "XXX"]
        upper = v.upper()
        for p in placeholders:
            if p in upper:
                raise ValueError(f"Email body contains unfilled placeholder: {p}")
        return v


class HallucinationCheckResult(BaseModel):
    passed: bool
    mismatched_fields: list[str] = []
    details: dict = {}


def check_hallucination(email: GeneratedEmail, source) -> HallucinationCheckResult:
    """source is InvoiceRecord (kept untyped to avoid circular import)."""
    mismatches: list[str] = []
    if email.invoice_id_used != source.invoice_id:
        mismatches.append(f"invoice_id: got {email.invoice_id_used}, expected {source.invoice_id}")
    if email.client_name_used.lower().strip() != source.client_name.lower().strip():
        mismatches.append(f"client_name: got {email.client_name_used}, expected {source.client_name}")
    if abs(email.amount_used - source.amount) > 0.01:
        mismatches.append(f"amount: got {email.amount_used}, expected {source.amount}")
    if abs(email.days_overdue_used - source.days_overdue) > 1:
        mismatches.append(f"days_overdue: got {email.days_overdue_used}, expected {source.days_overdue}")
    return HallucinationCheckResult(passed=len(mismatches) == 0, mismatched_fields=mismatches)


class EmailApprovalRequest(BaseModel):
    invoice_id: str
    generated_email: GeneratedEmail
    reason_for_review: str
    queued_at: datetime
    confidence_score: float
    risk_level: RiskLevel


class HumanReviewAction(BaseModel):
    invoice_id: str
    action: str = Field(..., pattern=r"^(approve|edit|reject|regenerate|flag)$")
    edited_subject: Optional[str] = None
    edited_body: Optional[str] = None
    reviewer_note: Optional[str] = None
