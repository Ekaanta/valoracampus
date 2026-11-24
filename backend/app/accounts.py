"""User accounts: passwords, login tokens, the first administrator, and the request's current user.

- Passwords are stored as PBKDF2-SHA256 hashes (never in plain text).
- Login tokens are signed with JWT_SECRET; if none is configured, a random secret is generated once
  and kept in the database, so a fresh deployment works without extra settings.
- The very first account (created on the setup page) is an administrator and takes over all data
  that existed before accounts were introduced.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import timedelta

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from .config import settings
from .db import ActivityLog, Conversation, Memory, PendingAction, Reminder, SessionLocal, Setting, User, utcnow

ITERATIONS = 210_000
USERNAME = re.compile(r"^[a-z0-9._-]{3,40}$")
_secret_cache: str | None = None


# ------------------------------------------------------------------ passwords
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, expected = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


def valid_username(name: str) -> str:
    name = (name or "").strip().lower()
    if not USERNAME.match(name):
        raise HTTPException(400, "Username: 3–40 characters, letters, numbers, dot, dash or underscore")
    return name


def valid_password(password: str) -> str:
    if len(password or "") < 6:
        raise HTTPException(400, "The password needs at least 6 characters")
    return password


# ------------------------------------------------------------------ tokens
def _secret() -> str:
    global _secret_cache
    if settings.jwt_secret not in ("", "change-me-too"):
        return settings.jwt_secret
    if _secret_cache:
        return _secret_cache
    with SessionLocal() as s:
        row = s.get(Setting, "_jwt_secret")
        if not row:
            try:
                row = Setting(key="_jwt_secret", value=secrets.token_urlsafe(48))
                s.add(row)
                s.commit()
            except IntegrityError:  # another server instance created it at the same moment
                s.rollback()
                row = s.get(Setting, "_jwt_secret")
        _secret_cache = row.value
    return _secret_cache


def issue_token(user: User) -> str:
    return jwt.encode({"sub": str(user.id), "exp": utcnow() + timedelta(days=30)}, _secret(), "HS256")


def public(user: User) -> dict:
    return {"id": user.id, "username": user.username, "display_name": user.display_name or user.username,
            "role": user.role, "active": user.active, "created_at": user.created_at,
            "last_login_at": user.last_login_at}


# ------------------------------------------------------------------ the current request's user
def current_user(authorization: str = Header(default="")) -> User:
    token = authorization.removeprefix("Bearer ").strip()
    try:
        data = jwt.decode(token, _secret(), ["HS256"])
        user_id = int(data["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(401, "Not logged in")
    with SessionLocal() as s:
        user = s.get(User, user_id)
    if not user or not user.active:
        raise HTTPException(401, "Not logged in")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Only administrators can do this")
    return user


# ------------------------------------------------------------------ first administrator
def users_exist() -> bool:
    with SessionLocal() as s:
        return (s.scalar(select(func.count(User.id))) or 0) > 0


def create_user(username: str, password: str, display_name: str = "", role: str = "user") -> User:
    username = valid_username(username)
    valid_password(password)
    with SessionLocal() as s:
        if s.scalar(select(User).where(User.username == username)):
            raise HTTPException(409, "This username is already taken")
        user = User(username=username, display_name=(display_name or "").strip()[:120] or username,
                    password_hash=hash_password(password), role="admin" if role == "admin" else "user")
        s.add(user)
        s.commit()
        return user


def claim_existing_data(user_id: int) -> None:
    """Data from before accounts existed belongs to the first administrator."""
    with SessionLocal() as s:
        for model in (Conversation, Memory, PendingAction, Reminder, ActivityLog):
            s.execute(update(model).where(model.user_id.is_(None)).values(user_id=user_id))
        s.commit()
