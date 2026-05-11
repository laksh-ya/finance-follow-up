# SETUP_REAL — going from MOCK_MODE to a fully real deployment

This guide walks you through getting **real credentials for every external service**, all on free tiers, then turning the mock toggles off. Total time: ~30 minutes for the core path (LLM + email + Redis), ~60 minutes for the full stack with deployment.

The system was designed so each service is independently togglable — you can turn on the LLM today, email tomorrow, real Redis next week. Every section here ends with a one-line `.env` change and a verification step.

---

## Quick path (10 minutes — local, real LLM, sandbox email, no queue)

If you only have 10 minutes, do **just** Sections 1, 3a, and 4. You'll have:
- Real Groq Llama 3.1 generating personalised emails
- Mailtrap sandbox catching every email so you can review them safely
- Local SQLite + in-process Celery (no Redis needed)

That alone is enough for the demo recording requirement in the task brief.

---

## Service map (what you'll set up)

| # | Service | Purpose | Free tier | Required for |
|---|---|---|---|---|
| 1 | **Groq** | LLM (Llama 3.1 8B / 70B) | Generous, no card | Real email generation |
| 2 | **Resend** | Email sending (live) | 3,000/mo | Sending to real recipients |
| 3 | **Mailtrap** | Email sandbox SMTP | Forever | Safe demos / dev |
| 4 | **Upstash** | Redis broker (serverless) | 10k cmds/day | Real Celery queue |
| 5 | **Supabase / Neon** | Postgres (optional) | 500 MB | Production DB |
| 6 | **Langfuse** | LLM tracing | 50k events/mo | Observability |
| 7 | **Google Sheets** | Spreadsheet ingestion | Free | Sheets sync |
| 8 | **Render / Vercel** | Hosting | Free | Online deployment |

Each section below is self-contained — skip what you don't need.

---

## 1. LLM — Groq (recommended)

**Why Groq:** fastest free-tier inference (~1s/email), supports JSON output mode (matches our `GeneratedEmail` schema), no credit card.

### 1.1 Get the key
1. Go to **https://console.groq.com/keys**
2. Sign up with Google / GitHub
3. Click **Create API Key** → copy the `gsk_...` value

### 1.2 Apply to `.env`
```bash
MOCK_MODE=false
LLM__PROVIDER=groq
LLM__MODEL=groq/llama-3.1-8b-instant      # or groq/llama-3.1-70b-versatile for higher quality
LLM__API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LLM__TEMPERATURE=0.3
```

### 1.3 Verify
Open the dashboard → **Settings → Test connections → LLM provider → Test**. You should see `OK · groq/llama-3.1-8b-instant · ~150 tokens` in green.

Or via curl:
```bash
curl -s -X POST -H "X-API-Key: dev-secret-key" \
  http://localhost:8000/api/diagnostics/test/llm | jq
```

### Alternative providers
| Provider | `LLM__MODEL` | Notes |
|---|---|---|
| **Gemini** | `gemini/gemini-1.5-flash-latest` | Free tier, requires Google AI Studio key |
| **OpenAI** | `openai/gpt-4o-mini` | Best quality, paid |
| **Together AI** | `together_ai/meta-llama/Llama-3.1-8B-Instruct-Turbo` | Free $1 credit |
| **Ollama (local)** | `ollama/llama3.1` | 100% offline. Set `LLM__BASE_URL=http://localhost:11434` |

The codebase routes through **LiteLLM**, so any LiteLLM-supported provider works without code changes — just edit the two env vars.

---

## 2. Email — sandbox path (Mailtrap, recommended for dev/demo)

**Why Mailtrap:** emails NEVER reach real recipients — they land in your private Mailtrap inbox where you can preview them. Perfect for testing escalation scenarios without spamming clients.

### 2.1 Get SMTP creds
1. Go to **https://mailtrap.io/inboxes** → sign up
2. Create an inbox (or use the default one)
3. Click **SMTP/POP3 → Show Credentials**
4. Copy **Username** and **Password**

### 2.2 Apply to `.env`
```bash
EMAIL_MODE=sandbox
MAILTRAP_HOST=sandbox.smtp.mailtrap.io
MAILTRAP_PORT=2525
MAILTRAP_USER=<username>
MAILTRAP_PASS=<password>
EMAIL_FROM=Finance Collections <collections@yourdomain.test>
```

### 2.3 Verify
Settings → Test connections → Email pipeline → enter any address → **Send test**. Check your Mailtrap inbox — the test email should appear within seconds.

---

## 3. Email — live path (Resend)

**Why Resend:** real deliverability, generous free tier (3,000/month, 100/day), excellent docs.

### 3.1 Get the API key
1. Go to **https://resend.com** → sign up
2. **API Keys → Create API Key** → copy the `re_...` value

### 3.2 Two send paths

**Path A — fastest (no domain setup):** use Resend's testing sender `onboarding@resend.dev`. Works only when sending to **your own verified email** (the one you signed up with). Good for the demo video.

**Path B — production:** verify your own domain.
1. Resend dashboard → **Domains → Add Domain**
2. Add the SPF, DKIM, DMARC TXT records they show in your DNS provider (Namecheap, Cloudflare, etc.)
3. Wait for green checkmarks (~5–30 min)
4. Now you can send from `anything@yourdomain.com` to anyone

### 3.3 Apply to `.env`
```bash
EMAIL_MODE=live
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=Finance Collections <onboarding@resend.dev>   # path A
# or once domain is verified:
# EMAIL_FROM=Finance Collections <collections@yourdomain.com>
```

### 3.4 Verify
Same Settings → Test connections panel. A successful send returns a `provider_message_id` from Resend (looks like `4ef9a417-...`).

---

## 4. Email — bring your own SMTP (Gmail / Zoho / ProtonMail)

If you'd rather use a personal SMTP account:

### 4.1 Gmail (with app password)
1. Enable 2-step verification on your Google account
2. **Manage your account → Security → App passwords** → create one for "Mail"
3. Apply:
```bash
EMAIL_MODE=sandbox
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=<16-char app password, no spaces>
SMTP_USE_TLS=true
EMAIL_FROM=you@gmail.com
```
**Caveat:** Gmail caps at ~500/day from a personal account. Don't use this for live collections at scale.

### 4.2 Zoho Mail (free 5-user plan)
```bash
SMTP_HOST=smtp.zoho.in        # or smtp.zoho.com depending on region
SMTP_PORT=587
SMTP_USER=you@yourbiz.com
SMTP_PASS=<password or app-password>
```

The generic SMTP block in `app/email/dispatcher.py` handles port 465 (implicit SSL), 587 (STARTTLS), and 2525 (Mailtrap-style) automatically.

---

## 5. Redis + Celery — Upstash (real queue)

When you set `CELERY_EAGER=false`, you need a real Redis broker. Upstash gives you a serverless one with TLS in 60 seconds.

### 5.1 Get the URL
1. **https://console.upstash.com** → Create database → pick a region near your backend
2. **Details** tab → copy the **Redis Connect URL** (it starts with `rediss://default:...@...upstash.io:6379`)

### 5.2 Apply to `.env`
```bash
CELERY_EAGER=false
REDIS_URL=rediss://default:AXXXXXX@xxxx-yyyy-zzzz.upstash.io:6379
```

### 5.3 Run a real worker + beat
In **two new terminals** (alongside the backend):
```bash
make worker      # processes tasks from high_priority + default + scheduler queues
make beat        # cron: 9am scan, 30min Sheets sync, 2hr dead-letter retry
```

Optional third terminal — Flower UI on http://localhost:5555:
```bash
make flower
```

### 5.4 Verify
Settings → Test connections → **Redis broker → Test**. Should return `PING → True · ~80ms`.

Or trigger a scan and watch tasks flow through Flower:
```bash
curl -s -X POST -H "X-API-Key: dev-secret-key" http://localhost:8000/api/trigger/scan
```

---

## 6. Database — Postgres on Supabase or Neon (optional)

SQLite is fine for dev and demos. For production / multi-worker setups, switch to Postgres. SQLModel handles the swap with a single env change.

### 6.1 Supabase (recommended — UI is friendlier)
1. **https://supabase.com** → New project → set a strong DB password
2. **Project Settings → Database → Connection string → URI** → copy
3. Convert it to a SQLAlchemy URL by changing `postgresql://` to `postgresql+psycopg2://`

```bash
DATABASE_URL=postgresql+psycopg2://postgres:<your-password>@db.<project>.supabase.co:5432/postgres
```

### 6.2 Neon (serverless, scales to zero)
1. **https://console.neon.tech** → create project
2. Dashboard → connection string with `?sslmode=require` appended
```bash
DATABASE_URL=postgresql+psycopg2://<user>:<pass>@ep-xxx.eu-central-1.aws.neon.tech/<dbname>?sslmode=require
```

### 6.3 Install the driver
```bash
cd backend
.venv/bin/pip install psycopg2-binary
```

Add `psycopg2-binary==2.9.10` to `backend/requirements.txt` so future installs grab it automatically.

### 6.4 Apply + restart
The `init_db()` call on backend startup creates all tables on first boot. No migrations to run for v0.

### 6.5 Verify
Hit `/health` — `database` should now read `postgresql`.

---

## 7. Langfuse — LLM tracing

Langfuse Cloud gives you per-call traces, token counts, latency, prompt versions, all in one dashboard. Free tier is 50k observations/month — plenty for development.

### 7.1 Get keys
1. **https://cloud.langfuse.com** → sign up
2. Project → **Settings → API Keys → Create new keys**
3. Copy both **public key** (`pk-lf-...`) and **secret key** (`sk-lf-...`)

### 7.2 Apply to `.env`
```bash
LANGFUSE_ENABLED=true
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxxxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxxxxxx
LANGFUSE_HOST=https://cloud.langfuse.com
```

After restart every `call_llm` node automatically wraps in a Langfuse trace tagged with `invoice_id` and `stage`.

---

## 8. Google Sheets — bidirectional sync

Use case: finance team manages invoices in a Google Sheet; the agent pulls new rows in (every 30 min via Celery Beat) and writes audit entries back to a second sheet.

### 8.1 Service account
1. **https://console.cloud.google.com/iam-admin/serviceaccounts** → Create
2. Grant role `Editor`
3. **Keys → Add key → JSON** → download (this is your `credentials.json`)
4. Place it in `backend/credentials.json`

### 8.2 Enable Sheets API
**APIs & Services → Library → Google Sheets API → Enable**

### 8.3 Create the sheets
- **Invoices sheet:** columns must match the sample CSV (`invoice_id, client_name, client_email, amount, currency, due_date, payment_link, notes`)
- **Audit sheet:** any blank sheet — schema will be appended row by row

### 8.4 Share both sheets
Open each sheet → Share → add the **service account email** (looks like `xxx@xxx.iam.gserviceaccount.com`) with **Editor** access.

### 8.5 Apply to `.env`
```bash
SHEETS_ENABLED=true
SHEETS_CREDENTIALS_PATH=credentials.json
SHEETS_INVOICE_ID=<sheet ID from URL after /d/>
SHEETS_AUDIT_ID=<other sheet ID>
```

### 8.6 Verify
Settings → Sheets → **Sync now** should report `synced: <n>`. Or directly:
```bash
curl -s -X POST -H "X-API-Key: dev-secret-key" \
  http://localhost:8000/api/diagnostics/test/sheets | jq
```

---

## 9. Production deployment — Render + Vercel (free tier)

### 9.1 Backend on Render
1. Push the repo to GitHub
2. **render.com** → New → **Web Service** → connect repo → root directory `backend`
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Environment variables → paste everything from your `.env` (skip `NEXT_PUBLIC_*`)
6. Add **CORS_ORIGINS** = `https://<your-frontend>.vercel.app`

### 9.2 Worker + beat as separate Render services
Repeat 9.1 twice as **Background Workers** (instead of Web Service):
- Worker start cmd: `celery -A app.tasks.celery_app worker -Q high_priority,default,scheduler -c 4 --loglevel=info`
- Beat start cmd: `celery -A app.tasks.celery_app beat --loglevel=info`

Both share the backend's env block.

### 9.3 Frontend on Vercel
1. **vercel.com** → import repo → root directory `frontend`
2. Environment variables:
   - `NEXT_PUBLIC_API_URL=https://<your-backend>.onrender.com`
   - `NEXT_PUBLIC_API_KEY=<your real API_KEY>`
3. Deploy.

### 9.4 Lock down API_KEY
Generate a strong key (`openssl rand -hex 32`), set `API_KEY` on the backend env and `NEXT_PUBLIC_API_KEY` on the frontend env to the same value, set `DEMO_MODE=false`. Now every API call requires the key.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| LLM test returns "FAIL: …401 Unauthorized" | Wrong `LLM__API_KEY` | Re-copy the key, no quotes/spaces |
| Email test "FAIL: SMTP credentials missing" | Mailtrap user/pass not set | Set `MAILTRAP_USER` + `MAILTRAP_PASS` |
| Email test "FAIL: 535 Authentication failed" | Gmail rejecting normal password | Use **app password**, not your account password |
| Resend send "FAIL: 403 The from address is not allowed" | Domain not verified | Use `onboarding@resend.dev` for testing OR verify domain |
| Redis test "FAIL: timeout" | Wrong URL or Upstash region down | Use the `rediss://` URL (with double-s) |
| Worker not picking up tasks | `CELERY_EAGER=true` still set | Set `CELERY_EAGER=false` and restart worker |
| Sheets test "FAIL: 403" | Sheet not shared with service account | Re-share with the service-account email as Editor |
| Tasks running but no audit entries | Backend started before `init_db` ran | Restart backend; `init_db` runs in startup hook |
| Frontend shows "API offline" | Backend down or CORS misconfigured | Check `CORS_ORIGINS` includes the frontend URL |
| `DetachedInstanceError` after upgrade | Old code path; should be fixed | Pull latest `app/db/database.py` (uses `expire_on_commit=False`) |

---

## 11. Recommended `.env` for the **demo recording**

Minimum config that gives you a believable end-to-end run without spamming anyone:

```bash
# core
MOCK_MODE=false
DEMO_MODE=true
HUMAN_IN_LOOP=true
AUTO_DISPATCH=true

# real LLM
LLM__PROVIDER=groq
LLM__MODEL=groq/llama-3.1-8b-instant
LLM__API_KEY=gsk_<yours>
LLM__CONFIDENCE_THRESHOLD=0.75

# safe email (Mailtrap sandbox catches everything)
EMAIL_MODE=sandbox
MAILTRAP_HOST=sandbox.smtp.mailtrap.io
MAILTRAP_PORT=2525
MAILTRAP_USER=<yours>
MAILTRAP_PASS=<yours>
EMAIL_FROM=Finance Collections <collections@example.com>

# in-process queue (no Redis required for the recording)
CELERY_EAGER=true
REDIS_URL=redis://localhost:6379/0
DATABASE_URL=sqlite:///./data/finance.db

# tracing for the slide deck screenshots
LANGFUSE_ENABLED=true
LANGFUSE_PUBLIC_KEY=pk-lf-<yours>
LANGFUSE_SECRET_KEY=sk-lf-<yours>
```

This is the configuration the screen-record demo was tested against — you'll see real Groq-generated emails landing in Mailtrap, full audit trail in the dashboard, Langfuse showing per-call traces.

---

## 12. Going fully production

Checklist when this stops being a demo:

- [ ] Rotate `API_KEY` to a 256-bit random hex value
- [ ] Set `DEMO_MODE=false` (auth becomes strict)
- [ ] Set `DEBUG=false`
- [ ] Lock `CORS_ORIGINS` to the exact production frontend URL
- [ ] Move from SQLite to Postgres (Section 6)
- [ ] Move from `CELERY_EAGER=true` to a real Redis (Section 5) + a worker + beat
- [ ] Verify a custom domain on Resend with SPF + DKIM + DMARC (Section 3)
- [ ] Enable Langfuse for every LLM call (Section 7)
- [ ] Enable rate limits in `.env` (`MAX_EMAILS_PER_MINUTE`, `MAX_LLM_CALLS_PER_MINUTE`)
- [ ] Set up a daily backup of the Postgres DB (Supabase has automatic backups on the free tier)
- [ ] Add the deployment URL to the README

When all 12 are checked, the system is genuinely production-ready: every email is logged in `sent_emails`, every action is in `audit_entries`, every low-confidence email goes to the human queue, every failed task lands in `dead_letter` for retry, every LLM call has a Langfuse trace.
