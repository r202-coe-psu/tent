FROM python:3.12-slim

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY pyproject.toml /app/pyproject.toml
COPY packages/tent-model /app/packages/tent-model
COPY worker /app/worker

RUN uv sync --project worker --no-dev

ENV PYTHONUNBUFFERED=1

CMD ["uv", "run", "--project", "worker", "sync-worker"]
