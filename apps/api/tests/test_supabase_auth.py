"""Supabase access-token verification against a JWKS (a locally generated ES256 key)."""
import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from jose import jwk, jwt

from app.core import supabase_auth
from app.core.config import settings
from app.core.rate_limit import limiter
from app.main import app


def make_key(kid: str):
    private = ec.generate_private_key(ec.SECP256R1())
    pem = private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public = private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    public_jwk = jwk.construct(public, algorithm="ES256").to_dict()
    public_jwk.update({"kid": kid, "alg": "ES256", "use": "sig"})
    return pem, public_jwk


PROJECT = "https://test-project.supabase.co"
GOOD_PEM, GOOD_JWK = make_key("good")
OTHER_PEM, _ = make_key("good")  # same kid, different key: a forgery


@pytest.fixture(autouse=True)
def project(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_URL", PROJECT)
    monkeypatch.setattr(supabase_auth, "_fetch_jwks", lambda: {"keys": [GOOD_JWK]})
    supabase_auth._cache.update(keys=None, at=0.0)
    limiter.reset()
    yield
    supabase_auth._cache.update(keys=None, at=0.0)


def token(pem=GOOD_PEM, kid="good", **overrides):
    claims = {
        "sub": "8d3f3e2a-0000-4000-8000-000000000001", "email": "a@b.co", "role": "authenticated",
        "aud": "authenticated", "iss": f"{PROJECT}/auth/v1", "exp": int(time.time()) + 600, **overrides,
    }
    return jwt.encode(claims, pem, algorithm="ES256", headers={"kid": kid})


def test_valid_token_is_accepted():
    user = supabase_auth.verify_access_token(token())
    assert user.id.startswith("8d3f3e2a") and user.email == "a@b.co"


@pytest.mark.parametrize("bad", [
    {"exp": int(time.time()) - 10},
    {"aud": "anon"},
    {"iss": "https://someone-else.supabase.co/auth/v1"},
])
def test_wrong_claims_are_rejected(bad):
    with pytest.raises(ValueError):
        supabase_auth.verify_access_token(token(**bad))


def test_forged_signature_is_rejected():
    with pytest.raises(ValueError):
        supabase_auth.verify_access_token(token(pem=OTHER_PEM))


def test_unknown_key_is_rejected():
    with pytest.raises(ValueError):
        supabase_auth.verify_access_token(token(kid="nope"))


def test_hs256_tokens_are_rejected():
    forged = jwt.encode({"sub": "x", "aud": "authenticated", "iss": f"{PROJECT}/auth/v1", "exp": int(time.time()) + 60},
                        "secret", algorithm="HS256", headers={"kid": "good"})
    with pytest.raises(ValueError):
        supabase_auth.verify_access_token(forged)


def test_route_accepts_supabase_bearer():
    body = {
        "requirements": dict(plotWidth=12, plotDepth=18, facing="N", floors=1, bedrooms=2, bathrooms=2, parking=0, balconies=0),
        "plan": {"floors": [{"name": "Ground Floor", "metrics": {"vastuScore": 60}, "rooms": []}]},
    }
    client = TestClient(app)
    assert client.post("/api/v1/ai/suggestions", json=body, headers={"Authorization": f"Bearer {token()}"}).status_code == 200
    assert client.post("/api/v1/ai/suggestions", json=body, headers={"Authorization": "Bearer junk"}).status_code == 401
