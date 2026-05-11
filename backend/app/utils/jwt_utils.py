import uuid
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt

from app.config import settings


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    now = datetime.utcnow()
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update(
        {
            "exp": expire,
            "iat": int(now.timestamp()),
            "jti": str(uuid.uuid4()),
            "type": "access",
        }
    )
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update(
        {
            "exp": expire,
            "jti": str(uuid.uuid4()),
            "type": "refresh",
        }
    )
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None


# ---------------------------------------------------------------------------
# Architect tokens — signed with a separate secret, never touch the users table
# ---------------------------------------------------------------------------

_ARCHITECT_EXPIRE_HOURS = 8


def create_architect_token(callsign: str) -> str:
    now = datetime.utcnow()
    expire = now + timedelta(hours=_ARCHITECT_EXPIRE_HOURS)
    payload = {
        "sub": callsign,
        "role": "ARCHITECT",
        "iat": int(now.timestamp()),
        "exp": expire,
        "jti": str(uuid.uuid4()),
        "type": "access",
    }
    return jwt.encode(payload, settings.ARCHITECT_SECRET, algorithm=settings.ALGORITHM)


_PENDING_TOKEN_EXPIRE_DAYS = 7


def create_pending_token(callsign: str, email: str, role: str, status: str) -> str:
    """Limited-scope JWT for CONTRACTOR/HANDLER awaiting admin approval.
    type='pending' — accepted ONLY by /auth/pending-status and /auth/resend-verification."""
    now = datetime.utcnow()
    expire = now + timedelta(days=_PENDING_TOKEN_EXPIRE_DAYS)
    payload = {
        "callsign": callsign,
        "email": email,
        "role": role,
        "status": status,
        "iat": int(now.timestamp()),
        "exp": expire,
        "jti": str(uuid.uuid4()),
        "type": "pending",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_architect_token(token: str) -> Optional[dict]:
    """Return payload if token is a valid architect token, else None."""
    try:
        return jwt.decode(token, settings.ARCHITECT_SECRET, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
