"""Long-term personal memory.

After every exchange a small background LLM call extracts durable facts
(name, preferences, projects, decisions ...) and stores them. The most recent
memories are injected into every prompt; older conversations are reachable
through the search_memory tool.
"""
from __future__ import annotations

import json
import re
import threading

from sqlalchemy import or_, select

from .db import Memory, Message, SessionLocal, log_activity, utcnow

EXTRACT_PROMPT = """You maintain the long-term memory of a personal AI assistant.

Existing memories (id: content):
{existing}

New exchange:
USER: {user}
ASSISTANT: {assistant}

Extract NEW durable facts about the user that are worth remembering for weeks or months:
name and how they want to be addressed, preferences, habits, family, work, ongoing projects,
decisions, important dates, recurring activities. Ignore small talk, one-off questions,
facts about the world, and anything already stored. If a new fact corrects or updates an
existing memory, set "replaces" to that memory id.

Answer ONLY with JSON, no other text:
{{"facts": [{{"content": "...", "category": "profile|preference|project|decision|task|other", "replaces": null}}]}}
If there is nothing new, answer {{"facts": []}}"""

CATEGORIES = {"profile", "preference", "project", "decision", "task", "other"}


def recent_memories(limit: int = 80) -> list[Memory]:
    with SessionLocal() as s:
        rows = s.scalars(select(Memory).order_by(Memory.updated_at.desc()).limit(limit)).all()
    return list(reversed(rows))


def memory_block() -> str:
    rows = recent_memories()
    if not rows:
        return "(nothing stored yet - learn about the user as you talk)"
    return "\n".join(f"- [{m.id}] {m.content} ({m.category})" for m in rows)


def add_memory(content: str, category: str = "other", source: str = "user") -> Memory:
    with SessionLocal() as s:
        m = Memory(content=content.strip(), category=category if category in CATEGORIES else "other", source=source)
        s.add(m)
        s.commit()
        return m


def search(query: str, limit: int = 8) -> dict:
    words = [w for w in re.findall(r"\w+", query.lower()) if len(w) > 2][:6] or [query.lower()]
    with SessionLocal() as s:
        mem = s.scalars(select(Memory).where(or_(*[Memory.content.ilike(f"%{w}%") for w in words]))
                        .order_by(Memory.updated_at.desc()).limit(limit)).all()
        msgs = s.scalars(select(Message).where(or_(*[Message.content.ilike(f"%{w}%") for w in words]))
                         .order_by(Message.created_at.desc()).limit(limit)).all()
    return {
        "memories": [{"id": m.id, "content": m.content, "category": m.category} for m in mem],
        "past_messages": [{"date": m.created_at.date().isoformat(), "role": m.role, "content": m.content[:400]}
                          for m in msgs],
    }


def _parse_json(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return {}
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {}


def extract_and_store(user_text: str, assistant_text: str) -> None:
    from .llm import router  # local import avoids a cycle

    existing = "\n".join(f"{m.id}: {m.content}" for m in recent_memories(120)) or "(none)"
    prompt = EXTRACT_PROMPT.format(existing=existing, user=user_text[:3000], assistant=assistant_text[:2000])
    try:
        resp, _ = router.complete([{"role": "user", "content": prompt}], temperature=0)
    except Exception:
        return  # memory extraction never uses paid providers and never breaks the chat
    facts = _parse_json(resp.choices[0].message.content or "").get("facts") or []
    saved = []
    with SessionLocal() as s:
        for f in facts[:10]:
            content = str(f.get("content", "")).strip()
            if not content:
                continue
            category = f.get("category") if f.get("category") in CATEGORIES else "other"
            target = s.get(Memory, f.get("replaces")) if isinstance(f.get("replaces"), int) else None
            if target:
                target.content, target.category, target.updated_at = content, category, utcnow()
            else:
                s.add(Memory(content=content, category=category, source="auto"))
            saved.append(content)
        s.commit()
    if saved:
        log_activity("memory", f"Learned {len(saved)} new fact(s)", {"facts": saved})


def extract_in_background(user_text: str, assistant_text: str) -> None:
    threading.Thread(target=extract_and_store, args=(user_text, assistant_text), daemon=True).start()
