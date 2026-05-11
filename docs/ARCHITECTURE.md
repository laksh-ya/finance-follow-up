# Finance Credit Follow-Up Agent - Architecture and Technical Documentation

## 1. Scope and intent

This document describes the implemented architecture of the Task 2 system in this repository:

- What components exist and how they interact.
- How invoice data moves through ingestion, AI generation, review, dispatch, and audit.
- How security controls are currently implemented.
- What operational limits and hardening items still exist.

This document is implementation-first and references concrete files in this codebase.

## 2. System context

The solution is a full-stack agentic application:

- **Frontend**: Next.js app for finance operators.
- **Backend**: FastAPI service exposing APIs and orchestrating the pipeline.
- **Pipeline**: LangGraph state machine for deterministic invoice processing.
- **Storage**: SQLModel tables on SQLite by default, PostgreSQL optional.
- **Execution**: Celery tasks (inline eager mode for local, worker mode for distributed setup).
- **External integrations**: LLM providers through LiteLLM, SMTP/Resend email dispatch, optional Google Sheets sync, optional Langfuse tracing.

## 3. Component diagram

```text
                             +----------------------------------+
                             |             Frontend             |
                             | Next.js 15 + React 19            |
                             | Routes: /, /invoices, /audit...  |
                             +----------------+-----------------+
                                              |
                                              | HTTP + X-API-Key
                                              v
+--------------------------------------------------------------------------------------+
|                                  FastAPI backend                                     |
|                                                                                      |
|  Routers                                                                             |
|  - invoices, trigger, emails, human_queue, sent_emails, audit, metrics              |
|  - config, sheets, diagnostics                                                       |
|                                                                                      |
|  Pipeline                                                                            |
|  - LangGraph graph with explicit nodes and conditional edges                         |
|                                                                                      |
|  Persistence                                                                          |
|  - SQLModel tables: invoices, audit_entries, human_queue, sent_emails, dead_letter  |
|                                                                                      |
|  Integrations                                                                         |
|  - LiteLLM gateway -> Groq/Gemini/OpenAI/Ollama/Together/mock                        |
|  - Email dispatcher -> mock / SMTP / Resend                                          |
|  - Google Sheets sync/writeback (optional)                                           |
|  - Langfuse trace wrapper (optional)                                                 |
|                                                                                      |
|  Async execution                                                                      |
|  - Celery tasks with Redis broker (or eager inline execution)                        |
+--------------------------------------------------------------------------------------+
```

## 4. Backend architecture

### 4.1 Entry point and middleware

**File:** `backend/app/main.py`

Key responsibilities:

1. Creates FastAPI app and router registry.
2. Adds CORS middleware from runtime settings.
3. Initializes database tables on startup.
4. Enables LiteLLM callbacks for Langfuse when configured.
5. Registers health endpoint and all API routers.

Authentication model:

- Each protected router declares `Depends(verify_api_key)` in router dependencies.
- API key is read from `X-API-Key` header.
- Public exceptions:
  - `GET /health`
  - `GET /api/invoices/sample-csv`

### 4.2 Configuration model

**File:** `backend/app/config.py`

Runtime behavior is controlled by `AppSettings` (Pydantic settings):

- Data source mode: `csv` or `sheets`
- Review controls: `human_in_loop`, `auto_dispatch`
- LLM provider/model/API key settings
- Email mode and provider credentials
- Queue/Redis settings
- Sheets settings
- Langfuse settings
- DB URL

The `/api/config` endpoint mutates runtime environment variables and reloads settings in-process.

### 4.3 API surface by domain

#### Invoices (`backend/app/api/invoices.py`)

- List/filter invoices
- Upload CSV/XLS/XLSX with schema validation
- Export invoice state to CSV
- Patch invoice status
- Timeline retrieval per invoice
- Public sample CSV endpoint

Notable behavior:

- Upload computes `days_overdue` from `due_date`.
- Upload and status changes trigger activity/audit entries.
- Status updates attempt Google Sheets writeback (best effort).

#### Triggering (`backend/app/api/trigger.py`)

- `POST /api/trigger/scan`: process overdue invoices in bulk
- `POST /api/trigger/invoice/{invoice_id}`: process single invoice

#### Email generation (`backend/app/api/emails.py`)

- Preview cached latest generated email
- Regenerate for a specific invoice with optional tone override

#### Human queue (`backend/app/api/human_queue.py`)

- List pending review items
- Process reviewer action (`approve`, `edit`, `reject`, `regenerate`, `flag`)

#### Sent emails (`backend/app/api/sent_emails.py`)

- List sent-attempt records (success or failure)
- Fetch single sent record
- Export sent records as CSV

#### Audit (`backend/app/api/audit.py`)

- List audit entries with filters
- Export audit CSV

#### Metrics and activity (`backend/app/api/metrics.py`)

- KPI snapshot
- Activity feed
- Dead letter list

#### Sheets (`backend/app/api/sheets.py`)

- Sync status
- Trigger sync from Google Sheets

#### Diagnostics (`backend/app/api/diagnostics.py`)

- Deep health snapshot
- Test LLM
- Test email provider
- Test Redis
- Test Google Sheets

### 4.4 Data model

**File:** `backend/app/db/tables.py`

Primary tables:

- `InvoiceTable`: master invoice state and latest generated-email cache
- `AuditTable`: immutable processing-level audit entries
- `HumanQueueTable`: pending and resolved human-review items
- `SentEmailTable`: source of truth for every dispatch attempt
- `DeadLetterTable`: failed task retries
- `ActivityEventTable`: lightweight recent feed for UI pulse/monitoring

Repository layer:

- **File:** `backend/app/db/repos.py`
- Encapsulates query/write patterns and derived metrics.

### 4.5 Async execution and scheduling

**Files:**

- `backend/app/tasks/celery_app.py`
- `backend/app/tasks/invoice_tasks.py`

Task flow:

1. `scan_and_enqueue` refreshes overdue status and dispatches processing tasks.
2. `process_invoice` runs LangGraph for one invoice.
3. `retry_dead_letter` retries unresolved failures.
4. `sync_google_sheets` syncs external sheet data.

Execution modes:

- **Eager mode (`CELERY_EAGER=true`)**: synchronous execution in API process.
- **Worker mode (`CELERY_EAGER=false`)**: Redis-backed distributed execution.

Beat schedule includes daily scan, periodic sheets sync, and dead-letter retry.

## 5. LangGraph pipeline architecture

### 5.1 Graph wiring

**File:** `backend/app/pipeline/graph.py`

Nodes:

1. `load_invoice`
2. `classify_stage`
3. `build_prompt`
4. `call_llm`
5. `validate_output`
6. `confidence_check`
7. `dispatch_email`
8. `human_queue`
9. `fallback_template`
10. `write_audit`

Conditional routes:

- After `classify_stage`: `human_queue` if escalated (`stage == 0`), else prompt flow.
- After `validate_output`: retry prompt if validation errors and retries remaining, else fallback.
- After `confidence_check`: dispatch or human queue depending on routing flags.

### 5.2 Pipeline sequence

```text
load_invoice
  -> classify_stage
      -> (build_prompt | human_queue)
build_prompt -> call_llm -> validate_output
validate_output -> (confidence_check | build_prompt retry | fallback_template)
confidence_check -> (dispatch_email | human_queue)
dispatch_email/human_queue/fallback_template -> write_audit -> END
```

### 5.3 Core node behavior

**File:** `backend/app/pipeline/nodes.py`

- `classify_stage_node` maps overdue days to stage; 30+ days marks `requires_human`.
- `build_prompt_node` applies stage prompts and optional manual tone override.
- `call_llm_node` invokes gateway and stores model/tokens/latency metadata.
- `validate_output_node` validates schema and hallucination constraints; increments retry counter on failure.
- `confidence_check_node` computes risk level and routing decision.
- `dispatch_email_node` sends email and writes sent-attempt metadata.
- `human_queue_node` creates or updates review queue entries and deduplicates pending drafts.
- `fallback_template_node` uses deterministic template when LLM retries are exhausted.
- `write_audit_node` persists final pipeline state and triggers optional sheets writeback.

### 5.4 Prompt strategy

**File:** `backend/app/pipeline/prompts.py`

Design pattern:

1. Common strict system prompt with hard constraints.
2. Stage-specific user prompt templates.
3. Required exact-field echo constraints (`invoice_id_used`, `amount_used`, etc.).
4. JSON schema target for output parsing.

This is combined with runtime validation in `GeneratedEmail` and `check_hallucination`.

## 6. LLM architecture

### 6.1 Gateway abstraction

**File:** `backend/app/llm/gateway.py`

- Single call interface: `LLMGateway.complete(...)`
- Supports mock mode when provider is `mock` or API key is absent.
- Uses LiteLLM JSON response mode for real provider calls.
- Parses result into strict Pydantic model.

### 6.2 Provider switching

Provider/model are runtime config values:

- `LLM__PROVIDER`
- `LLM__MODEL`
- `LLM__API_KEY`

No code edits are needed to switch providers under supported LiteLLM targets.

## 7. Email dispatch architecture

**File:** `backend/app/email/dispatcher.py`

Modes:

- `mock`: no network send
- `sandbox`: SMTP (Mailtrap or custom SMTP)
- `live`: Resend API

Important guarantee:

- Every send attempt is persisted in `SentEmailTable`, including failures.
- This gives UI and auditors exact visibility into what was attempted and when.

## 8. Google Sheets integration

**File:** `backend/app/services/sheets.py`

Capabilities:

1. Pull invoice rows into DB.
2. Ensure required columns exist and add missing ones.
3. Write invoice status/stage/followup/date/tone back to sheet.
4. Append audit entries to a separate audit sheet.

Mode control:

- Enabled only when `SHEETS_ENABLED=true`.
- Data source switching via `/api/config` can reset DB for session isolation.

## 9. Frontend architecture

### 9.1 Structure

**Main areas:**

- `frontend/app/`: route-level pages
- `frontend/components/`: reusable UI and domain widgets
- `frontend/lib/`: API client and shared types

### 9.2 Route responsibilities

- `/`: KPIs, stage breakdown, live activity
- `/invoices`: ingest/sync, process triggers, filtering, status control
- `/invoices/[id]`: per-invoice controls, regenerate, timeline
- `/human-queue`: reviewer workflow and decision actions
- `/sent`: full sent-attempt browser with body preview
- `/audit`: filterable auditable table and export
- `/observability`: health and LLM/dead-letter visibility
- `/settings`: runtime behavior and integration configuration

### 9.3 API client model

**File:** `frontend/lib/api.ts`

- Unified envelope parsing (`{ success, data, error }`).
- Automatic `X-API-Key` header injection from `NEXT_PUBLIC_API_KEY`.
- Endpoint wrapper functions used by all pages.

## 10. Security architecture and control mapping

### 10.1 Prompt injection

Controls:

- Invoice field sanitization checks for dangerous patterns.
- Strict prompt constraints.
- Structured output parsing and schema validation.
- Hallucination comparison against source invoice fields.

### 10.2 Data privacy and PII

Current state:

- PII is intentionally stored and visible to authorized operators in UI.
- API key protection is used on protected endpoints.
- No separate data-masking service is implemented in current code.

Operational recommendation:

- Use TLS everywhere.
- Restrict DB and environment secret access.
- Apply retention and redaction policy if required by compliance context.

### 10.3 API key and credential handling

Implemented:

- Runtime env-based secret loading.
- `.env.example` uses placeholders only.

Operational recommendation:

- Use managed secrets in deployment (not flat files).
- Rotate keys periodically.

### 10.4 Hallucination and unsafe output

Implemented:

1. Strict Pydantic schema for generated output.
2. Field-level mismatch checks against source invoice.
3. Retry loop with bounded attempts.
4. Fallback deterministic template.
5. Human review routing by confidence and stage.

### 10.5 Unauthorized access and abuse

Implemented:

- API key gate on protected routers.

Important note:

- The project includes `slowapi` setup but route-level limiter decorators are not currently applied, so endpoint-level throttling is not fully enforced in current implementation.

### 10.6 Email spoofing

Implemented:

- Explicit mode switch between mock/sandbox/live.
- Live mode supports Resend verified sender flow.

Operational recommendation:

- Ensure SPF/DKIM/DMARC are configured on sending domain before production live sends.

## 11. Operational topologies

### 11.1 Local dev baseline

- SQLite
- `CELERY_EAGER=true`
- `EMAIL_MODE=mock`
- Optional mock LLM (no key) or real LLM

This mode has minimal dependencies and is ideal for grading demos.

### 11.2 Full async deployment

- Postgres
- Redis + Celery worker + Celery beat
- Sandbox/live email provider
- Optional sheets and Langfuse

`docker-compose.yml` provides a local multi-service stack template.

## 12. Reliability and error handling

Implemented reliability controls:

- Dead letter table for repeated task failures.
- Retry attempts in Celery task and output validation loop.
- Sent-attempt persistence even on delivery failure.
- Human queue deduplication to avoid stale duplicate drafts.

Design choice:

- Several non-critical integrations (sheets writeback, optional tracing) are best-effort and do not block the core audit/database persistence path.

## 13. Requirement traceability matrix (Task 2 + common requirements)

| Internship requirement | Implemented in repo |
|---|---|
| Escalation-aware follow-up flow | `models/enums.py`, `pipeline/nodes.py`, `pipeline/prompts.py` |
| Personalized email fields from source data | Prompt templates and hallucination checks |
| Trigger logic for overdue records | `tasks/invoice_tasks.py` |
| Send/mock send modes | `email/dispatcher.py` |
| Audit logging | `db/tables.py`, `pipeline/write_audit_node` |
| Human review gate | `api/human_queue.py`, frontend review queue page |
| Technical stack + decision disclosure | `README.md`, this document |
| Prompt design disclosure | `README.md`, this document |
| Security risk mitigation disclosure | `README.md`, this document |

## 14. Known limitations and hardening backlog

1. Add explicit route-level rate-limit decorators for protected API endpoints.
2. Replace simple API key comparison with constant-time compare utility.
3. Add automated tests for pipeline edge cases and queue actions.
4. Add stronger structured audit for config changes and login attempts.
5. Add optional PII masking for exports and UI views where required.

## 15. Quick file map for reviewers

| Concern | File(s) to inspect first |
|---|---|
| App boot and router registration | `backend/app/main.py` |
| Runtime config | `backend/app/config.py` |
| Graph definition | `backend/app/pipeline/graph.py` |
| Node logic and routing decisions | `backend/app/pipeline/nodes.py` |
| Prompt design | `backend/app/pipeline/prompts.py` |
| LLM adapter | `backend/app/llm/gateway.py` |
| Email dispatch | `backend/app/email/dispatcher.py` |
| DB schema | `backend/app/db/tables.py` |
| API contracts | `backend/app/api/*.py` |
| Frontend API integration | `frontend/lib/api.ts` |
| Frontend routes | `frontend/app/**/page.tsx` |

