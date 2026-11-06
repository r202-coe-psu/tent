"""The T-22 remaining-need rule, checked against the shared cases.

``remaining = target − (on_hand + reserved)`` is implemented three times (see
``packages/needs-fixtures/README.md``). Every copy had its own passing tests while two
of them quietly used an older formula with no warehouse term, because nothing compared
them. These cases are the comparison: the TypeScript side asserts the same numbers in
``frontend/src/lib/features/donations/domain/needs-parity.test.ts``.

A rule change that lands in only one language turns this red.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from worker.projectors.compute_needs import compute_needs

FIXTURES = Path(__file__).resolve().parents[2] / "packages" / "needs-fixtures" / "cases.json"
CASES = json.loads(FIXTURES.read_text(encoding="utf-8"))["cases"]


def _campaigns(case: dict) -> list[dict]:
    return [
        {
            "_id": c["_id"],
            "type": "donation_campaign",
            "status": "open",
            "needs": [{"unit": "kg", **n} for n in c["needs"]],
        }
        for c in case["campaigns"]
    ]


def _donations(case: dict) -> list[dict]:
    return [{"type": "donation", **d} for d in case["donations"]]


def _ledgers(case: dict) -> list[dict]:
    return [{"type": "stock_ledger", **entry} for entry in case["stock_ledgers"]]


def _ids(cases: list[dict]) -> list[str]:
    return [c["name"] for c in cases]


@pytest.mark.parametrize("case", CASES, ids=_ids(CASES))
def test_remaining_matches_the_shared_cases(case: dict) -> None:
    remaining, _ = compute_needs(_campaigns(case), _donations(case), _ledgers(case))

    for item_id, expected in case["expected_remaining"].items():
        assert float(remaining[item_id]) == pytest.approx(expected), case["why"]


@pytest.mark.parametrize("case", CASES, ids=_ids(CASES))
def test_every_expected_item_is_reported(case: dict) -> None:
    """A closed or fully-met need contributes a zero — it must not vanish.

    Callers downstream read a missing key as "not tracked" and let the booking through,
    so dropping the entry would reopen exactly what the cut-off closed.
    """
    remaining, _ = compute_needs(_campaigns(case), _donations(case), _ledgers(case))

    assert set(case["expected_remaining"]) <= set(remaining)


@pytest.mark.parametrize("case", CASES, ids=_ids(CASES))
def test_item_binds_only_to_a_campaign_still_accepting_it(case: dict) -> None:
    _, item_campaign = compute_needs(_campaigns(case), _donations(case), _ledgers(case))

    open_by_campaign = {
        c["_id"]: {n["item_id"] for n in c["needs"] if n.get("status") != "closed"}
        for c in case["campaigns"]
    }
    for item_id, campaign_id in item_campaign.items():
        assert item_id in open_by_campaign[campaign_id]


def test_the_fixture_file_is_the_one_typescript_reads() -> None:
    """Guards the relative path: a move that breaks one side must not silently pass here."""
    assert FIXTURES.exists(), f"shared cases missing at {FIXTURES}"
    assert CASES, "shared cases are empty"
