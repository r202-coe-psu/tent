"""Project donation docs → public_donations mirror."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

ProjectionAction = Literal["upsert", "delete"]


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def project_donation(
    doc: dict[str, Any], *, shelter_code: str
) -> tuple[ProjectionAction, dict[str, Any] | None]:
    if doc.get("type") != "donation":
        return ("delete", None)

    doc_id = doc.get("_id")
    if not doc_id:
        return ("delete", None)

    items = doc.get("items") or doc.get("items_declared") or []
    items_declared = [
        {
            "item_name": item.get("free_text") or item.get("item_name") or "",
            "qty": item.get("qty"),
            "unit": item.get("unit"),
            "category": item.get("category"),
        }
        for item in items
        if isinstance(item, dict)
    ]

    updated_raw = doc.get("updated_at") or doc.get("created_at") or doc.get("declared_at")
    updated_at = (
        _parse_datetime(updated_raw) if isinstance(updated_raw, str) else datetime.now(UTC)
    )

    payload = {
        "_id": doc_id,
        "tracking_token_hash": doc.get("tracking_token_hash"),
        "shelter_code": doc.get("shelter_code") or shelter_code,
        "status": doc.get("status") or "declared",
        "booking_ref": doc.get("booking_ref"),
        "items_declared": items_declared,
        "received_summary": doc.get("received_summary"),
        "updated_at": updated_at,
    }
    return ("upsert", payload)
