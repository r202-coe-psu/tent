"""Write projected need documents to MongoDB."""

from __future__ import annotations

from typing import Any

from tent_model import PublicNeed

from worker.mongo.upsert import apply_document


async def apply_need(action: str, payload: dict[str, Any] | None) -> None:
    await apply_document(PublicNeed, action, payload)


async def delete_needs_for_shelter(shelter_code: str) -> None:
    await PublicNeed.find(PublicNeed.shelter_code == shelter_code).delete()
