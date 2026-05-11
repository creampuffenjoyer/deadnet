from app.redis_client import redis_client

_LOGIN_MAX_FAILURES = 5
_LOGIN_WINDOW = 300   # 5-minute sliding window
_LOGIN_LOCKOUT = 900  # 15-minute lockout after threshold


async def check_rate_limit(key: str, max_calls: int, window_seconds: int) -> bool:
    """Returns True if request is within limit, False if rate limited."""
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, window_seconds)
    return count <= max_calls


async def check_claim_rate_limit(operative_id: str, contract_id: str) -> bool:
    """5 claim attempts per minute per Operative per contract."""
    key = f"claim_rate:{operative_id}:{contract_id}"
    return await check_rate_limit(key, max_calls=5, window_seconds=60)


# ---------------------------------------------------------------------------
# Login brute-force helpers
# ---------------------------------------------------------------------------

async def is_login_locked(username: str) -> bool:
    """True if the account is currently in lockout."""
    return await redis_client.exists(f"login_lock:{username}") > 0


async def record_failed_login(username: str) -> int:
    """Increment failure counter; apply lockout when threshold is reached.
    Returns current failure count."""
    fail_key = f"login_fail:{username}"
    lock_key = f"login_lock:{username}"

    count = await redis_client.incr(fail_key)
    if count == 1:
        await redis_client.expire(fail_key, _LOGIN_WINDOW)

    if count >= _LOGIN_MAX_FAILURES:
        await redis_client.setex(lock_key, _LOGIN_LOCKOUT, "1")

    return count


async def clear_login_failures(username: str) -> None:
    """Clear failure counter and any lockout on successful login."""
    await redis_client.delete(f"login_fail:{username}", f"login_lock:{username}")


# ---------------------------------------------------------------------------
# Flag attempt tracking (max_flag_attempts setting)
# ---------------------------------------------------------------------------

async def increment_flag_attempts(operative_id: str, contract_id: str) -> int:
    """Increment wrong-flag attempt counter (no expiry — persists for competition).
    Returns new count."""
    key = f"flag_attempts:{operative_id}:{contract_id}"
    count = await redis_client.incr(key)
    return count


async def get_flag_attempts(operative_id: str, contract_id: str) -> int:
    key = f"flag_attempts:{operative_id}:{contract_id}"
    val = await redis_client.get(key)
    return int(val) if val else 0
