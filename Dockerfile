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

FROM python:3.12-slim
WORKDIR /app
RUN echo 'cache-bust-2026-05-11-19-52'
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY --from=frontend-build /frontend/dist ./frontend_dist
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
