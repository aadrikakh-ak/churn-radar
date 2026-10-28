# Single-image deploy: the React build is served by FastAPI, so the whole app
# is one container on one port — which is what free PaaS tiers give you.

# ---------------------------------------------------------------- stage 1
FROM node:22-slim AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --omit=optional || npm install

COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------- stage 2
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TF_CPP_MIN_LOG_LEVEL=3 \
    PORT=8000

WORKDIR /app

# Install dependencies first so code edits don't invalidate the pip layer.
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# `ml` ships with the API: the backend imports its feature engineering so that
# training and serving cannot drift apart.
COPY ml/ ./ml/
COPY backend/ ./backend/
COPY artifacts/ ./artifacts/

COPY --from=frontend /build/dist ./backend/static

# Run as a non-root user.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD python -c "import urllib.request,os,sys; \
    sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",8000)}/api/health').status==200 else 1)"

# Shell form so $PORT is expanded — PaaS hosts inject the port at runtime.
CMD uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000}
