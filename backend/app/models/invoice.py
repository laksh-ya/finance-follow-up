from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from .enums import EscalationStage, InvoiceStatus


_DANGEROUS = [
    "ignore previous", "forget instructions", "system:",
    "assistant:", "human:", "<|", "|>", "{{", "}}",
]


def _sanitize(v: str) -> str:
    low = v.lower()
    for pat in _DANGEROUS:
        if pat in low:
            raise ValueError(f"Contains forbidden pattern: {pat}")
    return v.strip()


class InvoiceRecord(BaseModel):
    invoice_id: str = Field(..., pattern=r"^INV-\d{4}-\d+$")
    client_name: str = Field(..., min_length=1, max_length=200)
    client_email: EmailStr
    amount: float = Field(..., gt=0)
    currency: str = Field(default="INR", max_length=3)
    due_date: date
    days_overdue: int = Field(..., ge=0)
    followup_count: int = Field(default=0, ge=0)
    stage: EscalationStage = EscalationStage.PENDING
    status: InvoiceStatus = InvoiceStatus.ACTIVE
    payment_link: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("client_name")
    @classmethod
    def sanitize_client_name(cls, v: str) -> str:
        return _sanitize(v)

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v: float) -> float:
        if v > 10_000_000:
            raise ValueError("Amount exceeds maximum allowed value")
        return round(v, 2)

    model_config = {"str_strip_whitespace": True}


class InvoiceIngestion(BaseModel):
    """Loose schema for CSV / Sheets import before normalisation."""
    invoice_id: str
    client_name: str
    client_email: str
    amount: float
    currency: str = "INR"
    due_date: str
    followup_count: int = 0
    payment_link: Optional[str] = None


class InvoiceStatusUpdate(BaseModel):
    status: InvoiceStatus
    notes: Optional[str] = None
