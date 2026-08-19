from typing import Any, Literal

from tent_model.public_announcement import PublicAnnouncement

from worker.mongo.upsert import apply_document


async def apply_announcement(
    action: Literal["upsert", "delete", "ignore"], payload: dict[str, Any]
) -> None:
    """Apply an announcement projection to MongoDB."""
    await apply_document(PublicAnnouncement, action, payload)
