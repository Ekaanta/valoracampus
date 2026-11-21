"""All settings come from environment variables / the root .env file.

Nothing secret is ever hard-coded: swapping the developer's test keys for the
client's keys is a .env change only.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    # --- access -------------------------------------------------------------
    app_password: str = "change-me"
    jwt_secret: str = "change-me-too"
    cors_origins: str = "http://localhost:5173"

    # --- storage ------------------------------------------------------------
    database_url: str = "postgresql+psycopg://simon:simon@localhost:5432/simon"

    # --- persona ------------------------------------------------------------
    assistant_name: str = "SIMON"
    language: str = "en"  # en | de  (speech recognition + default reply language)
    timezone: str = "Europe/Berlin"
    default_city: str = "Berlin"
    tts_voice: str = "en-GB-RyanNeural"  # any edge-tts voice, e.g. de-DE-ConradNeural

    # --- AI providers (free first) -----------------------------------------
    # 1) FreeLLMAPI: one OpenAI-compatible endpoint in front of many free providers
    freellmapi_url: str = "http://localhost:3001/v1"
    freellmapi_key: str = ""
    freellmapi_model: str = "auto"
    # 2) Ollama: local models on the server, used when FreeLLMAPI is unavailable
    ollama_url: str = "http://localhost:11434/v1"
    ollama_model: str = "qwen2.5:3b"
    # 3) Optional paid provider: NEVER used without the user's explicit approval
    paid_name: str = ""
    paid_url: str = ""
    paid_key: str = ""
    paid_model: str = ""
    paid_cost_note: str = ""  # shown to the user before approval, e.g. "~$0.60 per 1M tokens"

    # speech-to-text fallback (browsers without built-in speech recognition)
    stt_model: str = "whisper-large-v3"

    frontend_dist: str = "../frontend/dist"


settings = Settings()
