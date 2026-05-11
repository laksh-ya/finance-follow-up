from enum import Enum


class EscalationStage(str, Enum):
    PENDING = "PENDING"
    STAGE_1 = "STAGE_1"
    STAGE_2 = "STAGE_2"
    STAGE_3 = "STAGE_3"
    STAGE_4 = "STAGE_4"
    ESCALATED = "ESCALATED"


class InvoiceStatus(str, Enum):
    ACTIVE = "ACTIVE"
    PAID = "PAID"
    DISPUTED = "DISPUTED"
    LEGAL = "LEGAL"
    PAUSED = "PAUSED"


class ToneLevel(str, Enum):
    WARM_FRIENDLY = "WARM_FRIENDLY"
    POLITE_FIRM = "POLITE_FIRM"
    FORMAL_SERIOUS = "FORMAL_SERIOUS"
    STERN_URGENT = "STERN_URGENT"


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class DeliveryStatus(str, Enum):
    QUEUED = "QUEUED"
    SENT = "SENT"
    FAILED = "FAILED"
    SANDBOX = "SANDBOX"
    MOCK = "MOCK"
    HUMAN_PENDING = "HUMAN_PENDING"
    HUMAN_APPROVED = "HUMAN_APPROVED"
    HUMAN_REJECTED = "HUMAN_REJECTED"


class AuditAction(str, Enum):
    EMAIL_GENERATED = "EMAIL_GENERATED"
    EMAIL_SENT = "EMAIL_SENT"
    EMAIL_FAILED = "EMAIL_FAILED"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    FALLBACK_USED = "FALLBACK_USED"
    HUMAN_OVERRIDE = "HUMAN_OVERRIDE"
    HUMAN_APPROVED = "HUMAN_APPROVED"
    HUMAN_REJECTED = "HUMAN_REJECTED"
    STAGE_ESCALATED = "STAGE_ESCALATED"
    RETRY_TRIGGERED = "RETRY_TRIGGERED"
    INVOICE_INGESTED = "INVOICE_INGESTED"


STAGE_TO_INT = {
    EscalationStage.PENDING: 0,
    EscalationStage.STAGE_1: 1,
    EscalationStage.STAGE_2: 2,
    EscalationStage.STAGE_3: 3,
    EscalationStage.STAGE_4: 4,
    EscalationStage.ESCALATED: 0,
}

INT_TO_STAGE = {
    1: EscalationStage.STAGE_1,
    2: EscalationStage.STAGE_2,
    3: EscalationStage.STAGE_3,
    4: EscalationStage.STAGE_4,
}


def days_overdue_to_stage(days: int) -> EscalationStage:
    if days <= 0:
        return EscalationStage.PENDING
    if days <= 7:
        return EscalationStage.STAGE_1
    if days <= 14:
        return EscalationStage.STAGE_2
    if days <= 21:
        return EscalationStage.STAGE_3
    if days <= 30:
        return EscalationStage.STAGE_4
    return EscalationStage.ESCALATED
