"""Deterministic mock LLM used when no API key is configured or provider='mock'.

Produces realistic per-stage emails without calling any external API.
"""
from __future__ import annotations

import hashlib
import random
import time
from typing import Tuple

from app.models.email_output import GeneratedEmail
from app.models.enums import ToneLevel

_TONE_BY_STAGE = {
    1: ToneLevel.WARM_FRIENDLY,
    2: ToneLevel.POLITE_FIRM,
    3: ToneLevel.FORMAL_SERIOUS,
    4: ToneLevel.STERN_URGENT,
}

_SUBJECT_BY_STAGE = {
    1: "Quick Reminder – Invoice {invoice_id} | {currency} {amount:,.2f} Due",
    2: "Follow-up: Invoice {invoice_id} is {days_overdue} days overdue",
    3: "IMPORTANT: Outstanding Payment – Invoice {invoice_id} ({days_overdue} Days Overdue)",
    4: "FINAL NOTICE – Invoice {invoice_id} – Immediate Action Required",
}

_BODY_BY_STAGE = {
    1: (
        "Hi {client_name},\n\n"
        "I hope you're doing well! This is a friendly reminder that Invoice "
        "{invoice_id} for {currency} {amount:,.2f} was due on {due_date} "
        "and is now {days_overdue} day(s) overdue.\n\n"
        "If you have already processed this, please disregard. Otherwise, "
        "you can use the payment link below:\n{payment_link}\n\n"
        "Thanks so much — appreciate it!\n\n"
        "— Finance team"
    ),
    2: (
        "Hi {client_name},\n\n"
        "Just following up on Invoice {invoice_id} for {currency} {amount:,.2f}, "
        "which was due on {due_date} and is now {days_overdue} days overdue.\n\n"
        "Could you please confirm the expected payment date? "
        "You can settle the amount directly via the link below:\n{payment_link}\n\n"
        "Thanks for your prompt attention.\n\n"
        "— Finance team"
    ),
    3: (
        "Dear {client_name},\n\n"
        "Despite our previous reminders, Invoice {invoice_id} for "
        "{currency} {amount:,.2f} (due {due_date}) remains unpaid and is now "
        "{days_overdue} days overdue.\n\n"
        "We request your immediate attention to this matter. Continued "
        "non-payment may impact your credit terms with us.\n\n"
        "Please respond within 48 hours with either payment confirmation or "
        "a proposed resolution plan. Payment link: {payment_link}\n\n"
        "Regards,\nFinance team"
    ),
    4: (
        "Dear {client_name},\n\n"
        "This is our FINAL automated reminder regarding Invoice {invoice_id} "
        "for {currency} {amount:,.2f}, which is now {days_overdue} days "
        "overdue (due {due_date}).\n\n"
        "Failure to remit payment within 24 hours will result in escalation "
        "to our legal and recovery team. Please act immediately using the "
        "payment link below or contact us to resolve:\n{payment_link}\n\n"
        "Regards,\nFinance team"
    ),
}


def _deterministic_confidence(invoice_id: str, stage: int) -> float:
    """Seeded pseudo-random confidence so demos look lively but reproducible."""
    h = hashlib.md5(f"{invoice_id}:{stage}".encode()).hexdigest()
    seed = int(h[:8], 16)
    rnd = random.Random(seed)
    base = {1: 0.88, 2: 0.84, 3: 0.78, 4: 0.66}[stage]
    return round(max(0.35, min(0.99, base + rnd.uniform(-0.12, 0.10))), 3)


def complete_mock(
    *,
    invoice_id: str,
    client_name: str,
    amount: float,
    currency: str,
    due_date: str,
    days_overdue: int,
    payment_link: str | None,
    stage: int,
    followup_count: int = 0,
) -> Tuple[GeneratedEmail, int, int]:
    start = time.time()
    # Simulate some latency spread
    time.sleep(0.02)

    fmt = dict(
        invoice_id=invoice_id,
        client_name=client_name,
        amount=amount,
        currency=currency,
        due_date=due_date,
        days_overdue=days_overdue,
        payment_link=payment_link or "(contact finance for bank details)",
    )
    subject = _SUBJECT_BY_STAGE[stage].format(**fmt)
    body = _BODY_BY_STAGE[stage].format(**fmt)

    email = GeneratedEmail(
        subject=subject,
        body=body,
        tone=_TONE_BY_STAGE[stage],
        escalation_stage=stage,
        confidence_score=_deterministic_confidence(invoice_id, stage),
        invoice_id_used=invoice_id,
        client_name_used=client_name,
        amount_used=round(amount, 2),
        days_overdue_used=days_overdue,
    )
    tokens = len(subject.split()) + len(body.split()) + 80
    latency_ms = int((time.time() - start) * 1000) + 120  # pretend an LLM call
    return email, tokens, latency_ms
