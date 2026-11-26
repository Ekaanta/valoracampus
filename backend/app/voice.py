"""Simon's German voice through Fish Audio, FREE model only, with the standard voice (edge-tts) as fallback.

Cost protection (the client's rules):
- every request sends the header  model: s2.1-pro-free  (Fish Audio bills the paid s2.1-pro when the
  header is missing or unknown, so it is fixed here and checked before sending)
- no other model, no paid fallback; on 401/402/403 Fish is paused and the standard voice is used
- keep the Fish Audio account without card or credits: then nothing can be charged at all
"""
from __future__ import annotations

import asyncio
import re
import time

import httpx

from .config import settings
from .db import log_activity

FISH_URL = "https://api.fish.audio/v1/tts"
FREE_MODEL = "s2.1-pro-free"
SAMPLE_RATE = 44100  # raw 16-bit mono PCM at full quality, played by the app while it streams in
_paused_until = 0.0

# Voices the app offers (Fish Audio voice ids). "standard" is the Microsoft voice (edge-tts) that is also the
# automatic fallback. The administrator can add more Fish Audio voices in the app (Administration -> Voices).
VOICES = {
    "de": [
        {"key": "jens", "name": "Jens", "fish": settings.fish_voice_id},  # deep, calm narrator (default)
        {"key": "thomas", "name": "Thomas", "fish": "2c96d68b356b422a8c7036e75a042112"},  # clear, younger
        {"key": "harley", "name": "Harley", "fish": "46d7f044534b48ebab8ffa26c7fc3523"},  # calm, thoughtful
        {"key": "marius", "name": "Marius", "fish": "6d94fdb513734653adb6b86356ffa9d4"},  # warm, soft
        # chosen by the client in the Fish Audio library (public community voices)
        {"key": "bao", "name": "Bao", "fish": "e891954162584409bce5cf43aebd1726"},  # clear, calm, documentary
        {"key": "ben", "name": "Ben", "fish": "9e0a50728a424b048575d286a79c42be"},  # clear, calm, educational
        {"key": "deutsch2", "name": "Deutsch 2", "fish": "96c8edd8a3a54f53b94867edaea45fe0"},  # serious, measured
        {"key": "biran", "name": "Biran", "fish": "dd0e637491664f59a0e7c89fac3c9bfa"},  # deep, calm, older
        {"key": "standard", "name": "Conrad", "fish": None},
    ],
    "en": [
        {"key": "jarvis", "name": "Jarvis", "fish": settings.fish_voice_id_en},  # calm, clear (default)
        {"key": "kyle", "name": "Kyle", "fish": "4290b0b2be9a49c2922bd7d363211e86"},  # deep, soothing
        {"key": "calm", "name": "Calm Morning", "fish": "83c11d47f0424d5b8f7312a21d716714"},  # deep, measured
        {"key": "standard", "name": "Ryan", "fish": None},
    ],
}
SPEEDS = (0.82, 0.9, 1.0)  # calm, normal, brisk
DEFAULT_SPEED = 0.9  # a little slower than the voices' natural pace


_added: tuple[float, list] = (0.0, [])


def all_voices() -> dict:
    """The built-in voices plus the Fish Audio voices the administrator added (read at most every 15 s)."""
    global _added
    if time.time() - _added[0] > 15:
        try:
            from . import store
            _added = (time.time(), store.get_custom_voices())
        except Exception:  # database not reachable: keep the last known list
            _added = (time.time(), _added[1])
    out = {lang: [v for v in voices if v["key"] != "standard"] for lang, voices in VOICES.items()}
    for v in _added[1]:
        if v.get("lang") in out:
            out[v["lang"]].append({"key": v["key"], "name": v["name"], "fish": v["fish"], "added": True})
    for lang, voices in VOICES.items():  # the standard voice always comes last
        out[lang] += [v for v in voices if v["key"] == "standard"]
    return out


def forget_added_voices() -> None:
    global _added
    _added = (0.0, _added[1])


def pick(lang: str, key: str | None) -> dict:
    """The chosen voice for a language; unknown keys get the default (the first one)."""
    voices = all_voices().get(lang) or all_voices()["de"]
    return next((v for v in voices if v["key"] == key), voices[0])


def speed_of(value: float | None) -> float:
    """The nearest allowed speed (the default when none is given)."""
    return min(SPEEDS, key=lambda s: abs(s - value)) if value else DEFAULT_SPEED


def catalogue() -> dict:
    """What the app's voice picker shows. Fish voices only work when a Fish Audio key is set."""
    fish_ok = bool(settings.fish_audio_key)
    out = {lang: [{"key": v["key"], "name": v["name"], "fish": bool(v["fish"]), "added": bool(v.get("added"))}
                  for v in voices if fish_ok or not v["fish"]] for lang, voices in all_voices().items()}
    return {**out, "speeds": list(SPEEDS), "default_speed": DEFAULT_SPEED}


# German voices read "Simon" the German way; it is an English name. Spelled as it should sound:
PRONOUNCE = {"de": [(re.compile(r"\b(?:SIMON|Simon)(s?)\b"), r"Saimen\1")]}


def pronounce(text: str, lang: str) -> str:
    for pattern, spoken in PRONOUNCE.get(lang, []):
        text = pattern.sub(spoken, text)
    return text


def fish_enabled(lang: str) -> bool:
    return lang in ("de", "en") and bool(settings.fish_audio_key) and time.time() >= _paused_until


async def fish_stream(text: str, lang: str = "de", voice: str | None = None, speed: float = DEFAULT_SPEED):
    """Opens a streaming Fish Audio request. Returns (client, response) on success, None to fall back."""
    global _paused_until
    headers = {"Authorization": f"Bearer {settings.fish_audio_key}", "model": FREE_MODEL}
    if headers["model"] != "s2.1-pro-free":  # never send anything but the free model
        return None
    voice = voice or (settings.fish_voice_id_en if lang == "en" else settings.fish_voice_id)
    body = {"text": text, "reference_id": voice, "format": "pcm", "sample_rate": SAMPLE_RATE,
            "latency": "balanced", "normalize": True, "language": lang,
            "prosody": {"speed": speed, "volume": 0}}
    client = httpx.AsyncClient(timeout=httpx.Timeout(25, connect=5))
    for attempt in (1, 2):
        try:
            resp = await client.send(client.build_request("POST", FISH_URL, json=body, headers=headers), stream=True)
        except httpx.HTTPError as err:
            log_activity("tts_fallback", f"Fish Audio not reachable ({type(err).__name__}); standard voice used")
            break
        if resp.status_code == 200:
            return client, resp
        await resp.aclose()
        if resp.status_code == 429 and attempt == 1:  # too many parallel requests: try once more
            await asyncio.sleep(0.7)
            continue
        if resp.status_code in (401, 402, 403):  # bad key or payment required: stop calling Fish for 30 min
            _paused_until = time.time() + 1800
        log_activity("tts_fallback", f"Fish Audio answered {resp.status_code}; standard voice used")
        break
    await client.aclose()
    return None
