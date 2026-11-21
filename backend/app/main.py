"""SIMON HTTP API. Run locally with:  uvicorn app.main:app --reload --port 8000"""
from __future__ import annotations

import asyncio
import hmac
import json
import os
import time
from datetime import timedelta
from pathlib import Path

import edge_tts
import jwt
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError

from . import tools
from .agent import ensure_conversation, run_turn, save_message
from .config import settings
from .db import (ActivityLog, Conversation, Memory, Message, PendingAction, Reminder, SessionLocal,
                 init_db, utcnow)
from .llm import router

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


# ------------------------------------------------------------------ auth
class LoginIn(BaseModel):
    password: str


def _require_configured() -> None:
    """Never run a public deployment with the built-in default password or token secret."""
    if settings.app_password in ("", "change-me") or settings.jwt_secret in ("", "change-me-too"):
        raise HTTPException(503, "Login is disabled until APP_PASSWORD and JWT_SECRET are set on the server "
                                 "(Vercel: Settings → Environment Variables, then redeploy).")


@app.post("/api/auth/login")
def login(body: LoginIn):
    _require_configured()
    if not hmac.compare_digest(body.password.encode(), settings.app_password.encode()):
        time.sleep(1)
        raise HTTPException(401, "Wrong password")
    token = jwt.encode({"sub": "owner", "exp": utcnow() + timedelta(days=30)}, settings.jwt_secret, "HS256")
    return {"token": token}


def auth(authorization: str = Header(default="")) -> None:
    if not settings.require_login:
        return
    _require_configured()
    try:
        jwt.decode(authorization.removeprefix("Bearer ").strip(), settings.jwt_secret, ["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Not logged in")


@app.get("/api/config")
def public_config():
    """Tells the web app whether to show the login page."""
    return {"require_login": settings.require_login}


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
    # Names (never values) of setup-related variables present on this deployment, to debug hosting setup.
    hints = sorted(k for k in os.environ if any(w in k.upper() for w in
                   ("DATABASE", "POSTGRES", "NEON", "PGHOST", "GROQ", "GEMINI", "OPENROUTER", "FREELLMAPI")))
    return {"ok": not problems, "database": db, "database_variable": DATABASE_URL_SOURCE,
            "ai_providers": providers, "problems": problems,
            "env_names_seen": hints, "vercel_env": os.environ.get("VERCEL_ENV")}


@app.get("/api/me", dependencies=[Depends(auth)])
def me():
    return {"assistant_name": settings.assistant_name, "language": settings.language,
            "speech_lang": {"de": "de-DE"}.get(settings.language, "en-US")}


# ------------------------------------------------------------------ chat
class ChatIn(BaseModel):
    message: str | None = None
    conversation_id: int | None = None
    allow_paid: bool = False  # True only after the user approved the paid provider in the UI


def _sse(events):
    for event in events:
        yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"


@app.post("/api/chat", dependencies=[Depends(auth)])
def chat(body: ChatIn):
    conv_id = ensure_conversation(body.conversation_id, body.message or "")

    def events():
        yield {"type": "conversation", "id": conv_id}
        yield from run_turn(conv_id, body.message, allow_paid=body.allow_paid)

    return StreamingResponse(_sse(events()), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/conversations", dependencies=[Depends(auth)])
def conversations():
    with SessionLocal() as s:
        rows = s.scalars(select(Conversation).order_by(Conversation.updated_at.desc()).limit(100)).all()
    return [{"id": c.id, "title": c.title, "updated_at": c.updated_at} for c in rows]


@app.get("/api/conversations/{conv_id}", dependencies=[Depends(auth)])
def conversation(conv_id: int):
    with SessionLocal() as s:
        rows = s.scalars(select(Message).where(Message.conversation_id == conv_id).order_by(Message.id)).all()
    return [{"id": m.id, "role": m.role, "content": m.content, "provider": m.provider, "model": m.model,
             "cards": (m.meta or {}).get("cards", []), "created_at": m.created_at} for m in rows]


@app.delete("/api/conversations/{conv_id}", dependencies=[Depends(auth)])
def delete_conversation(conv_id: int):
    with SessionLocal() as s:
        s.execute(delete(Message).where(Message.conversation_id == conv_id))
        s.execute(delete(Conversation).where(Conversation.id == conv_id))
        s.commit()
    return {"deleted": True}


# ------------------------------------------------------------------ memory
class MemoryIn(BaseModel):
    content: str
    category: str = "other"


@app.get("/api/memories", dependencies=[Depends(auth)])
def memories(q: str = ""):
    with SessionLocal() as s:
        stmt = select(Memory).order_by(Memory.updated_at.desc())
        if q:
            stmt = stmt.where(Memory.content.ilike(f"%{q}%"))
        rows = s.scalars(stmt).all()
    return [{"id": m.id, "content": m.content, "category": m.category, "source": m.source,
             "updated_at": m.updated_at} for m in rows]


@app.post("/api/memories", dependencies=[Depends(auth)])
def add_memory(body: MemoryIn):
    with SessionLocal() as s:
        m = Memory(content=body.content, category=body.category, source="user")
        s.add(m)
        s.commit()
        return {"id": m.id}


@app.put("/api/memories/{mem_id}", dependencies=[Depends(auth)])
def update_memory(mem_id: int, body: MemoryIn):
    with SessionLocal() as s:
        m = s.get(Memory, mem_id)
        if not m:
            raise HTTPException(404)
        m.content, m.category, m.updated_at = body.content, body.category, utcnow()
        s.commit()
    return {"ok": True}


@app.delete("/api/memories/{mem_id}", dependencies=[Depends(auth)])
def delete_memory(mem_id: int):
    with SessionLocal() as s:
        s.execute(delete(Memory).where(Memory.id == mem_id))
        s.commit()
    return {"deleted": True}


# ------------------------------------------------------------------ approvals
@app.get("/api/actions", dependencies=[Depends(auth)])
def actions(status: str = "pending"):
    with SessionLocal() as s:
        rows = s.scalars(select(PendingAction).where(PendingAction.status == status)
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


@app.post("/api/actions/{action_id}/approve", dependencies=[Depends(auth)])
def approve(action_id: int):
    result = tools.execute_action(action_id)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return _record_decision(result)


@app.post("/api/actions/{action_id}/reject", dependencies=[Depends(auth)])
def reject(action_id: int):
    result = tools.reject_action(action_id)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return _record_decision(result)


# ------------------------------------------------------------------ activity / providers
@app.get("/api/activity", dependencies=[Depends(auth)])
def activity(limit: int = 100):
    with SessionLocal() as s:
        rows = s.scalars(select(ActivityLog).order_by(ActivityLog.id.desc()).limit(min(limit, 500))).all()
    return [{"id": a.id, "at": a.created_at, "kind": a.kind, "summary": a.summary, "detail": a.detail} for a in rows]


@app.get("/api/providers", dependencies=[Depends(auth)])
def providers():
    return router.status()


# ------------------------------------------------------------------ reminders
@app.get("/api/reminders", dependencies=[Depends(auth)])
def reminders():
    with SessionLocal() as s:
        rows = s.scalars(select(Reminder).where(Reminder.status == "scheduled").order_by(Reminder.due_at)).all()
    return [{"id": r.id, "text": r.text, "due_at": r.due_at} for r in rows]


@app.get("/api/notifications", dependencies=[Depends(auth)])
def notifications():
    """Polled by every open device; returns reminders that are due."""
    with SessionLocal() as s:
        rows = s.scalars(select(Reminder).where(Reminder.status.in_(["scheduled", "fired"]),
                                                Reminder.due_at <= utcnow())).all()
        for r in rows:
            r.status = "fired"
        s.commit()
    return [{"id": r.id, "text": r.text, "due_at": r.due_at} for r in rows]


@app.post("/api/reminders/{rem_id}/done", dependencies=[Depends(auth)])
def reminder_done(rem_id: int):
    with SessionLocal() as s:
        r = s.get(Reminder, rem_id)
        if r:
            r.status = "done"
            s.commit()
    return {"ok": True}


# ------------------------------------------------------------------ voice
class TTSIn(BaseModel):
    text: str
    voice: str | None = None


@app.post("/api/tts", dependencies=[Depends(auth)])
async def tts(body: TTSIn):
    audio = bytearray()
    async for chunk in edge_tts.Communicate(body.text[:4000], body.voice or settings.tts_voice).stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    return Response(bytes(audio), media_type="audio/mpeg")


@app.post("/api/stt", dependencies=[Depends(auth)])
async def stt(file: UploadFile = File(...)):
    """Fallback speech-to-text for browsers without built-in recognition (FreeLLMAPI or Groq Whisper)."""
    client = router.stt_client()
    if not client:
        raise HTTPException(503, "Speech-to-text needs FreeLLMAPI or a Groq key")
    data = await file.read()
    result = await asyncio.to_thread(client.audio.transcriptions.create, model=settings.stt_model,
                                     file=(file.filename or "audio.webm", data))
    return {"text": result.text}


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
