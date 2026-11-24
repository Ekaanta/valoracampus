"""Free-first LLM router.

Order: FreeLLMAPI (which itself rotates across many free cloud providers)
-> Ollama (local model on the server) -> paid provider ONLY after the user approved it.

A provider that fails is put on a short cooldown and the next one is tried.
Every failover is written to the activity log.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Iterator

import httpx
from openai import OpenAI, RateLimitError

from .config import settings
from .db import log_activity

COOLDOWN_SECONDS = 60
MAX_WAIT = 12  # a rate limit that resets within this many seconds is waited out once instead of failing


@dataclass
class Provider:
    name: str
    base_url: str
    api_key: str
    model: str
    paid: bool = False
    cost_note: str = ""
    timeout: float = 90  # seconds to wait for the first byte before failing over
    keyless: bool = False  # the provider rejects any Authorization header (OVH anonymous tier)
    light: bool = False  # a small model: used first for background work such as memory extraction
    ok_count: int = 0
    fail_count: int = 0
    last_error: str = ""
    last_ok_at: float = 0.0
    cooldown_until: float = 0.0
    _client: OpenAI | None = field(default=None, repr=False)

    def client(self) -> OpenAI:
        if self._client is None:
            extra = {}
            if self.keyless:  # send no key at all: a dummy key is refused with 403
                extra["http_client"] = httpx.Client(timeout=self.timeout, event_hooks={
                    "request": [lambda request: request.headers.pop("Authorization", None)]})
            self._client = OpenAI(base_url=self.base_url, api_key=self.api_key or "none",
                                  timeout=self.timeout, max_retries=0, **extra)
        return self._client

    def status(self) -> dict:
        now = time.time()
        return {
            "name": self.name, "model": self.model, "paid": self.paid, "base_url": self.base_url,
            "ok_count": self.ok_count, "fail_count": self.fail_count, "last_error": self.last_error,
            "last_ok_at": self.last_ok_at or None,
            "cooling_down": self.cooldown_until > now,
            "cost_note": self.cost_note,
        }


class PaidApprovalRequired(Exception):
    def __init__(self, provider: Provider, reason: str):
        super().__init__(reason)
        self.provider = provider
        self.reason = reason

    def to_dict(self) -> dict:
        return {"provider": self.provider.name, "model": self.provider.model,
                "reason": self.reason, "cost_note": self.provider.cost_note or "unknown"}


class AllProvidersFailed(Exception):
    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after  # set when every provider was only rate-limited


def _retry_after(err: Exception) -> float | None:
    """Seconds until a rate limit resets (from the header or "try again in 8.36s"); None if not a rate limit."""
    if not (isinstance(err, RateLimitError) or getattr(err, "status_code", None) == 429):
        return None
    try:
        header = err.response.headers.get("retry-after")
        if header:
            return float(header)
    except Exception:
        pass
    m = re.search(r"try again in (?:(\d+)m)?([\d.]+)(ms|s)", str(err))
    if m:
        return int(m.group(1) or 0) * 60 + float(m.group(2)) / (1000 if m.group(3) == "ms" else 1)
    return 30.0


def _short(err: Exception) -> str:
    return f"{type(err).__name__}: {err}"[:300]


class LLMRouter:
    def __init__(self) -> None:
        self.free: list[Provider] = []
        if settings.freellmapi_key:
            # FreeLLMAPI does its own failover across free providers within ~45 s;
            # if it still has nothing by then, SIMON moves on to the local model.
            self.free.append(Provider("FreeLLMAPI", settings.freellmapi_url,
                                      settings.freellmapi_key, settings.freellmapi_model, timeout=50))
        cf_url = f"https://api.cloudflare.com/client/v4/accounts/{settings.cloudflare_account_id}/ai/v1"
        direct = [  # genuinely free tiers only (see docs/AI_PROVIDERS.md)
            ("Groq", "https://api.groq.com/openai/v1", settings.groq_api_key, settings.groq_model),
            ("Groq backup", "https://api.groq.com/openai/v1", settings.groq_api_key,
             settings.groq_backup_model if settings.groq_backup_model != settings.groq_model else ""),
            ("Cloudflare", cf_url, settings.cloudflare_api_token if settings.cloudflare_account_id else "",
             settings.cloudflare_model),
            ("Z.ai", "https://api.z.ai/api/paas/v4", settings.zai_api_key, settings.zai_model),
            ("Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/",
             settings.gemini_api_key, settings.gemini_model),
            ("OpenRouter", "https://openrouter.ai/api/v1", settings.openrouter_api_key, settings.openrouter_model),
        ]
        for name, url, key, model in direct:
            if key and model:
                self.free.append(Provider(name, url, key, model, timeout=45, light=name == "Groq backup"))
        ovh_models = [m.strip() for m in settings.ovh_model.split(",") if m.strip()] if settings.ovh_url else []
        for i, model in enumerate(ovh_models):  # keyless: works without any account
            self.free.append(Provider("OVHcloud (EU)" + (f" {i + 1}" if i else ""), settings.ovh_url, "", model,
                                      timeout=45, keyless=True, light=model.endswith("-20b")))
        if settings.ollama_model:
            self.free.append(Provider("Ollama (local)", settings.ollama_url, "ollama", settings.ollama_model,
                                      timeout=240))
        self.paid: Provider | None = None
        if settings.paid_url and settings.paid_key and settings.paid_model:
            self.paid = Provider(settings.paid_name or "Paid provider", settings.paid_url,
                                 settings.paid_key, settings.paid_model, paid=True,
                                 cost_note=settings.paid_cost_note)

    # -- helpers -------------------------------------------------------------
    def _candidates(self, allow_paid: bool, light: bool = False) -> list[Provider]:
        now = time.time()
        free = sorted(self.free, key=lambda p: not p.light) if light else self.free
        ready = [p for p in free if p.cooldown_until <= now]
        cooling = [p for p in free if p.cooldown_until > now]
        order = ready + cooling  # cooling providers are still tried as a last free resort
        if allow_paid and self.paid:
            order.append(self.paid)
        return order

    def _ok(self, p: Provider) -> None:
        p.ok_count += 1
        p.last_ok_at = time.time()
        p.cooldown_until = 0

    def _fail(self, p: Provider, err: Exception, wait: float | None = None) -> None:
        p.fail_count += 1
        p.last_error = _short(err)
        # a rate-limited provider is ready again as soon as its limit resets
        p.cooldown_until = time.time() + (wait if wait is not None else COOLDOWN_SECONDS)
        log_activity("llm_failover", f"{p.name} failed, switching provider", {"error": p.last_error})

    def _exhausted(self, errors: list[str], allow_paid: bool, limited: list | None = None):
        if self.paid and not allow_paid:
            raise PaidApprovalRequired(self.paid, "All free AI providers are unavailable right now: "
                                       + " | ".join(errors))
        only_limits = bool(limited) and len(limited) == len(errors)
        raise AllProvidersFailed(" | ".join(errors) or "No AI provider is configured",
                                 retry_after=min(w for w, _ in limited) if only_limits else None)

    def _args(self, p: Provider, messages: list[dict], tools: list | None, **kw: Any) -> dict:
        args = {"model": p.model, "messages": messages, **kw}
        if tools:
            args["tools"] = tools
        return args

    # -- public API ----------------------------------------------------------
    def complete(self, messages: list[dict], tools: list | None = None, allow_paid: bool = False,
                 light: bool = False, **kw: Any):
        """light=True: small models first (background work), so the main model keeps its free quota."""
        errors: list[str] = []
        limited: list[tuple[float, Provider]] = []
        for p in self._candidates(allow_paid, light):
            try:
                resp = p.client().chat.completions.create(**self._args(p, messages, tools, **kw))
                self._ok(p)
                return resp, p
            except Exception as err:  # network error, 429, 5xx, unsupported tools ...
                wait = _retry_after(err)
                self._fail(p, err, wait)
                errors.append(f"{p.name}: {_short(err)}")
                if wait is not None:
                    limited.append((wait, p))
        self._exhausted(errors, allow_paid, limited)

    def stream(self, messages: list[dict], tools: list | None = None, allow_paid: bool = False) -> Iterator[tuple[str, Any]]:
        """Yields ("trying", Provider) and ("failover", Provider) progress items,
        ("provider", Provider) once a provider answers, then ("chunk", chunk) items.

        Failover happens only before the first chunk arrives; after that the
        answer is already reaching the user.
        """
        errors: list[str] = []
        limited: list[tuple[float, Provider]] = []
        for p in self._candidates(allow_paid):
            yield "trying", p
            if (yield from self._stream_one(p, messages, tools, errors, limited)):
                return
        # Every provider failed. If the only problem was a short rate limit, wait it out once.
        if limited and len(limited) == len(errors):
            wait, p = min(limited, key=lambda x: x[0])
            if wait <= MAX_WAIT:
                yield "waiting", (p, wait)
                time.sleep(wait + 0.5)
                if (yield from self._stream_one(p, messages, tools, errors, limited)):
                    return
        self._exhausted(errors, allow_paid, limited)

    def _stream_one(self, p: Provider, messages, tools, errors: list, limited: list):
        """Streams one provider; returns True when it answered, False after recording the failure."""
        try:
            stream = p.client().chat.completions.create(**self._args(p, messages, tools, stream=True))
            iterator = iter(stream)
            first = next(iterator)
        except StopIteration:
            self._fail(p, RuntimeError("empty response"))
            errors.append(f"{p.name}: empty response")
            yield "failover", p
            return False
        except Exception as err:
            wait = _retry_after(err)
            self._fail(p, err, wait)
            errors.append(f"{p.name}: {_short(err)}")
            if wait is not None:
                limited.append((wait, p))
            yield "failover", p
            return False
        self._ok(p)
        yield "provider", p
        yield "chunk", first
        for chunk in iterator:
            yield "chunk", chunk
        return True

    def stt_client(self) -> OpenAI | None:
        """Speech-to-text goes through FreeLLMAPI if present, otherwise straight to Groq Whisper."""
        if settings.freellmapi_key:
            return OpenAI(base_url=settings.freellmapi_url, api_key=settings.freellmapi_key, timeout=60)
        if settings.groq_api_key:
            return OpenAI(base_url="https://api.groq.com/openai/v1", api_key=settings.groq_api_key, timeout=60)
        return None

    def status(self) -> list[dict]:
        items = [p.status() for p in self.free]
        if self.paid:
            items.append(self.paid.status())
        return items


router = LLMRouter()
