import logging
import time
from typing import Optional

import redis.asyncio as redis

from app.config import settings

redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)

_ONLINE_WINDOW = 300  # 5 minutes
_ONLINE_ZSET = "online_users"

_logger = logging.getLogger(__name__)


def _redis_warn(fn_name: str) -> None:
    _logger.warning("Redis unavailable in %s — using safe default", fn_name)


async def blacklist_token(jti: str, expires_in: int) -> None:
    """Add a token JTI to the blacklist with its remaining TTL."""
    if expires_in <= 0:
        return
    try:
        await redis_client.setex(f"blacklist:{jti}", expires_in, "1")
    except Exception:
        _redis_warn("blacklist_token")


async def is_token_blacklisted(jti: str) -> bool:
    """Check if a token JTI has been blacklisted."""
    try:
        return await redis_client.exists(f"blacklist:{jti}") > 0
    except Exception:
        _redis_warn("is_token_blacklisted")
        return False  # fail open — valid tokens pass through


# ---------------------------------------------------------------------------
# Online presence tracking (sorted set by last-seen timestamp)
# ---------------------------------------------------------------------------

async def update_last_seen(user_id: str) -> None:
    """Mark a user as online with the current timestamp."""
    try:
        await redis_client.zadd(_ONLINE_ZSET, {user_id: time.time()})
    except Exception:
        _redis_warn("update_last_seen")


async def is_online(user_id: str) -> bool:
    """True if the user was seen within the last 5 minutes."""
    try:
        score = await redis_client.zscore(_ONLINE_ZSET, user_id)
        return score is not None and (time.time() - float(score)) < _ONLINE_WINDOW
    except Exception:
        _redis_warn("is_online")
        return False


async def get_online_count() -> int:
    """Count active users seen within the last 5 minutes."""
    try:
        cutoff = time.time() - _ONLINE_WINDOW
        await redis_client.zremrangebyscore(_ONLINE_ZSET, "-inf", cutoff)
        return await redis_client.zcard(_ONLINE_ZSET)
    except Exception:
        _redis_warn("get_online_count")
        return 0


# ---------------------------------------------------------------------------
# Force logout (invalidate all tokens issued before a given timestamp)
# ---------------------------------------------------------------------------

_FORCE_LOGOUT_TTL = 86400  # 24 hours — covers any access token lifetime


async def set_force_logout_after(user_id: str) -> None:
    """Record the current time as the force-logout boundary for a user."""
    try:
        await redis_client.setex(
            f"force_logout_after:{user_id}",
            _FORCE_LOGOUT_TTL,
            str(int(time.time())),
        )
    except Exception:
        _redis_warn("set_force_logout_after")


async def get_force_logout_after(user_id: str) -> float:
    """Return the force-logout timestamp for a user, or 0.0 if not set."""
    try:
        val = await redis_client.get(f"force_logout_after:{user_id}")
        return float(val) if val else 0.0
    except Exception:
        _redis_warn("get_force_logout_after")
        return 0.0  # fail open — don't force-logout when Redis is down


# ---------------------------------------------------------------------------
# Event reset cooldown (5-minute enforced gap between resets)
# ---------------------------------------------------------------------------

_RESET_COOLDOWN_KEY = "event_reset_last_at"
_RESET_COOLDOWN_SECS = 300  # 5 minutes


async def set_reset_timestamp() -> None:
    """Record the current time as the last event reset timestamp."""
    try:
        await redis_client.setex(_RESET_COOLDOWN_KEY, _RESET_COOLDOWN_SECS * 2, str(int(time.time())))
    except Exception:
        _redis_warn("set_reset_timestamp")


# ---------------------------------------------------------------------------
# Architect lockout — separate key space from normal user lockouts
# ---------------------------------------------------------------------------

_ARCH_FAIL_KEY = "architect_lockout:failures"
_ARCH_LOCK_KEY = "architect_lockout:locked"
_ARCH_FAIL_WINDOW = 300   # 5-minute sliding window
_ARCH_LOCK_DURATION = 900 # 15-minute lockout
_ARCH_MAX_FAILURES = 10


async def is_architect_locked() -> bool:
    try:
        return await redis_client.exists(_ARCH_LOCK_KEY) > 0
    except Exception:
        _redis_warn("is_architect_locked")
        return False  # fail open


async def record_architect_failure() -> None:
    try:
        count = await redis_client.incr(_ARCH_FAIL_KEY)
        if count == 1:
            await redis_client.expire(_ARCH_FAIL_KEY, _ARCH_FAIL_WINDOW)
        if count >= _ARCH_MAX_FAILURES:
            await redis_client.setex(_ARCH_LOCK_KEY, _ARCH_LOCK_DURATION, "1")
    except Exception:
        _redis_warn("record_architect_failure")


async def clear_architect_failures() -> None:
    try:
        await redis_client.delete(_ARCH_FAIL_KEY, _ARCH_LOCK_KEY)
    except Exception:
        _redis_warn("clear_architect_failures")


# ---------------------------------------------------------------------------
# Void session gate — short-lived key set by terminal authorize flow
# ---------------------------------------------------------------------------

_VOID_SESSION_TTL = 600  # 10 minutes


async def set_void_session(user_id: str) -> None:
    """Grant void session access for this user (10-minute TTL)."""
    try:
        await redis_client.setex(f"void_session:{user_id}", _VOID_SESSION_TTL, "granted")
    except Exception:
        _redis_warn("set_void_session")


async def check_void_session(user_id: str) -> bool:
    """Return True if the user has an active void session."""
    try:
        return await redis_client.exists(f"void_session:{user_id}") > 0
    except Exception:
        _redis_warn("check_void_session")
        return False  # fail closed — don't allow void access when Redis is down


async def refresh_void_session(user_id: str) -> bool:
    """Refresh the TTL of an existing void session. Returns True if key existed."""
    try:
        result = await redis_client.expire(f"void_session:{user_id}", _VOID_SESSION_TTL)
        return result == 1
    except Exception:
        _redis_warn("refresh_void_session")
        return False


# ---------------------------------------------------------------------------
# Email rate limiting (resend verification + forgot password)
# 3 requests per hour per email address
# ---------------------------------------------------------------------------

_EMAIL_RL_WINDOW = 3600   # 1 hour
_EMAIL_RL_MAX    = 3


async def check_email_rate_limit(prefix: str, email: str) -> bool:
    """Return True if the email is under the rate limit, False if blocked.

    Keys: resend_verification:{email}  /  forgot_password:{email}
    """
    try:
        key = f"{prefix}:{email.lower()}"
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, _EMAIL_RL_WINDOW)
        return count <= _EMAIL_RL_MAX
    except Exception:
        _redis_warn("check_email_rate_limit")
        return True  # fail open — allow emails when Redis is down


# ---------------------------------------------------------------------------
# Operator request rate limiting
# Max 5 requests per 24 hours per user (Redis counter)
# ---------------------------------------------------------------------------

_REQUEST_DAILY_TTL = 86400  # 24 hours
_REQUEST_DAILY_MAX = 5


async def increment_request_daily(user_id: str) -> int:
    """Increment and return the 24-hour request count for a user."""
    try:
        key = f"request_daily:{user_id}"
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, _REQUEST_DAILY_TTL)
        return count
    except Exception:
        _redis_warn("increment_request_daily")
        return 0


async def get_request_daily_count(user_id: str) -> int:
    """Return how many requests the user has submitted in the last 24 hours."""
    try:
        val = await redis_client.get(f"request_daily:{user_id}")
        return int(val) if val else 0
    except Exception:
        _redis_warn("get_request_daily_count")
        return 0


# ---------------------------------------------------------------------------
# Corrupted Contract rate limiting
# 10 submissions per minute per user per CC
# ---------------------------------------------------------------------------

_CC_RATE_WINDOW = 60   # 1 minute
_CC_RATE_MAX    = 10


async def check_cc_rate_limit(user_id: str, cc_id: str) -> bool:
    """Return True if under the limit, False if blocked."""
    try:
        key = f"cc_rate:{user_id}:{cc_id}"
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, _CC_RATE_WINDOW)
        return count <= _CC_RATE_MAX
    except Exception:
        _redis_warn("check_cc_rate_limit")
        return True


async def check_cc_download_rate_limit(user_id: str) -> bool:
    """Return True if under limit (10/min), False if blocked."""
    try:
        key = f"cc_download:{user_id}"
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, 60)
        return count <= 10
    except Exception:
        _redis_warn("check_cc_download_rate_limit")
        return True


# ---------------------------------------------------------------------------
# Registration rate limiting
# Max 3 CONTRACTOR/HANDLER registrations per IP per 24 hours
# ---------------------------------------------------------------------------

_REG_RATE_WINDOW = 86400   # 24 hours
_REG_RATE_MAX    = 3


async def check_reg_rate_limit(ip: str) -> bool:
    """Return True if under the limit, False if blocked."""
    try:
        key = f"reg_attempt:{ip}"
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, _REG_RATE_WINDOW)
        return count <= _REG_RATE_MAX
    except Exception:
        _redis_warn("check_reg_rate_limit")
        return True


# ---------------------------------------------------------------------------
# Denied account deletion gate
# deny_delete:{user_id} exists for 24h after denial
# If key is gone, the hourly cleanup loop deletes the account
# ---------------------------------------------------------------------------

_DENY_DELETE_TTL = 86400  # 24 hours


async def set_deny_delete(user_id: str) -> None:
    """Set the 24-hour deletion gate for a denied account."""
    try:
        await redis_client.setex(f"deny_delete:{user_id}", _DENY_DELETE_TTL, "pending")
    except Exception:
        _redis_warn("set_deny_delete")


async def check_deny_delete(user_id: str) -> bool:
    """Return True if the key still exists (account should not be deleted yet)."""
    try:
        return await redis_client.exists(f"deny_delete:{user_id}") > 0
    except Exception:
        _redis_warn("check_deny_delete")
        return True  # fail safe — keep the account when Redis is down


# ---------------------------------------------------------------------------
# Registration key regeneration rate limiting
# Max 5 regenerations per event (lifetime counter, no expiry)
# ---------------------------------------------------------------------------

_KEY_REGEN_MAX = 5


async def check_key_regen_rate_limit(event_id: int) -> bool:
    """Increment regeneration counter for this event. Returns True if under limit."""
    try:
        key = f"key_regen:{event_id}"
        count = await redis_client.incr(key)
        return count <= _KEY_REGEN_MAX
    except Exception:
        _redis_warn("check_key_regen_rate_limit")
        return True


async def get_key_regen_count(event_id: int) -> int:
    """Return how many times the key for this event has been regenerated."""
    try:
        val = await redis_client.get(f"key_regen:{event_id}")
        return int(val) if val else 0
    except Exception:
        _redis_warn("get_key_regen_count")
        return 0


# ---------------------------------------------------------------------------
# Registration key rate limiting
# 5 attempts per 10 minutes per user per event
# ---------------------------------------------------------------------------

_KEY_ATTEMPT_WINDOW = 600   # 10 minutes
_KEY_ATTEMPT_MAX    = 5


async def check_key_attempt_rate_limit(user_id: str, event_id: int) -> bool:
    """Return True if under the limit, False if blocked."""
    try:
        key = f"key_attempt:{user_id}:{event_id}"
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, _KEY_ATTEMPT_WINDOW)
        return count <= _KEY_ATTEMPT_MAX
    except Exception:
        _redis_warn("check_key_attempt_rate_limit")
        return True


async def get_key_attempt_ttl(user_id: str, event_id: int) -> int:
    """Return seconds remaining on the rate-limit window, or 0."""
    try:
        ttl = await redis_client.ttl(f"key_attempt:{user_id}:{event_id}")
        return max(0, ttl)
    except Exception:
        _redis_warn("get_key_attempt_ttl")
        return 0


# ---------------------------------------------------------------------------
# Major Event invite code rate limiting
# 5 wrong attempts per 10 minutes per Admin per event
# ---------------------------------------------------------------------------

_MAJOR_INVITE_WINDOW = 600   # 10 minutes
_MAJOR_INVITE_MAX    = 5


async def check_major_invite_rate_limit(user_id: str, event_id: int) -> bool:
    """Return True if under the limit, False if blocked."""
    try:
        key = f"major_invite_attempt:{user_id}:{event_id}"
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, _MAJOR_INVITE_WINDOW)
        return count <= _MAJOR_INVITE_MAX
    except Exception:
        _redis_warn("check_major_invite_rate_limit")
        return True


async def get_major_invite_ttl(user_id: str, event_id: int) -> int:
    """Return seconds remaining on the rate-limit window, or 0."""
    try:
        ttl = await redis_client.ttl(f"major_invite_attempt:{user_id}:{event_id}")
        return max(0, ttl)
    except Exception:
        _redis_warn("get_major_invite_ttl")
        return 0


# ---------------------------------------------------------------------------
# Decay halt tracking — pause/resume decay timer per event
# halt_started:{event_id}     = unix timestamp when event was halted
# total_paused_secs:{event_id} = cumulative seconds the event has been paused
# ---------------------------------------------------------------------------

async def set_halt_started(event_id: int) -> None:
    """Record the current time as the start of a halt period for an event."""
    try:
        await redis_client.set(f"halt_started:{event_id}", str(time.time()))
    except Exception:
        _redis_warn("set_halt_started")


async def get_halt_started(event_id: int) -> Optional[float]:
    """Return the unix timestamp when the event was halted, or None."""
    try:
        val = await redis_client.get(f"halt_started:{event_id}")
        return float(val) if val else None
    except Exception:
        _redis_warn("get_halt_started")
        return None


async def clear_halt_started(event_id: int) -> None:
    """Delete the halt-started marker (call on resume after accounting for duration)."""
    try:
        await redis_client.delete(f"halt_started:{event_id}")
    except Exception:
        _redis_warn("clear_halt_started")


async def add_paused_seconds(event_id: int, seconds: float) -> None:
    """Add seconds to the cumulative paused-time counter for an event."""
    try:
        key = f"total_paused_secs:{event_id}"
        await redis_client.incrbyfloat(key, seconds)
    except Exception:
        _redis_warn("add_paused_seconds")


async def get_paused_seconds(event_id: int) -> float:
    """Return total paused seconds recorded for an event (0.0 if none)."""
    try:
        val = await redis_client.get(f"total_paused_secs:{event_id}")
        return float(val) if val else 0.0
    except Exception:
        _redis_warn("get_paused_seconds")
        return 0.0


async def get_reset_cooldown() -> dict:
    """Return {can_reset: bool, seconds_remaining: int}."""
    try:
        val = await redis_client.get(_RESET_COOLDOWN_KEY)
        if not val:
            return {"can_reset": True, "seconds_remaining": 0}
        last_reset = int(val)
        elapsed = int(time.time()) - last_reset
        remaining = max(0, _RESET_COOLDOWN_SECS - elapsed)
        return {"can_reset": remaining == 0, "seconds_remaining": remaining}
    except Exception:
        _redis_warn("get_reset_cooldown")
        return {"can_reset": True, "seconds_remaining": 0}
