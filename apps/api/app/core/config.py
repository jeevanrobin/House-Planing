from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_JWT_SECRET = "change-me-in-production"


class Settings(BaseSettings):
    # Repo-root .env is found whether uvicorn runs from the root or apps/api.
    model_config = SettingsConfigDict(env_file=("../../.env", ".env"), extra="ignore")

    PROJECT_NAME: str = "AI Plot Planner API"
    API_V1: str = "/api/v1"
    # Fail safe: anything other than an explicit "development" is treated as
    # production (no dev OTP echo, strong JWT secret required).
    ENV: str = "production"

    # Security
    JWT_SECRET: str = _DEFAULT_JWT_SECRET
    JWT_ALG: str = "HS256"
    ACCESS_TOKEN_TTL_MIN: int = 30
    REFRESH_TOKEN_TTL_DAYS: int = 30
    OTP_TTL_MIN: int = 10

    # Infrastructure
    DATABASE_URL: str = "postgresql+asyncpg://planner:planner@localhost:5432/planner"
    REDIS_URL: str = "redis://localhost:6379/0"

    # CORS
    FRONTEND_ORIGIN: str = "http://localhost:3100"

    # OAuth
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    # Email (OTP delivery). With SMTP_HOST unset, dev logs codes to the console
    # and production refuses to issue codes rather than pretending to send them.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "AI Plot Planner <no-reply@localhost>"
    SMTP_STARTTLS: bool = True

    # Rate limiting
    RATE_LIMIT: str = "120/minute"

    # Claude via Google Vertex AI (optional — AI design critique).
    # When ANTHROPIC_VERTEX_PROJECT_ID is unset, AI features are disabled and
    # endpoints fall back to the deterministic engine.
    ANTHROPIC_VERTEX_PROJECT_ID: str = ""
    ANTHROPIC_VERTEX_REGION: str = "global"
    CLAUDE_MODEL: str = "claude-opus-4-8"
    CLAUDE_MAX_TOKENS: int = 2048

    @property
    def is_dev(self) -> bool:
        return self.ENV == "development"

    @model_validator(mode="after")
    def _require_strong_secret(self) -> "Settings":
        if not self.is_dev and (self.JWT_SECRET == _DEFAULT_JWT_SECRET or len(self.JWT_SECRET) < 32):
            raise ValueError(
                f"JWT_SECRET must be set to a random value of at least 32 characters when "
                f"ENV={self.ENV!r} (generate one with: openssl rand -hex 32)."
            )
        return self

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
