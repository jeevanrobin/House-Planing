"""API hardening: rate limits, OTP lockout, auth on AI routes, config guards.

Runs without Postgres/Redis: the DB session is replaced with a small fake and
the limiter falls back to in-memory storage.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.deps import current_user
from app.api.routes.auth import MAX_OTP_ATTEMPTS
from app.core.config import Settings
from app.core.rate_limit import limiter
from app.core.security import hash_token
from app.db.session import get_db
from app.main import app

REQ = dict(plotWidth=12, plotDepth=18, facing="N", floors=1, bedrooms=2, bathrooms=2,
           parking=0, balconies=0)


class FakeDB:
    """Just enough of AsyncSession for the auth routes under test."""

    def __init__(self, scalar_result=None):
        self.scalar_result = scalar_result
        self.added = []

    async def scalar(self, _stmt):
        return self.scalar_result

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        pass

    async def flush(self):
        pass


@pytest.fixture
def client():
    limiter.reset()
    yield TestClient(app)
    app.dependency_overrides.clear()
    limiter.reset()


def use_db(db):
    async def _get_db():
        yield db
    app.dependency_overrides[get_db] = _get_db


def as_user():
    app.dependency_overrides[current_user] = lambda: SimpleNamespace(id="u1", role="user")


# ---------- AI routes ----------
def test_ai_generate_requires_auth(client):
    assert client.post("/api/v1/ai/generate", json={"requirements": REQ}).status_code == 401


def test_ai_suggestions_requires_auth(client):
    assert client.post("/api/v1/ai/suggestions", json={"requirements": REQ}).status_code == 401


def test_ai_generate_ok_when_authenticated(client):
    as_user()
    r = client.post("/api/v1/ai/generate", json={"requirements": REQ})
    assert r.status_code == 200
    assert r.json()["floors"]


def test_plot_polygon_size_is_bounded(client):
    as_user()
    huge = [[i % 10, i // 10] for i in range(101)]
    r = client.post("/api/v1/ai/generate", json={"requirements": {**REQ, "plotPolygon": huge}})
    assert r.status_code == 422


def test_plot_polygon_vertices_must_be_pairs(client):
    as_user()
    bad = [[0, 0, 0], [10, 0], [10, 10]]
    r = client.post("/api/v1/ai/generate", json={"requirements": {**REQ, "plotPolygon": bad}})
    assert r.status_code == 422


def test_ai_generate_is_rate_limited(client):
    as_user()
    codes = [client.post("/api/v1/ai/generate", json={"requirements": REQ}).status_code
             for _ in range(31)]
    assert codes[:30] == [200] * 30
    assert codes[30] == 429


# ---------- OTP ----------
def test_otp_request_is_rate_limited(client):
    use_db(FakeDB())
    codes = [client.post("/api/v1/auth/otp/request", json={"email": "a@b.co"}).status_code
             for _ in range(6)]
    assert codes == [200] * 5 + [429]


def _otp(code="123456", attempts=0):
    return SimpleNamespace(
        code_hash=hash_token(code), attempts=attempts, consumed_at=None,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )


def test_otp_wrong_code_counts_attempt(client):
    otp = _otp()
    use_db(FakeDB(otp))
    r = client.post("/api/v1/auth/otp/verify", json={"email": "a@b.co", "code": "000000"})
    assert r.status_code == 400
    assert otp.attempts == 1


def test_otp_locked_after_max_attempts(client):
    otp = _otp(attempts=MAX_OTP_ATTEMPTS)
    use_db(FakeDB(otp))
    # Even the correct code is refused once the attempt budget is spent.
    r = client.post("/api/v1/auth/otp/verify", json={"email": "a@b.co", "code": "123456"})
    assert r.status_code == 429
    assert otp.consumed_at is None


def test_otp_code_format_validated(client):
    use_db(FakeDB(_otp()))
    r = client.post("/api/v1/auth/otp/verify", json={"email": "a@b.co", "code": "12ab"})
    assert r.status_code == 422


# ---------- config ----------
def test_production_rejects_default_jwt_secret():
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(_env_file=None, ENV="production")


def test_production_rejects_short_jwt_secret():
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(_env_file=None, ENV="production", JWT_SECRET="short")


def test_env_defaults_to_production():
    with pytest.raises(ValueError):
        Settings(_env_file=None)


def test_production_accepts_strong_secret():
    s = Settings(_env_file=None, ENV="production", JWT_SECRET="x" * 64)
    assert not s.is_dev


def test_development_allows_default_secret():
    assert Settings(_env_file=None, ENV="development").is_dev
