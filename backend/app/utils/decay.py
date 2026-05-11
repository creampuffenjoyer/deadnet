from datetime import datetime, timedelta
from typing import Optional, Tuple


def _get_effective_settings(event, settings: dict) -> dict:
    """Merge per-event decay overrides with platform defaults."""
    mode      = event.decay_mode_override or settings.get("decay_mode", "TIME_BASED")
    t1_hours  = float(event.decay_tier_1_hours_override  or settings.get("decay_tier_1_hours",  "1.0"))
    t1_pct    = int(  event.decay_tier_1_percent_override or settings.get("decay_tier_1_percent", "90"))
    t2_hours  = float(event.decay_tier_2_hours_override  or settings.get("decay_tier_2_hours",  "2.0"))
    t2_pct    = int(  event.decay_tier_2_percent_override or settings.get("decay_tier_2_percent", "75"))
    t3_hours  = float(event.decay_tier_3_hours_override  or settings.get("decay_tier_3_hours",  "3.0"))
    t3_pct    = int(  event.decay_tier_3_percent_override or settings.get("decay_tier_3_percent", "60"))
    floor_pct = int(  event.decay_floor_percent_override  or settings.get("decay_floor_percent",  "50"))
    return {
        "mode":      mode,
        "t1_hours":  t1_hours,  "t1_pct":  t1_pct,
        "t2_hours":  t2_hours,  "t2_pct":  t2_pct,
        "t3_hours":  t3_hours,  "t3_pct":  t3_pct,
        "floor_pct": floor_pct,
    }


def get_current_bc(
    contract_bc: int,
    event,
    settings: dict,
    paused_seconds: float = 0,
    first_blood_at: Optional[datetime] = None,
) -> int:
    """
    Return the current BC value for a contract based on time-based decay.

    Decay starts from first_blood_at (when the first operative solved the contract).
    If no first blood yet, the contract stays at full BC.

    Args:
        contract_bc:    Base BC value set by the contractor.
        event:          Active Event ORM object (or None).
        settings:       Platform settings dict (key → value strings).
        paused_seconds: Cumulative seconds the event has been halted (from Redis).
        first_blood_at: UTC datetime of the first solve on this contract (or None).

    Returns:
        Current BC as an integer (minimum 1).
    """
    if event is None:
        return contract_bc

    eff = _get_effective_settings(event, settings)

    if eff["mode"] == "OFF":
        return contract_bc

    if not event.start_time or event.status != "ACTIVE":
        return contract_bc

    # No first blood yet — contract hasn't been solved, stays at full value
    if first_blood_at is None:
        return contract_bc

    hours_elapsed = max(0.0, (
        (datetime.utcnow() - first_blood_at).total_seconds() - paused_seconds
    ) / 3600)

    floor_pct = eff["floor_pct"]

    if hours_elapsed < eff["t1_hours"]:
        multiplier = 1.0
    elif hours_elapsed < eff["t2_hours"]:
        multiplier = eff["t1_pct"] / 100
    elif hours_elapsed < eff["t3_hours"]:
        multiplier = eff["t2_pct"] / 100
    else:
        multiplier = max(eff["t3_pct"] / 100, floor_pct / 100)

    # Apply floor
    multiplier = max(multiplier, floor_pct / 100)
    return max(1, round(contract_bc * multiplier))


def get_next_decay_info(
    contract_bc: int,
    event,
    settings: dict,
    paused_seconds: float = 0,
    first_blood_at: Optional[datetime] = None,
) -> Tuple[Optional[datetime], Optional[int]]:
    """
    Return (next_decay_at, next_decay_bc).
    Both are None if decay is OFF, event is not active, no first blood yet,
    or BC is already at floor.

    next_decay_at: UTC datetime when the next BC drop will occur.
    next_decay_bc: BC value after that drop.
    """
    if event is None:
        return None, None

    eff = _get_effective_settings(event, settings)

    if eff["mode"] == "OFF":
        return None, None

    if not event.start_time or event.status != "ACTIVE":
        return None, None

    # No first blood — decay hasn't started yet
    if first_blood_at is None:
        return None, None

    now = datetime.utcnow()
    hours_elapsed = max(0.0, (
        (now - first_blood_at).total_seconds() - paused_seconds
    ) / 3600)

    floor_pct = eff["floor_pct"]
    current_bc = get_current_bc(contract_bc, event, settings, paused_seconds, first_blood_at)

    def _at_hours(h: float) -> datetime:
        """Actual wall-clock time when h effective hours since first blood are reached."""
        return first_blood_at + timedelta(hours=h) + timedelta(seconds=paused_seconds)

    if hours_elapsed < eff["t1_hours"]:
        next_pct = max(eff["t1_pct"], floor_pct)
        next_bc  = max(1, round(contract_bc * next_pct / 100))
        if next_bc < current_bc:
            return _at_hours(eff["t1_hours"]), next_bc
        return None, None

    elif hours_elapsed < eff["t2_hours"]:
        next_pct = max(eff["t2_pct"], floor_pct)
        next_bc  = max(1, round(contract_bc * next_pct / 100))
        if next_bc < current_bc:
            return _at_hours(eff["t2_hours"]), next_bc
        return None, None

    elif hours_elapsed < eff["t3_hours"]:
        next_pct = max(eff["t3_pct"], floor_pct)
        next_bc  = max(1, round(contract_bc * next_pct / 100))
        if next_bc < current_bc:
            return _at_hours(eff["t3_hours"]), next_bc
        return None, None

    else:
        # Already at or past T3 — at floor, no further drops
        return None, None
