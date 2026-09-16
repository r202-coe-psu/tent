FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
	PYTHONUNBUFFERED=1 \
	UV_COMPILE_BYTECODE=1 \
	UV_LINK_MODE=copy

WORKDIR /app

RUN groupadd --system --gid 1000 app \
	&& useradd --system --uid 1000 --gid app --home /app --shell /usr/sbin/nologin app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY pyproject.toml uv.lock /app/
COPY packages/tent-model /app/packages/tent-model
COPY worker /app/worker

RUN uv sync --project worker --no-dev \
	&& chown -R app:app /app

USER app

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
	CMD uv run --project worker python -c "import worker.main"

CMD ["uv", "run", "--project", "worker", "sync-worker"]
