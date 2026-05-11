"""Prompt registry per escalation stage."""
from __future__ import annotations

from app.models.enums import ToneLevel

SYSTEM_PROMPT = """You are an enterprise finance collections assistant for {company_name}.

STRICT RULES — NEVER VIOLATE:
1. Never hallucinate or modify invoice data. Use ONLY values provided.
2. invoice_id_used MUST equal exactly: {invoice_id}
3. client_name_used MUST equal exactly: {client_name}
4. amount_used MUST equal exactly: {amount}
5. days_overdue_used MUST equal exactly: {days_overdue}
6. Output ONLY valid JSON matching the schema. No preamble, no markdown fences.
7. Tone MUST match: {tone_requirement}
8. Never threaten legal action unless stage is 4.
9. Never be abusive or unprofessional.
10. Payment link must be included exactly as provided (or say "contact finance" if null).

OUTPUT SCHEMA (strict):
{{
  "subject": "string (5-200 chars)",
  "body": "string (50-3000 chars)",
  "tone": "{tone_enum}",
  "escalation_stage": {stage_int},
  "confidence_score": number 0..1,
  "invoice_id_used": "must match invoice_id exactly",
  "client_name_used": "must match client_name exactly",
  "amount_used": number (must match amount exactly),
  "days_overdue_used": integer (must match days_overdue exactly)
}}"""

STAGE_PROMPTS: dict[int, dict] = {
    1: {
        "tone_requirement": "Warm and friendly. Assume the client simply forgot. No pressure.",
        "tone_enum": ToneLevel.WARM_FRIENDLY.value,
        "stage_int": 1,
        "user_template": (
            "Generate a warm Stage 1 follow-up email.\n\n"
            "Invoice Details:\n"
            "- Invoice ID: {invoice_id}\n"
            "- Client: {client_name}\n"
            "- Amount: {currency} {amount:,.2f}\n"
            "- Due Date: {due_date}\n"
            "- Days Overdue: {days_overdue}\n"
            "- Payment Link: {payment_link}\n\n"
            "This is reminder #{followup_count}. Keep it genuinely friendly. Assume oversight."
        ),
    },
    2: {
        "tone_requirement": "Polite but firm. Payment is still pending. Request confirmation of payment date.",
        "tone_enum": ToneLevel.POLITE_FIRM.value,
        "stage_int": 2,
        "user_template": (
            "Generate a Stage 2 polite-but-firm follow-up.\n\n"
            "Invoice Details:\n"
            "- Invoice ID: {invoice_id}\n"
            "- Client: {client_name}\n"
            "- Amount: {currency} {amount:,.2f}\n"
            "- Due Date: {due_date}\n"
            "- Days Overdue: {days_overdue}\n"
            "- Payment Link: {payment_link}\n\n"
            "Acknowledge previous reminder. Request payment confirmation date."
        ),
    },
    3: {
        "tone_requirement": "Formal and serious. Express escalating concern. Mention potential credit term impact. Request response within 48 hours.",
        "tone_enum": ToneLevel.FORMAL_SERIOUS.value,
        "stage_int": 3,
        "user_template": (
            "Generate a Stage 3 formal-serious follow-up.\n\n"
            "Invoice Details:\n"
            "- Invoice ID: {invoice_id}\n"
            "- Client: {client_name}\n"
            "- Amount: {currency} {amount:,.2f}\n"
            "- Due Date: {due_date}\n"
            "- Days Overdue: {days_overdue}\n"
            "- Payment Link: {payment_link}\n\n"
            "Mention this is the third notice. Note impact on credit terms if unpaid. 48-hour response deadline."
        ),
    },
    4: {
        "tone_requirement": "Stern and urgent. Final reminder before escalation. Clear 24-hour deadline. Professional but no-nonsense.",
        "tone_enum": ToneLevel.STERN_URGENT.value,
        "stage_int": 4,
        "user_template": (
            "Generate a Stage 4 stern final-notice follow-up.\n\n"
            "Invoice Details:\n"
            "- Invoice ID: {invoice_id}\n"
            "- Client: {client_name}\n"
            "- Amount: {currency} {amount:,.2f}\n"
            "- Due Date: {due_date}\n"
            "- Days Overdue: {days_overdue}\n"
            "- Payment Link: {payment_link}\n\n"
            "This is the FINAL automated reminder. 24-hour deadline. Next step is manual escalation to finance/legal."
        ),
    },
}


def build_prompts(*, stage: int, invoice: dict, company_name: str = "Acme Financial Services") -> tuple[str, str]:
    cfg = STAGE_PROMPTS[stage]
    sys_p = SYSTEM_PROMPT.format(
        company_name=company_name,
        invoice_id=invoice["invoice_id"],
        client_name=invoice["client_name"],
        amount=invoice["amount"],
        days_overdue=invoice["days_overdue"],
        tone_requirement=cfg["tone_requirement"],
        tone_enum=cfg["tone_enum"],
        stage_int=cfg["stage_int"],
    )
    user_p = cfg["user_template"].format(
        invoice_id=invoice["invoice_id"],
        client_name=invoice["client_name"],
        currency=invoice.get("currency", "INR"),
        amount=invoice["amount"],
        due_date=invoice["due_date"],
        days_overdue=invoice["days_overdue"],
        payment_link=invoice.get("payment_link") or "(contact finance for bank details)",
        followup_count=invoice.get("followup_count", 0),
    )
    return sys_p, user_p
