"""Email dispatcher — three modes (mock / sandbox / live).

- mock     → no network, just logs (used for demos + unit tests)
- sandbox  → SMTP send (default Mailtrap; works with Gmail/Zoho/any SMTP)
- live     → Resend HTTP API (requires verified sender domain)

All real sends go through ``send_for_invoice`` which writes a SentEmailTable
row regardless of outcome — so the dashboard can render an exact preview of
every email actually attempted.
"""
from __future__ import annotations

import logging
import smtplib
from dataclasses import dataclass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from app.config import get_settings
from app.db import repos
from app.db.tables import SentEmailTable
from app.models.enums import DeliveryStatus, EscalationStage, ToneLevel

log = logging.getLogger(__name__)


@dataclass
class DispatchResult:
    status: DeliveryStatus
    message: str
    provider: str
    provider_message_id: Optional[str] = None
    sent_email_id: Optional[int] = None  # PK of SentEmailTable row


# ---------------------------------------------------------------- helpers

def mask_email(email: str) -> str:
    if not email or "@" not in email:
        return "***"
    user, domain = email.split("@", 1)
    return f"{user[0] if user else '*'}***@{domain}"


def _from_address() -> str:
    s = get_settings()
    return s.email_from or s.resend_from or "collections@example.com"


# ---------------------------------------------------------------- public API

def send_for_invoice(
    *,
    invoice_id: str,
    to_email: str,
    subject: str,
    body: str,
    tone: ToneLevel,
    stage: EscalationStage,
    audit_id: Optional[str] = None,
    confidence_score: Optional[float] = None,
    model_used: Optional[str] = None,
    tokens_used: Optional[int] = None,
    human_approved: bool = False,
    edited_by_human: bool = False,
    reviewer_note: Optional[str] = None,
) -> DispatchResult:
    """Dispatch + persist. This is the single entry-point used by the
    pipeline auto-dispatch node and the human-queue approve handler.
    """
    settings = get_settings()
    mode = settings.email_mode
    from_email = _from_address()

    if mode == "mock":
        result = _mock_send(to_email)
    elif mode == "sandbox":
        result = _send_smtp(to_email=to_email, from_email=from_email, subject=subject, body=body)
    elif mode == "live":
        result = _send_resend(to_email=to_email, from_email=from_email, subject=subject, body=body)
    else:
        result = DispatchResult(
            status=DeliveryStatus.FAILED,
            message=f"Unknown email mode: {mode}",
            provider="unknown",
        )

    # Persist regardless of outcome — the dashboard wants to see every attempt.
    row = repos.add_sent_email(SentEmailTable(
        invoice_id=invoice_id,
        audit_id=audit_id,
        to_email=to_email,
        from_email=from_email,
        subject=subject,
        body=body,
        tone=tone,
        stage=stage,
        confidence_score=confidence_score,
        provider=result.provider,
        provider_message_id=result.provider_message_id,
        status=result.status,
        error_message=None if result.status != DeliveryStatus.FAILED else result.message,
        human_approved=human_approved,
        edited_by_human=edited_by_human,
        reviewer_note=reviewer_note,
        model_used=model_used,
        tokens_used=tokens_used,
    ))
    result.sent_email_id = row.id
    return result


def dispatch_email(*, to_email: str, subject: str, body: str) -> DispatchResult:
    """Backwards-compatible thin wrapper used in places where we don't have
    rich invoice context. Does NOT persist — caller is expected to handle
    that or use ``send_for_invoice``.
    """
    settings = get_settings()
    mode = settings.email_mode
    from_email = _from_address()

    if mode == "mock":
        return _mock_send(to_email)
    if mode == "sandbox":
        return _send_smtp(to_email=to_email, from_email=from_email, subject=subject, body=body)
    if mode == "live":
        return _send_resend(to_email=to_email, from_email=from_email, subject=subject, body=body)
    return DispatchResult(status=DeliveryStatus.FAILED, message=f"Unknown email mode: {mode}", provider="unknown")


# ---------------------------------------------------------------- backends

def _mock_send(to_email: str) -> DispatchResult:
    log.info("EMAIL[mock] to=%s", mask_email(to_email))
    return DispatchResult(
        status=DeliveryStatus.MOCK,
        message=f"MOCK delivery to {mask_email(to_email)}",
        provider="mock",
    )


def _send_smtp(*, to_email: str, from_email: str, subject: str, body: str) -> DispatchResult:
    """Generic SMTP send. Works with Mailtrap sandbox, Gmail (app password),
    Zoho Mail, ProtonMail bridge, or any SMTP server.
    """
    s = get_settings()
    host = s.smtp_host or s.mailtrap_host
    port = s.smtp_port or s.mailtrap_port
    user = s.smtp_user or s.mailtrap_user
    pwd = s.smtp_pass or s.mailtrap_pass
    use_tls = s.smtp_use_tls

    if not user or not pwd:
        return DispatchResult(
            status=DeliveryStatus.FAILED,
            message="SMTP credentials missing (set SMTP_USER + SMTP_PASS or MAILTRAP_USER + MAILTRAP_PASS)",
            provider="smtp",
        )

    msg = MIMEMultipart()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))

    try:
        # Port 465 = implicit TLS; 587 = STARTTLS; 25/2525 = plain or STARTTLS
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=15) as smtp:
                smtp.login(user, pwd)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=15) as smtp:
                if use_tls:
                    smtp.starttls()
                smtp.login(user, pwd)
                smtp.send_message(msg)

        provider = "mailtrap" if "mailtrap" in (host or "").lower() else "smtp"
        is_sandbox = "sandbox" in (host or "").lower() or "mailtrap" in (host or "").lower()
        log.info(
            "EMAIL[%s] delivered to=%s host=%s",
            "sandbox" if is_sandbox else "smtp",
            mask_email(to_email),
            host,
        )
        return DispatchResult(
            status=DeliveryStatus.SANDBOX if is_sandbox else DeliveryStatus.SENT,
            message=f"Delivered via {host} to {mask_email(to_email)}",
            provider=provider,
        )
    except Exception as exc:
        log.exception("smtp send failed host=%s", host)
        return DispatchResult(status=DeliveryStatus.FAILED, message=str(exc), provider="smtp")


def _send_resend(*, to_email: str, from_email: str, subject: str, body: str) -> DispatchResult:
    s = get_settings()
    if not s.resend_api_key:
        return DispatchResult(
            status=DeliveryStatus.FAILED,
            message="Resend API key missing (set RESEND_API_KEY)",
            provider="resend",
        )
    try:
        import resend  # type: ignore

        resend.api_key = s.resend_api_key
        params = {
            "from": from_email,
            "to": [to_email],
            "subject": subject,
            "text": body,
        }
        resp = resend.Emails.send(params)
        message_id = (resp or {}).get("id") if isinstance(resp, dict) else None
        log.info("EMAIL[live] delivered to=%s id=%s", mask_email(to_email), message_id)
        return DispatchResult(
            status=DeliveryStatus.SENT,
            message=f"Delivered live to {mask_email(to_email)}",
            provider="resend",
            provider_message_id=message_id,
        )
    except Exception as exc:
        log.exception("resend send failed")
        return DispatchResult(status=DeliveryStatus.FAILED, message=str(exc), provider="resend")
