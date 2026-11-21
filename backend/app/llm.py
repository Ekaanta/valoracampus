"""Free-first LLM router.

Order: FreeLLMAPI (which itself rotates across many free cloud providers)
-> Ollama (local model on the server) -> paid provider ONLY after the user approved it.

A provider that fails is put on a short cooldown and the next one is tried.
Every failover is written to the activity log.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Iterator

from openai import OpenAI

from .config import settings
from .db import log_activity

COOLDOWN_SECONDS = 60


@dataclass
class Provider:
    name: str
    base_url: str
    api_key: str
    model: str
    paid: bool = False
    cost_note: str = ""
    ok_count: int = 0
    fail_count: int = 0
    last_error: str = ""
    last_ok_at: float = 0.0
    cooldown_until: float = 0.0
    _client: OpenAI | None = field(default=None, repr=False)

    def client(self) -> OpenAI:
        if self._client is None:
            self._client = OpenAI(base_url=self.base_url, api_key=self.api_key or "none",
                                  timeout=90, max_retries=0)
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
    pass


def _short(err: Exception) -> str:
    return f"{type(err).__name__}: {err}"[:300]


class LLMRouter:
    def __init__(self) -> None:
        self.free: list[Provider] = []
        if settings.freellmapi_key:
            self.free.append(Provider("FreeLLMAPI", settings.freellmapi_url,
                                      settings.freellmapi_key, settings.freellmapi_model))
        if settings.ollama_model:
            self.free.append(Provider("Ollama (local)", settings.ollama_url, "ollama", settings.ollama_model))
        self.paid: Provider | None = None
        if settings.paid_url and settings.paid_key and settings.paid_model:
            self.paid = Provider(settings.paid_name or "Paid provider", settings.paid_url,
                                 settings.paid_key, settings.paid_model, paid=True,
                                 cost_note=settings.paid_cost_note)

    # -- helpers -------------------------------------------------------------
    def _candidates(self, allow_paid: bool) -> list[Provider]:
        now = time.time()
        ready = [p for p in self.free if p.cooldown_until <= now]
        cooling = [p for p in self.free if p.cooldown_until > now]
        order = ready + cooling  # cooling providers are still tried as a last free resort
        if allow_paid and self.paid:
            order.append(self.paid)
        return order

    def _ok(self, p: Provider) -> None:
        p.ok_count += 1
        p.last_ok_at = time.time()
        p.cooldown_until = 0

    def _fail(self, p: Provider, err: Exception) -> None:
        p.fail_count += 1
        p.last_error = _short(err)
        p.cooldown_until = time.time() + COOLDOWN_SECONDS
        log_activity("llm_failover", f"{p.name} failed, switching provider", {"error": p.last_error})

    def _exhausted(self, errors: list[str], allow_paid: bool):
        if self.paid and not allow_paid:
            raise PaidApprovalRequired(self.paid, "All free AI providers are unavailable right now: "
                                       + " | ".join(errors))
        raise AllProvidersFailed(" | ".join(errors) or "No AI provider is configured")

    def _args(self, p: Provider, messages: list[dict], tools: list | None, **kw: Any) -> dict:
        args = {"model": p.model, "messages": messages, **kw}
        if tools:
            args["tools"] = tools
        return args

    # -- public API ----------------------------------------------------------
    def complete(self, messages: list[dict], tools: list | None = None, allow_paid: bool = False, **kw: Any):
        errors: list[str] = []
        for p in self._candidates(allow_paid):
            try:
                resp = p.client().chat.completions.create(**self._args(p, messages, tools, **kw))
                self._ok(p)
                return resp, p
            except Exception as err:  # network error, 429, 5xx, unsupported tools ...
                self._fail(p, err)
                errors.append(f"{p.name}: {_short(err)}")
        self._exhausted(errors, allow_paid)

    def stream(self, messages: list[dict], tools: list | None = None, allow_paid: bool = False) -> Iterator[tuple[str, Any]]:
        """Yields ("provider", Provider) once, then ("chunk", chunk) items.

        Failover happens only before the first chunk arrives; after that the
        answer is already reaching the user.
        """
        errors: list[str] = []
        for p in self._candidates(allow_paid):
            try:
                stream = p.client().chat.completions.create(**self._args(p, messages, tools, stream=True))
                iterator = iter(stream)
                first = next(iterator)
            except StopIteration:
                self._fail(p, RuntimeError("empty response"))
                errors.append(f"{p.name}: empty response")
                continue
            except Exception as err:
                self._fail(p, err)
                errors.append(f"{p.name}: {_short(err)}")
                continue
            self._ok(p)
            yield "provider", p
            yield "chunk", first
            for chunk in iterator:
                yield "chunk", chunk
            return
        self._exhausted(errors, allow_paid)

    def status(self) -> list[dict]:
        items = [p.status() for p in self.free]
        if self.paid:
            items.append(self.paid.status())
        return items


router = LLMRouter()
