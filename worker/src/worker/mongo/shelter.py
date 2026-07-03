"""Write projected shelter documents to MongoDB."""

from __future__ import annotations

from typing import Any

from tent_read_model import PublicShelter

from worker.mongo.upsert import apply_document


async def apply_shelter(action: str, payload: dict[str, Any] | None) -> None:
    await apply_document(PublicShelter, action, payload)
