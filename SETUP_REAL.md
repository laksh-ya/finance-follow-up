# Setup & Deployment Guide

Comprehensive guide covering local development, real-provider configuration, Docker Compose, and production deployment. Each section is self-contained — do only what you need.

---

## Quick Reference — What Mode Am I In?

| What you want | What to set | Time needed |
|---|---|---|
| **Just run it** (zero config) | `cp .env.example .env && make dev` | 2 min |
| **Real LLM + safe email** | Add Groq key + Mailtrap creds | 10 min |
| **Full async with queue** | Add Upstash Redis URL | 5 min |
| **Production DB** | Add Neon/Supabase Postgres URL | 5 min |
| **LLM tracing** | Add Langfuse keys | 3 min |
| **Google Sheets sync** | Service account + sheet IDs | 15 min |
| **Cloud deployment** | Render (backend) + Vercel (frontend) | 30 min |

---

## 1. Local Development Setup

### 1.1 Prerequisites

- **Python 3.11+** (3.12 recommended)
- **Node.js 18+** and **pnpm** (`npm install -g pnpm`)
- **Git**

### 1.2 First Boot

```bash
# Clone
git clone <repo-url> && cd finance-follow-up

# Configure
cp .env.example .env

# Install all dependencies
make install

# Run both servers
make dev
```

This starts:
- **Backend** at http://localhost:8000 (FastAPI + auto-reload)
- **Frontend** at http://localhost:3000 (Next.js dev server)
- **API docs** at http://localhost:8000/docs

### 1.3 Default Mode

With no changes to `.env`, the system runs in **zero-dependency mode**:

| Component | Default | Meaning |
|---|---|---|
| LLM | Mock (no `LLM__API_KEY`) | Deterministic template emails, no API calls |
| Email | `EMAIL_MODE=mock` | Logs only, no network sends |
| Queue | `CELERY_EAGER=true` | Tasks run inline in the API process |
| Database | SQLite | File at `backend/data/finance.db` |
| Sheets | Disabled | CSV upload only |
| Langfuse | Disabled | No tracing |

### 1.4 First Workflow

1. Open http://localhost:3000
2. Go to **Invoices** → click **Download Sample CSV** → Upload it
3. Click **Process All** (or select individual invoices)
4. Check **Dashboard** for KPI updates and activity feed
5. Check **Human Queue** for items requiring review
6. Check **Sent Emails** for dispatch attempts
7. Check **Audit** for full processing trail

---

## 2. Real LLM — Groq (Recommended)

Fastest free-tier inference (~1s/email). No credit card needed.

### 2.1 Get Key
1. Go to https://console.groq.com/keys
2. Sign up → **Create API Key** → copy `gsk_...`

### 2.2 Configure
```bash
# In .env:
LLM__PROVIDER=groq
LLM__MODEL=groq/llama-3.1-8b-instant
LLM__API_KEY=gsk_your_key_here
```

### 2.3 Verify
**Settings → Test Connections → LLM → Test** should show green.

Or: `make test-llm`

### 2.4 Alternative Providers

| Provider | `LLM__MODEL` | Notes |
|---|---|---|
| Gemini | `gemini/gemini-1.5-flash-latest` | Free tier, Google AI Studio key |
| OpenAI | `openai/gpt-4o-mini` | Best quality, paid |
| Together | `together_ai/meta-llama/Llama-3.1-8B-Instruct-Turbo` | Free $1 credit |
| Ollama | `ollama/llama3.1` | 100% offline. Set `LLM__BASE_URL=http://localhost:11434` |

All use LiteLLM — just change the two env vars, no code changes needed.

---

## 3. Email — Sandbox (Mailtrap)

Emails land in a private Mailtrap inbox — **never reach real recipients**. Perfect for testing.

### 3.1 Get Credentials
1. Go to https://mailtrap.io/inboxes → sign up
2. Click **SMTP/POP3 → Show Credentials**
3. Copy **Username** and **Password**

### 3.2 Configure
```bash
EMAIL_MODE=sandbox
MAILTRAP_HOST=sandbox.smtp.mailtrap.io
MAILTRAP_PORT=2525
MAILTRAP_USER=<username>
MAILTRAP_PASS=<password>
EMAIL_FROM=Finance Collections <collections@example.com>
```

### 3.3 Verify
**Settings → Test Connections → Email → Test**. Check your Mailtrap inbox.

Or: `make test-email TO=you@example.com`

---

## 4. Email — Live (Resend)

Real delivery. 3,000 emails/month free.

### 4.1 Get Key
1. Go to https://resend.com → sign up
2. **API Keys → Create** → copy `re_...`

### 4.2 Quick Test (no domain setup)
Use Resend's `onboarding@resend.dev` sender — works only to your own verified email.

```bash
EMAIL_MODE=live
RESEND_API_KEY=re_your_key_here
EMAIL_FROM=Finance Collections <onboarding@resend.dev>
```

### 4.3 Production (verified domain)
1. Resend → **Domains → Add Domain**
2. Add SPF, DKIM, DMARC DNS records → wait for green
3. Update: `EMAIL_FROM=Finance Collections <collections@yourdomain.com>`

### 4.4 Gmail / Zoho SMTP Alternative

```bash
EMAIL_MODE=sandbox
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=<16-char app password>
SMTP_USE_TLS=true
EMAIL_FROM=you@gmail.com
```

Gmail caps at ~500/day. Use app password (not regular password).

---

## 5. Redis + Celery (Real Queue)

When `CELERY_EAGER=false`, you need a real Redis broker for async task execution.

### 5.1 Option A: Upstash (serverless, free)
1. https://console.upstash.com → Create database → pick a region
2. Copy **Redis Connect URL** (`rediss://default:...@...upstash.io:6379`)

```bash
CELERY_EAGER=false
REDIS_URL=rediss://default:AXXXXXX@xxxx.upstash.io:6379
```

### 5.2 Option B: Local Docker Redis
```bash
docker compose up -d redis
CELERY_EAGER=false
REDIS_URL=redis://localhost:6379/0
```

### 5.3 Run Workers
In separate terminals:
```bash
make worker    # Processes tasks from queues
make beat      # Cron: daily scan, 30m sheets sync, 2h dead-letter retry
make flower    # Optional: Flower UI at http://localhost:5555
```

### 5.4 Verify
**Settings → Test Connections → Redis → Test** should return `PING → True`.

---

## 6. Database — PostgreSQL (Optional)

SQLite is fine for dev. Switch to Postgres for multi-worker setups or production.

### 6.1 Supabase (recommended)
1. https://supabase.com → New project → set DB password
2. **Settings → Database → Connection string → URI**
3. Change `postgresql://` to `postgresql+psycopg2://`

### 6.2 Neon (serverless)
1. https://console.neon.tech → create project
2. Copy connection string, append `?sslmode=require`

```bash
DATABASE_URL=postgresql+psycopg2://user:pass@host:5432/dbname?sslmode=require
```

### 6.3 Install Driver
```bash
cd backend && .venv/bin/pip install psycopg2-binary
```

Tables auto-create on first boot via `init_db()`.

---

## 7. Langfuse — LLM Tracing

Per-call traces with token counts, latency, prompt versions. Free 50k events/month.

### 7.1 Get Keys
1. https://cloud.langfuse.com → sign up
2. Project → **Settings → API Keys → Create**

### 7.2 Configure
```bash
LANGFUSE_ENABLED=true
LANGFUSE_PUBLIC_KEY=pk-lf-xxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxx
LANGFUSE_HOST=https://cloud.langfuse.com
```

Every `call_llm` node automatically wraps in a Langfuse trace.

---

## 8. Google Sheets — Bidirectional Sync

Finance team manages invoices in Google Sheets → agent pulls rows, processes, writes status/audit back.

### 8.1 Service Account
1. https://console.cloud.google.com/iam-admin/serviceaccounts → Create
2. **Keys → Add key → JSON** → download as `credentials.json` → place in `backend/`

### 8.2 Enable API
**APIs & Services → Library → Google Sheets API → Enable**

### 8.3 Create Sheets
- **Invoice sheet**: columns must include `invoice_id, client_name, client_email, amount, currency, due_date, payment_link, notes` (extra columns auto-added by agent)
- **Audit sheet**: any blank sheet

### 8.4 Share & Configure
Share both sheets with the service account email (Editor access).

```bash
SHEETS_ENABLED=true
SHEETS_CREDENTIALS_PATH=credentials.json
SHEETS_INVOICE_ID=<sheet ID from URL>
SHEETS_AUDIT_ID=<audit sheet ID>
```

---

## 9. Docker Compose — Full Stack

One command runs the entire stack locally:

```bash
make docker-up
```

Services started:
| Service | Port | Purpose |
|---|---|---|
| `redis` | 6379 | Message broker |
| `backend` | 8000 | FastAPI API |
| `worker` | — | Celery task worker |
| `beat` | — | Celery scheduler |
| `flower` | 5555 | Celery monitoring UI |
| `frontend` | 3000 | Next.js dashboard |

Environment: reads from `.env` in project root. Redis URL is auto-overridden to `redis://redis:6379/0` (container networking).

```bash
make docker-down    # Stop everything
```

---

## 10. Production Deployment — Render + Vercel

### 10.1 Backend on Render
1. Push repo to GitHub
2. **render.com** → New → **Web Service** → connect repo → root directory `backend`
3. Build: `pip install -r requirements.txt`
4. Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add env vars from `.env` (skip `NEXT_PUBLIC_*`)
6. Set `CORS_ORIGINS=https://<frontend>.vercel.app`

### 10.2 Worker + Beat as Background Workers
Two additional Render services (Background Worker type), same repo/env:
- **Worker**: `celery -A app.tasks.celery_app worker -Q high_priority,default,scheduler -c 4 --loglevel=info`
- **Beat**: `celery -A app.tasks.celery_app beat --loglevel=info`

### 10.3 Frontend on Vercel
1. **vercel.com** → import repo → root directory `frontend`
2. Environment variables:
   - `NEXT_PUBLIC_API_URL=https://<backend>.onrender.com`
   - `NEXT_PUBLIC_API_KEY=<your API key>`

### 10.4 Security Checklist
- [ ] `API_KEY` → `openssl rand -hex 32` (strong random)
- [ ] `DEBUG=false`
- [ ] `CORS_ORIGINS` → exact production frontend URL only
- [ ] PostgreSQL instead of SQLite
- [ ] `CELERY_EAGER=false` with real Redis
- [ ] Verified domain on Resend (SPF + DKIM + DMARC)
- [ ] Langfuse enabled for every LLM call
- [ ] Daily DB backups (Supabase has automatic backups)

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| LLM test → "401 Unauthorized" | Wrong `LLM__API_KEY` | Re-copy key, no quotes/spaces |
| Email test → "SMTP credentials missing" | Mailtrap creds not set | Set `MAILTRAP_USER` + `MAILTRAP_PASS` |
| Email test → "535 Authentication failed" | Gmail normal password | Use **app password** |
| Resend → "403 from address not allowed" | Domain not verified | Use `onboarding@resend.dev` for testing |
| Redis test → "timeout" | Wrong URL or TLS issue | Use `rediss://` (double-s) for Upstash |
| Worker not picking up tasks | Eager mode still on | Set `CELERY_EAGER=false`, restart worker |
| Sheets test → "403" | Sheet not shared | Re-share with service account email |
| Frontend → "API offline" | Backend down or CORS | Check `CORS_ORIGINS` includes frontend URL |
| `DetachedInstanceError` | Old code path | Pull latest (uses `expire_on_commit=False`) |

---

## 12. Recommended `.env` for Demo Recording

Minimum config for a believable end-to-end demo without spamming anyone:

```bash
# App
APP_NAME="Finance Collections Agent"
DEBUG=false
API_KEY=dev-secret-key
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Controls
DATA_SOURCE=csv
HUMAN_IN_LOOP=true
AUTO_DISPATCH=true

# Real LLM
LLM__PROVIDER=groq
LLM__MODEL=groq/llama-3.1-8b-instant
LLM__API_KEY=gsk_<yours>
LLM__CONFIDENCE_THRESHOLD=0.75

# Safe email (Mailtrap catches everything)
EMAIL_MODE=sandbox
MAILTRAP_HOST=sandbox.smtp.mailtrap.io
MAILTRAP_PORT=2525
MAILTRAP_USER=<yours>
MAILTRAP_PASS=<yours>
EMAIL_FROM=Finance Collections <collections@example.com>

# Inline execution (no Redis needed)
CELERY_EAGER=true
DATABASE_URL=sqlite:///./data/finance.db

# Rate limits
MAX_EMAILS_PER_MINUTE=10
MAX_LLM_CALLS_PER_MINUTE=20

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_API_KEY=dev-secret-key
```

Real Groq-generated emails → safely caught in Mailtrap → full audit trail in dashboard.
