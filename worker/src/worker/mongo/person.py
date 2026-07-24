"""Write projected person documents to MongoDB."""

from __future__ import annotations

from typing import Any

from tent_model import PublicPerson

from worker.mongo.upsert import apply_document


async def apply_person(action: str, payload: dict[str, Any] | None) -> None:
    await apply_document(PublicPerson, action, payload)


async def delete_persons_for_shelter(shelter_code: str) -> None:
    await PublicPerson.find(PublicPerson.shelter_code == shelter_code).delete()
