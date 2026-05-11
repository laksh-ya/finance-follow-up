"""Celery app. Runs eagerly when CELERY_EAGER=true (no worker needed)."""
from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.config import get_settings

settings = get_settings()

# Clean the redis URL for Celery — Upstash TLS needs special handling
_broker_url = settings.redis_url.split("?")[0] if "?" in settings.redis_url else settings.redis_url

celery = Celery(
    "finance_agent",
    broker=_broker_url,
    backend=_broker_url,
    include=["app.tasks.invoice_tasks"],
)

# Handle Upstash TLS
if _broker_url.startswith("rediss://"):
    celery.conf.broker_use_ssl = {"ssl_cert_reqs": 0}  # CERT_NONE
    celery.conf.redis_backend_use_ssl = {"ssl_cert_reqs": 0}

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_routes={
        "tasks.process_invoice": {"queue": "default"},
        "tasks.scan_and_enqueue": {"queue": "scheduler"},
        "tasks.retry_dead_letter": {"queue": "scheduler"},
        "tasks.sync_google_sheets": {"queue": "scheduler"},
    },
    task_annotations={
        "tasks.send_email": {"rate_limit": f"{settings.max_emails_per_minute}/m"},
        "tasks.call_llm": {"rate_limit": f"{settings.max_llm_calls_per_minute}/m"},
    },
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Eager mode — runs tasks synchronously in the calling process.
    # Zero infra needed for MOCK demos.
    task_always_eager=settings.celery_eager,
    task_eager_propagates=True,
    beat_schedule={
        "daily-invoice-scan": {
            "task": "tasks.scan_and_enqueue",
            "schedule": crontab(hour=9, minute=0),
        },
        "sheets-sync": {
            "task": "tasks.sync_google_sheets",
            "schedule": crontab(minute="*/30"),
        },
        "dead-letter-retry": {
            "task": "tasks.retry_dead_letter",
            "schedule": crontab(hour="*/2"),
        },
    },
)
