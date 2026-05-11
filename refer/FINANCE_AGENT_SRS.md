# Finance Credit Follow-Up Orchestration Agent
## SRS + System Architecture + Build Notes
**Version:** 2.0 | **Author:** Lakshya Rathi | **Stack:** FastAPI + LangGraph + Celery + Redis + Next.js

---

## 1. PROJECT OVERVIEW

### 1.1 What this actually is

An AI-powered finance collections agent that:
- ingests overdue invoices from Google Sheets / CSV / Excel
- runs a LangGraph-based orchestration pipeline per invoice
- generates personalized escalating emails via any LLM (Groq / Gemini / OpenAI / Ollama) through LiteLLM
- dispatches via Resend (live) or Mailtrap (sandbox)
- queues everything through Celery + Redis with retry + dead-letter logic
- logs structured audit trails to SQLite + Google Sheets
- exposes a Next.js dashboard with live feed, human approval queue, observability

### 1.2 Problem

Finance teams manually chase invoices. Inconsistent tone. No audit trail. Delayed collections. This automates it with a proper escalation-aware AI pipeline that doesn't hallucinate invoice data.

---

## 2. SYSTEM ARCHITECTURE

### 2.1 Full System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA INGESTION                          │
│   Google Sheets (gspread) │ CSV Upload │ Excel Upload           │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    FastAPI Backend       │
                    │  - REST API              │
                    │  - Auth middleware        │
                    │  - Rate limiting          │
                    │  - Input sanitization     │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    Celery Beat           │
                    │  (cron scheduler)        │
                    │  - daily 9am scan        │
                    │  - 30min sheets sync     │
                    │  - 2hr dead letter retry │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │      Redis Broker        │
                    │  queues:                 │
                    │  - high_priority         │
                    │  - default               │
                    │  - scheduler             │
                    │  - dead_letter           │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
   ┌──────────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
   │   Worker 1      │  │   Worker 2   │  │   Worker N   │
   │                 │  │              │  │              │
   │  LangGraph      │  │  LangGraph   │  │  LangGraph   │
   │  Pipeline       │  │  Pipeline    │  │  Pipeline    │
   └──────────┬──────┘  └──────────────┘  └──────────────┘
              │
   ┌──────────▼──────────────────────────────────────────┐
   │              LANGGRAPH PIPELINE                      │
   │                                                      │
   │  load_invoice → classify_stage → build_prompt        │
   │       → call_llm → validate_output                   │
   │           ↓              ↓                           │
   │     [retry/fallback]  confidence_check               │
   │                          ↓          ↓                │
   │                    dispatch_email  human_queue        │
   │                          ↓                           │
   │                     write_audit                      │
   └──────────────────────────┬──────────────────────────┘
                              │
          ┌───────────────────┼──────────────────────┐
          │                   │                      │
   ┌──────▼──────┐   ┌────────▼──────┐   ┌──────────▼────┐
   │  LiteLLM    │   │  Resend       │   │  Langfuse     │
   │  Gateway    │   │  (live email) │   │  (LLM traces) │
   │  - Groq     │   │  Mailtrap     │   │               │
   │  - Gemini   │   │  (sandbox)    │   │               │
   │  - OpenAI   │   │               │   │               │
   │  - Ollama   │   │               │   │               │
   └─────────────┘   └───────────────┘   └───────────────┘
          │
   ┌──────▼─────────────────────────────────────────┐
   │            DATA LAYER                          │
   │   SQLite (SQLModel) │ Google Sheets writeback  │
   └──────────────────────────────────────────────┘
          │
   ┌──────▼─────────────────────────────────────────┐
   │          NEXT.JS DASHBOARD                      │
   │  - KPI cards + live activity feed (polling)     │
   │  - Invoice table + stage badges                 │
   │  - Email preview + tone slider + regenerate     │
   │  - Human approval queue                         │
   │  - Audit log (filterable, exportable)           │
   │  - Observability panel (Langfuse embed)         │
   │  - Model picker + demo mode toggle              │
   │  - Flower embed (Celery monitor)                │
   └─────────────────────────────────────────────────┘
```

### 2.2 LangGraph Pipeline Detail

```
                    ┌─────────────┐
                    │ load_invoice │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │classify_stage│  → computes days_overdue, assigns EscalationStage
                    └──────┬──────┘
                           │
                   stage == ESCALATED?
                     YES ──────────────────────────► human_queue node
                     NO
                           │
                    ┌──────▼──────┐
                    │ build_prompt │  → PromptRegistry.get(stage) + ContextInjector
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  call_llm   │  → LiteLLM completion (any provider)
                    └──────┬──────┘
                           │
                    ┌──────▼──────────┐
                    │ validate_output  │  → Pydantic parse + hallucination check
                    └──────┬──────────┘
                           │
                    valid? NO ──► retry_count < 2? YES ──► build_prompt (retry)
                                                   NO  ──► fallback_template node
                    valid? YES
                           │
                    ┌──────▼──────────┐
                    │ confidence_check │  → score confidence, assign risk level
                    └──────┬──────────┘
                           │
               confidence >= 0.75 AND stage < 4?
                 YES ──► dispatch_email node
                 NO  ──► human_queue node
                           │
                    ┌──────▼──────┐
                    │ write_audit  │  → SQLite + Sheets writeback
                    └─────────────┘
```

---

## 3. PYDANTIC MODELS (Complete + Typed)

```python
# models/enums.py

from enum import Enum

class EscalationStage(str, Enum):
    PENDING = "PENDING"
    STAGE_1 = "STAGE_1"       # 1-7 days
    STAGE_2 = "STAGE_2"       # 8-14 days
    STAGE_3 = "STAGE_3"       # 15-21 days
    STAGE_4 = "STAGE_4"       # 22-30 days
    ESCALATED = "ESCALATED"   # 30+ days → human

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
```

```python
# models/invoice.py

from pydantic import BaseModel, EmailStr, Field, field_validator
from datetime import date, datetime
from typing import Optional
from .enums import EscalationStage, InvoiceStatus

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
        # strip prompt injection attempts
        dangerous_patterns = [
            "ignore previous", "forget instructions", "system:", 
            "assistant:", "human:", "<|", "|>", "{{", "}}"
        ]
        lower = v.lower()
        for pattern in dangerous_patterns:
            if pattern in lower:
                raise ValueError(f"Invalid client name: contains forbidden pattern")
        return v.strip()

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v: float) -> float:
        if v > 10_000_000:  # sanity cap
            raise ValueError("Amount exceeds maximum allowed value")
        return round(v, 2)

    model_config = {"str_strip_whitespace": True}


class InvoiceIngestion(BaseModel):
    """for CSV/Sheets row parsing — loose types that get coerced"""
    invoice_id: str
    client_name: str
    client_email: str
    amount: float
    currency: str = "INR"
    due_date: str  # parsed to date separately
    followup_count: int = 0
    payment_link: Optional[str] = None
```

```python
# models/email_output.py

from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime
from .enums import ToneLevel, RiskLevel, EscalationStage

class GeneratedEmail(BaseModel):
    """LLM must output this schema exactly — used in structured output mode"""
    subject: str = Field(..., min_length=5, max_length=200)
    body: str = Field(..., min_length=50, max_length=3000)
    tone: ToneLevel
    escalation_stage: int = Field(..., ge=1, le=4)
    confidence_score: float = Field(..., ge=0.0, le=1.0)
    
    # fields that MUST match source data exactly (hallucination check)
    invoice_id_used: str
    client_name_used: str
    amount_used: float
    days_overdue_used: int

    @field_validator("body")
    @classmethod
    def no_hallucination_placeholders(cls, v: str) -> str:
        placeholders = ["[INSERT", "[YOUR", "{{", "}}", "PLACEHOLDER", "TBD", "XXX"]
        for p in placeholders:
            if p in v.upper():
                raise ValueError(f"Email body contains unfilled placeholder: {p}")
        return v


class HallucinationCheckResult(BaseModel):
    passed: bool
    mismatched_fields: list[str] = []
    details: dict = {}

def check_hallucination(
    email: GeneratedEmail, 
    source: "InvoiceRecord"  # forward ref
) -> HallucinationCheckResult:
    mismatches = []
    
    if email.invoice_id_used != source.invoice_id:
        mismatches.append(f"invoice_id: got {email.invoice_id_used}, expected {source.invoice_id}")
    if email.client_name_used.lower() != source.client_name.lower():
        mismatches.append(f"client_name: got {email.client_name_used}, expected {source.client_name}")
    if abs(email.amount_used - source.amount) > 0.01:
        mismatches.append(f"amount: got {email.amount_used}, expected {source.amount}")
    if abs(email.days_overdue_used - source.days_overdue) > 1:
        mismatches.append(f"days_overdue: got {email.days_overdue_used}, expected {source.days_overdue}")

    return HallucinationCheckResult(
        passed=len(mismatches) == 0,
        mismatched_fields=mismatches
    )


class EmailApprovalRequest(BaseModel):
    """human review queue item"""
    invoice_id: str
    generated_email: GeneratedEmail
    reason_for_review: str  # "low_confidence" | "stage_4" | "validation_retry_exhausted"
    queued_at: datetime
    confidence_score: float
    risk_level: RiskLevel


class HumanReviewAction(BaseModel):
    invoice_id: str
    action: str = Field(..., pattern=r"^(approve|edit|reject|regenerate|flag)$")
    edited_subject: Optional[str] = None
    edited_body: Optional[str] = None
    reviewer_note: Optional[str] = None
```

```python
# models/audit.py

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from .enums import AuditAction, DeliveryStatus, ToneLevel, EscalationStage

class AuditEntry(BaseModel):
    id: str  # uuid4
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
    delivery_status: DeliveryStatus
    human_override: bool = False
    override_reason: Optional[str] = None
    validation_errors: list[str] = []
    error_message: Optional[str] = None
    model_used: Optional[str] = None  # e.g. "groq/llama-3.1-8b-instant"

    def to_sheets_row(self) -> list:
        """serialize for Google Sheets writeback"""
        return [
            self.id,
            self.invoice_id,
            self.timestamp.isoformat(),
            self.action.value,
            self.stage.value,
            self.tone_used.value if self.tone_used else "",
            self.email_subject or "",
            str(self.confidence_score or ""),
            str(self.tokens_used or ""),
            str(self.latency_ms or ""),
            str(self.retry_count),
            str(self.fallback_used),
            self.delivery_status.value,
            str(self.human_override),
            self.override_reason or "",
            "|".join(self.validation_errors),
            self.error_message or "",
            self.model_used or "",
        ]
```

```python
# models/langgraph_state.py

from typing import TypedDict, Optional, Any
from datetime import datetime

class InvoiceState(TypedDict):
    # core
    invoice_id: str
    invoice: dict                    # serialized InvoiceRecord
    
    # pipeline tracking
    stage: int                       # 1-4, 0 = escalated
    retry_count: int
    fallback_used: bool
    
    # prompt + llm
    prompt_version: Optional[str]
    system_prompt: Optional[str]
    user_prompt: Optional[str]
    raw_llm_response: Optional[str]
    
    # output
    generated_email: Optional[dict]  # serialized GeneratedEmail
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
```

```python
# models/config.py

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from typing import Optional, Literal

class LLMConfig(BaseModel):
    provider: Literal["groq", "gemini", "openai", "ollama", "together"] = "groq"
    model: str = "groq/llama-3.1-8b-instant"
    api_key: Optional[str] = None
    base_url: Optional[str] = None  # for ollama / custom endpoints
    temperature: float = Field(default=0.3, ge=0.0, le=1.0)
    max_tokens: int = Field(default=1024, ge=100, le=4096)
    timeout: int = 30

class AppSettings(BaseSettings):
    # app
    app_name: str = "Finance Collections Agent"
    debug: bool = False
    api_key: str = "dev-secret-key"  # X-API-Key header auth
    demo_mode: bool = False
    
    # llm
    llm: LLMConfig = LLMConfig()
    
    # email
    email_mode: Literal["sandbox", "live"] = "sandbox"
    resend_api_key: Optional[str] = None
    resend_from: str = "collections@yourdomain.com"
    mailtrap_host: str = "sandbox.smtp.mailtrap.io"
    mailtrap_port: int = 2525
    mailtrap_user: Optional[str] = None
    mailtrap_pass: Optional[str] = None
    
    # redis
    redis_url: str = "redis://localhost:6379/0"
    
    # google sheets
    sheets_enabled: bool = False
    sheets_credentials_path: str = "credentials.json"
    sheets_invoice_id: Optional[str] = None
    sheets_audit_id: Optional[str] = None
    
    # langfuse
    langfuse_enabled: bool = False
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_host: str = "https://cloud.langfuse.com"
    
    # rate limiting
    max_emails_per_minute: int = 10
    max_llm_calls_per_minute: int = 20

    class Config:
        env_file = ".env"
        env_nested_delimiter = "__"
```

---

## 4. LANGGRAPH PIPELINE IMPLEMENTATION NOTES

```python
# pipeline/graph.py

from langgraph.graph import StateGraph, END
from .nodes import (
    load_invoice_node,
    classify_stage_node,
    build_prompt_node,
    call_llm_node,
    validate_output_node,
    confidence_check_node,
    dispatch_email_node,
    human_queue_node,
    fallback_template_node,
    write_audit_node,
)

def build_pipeline() -> StateGraph:
    graph = StateGraph(InvoiceState)
    
    graph.add_node("load_invoice", load_invoice_node)
    graph.add_node("classify_stage", classify_stage_node)
    graph.add_node("build_prompt", build_prompt_node)
    graph.add_node("call_llm", call_llm_node)
    graph.add_node("validate_output", validate_output_node)
    graph.add_node("confidence_check", confidence_check_node)
    graph.add_node("dispatch_email", dispatch_email_node)
    graph.add_node("human_queue", human_queue_node)
    graph.add_node("fallback_template", fallback_template_node)
    graph.add_node("write_audit", write_audit_node)

    graph.set_entry_point("load_invoice")
    
    graph.add_edge("load_invoice", "classify_stage")
    
    graph.add_conditional_edges(
        "classify_stage",
        lambda s: "human_queue" if s["stage"] == 0 else "build_prompt",
        {"human_queue": "human_queue", "build_prompt": "build_prompt"}
    )
    
    graph.add_edge("build_prompt", "call_llm")
    graph.add_edge("call_llm", "validate_output")
    
    graph.add_conditional_edges(
        "validate_output",
        route_after_validation,  # valid → confidence_check, invalid → retry or fallback
        {
            "confidence_check": "confidence_check",
            "build_prompt": "build_prompt",  # retry
            "fallback_template": "fallback_template",
        }
    )
    
    graph.add_conditional_edges(
        "confidence_check",
        lambda s: "human_queue" if s["requires_human"] else "dispatch_email",
        {"human_queue": "human_queue", "dispatch_email": "dispatch_email"}
    )
    
    graph.add_edge("dispatch_email", "write_audit")
    graph.add_edge("human_queue", "write_audit")
    graph.add_edge("fallback_template", "write_audit")
    graph.add_edge("write_audit", END)
    
    return graph.compile()


def route_after_validation(state: InvoiceState) -> str:
    if len(state["validation_errors"]) == 0:
        return "confidence_check"
    if state["retry_count"] < 2:
        return "build_prompt"  # retry with same state
    return "fallback_template"  # exhausted retries
```

---

## 5. PROMPT REGISTRY

```python
# pipeline/prompts.py

SYSTEM_PROMPT = """You are an enterprise finance collections assistant for {company_name}.

STRICT RULES — NEVER VIOLATE:
1. Never hallucinate or modify invoice data. Use ONLY values provided.
2. invoice_id_used MUST equal exactly: {invoice_id}
3. client_name_used MUST equal exactly: {client_name}
4. amount_used MUST equal exactly: {amount}
5. days_overdue_used MUST equal exactly: {days_overdue}
6. Output ONLY valid JSON matching the schema. No preamble, no markdown.
7. Tone MUST match: {tone_requirement}
8. Never threaten legal action unless stage is STAGE_4.
9. Never be abusive or unprofessional.
10. Payment link must be included exactly as provided.

OUTPUT SCHEMA (strict):
{{
  "subject": "string (max 200 chars)",
  "body": "string (50-3000 chars)",
  "tone": "{tone_enum}",
  "escalation_stage": {stage_int},
  "confidence_score": float between 0 and 1,
  "invoice_id_used": "must match invoice_id exactly",
  "client_name_used": "must match client_name exactly",
  "amount_used": number (must match amount exactly),
  "days_overdue_used": integer (must match days_overdue exactly)
}}"""


STAGE_PROMPTS = {
    1: {
        "tone_requirement": "Warm and friendly. Assume the client simply forgot. No pressure.",
        "tone_enum": "WARM_FRIENDLY",
        "stage_int": 1,
        "user_template": """Generate a warm Stage 1 follow-up email.

Invoice Details:
- Invoice ID: {invoice_id}
- Client: {client_name}
- Amount: {currency} {amount:,.2f}
- Due Date: {due_date}
- Days Overdue: {days_overdue}
- Payment Link: {payment_link}

This is reminder #{followup_count}. Keep it genuinely friendly. Assume oversight.""",
    },
    2: {
        "tone_requirement": "Polite but firm. Payment is still pending. Request confirmation of payment date.",
        "tone_enum": "POLITE_FIRM",
        "stage_int": 2,
        "user_template": """Generate a Stage 2 polite-but-firm follow-up.

Invoice Details:
- Invoice ID: {invoice_id}
- Client: {client_name}
- Amount: {currency} {amount:,.2f}
- Due Date: {due_date}
- Days Overdue: {days_overdue}
- Payment Link: {payment_link}

Acknowledge previous reminder. Request payment confirmation date.""",
    },
    3: {
        "tone_requirement": "Formal and serious. Express escalating concern. Mention potential credit term impact. Request response within 48 hours.",
        "tone_enum": "FORMAL_SERIOUS",
        "stage_int": 3,
        "user_template": """Generate a Stage 3 formal-serious follow-up.

Invoice Details:
- Invoice ID: {invoice_id}
- Client: {client_name}
- Amount: {currency} {amount:,.2f}
- Due Date: {due_date}
- Days Overdue: {days_overdue}
- Payment Link: {payment_link}

Mention this is the third notice. Note impact on credit terms if unpaid. 48-hour response deadline.""",
    },
    4: {
        "tone_requirement": "Stern and urgent. Final reminder before escalation. Clear deadline. Professional but no-nonsense.",
        "tone_enum": "STERN_URGENT",
        "stage_int": 4,
        "user_template": """Generate a Stage 4 stern final-notice follow-up.

Invoice Details:
- Invoice ID: {invoice_id}
- Client: {client_name}
- Amount: {currency} {amount:,.2f}
- Due Date: {due_date}
- Days Overdue: {days_overdue}
- Payment Link: {payment_link}

This is the FINAL automated reminder. 24-hour deadline. Next step is manual escalation to finance/legal team.""",
    },
}
```

---

## 6. LITELLM GATEWAY

```python
# llm/gateway.py

import litellm
import time
from models.config import LLMConfig
from models.email_output import GeneratedEmail

litellm.set_verbose = False

class LLMGateway:
    def __init__(self, config: LLMConfig):
        self.config = config
        if config.base_url:
            litellm.api_base = config.base_url

    def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        response_model: type = GeneratedEmail,
    ) -> tuple[GeneratedEmail, int, int]:  # (result, tokens, latency_ms)
        start = time.time()

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        response = litellm.completion(
            model=self.config.model,
            messages=messages,
            api_key=self.config.api_key,
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
            timeout=self.config.timeout,
            response_format={"type": "json_object"},  # JSON mode
        )

        latency_ms = int((time.time() - start) * 1000)
        tokens = response.usage.total_tokens
        raw = response.choices[0].message.content

        # parse + validate via pydantic
        import json
        parsed = GeneratedEmail.model_validate(json.loads(raw))

        return parsed, tokens, latency_ms

    @property
    def model_info(self) -> str:
        return self.config.model
```

---

## 7. CELERY CONFIGURATION

```python
# celery_app.py

from celery import Celery
from celery.schedules import crontab
from config import get_settings

settings = get_settings()

celery = Celery(
    "finance_agent",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Kolkata",
    enable_utc=True,
    
    # queue routing
    task_routes={
        "tasks.process_invoice_stage_4": {"queue": "high_priority"},
        "tasks.process_invoice_stage_3": {"queue": "high_priority"},
        "tasks.process_invoice_stage_1": {"queue": "default"},
        "tasks.process_invoice_stage_2": {"queue": "default"},
        "tasks.scan_and_enqueue": {"queue": "scheduler"},
        "tasks.retry_dead_letter": {"queue": "scheduler"},
        "tasks.sync_google_sheets": {"queue": "scheduler"},
    },
    
    # rate limiting
    task_annotations={
        "tasks.send_email": {"rate_limit": f"{settings.max_emails_per_minute}/m"},
        "tasks.call_llm": {"rate_limit": f"{settings.max_llm_calls_per_minute}/m"},
    },
    
    # retry behavior
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    
    # beat schedule
    beat_schedule={
        "daily-invoice-scan": {
            "task": "tasks.scan_and_enqueue",
            "schedule": crontab(hour=9, minute=0),
            "options": {"queue": "scheduler"},
        },
        "sheets-sync": {
            "task": "tasks.sync_google_sheets",
            "schedule": crontab(minute="*/30"),
            "options": {"queue": "scheduler"},
        },
        "dead-letter-retry": {
            "task": "tasks.retry_dead_letter",
            "schedule": crontab(hour="*/2"),
            "options": {"queue": "scheduler"},
        },
    },
    
    beat_scheduler="celery.beat:PersistentScheduler",
    beat_schedule_filename="celerybeat-schedule.db",
)
```

```python
# tasks/invoice_tasks.py

from celery_app import celery
from pipeline.graph import build_pipeline
from models.langgraph_state import InvoiceState

pipeline = build_pipeline()

@celery.task(
    bind=True,
    max_retries=3,
    soft_time_limit=120,
    time_limit=180,
    name="tasks.process_invoice",
)
def process_invoice(self, invoice_id: str):
    try:
        initial_state: InvoiceState = {
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
        }
        result = pipeline.invoke(initial_state)
        return {"status": "completed", "invoice_id": invoice_id}

    except Exception as exc:
        countdown = 2 ** self.request.retries * 60  # 60s, 120s, 240s
        if self.request.retries >= self.max_retries:
            # dead letter
            mark_dead_letter(invoice_id, str(exc))
            return {"status": "dead_letter", "invoice_id": invoice_id}
        raise self.retry(exc=exc, countdown=countdown)


@celery.task(name="tasks.scan_and_enqueue")
def scan_and_enqueue():
    """cron entry point — scans overdue invoices and enqueues processing tasks"""
    from db.invoice_repo import get_overdue_invoices
    
    invoices = get_overdue_invoices()
    enqueued = 0
    
    for invoice in invoices:
        if invoice.status not in ["PAID", "PAUSED", "LEGAL"]:
            process_invoice.apply_async(
                args=[invoice.invoice_id],
                queue="high_priority" if invoice.days_overdue >= 15 else "default",
            )
            enqueued += 1
    
    return {"enqueued": enqueued}
```

---

## 8. API ENDPOINTS (FastAPI)

```
POST   /api/invoices/upload          → upload CSV/Excel
GET    /api/invoices                 → list all invoices (paginated, filtered)
GET    /api/invoices/{id}            → single invoice detail
PATCH  /api/invoices/{id}/status     → update status (PAID, PAUSED, etc.)

POST   /api/trigger/scan             → manually trigger cron scan (demo button)
POST   /api/trigger/invoice/{id}     → manually process single invoice

GET    /api/emails/preview/{id}      → get generated email for invoice
POST   /api/emails/regenerate/{id}   → regenerate with optional tone override

GET    /api/human-queue              → list emails pending human review
POST   /api/human-queue/{id}/action  → approve / edit / reject / flag

GET    /api/audit                    → audit log (filterable by stage, action, date)
GET    /api/audit/export             → download audit as CSV

GET    /api/metrics                  → dashboard KPIs
GET    /api/metrics/confidence-dist  → confidence score distribution
GET    /api/metrics/activity-feed    → last 50 events (polled by frontend)

GET    /api/sheets/sync              → trigger manual sheets sync
GET    /api/sheets/status            → last sync timestamp + row count

POST   /api/config/llm              → update LLM config (model, provider)
GET    /api/config/llm              → current LLM config
POST   /api/config/demo-mode        → toggle demo mode (loads default keys + seed data)
```

---

## 9. SECURITY IMPLEMENTATION

### 9.1 API Authentication
```python
# middleware/auth.py
from fastapi import Security, HTTPException
from fastapi.security.api_key import APIKeyHeader

api_key_header = APIKeyHeader(name="X-API-Key")

async def verify_api_key(api_key: str = Security(api_key_header)):
    if api_key != settings.api_key:
        raise HTTPException(status_code=403, detail="Invalid API key")
```

### 9.2 Input Sanitization
- All string fields in `InvoiceRecord` validated via Pydantic `field_validator`
- Prompt injection patterns stripped before injection into prompts
- Client name / email / invoice data double-escaped before f-string insertion

### 9.3 Structured Output Enforcement
```python
# LLM called with response_format={"type": "json_object"}
# Output parsed with GeneratedEmail.model_validate()
# Hallucination check: all invoice fields cross-verified against source data
# Any mismatch → validation failure → retry or fallback
```

### 9.4 PII Masking in Logs
```python
def mask_email(email: str) -> str:
    user, domain = email.split("@")
    return f"{user[0]}***@{domain}"

# logs never contain full email addresses
# Google Sheets writeback omits raw prompt content
```

### 9.5 Rate Limiting
```python
from slowapi import Limiter
limiter = Limiter(key_func=get_remote_address)

@app.get("/api/trigger/scan")
@limiter.limit("5/minute")
async def trigger_scan(): ...
```

### 9.6 .env.example (committed to repo, actual .env in .gitignore)
```
API_KEY=your-api-key-here
LLM__MODEL=groq/llama-3.1-8b-instant
LLM__API_KEY=your-groq-key
EMAIL_MODE=sandbox
RESEND_API_KEY=
MAILTRAP_USER=
MAILTRAP_PASS=
REDIS_URL=redis://localhost:6379/0
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
SHEETS_INVOICE_ID=
SHEETS_AUDIT_ID=
```

---

## 10. FRONTEND COMPONENTS MAP

```
/app
  /dashboard         → KPI cards, live activity feed, escalation heatmap
  /invoices          → invoice table with filters, stage badges, risk indicators
  /invoices/[id]     → invoice detail + email preview + regenerate + tone slider
  /human-queue       → pending approvals: approve / edit / reject
  /audit             → full audit log table, export button
  /observability     → Langfuse traces embed, token graphs, latency metrics
  /settings          → model picker, email mode toggle, demo mode button
```

### Key UI Components
- **ToneSlider** — range input 1-4, live email regeneration on change via debounce
- **ConfidenceBadge** — `HIGH` (green) / `MEDIUM` (yellow) / `LOW` (red) with score
- **StageChip** — color-coded stage badge per invoice row
- **LiveActivityFeed** — polls `/api/metrics/activity-feed` every 5s, shows last 20 events
- **EscalationHeatmap** — invoice count by stage as a visual heat row
- **DemoModeButton** — calls `/api/config/demo-mode`, seeds fake data, loads default keys
- **ModelPicker** — dropdown: Groq / Gemini / OpenAI / Ollama + model name input
- **EmailPreviewPane** — renders subject + body, shows metadata (tone, confidence, model used)
- **DeadLetterTable** — failed jobs with manual retry button

---

## 11. DOCKER COMPOSE

```yaml
version: "3.9"

services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: ["redis_data:/data"]

  backend:
    build: ./backend
    ports: ["8000:8000"]
    env_file: .env
    depends_on: [redis]
    volumes: ["./backend:/app", "sqlite_data:/app/data"]

  worker:
    build: ./backend
    command: celery -A celery_app worker -Q high_priority,default -c 4 --loglevel=info
    env_file: .env
    depends_on: [redis, backend]

  beat:
    build: ./backend
    command: celery -A celery_app beat --loglevel=info
    env_file: .env
    depends_on: [redis]

  flower:
    build: ./backend
    command: celery -A celery_app flower --port=5555
    ports: ["5555:5555"]
    depends_on: [redis]

  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    env_file: ./frontend/.env.local
    depends_on: [backend]

volumes:
  redis_data:
  sqlite_data:
```

---

## 12. BUILD ORDER (for vibecoding)

```
PHASE 1 — SKELETON (get it running)
1. Docker Compose up (redis only first)
2. FastAPI app with /health endpoint
3. SQLModel models + migrations
4. Celery + Beat config, test with dummy task
5. LiteLLM gateway — test with groq key, get a completion

PHASE 2 — CORE PIPELINE
6. InvoiceRecord + all Pydantic models
7. LangGraph pipeline — stub all nodes first, log state at each step
8. Prompt registry (all 4 stages)
9. validate_output node + hallucination check
10. Fallback template engine

PHASE 3 — INFRA
11. Email dispatch (Mailtrap sandbox first)
12. Audit logging to SQLite
13. Human queue (DB table + API endpoints)
14. Google Sheets ingestion (gspread)
15. Google Sheets audit writeback

PHASE 4 — FRONTEND
16. Next.js scaffold with shadcn
17. Dashboard + invoice table
18. Email preview + tone slider
19. Human review queue UI
20. Settings (model picker, demo mode)
21. Live activity feed

PHASE 5 — POLISH
22. Langfuse integration
23. Confidence badges + heatmap
24. Dead letter table + retry button
25. Export audit CSV
26. Demo mode with seed data + default keys
27. README + security docs
```

---

## 13. VIBECODIING PROMPTS (USE THESE)

### Prompt 1 — LangGraph pipeline
```
Build a LangGraph pipeline for a finance email agent. 

State schema (TypedDict):
[paste InvoiceState from this doc]

Nodes needed:
- load_invoice: fetch InvoiceRecord from SQLite by invoice_id
- classify_stage: compute EscalationStage from days_overdue (1-7=STAGE_1, 8-14=STAGE_2, 15-21=STAGE_3, 22-30=STAGE_4, 30+=ESCALATED sets stage=0)
- build_prompt: pull system + user prompt from STAGE_PROMPTS dict, inject invoice fields
- call_llm: use LiteLLM completion with JSON mode, catch timeout and set error in state
- validate_output: parse GeneratedEmail pydantic model, run hallucination check, populate validation_errors
- confidence_check: if confidence_score < 0.75 or stage == 4, set requires_human=True
- dispatch_email: call send_email() async via Celery task
- human_queue: insert into human_review table in SQLite
- fallback_template: use deterministic template (no LLM), set fallback_used=True
- write_audit: create AuditEntry, save to SQLite and queue Sheets writeback

Routing:
- classify_stage → human_queue if stage==0, else build_prompt
- validate_output → confidence_check if valid, build_prompt if retry_count<2, fallback_template otherwise
- confidence_check → dispatch_email if not requires_human, else human_queue

Use the exact node names above. Return compiled graph.
```

### Prompt 2 — Celery tasks
```
Create Celery tasks file for finance email agent.

Use celery_app imported from celery_app.py.

Tasks:
1. process_invoice(invoice_id: str) — runs LangGraph pipeline, retry 3x with exponential backoff (60*2^retries seconds), on exhaustion calls mark_dead_letter(invoice_id, error)
2. scan_and_enqueue() — fetches active overdue invoices from DB, dispatches process_invoice tasks, high_priority queue for days_overdue>=15
3. sync_google_sheets() — pulls new rows from invoice sheet via gspread, upserts to SQLite
4. retry_dead_letter() — fetches failed records from dead_letter table older than 2hrs, re-enqueues with reset retry count

Each task must log start/end with structured JSON using Python logging.
```

### Prompt 3 — FastAPI routes
```
Create FastAPI router for invoice operations.

Auth: all routes require X-API-Key header matching settings.api_key.
Use slowapi for rate limiting.

Routes:
[paste from section 8 above]

Each route should:
- validate input with Pydantic
- return consistent response envelope: {"success": bool, "data": any, "error": str|None}
- log request with invoice_id if applicable
```

### Prompt 4 — Frontend Dashboard
```
Build a Next.js dashboard page using shadcn/ui and Tailwind.

Dark theme, industrial/utilitarian aesthetic. NOT purple gradients.
Use Geist Mono for data, Geist for UI.

Components on dashboard:
1. KPI row: total overdue, emails sent today, pending human review, dead letters
2. EscalationHeatmap: horizontal bar showing invoice count per stage (1-4 + escalated)
3. LiveActivityFeed: polls GET /api/metrics/activity-feed every 5s, shows last 20 events with timestamp + color-coded action badge
4. InvoiceTable: columns [invoice_id, client, amount, days_overdue, stage chip, confidence badge, status, actions]

Stage chip colors: stage1=blue, stage2=yellow, stage3=orange, stage4=red, escalated=purple
Confidence badge: >=0.75 green HIGH, 0.5-0.75 yellow MEDIUM, <0.5 red LOW

All data fetched from /api/invoices and /api/metrics. Show skeleton loaders while loading.
```

---

## 14. MANDATORY DELIVERABLES CHECKLIST

- [ ] GitHub repo (public) with source code
- [ ] `.env.example` committed, `.env` in `.gitignore`
- [ ] `README.md` with: overview, setup, architecture diagram, LLM choice rationale, security section
- [ ] Security section documents all 6 risks from brief + mitigations
- [ ] Sample output: audit log CSV or screenshot of sent emails log
- [ ] 3-5 min demo recording showing end-to-end run
- [ ] 8-10 slide deck: problem, solution, architecture, escalation matrix, security, results
- [ ] Demo mode working (evaluator can run without own API keys)
