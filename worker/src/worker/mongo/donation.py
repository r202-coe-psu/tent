"""Write projected donation mirror documents to MongoDB."""

from __future__ import annotations

from typing import Any

from tent_model import PublicDonation

from worker.mongo.upsert import apply_document


async def apply_donation(action: str, payload: dict[str, Any] | None) -> None:
    await apply_document(PublicDonation, action, payload)
