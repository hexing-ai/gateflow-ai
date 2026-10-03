"""PostgreSQL storage and atomic task claims; no SQLite fallback."""

import os
from datetime import datetime, timezone
from contextlib import contextmanager
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy import Column, String, DateTime, JSON
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Object(Base):
    __tablename__ = "objects"
    id = Column(String, primary_key=True)
    kind = Column(String, index=True, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    data = Column(JSON, nullable=False)


_engine = None


def engine():
    global _engine
    if _engine is None:
        url = os.environ.get("DATABASE_URL")
        if not url or not url.startswith("postgresql"):
            raise RuntimeError("配置 PostgreSQL DATABASE_URL 后才能启用私人工作空间")
        _engine = create_engine(url, pool_pre_ping=True)
    return _engine


def initialize():
    Base.metadata.create_all(engine())


@contextmanager
def transaction(lock=False):
    with Session(engine()) as s:
        with s.begin():
            if lock:
                s.execute(text("SELECT pg_advisory_xact_lock(5112001)"))
            yield s


def get(s, oid, kind=None):
    obj = s.get(Object, oid)
    if obj is None or (kind and obj.kind != kind):
        return None
    return obj


def put(s, oid, kind, data):
    obj = get(s, oid)
    if obj:
        obj.data = dict(data)
    else:
        s.add(Object(id=oid, kind=kind, data=dict(data)))


def listing(s, kind):
    return s.query(Object).filter_by(kind=kind).order_by(Object.created_at.desc()).all()
