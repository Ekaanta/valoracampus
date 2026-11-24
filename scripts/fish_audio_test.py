"""Fish Audio voice test for SIMON (free model only). Compares German voices with Simon's current voice.

Run from the project root, with FISH_AUDIO_KEY in .env:
    backend\\.venv\\Scripts\\python scripts\\fish_audio_test.py

Cost protection (as requested by the client):
- every request sends the header  model: s2.1-pro-free  (Fish Audio falls back to the PAID s2.1-pro
  when the header is missing or unknown, so the header is fixed in code and checked before sending)
- no other model, no paid fallback, no billing calls
- an answer of 402 (payment required) or any model error stops the test immediately
- keep the Fish Audio account without credit card or credits: then nothing can ever be charged

Output: client/fish_audio_samples/ (mp3 samples + REPORT.md). That folder is not committed to git.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

import edge_tts
import httpx

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "client" / "fish_audio_samples"
API = "https://api.fish.audio"
FREE_MODEL = "s2.1-pro-free"  # never change: anything else is billed
BASELINE_VOICE = "de-DE-ConradNeural"  # Simon's current voice (edge-tts)
VOICES_TO_TEST = 4

TEXTS = {
    "short": "Guten Morgen. Sie haben heute drei Termine. Ihr erster Termin beginnt um neun Uhr.",
    "medium": ("Bitcoin ist in dieser Woche um gut sechs Prozent gestiegen und liegt jetzt bei rund "
               "fünfundsechzigtausend Euro. Der Trend zeigt nach oben, aber der Markt bleibt schwankungsanfällig. "
               "Soll ich Sie benachrichtigen, falls der Kurs unter zweiundsechzigtausend Euro fällt?"),
    "long": ("Selbstverständlich. Ich habe die Wettervorhersage für Berlin geprüft. Morgen wird es kühl, mit "
             "Temperaturen zwischen null und drei Grad und am Nachmittag leichtem Schneegriesel. Wenn Sie um acht "
             "Uhr losfahren, empfehle ich etwas mehr Zeit einzuplanen, da die Straßen glatt sein können. "
             "Außerdem erinnere ich Sie um halb eins an Ihren Anruf bei der Bank. Gibt es sonst noch etwas, "
             "das ich für Sie vorbereiten soll?"),
}


class Stop(Exception):
    """Ends the test at once (free model unavailable, payment required, bad key ...)."""


def load_key() -> str:
    key = os.environ.get("FISH_AUDIO_KEY", "").strip()
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("FISH_AUDIO_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        raise Stop("FISH_AUDIO_KEY is missing in .env")
    return key


def headers(key: str) -> dict:
    h = {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "model": FREE_MODEL}
    assert h["model"] == "s2.1-pro-free", "refusing to send any model except s2.1-pro-free"
    return h


def check(resp: httpx.Response, what: str) -> None:
    if resp.status_code == 402:
        raise Stop(f"{what}: 402 payment required. The free model is not available for this account; stopped.")
    if resp.status_code == 401:
        raise Stop(f"{what}: 401 the API key is not valid.")
    if resp.status_code >= 400:
        body = resp.read().decode("utf-8", "replace")[:300]
        raise Stop(f"{what}: HTTP {resp.status_code} {body}")


def german_male_voices(client: httpx.Client, key: str) -> list[dict]:
    auth = {"Authorization": f"Bearer {key}"}
    found: list[dict] = []
    for params in ({"language": "de", "tag": "male", "licensed": "true"}, {"language": "de", "tag": "male"},
                   {"language": "de", "title": "male"}):
        r = client.get(f"{API}/model", headers=auth, params={**params, "page_size": 20, "sort_by": "score"})
        check(r, "voice list")
        for v in r.json().get("items", []):
            if v["_id"] not in {f["_id"] for f in found}:
                found.append(v)
        if len(found) >= VOICES_TO_TEST:
            break
    return [{"id": v["_id"], "title": v.get("title", ""), "licensed": v.get("licensed", False),
             "uses": v.get("task_count", 0), "likes": v.get("like_count", 0)} for v in found]


def fish_tts(client: httpx.Client, key: str, voice_id: str, text: str, latency: str, path: Path) -> dict:
    body = {"text": text, "reference_id": voice_id, "format": "mp3", "latency": latency, "normalize": True,
            "language": "de"}
    t0 = time.perf_counter()
    first = None
    size = 0
    with client.stream("POST", f"{API}/v1/tts", headers=headers(key), json=body) as r:
        check(r, "tts")
        with path.open("wb") as f:
            for chunk in r.iter_bytes():
                if chunk and first is None:
                    first = time.perf_counter() - t0
                size += len(chunk)
                f.write(chunk)
    return {"first_audio_s": round(first or 0, 2), "total_s": round(time.perf_counter() - t0, 2), "bytes": size}


async def edge(text: str, path: Path) -> dict:
    t0 = time.perf_counter()
    first = None
    size = 0
    with path.open("wb") as f:
        async for c in edge_tts.Communicate(text, BASELINE_VOICE).stream():
            if c["type"] == "audio":
                if first is None:
                    first = time.perf_counter() - t0
                size += len(c["data"])
                f.write(c["data"])
    return {"first_audio_s": round(first or 0, 2), "total_s": round(time.perf_counter() - t0, 2), "bytes": size}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    try:
        key = load_key()
        with httpx.Client(timeout=120) as client:
            voices = german_male_voices(client, key)[:VOICES_TO_TEST]
            if not voices:
                raise Stop("no German male voices found in the Fish Audio library")
            (OUT / "voices.json").write_text(json.dumps(voices, indent=2, ensure_ascii=False), encoding="utf-8")
            print("voices:", ", ".join(f"{v['title']} ({v['id'][:8]})" for v in voices))
            for name, text in TEXTS.items():  # Simon's current voice as the baseline
                res = asyncio.run(edge(text, OUT / f"current_conrad_{name}.mp3"))
                rows.append({"voice": f"Current: {BASELINE_VOICE}", "text": name, "latency": "-", **res})
                print(rows[-1])
            for i, v in enumerate(voices, 1):
                for name, text in TEXTS.items():
                    res = fish_tts(client, key, v["id"], text, "normal", OUT / f"fish{i}_{name}.mp3")
                    rows.append({"voice": f"Fish {i}: {v['title']}", "text": name, "latency": "normal", **res})
                    print(rows[-1])
            # faster setting, same first voice
            res = fish_tts(client, key, voices[0]["id"], TEXTS["short"], "balanced", OUT / "fish1_short_balanced.mp3")
            rows.append({"voice": f"Fish 1: {voices[0]['title']}", "text": "short", "latency": "balanced", **res})
            print(rows[-1])
    except Stop as stop:
        print("STOPPED:", stop)
        (OUT / "STOPPED.txt").write_text(str(stop), encoding="utf-8")
        return 1

    lines = ["# Fish Audio test (model s2.1-pro-free)", "",
             "| Voice | Text | Latency setting | First audio (s) | Total (s) |", "|---|---|---|---|---|"]
    lines += [f"| {r['voice']} | {r['text']} | {r['latency']} | {r['first_audio_s']} | {r['total_s']} |" for r in rows]
    (OUT / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("report:", OUT / "REPORT.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
