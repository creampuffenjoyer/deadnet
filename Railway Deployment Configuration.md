# DEADNET — Railway Deployment Configuration

This session configures DEADNET for Railway cloud deployment. The goal is a production-ready deployment where FastAPI serves both the API and the built React frontend as static files — a single service on Railway.

**Read these files before doing anything:**
- `backend/Dockerfile`
- `frontend/Dockerfile`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `backend/app/main.py`
- `backend/app/config.py`
- `.env.example` (if exists)

Understand the full picture before touching anything.

---

## ARCHITECTURE ON RAILWAY

```
Railway Project: DEADNET
├── backend service   ← FastAPI + React build (single Dockerfile)
├── postgres service  ← Railway managed PostgreSQL
└── redis service     ← Railway managed Redis
```

Single URL serves everything:
```
https://deadnet.up.railway.app/        → React frontend
https://deadnet.up.railway.app/api/    → FastAPI backend
https://deadnet.up.railway.app/health  → health check
```

---

## TASK 1 — SAFETY NET FIRST (do this before any changes)

Before touching any existing files:

**1a. Create a git branch for Railway work**
```bash
git checkout -b railway-deployment
```
All changes in this session go on this branch. `main` branch stays untouched — if anything breaks, `git checkout main` restores everything instantly.

**1b. Verify current state works locally**
```bash
docker-compose up -d
# Confirm all 4 services start healthy before proceeding
docker ps
```

If local Docker is not healthy, STOP and report what's failing. Do not proceed with Railway config if local is broken.

---

## TASK 2 — ROOT DOCKERFILE FOR RAILWAY

Create `Dockerfile` at the **repo root** (not inside backend/ or frontend/). This is the file Railway will use.

```dockerfile
# ─── Stage 1: Build React Frontend ───────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .

ARG VITE_API_URL=""
ARG VITE_VOID_B64=""
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_VOID_B64=$VITE_VOID_B64

RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build

# ─── Stage 2: Python Backend ──────────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Copy React build from stage 1 into backend
COPY --from=frontend-build /frontend/dist ./frontend_dist

EXPOSE 8000

# Production: no --reload
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Do NOT delete or modify the existing `backend/Dockerfile` or `frontend/Dockerfile` — local Docker Compose still uses those.**

---

## TASK 3 — VERIFY STATIC FILE SERVING IN MAIN.PY

Check `backend/app/main.py` for static file serving logic. It should already exist from the `docker-compose.prod.yml` `SERVE_STATIC=true` setup.

**If it exists already** — verify it looks like this and leave it alone:
```python
import os
from fastapi.staticfiles import StaticFiles

if os.getenv("SERVE_STATIC", "false").lower() == "true":
    static_dir = os.path.join(os.path.dirname(__file__), "..", "frontend_dist")
    if os.path.exists(static_dir):
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
```

**If it does NOT exist** — add it carefully. Mount static files AFTER all API routes are registered, never before. The `/` mount must be last or it swallows all API routes.

**Critical check:** Make sure `/health` and all `/api/` routes are registered BEFORE the static mount. Verify by reading the full main.py route registration order.

---

## TASK 4 — RAILWAY CONFIGURATION FILE

Create `railway.json` at repo root:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "uvicorn app.main:app --host 0.0.0.0 --port 8000",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 60,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

---

## TASK 5 — ENVIRONMENT VARIABLES TEMPLATE

Create `.env.railway` at repo root (this is NOT committed — add to .gitignore). This is the reference list of every variable that needs to be set in Railway dashboard:

```env
# ── DATABASE (Railway provides this automatically) ──
DATABASE_URL=postgresql://...  # copy from Railway PostgreSQL service

# ── REDIS (Railway provides this automatically) ──
REDIS_URL=redis://...  # copy from Railway Redis service

# ── SECURITY ──
SECRET_KEY=                    # generate: python -c "import secrets; print(secrets.token_hex(32))"
ARCHITECT_1_CALLSIGN=          # your architect callsign
ARCHITECT_1_PASSWORD=          # your architect password

# ── GMAIL SMTP ──
GMAIL_USER=                    # your deadnet gmail
GMAIL_PASSWORD=                # your gmail app password

# ── FRONTEND ──
VITE_API_URL=                  # leave empty (same-origin, no CORS needed)
VITE_VOID_B64=                 # your void b64 value
FRONTEND_URL=                  # https://your-service.up.railway.app

# ── DEPLOYMENT ──
SERVE_STATIC=true
ENVIRONMENT=production

# ── CORS ──
ALLOWED_ORIGINS=https://your-service.up.railway.app
```

Add `.env.railway` to `.gitignore`:
```bash
echo ".env.railway" >> .gitignore
```

---

## TASK 6 — VERIFY CONFIG.PY HANDLES RAILWAY ENV VARS

Read `backend/app/config.py` and verify:

**DATABASE_URL** — Railway provides a single `DATABASE_URL` string. If your config uses separate `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` variables, add a fallback that parses `DATABASE_URL` if individual vars are missing:

```python
import os
from urllib.parse import urlparse

# Support both Railway-style DATABASE_URL and individual vars
database_url = os.getenv("DATABASE_URL")
if database_url:
    # Railway sometimes uses postgres:// prefix, SQLAlchemy needs postgresql://
    database_url = database_url.replace("postgres://", "postgresql://", 1)
```

**REDIS_URL** — Same pattern. Railway provides `REDIS_URL` as a full connection string. Verify your Redis client accepts it.

**Do NOT rewrite config.py** — only add the Railway URL parsing if individual vars are the only current option. Preserve all existing config logic.

---

## TASK 7 — TEST THE ROOT DOCKERFILE LOCALLY

Before pushing to Railway, test the root Dockerfile locally:

```bash
# Build the Railway image locally
docker build -t deadnet-railway . \
  --build-arg VITE_API_URL="" \
  --build-arg VITE_VOID_B64="test"

# If build succeeds, test run it
docker run -p 8000:8000 \
  -e SERVE_STATIC=true \
  -e DATABASE_URL="postgresql://deadnet:deadnet_pass@host.docker.internal:5432/deadnet" \
  -e REDIS_URL="redis://host.docker.internal:6379" \
  -e SECRET_KEY="test-secret-key" \
  deadnet-railway
```

If the build fails — report the exact error. Do NOT push to GitHub until the local Docker build succeeds.

---

## TASK 8 — PUSH TO RAILWAY BRANCH

Only after Task 7 succeeds:

```bash
git add Dockerfile railway.json .env.railway
git add .gitignore
git add backend/app/main.py  # only if modified in Task 3
git add backend/app/config.py  # only if modified in Task 6
git commit -m "feat: add Railway deployment configuration"
git push origin railway-deployment
```

Do NOT merge to main yet.

---

## TASK 9 — RAILWAY DASHBOARD STEPS (manual, not automated)

After pushing, do these manually in Railway dashboard:

```
1. railway.app → New Project → Deploy from GitHub
2. Select deadnet repo → Select railway-deployment branch
3. Railway detects root Dockerfile automatically
4. + New Service → Database → PostgreSQL
5. + New Service → Database → Redis
6. In backend service → Variables → add all vars from .env.railway
   - Copy DATABASE_URL from PostgreSQL service (click it → Connect tab)
   - Copy REDIS_URL from Redis service (click it → Connect tab)
   - Fill in all other vars manually
7. Trigger redeploy after setting variables
8. Watch build logs for errors
```

---

## ROLLBACK PLAN (if anything goes wrong)

**Local environment broken:**
```bash
git checkout main
docker-compose down
docker-compose up -d
# Back to original working state
```

**Railway deployment broken:**
```
Railway Dashboard → backend service → Deployments
→ Click previous deployment → Redeploy
# Instant rollback to last working Railway deploy
```

**Nuclear option:**
```bash
# Railway branch has issues, start fresh
git checkout main
git branch -D railway-deployment
git checkout -b railway-deployment
# Start the Railway config from scratch
```

---

## VERIFY AFTER DEPLOYMENT

```
BUILD:
[ ] Root Dockerfile builds locally without errors
[ ] Frontend build completes (React dist generated)
[ ] Python dependencies install cleanly
[ ] frontend_dist folder exists in final image

RAILWAY:
[ ] PostgreSQL service provisioned
[ ] Redis service provisioned  
[ ] All environment variables set
[ ] Build logs show no errors
[ ] Health check passes (/health returns 200)

FUNCTIONALITY:
[ ] https://your-service.up.railway.app loads React frontend
[ ] Login works (JWT auth functioning)
[ ] API calls succeed (no CORS errors)
[ ] Email verification sends (Gmail SMTP working)
[ ] WebSocket/live features working
[ ] Architect login works

SAFETY:
[ ] main branch untouched
[ ] .env never committed
[ ] .env.railway in .gitignore
[ ] No secrets in git history
```