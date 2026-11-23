"""All settings come from environment variables / the root .env file.

Nothing secret is ever hard-coded: swapping the developer's test keys for the
client's keys is a .env (or Vercel environment variable) change only.
"""
import os

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _find_database_url() -> str | None:
    """Vercel storage integrations may add a prefix (e.g. STORAGE_DATABASE_URL). Accept those too.

    Returns the name of the variable that was used (never its value).
    """
    for name in ("DATABASE_URL", "POSTGRES_URL"):
        if os.environ.get(name):
            return name
    for name, value in sorted(os.environ.items()):
        upper = name.upper()
        if value and upper.endswith(("_DATABASE_URL", "_POSTGRES_URL")) and "UNPOOLED" not in upper:
            os.environ["DATABASE_URL"] = value
            return name
    return None


DATABASE_URL_SOURCE = _find_database_url()


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
    language: str = "de"  # de | en: default language (the app can switch per device)
    timezone: str = "Europe/Berlin"
    default_city: str = "Berlin"
    tts_voice_de: str = "de-DE-ConradNeural"  # native German voice (edge-tts)
    tts_voice_en: str = "en-GB-RyanNeural"

    def voice_for(self, lang: str | None) -> str:
        return self.tts_voice_en if lang == "en" else self.tts_voice_de

    def lang(self, lang: str | None) -> str:
        """The requested language if supported, otherwise the default."""
        return lang if lang in ("de", "en") else (self.language if self.language in ("de", "en") else "de")

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
