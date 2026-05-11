"""SQLModel engine + session factory."""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from app.config import get_settings

_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        settings = get_settings()
        url = settings.database_url
        if url.startswith("sqlite"):
            # ensure ./data dir exists
            path_part = url.split(":///", 1)[-1]
            dir_name = os.path.dirname(path_part)
            if dir_name:
                os.makedirs(dir_name, exist_ok=True)
        _engine = create_engine(url, echo=False, connect_args={"check_same_thread": False} if url.startswith("sqlite") else {})
    return _engine


def init_db() -> None:
    # import tables so SQLModel knows about them
    from app.db import tables  # noqa: F401
    SQLModel.metadata.create_all(get_engine())


@contextmanager
def db_session() -> Iterator[Session]:
    # expire_on_commit=False keeps attributes loaded after commit/close so
    # callers can read fields off returned ORM rows without re-attaching.
    session = Session(get_engine(), expire_on_commit=False)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
