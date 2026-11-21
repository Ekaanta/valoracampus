"""The central SIMON agent: builds the prompt, streams the answer, runs tools in a loop."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Iterator
from zoneinfo import ZoneInfo

from sqlalchemy import select

from . import memory
from .config import settings
from .db import Conversation, Message, PendingAction, SessionLocal, log_activity, utcnow
from .llm import AllProvidersFailed, PaidApprovalRequired, router
from .tools import ToolContext, call_tool, schemas

MAX_STEPS = 6
HISTORY = 20

SYSTEM = """You are {name}, the personal AI assistant of your user, in the spirit of J.A.R.V.I.S.:
calm, competent, warm, a little witty, always loyal and honest.

Now: {now} ({tz}). User's home city: {city}.
Reply in the language the user speaks (default: {lang}). Answers are often read aloud, so keep
them natural and concise; avoid tables and long lists unless asked. Address the user by name if
you know it.

What you remember about the user:
{memories}

Rules:
- Use tools for live data (weather, prices, search, web pages). Never invent numbers or facts.
- To recall things from earlier conversations, use search_memory.
- Money, purchases, trades, bids, publishing, deleting or any irreversible step: only PREPARE it with
  the matching tool. It waits for the user's explicit confirmation. Never claim it was executed unless
  a tool result says so. Pending actions awaiting confirmation: {pending}
- If a capability is not available yet, say so honestly instead of pretending.
- Explain risks when talking about investments; you are not a licensed financial advisor."""


def _system_prompt() -> str:
    tz = ZoneInfo(settings.timezone)
    with SessionLocal() as s:
        pending = s.scalars(select(PendingAction).where(PendingAction.status == "pending")
                            .order_by(PendingAction.id.desc()).limit(5)).all()
    pending_txt = "; ".join(f"#{p.id} {p.summary}" for p in pending) or "none"
    return SYSTEM.format(name=settings.assistant_name, now=datetime.now(tz).strftime("%A %d %B %Y, %H:%M"),
                         tz=settings.timezone, city=settings.default_city, lang=settings.language,
                         memories=memory.memory_block(), pending=pending_txt)


def _history(conversation_id: int) -> list[dict]:
    with SessionLocal() as s:
        rows = s.scalars(select(Message).where(Message.conversation_id == conversation_id)
                         .order_by(Message.id.desc()).limit(HISTORY)).all()
    return [{"role": m.role, "content": m.content or "…"} for m in reversed(rows)]


def ensure_conversation(conversation_id: int | None, first_text: str) -> int:
    with SessionLocal() as s:
        conv = s.get(Conversation, conversation_id) if conversation_id else None
        if not conv:
            conv = Conversation(title=(first_text.strip()[:60] or "New conversation"))
            s.add(conv)
            s.commit()
        return conv.id


def save_message(conversation_id: int, role: str, content: str, **extra) -> int:
    with SessionLocal() as s:
        msg = Message(conversation_id=conversation_id, role=role, content=content, **extra)
        s.add(msg)
        conv = s.get(Conversation, conversation_id)
        if conv:
            conv.updated_at = utcnow()
        s.commit()
        return msg.id


def run_turn(conversation_id: int, user_text: str | None, allow_paid: bool = False) -> Iterator[dict]:
    """Streams UI events: provider, token, tool, chart/link/approval cards, paid_required, error, done."""
    turn_started = utcnow()
    if user_text is not None:
        save_message(conversation_id, "user", user_text)
    else:  # retry of the last user message (e.g. after approving a paid provider)
        with SessionLocal() as s:
            last = s.scalars(select(Message).where(Message.conversation_id == conversation_id,
                                                   Message.role == "user").order_by(Message.id.desc())).first()
        user_text = last.content if last else ""

    messages = [{"role": "system", "content": _system_prompt()}] + _history(conversation_id)
    ctx = ToolContext(conversation_id=conversation_id, user_message=user_text, turn_started_at=turn_started)
    answer, cards, provider = "", [], None

    try:
        for _ in range(MAX_STEPS):
            text_parts: list[str] = []
            calls: dict[int, dict] = {}
            for kind, item in router.stream(messages, tools=schemas(), allow_paid=allow_paid):
                if kind == "trying":
                    yield {"type": "status", "text": f"Thinking with {item.name}…"}
                    continue
                if kind == "failover":
                    yield {"type": "status", "text": f"{item.name} is busy, switching to the next AI provider…"}
                    continue
                if kind == "provider":
                    provider = item
                    yield {"type": "provider", "name": item.name, "model": item.model, "paid": item.paid}
                    continue
                if not item.choices:
                    continue
                delta = item.choices[0].delta
                if delta.content:
                    text_parts.append(delta.content)
                    yield {"type": "token", "text": delta.content}
                for tc in delta.tool_calls or []:
                    slot = calls.setdefault(tc.index if tc.index is not None else len(calls),
                                            {"id": "", "name": "", "args": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function and tc.function.name and not slot["name"]:
                        slot["name"] = tc.function.name
                    if tc.function and tc.function.arguments:
                        slot["args"] += tc.function.arguments
            answer += "".join(text_parts)
            if not calls:
                break

            tool_calls = [{"id": c["id"] or f"call_{i}", "type": "function",
                           "function": {"name": c["name"], "arguments": c["args"] or "{}"}}
                          for i, c in sorted(calls.items())]
            messages.append({"role": "assistant", "content": "".join(text_parts) or None, "tool_calls": tool_calls})
            for tc in tool_calls:
                name = tc["function"]["name"]
                yield {"type": "tool", "name": name, "status": "running"}
                try:
                    args = json.loads(tc["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                before = len(ctx.ui)
                result = call_tool(name, args, ctx)
                for card in ctx.ui[before:]:
                    cards.append(card)
                    yield card
                yield {"type": "tool", "name": name, "status": "error" if "error" in result else "done"}
                messages.append({"role": "tool", "tool_call_id": tc["id"],
                                 "content": json.dumps(result, ensure_ascii=False, default=str)[:8000]})
            if answer and not answer.endswith((" ", "\n")):
                answer += "\n\n"
                yield {"type": "token", "text": "\n\n"}
    except PaidApprovalRequired as need:
        log_activity("paid_approval_needed", need.reason, need.to_dict())
        yield {"type": "paid_required", **need.to_dict()}
        return
    except AllProvidersFailed as err:
        log_activity("llm_error", str(err))
        yield {"type": "error", "message": f"No AI provider is reachable right now. ({err})"}
        return
    except Exception as err:  # e.g. a stream that broke after the answer had started
        log_activity("llm_error", f"{type(err).__name__}: {err}")
        yield {"type": "error", "message": f"The answer was interrupted: {type(err).__name__}"}
        if not answer.strip():
            return

    answer = answer.strip()
    msg_id = save_message(conversation_id, "assistant", answer,
                          provider=provider.name if provider else None,
                          model=provider.model if provider else None,
                          meta={"cards": cards} if cards else None)
    yield {"type": "done", "message_id": msg_id, "conversation_id": conversation_id}
    # Learn from this exchange while the connection is still open. (A background thread
    # would be frozen on serverless hosts.) The UI already finished at "done".
    if answer:
        try:
            memory.extract_and_store(user_text, answer)
        except Exception as err:
            log_activity("memory_error", f"{type(err).__name__}: {err}")
