"""Close a booking received point by point (CR-206 FR-MP-27a, FR-MP-27b, FR-MP-29b).

Port of ``donationShortfall`` (``frontend/src/lib/features/operations/domain/donation-batch.ts``)
and ``closeDonationByPoints`` (``frontend/src/lib/features/donations/domain/point-receipts.ts``).
The worker needs them to close a booking that passed ``expires_at`` with some points
recorded (FR-MP-29). Both sides are held to ``packages/donation-close-fixtures/cases.json``
— change them together.

Quantities are decimal strings (CR-038): parsed with ``Decimal``, rounded to four places
half-up, and written back the way ``persistQty`` writes them (no trailing zeros).
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

#: Mirrors ``QTY_DECIMALS`` in ``frontend/src/lib/utils/qty.ts``.
_QTY_STEP = Decimal("0.0001")

#: Mirrors ``DONATION_REJECT_REASON_LABELS`` / ``REJECT_REASON_MAX`` (CR-172).
_REJECT_REASON_LABELS = {
    "not_needed": "ไม่ตรงเกณฑ์การรับ / เกินความต้องการ",
    "expired": "หมดอายุ",
    "damaged": "ชำรุดเสียหาย",
    "other": "อื่นๆ",
}
_REJECT_REASON_MAX = 500


def _persist_qty(value: Any) -> str:
    rounded = Decimal(str(value)).quantize(_QTY_STEP, rounding=ROUND_HALF_UP)
    if rounded.is_zero():
        return "0"
    return format(rounded.normalize(), "f")


def _add_qty(a: Any, b: Any) -> str:
    return _persist_qty(Decimal(str(a)) + Decimal(str(b)))


def donation_shortfall(
    declared: list[dict[str, Any]], counted: list[dict[str, Any]]
) -> list[dict[str, str]]:
    """Per item: declared total against counted total, where fewer arrived (CR-143).

    Lines without an ``item_id`` are left out on both sides; an over-count is not a
    shortfall.
    """
    declared_by_item: dict[str, str] = {}
    for line in declared:
        item_id = line.get("item_id")
        if not item_id:
            continue
        declared_by_item[item_id] = _add_qty(
            declared_by_item.get(item_id, "0"), line["qty"]
        )
    counted_by_item: dict[str, str] = {}
    for line in counted:
        item_id = line.get("item_id")
        if not item_id:
            continue
        counted_by_item[item_id] = _add_qty(
            counted_by_item.get(item_id, "0"), line["qty"]
        )

    shortfalls: list[dict[str, str]] = []
    for item_id, declared_qty in declared_by_item.items():
        counted_qty = counted_by_item.get(item_id, "0")
        short = _persist_qty(Decimal(declared_qty) - Decimal(counted_qty))
        if Decimal(short) > 0:
            shortfalls.append(
                {
                    "item_id": item_id,
                    "declared": declared_qty,
                    "counted": counted_qty,
                    "short": short,
                }
            )
    return shortfalls


def _truncate(text: str, limit: int) -> str:
    return f"{text[: limit - 1]}…" if len(text) > limit else text


def _donor_reject_message(code: str) -> str:
    """``donorRejectMessage`` without a note: the preset label (``other`` says nothing)."""
    if code == "other":
        return ""
    return _truncate(_REJECT_REASON_LABELS.get(code, ""), _REJECT_REASON_MAX)


def _combine_line_reject_reasons(lines: list[dict[str, str]]) -> dict[str, str]:
    """CR-172 FR-12 — the lines' reasons, each once; their code when they agree."""
    reasons = list(dict.fromkeys(line["reject_reason"] for line in lines))
    codes = {line["reject_reason_code"] for line in lines}
    return {
        "reject_reason": _truncate("; ".join(reasons), _REJECT_REASON_MAX),
        "reject_reason_code": next(iter(codes)) if len(codes) == 1 else "other",
    }


def _or(value: Any, fallback: Any) -> Any:
    """``value ?? fallback``."""
    return fallback if value is None else value


def _is_review_rejected(item: dict[str, Any]) -> bool:
    return item.get("review_status") == "rejected"


def _pick(source: dict[str, Any], *keys: str) -> dict[str, Any]:
    """The keys ``source`` has — a present ``None`` included, as the TypeScript spreads it."""
    return {key: source[key] for key in keys if key in source}


def close_donation_by_points(
    donation: dict[str, Any], *, closed_by: str, closed_reason: str, now: str
) -> dict[str, Any]:
    """Close a booking from its ``point_receipts`` (FR-MP-27a, FR-MP-27b).

    ``received_summary`` is written once, here. A line with no result counts ``"0"`` and
    so lands in ``shortfalls``; a refused line (at a point, or at review) is out of the
    comparison (CR-172 FR-13). Nothing received at all → ``rejected`` with the lines'
    reasons (CR-172 FR-12). Returns the fields to lay over the doc.
    """
    declared: list[dict[str, Any]] = list(donation.get("items") or [])
    receipts: list[dict[str, Any]] = list(donation.get("point_receipts") or [])

    results: dict[int, dict[str, Any]] = {}
    for receipt in receipts:
        for line in receipt.get("items") or []:
            rejected = bool(line.get("rejected"))
            recorded: dict[str, Any] = {
                **_pick(line, "item_id", "free_text"),
                "qty": "0" if rejected else line.get("qty"),
                "unit": line.get("unit"),
            }
            if rejected:
                recorded["rejected"] = True
                recorded.update(_pick(line, "reject_reason", "reject_reason_code"))
            results[line["line_no"]] = recorded

    items: list[dict[str, Any]] = []
    for line_no, item in enumerate(declared):
        recorded = results.get(line_no)
        if recorded is not None:
            items.append(recorded)
            continue
        base = {
            **_pick(item, "item_id", "free_text"),
            "qty": "0",
            "unit": item.get("unit"),
        }
        if not _is_review_rejected(item):
            items.append(base)
            continue
        code = item.get("review_reason_code")
        code = "other" if code is None else code
        items.append(
            {
                **base,
                "rejected": True,
                "reject_reason": (item.get("review_reason") or "").strip()
                or _donor_reject_message(code),
                "reject_reason_code": code,
            }
        )

    # A typed-in line is compared under the stock item staff matched it to at the point.
    declared_for_shortfall = [
        {
            "item_id": item.get("item_id")
            or items[line_no].get("item_id")
            or item.get("free_text"),
            "qty": item.get("qty"),
        }
        for line_no, item in enumerate(declared)
        if not items[line_no].get("rejected")
    ]
    counted_for_shortfall = [
        {"item_id": line.get("item_id") or line.get("free_text"), "qty": line["qty"]}
        for line_no, line in enumerate(items)
        if not line.get("rejected") and line_no in results
    ]
    shortfalls = donation_shortfall(declared_for_shortfall, counted_for_shortfall)

    remarks = "\n".join(
        text
        for text in (
            receipt["remarks"].strip()
            if isinstance(receipt.get("remarks"), str)
            else ""
            for receipt in receipts
        )
        if text
    )
    received_summary: dict[str, Any] = {
        "total_items": len(declared),
        "received_at": now,
        **({"remarks": remarks} if remarks else {}),
        "closed_by": closed_by,
        "closed_reason": closed_reason,
        "shortfalls": shortfalls,
        "items": items,
    }

    if any(
        not line.get("rejected") and line_no in results
        for line_no, line in enumerate(items)
    ):
        return {
            "status": "received",
            "received_at": now,
            "received_summary": received_summary,
        }

    rejections = [
        {
            "reject_reason": _or(line.get("reject_reason"), ""),
            "reject_reason_code": _or(line.get("reject_reason_code"), "other"),
        }
        for line in items
        if line.get("rejected")
    ]
    closed: dict[str, Any] = {
        "status": "rejected",
        **_combine_line_reject_reasons(rejections),
    }
    # CR-174 FR-12 — a booking refused whole leaves no line of it approved or pending.
    if any("review_status" in item for item in declared):
        closed["items"] = [
            item if _is_review_rejected(item) else {**item, "review_status": "rejected"}
            for item in declared
        ]
    closed["received_summary"] = received_summary
    return closed
