"""Auth flows: refresh rotation + reuse detection, logout, OTP email delivery,
Google sign-in. Runs without Postgres: the session is a scripted fake."""
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.routes import auth as auth_routes
from app.core import security
from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.main import app
from app.models import RefreshToken, User
from app.services import google_auth
from app.services.email import get_email_sender

API = "/api/v1/auth"
FUTURE = datetime.now(timezone.utc) + timedelta(days=1)
PAST = datetime.now(timezone.utc) - timedelta(minutes=1)


class Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class FakeDB:
    """Returns queued values from scalar()/execute() in call order."""

    def __init__(self, scalars=(), executes=()):
        self.scalars = list(scalars)
        self.executes = list(executes)
        self.executed = []
        self.added = []

    async def scalar(self, _stmt):
        return self.scalars.pop(0) if self.scalars else None

    async def execute(self, stmt):
        self.executed.append(stmt)
        return Result(self.executes.pop(0) if self.executes else None)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        # Emulate the column defaults a real INSERT would populate.
        for obj in self.added:
            if isinstance(obj, User):
                obj.id = obj.id or uuid.uuid4()
                obj.is_active = True if obj.is_active is None else obj.is_active
                obj.role = obj.role or "user"

    async def commit(self):
        pass


class FakeMailer:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    async def send(self, to, subject, body):
        if self.fail:
            raise OSError("smtp down")
        self.sent.append((to, subject, body))


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
    return db


def make_user(**kw):
    base = dict(id=uuid.uuid4(), role="user", is_active=True, email="a@b.co",
                email_verified=True, password_hash=None, google_sub=None, last_login_at=None)
    return SimpleNamespace(**{**base, **kw})


def stored_token(user, token, **kw):
    base = dict(id=uuid.uuid4(), user_id=user.id, token_hash=security.hash_token(token),
                expires_at=FUTURE, revoked_at=None)
    return SimpleNamespace(**{**base, **kw})


# ---------- refresh ----------
def test_refresh_rotates_token(client):
    user = make_user()
    token, _ = security.create_refresh_token(str(user.id))
    db = use_db(FakeDB(scalars=[stored_token(user, token), user], executes=["rotated"]))
    r = client.post(f"{API}/refresh", json={"refresh_token": token})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["refresh_token"] != token
    assert security.decode_token(body["access_token"])["sub"] == str(user.id)
    # Old token revoked once; a new refresh token row persisted.
    assert len(db.executed) == 1
    assert any(isinstance(o, RefreshToken) for o in db.added)


def test_refresh_reuse_revokes_all_sessions(client):
    user = make_user()
    token, _ = security.create_refresh_token(str(user.id))
    # The conditional revoke matches nothing: this token was already rotated.
    db = use_db(FakeDB(scalars=[stored_token(user, token)], executes=[None]))
    r = client.post(f"{API}/refresh", json={"refresh_token": token})
    assert r.status_code == 401
    assert "already used" in r.json()["detail"]
    assert len(db.executed) == 2  # rotate attempt + revoke-all
    assert not db.added


def test_refresh_rejects_access_token(client):
    user = make_user()
    access = security.create_access_token(str(user.id))
    # Even with a matching row, only refresh-type tokens may be exchanged.
    use_db(FakeDB(scalars=[stored_token(user, access), user], executes=["rotated"]))
    assert client.post(f"{API}/refresh", json={"refresh_token": access}).status_code == 401


def test_refresh_rejects_unknown_token(client):
    use_db(FakeDB(scalars=[None]))
    token, _ = security.create_refresh_token(str(uuid.uuid4()))
    assert client.post(f"{API}/refresh", json={"refresh_token": token}).status_code == 401


def test_refresh_rejects_garbage(client):
    use_db(FakeDB())
    assert client.post(f"{API}/refresh", json={"refresh_token": "nope"}).status_code == 401


def test_refresh_rejects_expired_row(client):
    user = make_user()
    token, _ = security.create_refresh_token(str(user.id))
    use_db(FakeDB(scalars=[stored_token(user, token, expires_at=PAST)]))
    assert client.post(f"{API}/refresh", json={"refresh_token": token}).status_code == 401


def test_refresh_rejects_token_of_other_user(client):
    user = make_user()
    token, _ = security.create_refresh_token(str(uuid.uuid4()))
    use_db(FakeDB(scalars=[stored_token(user, token)]))
    assert client.post(f"{API}/refresh", json={"refresh_token": token}).status_code == 401


def test_refresh_refuses_disabled_user(client):
    user = make_user(is_active=False)
    token, _ = security.create_refresh_token(str(user.id))
    use_db(FakeDB(scalars=[stored_token(user, token), user], executes=["rotated"]))
    assert client.post(f"{API}/refresh", json={"refresh_token": token}).status_code == 403


def test_logout_revokes(client):
    db = use_db(FakeDB())
    r = client.post(f"{API}/logout", json={"refresh_token": "anything"})
    assert r.status_code == 204
    assert len(db.executed) == 1


# ---------- OTP email ----------
def test_otp_request_emails_the_code(client):
    use_db(FakeDB())
    mailer = FakeMailer()
    app.dependency_overrides[get_email_sender] = lambda: mailer
    r = client.post(f"{API}/otp/request", json={"email": "a@b.co"})
    assert r.status_code == 200
    (to, subject, body), = mailer.sent
    assert to == "a@b.co"
    assert r.json()["dev_code"] in subject and r.json()["dev_code"] in body


def test_otp_request_refuses_without_email_delivery(client):
    db = use_db(FakeDB())
    app.dependency_overrides[get_email_sender] = lambda: None
    r = client.post(f"{API}/otp/request", json={"email": "a@b.co"})
    assert r.status_code == 503
    assert not db.added  # no orphan code stored


def test_otp_request_reports_send_failure(client):
    use_db(FakeDB())
    app.dependency_overrides[get_email_sender] = lambda: FakeMailer(fail=True)
    r = client.post(f"{API}/otp/request", json={"email": "a@b.co"})
    assert r.status_code == 503
    assert "dev_code" not in r.json()


def test_otp_verify_marks_email_verified(client):
    user = make_user(email_verified=False)
    otp = SimpleNamespace(code_hash=security.hash_token("123456"), attempts=0,
                          consumed_at=None, expires_at=FUTURE)
    use_db(FakeDB(scalars=[otp, user]))
    r = client.post(f"{API}/otp/verify", json={"email": "a@b.co", "code": "123456"})
    assert r.status_code == 200
    assert user.email_verified is True
    assert otp.consumed_at is not None


# ---------- Google ----------
CLAIMS = {"sub": "google-123", "email": "a@b.co", "email_verified": True,
          "name": "Asha", "picture": "https://example.com/a.png"}


@pytest.fixture
def google(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com")

    def set_result(claims=None, error=None):
        async def fake_verify(_token):
            if error:
                raise ValueError(error)
            return claims
        monkeypatch.setattr(auth_routes, "verify_google_id_token", fake_verify)
    return set_result


def test_google_not_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "")
    use_db(FakeDB())
    assert client.post(f"{API}/google", json={"id_token": "t"}).status_code == 503


def test_google_invalid_token(client, google):
    google(error="bad signature")
    use_db(FakeDB())
    assert client.post(f"{API}/google", json={"id_token": "t"}).status_code == 401


def test_google_creates_new_user(client, google):
    google(CLAIMS)
    db = use_db(FakeDB(scalars=[None, None]))  # no user by sub, none by email
    r = client.post(f"{API}/google", json={"id_token": "t"})
    assert r.status_code == 200, r.text
    user = next(o for o in db.added if isinstance(o, User))
    assert (user.provider, user.google_sub, user.email_verified) == ("google", "google-123", True)
    assert user.full_name == "Asha"


def test_google_signs_in_linked_user(client, google):
    google(CLAIMS)
    user = make_user(google_sub="google-123")
    use_db(FakeDB(scalars=[user]))
    assert client.post(f"{API}/google", json={"id_token": "t"}).status_code == 200


def test_google_links_unverified_account_and_drops_password(client, google):
    google(CLAIMS)
    squatter = make_user(email_verified=False, password_hash="hash-set-by-someone-else")
    use_db(FakeDB(scalars=[None, squatter]))
    assert client.post(f"{API}/google", json={"id_token": "t"}).status_code == 200
    assert squatter.google_sub == "google-123"
    assert squatter.email_verified is True
    assert squatter.password_hash is None


def test_google_links_verified_account_keeps_password(client, google):
    google(CLAIMS)
    owner = make_user(email_verified=True, password_hash="owners-hash")
    use_db(FakeDB(scalars=[None, owner]))
    assert client.post(f"{API}/google", json={"id_token": "t"}).status_code == 200
    assert owner.password_hash == "owners-hash"


def test_google_verifier_rejects_unverified_email(monkeypatch):
    monkeypatch.setattr(google_auth.id_token, "verify_oauth2_token",
                        lambda *_: {**CLAIMS, "email_verified": False})
    with pytest.raises(ValueError, match="not verified"):
        google_auth._verify_sync("t")


def test_google_verifier_checks_audience(monkeypatch):
    seen = {}

    def fake(token, _request, audience):
        seen["audience"] = audience
        return CLAIMS
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "our-client")
    monkeypatch.setattr(google_auth.id_token, "verify_oauth2_token", fake)
    assert google_auth._verify_sync("t")["sub"] == "google-123"
    assert seen["audience"] == "our-client"
