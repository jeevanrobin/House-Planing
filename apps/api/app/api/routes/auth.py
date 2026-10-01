import hmac
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.core import security
from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.models import OtpCode, RefreshToken, User
from app.schemas import (
    GoogleIn, LoginIn, OtpRequestIn, OtpVerifyIn, SignupIn, TokenOut, UserOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# Wrong guesses allowed per code before it is burned and a new one is required.
MAX_OTP_ATTEMPTS = 5


async def _issue_tokens(db: AsyncSession, user: User) -> TokenOut:
    access = security.create_access_token(str(user.id), {"role": user.role})
    refresh, exp = security.create_refresh_token(str(user.id))
    db.add(RefreshToken(user_id=user.id, token_hash=security.hash_token(refresh), expires_at=exp))
    user.last_login_at = datetime.now(timezone.utc)
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


@router.post("/otp/request")
@limiter.limit("5/minute")
async def otp_request(request: Request, body: OtpRequestIn, db: AsyncSession = Depends(get_db)):
    code = security.generate_otp()
    db.add(OtpCode(
        email=body.email, purpose=body.purpose,
        code_hash=security.hash_token(code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.OTP_TTL_MIN),
    ))
    await db.commit()
    # In production: dispatch via email/SMS provider. Never return the code.
    dev = {"dev_code": code} if settings.is_dev else {}
    return {"sent": True, **dev}


@router.post("/otp/verify", response_model=TokenOut)
@limiter.limit("10/minute")
async def otp_verify(request: Request, body: OtpVerifyIn, db: AsyncSession = Depends(get_db)):
    otp = await db.scalar(
        select(OtpCode).where(OtpCode.email == body.email, OtpCode.purpose == body.purpose,
                              OtpCode.consumed_at.is_(None)).order_by(OtpCode.created_at.desc())
    )
    if not otp or otp.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Code expired or not found")
    if otp.attempts >= MAX_OTP_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Too many attempts; request a new code.")
    if not hmac.compare_digest(otp.code_hash, security.hash_token(body.code)):
        otp.attempts += 1
        await db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid code")
    otp.consumed_at = datetime.now(timezone.utc)

    user = await db.scalar(select(User).where(User.email == body.email))
    if not user:
        user = User(email=body.email, email_verified=True)
        db.add(user)
        await db.flush()
    return await _issue_tokens(db, user)


@router.post("/google", response_model=TokenOut)
@limiter.limit("10/minute")
async def google_login(request: Request, body: GoogleIn, db: AsyncSession = Depends(get_db)):
    """Verify a Google ID token, upsert the user, issue our own JWTs.

    Token verification against Google's certs is wired in production; the
    scaffold validates structure and treats `sub`/`email` claims as trusted.
    """
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED,
                        "Configure GOOGLE_CLIENT_ID and enable token verification.")


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)):
    return UserOut(id=str(user.id), email=user.email, full_name=user.full_name,
                   role=user.role, provider=user.provider)
