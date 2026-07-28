from typing import Any


def project_config(doc: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
    if not doc:
        return "noop", None

    doc_id = doc.get("_id", "")
    if doc_id == "config:public_portal":
        return "upsert", doc

    return "noop", None
