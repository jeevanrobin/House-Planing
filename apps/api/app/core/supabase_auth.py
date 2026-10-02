"""Verify Supabase Auth access tokens.

Supabase signs access tokens with the project's asymmetric key (ES256/RS256)
and publishes the public keys at `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`.
We fetch and cache that key set, then check signature, expiry, audience and
issuer. No shared secret ever reaches this service.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
from jose import jwt
from jose.exceptions import JWTError

from app.core.config import settings

_ALLOWED_ALGS = ["ES256", "RS256"]
_JWKS_TTL = 600  # seconds
_cache: dict[str, Any] = {"keys": None, "at": 0.0}


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str | None
    role: str


def _fetch_jwks() -> dict:
    url = f"{settings.supabase_issuer}/.well-known/jwks.json"
    resp = httpx.get(url, timeout=5)
    resp.raise_for_status()
    return resp.json()


def jwks(force: bool = False) -> dict:
    """The project's public signing keys (cached; refreshed on unknown key ids)."""
    if force or _cache["keys"] is None or time.time() - _cache["at"] > _JWKS_TTL:
        _cache["keys"] = _fetch_jwks()
        _cache["at"] = time.time()
    return _cache["keys"]


def _key_for(token: str) -> dict:
    kid = jwt.get_unverified_header(token).get("kid")
    for force in (False, True):  # retry once with fresh keys (rotation)
        for key in jwks(force).get("keys", []):
            if key.get("kid") == kid:
                return key
    raise ValueError("unknown signing key")


def verify_access_token(token: str) -> AuthUser:
    """Return the signed-in user, or raise ValueError if the token isn't valid for this project."""
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") not in _ALLOWED_ALGS:
            raise ValueError("unexpected signing algorithm")
        claims = jwt.decode(
            token,
            _key_for(token),
            algorithms=_ALLOWED_ALGS,
            audience="authenticated",
            issuer=settings.supabase_issuer,
        )
    except (JWTError, httpx.HTTPError, KeyError) as exc:
        raise ValueError(f"invalid token: {exc}") from exc
    if not claims.get("sub"):
        raise ValueError("token has no subject")
    return AuthUser(id=claims["sub"], email=claims.get("email"), role=claims.get("role", "authenticated"))
