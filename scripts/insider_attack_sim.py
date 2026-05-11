"""
DEADNET Insider Attack Simulation
Assumes admin is accessible (lockout cleared). Tests authenticated attacker.
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import base64, hashlib, hmac, json, time, uuid
import requests

BASE   = "http://localhost:8000"
BOLD   = "\033[1m"
RED    = "\033[91m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RESET  = "\033[0m"


def hdr(t):
    print(f"\n{BOLD}{CYAN}{'='*60}\n  {t}\n{'='*60}{RESET}")


def chk(label, status, body, expect_fail=False):
    ok = (status >= 400) if expect_fail else (status < 400)
    icon = (f"{GREEN}[BLOCKED]{RESET}" if status >= 400 else f"{RED}[EXPOSED]{RESET}") if expect_fail \
        else (f"{GREEN}[OK]{RESET}" if ok else f"{RED}[FAIL]{RESET}")
    print(f"  [{status}] {label}: {icon}  {body[:70]}")
    return ok


# ── Setup: admin + attacker accounts ─────────────────────────────────────────

hdr("SETUP")

admin_r = requests.post(BASE + "/auth/login", json={"username": "admin", "password": "Admin@Deadnet1"}, timeout=5)
if admin_r.status_code != 200:
    print(f"{RED}Admin login failed: {admin_r.text}. Clear lockout first.{RESET}")
    exit(1)
admin_token  = admin_r.json()["access_token"]
admin_h      = {"Authorization": f"Bearer {admin_token}"}
print(f"  {GREEN}Admin authenticated{RESET}")

# Create a fresh attacker operative
atk_name  = f"r3d_0p_{uuid.uuid4().hex[:6]}"
atk_email = f"{atk_name}@evil.test"
atk_pw    = "Attacker@99"

reg_r = requests.post(BASE + "/auth/register", json={
    "username": atk_name, "email": atk_email, "password": atk_pw
}, timeout=5)
print(f"  Register attacker '{atk_name}': {reg_r.status_code}")

# Admin-verify attacker (bypass email)
users_r = requests.get(BASE + "/admin/users", headers=admin_h, timeout=5)
atk_uid  = next((u["id"] for u in users_r.json() if u.get("username") == atk_name), None)
if atk_uid:
    requests.post(BASE + f"/admin/users/{atk_uid}/verify", headers=admin_h, timeout=5)
    print(f"  Admin-verified attacker (id={atk_uid[:8]})")

time.sleep(0.5)
login_r = requests.post(BASE + "/auth/login", json={"username": atk_name, "password": atk_pw}, timeout=5)
if login_r.status_code != 200:
    print(f"{RED}Attacker login failed: {login_r.text}{RESET}")
    exit(1)
atk_token = login_r.json()["access_token"]
atk_h     = {"Authorization": f"Bearer {atk_token}"}
print(f"  {GREEN}Attacker authenticated as OPERATIVE{RESET}")

# Collect test data
all_contracts = requests.get(BASE + "/contracts/", headers=admin_h, timeout=5).json()
target_contract = all_contracts[0] if all_contracts else None
all_users = users_r.json()
victim_user = next((u for u in all_users if u.get("username") not in (atk_name, "admin")), None)


# ── 2.1  Vertical privilege escalation ───────────────────────────────────────
hdr("2.1  VERTICAL PRIVILEGE ESCALATION")

endpoints = [
    ("GET",   "/admin/users"),
    ("GET",   "/admin/settings"),
    ("PATCH", "/admin/settings", {"settings": {"registration_open": "false"}}),
    ("GET",   "/admin/assignments"),
    ("POST",  "/admin/board-freeze", {"frozen": True}),
    ("GET",   "/architect/overview"),
    ("GET",   "/architect/log"),
    ("GET",   "/architect/accounts"),
    ("GET",   "/stats/"),
    ("GET",   "/supervisor/contracts"),
]
for item in endpoints:
    method, path = item[0], item[1]
    body = item[2] if len(item) > 2 else {}
    if method == "GET":
        r = requests.get(BASE + path, headers=atk_h, timeout=5)
    elif method == "PATCH":
        r = requests.patch(BASE + path, headers=atk_h, json=body, timeout=5)
    elif method == "POST":
        r = requests.post(BASE + path, headers=atk_h, json=body, timeout=5)
    chk(f"{method} {path}", r.status_code, r.text[:50], expect_fail=True)


# ── 2.2  JWT forgery attacks ──────────────────────────────────────────────────
hdr("2.2  JWT FORGERY ATTACKS")

parts = atk_token.split(".")
padding = 4 - len(parts[1]) % 4
payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * padding))
print(f"  Attacker JWT role: {payload.get('role')}  sub: {payload.get('sub','')[:8]}")

# alg=none
h_none = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=").decode()
payload["role"] = "ADMIN"
p_mod  = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
forged_none = f"{h_none}.{p_mod}."
r = requests.get(BASE + "/auth/me", headers={"Authorization": f"Bearer {forged_none}"}, timeout=5)
chk("alg=none admin forgery", r.status_code, r.text[:60], expect_fail=True)

# Wrong key
fake_sig = base64.urlsafe_b64encode(
    hmac.new(b"wrongkey", f"{h_none}.{p_mod}".encode(), hashlib.sha256).digest()
).rstrip(b"=").decode()
forged_key = f"{h_none}.{p_mod}.{fake_sig}"
r = requests.get(BASE + "/auth/me", headers={"Authorization": f"Bearer {forged_key}"}, timeout=5)
chk("HS256 wrong-key forgery", r.status_code, r.text[:60], expect_fail=True)

# Old weak key (should fail after our rotation)
old_key = b"deadnet-super-secret-key-change-in-production-please-32chars"
h_hs = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=").decode()
sig_old = base64.urlsafe_b64encode(
    hmac.new(old_key, f"{h_hs}.{p_mod}".encode(), hashlib.sha256).digest()
).rstrip(b"=").decode()
forged_old = f"{h_hs}.{p_mod}.{sig_old}"
r = requests.get(BASE + "/auth/me", headers={"Authorization": f"Bearer {forged_old}"}, timeout=5)
chk("Old weak key admin forgery", r.status_code, r.text[:60], expect_fail=True)


# ── 2.3  Flag brute-force + rate limiting ────────────────────────────────────
hdr("2.3  FLAG BRUTE-FORCE")

if not target_contract:
    print("  No contracts available")
else:
    cid = target_contract["id"]
    real_flag = None
    # Grab real flag via admin (to test correct submission later)
    c_detail = requests.get(BASE + f"/contracts/{cid}", headers=admin_h, timeout=5).json()
    print(f"  Target: '{target_contract['title']}' ({cid[:8]}...)")

    # Submit wrong flags rapidly — should hit rate limit
    rate_limited = False
    for i in range(8):
        r = requests.post(BASE + f"/contracts/{cid}/claim",
            headers=atk_h, json={"flag": f"DEADNET{{brute_{i}}}"}, timeout=5)
        icon = f"{GREEN}RATE_LIMITED{RESET}" if r.status_code == 429 else f"{RED}not limited{RESET}"
        print(f"  attempt {i+1}: [{r.status_code}] {r.text[:50]}  {icon if r.status_code == 429 else ''}")
        if r.status_code == 429:
            rate_limited = True
            break
        if r.status_code == 403:
            print(f"  {YELLOW}  (competition gate blocking submissions — rate limit not reachable){RESET}")
            break
    if not rate_limited:
        print(f"  {YELLOW}  Rate limit not reached (competition may be gated){RESET}")


# ── 2.4  IDOR / data leakage ─────────────────────────────────────────────────
hdr("2.4  IDOR — CROSS-USER DATA ACCESS")

if victim_user:
    vid = victim_user["id"]
    print(f"  Victim: {victim_user['username']} ({vid[:8]}...)")
    # Public profile (expected to be accessible)
    r = requests.get(BASE + f"/operatives/{vid}", headers=atk_h, timeout=5)
    chk(f"GET /operatives/{{victim}} (public profile)", r.status_code, r.text[:60])
    if r.status_code == 200:
        profile = r.json()
        exposed = [k for k in ("email", "hashed_password", "last_ip", "student_id") if k in profile]
        if exposed:
            print(f"  {RED}  SENSITIVE FIELDS IN RESPONSE: {exposed}{RESET}")
        else:
            print(f"  {GREEN}  No sensitive fields in public profile{RESET}")
    # Admin-only detail — must be blocked
    r2 = requests.get(BASE + f"/admin/users/{vid}", headers=atk_h, timeout=5)
    chk(f"GET /admin/users/{{victim}} (admin detail as operative)", r2.status_code, r2.text[:60], expect_fail=True)
    # Force-logout victim as attacker
    r3 = requests.post(BASE + f"/admin/users/{vid}/force-logout", headers=atk_h, timeout=5)
    chk(f"POST /admin/users/{{victim}}/force-logout", r3.status_code, r3.text[:60], expect_fail=True)
else:
    print("  No other users to test against")


# ── 2.5  Intel content without purchase ──────────────────────────────────────
hdr("2.5  INTEL LEAK (content before purchase)")

for c in all_contracts[:4]:
    intel_r = requests.get(BASE + f"/contracts/{c['id']}/intel", headers=atk_h, timeout=5)
    if intel_r.status_code == 200:
        drops = intel_r.json()
        leaks = [d for d in drops if not d.get("is_purchased") and d.get("content") is not None]
        if leaks:
            print(f"  {RED}[LEAK] {c['title'][:30]}: {len(leaks)} unpurchased drops expose content{RESET}")
        else:
            print(f"  {GREEN}[OK]   {c['title'][:30]}: content null until purchased{RESET}")
    elif intel_r.status_code == 403:
        print(f"  {YELLOW}[GATED] {c['title'][:30]}: competition not active{RESET}")


# ── 2.6  SQL injection via flag + search fields ───────────────────────────────
hdr("2.6  INJECTION PROBES")

if target_contract:
    cid = target_contract["id"]
    sqli_payloads = [
        ("SQLi basic",       "' OR '1'='1"),
        ("SQLi drop",        "'; DROP TABLE contracts;--"),
        ("SQLi comment",     "DEADNET{x' OR 1=1--}"),
        ("SQLi union",       "' UNION SELECT NULL,NULL,NULL--"),
        ("Null byte",        "DEADNET{flag\x00extra}"),
        ("Very long",        "A" * 10000),
        ("Empty string",     ""),
        ("Unicode rtl",      "‮DEADNET{reversed}"),
    ]
    for label, payload in sqli_payloads:
        r = requests.post(BASE + f"/contracts/{cid}/claim",
            headers=atk_h, json={"flag": payload}, timeout=5)
        safe = r.status_code in (400, 403, 422, 429)
        icon = f"{GREEN}[safe]{RESET}" if safe else f"{RED}[UNSAFE]{RESET}"
        print(f"  [{r.status_code}] {label:20s} {icon}  {r.text[:50]}")


# ── 2.7  Path traversal in file download ─────────────────────────────────────
hdr("2.7  PATH TRAVERSAL")

traversals = [
    "../etc/passwd",
    "..\\windows\\system32\\drivers\\etc\\hosts",
    "....//....//etc/passwd",
    "%2e%2e%2fetc%2fpasswd",
    "..%2f..%2fetc%2fpasswd",
    ".%252e/.%252e/etc/passwd",
    "/etc/passwd",
]
for t in traversals:
    r = requests.get(BASE + f"/files/{t}", headers=atk_h, timeout=5)
    chk(f"/files/{t[:35]}", r.status_code, r.text[:50], expect_fail=True)


# ── 2.8  Void access without session gate ────────────────────────────────────
hdr("2.8  VOID GATE BYPASS")

# /v01d/signal now requires auth (should work)
r = requests.get(BASE + "/v01d/signal", headers=atk_h, timeout=5)
print(f"  /v01d/signal (auth, no void session): [{r.status_code}]")
if r.status_code == 200:
    sig_header = r.headers.get("X-V01D-SIGNAL", "")
    if sig_header:
        decoded = base64.b64decode(sig_header).decode()
        print(f"  {YELLOW}  Flag retrievable by any authenticated user: {decoded}{RESET}")
    chk("signal accessible to any auth user", r.status_code, sig_header[:40])

# Try void contracts without authorize first
r2 = requests.get(BASE + "/v01d/contracts", headers=atk_h, timeout=5)
chk("/v01d/contracts (no void session)", r2.status_code, r2.text[:60])

# Authorize and then access
r3 = requests.post(BASE + "/v01d/authorize", headers=atk_h, timeout=5)
print(f"  POST /v01d/authorize: [{r3.status_code}] {r3.text[:60]}")
r4 = requests.get(BASE + "/v01d/contracts", headers=atk_h, timeout=5)
chk("/v01d/contracts (after authorize)", r4.status_code, r4.text[:60])


# ── 2.9  Change-password strength enforcement ─────────────────────────────────
hdr("2.9  PASSWORD STRENGTH ENFORCEMENT")

weak_passwords = [
    ("aaaaaaaa",     "8 identical chars"),
    ("12345678",     "digits only"),
    ("password",     "common word"),
    ("abc",          "too short"),
    ("Str0ng@Pass1", "valid — should succeed"),
]
for pwd, label in weak_passwords:
    r = requests.post(BASE + "/auth/change-password", headers=atk_h, json={
        "current_password": atk_pw, "new_password": pwd
    }, timeout=5)
    is_weak = label != "valid — should succeed"
    icon = f"{GREEN}[REJECTED]{RESET}" if (r.status_code >= 400 and is_weak) else \
           f"{RED}[ALLOWED - WEAK]{RESET}" if (r.status_code < 400 and is_weak) else \
           f"{GREEN}[ACCEPTED]{RESET}" if (r.status_code < 400) else f"{RED}[BLOCKED]{RESET}"
    print(f"  [{r.status_code}] '{pwd[:15]:<15}' ({label}): {icon}")
    if not is_weak and r.status_code < 400:
        atk_pw = pwd  # update for subsequent tests


# ── 2.10  Registration spam ───────────────────────────────────────────────────
hdr("2.10  REGISTRATION RATE LIMIT")

hit = False
for i in range(25):
    r = requests.post(BASE + "/auth/register", json={
        "username": f"spam_{uuid.uuid4().hex[:6]}",
        "email":    f"spam{i}@test.local",
        "password": "Spam@1234x",
    }, timeout=5)
    if r.status_code == 429:
        print(f"  {GREEN}Rate limit triggered at attempt {i+1}{RESET}")
        hit = True
        break
if not hit:
    print(f"  {RED}No rate limit after 25 attempts{RESET}")


# ── Done ──────────────────────────────────────────────────────────────────────
hdr("INSIDER SIMULATION COMPLETE")
print("  Green = defense held   |   Red = gap found\n")
