FROM python:3.11-slim

WORKDIR /app

# Install system dependencies & poetry
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install poetry
ENV POETRY_HOME="/opt/poetry" \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_CREATE=false
ENV PATH="$POETRY_HOME/bin:$PATH"
RUN curl -sSL https://install.python-poetry.org | python3 -

# Copy dependency definitions
COPY pyproject.toml poetry.lock* ./

# Install project dependencies
RUN poetry install --no-root --only main

# Copy backend source code
COPY . .

EXPOSE 9000

CMD ["uvicorn", "apiapp.main:app", "--host", "0.0.0.0", "--port", "9000"]


