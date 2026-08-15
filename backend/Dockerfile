FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
	PYTHONUNBUFFERED=1 \
	POETRY_VERSION=2.1.1 \
	POETRY_NO_INTERACTION=1 \
	POETRY_VIRTUALENVS_IN_PROJECT=true \
	APP_ENV=prod

WORKDIR /app

RUN pip install --no-cache-dir "poetry==$POETRY_VERSION" \
	&& groupadd --system --gid 1000 app \
	&& useradd --system --uid 1000 --gid app --home /app --shell /usr/sbin/nologin app

# Path dep must exist before poetry install (relative from backend = ../packages/tent-model).
# Build context is the repo root (see docker-compose fastapi.build).
COPY packages/tent-model /app/packages/tent-model
COPY backend/pyproject.toml backend/poetry.lock /app/backend/

WORKDIR /app/backend
RUN poetry install --no-root --without dev

COPY backend/ /app/backend/

RUN chown -R app:app /app

ENV PATH="/app/backend/.venv/bin:$PATH"
EXPOSE 9000

USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9000/v1/health', timeout=3)"

CMD ["fastapi", "run", "apiapp/main.py", "--host", "0.0.0.0", "--port", "9000"]
