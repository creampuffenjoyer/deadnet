import hmac

from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def constant_time_compare(a: str, b: str) -> bool:
    """Timing-safe string comparison to prevent timing attacks on flag checks."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
