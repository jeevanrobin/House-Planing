import hmac
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.core import security
from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.models import OtpCode, RefreshToken, User
from app.schemas import (
    GoogleIn, LoginIn, OtpRequestIn, OtpVerifyIn, RefreshIn, SignupIn, TokenOut, UserOut,
)
from app.services.email import EmailSender, get_email_sender, otp_email
from app.services.google_auth import verify_google_id_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

# Wrong guesses allowed per code before it is burned and a new one is required.
MAX_OTP_ATTEMPTS = 5


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _issue_tokens(db: AsyncSession, user: User) -> TokenOut:
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")
    access = security.create_access_token(str(user.id), {"role": user.role})
    refresh, exp = security.create_refresh_token(str(user.id))
    db.add(RefreshToken(user_id=user.id, token_hash=security.hash_token(refresh), expires_at=exp))
    user.last_login_at = _now()
    await db.commit()
    return TokenOut(access_token=access, refresh_token=refresh)


@router.post("/signup", response_model=TokenOut)
@limiter.limit("5/minute")
async def signup(request: Request, body: SignupIn, db: AsyncSession = Depends(get_db)):
    if await db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(email=body.email, full_name=body.full_name,
                password_hash=security.hash_password(body.password))
    db.add(user)
    await db.flush()
    return await _issue_tokens(db, user)


@router.post("/login", response_model=TokenOut)
@limiter.limit("10/minute")
async def login(request: Request, body: LoginIn, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.email == body.email))
    if not user or not user.password_hash or not security.verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    return await _issue_tokens(db, user)


@router.post("/refresh", response_model=TokenOut)
@limiter.limit("30/minute")
async def refresh(request: Request, body: RefreshIn, db: AsyncSession = Depends(get_db)):
    """Rotate a refresh token: revoke it and issue a fresh access/refresh pair.

    Presenting an already-rotated token means it leaked (the legitimate client
    holds the newer one), so every session for that user is revoked.
    """
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token")
    try:
        payload = security.decode_token(body.refresh_token)
    except ValueError:
        raise invalid
    if payload.get("type") != "refresh":
        raise invalid

    stored = await db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == security.hash_token(body.refresh_token))
    )
    if stored is None or str(stored.user_id) != payload.get("sub") or stored.expires_at < _now():
        raise invalid

    # Revoke atomically so two concurrent refreshes can't both succeed.
    rotated = await db.execute(
        update(RefreshToken)
        .where(RefreshToken.id == stored.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
        .returning(RefreshToken.id)
    )
    if rotated.scalar_one_or_none() is None:
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == stored.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=_now())
        )
        await db.commit()
        logger.warning("Refresh token reuse for user %s; all sessions revoked", stored.user_id)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Refresh token was already used; please sign in again.")

    user = await db.scalar(select(User).where(User.id == stored.user_id))
    if user is None:
        raise invalid
    return await _issue_tokens(db, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
async def logout(request: Request, body: RefreshIn, db: AsyncSession = Depends(get_db)):
    """Revoke a refresh token. Idempotent; unknown tokens are ignored."""
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == security.hash_token(body.refresh_token),
               RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/otp/request")
@limiter.limit("5/minute")
async def otp_request(request: Request, body: OtpRequestIn, db: AsyncSession = Depends(get_db),
                      mailer: EmailSender | None = Depends(get_email_sender)):
    if mailer is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Email delivery is not configured.")
    code = security.generate_otp()
    db.add(OtpCode(
        email=body.email, purpose=body.purpose,
        code_hash=security.hash_token(code),
        expires_at=_now() + timedelta(minutes=settings.OTP_TTL_MIN),
    ))
    await db.commit()
    try:
        await mailer.send(body.email, *otp_email(code, body.purpose))
    except Exception:
        logger.exception("Failed to send OTP email")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not send the code; try again.")
    # The code goes out by email only; dev also echoes it to make local testing easy.
    dev = {"dev_code": code} if settings.is_dev else {}
    return {"sent": True, **dev}


@router.post("/otp/verify", response_model=TokenOut)
@limiter.limit("10/minute")
async def otp_verify(request: Request, body: OtpVerifyIn, db: AsyncSession = Depends(get_db)):
    otp = await db.scalar(
        select(OtpCode).where(OtpCode.email == body.email, OtpCode.purpose == body.purpose,
                              OtpCode.consumed_at.is_(None)).order_by(OtpCode.created_at.desc())
    )
    if not otp or otp.expires_at < _now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Code expired or not found")
    if otp.attempts >= MAX_OTP_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Too many attempts; request a new code.")
    if not hmac.compare_digest(otp.code_hash, security.hash_token(body.code)):
        otp.attempts += 1
        await db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid code")
    otp.consumed_at = _now()

    user = await db.scalar(select(User).where(User.email == body.email))
    if not user:
        user = User(email=body.email)
        db.add(user)
    # Receiving the code proves the user controls this inbox.
    user.email_verified = True
    await db.flush()
    return await _issue_tokens(db, user)


@router.post("/google", response_model=TokenOut)
@limiter.limit("10/minute")
async def google_login(request: Request, body: GoogleIn, db: AsyncSession = Depends(get_db)):
    """Verify a Google ID token, link or create the user, issue our own JWTs."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Google sign-in is not configured.")
    try:
        claims = await verify_google_id_token(body.id_token)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid Google credential")

    sub, email = claims["sub"], claims["email"]
    user = await db.scalar(select(User).where(User.google_sub == sub))
    if user is None:
        user = await db.scalar(select(User).where(User.email == email))
        if user is not None:
            # Google has verified this inbox. If our account was never verified,
            # someone else may have registered it with a password: drop that
            # password so only the inbox owner keeps access.
            if not user.email_verified:
                user.password_hash = None
            user.google_sub = sub
        else:
            user = User(email=email, provider="google", google_sub=sub,
                        full_name=claims.get("name"), avatar_url=claims.get("picture"))
            db.add(user)
        user.email_verified = True
        await db.flush()
    return await _issue_tokens(db, user)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)):
    return UserOut(id=str(user.id), email=user.email, full_name=user.full_name,
                   role=user.role, provider=user.provider)
