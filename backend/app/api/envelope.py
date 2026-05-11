from typing import Any, Optional

from pydantic import BaseModel


class Envelope(BaseModel):
    success: bool = True
    data: Any = None
    error: Optional[str] = None


def ok(data: Any = None) -> Envelope:
    return Envelope(success=True, data=data)


def fail(message: str) -> Envelope:
    return Envelope(success=False, error=message)
