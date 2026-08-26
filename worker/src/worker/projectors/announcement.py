import datetime
from typing import Any, Literal

from dateutil.parser import isoparse


def project_announcement(
    doc: dict[str, Any],
) -> tuple[Literal["upsert", "delete", "ignore"], dict[str, Any]]:
    """Project a CouchDB announcement doc into a MongoDB PublicAnnouncement shape."""
    doc_id = doc.get("_id")
    if not doc_id:
        return "ignore", {}

    if doc.get("_deleted"):
        return "delete", {"_id": doc_id}

    if doc.get("type") != "announcement":
        return "ignore", {}

    updated_at_str = doc.get("updated_at")
    try:
        updated_at = (
            isoparse(updated_at_str)
            if updated_at_str
            else datetime.datetime.now(datetime.UTC)
        )
    except ValueError:
        updated_at = datetime.datetime.now(datetime.UTC)

    payload = {
        "_id": doc_id,
        "title": doc.get("title", ""),
        "description": doc.get("description", ""),
        "title_en": doc.get("title_en"),
        "description_en": doc.get("description_en"),
        "severity": doc.get("severity", "info"),
        "is_active": bool(doc.get("is_active", False)),
        "updated_at": updated_at,
    }
    return "upsert", payload
