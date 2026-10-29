"""Project donation docs → public_donations mirror."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

ProjectionAction = Literal["upsert", "delete"]


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)  # 3.11+ reads a trailing Z
    except ValueError:
        return None


def project_point_receipts(receipts: Any) -> list[dict[str, Any]]:
    """CR-206 §Change — each point receipt as the donor may see it: point, lines, time.

    Never ``received_by``, ``remarks``, the line results or the ledger/audit ids beside
    them: those are staff's.
    """
    if not isinstance(receipts, list):
        return []
    return [
        {
            "point_id": receipt.get("point_id"),
            "line_nos": [
                n for n in receipt.get("line_nos") or [] if isinstance(n, int)
            ],
            "received_at": receipt.get("received_at"),
        }
        for receipt in receipts
        if isinstance(receipt, dict)
    ]


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
            # CR-196: the donor's edit form names lines by it. None before schema_v 8.
            "line_key": item.get("line_key"),
            # CR-174 FR-27: the per-line review. Lines from before schema_v 7 have none.
            "review_status": item.get("review_status"),
            "review_reason_code": item.get("review_reason_code"),
            "review_reason": item.get("review_reason"),
            # CR-206: where the donor takes the line. None = no point, and before schema_v 11.
            "drop_off_point_id": item.get("drop_off_point_id"),
        }
        for item in items
        if isinstance(item, dict)
    ]

    updated_raw = (
        doc.get("updated_at") or doc.get("created_at") or doc.get("declared_at")
    )
    updated_at = (
        _parse_datetime(updated_raw)
        if isinstance(updated_raw, str)
        else datetime.now(UTC)
    )

    payload = {
        "_id": doc_id,
        "tracking_token_hash": doc.get("tracking_token_hash"),
        "shelter_code": doc.get("shelter_code") or shelter_code,
        "status": doc.get("status") or "declared",
        "booking_ref": doc.get("booking_ref"),
        "items_declared": items_declared,
        # Whole sub-doc, so received_summary.items[].rejected / reject_reason /
        # reject_reason_code (CR-172) ride along without a mapping here.
        "received_summary": doc.get("received_summary"),
        # CR-172: the donor-facing reason. Docs before schema_v 6 have neither → None.
        "reject_reason": doc.get("reject_reason"),
        "reject_reason_code": doc.get("reject_reason_code"),
        "point_receipts": project_point_receipts(doc.get("point_receipts")),
        "updated_at": updated_at,
    }
    return ("upsert", payload)
