# Finance Credit Follow-Up Email Agent

AI Enablement Internship - Task 2 submission. This project automates overdue-invoice follow-ups with escalation-aware email generation, human review controls, dispatch tracking, and auditability.

## Mandatory submission checklist (Task 2)

This section maps the internship brief requirements to artifacts in this repository.

| Mandatory item from brief | Status | Where it is covered |
|---|---|---|
| GitHub repository with source code | Included | `backend/`, `frontend/`, `docker-compose.yml`, `Makefile` |
| `.env.example` | Included | `.env.example` |
| `requirements.txt` | Included | `backend/requirements.txt` |
| `README.md` with overview, setup, architecture diagram, LLM/framework rationale, security mitigations | Included | This file (see sections below) |
| Sample output for Task 2 (emails/audit log) | Included | `sample_data/live_demo_audit.csv`, `sample_data/live_demo_invoices.csv` |
| Demo recording (3-5 min) | Add before final submission | Replace placeholder in your final submission package |
| Presentation deck (8-10 slides) | Add before final submission | Replace placeholder in your final submission package |

## Project overview

Finance teams often chase overdue invoices manually. This creates inconsistent messaging, delayed escalations, and weak traceability. This agent standardizes the workflow:

1. Ingest invoices from CSV upload or Google Sheets sync.
2. Classify each invoice by overdue age into escalation stages.
3. Generate personalized emails using an LLM with strict schema output.
4. Route risky cases (low confidence, stage 4, or 30+ day escalation) to human review.
5. Dispatch approved emails and persist a full audit trail.

## Task 2 requirement coverage

| Task 2 requirement | Implementation status | Evidence |
|---|---|---|
| Email generation with stage-appropriate tone | Implemented | `backend/app/pipeline/prompts.py`, `backend/app/llm/gateway.py` |
| Trigger logic for overdue invoices | Implemented | `backend/app/tasks/invoice_tasks.py` |
| Send or mock-send support | Implemented | `backend/app/email/dispatcher.py` (`mock`, `sandbox`, `live`) |
| Audit trail with metadata | Implemented | `backend/app/db/tables.py` (`AuditTable`, `SentEmailTable`) |
| Escalation cap after stage 4 (30+ days) | Implemented | `backend/app/pipeline/nodes.py` (`classify_stage_node`, `human_queue_node`) |
| Human-in-the-loop review | Implemented | `backend/app/api/human_queue.py`, `frontend/app/human-queue/page.tsx` |

## Tone escalation matrix (mandatory design)

| Stage | Trigger | Tone | Routing behavior |
|---|---|---|---|
| Stage 1 | 1-7 days overdue | Warm and friendly | Auto-dispatch when confidence passes threshold and auto-dispatch is enabled |
| Stage 2 | 8-14 days overdue | Polite but firm | Same as Stage 1 |
| Stage 3 | 15-21 days overdue | Formal and serious | Same as Stage 1 |
| Stage 4 | 22-30 days overdue | Stern and urgent | Always routed to human review when human-in-loop is enabled |
| Escalated | 30+ days overdue | No automatic email | Forced human queue and status escalation workflow |

## Architecture diagram (mandatory)

```text
                               +------------------------+
                               |      Next.js UI        |
                               | Dashboard / Invoices   |
                               | Queue / Sent / Audit   |
                               +-----------+------------+
                                           |
                                           | REST + X-API-Key
                                           v
+--------------------------------------------------------------------------------+
|                                FastAPI backend                                 |
|                                                                                |
|  Routers: invoices, trigger, emails, human-queue, sent-emails, audit, metrics |
|                                                                                |
|  +--------------------------- LangGraph pipeline ----------------------------+  |
|  | load_invoice -> classify_stage -> build_prompt -> call_llm              |  |
|  |        -> validate_output -> confidence_check -> (dispatch | queue)      |  |
|  |        -> write_audit                                                    |  |
|  +-------------------------------------------------------------------------+  |
|                                                                                |
|  Data/Infra integrations                                                       |
|  - SQLModel DB (SQLite by default, Postgres optional)                         |
|  - Celery + Redis (or inline eager execution)                                 |
|  - LiteLLM gateway (Groq/Gemini/OpenAI/Ollama/Together or mock)              |
|  - Email dispatcher (mock/SMTP/Resend)                                        |
|  - Google Sheets sync + writeback (optional)                                  |
|  - Langfuse tracing (optional)                                                |
+--------------------------------------------------------------------------------+
```

For deeper component and sequence details, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Mandatory technical disclosures

### LLM choice and rationale

- Framework in code: **LiteLLM 1.55.8** (`backend/requirements.txt`)
- Default provider and model in config: **Groq / `groq/llama-3.1-8b-instant`** (`.env.example`, `backend/app/config.py`)
- Why this setup:
  - Provider swapping is configuration-driven (`LLM__PROVIDER`, `LLM__MODEL`) without code changes.
  - Structured JSON mode is enforced at gateway level.
  - A deterministic mock path exists for zero-dependency demos and debugging.

### Agent framework and architecture

- Framework in code: **LangGraph 0.2.60**
- Architecture pattern: **deterministic state-machine pipeline**, not open-ended tool loop.
- State object: `InvoiceState` (`backend/app/models/langgraph_state.py`)
- Graph wiring: `backend/app/pipeline/graph.py`
- Node logic: `backend/app/pipeline/nodes.py`

### Prompt design and guardrails

Prompt registry is stage-based (`backend/app/pipeline/prompts.py`) and uses:

1. A strict system prompt with non-negotiable rules (no hallucinated fields, exact invoice field echoing).
2. Stage-specific tone requirements for Stage 1-4.
3. Explicit JSON schema target with required fields.
4. User prompt populated with structured invoice facts.

System prompt excerpt (from implementation):

```text
STRICT RULES - NEVER VIOLATE:
1. Never hallucinate or modify invoice data. Use only provided values.
2. Output only valid JSON matching the required schema.
3. Tone must match stage requirement.
4. Never threaten legal action unless stage is 4.
```

Output then passes:

1. Pydantic schema validation (`GeneratedEmail` model).
2. Cross-field hallucination checks (`check_hallucination`).
3. Retry loop with fallback template when validation repeatedly fails.

## Security risk mitigation (mandatory graded section)

| Risk in internship brief | Current mitigation in this project | Code reference |
|---|---|---|
| Prompt injection | Input sanitization on invoice fields, strict system rules, JSON-only output target, schema validation | `backend/app/models/invoice.py`, `backend/app/pipeline/prompts.py`, `backend/app/llm/gateway.py`, `backend/app/models/email_output.py` |
| Data privacy / PII | PII remains in backend DB and is only exposed through authenticated API routes; optional sandbox mode avoids real delivery | `backend/app/api/auth.py`, `backend/app/email/dispatcher.py` |
| API key handling | Secrets loaded from environment; sample placeholders in `.env.example`; frontend uses only public API URL/key values | `.env.example`, `backend/app/config.py`, `frontend/.env.local.example` |
| Hallucination / factual drift | Structured output parsing, strict Pydantic model, invoice-to-output field matching, retries, fallback template, human routing | `backend/app/models/email_output.py`, `backend/app/pipeline/nodes.py` |
| Unauthorized access | `/api/*` routes use API key dependency (`X-API-Key`) | `backend/app/api/auth.py`, router declarations in `backend/app/api/*.py` |
| Email spoofing (Task 2) | `sandbox` mode for safe testing; `live` mode via Resend supports verified-domain sender policy | `backend/app/email/dispatcher.py`, `.env.example` |

## Setup

### Prerequisites

- Python 3.12 recommended
- Node.js 18+ and `pnpm`
- Optional for full async deployment: Redis
- Optional for production-like DB: PostgreSQL

### Quick start (local, CSV mode)

```bash
cp .env.example .env

cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..

cd frontend
pnpm install
cd ..

make dev
```

Then open:

- Frontend: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`

### Real-provider setup

Use [SETUP_REAL.md](SETUP_REAL.md) to configure Groq/OpenAI/Gemini, Redis, Postgres, SMTP/Resend, Google Sheets, and Langfuse.

## Runtime controls

Behavior can be changed from **Settings UI** (`/settings`) or `/api/config`:

- `data_source`: `csv` or `sheets`
- `human_in_loop`: route risky drafts to queue
- `auto_dispatch`: send directly vs queue all
- `email_mode`: `mock`, `sandbox`, `live`
- LLM provider/model/key/threshold

Switching between `csv` and `sheets` modes resets local DB state for session isolation.

## API surface (summary)

All `/api/*` endpoints require `X-API-Key` except `/api/invoices/sample-csv`. Full schema is available at `/docs`.

| Domain | Key endpoints |
|---|---|
| Health | `GET /health`, `GET /api/diagnostics/health-deep` |
| Invoices | `GET /api/invoices`, `POST /api/invoices/upload`, `PATCH /api/invoices/{id}/status`, `GET /api/invoices/{id}/timeline`, `GET /api/invoices/export` |
| Triggering | `POST /api/trigger/scan`, `POST /api/trigger/invoice/{invoice_id}` |
| Email generation | `GET /api/emails/preview/{invoice_id}`, `POST /api/emails/regenerate/{invoice_id}` |
| Human review | `GET /api/human-queue`, `POST /api/human-queue/{queue_id}/action` |
| Audit and sent log | `GET /api/audit`, `GET /api/sent-emails`, CSV export endpoints |
| Metrics | `GET /api/metrics`, `GET /api/metrics/activity-feed`, `GET /api/metrics/dead-letter` |
| Config and mode | `GET/PATCH /api/config`, `POST /api/config/seed`, `POST /api/config/reset` |
| Sheets sync | `GET /api/sheets/status`, `POST /api/sheets/sync` |

## Frontend pages

| Route | Purpose |
|---|---|
| `/` | Dashboard metrics, stage breakdown, activity feed |
| `/invoices` | Upload/sync, process/reprocess, filter, status updates |
| `/invoices/[id]` | Per-invoice controls, regenerate, timeline |
| `/human-queue` | Human review actions: approve/edit/reject/regenerate/flag |
| `/sent` | Full sent-attempt log with email body preview |
| `/audit` | Auditable event table with filtering and export |
| `/observability` | LLM and dead-letter monitoring view |
| `/settings` | Runtime behavior and provider configuration |

## Submission sample outputs

- `sample_data/live_demo_audit.csv`: example audit records and delivery status progression.
- `sample_data/live_demo_invoices.csv`: sample invoice source data across multiple stages.
- Inline email examples are generated through pipeline runs and viewable in `/sent` and `/invoices/[id]`.

## Repository structure

```text
finance-follow-up/
|- backend/
|  |- app/
|  |  |- api/
|  |  |- db/
|  |  |- email/
|  |  |- llm/
|  |  |- models/
|  |  |- pipeline/
|  |  |- services/
|  |  `- tasks/
|  `- requirements.txt
|- frontend/
|  |- app/
|  |- components/
|  `- lib/
|- sample_data/
|- docs/
|  `- ARCHITECTURE.md
|- .env.example
|- docker-compose.yml
|- Makefile
`- SETUP_REAL.md
```

## Notes for final internship handoff

Before final submission, attach:

1. Demo video link (3-5 minutes, end-to-end flow on sample data).
2. Presentation deck link (8-10 slides covering problem, design, architecture, outcomes, learnings).

The codebase and docs in this repository are already structured to satisfy the mandatory Task 2 technical documentation requirements.
