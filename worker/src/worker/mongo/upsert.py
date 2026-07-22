"""Shared Beanie upsert / delete for projected documents."""

from __future__ import annotations

from typing import Any, TypeVar

from beanie import Document

T = TypeVar("T", bound=Document)


async def apply_document(model: type[T], action: str, payload: dict[str, Any] | None) -> None:
    if action == "delete":
        if payload and payload.get("_id"):
            existing = await model.get(payload["_id"])
            if existing:
                await existing.delete()
        return
    if payload is None:
        return
    doc_id = payload["_id"]
    existing = await model.get(doc_id)
    if existing:
        for key, value in payload.items():
            if key == "_id":
                continue
            setattr(existing, key, value)
        await existing.save()
    else:
        await model(**payload).insert()
