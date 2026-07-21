"""Resolve registry shelter tombstones to public shelter codes."""

from __future__ import annotations

from typing import Any

from tent_model import PublicShelter


async def resolve_shelter_code_for_registry_delete(
    registry_id: str,
    *,
    deleted_doc: dict[str, Any] | None = None,
) -> str | None:
    if deleted_doc and deleted_doc.get("code"):
        return str(deleted_doc["code"])

    by_registry = await PublicShelter.find_one(PublicShelter.registry_id == registry_id)
    if by_registry:
        return by_registry.shelter_code

    existing = await PublicShelter.get(registry_id)
    if existing:
        return existing.shelter_code

    return None
