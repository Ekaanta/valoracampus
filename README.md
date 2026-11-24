# SIMON – personal AI assistant

A self-hosted, JARVIS-style assistant: voice + text conversation, long-term memory,
free-first AI routing, tools, and a confirmation step for every sensitive action.
One responsive web app (installable as an app) for iPhone, Android, tablets, Windows and Mac.

## Architecture

```
 Browser / phone (React PWA)  ──HTTPS──►  SIMON API (FastAPI, Python)
   voice in: browser speech recognition        │
   voice out: /api/tts (edge-tts)              ├─ agent.py   prompt + tool loop (streaming)
                                               ├─ llm.py     free-first router ─┬─► FreeLLMAPI ─► Gemini, Groq, Cerebras,
                                               │                                │                 Mistral, OpenRouter, … (free tiers)
                                               │                                ├─► Ollama (local model on the server)
                                               │                                └─► paid model ONLY after user approval
                                               ├─ memory.py  long-term memory (auto-extracted facts + search)
                                               ├─ tools.py   weather, crypto, stocks, web search, maps, reminders …
                                               └─ PostgreSQL conversations, memories, approvals, activity log
```

| Part | What it does |
|---|---|
| `backend/app/llm.py` | Tries FreeLLMAPI first (which itself rotates across many free providers with quota tracking), then the local Ollama model. Failed providers cool down and every switch is logged. A paid provider is never used automatically: the UI shows provider, model, reason and cost note and asks first. |
| `backend/app/memory.py` | After every exchange, extracts durable facts about the user (name, preferences, projects, decisions…) and stores them. Recent memories go into every prompt; older conversations are searchable. Viewable / editable / deletable in the **Memory** page. |
| `backend/app/tools.py` | All capabilities. Tools marked `sensitive=True` (money, publishing, deleting) are only *prepared*; they run after **Confirm** or an explicit "yes" in a following message. |
| `backend/app/agent.py` | System prompt, conversation history, streaming answer, tool-calling loop. |
| `frontend/` | React PWA: animated orb, chat, voice mode, charts, approval cards, Memory / Activity / AI Providers pages. |

## What works in this version

- Text and voice conversation (speak → SIMON answers aloud → listens again in Voice mode; tap the orb/mic to interrupt)
- Persistent memory, synced across devices (everything is stored on the server)
- Free-first routing FreeLLMAPI → Ollama → paid-with-approval, failover + activity log
- Tools: weather & forecast, crypto price + chart + simple analysis (RSI/trend), stock charts, web search,
  read web page, Google Maps route link, reminders with notifications, memory search
- Confirmation system: demonstrated with crypto orders (prepared and confirmed, but **no exchange is connected yet**, so nothing is bought)
- Activity log, provider status page, login, installable PWA

Planned for later phases (not in this version): AI video production, Instagram publishing,
exchange / eBay order execution, email & calendar, PC file management, self-improvement agent.

## Run locally (Windows / Mac / Linux)

Requirements: Docker, Python 3.11+, Node 20+.

```bash
cp .env.example .env                                   # set APP_PASSWORD etc.
cp services/freellmapi.env.example services/freellmapi.env   # set ENCRYPTION_KEY
docker compose up -d                                   # Postgres + Ollama + FreeLLMAPI
docker compose exec ollama ollama pull qwen2.5:3b      # local fallback model
```

1. Open http://localhost:3001 (FreeLLMAPI), create the admin account, add free provider keys
   (Google AI Studio, Groq, OpenRouter, …) on the **Keys** page, copy the unified key into `FREELLMAPI_KEY` in `.env`.
2. Backend:
   ```bash
   cd backend
   python -m venv .venv && .venv/Scripts/activate      # Linux/Mac: source .venv/bin/activate
   pip install -r ../requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```
3. Frontend:
   ```bash
   cd frontend && npm install && npm run dev
   ```
   Open http://localhost:5173. On the very first start, create the administrator account on the setup page.

## Deploy on Vercel (live demo link)

Vercel cannot run Docker, so FreeLLMAPI and Ollama are not available there. On Vercel, SIMON
calls the free tiers of Groq / Gemini / OpenRouter directly; everything else works the same.
`vercel.json` already configures the build (React app) and the API (`api/index.py`, Python).

1. vercel.com → **Add New → Project** → import this GitHub repository → **Deploy**
   (no build settings to change).
2. Project → **Storage → Create Database → Neon (Postgres)** → connect it to the project.
   This adds `DATABASE_URL` automatically.
3. Project → **Settings → Environment Variables**:

   | Name | Value |
   |---|---|
   | `JWT_SECRET` | optional: a long random string for login tokens (otherwise generated once and kept in the database) |
   | `GROQ_API_KEY` | from console.groq.com (free) |
   | `GEMINI_API_KEY` | from aistudio.google.com (free) – optional second provider |
   | `TIMEZONE`, `DEFAULT_CITY`, `LANGUAGE`, `TTS_VOICE_DE`, `TTS_VOICE_EN` | optional |
   | `FISH_AUDIO_KEY` | optional: German voice from Fish Audio (free model only), from fish.audio → API keys |

4. **Deployments → Redeploy**. Open `https://<project>.vercel.app/api/health` – it should show
   `"database": "ok"` and the configured AI providers. Then open the main URL and log in.

Every `git push` to `main` deploys automatically. On phones, open the link and use
"Add to Home Screen" to install SIMON like an app.

## Deploy on the server

```bash
git clone <repo> simon && cd simon
cp .env.example .env && cp services/freellmapi.env.example services/freellmapi.env   # fill both
docker compose --profile app up -d --build
docker compose exec ollama ollama pull qwen2.5:7b      # pick a model that fits the server RAM
```

SIMON listens on `127.0.0.1:8000`. Put Nginx or Caddy with a domain and HTTPS in front of it
(HTTPS is required for the microphone on phones). FreeLLMAPI's dashboard stays on `127.0.0.1:3001`;
reach it with an SSH tunnel: `ssh -L 3001:localhost:3001 user@server`.

Minimum server: 4 vCPU, 8 GB RAM, 40 GB disk (Ollama 3B model). Recommended: 16 GB RAM for 7–8B models;
a GPU makes local models much faster. Ubuntu 22.04/24.04 + Docker.

## Extending SIMON

**Change the interface** (sphere, colours, texts, layout) – see [docs/FRONTEND.md](docs/FRONTEND.md).

**Users and settings without code** – sign in as an administrator and open the gear icon (Verwaltung):
create users (each has their own conversations, memory and reminders), reset passwords, disable or delete
accounts, and change Simon's name, home city, time zone, default language, default voices, speaking pace and
extra instructions. The first account (created on the setup page) is the administrator.

**Add a tool** – one function in `backend/app/tools.py`:

```python
@tool("get_joke", "Tell a random joke.", {"topic": {"type": "string"}})
def _joke(args, ctx):
    return {"joke": "..."}
```

Add `sensitive=True, summarize=lambda a: "..."` if it spends money, publishes or deletes.

**Add an AI provider** – add its key in the FreeLLMAPI dashboard (no code change). For a provider FreeLLMAPI
does not support, add a `Provider(...)` entry in `LLMRouter.__init__` in `backend/app/llm.py`.

**Change voice / language** – German is the default; every device can switch DE/EN in the top bar. Voices: `TTS_VOICE_DE` (default `de-DE-ConradNeural`, female: `de-DE-KatjaNeural`) and `TTS_VOICE_EN` in `.env`. With `FISH_AUDIO_KEY` set, German is spoken by the Fish Audio narrator voice `FISH_VOICE_ID` (default "Jens Deutsche Stimme", a licensed voice) through the free model `s2.1-pro-free` only, streamed so it starts within about a second; any Fish error falls back to the standard voice.

## AI providers

See [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md) for the evaluation of all 20 requested providers
(free vs. trial vs. paid, limits, privacy, commercial use) and the real request test results.
