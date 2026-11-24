"""Simon's German voice through Fish Audio, FREE model only, with the standard voice (edge-tts) as fallback.

Cost protection (the client's rules):
- every request sends the header  model: s2.1-pro-free  (Fish Audio bills the paid s2.1-pro when the
  header is missing or unknown, so it is fixed here and checked before sending)
- no other model, no paid fallback; on 401/402/403 Fish is paused and the standard voice is used
- keep the Fish Audio account without card or credits: then nothing can be charged at all
"""
from __future__ import annotations

import asyncio
import time

import httpx

from .config import settings
from .db import log_activity

FISH_URL = "https://api.fish.audio/v1/tts"
FREE_MODEL = "s2.1-pro-free"
SAMPLE_RATE = 44100  # raw 16-bit mono PCM at full quality, played by the app while it streams in
_paused_until = 0.0


def fish_enabled(lang: str) -> bool:
    return lang in ("de", "en") and bool(settings.fish_audio_key) and time.time() >= _paused_until


async def fish_stream(text: str, lang: str = "de"):
    """Opens a streaming Fish Audio request. Returns (client, response) on success, None to fall back."""
    global _paused_until
    headers = {"Authorization": f"Bearer {settings.fish_audio_key}", "model": FREE_MODEL}
    if headers["model"] != "s2.1-pro-free":  # never send anything but the free model
        return None
    voice = settings.fish_voice_id_en if lang == "en" else settings.fish_voice_id
    body = {"text": text, "reference_id": voice, "format": "pcm", "sample_rate": SAMPLE_RATE,
            "latency": "balanced", "normalize": True, "language": lang}
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
