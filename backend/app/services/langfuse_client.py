"""Langfuse tracing — no-op when disabled."""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator

from app.config import get_settings

log = logging.getLogger(__name__)


@contextmanager
def trace(name: str, **metadata) -> Iterator[None]:
    s = get_settings()
    if not s.langfuse_enabled or not s.langfuse_public_key:
        yield
        return
    try:
        from langfuse import Langfuse  # type: ignore
        lf = Langfuse(
            public_key=s.langfuse_public_key,
            secret_key=s.langfuse_secret_key,
            host=s.langfuse_host,
        )
        t = lf.trace(name=name, metadata=metadata)
        try:
            yield
        finally:
            t.update(output={"status": "ok"})
    except Exception:
        log.exception("langfuse trace failed; continuing")
        yield
