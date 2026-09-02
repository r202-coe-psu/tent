"""Tests for the inbound shift-response loop (CR-096 FR-VOL-06).

This is the only path by which a volunteer's answer to an offered shift reaches CouchDB —
the public plane cannot write there — so the failure that matters is a silent one: a row
marked synced when the patch never landed would strand a shift at ``dispatched`` forever
with its seat held.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from worker.inbound.shift_responses import _apply_response


def _response(action: str = "accepted") -> SimpleNamespace:
    return SimpleNamespace(
        id="shift_assignment:01TESTASSIGNMENT00001",
        shelter_code="SH001",
        job_id="job:01TESTJOB000000000001",
        volunteer_id="volunteer:01TESTVOL000000000001",
        action=action,
        responded_at=datetime(2026, 8, 30, 9, 0, tzinfo=UTC),
        synced_to_couch=False,
        save=AsyncMock(),
    )


def _couch(doc: dict | None, put_result: dict | None = None) -> MagicMock:
    couch = MagicMock()
    couch.get_doc = AsyncMock(return_value=doc)
    couch.put_doc = AsyncMock(return_value=put_result or {"ok": True, "rev": "2-x"})
    return couch


def _assignment() -> dict:
    return {
        "_id": "shift_assignment:01TESTASSIGNMENT00001",
        "_rev": "1-a",
        "type": "shift_assignment",
        "status": "assigned",
        "dispatch_status": "dispatched",
        "response_code": "4K72M9",
    }


@pytest.mark.asyncio
async def test_accepting_puts_the_volunteer_on_standby_and_burns_the_code():
    response = _response("accepted")
    couch = _couch(_assignment())

    assert await _apply_response(couch, response) is True  # type: ignore[arg-type]

    database, doc = couch.put_doc.await_args.args
    assert database == "shelter_sh001"
    assert doc["dispatch_status"] == "accepted"
    # Accepted means rostered but not yet reported in — check-in is a separate event.
    assert doc["status"] == "standby"
    # Single use: clearing it is what stops a second answer if the code is read out twice.
    assert doc["response_code"] is None
    assert doc["responded_at"] == "2026-08-30T09:00:00Z"
    assert response.synced_to_couch is True
    response.save.assert_awaited_once()


@pytest.mark.asyncio
async def test_declining_cancels_the_assignment_so_the_seat_goes_back():
    response = _response("declined")
    couch = _couch(_assignment())

    assert await _apply_response(couch, response) is True  # type: ignore[arg-type]

    _, doc = couch.put_doc.await_args.args
    assert doc["dispatch_status"] == "declined"
    assert doc["status"] == "cancelled"


@pytest.mark.asyncio
async def test_a_conflict_leaves_the_row_for_the_next_pass():
    response = _response()
    couch = _couch(_assignment(), put_result={"error": "conflict"})

    assert await _apply_response(couch, response) is False  # type: ignore[arg-type]
    # Never marked done on a refusal — the loop re-reads the document and tries again.
    assert response.synced_to_couch is False
    response.save.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_write_that_raises_is_retried_rather_than_swallowed():
    response = _response()
    couch = _couch(_assignment())
    couch.put_doc = AsyncMock(side_effect=RuntimeError("couch is down"))

    assert await _apply_response(couch, response) is False  # type: ignore[arg-type]
    assert response.synced_to_couch is False
    response.save.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_assignment_staff_deleted_is_dropped_instead_of_polled_forever():
    response = _response()
    couch = _couch(None)

    assert await _apply_response(couch, response) is True  # type: ignore[arg-type]
    couch.put_doc.assert_not_awaited()
    assert response.synced_to_couch is True
    response.save.assert_awaited_once()
