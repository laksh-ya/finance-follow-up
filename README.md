# Finance Collections Agent

An AI-powered accounts receivable automation system that generates escalation-aware follow-up emails for overdue invoices, with human-in-the-loop review, multi-provider email dispatch, and full audit traceability.

Built with **FastAPI** · **LangGraph** · **LiteLLM** · **Celery + Redis** · **SQLModel** · **Next.js 15**

---

## What It Does

Finance teams manually chase overdue invoices — inconsistent tone, delayed escalations, no audit trail, wasted hours. This agent replaces that with a deterministic AI pipeline:

1. **Ingest** invoices from CSV upload or Google Sheets sync
2. **Classify** each invoice into escalation stages by overdue age
3. **Generate** personalized emails using any LLM with strict schema enforcement
4. **Route** risky cases (low confidence, stage 4+, or 30+ days overdue) to human reviewers
5. **Dispatch** approved emails via mock, SMTP sandbox, or live Resend delivery
6. **Audit** every action — ingestion, generation, validation, dispatch, review — immutably

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         DATA INGESTION                               │
│     CSV Upload  ·  Excel Upload  ·  Google Sheets (bidirectional)    │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                ┌─────────────▼──────────────┐
                │       FastAPI Backend       │
                │  REST API  ·  Auth (X-API-Key)                      │
                │  CORS  ·  Rate Limits  ·  Input Sanitization        │
                └─────────────┬──────────────┘
                              │
                ┌─────────────▼──────────────┐
                │   Celery + Redis Broker     │
                │  Queues: high_priority,     │
                │  default, scheduler         │
                │  Beat: daily scan, 30m      │
                │  sheets sync, 2h DLQ retry  │
                └─────────────┬──────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │  Worker(s)  │   │  Worker(s)  │   │  Worker(s)  │
    │  LangGraph  │   │  LangGraph  │   │  LangGraph  │
    │  Pipeline   │   │  Pipeline   │   │  Pipeline   │
    └──────┬──────┘   └─────────────┘   └─────────────┘
           │
    ┌──────▼──────────────────────────────────────────────────┐
    │                  LANGGRAPH PIPELINE                      │
    │                                                          │
    │  load_invoice → classify_stage → build_prompt            │
    │       → call_llm → validate_output                       │
    │           ↓              ↓                               │
    │     [retry/fallback]  confidence_check                   │
    │                          ↓          ↓                    │
    │                    dispatch_email  human_queue            │
    │                          ↓                               │
    │                     write_audit → END                     │
    └────────────┬────────────┬──────────────┬────────────────┘
                 │            │              │
          ┌──────▼──────┐ ┌──▼───────┐ ┌────▼──────┐
          │   LiteLLM   │ │  Email   │ │ Langfuse  │
          │   Gateway   │ │ Dispatch │ │  Tracing  │
          │ Groq/Gemini │ │mock/SMTP │ │ (optional)│
          │ OpenAI/     │ │  /Resend │ │           │
          │ Ollama      │ │          │ │           │
          └─────────────┘ └──────────┘ └───────────┘
                 │
          ┌──────▼─────────────────────────────────────┐
          │              DATA LAYER                     │
          │  SQLite / PostgreSQL (SQLModel)             │
          │  Tables: invoices, audit_entries,           │
          │  human_queue, sent_emails, dead_letter,     │
          │  activity_events                            │
          │  + Google Sheets writeback (optional)       │
          └──────┬─────────────────────────────────────┘
                 │
          ┌──────▼─────────────────────────────────────┐
          │           NEXT.JS 15 DASHBOARD              │
          │  Dashboard · Invoices · Human Queue         │
          │  Sent Emails · Audit Log · Observability    │
          │  Settings · Test Connections                 │
          └─────────────────────────────────────────────┘
```

For full layer-by-layer documentation, see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Tone Escalation Matrix

| Stage | Trigger | Tone | Routing |
|---|---|---|---|
| **Stage 1** | 1–7 days overdue | Warm & friendly | Auto-dispatch (if confidence passes threshold) |
| **Stage 2** | 8–14 days overdue | Polite but firm | Auto-dispatch |
| **Stage 3** | 15–21 days overdue | Formal & serious | Auto-dispatch (high-priority queue) |
| **Stage 4** | 22–30 days overdue | Stern & urgent | Always human review when HIL enabled |
| **Escalated** | 30+ days overdue | No auto email | Forced human queue · status → DISPUTED |

---

## Technical Stack

| Layer | Technology | Purpose |
|---|---|---|
| **API** | FastAPI 0.115 · Pydantic 2 · SlowAPI | REST API with schema validation, rate limiting |
| **Pipeline** | LangGraph 0.2.60 · LangChain Core | Deterministic state-machine for invoice processing |
| **LLM** | LiteLLM 1.55.8 | Provider-agnostic gateway (Groq, Gemini, OpenAI, Ollama, Together, mock) |
| **Queue** | Celery 5.4 · Redis 5.2 | Async task execution with priority queues and dead-letter retry |
| **Database** | SQLModel 0.0.22 · SQLAlchemy 2.0 | ORM with SQLite (dev) or PostgreSQL (prod) |
| **Email** | SMTP · Resend API | Three-mode dispatch: mock / sandbox (Mailtrap) / live |
| **Observability** | Langfuse 2.57 | LLM call tracing with token counts, latency, prompt versions |
| **Sheets** | gspread 6.1 | Bidirectional Google Sheets sync with auto-column management |
| **Frontend** | Next.js 15 · React 19 · Tailwind · shadcn/ui | Operator dashboard with 8 route-level pages |

### LLM Choice Rationale

- **Framework**: LiteLLM — provider switching is configuration-only (`LLM__PROVIDER`, `LLM__MODEL`), no code changes needed
- **Default**: Groq / `groq/llama-3.1-8b-instant` — fastest free-tier inference (~1s/email), JSON output mode support
- **Structured output**: JSON mode enforced at gateway level, parsed into strict Pydantic schema
- **Fallback**: Deterministic mock templates when LLM retries exhaust or no API key configured

### Agent Framework Rationale

- **Framework**: LangGraph — deterministic state-machine pipeline, not open-ended tool-use loop
- **State**: Typed `InvoiceState` dict flowing through 10 explicit nodes
- **Routing**: Conditional edges based on validation status, confidence score, and escalation stage
- **Reliability**: Bounded retry (2 attempts) → fallback template → human queue — never fails silently

---

## Prompt Design & Guardrails

The prompt system uses a **stage-based registry** with layered safety:

1. **System prompt** with 10 non-negotiable rules (no hallucination, exact field echo, JSON-only output)
2. **Stage-specific tone requirements** (warm → polite → formal → stern)
3. **Explicit JSON schema** target with required anti-hallucination fields
4. **User prompt** populated with structured invoice facts

Post-generation validation pipeline:
1. **Pydantic schema validation** — strict field types, length constraints
2. **Hallucination check** — cross-field comparison against source invoice (`invoice_id`, `client_name`, `amount`, `days_overdue`)
3. **Placeholder detection** — rejects `[INSERT`, `PLACEHOLDER`, `TBD` in generated body
4. **Retry loop** — up to 2 re-generations on validation failure
5. **Fallback template** — deterministic template when retries exhaust (always goes to human review)

---

## Security Risk Mitigation

| Risk | Mitigation | Code Reference |
|---|---|---|
| **Prompt injection** | Input field sanitization (forbidden patterns), strict system prompt constraints, JSON-only output mode, Pydantic schema + hallucination validation | `models/invoice.py`, `pipeline/prompts.py`, `llm/gateway.py`, `models/email_output.py` |
| **Data privacy / PII** | PII in backend DB behind API-key auth; email addresses masked in logs; sandbox mode prevents real delivery | `api/auth.py`, `email/dispatcher.py` |
| **API key handling** | Secrets from environment variables only; `.env.example` has placeholders; frontend uses only public vars | `.env.example`, `config.py` |
| **Hallucination** | Strict Pydantic schema, field-level mismatch checks, retry loop, deterministic fallback, human routing for low confidence | `models/email_output.py`, `pipeline/nodes.py` |
| **Unauthorized access** | `X-API-Key` header required on all `/api/*` routes; auth failures logged to activity feed | `api/auth.py`, router declarations |
| **Email spoofing** | Explicit mock/sandbox/live mode switch; live mode via Resend requires verified domain (SPF/DKIM/DMARC) | `email/dispatcher.py` |

---

## Quick Start

### Prerequisites

- Python 3.11+ (3.12 recommended)
- Node.js 18+ and `pnpm`
- Optional: Redis (for async task execution)
- Optional: PostgreSQL (for production DB)

### Install & Run (local, CSV mode, ~2 minutes)

```bash
# 1. Clone and configure
git clone <repo-url> && cd finance-follow-up
cp .env.example .env

# 2. Install dependencies
make install

# 3. Start both servers
make dev
```

Open:
- **Frontend**: http://localhost:3000
- **API docs**: http://localhost:8000/docs

### What's running in default mode

| Component | Mode | What it means |
|---|---|---|
| LLM | `mock` (no API key) | Deterministic template emails — no external calls |
| Email | `mock` | Logs only, no network sends |
| Queue | `CELERY_EAGER=true` | Tasks run inline — no Redis needed |
| Database | SQLite | File-based, zero setup |

### Going Real

See **[SETUP_REAL.md](SETUP_REAL.md)** for step-by-step credentials setup:
- LLM providers (Groq/Gemini/OpenAI/Ollama)
- Email sandbox (Mailtrap) and live (Resend)
- Redis queue (Upstash)
- PostgreSQL (Supabase/Neon)
- Langfuse tracing
- Google Sheets sync
- Production deployment (Render + Vercel)

---

## Makefile Commands

```bash
make help          # Show all available targets
make install       # Install backend + frontend dependencies
make dev           # Run backend + frontend (foreground)
make backend       # Run backend only
make frontend      # Run frontend only
make worker        # Run Celery worker (needs Redis)
make beat          # Run Celery Beat scheduler
make flower        # Run Flower monitoring UI (:5555)
make seed          # Seed mock invoices via API
make reset         # Wipe local DB via API
make test-llm      # Curl LLM diagnostic endpoint
make test-email    # Curl email diagnostic endpoint
make docker-up     # docker compose up (full stack)
make docker-down   # docker compose down
make typecheck     # Run TypeScript type check
make stop          # Kill all running services
```

---

## Docker Compose

Full multi-service stack with `docker-compose.yml`:

```bash
make docker-up     # Starts: Redis, Backend, Worker, Beat, Flower, Frontend
```

Services: `redis` (broker) · `backend` (FastAPI) · `worker` (Celery) · `beat` (scheduler) · `flower` (monitoring) · `frontend` (Next.js)

---

## Runtime Controls

Configurable from **Settings UI** (`/settings`) or `PATCH /api/config`:

| Setting | Options | Effect |
|---|---|---|
| `data_source` | `csv` · `sheets` | Invoice ingestion mode |
| `human_in_loop` | `true` · `false` | Route risky drafts to review queue |
| `auto_dispatch` | `true` · `false` | Auto-send vs queue all for review |
| `email_mode` | `mock` · `sandbox` · `live` | Email delivery mode |
| LLM settings | provider · model · key · threshold | LLM configuration |

---

## API Surface

All `/api/*` endpoints require `X-API-Key` header (except `/api/invoices/sample-csv`). Full OpenAPI schema at `/docs`.

| Domain | Key Endpoints |
|---|---|
| **Health** | `GET /health` · `GET /api/diagnostics/health-deep` |
| **Invoices** | `GET /api/invoices` · `POST /api/invoices/upload` · `PATCH /api/invoices/{id}/status` · `GET /api/invoices/{id}/timeline` · `GET /api/invoices/export` |
| **Trigger** | `POST /api/trigger/scan` · `POST /api/trigger/invoice/{invoice_id}` |
| **Email** | `GET /api/emails/preview/{invoice_id}` · `POST /api/emails/regenerate/{invoice_id}` |
| **Human Queue** | `GET /api/human-queue` · `POST /api/human-queue/{queue_id}/action` |
| **Sent Emails** | `GET /api/sent-emails` · `GET /api/sent-emails/{id}` · CSV export |
| **Audit** | `GET /api/audit` · CSV export |
| **Metrics** | `GET /api/metrics` · `GET /api/metrics/activity-feed` · `GET /api/metrics/dead-letter` |
| **Config** | `GET/PATCH /api/config` · `POST /api/config/seed` · `POST /api/config/reset` |
| **Sheets** | `GET /api/sheets/status` · `POST /api/sheets/sync` |
| **Diagnostics** | Test LLM · Test Email · Test Redis · Test Sheets |

---

## Frontend Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard — KPI metrics, stage breakdown, live activity feed |
| `/invoices` | Upload/sync, process/reprocess, filter, status management |
| `/invoices/[id]` | Per-invoice detail — regenerate, timeline, email preview |
| `/human-queue` | Review actions: approve, edit, reject, regenerate, flag |
| `/sent` | Sent email log with full body preview and delivery status |
| `/audit` | Filterable audit table with CSV export |
| `/observability` | LLM health, dead-letter queue monitoring |
| `/settings` | Runtime configuration and test connections panel |

---

## Repository Structure

```
finance-follow-up/
├── backend/
│   ├── app/
│   │   ├── api/            # FastAPI routers (invoices, trigger, emails, etc.)
│   │   ├── db/             # SQLModel tables, session factory, repository layer
│   │   ├── email/          # Dispatcher (mock / SMTP / Resend)
│   │   ├── llm/            # LiteLLM gateway + deterministic mock
│   │   ├── models/         # Pydantic DTOs (invoice, email output, audit, enums, state)
│   │   ├── pipeline/       # LangGraph graph, nodes, prompt registry
│   │   ├── services/       # Sheets sync, Langfuse client, mock seed
│   │   ├── tasks/          # Celery app + invoice processing tasks
│   │   ├── config.py       # Pydantic settings (env-driven)
│   │   └── main.py         # FastAPI entrypoint
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── app/                # Next.js route pages
│   ├── components/         # Reusable UI + domain widgets
│   ├── lib/                # API client + shared types
│   ├── Dockerfile
│   └── package.json
├── sample_data/            # Sample CSVs for demos
├── docs/
│   └── ARCHITECTURE.md     # Deep layer-wise architecture documentation
├── .env.example            # Environment template with all variables
├── docker-compose.yml      # Full multi-service stack
├── Makefile                # Common operations
└── SETUP_REAL.md           # Comprehensive setup guide (mock → production)
```

---

## Sample Outputs

- `sample_data/invoices_sample.csv` — downloadable sample invoice CSV (also served at `/api/invoices/sample-csv`)
- `sample_data/live_demo_audit.csv` — example audit records showing delivery status progression
- `sample_data/live_demo_invoices.csv` — sample invoice data across multiple escalation stages
- Generated emails are viewable in the `/sent` page and per-invoice detail views

---

## Task Requirement Coverage

| Requirement | Status | Implementation |
|---|---|---|
| Email generation with stage-appropriate tone | ✅ | `pipeline/prompts.py`, `llm/gateway.py` |
| Trigger logic for overdue invoices | ✅ | `tasks/invoice_tasks.py` |
| Send or mock-send support | ✅ | `email/dispatcher.py` (mock, sandbox, live) |
| Audit trail with metadata | ✅ | `db/tables.py` (AuditTable, SentEmailTable) |
| Escalation cap after stage 4 (30+ days) | ✅ | `pipeline/nodes.py` (classify_stage, human_queue) |
| Human-in-the-loop review | ✅ | `api/human_queue.py`, frontend queue page |
| Technical stack + rationale disclosure | ✅ | This README |
| Prompt design disclosure | ✅ | This README + `docs/ARCHITECTURE.md` |
| Security risk mitigation disclosure | ✅ | This README |
| Architecture diagram | ✅ | This README + `docs/ARCHITECTURE.md` |
| `.env.example` | ✅ | Root `.env.example` |
| `requirements.txt` | ✅ | `backend/requirements.txt` |
| Sample output (emails/audit) | ✅ | `sample_data/` |
