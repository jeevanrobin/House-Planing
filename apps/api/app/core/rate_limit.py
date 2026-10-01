from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings

# Shared limiter: `default_limits` applies to every route via SlowAPIMiddleware;
# sensitive routes add a stricter `@limiter.limit(...)` on top. Outside dev the
# counters live in Redis so they hold across uvicorn workers (falling back to
# in-memory if Redis drops); dev keeps them in-process so no Redis is needed.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[settings.RATE_LIMIT],
    storage_uri="memory://" if settings.is_dev else settings.REDIS_URL,
    in_memory_fallback_enabled=True,
)
