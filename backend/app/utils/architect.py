"""Multi-Architect credential loader.

Reads ARCHITECT_N_CALLSIGN / ARCHITECT_N_PASSWORD pairs from environment variables
(N = 1, 2, 3, …) and returns them as a list. Stops at the first gap.
"""
import os
from typing import Optional


def load_architects() -> list[dict]:
    """Return list of {callsign, password} dicts for all configured Architects."""
    architects = []
    i = 1
    while True:
        callsign = os.getenv(f"ARCHITECT_{i}_CALLSIGN")
        password = os.getenv(f"ARCHITECT_{i}_PASSWORD")
        if not callsign or not password:
            break
        architects.append({"callsign": callsign.strip(), "password": password})
        i += 1
    return architects


def validate_architect_passwords() -> None:
    """Log warnings for any Architect with a default or empty password."""
    architects = load_architects()
    if not architects:
        print("WARNING: No ARCHITECT_N_CALLSIGN / ARCHITECT_N_PASSWORD entries found. "
              "Architect login will be disabled.")
        return
    i = 1
    for arch in architects:
        pwd = arch["password"]
        if not pwd or pwd in ("CHANGE_THIS", "CHANGE_THIS_BEFORE_DEPLOYMENT",
                              "GENERATE_64_CHAR_RANDOM_STRING"):
            print(
                f"WARNING: ARCHITECT_{i} password is using default value — "
                "change before deploying to production"
            )
        i += 1


def find_architect(callsign: str) -> Optional[dict]:
    """Return the architect entry matching callsign, or None."""
    for arch in load_architects():
        if arch["callsign"] == callsign:
            return arch
    return None
