from __future__ import annotations

from typing import Optional, TypedDict


class InvoiceState(TypedDict, total=False):
    # core
    invoice_id: str
    invoice: dict  # serialized InvoiceRecord

    # pipeline tracking
    stage: int
    retry_count: int
    fallback_used: bool

    # prompt + llm
    prompt_version: Optional[str]
    system_prompt: Optional[str]
    user_prompt: Optional[str]
    raw_llm_response: Optional[str]

    # output
    generated_email: Optional[dict]
    confidence_score: float
    risk_level: str
    hallucination_check: Optional[dict]
    validation_errors: list[str]

    # routing
    requires_human: bool
    human_reason: Optional[str]

    # observability
    tokens_used: Optional[int]
    latency_ms: Optional[int]
    model_used: Optional[str]

    # audit
    audit_entries: list[dict]
    error: Optional[str]

    # manual overrides (optional)
    tone_override: Optional[int]  # 1..4 to force stage tone regardless of days_overdue

    # populated by dispatch_email node when an email is actually sent (or attempted)
    sent_email_id: Optional[int]


def initial_state(invoice_id: str) -> InvoiceState:
    return {
        "invoice_id": invoice_id,
        "invoice": {},
        "stage": 0,
        "retry_count": 0,
        "fallback_used": False,
        "prompt_version": None,
        "system_prompt": None,
        "user_prompt": None,
        "raw_llm_response": None,
        "generated_email": None,
        "confidence_score": 0.0,
        "risk_level": "UNKNOWN",
        "hallucination_check": None,
        "validation_errors": [],
        "requires_human": False,
        "human_reason": None,
        "tokens_used": None,
        "latency_ms": None,
        "model_used": None,
        "audit_entries": [],
        "error": None,
        "tone_override": None,
    }
