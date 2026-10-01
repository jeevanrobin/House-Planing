from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Repo-root .env is found whether uvicorn runs from the root or apps/api.
    model_config = SettingsConfigDict(env_file=("../../.env", ".env"), extra="ignore")

    PROJECT_NAME: str = "AI Plot Planner API"
    API_V1: str = "/api/v1"
    # Fail safe: anything other than an explicit "development" is treated as
    # production (Supabase must be configured).
    ENV: str = "production"

    # Supabase Auth: the API trusts access tokens signed by this project
    # (asymmetric keys, verified against its public JWKS — no shared secret).
    SUPABASE_URL: str = ""

    # Rate limiting (Redis keeps counters across workers outside dev).
    REDIS_URL: str = "redis://localhost:6379/0"
    RATE_LIMIT: str = "120/minute"

    # CORS
    FRONTEND_ORIGIN: str = "http://localhost:3100"

    # Claude via Google Vertex AI (optional — AI design critique).
    # When ANTHROPIC_VERTEX_PROJECT_ID is unset, AI features are disabled and
    # endpoints return the engine's own suggestions only.
    ANTHROPIC_VERTEX_PROJECT_ID: str = ""
    ANTHROPIC_VERTEX_REGION: str = "global"
    CLAUDE_MODEL: str = "claude-opus-4-8"
    CLAUDE_MAX_TOKENS: int = 2048

    @property
    def is_dev(self) -> bool:
        return self.ENV == "development"

    @model_validator(mode="after")
    def _require_supabase(self) -> "Settings":
        if not self.is_dev and not self.SUPABASE_URL.startswith("https://"):
            raise ValueError(
                f"SUPABASE_URL must be set to your project's https URL when ENV={self.ENV!r}; "
                "the API verifies sign-ins against it."
            )
        return self

    @property
    def supabase_issuer(self) -> str:
        return f"{self.SUPABASE_URL.rstrip('/')}/auth/v1"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.FRONTEND_ORIGIN.split(",") if o.strip()]

    @property
    def ai_enabled(self) -> bool:
        return bool(self.ANTHROPIC_VERTEX_PROJECT_ID)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
