"""CR-206 FR-MP-29b — the worker's close port, checked against the shared cases.

``donationShortfall`` and ``closeDonationByPoints`` live in the frontend too; the
TypeScript side reads the same file in ``point-receipts.parity.test.ts``. A rule change
that lands in only one language turns this red.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from worker.donation_close import close_donation_by_points, donation_shortfall

FIXTURES = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "donation-close-fixtures"
    / "cases.json"
)
CASES = json.loads(FIXTURES.read_text(encoding="utf-8"))


def _ids(cases: list[dict]) -> list[str]:
    return [c["name"] for c in cases]


@pytest.mark.parametrize("case", CASES["shortfall"], ids=_ids(CASES["shortfall"]))
def test_shortfall_matches_the_shared_cases(case: dict) -> None:
    assert donation_shortfall(case["declared"], case["counted"]) == case["expected"]


@pytest.mark.parametrize("case", CASES["close"], ids=_ids(CASES["close"]))
def test_close_matches_the_shared_cases(case: dict) -> None:
    opts = case["opts"]
    closed = close_donation_by_points(
        case["donation"],
        closed_by=opts["closed_by"],
        closed_reason=opts["closed_reason"],
        now=opts["now"],
    )
    # Key order too: CouchDB stores what each side writes, so the two must agree byte for byte.
    assert json.dumps(closed, ensure_ascii=False) == json.dumps(
        case["expected"], ensure_ascii=False
    )


def test_quantities_are_written_without_trailing_zeros() -> None:
    assert donation_shortfall(
        [
            {"item_id": "item:rice", "qty": "2.50"},
            {"item_id": "item:rice", "qty": "7.5"},
        ],
        [{"item_id": "item:rice", "qty": "0.00005"}],
    ) == [
        {
            "item_id": "item:rice",
            "declared": "10",
            "counted": "0.0001",
            "short": "9.9999",
        }
    ]


def test_a_refused_booking_with_reviewed_lines_refuses_every_line() -> None:
    """CR-174 FR-12 — the TypeScript ``rejectRemainingLines``; not in the shared cases."""
    donation = {
        "items": [
            {
                "item_id": "item:water",
                "qty": "24",
                "unit": "bottle",
                "review_status": "approved",
            },
            {
                "item_id": "item:para",
                "qty": "10",
                "unit": "pack",
                "review_status": "rejected",
                "review_reason_code": "other",
            },
        ],
        "point_receipts": [
            {
                "point_id": "p-gym",
                "line_nos": [0],
                "items": [
                    {
                        "line_no": 0,
                        "item_id": "item:water",
                        "qty": "24",
                        "unit": "bottle",
                        "rejected": True,
                        "reject_reason": "หมดอายุ",
                        "reject_reason_code": "expired",
                    }
                ],
            }
        ],
    }

    closed = close_donation_by_points(
        donation,
        closed_by="system",
        closed_reason="expired",
        now="2026-10-30T00:00:00Z",
    )

    assert closed["status"] == "rejected"
    # The review-refused line with code "other" and no detail says nothing of its own.
    assert closed["reject_reason"] == "หมดอายุ; "
    assert closed["reject_reason_code"] == "other"
    assert [item["review_status"] for item in closed["items"]] == [
        "rejected",
        "rejected",
    ]
    assert closed["received_summary"]["shortfalls"] == []
