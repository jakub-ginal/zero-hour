# syntax=docker/dockerfile:1

# Python 3.15 is newer, but PyYAML (a uvicorn[standard] extra) has no 3.15 wheels yet.
ARG PYTHON_IMAGE=python:3.14.10-alpine3.24

FROM ghcr.io/astral-sh/uv:0.13.6 AS uv

# Build stage: resolve the locked dependencies into a virtual environment.
FROM ${PYTHON_IMAGE} AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project --no-install-package watchfiles

# Runtime stage: only Python, the virtual environment, and the app files.
FROM ${PYTHON_IMAGE}
RUN addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ZH_SERVE_FRONTEND=true
WORKDIR /app/backend
COPY --from=build /app/.venv /app/.venv
COPY backend/app ./app
COPY frontend /app/frontend
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"]
# The app only receives traffic from cloudflared on the private compose network,
# so it trusts the forwarded headers for the client scheme and address.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips=*", "--no-server-header"]
