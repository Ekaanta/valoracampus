"""Database models. Everything SIMON knows lives here, so every device sees the same state."""
import os
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings

# Serverless functions (Vercel) are frozen between requests, so pooled connections go stale.
_pool = {"poolclass": NullPool} if os.environ.get("VERCEL") else {"pool_pre_ping": True}
engine = create_engine(settings.database_url, **_pool)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="New conversation")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # user | assistant
    content: Mapped[str] = mapped_column(Text, default="")
    provider: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # UI cards (charts, links, approvals)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Memory(Base):
    """Long-term facts about the user. Viewable, editable and deletable from the UI."""
    __tablename__ = "memories"
    id: Mapped[int] = mapped_column(primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(50), default="other")
    source: Mapped[str] = mapped_column(String(50), default="auto")  # auto | user | tool
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ActivityLog(Base):
    __tablename__ = "activity_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    kind: Mapped[str] = mapped_column(String(50))
    summary: Mapped[str] = mapped_column(Text)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class PendingAction(Base):
    """A sensitive action (money, publishing, deleting...) waiting for explicit confirmation."""
    __tablename__ = "pending_actions"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    conversation_id: Mapped[int | None] = mapped_column(nullable=True)
    tool: Mapped[str] = mapped_column(String(100))
    args: Mapped[dict] = mapped_column(JSON)
    summary: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|done|failed|rejected
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Reminder(Base):
    __tablename__ = "reminders"
    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str] = mapped_column(Text)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(20), default="scheduled")  # scheduled|fired|done|cancelled
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


def init_db() -> None:
    Base.metadata.create_all(engine)


def log_activity(kind: str, summary: str, detail: dict | None = None) -> None:
    with SessionLocal() as s:
        s.add(ActivityLog(kind=kind, summary=summary[:2000], detail=detail))
        s.commit()
