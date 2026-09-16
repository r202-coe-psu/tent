FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
	PYTHONUNBUFFERED=1 \
	UV_COMPILE_BYTECODE=1 \
	UV_LINK_MODE=copy \
	APP_ENV=prod

WORKDIR /app

RUN groupadd --system --gid 1000 app \
	&& useradd --system --uid 1000 --gid app --home /app --shell /usr/sbin/nologin app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy workspace configs for fast caching
COPY pyproject.toml uv.lock /app/
COPY packages/tent-model /app/packages/tent-model
COPY backend/pyproject.toml /app/backend/pyproject.toml

# Install dependencies without installing application package
RUN uv sync --project backend --no-dev --no-install-project

# Copy application code
COPY backend/ /app/backend/

# Install the application package
RUN uv sync --project backend --no-dev \
	&& chown -R app:app /app

WORKDIR /app/backend

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 9000

USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9000/v1/health', timeout=3)"

CMD ["fastapi", "run", "apiapp/main.py", "--host", "0.0.0.0", "--port", "9000"]
