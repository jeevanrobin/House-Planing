"""API hardening: auth on AI routes, rate limits, input bounds, config guards.

Runs without Redis (the limiter uses in-memory storage in development).
"""
import pytest
from fastapi.testclient import TestClient

from app.api.deps import current_user
from app.core.config import Settings
from app.core.rate_limit import limiter
from app.core.supabase_auth import AuthUser
from app.main import app

REQ = dict(plotWidth=12, plotDepth=18, facing="N", floors=1, bedrooms=2, bathrooms=2,
           parking=0, balconies=0)


@pytest.fixture
def client():
    limiter.reset()
    yield TestClient(app)
    app.dependency_overrides.clear()
    limiter.reset()


def as_user():
    app.dependency_overrides[current_user] = lambda: AuthUser(id="u1", email="a@b.co", role="authenticated")


# ---------- AI routes ----------
PLAN = {
    "floors": [{"name": "Ground Floor", "metrics": {"vastuScore": 62},
                "rooms": [{"label": "Living Room", "type": "living", "w": 4.5, "h": 4.2}]}],
    "suggestions": [{"kind": "vastu", "severity": "info", "message": "Vastu compliance 62/100."}],
}
BODY = {"requirements": REQ, "plan": PLAN}


def test_ai_generate_is_gone(client):
    # The engine runs in the browser now; the server no longer generates plans.
    as_user()
    assert client.post("/api/v1/ai/generate", json={"requirements": REQ}).status_code == 404


def test_legacy_auth_routes_are_gone(client):
    # Sign-in is Supabase's job now.
    for path in ("/api/v1/auth/login", "/api/v1/auth/otp/request", "/api/v1/projects", "/api/v1/plots"):
        assert client.post(path, json={}).status_code == 404


def test_ai_suggestions_requires_auth(client):
    assert client.post("/api/v1/ai/suggestions", json=BODY).status_code == 401


def test_ai_suggestions_echoes_engine_tips(client):
    as_user()
    r = client.post("/api/v1/ai/suggestions", json=BODY)
    assert r.status_code == 200
    assert r.json()["suggestions"] == PLAN["suggestions"]
    assert r.json()["ai"] is False  # Vertex isn't configured in tests


def test_ai_suggestions_bounds_plan_size(client):
    as_user()
    rooms = PLAN["floors"][0]["rooms"] * 81
    big = {**PLAN, "floors": [{**PLAN["floors"][0], "rooms": rooms}]}
    assert client.post("/api/v1/ai/suggestions", json={**BODY, "plan": big}).status_code == 422


def test_plot_polygon_size_is_bounded(client):
    as_user()
    huge = [[i % 10, i // 10] for i in range(101)]
    r = client.post("/api/v1/ai/suggestions", json={**BODY, "requirements": {**REQ, "plotPolygon": huge}})
    assert r.status_code == 422


def test_plot_polygon_vertices_must_be_pairs(client):
    as_user()
    bad = [[0, 0, 0], [10, 0], [10, 10]]
    r = client.post("/api/v1/ai/suggestions", json={**BODY, "requirements": {**REQ, "plotPolygon": bad}})
    assert r.status_code == 422


def test_ai_suggestions_is_rate_limited(client):
    as_user()
    codes = [client.post("/api/v1/ai/suggestions", json=BODY).status_code for _ in range(11)]
    assert codes[:10] == [200] * 10
    assert codes[10] == 429


# ---------- config ----------
@pytest.fixture
def clean_env(monkeypatch):
    # CI exports ENV=development; config tests must see only what they pass in.
    for var in ("ENV", "SUPABASE_URL"):
        monkeypatch.delenv(var, raising=False)


def test_env_defaults_to_production(clean_env):
    with pytest.raises(ValueError, match="SUPABASE_URL"):
        Settings(_env_file=None)


def test_production_requires_supabase_url(clean_env):
    with pytest.raises(ValueError, match="SUPABASE_URL"):
        Settings(_env_file=None, ENV="production", SUPABASE_URL="http://insecure.example")


def test_production_accepts_supabase_url(clean_env):
    s = Settings(_env_file=None, ENV="production", SUPABASE_URL="https://abc.supabase.co")
    assert s.supabase_issuer == "https://abc.supabase.co/auth/v1"


def test_development_needs_no_supabase(clean_env):
    assert Settings(_env_file=None, ENV="development").is_dev
