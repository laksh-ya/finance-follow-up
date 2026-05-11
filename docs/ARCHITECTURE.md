# Architecture — Layer-by-Layer Technical Documentation

This document describes the implemented architecture of the Finance Collections Agent — every layer, data flow, component interaction, and operational topology. It references concrete files and is intended as deep technical context for understanding the full system.

---

## 1. System Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 7 — PRESENTATION                                            │
│  Next.js 15 · React 19 · Tailwind · shadcn/ui                      │
│  8 route pages + reusable domain components                         │
│  Unified API client with envelope parsing                           │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 6 — API GATEWAY                                              │
│  FastAPI 0.115 · Pydantic 2 validation                              │
│  X-API-Key auth · CORS · SlowAPI rate limiting                      │
│  12 domain routers · OpenAPI auto-docs                              │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 5 — ORCHESTRATION                                            │
│  Celery 5.4 · Redis broker · Beat scheduler                         │
│  Priority queues · Dead-letter retry · Eager mode for dev           │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 4 — AI PIPELINE                                              │
│  LangGraph 0.2.60 · 10-node state machine                          │
│  Conditional routing · Retry loop · Fallback templates              │
│  Prompt registry · Schema validation · Hallucination checks         │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 3 — LLM GATEWAY                                              │
│  LiteLLM 1.55 · Provider-agnostic interface                         │
│  JSON output mode · Mock path · Langfuse tracing                    │
│  Groq / Gemini / OpenAI / Ollama / Together                         │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 2 — DISPATCH & INTEGRATIONS                                   │
│  Email: mock / SMTP (Mailtrap, Gmail) / Resend API                  │
│  Google Sheets: bidirectional sync + audit writeback                 │
│  Langfuse: per-call LLM tracing with metadata                       │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 1 — DATA PERSISTENCE                                         │
│  SQLModel 0.0.22 · SQLAlchemy 2.0                                   │
│  6 tables · Repository pattern · SQLite (dev) / Postgres (prod)     │
│  Session management with expire_on_commit=False                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer 1 — Data Persistence

### 2.1 Database Engine

**File:** `backend/app/db/database.py`

- Engine created lazily on first use via `get_engine()`
- SQLite: auto-creates `./data/` directory, uses `check_same_thread=False`
- PostgreSQL: standard connection via `DATABASE_URL` env var
- `init_db()` runs `SQLModel.metadata.create_all()` on startup — no migration tool needed for v0
- Session factory: `db_session()` context manager with `expire_on_commit=False` to prevent `DetachedInstanceError` when reading ORM attributes after session close

### 2.2 Table Schema

**File:** `backend/app/db/tables.py`

| Table | Purpose | Key Fields |
|---|---|---|
| `InvoiceTable` | Master invoice state + latest email cache | `invoice_id` (PK), `client_name`, `client_email`, `amount`, `days_overdue`, `stage`, `status`, `last_email_*` cache fields |
| `AuditTable` | Immutable pipeline-level audit entries | `id` (UUID), `invoice_id` (FK), `action`, `stage`, `tone_used`, `confidence_score`, `delivery_status`, `model_used`, `tokens_used` |
| `HumanQueueTable` | Pending and resolved human-review items | `invoice_id`, `reason`, `confidence_score`, `risk_level`, `email_subject/body/tone`, `status`, `reviewer_note` |
| `SentEmailTable` | Source of truth for every dispatch attempt | `invoice_id`, `to_email`, `from_email`, `subject`, `body`, `tone`, `stage`, `provider`, `provider_message_id`, `status`, `human_approved`, `edited_by_human` |
| `DeadLetterTable` | Failed task retries | `invoice_id`, `error_message`, `retry_count`, `resolved` |
| `ActivityEventTable` | Lightweight live feed for dashboard | `event_type`, `message`, `invoice_id`, `level` (info/warn/error/success) |

### 2.3 Repository Layer

**File:** `backend/app/db/repos.py` (517 lines)

Thin query/write wrappers organized by domain:

- **Invoices**: `list_invoices`, `get_invoice`, `get_overdue_invoices`, `upsert_invoice`, `update_invoice_status`, `update_invoice_email_cache`, `recompute_days_overdue`
- **Audit**: `add_audit`, `list_audit`
- **Human Queue**: `enqueue_human`, `list_human_queue`, `cancel_pending_human_queue` (deduplication), `resolve_human_queue`
- **Dead Letter**: `mark_dead_letter`, `list_dead_letter`, `resolve_dead_letter`
- **Activity**: `push_activity`, `list_activity`
- **Sent Emails**: `add_sent_email`, `list_sent_emails`, `get_sent_email`, `last_delivery_status_map`, `list_failed_invoice_ids`
- **Metrics**: `metrics_snapshot` — aggregated KPI snapshot (totals, stage counts, confidence distribution)
- **Timeline**: `invoice_timeline` — unified chronological feed merging audit + sent + activity for one invoice

---

## 3. Layer 2 — Dispatch & Integrations

### 3.1 Email Dispatcher

**File:** `backend/app/email/dispatcher.py`

Single entry-point: `send_for_invoice(...)` — used by both pipeline auto-dispatch and human-queue approve handler.

```
send_for_invoice(...)
    ├── mode == "mock"     → _mock_send()     → log only, no network
    ├── mode == "sandbox"  → _send_smtp()     → Mailtrap / Gmail / Zoho / any SMTP
    └── mode == "live"     → _send_resend()   → Resend HTTP API (verified domain)
    │
    └── Always persists SentEmailTable row (success or failure)
        └── Returns DispatchResult(status, message, provider, provider_message_id, sent_email_id)
```

SMTP auto-handles port variants: 465 (implicit SSL), 587 (STARTTLS), 2525 (Mailtrap-style plain).

Key guarantee: **every dispatch attempt is persisted** in `SentEmailTable`, including failures — so the dashboard always shows what was actually attempted.

### 3.2 Google Sheets Integration

**File:** `backend/app/services/sheets.py`

- `sync_invoices_from_sheets()` — pulls rows into DB, respects sheet as master for status/stage/followup_count
- `update_invoice_on_sheet(...)` — writes back status, stage, followup_count, last_email_date, last_email_tone
- `append_audit_row(...)` — appends to separate audit sheet
- Auto-adds missing columns on first sync (`_ensure_columns`)
- Authenticated via GCP service account (`credentials.json`)

### 3.3 Langfuse Tracing

**File:** `backend/app/services/langfuse_client.py`

- Context manager `trace(name, **metadata)` wraps LLM calls
- No-op when `LANGFUSE_ENABLED=false`
- LiteLLM callbacks also configured in `main.py` startup for automatic per-call traces

---

## 4. Layer 3 — LLM Gateway

**File:** `backend/app/llm/gateway.py`

### 4.1 Architecture

```
LLMGateway.complete(...)
    ├── is_mock? → complete_mock() → deterministic per-stage templates
    └── real?    → litellm.completion()
                    ├── JSON response mode enforced
                    ├── Markdown fence stripping (```json...```)
                    └── Pydantic parse into GeneratedEmail
                        └── Returns (GeneratedEmail, tokens, latency_ms)
```

### 4.2 Provider Switching

Zero code changes — runtime config only:

| Variable | Example |
|---|---|
| `LLM__PROVIDER` | `groq`, `gemini`, `openai`, `ollama`, `together`, `mock` |
| `LLM__MODEL` | `groq/llama-3.1-8b-instant`, `openai/gpt-4o-mini` |
| `LLM__API_KEY` | Provider-specific key |
| `LLM__BASE_URL` | Custom endpoint (Ollama: `http://localhost:11434`) |

### 4.3 Mock LLM

**File:** `backend/app/llm/mock.py`

Deterministic template generator for demos. Per-stage subject/body templates with seeded pseudo-random confidence scores. Used as fallback when LLM retries exhaust.

---

## 5. Layer 4 — AI Pipeline (LangGraph)

### 5.1 Graph Definition

**File:** `backend/app/pipeline/graph.py`

10 nodes, 3 conditional routing edges:

```
load_invoice
    │
classify_stage ──── stage == ESCALATED (30+ days)?
    │                    YES → human_queue
    │                    NO  ↓
build_prompt
    │
call_llm
    │
validate_output ──── valid?
    │                    NO  → retry_count ≤ 2? → build_prompt (retry)
    │                    NO  → retry_count > 2? → fallback_template
    │                    YES ↓
confidence_check ──── requires_human?
    │                    YES → human_queue
    │                    NO  → dispatch_email
    │
    ├── dispatch_email ──┐
    ├── human_queue ─────┤
    └── fallback_template┤
                         │
                    write_audit → END
```

### 5.2 Node Behavior

**File:** `backend/app/pipeline/nodes.py`

| Node | Responsibility |
|---|---|
| `load_invoice_node` | Fetch from DB, serialize to `InvoiceRecord` dict |
| `classify_stage_node` | Map `days_overdue` → stage (1-4 or ESCALATED). 30+ → `requires_human=True` |
| `build_prompt_node` | Apply stage-specific prompts from registry. Supports tone override |
| `call_llm_node` | Invoke gateway with Langfuse trace wrapper. Store model/tokens/latency metadata |
| `validate_output_node` | Pydantic schema validation + `check_hallucination()`. Increments `retry_count` on failure |
| `confidence_check_node` | Compute risk level (LOW/MEDIUM/HIGH). Route to human if: HIL enabled AND (low confidence OR stage 4) OR auto_dispatch disabled |
| `dispatch_email_node` | Send via dispatcher, persist `SentEmailTable`, update invoice email cache, push activity event |
| `human_queue_node` | Deduplicates pending entries (`cancel_pending_human_queue`), creates review queue item. Auto-flags 30+ day invoices as DISPUTED |
| `fallback_template_node` | Deterministic template from mock LLM. Always routes to human review (`requires_human=True`) |
| `write_audit_node` | Persist `AuditTable` entry + optional Sheets writeback (audit row + invoice status) |

### 5.3 State Object

**File:** `backend/app/models/langgraph_state.py`

`InvoiceState` (TypedDict) flows through the entire pipeline:

- **Core**: `invoice_id`, `invoice` (serialized dict)
- **Pipeline tracking**: `stage`, `retry_count`, `fallback_used`
- **Prompt/LLM**: `system_prompt`, `user_prompt`, `prompt_version`
- **Output**: `generated_email`, `confidence_score`, `risk_level`, `hallucination_check`, `validation_errors`
- **Routing**: `requires_human`, `human_reason`
- **Observability**: `tokens_used`, `latency_ms`, `model_used`
- **Audit**: `audit_entries`, `error`
- **Override**: `tone_override` (1-4, forces stage tone)

### 5.4 Prompt Strategy

**File:** `backend/app/pipeline/prompts.py`

1. **System prompt** — 10 strict rules including anti-hallucination, JSON-only output, tone matching
2. **Stage prompts (1-4)** — escalating tone requirements + stage-specific user templates
3. **Anti-hallucination fields** — LLM must echo `invoice_id_used`, `client_name_used`, `amount_used`, `days_overdue_used` exactly
4. **Output schema** — embedded in system prompt, enforced by `GeneratedEmail` Pydantic model

### 5.5 Validation & Guardrails

**File:** `backend/app/models/email_output.py`

- `GeneratedEmail` — strict Pydantic model with field length constraints, valid tone enum, confidence range
- `check_hallucination()` — cross-field comparison against source `InvoiceRecord` with tolerance (`amount ± 0.01`, `days_overdue ± 1`)
- `no_hallucination_placeholders` — validator rejects `[INSERT`, `PLACEHOLDER`, `TBD`, `XXX` in body
- Retry loop: up to 2 re-generations → fallback template → human queue

---

## 6. Layer 5 — Orchestration (Celery)

### 6.1 Celery App

**File:** `backend/app/tasks/celery_app.py`

- Broker: Redis (with Upstash TLS support via `rediss://`)
- Queues: `high_priority`, `default`, `scheduler`
- Eager mode: `CELERY_EAGER=true` runs tasks inline (no Redis needed)

### 6.2 Tasks

**File:** `backend/app/tasks/invoice_tasks.py`

| Task | Schedule | Behavior |
|---|---|---|
| `process_invoice` | On-demand | Runs LangGraph pipeline for one invoice. 3 retries with exponential backoff. Dead-letters on max retries |
| `scan_and_enqueue` | Daily 9:00 AM | Recomputes `days_overdue`, enqueues overdue invoices. Skips already-processed unless `force=True`. `failed_only=True` for resend-failed |
| `sync_google_sheets` | Every 30 min | Pulls from Google Sheets when enabled |
| `retry_dead_letter` | Every 2 hours | Re-enqueues unresolved dead-letter entries |
| `seed_mock_invoices` | On-demand | Seeds sample invoices for demos |

### 6.3 Queue Routing

- Stage 3+ invoices → `high_priority` queue
- Stage 1-2 invoices → `default` queue
- Scheduler tasks → `scheduler` queue
- Rate limits: `MAX_EMAILS_PER_MINUTE`, `MAX_LLM_CALLS_PER_MINUTE`

---

## 7. Layer 6 — API Gateway (FastAPI)

### 7.1 Entry Point

**File:** `backend/app/main.py`

Startup sequence:
1. Create FastAPI app with SlowAPI rate limiter
2. Configure CORS from `CORS_ORIGINS` env
3. Add request logging middleware (method, path, status, latency)
4. `init_db()` — create all tables
5. Configure Langfuse LiteLLM callbacks if enabled
6. Register all routers

### 7.2 Authentication

**File:** `backend/app/api/auth.py`

- `verify_api_key()` — FastAPI dependency, reads `X-API-Key` header
- Logs auth failures to activity feed (audit trail for failed access)
- Public exceptions: `GET /health`, `GET /api/invoices/sample-csv`

### 7.3 Configuration

**File:** `backend/app/config.py`

- `AppSettings` (Pydantic settings) — all behavior controlled by environment variables
- Nested config: `LLMConfig` via `__` delimiter (e.g., `LLM__PROVIDER`)
- `reload_settings()` — used by `/api/config` PATCH endpoint for live config updates
- Runtime-mutable via Settings UI or API without restart

### 7.4 API Routers

| Router | File | Endpoints |
|---|---|---|
| Invoices | `api/invoices.py` | List, upload CSV/XLS, export, patch status, timeline, sample CSV |
| Trigger | `api/trigger.py` | Scan overdue, process single invoice |
| Emails | `api/emails.py` | Preview, regenerate with tone override |
| Human Queue | `api/human_queue.py` | List pending, process action (approve/edit/reject/regenerate/flag) |
| Sent Emails | `api/sent_emails.py` | List attempts, get single, export CSV |
| Audit | `api/audit.py` | List with filters, export CSV |
| Metrics | `api/metrics.py` | KPI snapshot, activity feed, dead-letter list |
| Config | `api/config_router.py` | Get/patch config, seed, reset |
| Sheets | `api/sheets.py` | Sync status, trigger sync |
| Diagnostics | `api/diagnostics.py` | Deep health, test LLM/email/Redis/Sheets |

---

## 8. Layer 7 — Presentation (Next.js)

### 8.1 API Client

**File:** `frontend/lib/api.ts`

- Unified envelope parsing (`{ success, data, error }`)
- Automatic `X-API-Key` header injection from `NEXT_PUBLIC_API_KEY`
- Typed endpoint wrappers used by all pages

### 8.2 Route Map

| Route | Key Functionality |
|---|---|
| `/` | KPI cards, stage breakdown chart, live activity feed (polling) |
| `/invoices` | Upload CSV/Excel, download sample, process/reprocess, filter by status/stage |
| `/invoices/[id]` | Email preview, tone slider + regenerate, timeline tab (audit + sent + activity) |
| `/human-queue` | Approve/edit/reject/regenerate/flag actions with reviewer notes |
| `/sent` | Full sent-attempt browser with body preview, delivery status |
| `/audit` | Filterable audit table, CSV export |
| `/observability` | LLM health, dead-letter queue monitoring |
| `/settings` | Runtime config toggles, test connections panel (LLM/email/Redis/Sheets) |

---

## 9. Data Flow — End-to-End Invoice Processing

```
1. INGESTION
   CSV upload → POST /api/invoices/upload → parse + validate → upsert InvoiceTable
   (or) Google Sheets sync → Celery Beat task → gspread pull → upsert InvoiceTable

2. TRIGGER
   POST /api/trigger/scan → scan_and_enqueue task
     → recompute_days_overdue() for all invoices
     → filter: ACTIVE + days_overdue > 0 + not already processed
     → enqueue process_invoice task per invoice (high_priority if stage 3+)

3. PIPELINE (per invoice)
   process_invoice → run_for_invoice() → LangGraph state machine
     → load → classify → prompt → LLM → validate → confidence → dispatch/queue → audit

4. DISPATCH (auto path)
   dispatch_email_node → send_for_invoice()
     → SMTP/Resend/mock send
     → persist SentEmailTable row
     → update InvoiceTable email cache + bump followup_count
     → push ActivityEvent

5. HUMAN REVIEW (manual path)
   human_queue_node → enqueue HumanQueueTable entry
     → reviewer approves → send_for_invoice() with human_approved=True
     → same persist path as auto-dispatch

6. AUDIT
   write_audit_node → persist AuditTable entry
     → optional Sheets writeback (audit row + invoice status update)
```

---

## 10. Operational Topologies

### 10.1 Local Development (zero dependencies)

```
SQLite + CELERY_EAGER=true + EMAIL_MODE=mock + no API key = mock LLM
```

One command: `make dev` — runs everything inline.

### 10.2 Demo Recording Setup

```
SQLite + CELERY_EAGER=true + EMAIL_MODE=sandbox (Mailtrap) + real LLM key (Groq)
```

Real emails generated by Groq, safely caught in Mailtrap inbox.

### 10.3 Full Async Deployment

```
PostgreSQL + Redis + Celery worker(s) + Celery Beat + EMAIL_MODE=live (Resend) + Langfuse
```

Docker Compose provides this as a template: `docker-compose.yml` with redis, backend, worker, beat, flower, frontend services.

### 10.4 Production (Render + Vercel)

- Backend: Render Web Service (`uvicorn`)
- Worker: Render Background Worker (`celery worker`)
- Beat: Render Background Worker (`celery beat`)
- Frontend: Vercel (`pnpm build`)
- Redis: Upstash (serverless, TLS)
- Database: Supabase or Neon (managed Postgres)

---

## 11. Security Architecture

| Control | Implementation |
|---|---|
| **API Authentication** | `X-API-Key` header on all protected routes. Auth failures logged to activity feed |
| **Input Sanitization** | `InvoiceRecord` validator blocks prompt injection patterns (`ignore previous`, `system:`, `<|`, etc.) |
| **Prompt Injection Defense** | Strict system prompt rules, JSON-only output mode, no user-controlled system prompt content |
| **Hallucination Prevention** | 4-field cross-check (invoice_id, client_name, amount, days_overdue), placeholder detection, retry loop |
| **PII Handling** | Email addresses masked in logs (`mask_email()`), PII only accessible through authenticated API |
| **Email Safety** | Three-mode switch (mock/sandbox/live), sandbox prevents real delivery, live requires verified domain |
| **CORS** | Configurable allowlist via `CORS_ORIGINS` |
| **Rate Limiting** | SlowAPI setup + Celery task-level rate annotations |

---

## 12. Reliability Controls

| Mechanism | Implementation |
|---|---|
| **Task Retry** | Celery `max_retries=3` with exponential backoff (60s, 120s, 240s) |
| **Dead Letter Queue** | `DeadLetterTable` captures permanently failed tasks for manual retry |
| **Validation Retry** | LangGraph retry loop (2 attempts) before falling back to deterministic template |
| **Human Review Dedup** | `cancel_pending_human_queue()` supersedes stale drafts when re-processing |
| **Dispatch Persistence** | Every email send attempt (success or failure) persisted in `SentEmailTable` |
| **Best-Effort Integrations** | Sheets writeback, Langfuse tracing — failures don't block core audit/DB path |

---

## 13. File Map for Reviewers

| Concern | File(s) |
|---|---|
| App boot + router wiring | `backend/app/main.py` |
| Runtime config | `backend/app/config.py` |
| Graph definition | `backend/app/pipeline/graph.py` |
| Node logic + routing | `backend/app/pipeline/nodes.py` |
| Prompt design | `backend/app/pipeline/prompts.py` |
| LLM adapter | `backend/app/llm/gateway.py` |
| Mock LLM templates | `backend/app/llm/mock.py` |
| Email dispatch | `backend/app/email/dispatcher.py` |
| DB schema | `backend/app/db/tables.py` |
| Repository queries | `backend/app/db/repos.py` |
| Pydantic DTOs | `backend/app/models/*.py` |
| Celery tasks | `backend/app/tasks/invoice_tasks.py` |
| API contracts | `backend/app/api/*.py` |
| Frontend API client | `frontend/lib/api.ts` |
| Frontend routes | `frontend/app/**/page.tsx` |
