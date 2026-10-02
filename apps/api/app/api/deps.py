from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.supabase_auth import AuthUser, verify_access_token

bearer = HTTPBearer(auto_error=False)


async def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> AuthUser:
    """The Supabase user behind the request's bearer token."""
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing credentials")
    try:
        return verify_access_token(creds.credentials)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
