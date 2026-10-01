from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    PROJECT_NAME: str = "AI Plot Planner API"
    API_V1: str = "/api/v1"
    ENV: str = "development"

    # Security
    JWT_SECRET: str = "change-me-in-production"
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
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.FRONTEND_ORIGIN.split(",") if o.strip()]

    @property
    def ai_enabled(self) -> bool:
        return bool(self.ANTHROPIC_VERTEX_PROJECT_ID)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
