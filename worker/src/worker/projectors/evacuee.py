"""Project shelter evacuee docs → public_persons."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from worker.masking import phone_hash

ProjectionAction = Literal["upsert", "delete"]


def project_evacuee(
    doc: dict[str, Any], *, shelter_code: str
) -> tuple[ProjectionAction, dict[str, Any] | None]:
    if doc.get("type") != "evacuee":
        return ("delete", None)

    doc_id = doc.get("_id")
    if not doc_id:
        return ("delete", None)

    privacy = doc.get("privacy") or {}
    if privacy.get("search_excluded") is True:
        return ("delete", {"_id": doc_id})

    current_stay = doc.get("current_stay") or {}
    status = current_stay.get("status") or "unknown"

    updated_raw = doc.get("updated_at") or doc.get("created_at")
    updated_at = (
        datetime.fromisoformat(updated_raw.replace("Z", "+00:00"))
        if isinstance(updated_raw, str)
        else datetime.now(UTC)
    )

    last_name = doc.get("last_name") or ""
    payload = {
        "_id": doc_id,
        "shelter_code": shelter_code,
        "first_name": doc.get("first_name") or "",
        "last_name": last_name,
        "phone_hash": phone_hash(doc.get("phone")),
        "status": status,
        "updated_at": updated_at,
    }
    return ("upsert", payload)
