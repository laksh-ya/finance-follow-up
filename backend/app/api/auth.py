"""API-key auth middleware."""
from __future__ import annotations

import logging

from fastapi import HTTPException, Security
from fastapi.security.api_key import APIKeyHeader

from app.config import get_settings

log = logging.getLogger(__name__)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: str | None = Security(api_key_header)) -> str:
    settings = get_settings()
    if not api_key or api_key != settings.api_key:
        # Log auth failures for the audit/observability paper trail.
        log.warning("auth_failed presented_key=%s", "***" if api_key else "<none>")
        try:
            from app.db import repos

            repos.push_activity(
                "auth_failed",
                f"Rejected request with {'no key' if not api_key else 'wrong key'}",
                level="warn",
            )
        except Exception:  # never let audit logging break auth
            pass
        raise HTTPException(status_code=403, detail="Invalid or missing X-API-Key")
    return api_key
