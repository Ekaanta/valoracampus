"""All settings come from environment variables / the root .env file.

Nothing secret is ever hard-coded: swapping the developer's test keys for the
client's keys is a .env (or Vercel environment variable) change only.
"""
from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    # --- access -------------------------------------------------------------
    # Login page on/off. Off = anyone with the link can use SIMON. Turn on with REQUIRE_LOGIN=true.
    require_login: bool = False
    app_password: str = "change-me"
    jwt_secret: str = "change-me-too"
    cors_origins: str = "http://localhost:5173"

    # --- storage (Vercel/Neon set DATABASE_URL or POSTGRES_URL) --------------
    database_url: str = Field("postgresql+psycopg://simon:simon@localhost:5432/simon",
                              validation_alias=AliasChoices("DATABASE_URL", "POSTGRES_URL"))

    # --- persona ------------------------------------------------------------
    assistant_name: str = "SIMON"
    language: str = "en"  # en | de  (speech recognition + default reply language)
    timezone: str = "Europe/Berlin"
    default_city: str = "Berlin"
    tts_voice: str = "en-GB-RyanNeural"  # any edge-tts voice, e.g. de-DE-ConradNeural

    # --- AI providers, tried in this order (free first) ---------------------
    # 1) FreeLLMAPI: one OpenAI-compatible endpoint in front of many free providers (own server)
    freellmapi_url: str = "http://localhost:3001/v1"
    freellmapi_key: str = ""
    freellmapi_model: str = "auto"
    # 2) Direct free tiers, used where FreeLLMAPI cannot run (e.g. Vercel)
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    openrouter_api_key: str = ""
    openrouter_model: str = ""  # e.g. a ":free" model id from openrouter.ai/models
    # 3) Ollama: local models on the server (leave empty where no Ollama runs)
    ollama_url: str = "http://localhost:11434/v1"
    ollama_model: str = ""
    # 4) Optional paid provider: NEVER used without the user's explicit approval
    paid_name: str = ""
    paid_url: str = ""
    paid_key: str = ""
    paid_model: str = ""
    paid_cost_note: str = ""  # shown to the user before approval, e.g. "~$0.60 per 1M tokens"

    # speech-to-text fallback (browsers without built-in speech recognition)
    stt_model: str = "whisper-large-v3"

    frontend_dist: str = "../frontend/dist"

    @field_validator("database_url")
    @classmethod
    def _use_psycopg3(cls, url: str) -> str:
        # Hosted Postgres URLs come as postgres:// or postgresql://; SQLAlchemy needs the driver name.
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url


settings = Settings()
