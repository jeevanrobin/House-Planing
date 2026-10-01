"""Google Sign-In: verify an ID token issued to our OAuth client."""
from __future__ import annotations

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from starlette.concurrency import run_in_threadpool

from app.core.config import settings

# Reused HTTP session for fetching Google's signing certs.
_transport = google_requests.Request()


def _verify_sync(token: str) -> dict:
    # Checks signature, expiry, audience (our client id) and issuer.
    claims = id_token.verify_oauth2_token(token, _transport, settings.GOOGLE_CLIENT_ID)
    if not claims.get("email") or not claims.get("email_verified"):
        raise ValueError("Google account email is not verified")
    return claims


async def verify_google_id_token(token: str) -> dict:
    """Return the token's claims, or raise ValueError if it is not valid for us."""
    try:
        return await run_in_threadpool(_verify_sync, token)
    except ValueError:
        raise
    except Exception as exc:  # malformed tokens, cert fetch failures, ...
        raise ValueError(str(exc)) from exc
