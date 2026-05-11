"""FastAPI entrypoint — wires routers, middleware, DB init."""
from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api import (
    audit,
    config_router,
    diagnostics,
    emails,
    human_queue,
    invoices,
    metrics,
    sent_emails,
    sheets,
    trigger,
)
from app.config import get_settings
from app.db.database import init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("app")

settings = get_settings()

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title=settings.app_name, version="0.2.0", docs_url="/docs", redoc_url="/redoc")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_origins = [o.strip() for o in (settings.cors_origins or "").split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=False,
)
log.info("CORS allowed origins: %s", _origins)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration_ms = int((time.time() - start) * 1000)
    log.info(
        "%s %s -> %s (%dms)",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


@app.on_event("startup")
def _startup():
    init_db()
    # Configure litellm Langfuse callbacks once at startup (thread-safe)
    if settings.langfuse_enabled:
        try:
            import litellm
            litellm.success_callback = ["langfuse"]
            litellm.failure_callback = ["langfuse"]
            log.info("Langfuse litellm callbacks enabled")
        except ImportError:
            log.warning("litellm not installed, skipping Langfuse callback setup")
    log.info("Data source: %s | Email: %s | LLM: %s",
             settings.data_source, settings.email_mode,
             settings.llm.model if settings.llm.api_key else "no-key")


@app.get("/health", tags=["meta"])
def health():
    s = get_settings()
    is_mock_llm = s.llm.provider == "mock" or not s.llm.api_key
    return {
        "status": "ok",
        "app": s.app_name,
        "version": "0.2.0",
        "data_source": s.data_source,
        "human_in_loop": s.human_in_loop,
        "auto_dispatch": s.auto_dispatch,
        "email_mode": s.email_mode,
        "llm": "mock" if is_mock_llm else s.llm.model,
        "sheets_enabled": s.sheets_enabled,
        "celery_eager": s.celery_eager,
        "database": s.database_url.split("://")[0],
    }


app.include_router(invoices._public_router)  # sample-csv (no auth, must come first)
app.include_router(invoices.router)
app.include_router(emails.router)
app.include_router(human_queue.router)
app.include_router(audit.router)
app.include_router(sent_emails.router)
app.include_router(metrics.router)
app.include_router(config_router.router)
app.include_router(trigger.router)
app.include_router(sheets.router)
app.include_router(diagnostics.router)
