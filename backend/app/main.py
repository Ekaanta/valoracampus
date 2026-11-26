"""SIMON HTTP API. Run locally with:  uvicorn app.main:app --reload --port 8000"""
from __future__ import annotations

import asyncio
import hmac
import json
import os
import re
import secrets
import time
from datetime import timedelta
from pathlib import Path

import edge_tts
import jwt
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import OperationalError

from . import store, tools
from . import voice as fish
from .accounts import (admin_user, check_password, claim_existing_data, create_user, current_user, hash_password,
                       issue_token, public, users_exist, valid_password)
from .agent import ensure_conversation, run_turn, save_message
from .config import settings
from .db import (ActivityLog, Conversation, Memory, Message, PendingAction, Reminder, SessionLocal, User,
                 init_db, log_activity, utcnow)
from .llm import router, test_model

app = FastAPI(title="SIMON")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
                   allow_methods=["*"], allow_headers=["*"])

@app.exception_handler(OperationalError)
async def _database_down(request, exc):
    return JSONResponse(status_code=503, content={
        "detail": "The database is not reachable. Connect a Postgres database to the project and redeploy."})


# Create tables on import: serverless platforms do not always run startup events.
try:
    init_db()
except Exception as err:  # the API still starts; /api/health reports the problem
    print(f"[SIMON] database not ready: {err}")


# ------------------------------------------------------------------ accounts
class LoginIn(BaseModel):
    username: str
    password: str


class SetupIn(BaseModel):
    username: str
    password: str
    display_name: str = ""


class PasswordIn(BaseModel):
    current: str
    new: str


@app.get("/api/config")
def public_config():
    """Tells the web app what to show first: the setup page (no account yet) or the login page."""
    return {"require_login": True, "setup_needed": not users_exist(),
            "allow_signup": bool(store.get_settings()["allow_signup"])}


@app.post("/api/auth/signup")
def signup(body: SetupIn):
    """Self sign-up from the login page: a normal user account (if the administrator allows it)."""
    if not users_exist():
        raise HTTPException(409, "Please set up the administrator first")
    if not store.get_settings()["allow_signup"]:
        raise HTTPException(403, "Sign-up is switched off. Please ask the administrator for an account.")
    user = create_user(body.username, body.password, body.display_name, role="user")
    with SessionLocal() as s:
        s.get(User, user.id).last_login_at = utcnow()
        s.commit()
    return {"token": issue_token(user), "user": public(user)}


@app.post("/api/auth/setup")
def setup(body: SetupIn):
    """Creates the first administrator. Only possible while no account exists."""
    if users_exist():
        raise HTTPException(409, "Simon is already set up. Please sign in.")
    user = create_user(body.username, body.password, body.display_name, role="admin")
    claim_existing_data(user.id)
    with SessionLocal() as s:
        s.get(User, user.id).last_login_at = utcnow()
        s.commit()
    return {"token": issue_token(user), "user": public(user)}


@app.post("/api/auth/login")
def login(body: LoginIn):
    with SessionLocal() as s:
        user = s.scalar(select(User).where(User.username == body.username.strip().lower()))
        if not user or not user.active or not check_password(body.password, user.password_hash):
            time.sleep(1)  # slows down password guessing
            raise HTTPException(401, "Wrong username or password")
        user.last_login_at = utcnow()
        s.commit()
    return {"token": issue_token(user), "user": public(user)}


@app.get("/api/auth/me")
def whoami(user: User = Depends(current_user)):
    return public(user)


@app.post("/api/auth/password")
def change_password(body: PasswordIn, user: User = Depends(current_user)):
    if not check_password(body.current, user.password_hash):
        raise HTTPException(400, "The current password is not correct")
    valid_password(body.new)
    with SessionLocal() as s:
        s.get(User, user.id).password_hash = hash_password(body.new)
        s.commit()
    return {"ok": True}


@app.get("/api/health")
def health():
    """Public setup check. Never returns secrets, only what is missing."""
    problems = []
    try:
        with SessionLocal() as s:
            s.execute(select(1))
        db = "ok"
    except Exception as err:
        db = f"error: {type(err).__name__}"
        if os.environ.get("VERCEL") and "@localhost" in settings.database_url:
            problems.append("No database connected. In Vercel open Storage, create a Neon Postgres database, "
                            "connect it to this project and redeploy.")
        else:
            problems.append("The database cannot be reached. Check DATABASE_URL.")
    providers = [p["name"] for p in router.status()]
    from .config import DATABASE_URL_SOURCE  # name of the variable only, never the value
    if not providers:
        problems.append("No AI provider configured. Add GROQ_API_KEY (and optionally GEMINI_API_KEY) "
                        "in Settings → Environment Variables and redeploy.")
    return {"ok": not problems, "database": db, "database_variable": DATABASE_URL_SOURCE,
            "ai_providers": providers, "problems": problems}


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    cfg = store.get_settings()
    return {**public(user), "assistant_name": cfg["assistant_name"], "language": cfg["language"]}


# ------------------------------------------------------------------ chat
class ChatIn(BaseModel):
    message: str | None = None
    conversation_id: int | None = None
    allow_paid: bool = False  # True only after the user approved the paid provider in the UI
    language: str | None = None  # "de" | "en": interface language of the device
    spoken: bool = False  # the answer will be read aloud: keep it short
    # The user talked over Simon's previous spoken answer: the part they heard before that ("" = nothing)
    interrupted: str | None = Field(None, max_length=8000)
    replace_last: bool = False  # the user had only paused: this question completes (replaces) their last one


def _sse(events):
    for event in events:
        yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"


@app.post("/api/chat")
def chat(body: ChatIn, user: User = Depends(current_user)):
    conv_id = ensure_conversation(body.conversation_id, body.message or "", user.id)

    def events():
        yield {"type": "conversation", "id": conv_id}
        yield from run_turn(conv_id, body.message, allow_paid=body.allow_paid, language=body.language,
                            spoken=body.spoken, user_id=user.id, user_name=user.display_name or user.username,
                            username=user.username, interrupted=body.interrupted,
                            replace_last=body.replace_last)

    return StreamingResponse(_sse(events()), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/conversations")
def conversations(user: User = Depends(current_user)):
    with SessionLocal() as s:
        rows = s.scalars(select(Conversation).where(Conversation.user_id == user.id)
                         .order_by(Conversation.updated_at.desc()).limit(100)).all()
    return [{"id": c.id, "title": c.title, "updated_at": c.updated_at} for c in rows]


@app.get("/api/conversations/{conv_id}")
def conversation(conv_id: int, user: User = Depends(current_user)):
    with SessionLocal() as s:
        conv = s.get(Conversation, conv_id)
        if not conv or conv.user_id != user.id:
            raise HTTPException(404, "Conversation not found")
    with SessionLocal() as s:
        rows = s.scalars(select(Message).where(Message.conversation_id == conv_id).order_by(Message.id)).all()
    return [{"id": m.id, "role": m.role, "content": m.content, "provider": m.provider, "model": m.model,
             "cards": (m.meta or {}).get("cards", []), "interrupted": bool((m.meta or {}).get("interrupted")),
             "created_at": m.created_at} for m in rows]


@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: int, user: User = Depends(current_user)):
    with SessionLocal() as s:
        conv = s.get(Conversation, conv_id)
        if not conv or conv.user_id != user.id:
            raise HTTPException(404, "Conversation not found")
    with SessionLocal() as s:
        s.execute(delete(Message).where(Message.conversation_id == conv_id))
        s.execute(delete(Conversation).where(Conversation.id == conv_id))
        s.commit()
    return {"deleted": True}


# ------------------------------------------------------------------ memory
class MemoryIn(BaseModel):
    content: str
    category: str = "other"


@app.get("/api/memories")
def memories(q: str = "", user: User = Depends(current_user)):
    with SessionLocal() as s:
        stmt = select(Memory).where(Memory.user_id == user.id).order_by(Memory.updated_at.desc())
        if q:
            stmt = stmt.where(Memory.content.ilike(f"%{q}%"))
        rows = s.scalars(stmt).all()
    return [{"id": m.id, "content": m.content, "category": m.category, "source": m.source,
             "updated_at": m.updated_at} for m in rows]


@app.post("/api/memories")
def add_memory(body: MemoryIn, user: User = Depends(current_user)):
    with SessionLocal() as s:
        m = Memory(content=body.content, category=body.category, source="user", user_id=user.id)
        s.add(m)
        s.commit()
        return {"id": m.id}


@app.put("/api/memories/{mem_id}")
def update_memory(mem_id: int, body: MemoryIn, user: User = Depends(current_user)):
    with SessionLocal() as s:
        m = s.get(Memory, mem_id)
        if not m or m.user_id != user.id:
            raise HTTPException(404)
        m.content, m.category, m.updated_at = body.content, body.category, utcnow()
        s.commit()
    return {"ok": True}


@app.delete("/api/memories/{mem_id}")
def delete_memory(mem_id: int, user: User = Depends(current_user)):
    with SessionLocal() as s:
        s.execute(delete(Memory).where(Memory.id == mem_id, Memory.user_id == user.id))
        s.commit()
    return {"deleted": True}


# ------------------------------------------------------------------ approvals
@app.get("/api/actions")
def actions(status: str = "pending", user: User = Depends(current_user)):
    with SessionLocal() as s:
        rows = s.scalars(select(PendingAction).where(PendingAction.status == status, PendingAction.user_id == user.id)
                         .order_by(PendingAction.id.desc()).limit(50)).all()
    return [{"id": a.id, "summary": a.summary, "tool": a.tool, "args": a.args, "status": a.status,
             "created_at": a.created_at} for a in rows]


def _record_decision(result: dict) -> dict:
    with SessionLocal() as s:
        action = s.get(PendingAction, result.get("action_id"))
        conv_id = action.conversation_id if action else None
    if conv_id:  # keep the chat history truthful for the model
        save_message(conv_id, "assistant", f"[Action #{result['action_id']} {result['status']}: {result['summary']}] "
                                           f"Result: {json.dumps(result.get('result', {}), default=str)[:500]}")
    return result


@app.post("/api/actions/{action_id}/approve")
def approve(action_id: int, user: User = Depends(current_user)):
    result = tools.execute_action(action_id, user.id)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return _record_decision(result)


@app.post("/api/actions/{action_id}/reject")
def reject(action_id: int, user: User = Depends(current_user)):
    result = tools.reject_action(action_id, user.id)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return _record_decision(result)


# ------------------------------------------------------------------ activity / providers
@app.get("/api/activity")
def activity(limit: int = 100, user: User = Depends(current_user)):
    """The user's own steps plus system events (provider switches, voice fallbacks)."""
    with SessionLocal() as s:
        rows = s.scalars(select(ActivityLog).where(or_(ActivityLog.user_id == user.id, ActivityLog.user_id.is_(None)))
                         .order_by(ActivityLog.id.desc()).limit(min(limit, 500))).all()
    return [{"id": a.id, "at": a.created_at, "kind": a.kind, "summary": a.summary, "detail": a.detail} for a in rows]


@app.get("/api/providers")
def providers(user: User = Depends(current_user)):
    return router.status()


@app.get("/api/stats")
def stats(user: User = Depends(current_user)):
    """Numbers for the dashboard (telemetry gauges and status pills) for this user."""
    uid = user.id
    with SessionLocal() as s:
        def count(model, *where):
            return s.scalar(select(func.count(model.id)).where(*where)) or 0

        mine = select(Conversation.id).where(Conversation.user_id == uid)
        kinds = dict(s.execute(select(ActivityLog.kind, func.count(ActivityLog.id))
                               .where(or_(ActivityLog.user_id == uid, ActivityLog.user_id.is_(None)))
                               .group_by(ActivityLog.kind)).all())
        by_provider = dict(s.execute(
            select(Message.provider, func.count(Message.id))
            .where(Message.role == "assistant", Message.provider.is_not(None), Message.conversation_id.in_(mine))
            .group_by(Message.provider)).all())
        last = s.scalars(select(Message).where(Message.role == "assistant", Message.provider.is_not(None),
                                               Message.conversation_id.in_(mine))
                         .order_by(Message.id.desc()).limit(1)).first()
        out = {
            "conversations": count(Conversation, Conversation.user_id == uid),
            "questions": count(Message, Message.role == "user", Message.conversation_id.in_(mine)),
            "memories": count(Memory, Memory.user_id == uid),
            "reminders": count(Reminder, Reminder.status == "scheduled", Reminder.user_id == uid),
            "pending_actions": count(PendingAction, PendingAction.status == "pending", PendingAction.user_id == uid),
            "last_provider": last.provider if last else None,
            "last_model": last.model if last else None,
        }
    paid_names = {p["name"] for p in router.status() if p["paid"]}
    answers = sum(by_provider.values())
    errors = kinds.get("llm_error", 0)
    out.update({
        "answers": answers,
        "paid_answers": sum(v for k, v in by_provider.items() if k in paid_names),
        "by_provider": by_provider,
        "tools_run": kinds.get("tool", 0),
        "switches": kinds.get("llm_failover", 0),
        "errors": errors,
        "approvals": kinds.get("approval_requested", 0),
        "reliability": round(100 * answers / (answers + errors)) if answers + errors else 100,
    })
    return out


# ------------------------------------------------------------------ reminders
@app.get("/api/reminders")
def reminders(user: User = Depends(current_user)):
    with SessionLocal() as s:
        rows = s.scalars(select(Reminder).where(Reminder.status == "scheduled", Reminder.user_id == user.id)
                         .order_by(Reminder.due_at)).all()
    return [{"id": r.id, "text": r.text, "due_at": r.due_at} for r in rows]


@app.get("/api/notifications")
def notifications(user: User = Depends(current_user)):
    """Polled by every open device of this user; returns their reminders that are due."""
    with SessionLocal() as s:
        rows = s.scalars(select(Reminder).where(Reminder.status.in_(["scheduled", "fired"]), Reminder.user_id == user.id,
                                                Reminder.due_at <= utcnow())).all()
        for r in rows:
            r.status = "fired"
        s.commit()
    return [{"id": r.id, "text": r.text, "due_at": r.due_at} for r in rows]


@app.post("/api/reminders/{rem_id}/done")
def reminder_done(rem_id: int, user: User = Depends(current_user)):
    with SessionLocal() as s:
        r = s.get(Reminder, rem_id)
        if r and r.user_id == user.id:
            r.status = "done"
            s.commit()
    return {"ok": True}


# ------------------------------------------------------------------ voice
class TTSIn(BaseModel):
    text: str
    voice: str | None = None  # an edge-tts voice name (overrides everything)
    lang: str | None = None  # picks a native voice: German text needs a German voice (no English accent)
    voice_key: str | None = None  # the voice chosen in the app, e.g. "jens" or "standard"
    speed: float | None = None  # 0.82 calm, 0.9 normal, 1.0 brisk


@app.get("/api/voices")
def voices(user: User = Depends(current_user)):
    cfg = store.get_settings()
    return {**fish.catalogue(), "default_de": cfg["voice_de"], "default_en": cfg["voice_en"],
            "default_speed": cfg["speed"]}


@app.post("/api/tts")
async def tts(body: TTSIn, user: User = Depends(current_user)):
    """German and English: Fish Audio (free model), streamed as raw PCM so playback starts at once.
    Whenever Fish is not usable: the standard voice (edge-tts) as one MP3."""
    lang = settings.lang(body.lang)
    text = fish.pronounce(body.text[:4000], lang)
    cfg = store.get_settings()  # the administrator's defaults when the device has not chosen
    choice = fish.pick(lang, body.voice_key or cfg[f"voice_{lang}"])
    speed = fish.speed_of(body.speed or cfg["speed"])
    if not body.voice and choice["fish"] and fish.fish_enabled(lang):
        opened = await fish.fish_stream(text, lang, choice["fish"], speed)
        if opened:
            client, resp = opened

            async def pcm():
                try:
                    async for chunk in resp.aiter_bytes():
                        yield chunk
                finally:
                    await resp.aclose()
                    await client.aclose()

            return StreamingResponse(pcm(), media_type="audio/pcm", headers={
                "X-Sample-Rate": str(fish.SAMPLE_RATE), "X-TTS-Engine": "fish", "Cache-Control": "no-store"})
    audio = bytearray()
    rate = f"{round((speed - 1) * 100):+d}%"  # the same pace for the standard voice
    async for chunk in edge_tts.Communicate(text, body.voice or settings.voice_for(lang), rate=rate).stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    return Response(bytes(audio), media_type="audio/mpeg", headers={"X-TTS-Engine": "edge"})


@app.post("/api/stt")
async def stt(file: UploadFile = File(...), language: str | None = Form(None), user: User = Depends(current_user)):
    """Fallback speech-to-text for browsers without built-in recognition (FreeLLMAPI or Groq Whisper)."""
    client = router.stt_client()
    if not client:
        raise HTTPException(503, "Speech-to-text needs FreeLLMAPI or a Groq key")
    data = await file.read()
    result = await asyncio.to_thread(client.audio.transcriptions.create, model=settings.stt_model,
                                     file=(file.filename or "audio.webm", data),
                                     language=settings.lang(language))
    return {"text": result.text}


# ------------------------------------------------------------------ administration
class UserIn(BaseModel):
    username: str
    password: str
    display_name: str = ""
    role: str = "user"


class UserPatch(BaseModel):
    display_name: str | None = None
    role: str | None = None
    active: bool | None = None
    password: str | None = None


def _admins_left(s, without: int) -> int:
    return s.scalar(select(func.count(User.id)).where(User.role == "admin", User.active.is_(True), User.id != without)) or 0


@app.get("/api/admin/users")
def admin_list_users(admin: User = Depends(admin_user)):
    with SessionLocal() as s:
        users = s.scalars(select(User).order_by(User.created_at)).all()
        convs = dict(s.execute(select(Conversation.user_id, func.count(Conversation.id)).group_by(Conversation.user_id)).all())
        mems = dict(s.execute(select(Memory.user_id, func.count(Memory.id)).group_by(Memory.user_id)).all())
    return [{**public(u), "conversations": convs.get(u.id, 0), "memories": mems.get(u.id, 0)} for u in users]


@app.post("/api/admin/users")
def admin_create_user(body: UserIn, admin: User = Depends(admin_user)):
    return public(create_user(body.username, body.password, body.display_name, body.role))


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, body: UserPatch, admin: User = Depends(admin_user)):
    with SessionLocal() as s:
        u = s.get(User, user_id)
        if not u:
            raise HTTPException(404, "User not found")
        losing_admin = (body.role == "user" and u.role == "admin") or (body.active is False and u.role == "admin")
        if losing_admin and _admins_left(s, u.id) == 0:
            raise HTTPException(400, "At least one active administrator must remain")
        if body.display_name is not None:
            u.display_name = body.display_name.strip()[:120] or u.username
        if body.role in ("admin", "user"):
            u.role = body.role
        if body.active is not None:
            u.active = body.active
        if body.password:
            u.password_hash = hash_password(valid_password(body.password))
        s.commit()
        return public(u)


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, admin: User = Depends(admin_user)):
    """Deletes the account and everything that belongs to it (conversations, memory, reminders)."""
    if user_id == admin.id:
        raise HTTPException(400, "You cannot delete your own account")
    with SessionLocal() as s:
        u = s.get(User, user_id)
        if not u:
            raise HTTPException(404, "User not found")
        if u.role == "admin" and _admins_left(s, u.id) == 0:
            raise HTTPException(400, "At least one active administrator must remain")
        conv_ids = select(Conversation.id).where(Conversation.user_id == user_id)
        s.execute(delete(Message).where(Message.conversation_id.in_(conv_ids)))
        for model in (Conversation, Memory, Reminder, PendingAction, ActivityLog):
            s.execute(delete(model).where(model.user_id == user_id))
        s.delete(u)
        s.commit()
    return {"deleted": True}


@app.get("/api/admin/settings")
def admin_get_settings(admin: User = Depends(admin_user)):
    return {"settings": store.get_settings(), "voices": fish.catalogue()}


@app.put("/api/admin/settings")
def admin_save_settings(body: dict, admin: User = Depends(admin_user)):
    try:
        return {"settings": store.save_settings(body), "voices": fish.catalogue()}
    except ValueError as err:
        raise HTTPException(400, str(err))


# ------------------------------------------------------------------ administration: AI models
# Ready-made entries for the "add model" form (any OpenAI-compatible service works; the key comes from its website).
MODEL_PRESETS = [
    {"id": "nvidia", "name": "NVIDIA Build", "base_url": "https://integrate.api.nvidia.com/v1",
     "model": "openai/gpt-oss-120b", "key_url": "https://build.nvidia.com", "free": True},
    {"id": "openrouter", "name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1",
     "model": "", "key_url": "https://openrouter.ai/keys", "free": True, "hint": "free models end in :free"},
    {"id": "groq", "name": "Groq", "base_url": "https://api.groq.com/openai/v1",
     "model": "openai/gpt-oss-120b", "key_url": "https://console.groq.com/keys", "free": True},
    {"id": "cerebras", "name": "Cerebras", "base_url": "https://api.cerebras.ai/v1",
     "model": "gpt-oss-120b", "key_url": "https://cloud.cerebras.ai", "free": True},
    {"id": "gemini", "name": "Google Gemini", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
     "model": "gemini-flash-latest", "key_url": "https://aistudio.google.com/apikey", "free": True},
    {"id": "mistral", "name": "Mistral", "base_url": "https://api.mistral.ai/v1",
     "model": "mistral-small-latest", "key_url": "https://console.mistral.ai/api-keys", "free": True},
    {"id": "ollama", "name": "Ollama (own server)", "base_url": "http://127.0.0.1:11434/v1",
     "model": "", "key_url": "", "free": True, "hint": "a model installed with ollama pull"},
    {"id": "lmstudio", "name": "LM Studio (own server)", "base_url": "http://127.0.0.1:1234/v1",
     "model": "", "key_url": "", "free": True, "hint": "the model loaded in LM Studio, e.g. Spark-X2.5-4B"},
    {"id": "custom", "name": "", "base_url": "", "model": "", "key_url": "", "free": True},
]


class ModelIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    base_url: str = Field(..., min_length=8, max_length=300)
    api_key: str = Field("", max_length=500)
    model: str = Field(..., min_length=1, max_length=160)
    paid: bool = False  # paid models are only used after the user approved it in the app
    first: bool = False  # try before the built-in models
    cost_note: str = Field("", max_length=120)


class ModelPatch(BaseModel):
    enabled: bool | None = None
    first: bool | None = None


class ModelTest(BaseModel):
    key: str | None = None  # an existing model ...
    base_url: str | None = None  # ... or one that is about to be added
    api_key: str = ""
    model: str | None = None


def _model_rows() -> list[dict]:
    rows = []
    for p in router.everything():
        rows.append({"key": p.key, "name": p.name, "model": p.model, "base_url": p.base_url, "paid": p.paid,
                     "custom": p.custom, "first": p.first, "enabled": router.is_on(p),
                     "key_hint": f"…{p.api_key[-4:]}" if p.custom and len(p.api_key) >= 8 else "",
                     "ok_count": p.ok_count, "fail_count": p.fail_count, "last_error": p.last_error,
                     "cooling_down": p.cooldown_until > time.time()})
    return rows


def _clean_url(url: str) -> str:
    url = url.strip().rstrip("/")
    if not re.match(r"^https?://[^\s/]+", url):
        raise HTTPException(400, "The address must start with http:// or https://")
    return url


@app.get("/api/admin/models")
def admin_models(admin: User = Depends(admin_user)):
    router.refresh(force=True)
    return {"models": _model_rows(), "presets": MODEL_PRESETS}


@app.post("/api/admin/models")
def admin_add_model(body: ModelIn, admin: User = Depends(admin_user)):
    router.refresh(force=True)
    name = body.name.strip()
    if any(p.name.lower() == name.lower() for p in router.everything()):
        raise HTTPException(409, "A model with this name exists already")
    cfg = store.get_models()
    cfg["custom"].append({"id": secrets.token_hex(4), "name": name, "base_url": _clean_url(body.base_url),
                          "api_key": body.api_key.strip(), "model": body.model.strip(), "paid": body.paid,
                          "first": body.first, "cost_note": body.cost_note.strip()})
    store.save_models(cfg)
    router.refresh(force=True)
    log_activity("admin", f"AI model added: {name} ({body.model.strip()})", user_id=admin.id)
    return {"models": _model_rows()}


@app.patch("/api/admin/models/{key}")
def admin_change_model(key: str, body: ModelPatch, admin: User = Depends(admin_user)):
    router.refresh(force=True)
    every = router.everything()
    if key not in {p.key for p in every}:
        raise HTTPException(404, "Unknown model")
    cfg = store.get_models()
    if body.enabled is not None:
        off = set(cfg["off"])
        if body.enabled:
            off.discard(key)
        else:
            off.add(key)
            if not any(p.key not in off and not p.paid for p in every):
                raise HTTPException(400, "At least one free model must stay switched on")
        cfg["off"] = sorted(off)
    if body.first is not None:
        for c in cfg["custom"]:
            if f"c:{c['id']}" == key:
                c["first"] = body.first
    store.save_models(cfg)
    router.refresh(force=True)
    return {"models": _model_rows()}


@app.delete("/api/admin/models/{key}")
def admin_delete_model(key: str, admin: User = Depends(admin_user)):
    if not key.startswith("c:"):
        raise HTTPException(400, "Models from the server configuration can only be switched off")
    cfg = store.get_models()
    left = [c for c in cfg["custom"] if f"c:{c['id']}" != key]
    if len(left) == len(cfg["custom"]):
        raise HTTPException(404, "Unknown model")
    gone = next(c for c in cfg["custom"] if f"c:{c['id']}" == key)
    store.save_models({"custom": left, "off": [k for k in cfg["off"] if k != key]})
    router.refresh(force=True)
    log_activity("admin", f"AI model removed: {gone['name']}", user_id=admin.id)
    return {"models": _model_rows()}


@app.post("/api/admin/models/test")
async def admin_test_model(body: ModelTest, admin: User = Depends(admin_user)):
    if body.key:
        p = next((p for p in router.everything() if p.key == body.key), None)
        if not p:
            raise HTTPException(404, "Unknown model")
        return await asyncio.to_thread(test_model, p.base_url, p.api_key, p.model, p.client())
    if not body.base_url or not body.model:
        raise HTTPException(400, "Address and model are needed")
    return await asyncio.to_thread(test_model, _clean_url(body.base_url), body.api_key.strip(), body.model.strip())


# ------------------------------------------------------------------ administration: voices
class VoiceIn(BaseModel):
    lang: str
    name: str = Field(..., min_length=1, max_length=30)
    fish: str = Field(..., min_length=32, max_length=300)  # the Fish Audio voice id, or its page address


@app.get("/api/admin/voices")
def admin_voices(admin: User = Depends(admin_user)):
    return {"added": store.get_custom_voices()}


@app.post("/api/admin/voices")
async def admin_add_voice(body: VoiceIn, admin: User = Depends(admin_user)):
    if body.lang not in ("de", "en"):
        raise HTTPException(400, "Language must be de or en")
    m = re.search(r"[0-9a-f]{32}", body.fish.lower())
    if not m:
        raise HTTPException(400, "Please paste the Fish Audio voice id or the address of its page")
    voice_id = m.group(0)
    if settings.fish_audio_key:  # check that the voice exists (reading the voice list costs nothing)
        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"https://api.fish.audio/model/{voice_id}",
                                 headers={"Authorization": f"Bearer {settings.fish_audio_key}"})
        if r.status_code == 404:
            raise HTTPException(400, "Fish Audio does not know this voice id")
    added = store.get_custom_voices()
    if any(v["fish"] == voice_id and v["lang"] == body.lang for v in added) or any(
            v["fish"] == voice_id for v in fish.VOICES[body.lang]):
        raise HTTPException(409, "This voice is in the list already")
    added.append({"lang": body.lang, "key": f"v{voice_id[:10]}", "name": body.name.strip(), "fish": voice_id})
    store.save_custom_voices(added)
    fish.forget_added_voices()
    log_activity("admin", f"Voice added: {body.name.strip()} ({body.lang})", user_id=admin.id)
    return {"added": added, "voices": fish.catalogue()}


@app.delete("/api/admin/voices/{key}")
def admin_delete_voice(key: str, admin: User = Depends(admin_user)):
    added = store.get_custom_voices()
    left = [v for v in added if v["key"] != key]
    if len(left) == len(added):
        raise HTTPException(404, "Unknown voice")
    store.save_custom_voices(left)
    fish.forget_added_voices()
    cfg = store.get_settings()  # a removed default voice falls back to the standard default
    reset = {k: v for k, v in (("voice_de", "jens"), ("voice_en", "jarvis")) if cfg[k] == key}
    if reset:
        store.save_settings(reset)
    return {"added": left, "voices": fish.catalogue()}


# ------------------------------------------------------------------ frontend
_dist = Path(__file__).resolve().parent.parent / settings.frontend_dist
if _dist.is_dir():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        file = (_dist / path).resolve()
        if path and file.is_file() and _dist.resolve() in file.parents:
            return FileResponse(file)
        return FileResponse(_dist / "index.html")
