"""LangGraph nodes. Each mutates + returns the InvoiceState dict."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime

from app.config import get_settings
from app.db import repos
from app.db.tables import AuditTable, HumanQueueTable
from app.email.dispatcher import send_for_invoice
from app.llm.gateway import LLMGateway
from app.models.email_output import GeneratedEmail, check_hallucination
from app.models.enums import (
    STAGE_TO_INT,
    AuditAction,
    DeliveryStatus,
    EscalationStage,
    InvoiceStatus,
    RiskLevel,
    ToneLevel,
    days_overdue_to_stage,
)
from app.models.invoice import InvoiceRecord
from app.models.langgraph_state import InvoiceState
from app.pipeline.prompts import build_prompts
from app.services.langfuse_client import trace
from app.services.sheets import append_audit_row, update_invoice_on_sheet

log = logging.getLogger(__name__)

_gateway: LLMGateway | None = None


def _llm() -> LLMGateway:
    global _gateway
    if _gateway is None or _gateway.settings is not get_settings():
        _gateway = LLMGateway()
    return _gateway


# ---------------------------------------------------------------- nodes

def load_invoice_node(state: InvoiceState) -> InvoiceState:
    row = repos.get_invoice(state["invoice_id"])
    if not row:
        state["error"] = "invoice_not_found"
        state["validation_errors"].append("invoice_not_found")
        return state
    state["invoice"] = InvoiceRecord(
        invoice_id=row.invoice_id,
        client_name=row.client_name,
        client_email=row.client_email,
        amount=row.amount,
        currency=row.currency,
        due_date=row.due_date,
        days_overdue=row.days_overdue,
        followup_count=row.followup_count,
        stage=row.stage,
        status=row.status,
        payment_link=row.payment_link,
        notes=row.notes,
    ).model_dump(mode="json")
    return state


def classify_stage_node(state: InvoiceState) -> InvoiceState:
    inv = state["invoice"]
    if not inv:
        state["stage"] = 0
        return state
    esc = days_overdue_to_stage(inv["days_overdue"])
    if esc == EscalationStage.ESCALATED:
        state["stage"] = 0
        state["requires_human"] = True
        state["human_reason"] = "stage_escalated_30plus"
    else:
        state["stage"] = STAGE_TO_INT[esc]
    return state


def build_prompt_node(state: InvoiceState) -> InvoiceState:
    override = state.get("tone_override")
    if override and 1 <= override <= 4:
        state["stage"] = override
    stage = state["stage"]
    if stage < 1 or stage > 4:
        state["validation_errors"].append(f"invalid_stage_for_prompt:{stage}")
        return state
    sys_p, user_p = build_prompts(stage=stage, invoice=state["invoice"])
    state["system_prompt"] = sys_p
    state["user_prompt"] = user_p
    state["prompt_version"] = f"stage{stage}.v1"
    return state


def call_llm_node(state: InvoiceState) -> InvoiceState:
    inv = state["invoice"]
    try:
        with trace("llm.complete", invoice_id=inv["invoice_id"], stage=state["stage"]):
            email, tokens, latency = _llm().complete(
                invoice_id=inv["invoice_id"],
                client_name=inv["client_name"],
                amount=inv["amount"],
                currency=inv.get("currency", "INR"),
                due_date=str(inv["due_date"]),
                days_overdue=inv["days_overdue"],
                payment_link=inv.get("payment_link"),
                stage=state["stage"],
                followup_count=inv.get("followup_count", 0),
                system_prompt=state["system_prompt"] or "",
                user_prompt=state["user_prompt"] or "",
            )
        state["generated_email"] = email.model_dump(mode="json")
        state["tokens_used"] = tokens
        state["latency_ms"] = latency
        state["model_used"] = _llm().model_info
        state["confidence_score"] = email.confidence_score
    except Exception as exc:
        log.exception("llm call failed")
        state["error"] = str(exc)
        state["validation_errors"].append(f"llm_error:{exc!s}")
    return state


def validate_output_node(state: InvoiceState) -> InvoiceState:
    if not state.get("generated_email"):
        return state
    try:
        email = GeneratedEmail.model_validate(state["generated_email"])
    except Exception as exc:
        state["validation_errors"].append(f"schema:{exc!s}")
        # Increment retry_count here (not in the router — routers must be pure)
        state["retry_count"] = state.get("retry_count", 0) + 1
        return state

    source = InvoiceRecord.model_validate(state["invoice"])
    hc = check_hallucination(email, source)
    state["hallucination_check"] = hc.model_dump()
    if not hc.passed:
        for m in hc.mismatched_fields:
            state["validation_errors"].append(f"halluc:{m}")
        # Increment retry_count on hallucination failure too
        state["retry_count"] = state.get("retry_count", 0) + 1
    return state


def confidence_check_node(state: InvoiceState) -> InvoiceState:
    s = get_settings()
    score = state["confidence_score"]
    stage = state["stage"]

    if score >= 0.75:
        state["risk_level"] = RiskLevel.LOW.value
    elif score >= 0.5:
        state["risk_level"] = RiskLevel.MEDIUM.value
    else:
        state["risk_level"] = RiskLevel.HIGH.value

    # Human required if HIL enabled AND (low confidence OR stage 4) — matches SRS
    needs_human = False
    reason = None
    if s.human_in_loop:
        if score < s.llm.confidence_threshold:
            needs_human = True
            reason = "low_confidence"
        elif stage == 4:
            needs_human = True
            reason = "stage_4_final_notice"

    if not s.auto_dispatch:
        needs_human = True
        reason = reason or "auto_dispatch_disabled"

    state["requires_human"] = needs_human
    state["human_reason"] = reason
    return state


def dispatch_email_node(state: InvoiceState) -> InvoiceState:
    inv = state["invoice"]
    em = state["generated_email"]
    if not em:
        state["validation_errors"].append("dispatch:no_email")
        return state

    stage_enum = days_overdue_to_stage(inv["days_overdue"])
    result = send_for_invoice(
        invoice_id=inv["invoice_id"],
        to_email=inv["client_email"],
        subject=em["subject"],
        body=em["body"],
        tone=ToneLevel(em["tone"]),
        stage=stage_enum,
        confidence_score=em.get("confidence_score"),
        model_used=state.get("model_used"),
        tokens_used=state.get("tokens_used"),
    )
    state["sent_email_id"] = result.sent_email_id
    delivered = result.status != DeliveryStatus.FAILED
    state.setdefault("audit_entries", []).append({
        "action": AuditAction.EMAIL_SENT.value if delivered else AuditAction.EMAIL_FAILED.value,
        "delivery_status": result.status.value,
        "provider": result.provider,
        "provider_message_id": result.provider_message_id,
        "note": result.message,
    })

    # Update the invoice's last-email cache. We pass ``success`` so the repo
    # only bumps ``followup_count`` for actual deliveries — failed sends still
    # record the draft (subject/body) for the operator to inspect & resend.
    repos.update_invoice_email_cache(
        inv["invoice_id"],
        subject=em["subject"],
        body=em["body"],
        tone=ToneLevel(em["tone"]),
        confidence=em["confidence_score"],
        success=delivered,
    )
    repos.push_activity(
        "email_sent" if delivered else "email_failed",
        f"{result.provider} → {inv['client_name']} ({result.message})",
        invoice_id=inv["invoice_id"],
        level="success" if delivered else "error",
    )
    return state


def human_queue_node(state: InvoiceState) -> InvoiceState:
    inv = state["invoice"]
    em = state.get("generated_email")

    # If we escalated before generating, still push a minimal record
    subject = em["subject"] if em else f"[ESCALATED] Invoice {inv['invoice_id']}"
    body = em["body"] if em else (
        f"Invoice {inv['invoice_id']} for {inv['client_name']} "
        f"({inv.get('currency', 'INR')} {inv['amount']}) is {inv['days_overdue']} days overdue. "
        "Requires manual escalation."
    )
    tone = ToneLevel(em["tone"]) if em else ToneLevel.STERN_URGENT

    # De-duplicate: if there is already a pending review for this invoice,
    # supersede it. Otherwise the queue grows by one item per re-scan and the
    # reviewer is left guessing which draft is current.
    superseded = repos.cancel_pending_human_queue(
        inv["invoice_id"], reason="superseded by newer draft"
    )
    if superseded:
        repos.push_activity(
            "human_replaced",
            f"{inv['invoice_id']} → {superseded} older draft(s) superseded",
            invoice_id=inv["invoice_id"],
            level="info",
        )

    repos.enqueue_human(HumanQueueTable(
        invoice_id=inv["invoice_id"],
        reason=state.get("human_reason") or "needs_review",
        confidence_score=state.get("confidence_score", 0.0),
        risk_level=state.get("risk_level", "MEDIUM"),
        email_subject=subject,
        email_body=body,
        email_tone=tone,
        status=DeliveryStatus.HUMAN_PENDING,
    ))
    if em:
        # success=False: this is a *draft* awaiting human approval — we cache
        # the subject/body for review but don't count it as a sent follow-up.
        repos.update_invoice_email_cache(
            inv["invoice_id"],
            subject=subject,
            body=body,
            tone=tone,
            confidence=em["confidence_score"],
            success=False,
        )
    repos.push_activity(
        "human_pending",
        f"{inv['invoice_id']} → human review ({state.get('human_reason', 'n/a')})",
        invoice_id=inv["invoice_id"],
        level="warn",
    )
    if days_overdue_to_stage(inv["days_overdue"]) == EscalationStage.ESCALATED:
        # Flag as DISPUTED (not LEGAL) so it stays visible in the overdue queue.
        # LEGAL would permanently remove it from get_overdue_invoices() since that filters ACTIVE only.
        repos.update_invoice_status(inv["invoice_id"], InvoiceStatus.DISPUTED, "Auto-flagged 30+ days overdue")
    return state


def fallback_template_node(state: InvoiceState) -> InvoiceState:
    """Deterministic fallback when LLM retries are exhausted."""
    from app.llm.mock import complete_mock

    inv = state["invoice"]
    stage = state["stage"] or 1
    email, tokens, latency = complete_mock(
        invoice_id=inv["invoice_id"],
        client_name=inv["client_name"],
        amount=inv["amount"],
        currency=inv.get("currency", "INR"),
        due_date=str(inv["due_date"]),
        days_overdue=inv["days_overdue"],
        payment_link=inv.get("payment_link"),
        stage=stage,
        followup_count=inv.get("followup_count", 0),
    )
    state["generated_email"] = email.model_dump(mode="json")
    state["tokens_used"] = tokens
    state["latency_ms"] = latency
    state["model_used"] = "fallback/template"
    state["confidence_score"] = email.confidence_score
    state["fallback_used"] = True
    state["validation_errors"] = []  # reset since fallback is trusted
    state["requires_human"] = True
    state["human_reason"] = "fallback_used"
    return state


def write_audit_node(state: InvoiceState) -> InvoiceState:
    inv = state.get("invoice") or {}
    em = state.get("generated_email")

    # decide action
    if state.get("error"):
        action = AuditAction.EMAIL_FAILED
    elif state.get("fallback_used"):
        action = AuditAction.FALLBACK_USED
    elif state.get("requires_human"):
        action = AuditAction.EMAIL_GENERATED  # email was generated, pending human review
    elif em:
        action = AuditAction.EMAIL_SENT
    else:
        action = AuditAction.STAGE_ESCALATED

    stage_enum = days_overdue_to_stage(inv.get("days_overdue", 0)) if inv else EscalationStage.PENDING

    delivery = DeliveryStatus.QUEUED
    for e in state.get("audit_entries") or []:
        if "delivery_status" in e:
            try:
                delivery = DeliveryStatus(e["delivery_status"])
            except Exception:
                pass
    if state.get("requires_human"):
        delivery = DeliveryStatus.HUMAN_PENDING

    entry = AuditTable(
        id=str(uuid.uuid4()),
        invoice_id=state["invoice_id"],
        timestamp=datetime.utcnow(),
        action=action,
        stage=stage_enum,
        tone_used=ToneLevel(em["tone"]) if em else None,
        email_subject=em["subject"] if em else None,
        confidence_score=state.get("confidence_score"),
        risk_level=state.get("risk_level"),
        tokens_used=state.get("tokens_used"),
        latency_ms=state.get("latency_ms"),
        retry_count=state.get("retry_count", 0),
        fallback_used=state.get("fallback_used", False),
        delivery_status=delivery,
        human_override=state.get("requires_human", False),
        override_reason=state.get("human_reason"),
        validation_errors="|".join(state.get("validation_errors", [])),
        error_message=state.get("error"),
        model_used=state.get("model_used"),
    )
    repos.add_audit(entry)

    # Sheets writeback is a no-op when disabled
    try:
        from app.models.audit import AuditEntry
        pydantic_entry = AuditEntry(
            id=entry.id,
            invoice_id=entry.invoice_id,
            timestamp=entry.timestamp,
            action=entry.action,
            stage=entry.stage,
            tone_used=entry.tone_used,
            email_subject=entry.email_subject,
            confidence_score=entry.confidence_score,
            risk_level=entry.risk_level,
            tokens_used=entry.tokens_used,
            latency_ms=entry.latency_ms,
            retry_count=entry.retry_count,
            fallback_used=entry.fallback_used,
            delivery_status=entry.delivery_status,
            human_override=entry.human_override,
            override_reason=entry.override_reason,
            validation_errors=entry.validation_errors.split("|") if entry.validation_errors else [],
            error_message=entry.error_message,
            model_used=entry.model_used,
        )
        append_audit_row(pydantic_entry.to_sheets_row())
    except Exception:
        log.exception("sheets writeback failed; audit still in SQLite")

    # Write back invoice status/stage/followup to Google Sheets
    inv = state.get("invoice") or {}
    em = state.get("generated_email")
    try:
        update_invoice_on_sheet(
            state["invoice_id"],
            status=inv.get("status", "ACTIVE") if isinstance(inv.get("status"), str)
                   else (inv.get("status").value if hasattr(inv.get("status"), "value") else "ACTIVE"),
            stage=entry.stage.value,
            followup_count=inv.get("followup_count", 0),
            last_email_date=datetime.utcnow().isoformat() if em else None,
            last_email_tone=em.get("tone") if em else None,
        )
    except Exception:
        log.exception("sheets invoice writeback failed (non-fatal)")

    return state
