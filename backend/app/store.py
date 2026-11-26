"""Settings the administrator can change in the app (stored in the database, no code changes needed).

Values that are not set fall back to the server configuration (.env / Vercel environment).
"""
from __future__ import annotations

from sqlalchemy import select

from .config import settings
from .db import SessionLocal, Setting, utcnow

LANGS = ("de", "en")
SPEEDS = (0.82, 0.9, 1.0)


def defaults() -> dict:
    return {
        "assistant_name": settings.assistant_name,  # how Simon calls himself
        "persona": "",  # extra instructions for Simon (tone, facts about the household, rules ...)
        "language": settings.lang(None),  # default language for new devices
        "city": settings.default_city,  # home city for weather and routes
        "timezone": settings.timezone,
        "voice_de": "jens",  # default voices (each device can still choose its own)
        "voice_en": "jarvis",
        "speed": 0.9,
        "allow_signup": True,  # people can create their own account on the login page
    }


MODELS_KEY = "ai_models"  # {"custom": [...], "off": [...]}: models the administrator added or switched off
VOICES_KEY = "custom_voices"  # [{"lang", "key", "name", "fish"}]: Fish Audio voices the administrator added


def _read(key: str, default):
    with SessionLocal() as s:
        row = s.get(Setting, key)
        return row.value if row else default


def _write(key: str, value) -> None:
    with SessionLocal() as s:
        row = s.get(Setting, key)
        if row:
            row.value, row.updated_at = value, utcnow()
        else:
            s.add(Setting(key=key, value=value))
        s.commit()


def get_models() -> dict:
    value = _read(MODELS_KEY, {}) or {}
    return {"custom": list(value.get("custom", [])), "off": list(value.get("off", []))}


def save_models(value: dict) -> None:
    _write(MODELS_KEY, {"custom": value.get("custom", []), "off": sorted(set(value.get("off", [])))})


def get_custom_voices() -> list:
    return list(_read(VOICES_KEY, []) or [])


def save_custom_voices(value: list) -> None:
    _write(VOICES_KEY, value)


def get_settings() -> dict:
    with SessionLocal() as s:
        stored = {r.key: r.value for r in s.scalars(select(Setting)).all() if not r.key.startswith("_")}
    base = defaults()
    return {k: stored.get(k, v) for k, v in base.items()}


def _clean(key: str, value):
    """Validates one admin-editable setting; returns the value to store or raises ValueError."""
    if key in ("assistant_name", "city"):
        value = str(value).strip()[:60]
        if not value:
            raise ValueError(f"{key} must not be empty")
        return value
    if key == "persona":
        return str(value).strip()[:4000]
    if key == "language":
        if value not in LANGS:
            raise ValueError("language must be de or en")
        return value
    if key == "timezone":
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(str(value))
        except Exception as err:
            raise ValueError(f"unknown time zone: {value}") from err
        return str(value)
    if key in ("voice_de", "voice_en"):
        from .voice import all_voices
        lang = key[-2:]
        if value not in {v["key"] for v in all_voices()[lang]}:
            raise ValueError(f"unknown voice: {value}")
        return value
    if key == "allow_signup":
        if not isinstance(value, bool):
            raise ValueError("allow_signup must be true or false")
        return value
    if key == "speed":
        value = float(value)
        if value not in SPEEDS:
            raise ValueError("speed must be 0.82, 0.9 or 1.0")
        return value
    raise ValueError(f"unknown setting: {key}")


def save_settings(patch: dict) -> dict:
    clean = {k: _clean(k, v) for k, v in patch.items()}
    with SessionLocal() as s:
        for key, value in clean.items():
            row = s.get(Setting, key)
            if row:
                row.value, row.updated_at = value, utcnow()
            else:
                s.add(Setting(key=key, value=value))
        s.commit()
    return get_settings()
