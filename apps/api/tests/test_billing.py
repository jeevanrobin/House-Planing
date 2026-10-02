"""Pro unlock: Razorpay order creation and payment verification (external calls mocked)."""
import hashlib
import hmac
import uuid

import pytest
from fastapi.testclient import TestClient

from app.api.deps import current_user
from app.api.routes import billing
from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.supabase_auth import AuthUser
from app.main import app
from app.services import razorpay

SECRET = "test_secret_123"
USER = AuthUser(id="user-1", email="a@example.com", role="authenticated")
PROJECT = str(uuid.uuid4())
AUTH = {"Authorization": "Bearer user-token"}


def sign(order_id: str, payment_id: str) -> str:
    return hmac.new(SECRET.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


@pytest.fixture
def calls(monkeypatch):
    for k, v in {
        "RAZORPAY_KEY_ID": "rzp_test_abc", "RAZORPAY_KEY_SECRET": SECRET, "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_PUBLISHABLE_KEY": "pub", "SUPABASE_SERVICE_ROLE_KEY": "service",
    }.items():
        monkeypatch.setattr(settings, k, v)
    app.dependency_overrides[current_user] = lambda: USER
    limiter.reset()
    log: dict = {"owns": True, "unlocked": False, "recorded": [], "order_notes": {"project_id": PROJECT, "user_id": USER.id}}
    monkeypatch.setattr(billing.supabase_rest, "user_owns_project", lambda token, pid: log["owns"] and token == "user-token")
    monkeypatch.setattr(billing.supabase_rest, "project_unlocked", lambda pid: log["unlocked"])
    monkeypatch.setattr(billing.supabase_rest, "record_unlock", lambda *a: log["recorded"].append(a))
    monkeypatch.setattr(billing.razorpay, "create_order", lambda amount, receipt, notes: {"id": "order_1", "amount": amount, "currency": "INR", "notes": notes})
    monkeypatch.setattr(billing.razorpay, "fetch_order", lambda oid: {"id": oid, "amount": settings.PRO_PRICE_PAISE, "notes": log["order_notes"]})
    yield log
    app.dependency_overrides.clear()


client = TestClient(app)


def test_signature_check():
    assert razorpay.signature_ok("order_1", "pay_1", sign("order_1", "pay_1"), secret=SECRET)
    assert not razorpay.signature_ok("order_1", "pay_2", sign("order_1", "pay_1"), secret=SECRET)


def test_config_is_public_and_hides_the_secret(calls):
    body = client.get("/api/v1/billing/config").json()
    assert body == {"enabled": True, "key_id": "rzp_test_abc", "price_paise": 49900}
    assert SECRET not in str(body)


def test_order_for_own_project(calls):
    r = client.post("/api/v1/billing/orders", json={"project_id": PROJECT}, headers=AUTH)
    assert r.status_code == 200
    assert r.json() == {"order_id": "order_1", "amount": 49900, "currency": "INR", "key_id": "rzp_test_abc"}


def test_no_order_for_someone_elses_project(calls):
    calls["owns"] = False
    assert client.post("/api/v1/billing/orders", json={"project_id": PROJECT}, headers=AUTH).status_code == 404


def test_no_second_order_once_unlocked(calls):
    calls["unlocked"] = True
    assert client.post("/api/v1/billing/orders", json={"project_id": PROJECT}, headers=AUTH).status_code == 409


def test_verify_records_the_unlock(calls):
    body = {"project_id": PROJECT, "razorpay_order_id": "order_1", "razorpay_payment_id": "pay_1",
            "razorpay_signature": sign("order_1", "pay_1")}
    r = client.post("/api/v1/billing/verify", json=body, headers=AUTH)
    assert r.status_code == 200 and r.json() == {"unlocked": True}
    assert calls["recorded"] == [(PROJECT, USER.id, "order_1", "pay_1", 49900)]


def test_verify_rejects_a_forged_signature(calls):
    body = {"project_id": PROJECT, "razorpay_order_id": "order_1", "razorpay_payment_id": "pay_1", "razorpay_signature": "0" * 64}
    assert client.post("/api/v1/billing/verify", json=body, headers=AUTH).status_code == 400
    assert calls["recorded"] == []


def test_verify_rejects_an_order_for_another_project(calls):
    calls["order_notes"] = {"project_id": str(uuid.uuid4()), "user_id": USER.id}
    body = {"project_id": PROJECT, "razorpay_order_id": "order_1", "razorpay_payment_id": "pay_1",
            "razorpay_signature": sign("order_1", "pay_1")}
    assert client.post("/api/v1/billing/verify", json=body, headers=AUTH).status_code == 400
    assert calls["recorded"] == []


def test_payments_off_without_keys(calls, monkeypatch):
    monkeypatch.setattr(settings, "RAZORPAY_KEY_SECRET", "")
    assert client.get("/api/v1/billing/config").json()["enabled"] is False
    assert client.post("/api/v1/billing/orders", json={"project_id": PROJECT}, headers=AUTH).status_code == 503
