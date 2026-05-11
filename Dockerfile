# ─── Stage 1: Build React Frontend ───────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm install

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
