"""LiteLLM gateway — routes to real provider or mock based on settings.

All pipeline nodes call `LLMGateway.complete(...)` regardless of mode.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Tuple

from app.config import get_settings
from app.llm.mock import complete_mock
from app.models.email_output import GeneratedEmail

log = logging.getLogger(__name__)


class LLMGateway:
    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def is_mock(self) -> bool:
        return self.settings.llm.provider == "mock" or not self.settings.llm.api_key

    @property
    def model_info(self) -> str:
        return "mock/deterministic" if self.is_mock else self.settings.llm.model

    def complete(
        self,
        *,
        invoice_id: str,
        client_name: str,
        amount: float,
        currency: str,
        due_date: str,
        days_overdue: int,
        payment_link: str | None,
        stage: int,
        followup_count: int,
        system_prompt: str,
        user_prompt: str,
    ) -> Tuple[GeneratedEmail, int, int]:
        if self.is_mock:
            log.info("LLM[mock] invoice=%s stage=%s", invoice_id, stage)
            return complete_mock(
                invoice_id=invoice_id,
                client_name=client_name,
                amount=amount,
                currency=currency,
                due_date=due_date,
                days_overdue=days_overdue,
                payment_link=payment_link,
                stage=stage,
                followup_count=followup_count,
            )

        # Real call via LiteLLM
        import litellm

        litellm.drop_params = True

        start = time.time()
        cfg = self.settings.llm

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        kwargs = dict(
            model=cfg.model,
            messages=messages,
            api_key=cfg.api_key,
            temperature=cfg.temperature,
            max_tokens=cfg.max_tokens,
            timeout=cfg.timeout,
            response_format={"type": "json_object"},
        )
        if cfg.base_url:
            kwargs["api_base"] = cfg.base_url

        response = litellm.completion(**kwargs)
        latency_ms = int((time.time() - start) * 1000)
        tokens = getattr(response, "usage", None).total_tokens if getattr(response, "usage", None) else 0
        raw = response.choices[0].message.content  # type: ignore[attr-defined]

        # Strip markdown json code blocks if present
        clean_raw = raw.strip()
        if clean_raw.startswith("```json"):
            clean_raw = clean_raw[7:]
        elif clean_raw.startswith("```"):
            clean_raw = clean_raw[3:]
        if clean_raw.endswith("```"):
            clean_raw = clean_raw[:-3]
        clean_raw = clean_raw.strip()

        try:
            parsed = GeneratedEmail.model_validate(json.loads(clean_raw))
        except Exception as exc:
            log.error("LLM output parse failed: %s | raw=%s", exc, raw[:400])
            raise

        return parsed, tokens, latency_ms
