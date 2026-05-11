"""
DEADNET Attack Simulation
Authorized red-team test against the local instance.
Covers: outsider recon, unauthenticated probes, brute-force, insider privilege
escalation, IDOR, flag brute-force, and JWT abuse.
"""

import json
import time
import uuid
import base64
import requests

BASE = "http://localhost:8000"
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BOLD  = "\033[1m"
RED   = "\033[91m"
GREEN = "\033[92m"
YELLOW= "\033[93m"
CYAN  = "\033[96m"
RESET = "\033[0m"


def hdr(title: str):
    print(f"\n{BOLD}{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{'='*60}{RESET}")


def result(label: str, status: int, body: str, expected_fail: bool = False):
    ok = (status >= 400) if expected_fail else (status < 400)
    icon = f"{GREEN}✓ BLOCKED{RESET}" if (expected_fail and status >= 400) else \
           f"{RED}✗ EXPOSED{RESET}" if (expected_fail and status < 400) else \
           f"{GREEN}✓ OK{RESET}" if ok else f"{RED}✗ FAILED{RESET}"
    print(f"  [{status}] {label}: {icon}")
    return status, body


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1 — OUTSIDER (no credentials)
# ─────────────────────────────────────────────────────────────────────────────

hdr("PHASE 1: OUTSIDER RECONNAISSANCE")

print(f"\n{YELLOW}[1.1] Information Disclosure — common paths{RESET}")
leak_paths = [
    "/.env",
    "/.git/config",
    "/admin",
    "/debug",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/metrics",
    "/health",
    "/robots.txt",
]
for path in leak_paths:
    r = requests.get(BASE + path, timeout=5)
    # /docs and /openapi.json are FastAPI defaults — may expose full API surface
    is_sensitive = path in ("/docs", "/openapi.json", "/redoc", "/.env", "/.git/config")
    result(path, r.status_code, r.text[:100], expected_fail=is_sensitive)

print(f"\n{YELLOW}[1.2] Unauthenticated access to protected endpoints{RESET}")
protected = [
    "/contracts/",
    "/auth/me",
    "/bounty-board/netrunners",
    "/admin/users",
    "/files/anything.zip",
    "/v01d/contracts",
    "/v01d/signal",
    "/stats/",
]
for path in protected:
    r = requests.get(BASE + path, timeout=5)
    result(path, r.status_code, r.text[:80], expected_fail=True)

print(f"\n{YELLOW}[1.3] Username enumeration via /auth/register{RESET}")
# Known username "admin" should return CALLSIGN_TAKEN
r = requests.post(BASE + "/auth/register", json={
    "username": "admin",
    "email": "probe@attacker.net",
    "password": "Atk@12345"
}, timeout=5)
print(f"  [register 'admin'] status={r.status_code} body={r.text[:80]}")
if "CALLSIGN_TAKEN" in r.text:
    print(f"  {RED}✗ USERNAME ENUMERATION: 'admin' confirmed to exist{RESET}")
else:
    print(f"  {GREEN}✓ No username leak{RESET}")

print(f"\n{YELLOW}[1.4] Email enumeration via /auth/forgot-password{RESET}")
r = requests.post(BASE + "/auth/forgot-password", json={"email": "admin@deadnet.local"}, timeout=5)
print(f"  [forgot-password admin@deadnet.local] status={r.status_code} body={r.text[:80]}")
r2 = requests.post(BASE + "/auth/forgot-password", json={"email": "definitely_not_real_xyz@nope.com"}, timeout=5)
print(f"  [forgot-password fake@nope.com]        status={r2.status_code} body={r2.text[:80]}")
if r.text == r2.text:
    print(f"  {GREEN}✓ Responses identical — enumeration protected{RESET}")
else:
    print(f"  {RED}✗ DIFFERENT RESPONSES — email enumeration possible{RESET}")

print(f"\n{YELLOW}[1.5] Login brute-force — verify lockout triggers{RESET}")
lockout_triggered = False
for i in range(7):
    r = requests.post(BASE + "/auth/login", json={
        "username": "admin",
        "password": f"wrong_password_{i}"
    }, timeout=5)
    print(f"  attempt {i+1}: status={r.status_code} body={r.text[:60]}")
    if r.status_code == 429:
        print(f"  {GREEN}✓ LOCKOUT triggered at attempt {i+1}{RESET}")
        lockout_triggered = True
        break
if not lockout_triggered:
    print(f"  {RED}✗ Lockout NOT triggered after 7 attempts{RESET}")

print(f"\n{YELLOW}[1.6] Architect brute-force — separate lockout{RESET}")
arch_locked = False
arch_attempts = [
    ("s0L", "password"),
    ("s0L", "deadnet123"),
    ("s0L", "admin"),
    ("s0L", "deadnet"),
    ("s0L", "s0L"),
]
for callsign, pwd in arch_attempts:
    r = requests.post(BASE + "/auth/login", json={"username": callsign, "password": pwd}, timeout=5)
    print(f"  [{callsign}:{pwd}] status={r.status_code} body={r.text[:60]}")
    if r.status_code == 429:
        print(f"  {GREEN}✓ Architect lockout active{RESET}")
        arch_locked = True
        break

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 — INSIDER ATTACKS (register a fresh attacker account)
# ─────────────────────────────────────────────────────────────────────────────

hdr("PHASE 2: INSIDER ATTACKS (authenticated operative)")

# Create attacker account
attacker_name = f"attacker_{uuid.uuid4().hex[:6]}"
attacker_email = f"{attacker_name}@evil.test"
attacker_pw = "Attacker@99"

print(f"\n{YELLOW}[2.0] Registering attacker account: {attacker_name}{RESET}")
r = requests.post(BASE + "/auth/register", json={
    "username": attacker_name,
    "email": attacker_email,
    "password": attacker_pw
}, timeout=5)
print(f"  register: status={r.status_code} body={r.text[:80]}")

# Since email verification is required, we need to bypass it via admin API
# First, log in as admin to manually verify the attacker account
print(f"\n{YELLOW}[2.0b] Admin login to manually verify attacker account{RESET}")
admin_r = requests.post(BASE + "/auth/login", json={
    "username": "admin",
    "password": "Admin@Deadnet1"
}, timeout=5)
if admin_r.status_code == 200:
    admin_token = admin_r.json()["access_token"]
    print(f"  {GREEN}✓ Admin logged in{RESET}")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # Find the attacker user and verify them
    users_r = requests.get(BASE + "/admin/users", headers=admin_headers, timeout=5)
    if users_r.status_code == 200:
        users = users_r.json()
        attacker_user = next((u for u in users if u.get("username") == attacker_name), None)
        if attacker_user:
            uid = attacker_user["id"]
            verify_r = requests.post(BASE + f"/admin/users/{uid}/verify", headers=admin_headers, timeout=5)
            print(f"  verify attacker: status={verify_r.status_code}")
        else:
            print(f"  {RED}Could not find attacker in user list{RESET}")
else:
    print(f"  {RED}Admin login failed (may be locked out from brute-force phase): {admin_r.status_code}{RESET}")
    admin_token = None

# Wait a moment then try to log in
time.sleep(1)
atk_login = requests.post(BASE + "/auth/login", json={
    "username": attacker_name,
    "password": attacker_pw
}, timeout=5)
print(f"\n  attacker login: status={atk_login.status_code} body={atk_login.text[:80]}")

if atk_login.status_code != 200:
    print(f"  {RED}Attacker login failed — skipping insider tests{RESET}")
    atk_token = None
    atk_headers = {}
else:
    atk_token = atk_login.json()["access_token"]
    atk_headers = {"Authorization": f"Bearer {atk_token}"}
    print(f"  {GREEN}✓ Attacker is authenticated{RESET}")

if atk_token:
    print(f"\n{YELLOW}[2.1] Horizontal privilege escalation — access admin endpoints{RESET}")
    admin_endpoints = [
        ("GET",   "/admin/users"),
        ("GET",   "/admin/settings"),
        ("GET",   "/admin/assignments"),
        ("PATCH", "/admin/settings"),
        ("GET",   "/architect/overview"),
        ("GET",   "/architect/log"),
        ("GET",   "/stats/"),
    ]
    for method, path in admin_endpoints:
        if method == "GET":
            r = requests.get(BASE + path, headers=atk_headers, timeout=5)
        else:
            r = requests.patch(BASE + path, headers=atk_headers, json={}, timeout=5)
        result(f"{method} {path}", r.status_code, r.text[:60], expected_fail=True)

    print(f"\n{YELLOW}[2.2] Flag brute-force — test rate limiting per contract{RESET}")
    # Get contract list first
    event_r = requests.get(BASE + "/contracts/", headers=atk_headers, timeout=5)
    if event_r.status_code == 403:
        print(f"  {YELLOW}Competition not active — flag submission blocked (expected){RESET}")
        print(f"  Trying anyway to test rate limit behavior...")
        # Grab a contract ID from admin perspective if possible
        contract_id = None
        if admin_token:
            contracts_admin = requests.get(BASE + "/contracts/", headers=admin_headers, timeout=5)
            if contracts_admin.status_code == 200:
                contracts_list = contracts_admin.json()
                if contracts_list:
                    contract_id = contracts_list[0]["id"]

        if contract_id:
            print(f"  Submitting wrong flags to contract {contract_id[:8]}...")
            for i in range(7):
                r = requests.post(BASE + f"/contracts/{contract_id}/claim",
                    headers=atk_headers,
                    json={"flag": f"DEADNET{{wrong_flag_{i}}}"},
                    timeout=5
                )
                print(f"    attempt {i+1}: status={r.status_code} body={r.text[:60]}")
                if r.status_code == 429:
                    print(f"    {GREEN}✓ Rate limit triggered at attempt {i+1}{RESET}")
                    break
    elif event_r.status_code == 200:
        contracts_list = event_r.json()
        if contracts_list:
            contract_id = contracts_list[0]["id"]
            print(f"  Target contract: {contracts_list[0]['title']} ({contract_id[:8]}...)")
            for i in range(7):
                r = requests.post(BASE + f"/contracts/{contract_id}/claim",
                    headers=atk_headers,
                    json={"flag": f"DEADNET{{wrong_flag_{i}}}"},
                    timeout=5
                )
                print(f"    attempt {i+1}: status={r.status_code} body={r.text[:60]}")
                if r.status_code == 429:
                    print(f"    {GREEN}✓ Rate limit triggered at attempt {i+1}{RESET}")
                    break

    print(f"\n{YELLOW}[2.3] IDOR — access other users' data{RESET}")
    # Try to enumerate users by ID
    if admin_token:
        users_r = requests.get(BASE + "/admin/users", headers=admin_headers, timeout=5)
        if users_r.status_code == 200:
            all_users = users_r.json()
            if all_users:
                victim_user = next((u for u in all_users if u.get("username") != attacker_name), None)
                if victim_user:
                    victim_id = victim_user["id"]
                    print(f"  Target user: {victim_user['username']} ({victim_id[:8]}...)")
                    # Try accessing victim profile with attacker token
                    r = requests.get(BASE + f"/operatives/{victim_id}", headers=atk_headers, timeout=5)
                    result(f"GET /operatives/{{victim_id}}", r.status_code, r.text[:80])
                    # Try to read admin user details
                    r2 = requests.get(BASE + f"/admin/users/{victim_id}", headers=atk_headers, timeout=5)
                    result(f"GET /admin/users/{{victim_id}} (as attacker)", r2.status_code, r2.text[:80], expected_fail=True)

    print(f"\n{YELLOW}[2.4] Intel drop content before purchase{RESET}")
    # Try to get intel content without paying
    if admin_token:
        contracts_admin = requests.get(BASE + "/contracts/", headers=admin_headers, timeout=5)
        if contracts_admin.status_code == 200:
            all_contracts = contracts_admin.json()
            for c in all_contracts[:3]:
                intel_r = requests.get(BASE + f"/contracts/{c['id']}/intel", headers=atk_headers, timeout=5)
                if intel_r.status_code == 200:
                    drops = intel_r.json()
                    unpurchased_with_content = [
                        d for d in drops
                        if not d.get("is_purchased") and d.get("content") is not None
                    ]
                    if unpurchased_with_content:
                        print(f"  {RED}✗ INTEL LEAK: contract {c['title'][:20]} reveals content without purchase{RESET}")
                    else:
                        print(f"  {GREEN}✓ {c['title'][:20]}: unpurchased drops have null content{RESET}")
                elif intel_r.status_code == 403:
                    print(f"  {YELLOW}  {c['title'][:20]}: blocked (competition not active){RESET}")

    print(f"\n{YELLOW}[2.5] JWT manipulation — forge role escalation{RESET}")
    # Decode token, modify role, re-sign with wrong key
    parts = atk_token.split(".")
    if len(parts) == 3:
        # Decode payload
        padding = 4 - len(parts[1]) % 4
        padded = parts[1] + "=" * padding
        payload_bytes = base64.urlsafe_b64decode(padded)
        payload = json.loads(payload_bytes)
        print(f"  Original role: {payload.get('role')}")

        # Attempt 1: alg=none attack
        header_none = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=").decode()
        payload["role"] = "ADMIN"
        payload_mod = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
        forged_none = f"{header_none}.{payload_mod}."
        r = requests.get(BASE + "/auth/me", headers={"Authorization": f"Bearer {forged_none}"}, timeout=5)
        result("JWT alg=none forgery", r.status_code, r.text[:60], expected_fail=True)

        # Attempt 2: wrong signing key
        import hmac, hashlib
        fake_key = b"wrong_secret"
        msg = f"{header_none}.{payload_mod}".encode()
        sig = base64.urlsafe_b64encode(hmac.new(fake_key, msg, hashlib.sha256).digest()).rstrip(b"=").decode()
        forged_signed = f"{header_none}.{payload_mod}.{sig}"
        r2 = requests.get(BASE + "/auth/me", headers={"Authorization": f"Bearer {forged_signed}"}, timeout=5)
        result("JWT wrong-key forgery", r2.status_code, r2.text[:60], expected_fail=True)

    print(f"\n{YELLOW}[2.6] SQL injection probes in flag submission{RESET}")
    sqli_payloads = [
        "' OR '1'='1",
        "'; DROP TABLE contracts; --",
        "DEADNET{' OR 1=1 --}",
        "admin'--",
        "1; SELECT * FROM users --",
    ]
    if admin_token:
        contracts_admin = requests.get(BASE + "/contracts/", headers=admin_headers, timeout=5)
        if contracts_admin.status_code == 200 and contracts_admin.json():
            target_id = contracts_admin.json()[0]["id"]
            for payload in sqli_payloads:
                r = requests.post(BASE + f"/contracts/{target_id}/claim",
                    headers=atk_headers,
                    json={"flag": payload},
                    timeout=5
                )
                is_safe = r.status_code in (400, 403, 429)
                icon = f"{GREEN}✓ safe{RESET}" if is_safe else f"{RED}✗ UNSAFE{RESET}"
                print(f"  [{r.status_code}] {repr(payload[:40])}: {icon}")

    print(f"\n{YELLOW}[2.7] Path traversal in file download{RESET}")
    traversal_paths = [
        "../etc/passwd",
        "..%2Fetc%2Fpasswd",
        "....//....//etc/passwd",
        "%2e%2e%2fetc%2fpasswd",
        "valid_file/../../../etc/passwd",
    ]
    for path in traversal_paths:
        r = requests.get(BASE + f"/files/{path}", headers=atk_headers, timeout=5)
        result(f"/files/{path[:30]}", r.status_code, r.text[:60], expected_fail=True)

    print(f"\n{YELLOW}[2.8] Void contract access without key-sequence session{RESET}")
    # Try to claim void contract without having done the /v01d/authorize
    void_r = requests.get(BASE + "/v01d/contracts", headers=atk_headers, timeout=5)
    print(f"  GET /v01d/contracts (no void session): status={void_r.status_code} body={void_r.text[:80]}")
    # /v01d/signal should now require auth
    signal_r = requests.get(BASE + "/v01d/signal", timeout=5)
    result("/v01d/signal (unauthenticated)", signal_r.status_code, signal_r.text[:60], expected_fail=True)
    signal_auth_r = requests.get(BASE + "/v01d/signal", headers=atk_headers, timeout=5)
    result("/v01d/signal (authenticated)", signal_auth_r.status_code, signal_auth_r.text[:60], expected_fail=False)

    print(f"\n{YELLOW}[2.9] Registration endpoint rate limit{RESET}")
    hit_limit = False
    for i in range(25):
        r = requests.post(BASE + "/auth/register", json={
            "username": f"spamuser_{uuid.uuid4().hex[:6]}",
            "email": f"spam_{i}@test.local",
            "password": "Spam@1234"
        }, timeout=5)
        if r.status_code == 429:
            print(f"  {GREEN}✓ Rate limit triggered at registration attempt {i+1}{RESET}")
            hit_limit = True
            break
    if not hit_limit:
        print(f"  {RED}✗ No rate limit hit after 25 registration attempts{RESET}")

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 3 — SECRET KEY STRENGTH TEST
# ─────────────────────────────────────────────────────────────────────────────

hdr("PHASE 3: JWT SECRET STRENGTH CHECK")

# Try the old weak key — should now fail since we rotated it
print(f"\n{YELLOW}[3.1] Attempt to forge JWT with old known weak key{RESET}")
import hmac, hashlib

old_key = b"deadnet-super-secret-key-change-in-production-please-32chars"
import json as _json

header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=").decode()
fake_payload = _json.dumps({
    "sub": "00000000-0000-0000-0000-000000000001",
    "role": "ADMIN",
    "type": "access",
    "exp": int(time.time()) + 3600,
    "iat": int(time.time()),
    "jti": str(uuid.uuid4()),
}).encode()
fake_payload_b64 = base64.urlsafe_b64encode(fake_payload).rstrip(b"=").decode()
msg = f"{header}.{fake_payload_b64}".encode()
sig = base64.urlsafe_b64encode(
    hmac.new(old_key, msg, hashlib.sha256).digest()
).rstrip(b"=").decode()
forged_old_key = f"{header}.{fake_payload_b64}.{sig}"

r = requests.get(BASE + "/auth/me", headers={"Authorization": f"Bearer {forged_old_key}"}, timeout=5)
result("Admin JWT forged with OLD key", r.status_code, r.text[:80], expected_fail=True)

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

hdr("SIMULATION COMPLETE")
print("""
Review the output above:
  ✓ BLOCKED / ✓ OK  — defense is working
  ✗ EXPOSED / ✗ FAILED — needs attention
""")
