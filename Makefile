# Finance Collections Agent — common operations
#
# Usage:  `make <target>`
# (Run from project root. macOS / Linux. Each target is a one-liner.)

.PHONY: help install dev backend frontend worker beat flower seed reset \
        test-llm test-email logs stop docker-up docker-down typecheck

help:
	@echo "Common targets:"
	@echo "  make install       Install backend + frontend deps"
	@echo "  make dev           Run backend (uvicorn --reload) + frontend (next dev) in foreground"
	@echo "  make backend       Run backend only"
	@echo "  make frontend      Run frontend only"
	@echo "  make worker        Run a Celery worker (needs Redis up)"
	@echo "  make beat          Run Celery Beat (cron)"
	@echo "  make flower        Run Flower (Celery UI on :5555)"
	@echo "  make seed          Reseed mock invoices in the local DB"
	@echo "  make reset         Wipe local SQLite + cached venvs"
	@echo "  make test-llm      Curl the LLM diagnostic endpoint"
	@echo "  make test-email    Curl the email diagnostic endpoint (TO=you@x.com)"
	@echo "  make docker-up     docker compose up (redis + backend + worker + beat + frontend)"
	@echo "  make docker-down   docker compose down"
	@echo "  make typecheck     Run pnpm tsc --noEmit"

# ---------- install ----------
install:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
	cd frontend && pnpm install

# ---------- run (foreground) ----------
dev:
	@echo "Starting backend on :8000 and frontend on :3000…"
	@trap 'kill 0' EXIT; \
		(cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload) & \
		(cd frontend && pnpm dev) & \
		wait

backend:
	cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

frontend:
	cd frontend && pnpm dev

# ---------- celery (real queue) ----------
worker:
	cd backend && .venv/bin/celery -A app.tasks.celery_app worker -Q high_priority,default,scheduler -c 4 --loglevel=info

beat:
	cd backend && .venv/bin/celery -A app.tasks.celery_app beat --loglevel=info

flower:
	cd backend && .venv/bin/celery -A app.tasks.celery_app flower --port=5555

# ---------- data ----------
seed:
	curl -s -X POST -H "X-API-Key: dev-secret-key" http://localhost:8000/api/config/seed | python3 -m json.tool

reset:
	curl -s -X POST -H "X-API-Key: dev-secret-key" http://localhost:8000/api/config/reset | python3 -m json.tool

# ---------- diagnostics ----------
test-llm:
	curl -s -X POST -H "X-API-Key: dev-secret-key" http://localhost:8000/api/diagnostics/test/llm | python3 -m json.tool

TO ?= you@example.com
test-email:
	curl -s -X POST -H "X-API-Key: dev-secret-key" -H "Content-Type: application/json" \
		-d '{"to_email":"$(TO)"}' http://localhost:8000/api/diagnostics/test/email | python3 -m json.tool

# ---------- docker ----------
docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

# ---------- misc ----------
typecheck:
	cd frontend && pnpm exec tsc --noEmit

stop:
	-pkill -f "uvicorn app.main:app"
	-pkill -f "next dev"
	-pkill -f "celery -A app.tasks.celery_app"
