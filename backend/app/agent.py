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
{lang_rule} Answers are often read aloud, so keep them natural and concise; avoid tables
and long lists unless asked. Never use emojis, Markdown headings (#) or Markdown tables.
Address the user by name if you know it.{voice_rule}

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


LANG_RULES = {
    "de": ("Always answer in natural, fluent German (Hochdeutsch) as a native speaker would, even when "
           "tool results or memories are in English. Address the user formally with 'Sie' unless they "
           "ask for 'du'. Write numbers, dates and prices the German way (1.234,56 €; 24. Dezember; 14:30 Uhr)."),
    "en": "Answer in English unless the user writes in another language.",
}

TEXT = {
    "de": {"trying": "Denke mit {name} nach…", "failover": "{name} ist ausgelastet, wechsle zum nächsten KI-Anbieter…",
           "waiting": "Kurze Pause: das kostenlose Limit ist erreicht, ich versuche es in {s} Sekunden erneut…",
           "limit": "Das kostenlose Limit ist gerade erreicht. Bitte versuchen Sie es in {s} Sekunden noch einmal.",
           "none": "Gerade ist kein KI-Anbieter erreichbar. Bitte versuchen Sie es gleich noch einmal.",
           "broken": "Die Antwort wurde unterbrochen. Bitte versuchen Sie es noch einmal."},
    "en": {"trying": "Thinking with {name}…", "failover": "{name} is busy, switching to the next AI provider…",
           "waiting": "Short pause: the free limit is reached, trying again in {s} seconds…",
           "limit": "The free usage limit is reached for the moment. Please try again in {s} seconds.",
           "none": "No AI provider is reachable right now. Please try again in a moment.",
           "broken": "The answer was interrupted. Please try again."},
}


VOICE_RULE = ("\n\nThe user asked by voice and will HEAR your answer: reply in at most three short spoken "
              "sentences, with no lists, then offer more detail if it would help. Talk like a calm, warm person "
              "in a real conversation: natural everyday phrasing, varied sentence length, no formal report "
              "style, and round numbers the way people say them (\"about fifty-five thousand euros\").")


def _system_prompt(lang: str, spoken: bool = False) -> str:
    tz = ZoneInfo(settings.timezone)
    with SessionLocal() as s:
        pending = s.scalars(select(PendingAction).where(PendingAction.status == "pending")
                            .order_by(PendingAction.id.desc()).limit(5)).all()
    pending_txt = "; ".join(f"#{p.id} {p.summary}" for p in pending) or "none"
    return SYSTEM.format(name=settings.assistant_name, now=datetime.now(tz).strftime("%A %d %B %Y, %H:%M"),
                         tz=settings.timezone, city=settings.default_city, lang_rule=LANG_RULES[lang], voice_rule=VOICE_RULE if spoken else "",
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


def run_turn(conversation_id: int, user_text: str | None, allow_paid: bool = False,
             language: str | None = None, spoken: bool = False) -> Iterator[dict]:
    """Streams UI events: provider, token, tool, chart/link/approval cards, paid_required, error, done."""
    lang = settings.lang(language)
    say = TEXT[lang]
    turn_started = utcnow()
    if user_text is not None:
        save_message(conversation_id, "user", user_text)
    else:  # retry of the last user message (e.g. after approving a paid provider)
        with SessionLocal() as s:
            last = s.scalars(select(Message).where(Message.conversation_id == conversation_id,
                                                   Message.role == "user").order_by(Message.id.desc())).first()
        user_text = last.content if last else ""

    messages = [{"role": "system", "content": _system_prompt(lang, spoken)}] + _history(conversation_id)
    ctx = ToolContext(conversation_id=conversation_id, user_message=user_text, turn_started_at=turn_started,
                      language=lang)
    answer, cards, provider = "", [], None

    try:
        for _ in range(MAX_STEPS):
            text_parts: list[str] = []
            calls: dict[int, dict] = {}
            for kind, item in router.stream(messages, tools=schemas(), allow_paid=allow_paid):
                if kind == "trying":
                    yield {"type": "status", "text": say["trying"].format(name=item.name)}
                    continue
                if kind == "failover":
                    yield {"type": "status", "text": say["failover"].format(name=item.name)}
                    continue
                if kind == "waiting":
                    yield {"type": "status", "text": say["waiting"].format(s=round(item[1]) + 1)}
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
                                 "content": json.dumps(result, ensure_ascii=False, default=str)[:5000]})
            if answer and not answer.endswith((" ", "\n")):
                answer += "\n\n"
                yield {"type": "token", "text": "\n\n"}
    except PaidApprovalRequired as need:
        log_activity("paid_approval_needed", need.reason, need.to_dict())
        yield {"type": "paid_required", **need.to_dict()}
        return
    except AllProvidersFailed as err:
        log_activity("llm_error", str(err))  # the technical details stay in the activity log
        if err.retry_after is not None:
            wait = max(1, round(err.retry_after) + 1)
            yield {"type": "error", "message": say["limit"].format(s=wait), "retry_after": wait, "retryable": True}
        else:
            yield {"type": "error", "message": say["none"], "retry_after": 0, "retryable": True}
        return
    except Exception as err:  # e.g. a stream that broke after the answer had started
        log_activity("llm_error", f"{type(err).__name__}: {err}")
        yield {"type": "error", "message": say["broken"], "retry_after": 0, "retryable": True}
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
            memory.extract_and_store(user_text, answer, lang)
        except Exception as err:
            log_activity("memory_error", f"{type(err).__name__}: {err}")
