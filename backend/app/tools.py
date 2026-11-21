"""SIMON's tools.

Add a new capability = write one function and decorate it with @tool(...).
Mark it sensitive=True when it spends money, publishes, deletes or is otherwise
irreversible: SIMON will then only *prepare* it, and it runs after the user
confirms (Confirm button, or by saying "yes" in a following message).
"""
from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import quote_plus, urlparse
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select

from . import memory
from .config import settings
from .db import PendingAction, Reminder, SessionLocal, log_activity, utcnow

HTTP = httpx.Client(timeout=15, follow_redirects=True,
                    headers={"User-Agent": "Mozilla/5.0 (SIMON personal assistant)"})


@dataclass
class ToolContext:
    conversation_id: int | None = None
    user_message: str = ""
    turn_started_at: datetime = field(default_factory=utcnow)
    ui: list[dict] = field(default_factory=list)  # cards for the UI: charts, links, approvals


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    run: Callable[[dict, ToolContext], dict]
    sensitive: bool = False
    summarize: Callable[[dict], str] | None = None


REGISTRY: dict[str, Tool] = {}


def tool(name: str, description: str, properties: dict, required: list[str] | None = None,
         sensitive: bool = False, summarize: Callable[[dict], str] | None = None):
    params = {"type": "object", "properties": properties, "required": required or []}

    def deco(fn):
        REGISTRY[name] = Tool(name, description, params, fn, sensitive, summarize)
        return fn
    return deco


def schemas() -> list[dict]:
    return [{"type": "function", "function": {"name": t.name, "description": t.description,
                                              "parameters": t.parameters}} for t in REGISTRY.values()]


def call_tool(name: str, args: dict, ctx: ToolContext) -> dict:
    t = REGISTRY.get(name)
    if not t:
        return {"error": f"Unknown tool '{name}'"}
    if t.sensitive:
        summary = t.summarize(args) if t.summarize else f"{name}({args})"
        with SessionLocal() as s:
            action = PendingAction(conversation_id=ctx.conversation_id, tool=name, args=args, summary=summary)
            s.add(action)
            s.commit()
        log_activity("approval_requested", summary, {"action_id": action.id, "tool": name, "args": args})
        ctx.ui.append({"type": "approval", "action": {"id": action.id, "summary": summary, "status": "pending"}})
        return {"status": "awaiting_confirmation", "action_id": action.id, "summary": summary,
                "note": "NOTHING has been executed. Tell the user what is prepared and ask for explicit confirmation."}
    try:
        result = t.run(args, ctx)
    except Exception as err:
        result = {"error": f"{type(err).__name__}: {err}"}
    log_activity("tool", name, {"args": args, "ok": "error" not in result})
    return result


def execute_action(action_id: int) -> dict:
    """Runs a confirmed sensitive action. Called by the Confirm button or confirm_action."""
    with SessionLocal() as s:
        action = s.get(PendingAction, action_id)
        if not action or action.status != "pending":
            return {"error": "There is no pending action with this id."}
        try:
            result = REGISTRY[action.tool].run(action.args, ToolContext(conversation_id=action.conversation_id))
        except Exception as err:
            result = {"error": f"{type(err).__name__}: {err}"}
        action.status = "failed" if "error" in result or result.get("executed") is False else "done"
        action.result, action.decided_at = result, utcnow()
        s.commit()
        out = {"action_id": action.id, "status": action.status, "summary": action.summary, "result": result}
    log_activity("approval_executed", f"Confirmed: {out['summary']}", out)
    return out


def reject_action(action_id: int) -> dict:
    with SessionLocal() as s:
        action = s.get(PendingAction, action_id)
        if not action or action.status != "pending":
            return {"error": "There is no pending action with this id."}
        action.status, action.decided_at = "rejected", utcnow()
        s.commit()
        summary = action.summary
    log_activity("approval_rejected", f"Rejected: {summary}")
    return {"action_id": action_id, "status": "rejected", "summary": summary}


# ---------------------------------------------------------------- confirmations
AFFIRMATIVE = re.compile(r"\b(yes|yeah|yep|confirm(ed)?|execute|go ahead|do it|proceed|approve[d]?|ok(ay)?|"
                         r"ja|jawohl|bestätig\w*|ausführen|mach (es|das))\b", re.I)


@tool("confirm_action",
      "Execute a previously prepared sensitive action. Only call this when the user's latest message "
      "explicitly confirms that specific prepared action.",
      {"action_id": {"type": "integer"}}, ["action_id"])
def _confirm_action(args: dict, ctx: ToolContext) -> dict:
    action_id = int(args["action_id"])
    with SessionLocal() as s:
        action = s.get(PendingAction, action_id)
        if not action or action.status != "pending":
            return {"error": "There is no pending action with this id."}
        created = action.created_at if action.created_at.tzinfo else action.created_at.replace(tzinfo=timezone.utc)
    # Safety: the action must come from an earlier turn and the user must have said yes now.
    if created >= ctx.turn_started_at or not AFFIRMATIVE.search(ctx.user_message):
        return {"error": "Not executed: the user has to confirm explicitly in a new message or with the Confirm button."}
    result = execute_action(action_id)
    ctx.ui.append({"type": "approval", "action": {"id": action_id, "summary": result.get("summary"),
                                                  "status": result.get("status")}})
    return result


@tool("cancel_action", "Cancel a prepared sensitive action the user does not want.",
      {"action_id": {"type": "integer"}}, ["action_id"])
def _cancel_action(args: dict, ctx: ToolContext) -> dict:
    return reject_action(int(args["action_id"]))


# ---------------------------------------------------------------------- memory
@tool("remember", "Store an important fact about the user in long-term memory (when they ask you to remember something).",
      {"content": {"type": "string"},
       "category": {"type": "string", "enum": ["profile", "preference", "project", "decision", "task", "other"]}},
      ["content"])
def _remember(args: dict, ctx: ToolContext) -> dict:
    m = memory.add_memory(args["content"], args.get("category", "other"), source="user")
    return {"saved": True, "id": m.id}


@tool("search_memory", "Search long-term memory and all past conversations (also weeks or months ago).",
      {"query": {"type": "string"}}, ["query"])
def _search_memory(args: dict, ctx: ToolContext) -> dict:
    return memory.search(args["query"])


# --------------------------------------------------------------------- weather
WEATHER_CODES = {0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog",
                 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain",
                 65: "heavy rain", 66: "freezing rain", 67: "freezing rain", 71: "light snow", 73: "snow",
                 75: "heavy snow", 77: "snow grains", 80: "rain showers", 81: "rain showers", 82: "violent showers",
                 85: "snow showers", 86: "snow showers", 95: "thunderstorm", 96: "thunderstorm with hail",
                 99: "thunderstorm with hail"}


@tool("get_weather", "Current weather and daily forecast for a city (default: the user's city).",
      {"city": {"type": "string"}, "days": {"type": "integer", "description": "1-7"}})
def _weather(args: dict, ctx: ToolContext) -> dict:
    city = args.get("city") or settings.default_city
    geo = HTTP.get("https://geocoding-api.open-meteo.com/v1/search",
                   params={"name": city, "count": 1, "language": settings.language}).json()
    if not geo.get("results"):
        return {"error": f"City '{city}' not found"}
    place = geo["results"][0]
    days = max(1, min(int(args.get("days") or 3), 7))
    data = HTTP.get("https://api.open-meteo.com/v1/forecast", params={
        "latitude": place["latitude"], "longitude": place["longitude"], "timezone": "auto",
        "forecast_days": days,
        "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    }).json()
    cur, d = data["current"], data["daily"]
    return {
        "place": f"{place['name']}, {place.get('country', '')}",
        "now": {"temp_c": cur["temperature_2m"], "feels_like_c": cur["apparent_temperature"],
                "conditions": WEATHER_CODES.get(cur["weather_code"], "unknown"), "wind_kmh": cur["wind_speed_10m"]},
        "forecast": [{"date": d["time"][i], "min_c": d["temperature_2m_min"][i], "max_c": d["temperature_2m_max"][i],
                      "rain_chance_pct": d["precipitation_probability_max"][i],
                      "conditions": WEATHER_CODES.get(d["weather_code"][i], "unknown")} for i in range(len(d["time"]))],
    }


# ---------------------------------------------------------------------- markets
COINS = {"btc": "bitcoin", "bitcoin": "bitcoin", "eth": "ethereum", "ethereum": "ethereum", "sol": "solana",
         "solana": "solana", "xrp": "ripple", "ada": "cardano", "doge": "dogecoin", "bnb": "binancecoin",
         "dot": "polkadot", "ltc": "litecoin", "usdt": "tether", "usdc": "usd-coin"}


def _rsi(values: list[float], period: int = 14) -> float | None:
    if len(values) <= period:
        return None
    gains = losses = 0.0
    for a, b in zip(values[-period - 1:-1], values[-period:]):
        change = b - a
        gains += max(change, 0)
        losses += max(-change, 0)
    if losses == 0:
        return 100.0
    rs = (gains / period) / (losses / period)
    return round(100 - 100 / (1 + rs), 1)


def _analyse(prices: list[float]) -> dict:
    short = prices[-max(3, len(prices) // 6):]
    return {
        "last": round(prices[-1], 4), "change_pct": round((prices[-1] / prices[0] - 1) * 100, 2),
        "high": round(max(prices), 4), "low": round(min(prices), 4),
        "trend": "up" if sum(short) / len(short) > sum(prices) / len(prices) else "down",
        "rsi_14": _rsi(prices),
    }


def _downsample(points: list[list[float]], n: int = 90) -> list[list[float]]:
    step = max(1, len(points) // n)
    return points[::step] + ([points[-1]] if points and (len(points) - 1) % step else [])


@tool("get_crypto", "Live cryptocurrency price, chart and simple technical analysis (shows a chart to the user).",
      {"coin": {"type": "string", "description": "name or symbol, e.g. bitcoin or BTC"},
       "currency": {"type": "string", "description": "eur (default) or usd"},
       "days": {"type": "integer", "description": "chart range in days, default 7"}}, ["coin"])
def _crypto(args: dict, ctx: ToolContext) -> dict:
    coin = args["coin"].strip().lower()
    coin_id = COINS.get(coin)
    if not coin_id:
        found = HTTP.get("https://api.coingecko.com/api/v3/search", params={"query": coin}).json().get("coins", [])
        if not found:
            return {"error": f"Unknown coin '{coin}'"}
        coin_id = found[0]["id"]
    cur = (args.get("currency") or "eur").lower()
    days = max(1, min(int(args.get("days") or 7), 365))
    chart = HTTP.get(f"https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart",
                     params={"vs_currency": cur, "days": days}).json()
    if "prices" not in chart:
        return {"error": f"Market data unavailable: {chart}"}
    points = chart["prices"]
    ctx.ui.append({"type": "chart", "title": f"{coin_id.title()} · {cur.upper()} · {days}d",
                   "currency": cur.upper(), "points": _downsample(points)})
    return {"coin": coin_id, "currency": cur.upper(), "range_days": days, **_analyse([p[1] for p in points]),
            "source": "CoinGecko", "note": "Not financial advice."}


@tool("get_stock", "Stock / ETF / index price with chart and simple analysis (shows a chart to the user).",
      {"symbol": {"type": "string", "description": "ticker, e.g. AAPL, TSLA, SAP.DE, ^GDAXI"},
       "range": {"type": "string", "enum": ["5d", "1mo", "3mo", "6mo", "1y"]}}, ["symbol"])
def _stock(args: dict, ctx: ToolContext) -> dict:
    symbol = args["symbol"].upper().strip()
    rng = args.get("range") or "1mo"
    data = HTTP.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{quote_plus(symbol)}",
                    params={"range": rng, "interval": "1d" if rng not in ("5d",) else "1h"}).json()
    result = (data.get("chart") or {}).get("result")
    if not result:
        return {"error": f"No data for '{symbol}'"}
    r = result[0]
    pts = [[t * 1000, c] for t, c in zip(r.get("timestamp", []), r["indicators"]["quote"][0]["close"]) if c is not None]
    if not pts:
        return {"error": f"No prices for '{symbol}'"}
    currency = r["meta"].get("currency", "")
    ctx.ui.append({"type": "chart", "title": f"{symbol} · {currency} · {rng}", "currency": currency,
                   "points": _downsample(pts)})
    return {"symbol": symbol, "name": r["meta"].get("longName") or r["meta"].get("shortName"),
            "currency": currency, "range": rng, **_analyse([p[1] for p in pts]),
            "source": "Yahoo Finance (unofficial endpoint)", "note": "Not financial advice."}


def _trade_summary(a: dict) -> str:
    return f"{a.get('side', 'buy').upper()} {a.get('coin', '?').upper()} for €{a.get('amount_eur')} (plus exchange fees)"


@tool("prepare_crypto_trade",
      "Prepare a crypto buy/sell order. It is NOT executed until the user confirms.",
      {"coin": {"type": "string"}, "side": {"type": "string", "enum": ["buy", "sell"]},
       "amount_eur": {"type": "number"}}, ["coin", "side", "amount_eur"],
      sensitive=True, summarize=_trade_summary)
def _trade(args: dict, ctx: ToolContext) -> dict:
    # Exchange execution is a later phase. Until an exchange API is connected this
    # honestly reports that nothing was bought or sold.
    return {"executed": False,
            "reason": "No exchange account is connected yet, so no order was placed. "
                      "Connecting an exchange API (e.g. Kraken or Binance) is planned for a later phase."}


# ---------------------------------------------------------------------- web
def _is_public(url: str) -> bool:
    host = urlparse(url).hostname
    if not host or urlparse(url).scheme not in ("http", "https"):
        return False
    try:
        for info in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False
    except socket.gaierror:
        return False
    return True


@tool("web_search", "Search the web for current information, products, news.",
      {"query": {"type": "string"}, "max_results": {"type": "integer"}}, ["query"])
def _web_search(args: dict, ctx: ToolContext) -> dict:
    from ddgs import DDGS
    limit = max(1, min(int(args.get("max_results") or 6), 10))
    hits, last_error = [], None
    for backend in ("auto", "bing", "google", "yahoo"):  # free search engines, tried in turn
        try:
            hits = DDGS().text(args["query"], max_results=limit, backend=backend)
            if hits:
                break
        except Exception as err:
            last_error = err
    if not hits:
        return {"error": f"Web search returned nothing ({last_error})"}
    return {"results": [{"title": h.get("title"), "url": h.get("href"), "snippet": h.get("body")} for h in hits]}


@tool("read_webpage", "Open a web page and read its text content.",
      {"url": {"type": "string"}}, ["url"])
def _read_webpage(args: dict, ctx: ToolContext) -> dict:
    url = args["url"]
    if not _is_public(url):
        return {"error": "Only public http(s) pages can be opened."}
    html = HTTP.get(url).text
    html = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", html)).strip()
    return {"url": url, "text": text[:6000], "truncated": len(text) > 6000}


@tool("show_route", "Show a route / directions on Google Maps.",
      {"destination": {"type": "string"}, "origin": {"type": "string", "description": "empty = current location"},
       "mode": {"type": "string", "enum": ["driving", "walking", "bicycling", "transit"]}}, ["destination"])
def _route(args: dict, ctx: ToolContext) -> dict:
    url = ("https://www.google.com/maps/dir/?api=1&destination=" + quote_plus(args["destination"])
           + (f"&origin={quote_plus(args['origin'])}" if args.get("origin") else "")
           + f"&travelmode={args.get('mode') or 'driving'}")
    ctx.ui.append({"type": "link", "title": f"Route to {args['destination']}", "url": url})
    return {"shown_to_user": True, "url": url}


# --------------------------------------------------------------------- reminders
def _parse_local(when: str) -> datetime:
    dt = datetime.fromisoformat(when.strip().replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo(settings.timezone))
    return dt.astimezone(timezone.utc)


@tool("create_reminder", "Schedule a reminder / appointment notification.",
      {"text": {"type": "string"},
       "due": {"type": "string", "description": "local date-time ISO format, e.g. 2026-11-22T14:30"}},
      ["text", "due"])
def _create_reminder(args: dict, ctx: ToolContext) -> dict:
    due = _parse_local(args["due"])
    with SessionLocal() as s:
        r = Reminder(text=args["text"], due_at=due)
        s.add(r)
        s.commit()
    return {"scheduled": True, "id": r.id, "due_local": due.astimezone(ZoneInfo(settings.timezone)).isoformat()}


@tool("list_reminders", "List upcoming reminders and appointments.", {})
def _list_reminders(args: dict, ctx: ToolContext) -> dict:
    tz = ZoneInfo(settings.timezone)
    with SessionLocal() as s:
        rows = s.scalars(select(Reminder).where(Reminder.status == "scheduled").order_by(Reminder.due_at)).all()
    return {"reminders": [{"id": r.id, "text": r.text, "due_local": r.due_at.astimezone(tz).isoformat()} for r in rows]}


@tool("cancel_reminder", "Cancel a scheduled reminder.", {"id": {"type": "integer"}}, ["id"])
def _cancel_reminder(args: dict, ctx: ToolContext) -> dict:
    with SessionLocal() as s:
        r = s.get(Reminder, int(args["id"]))
        if not r:
            return {"error": "Reminder not found"}
        r.status = "cancelled"
        s.commit()
    return {"cancelled": True}
