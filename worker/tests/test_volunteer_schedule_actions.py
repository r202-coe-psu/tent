from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from worker.inbound.volunteer_schedule_actions import _apply_action


def _action(action: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=f"volunteer_schedule_action:shift_assignment:01:{action}",
        assignment_id="shift_assignment:01",
        shelter_code="SH001",
        job_id="job:01",
        volunteer_id="volunteer:01",
        action=action,
        requested_at=datetime(2026, 9, 1, 9, 0, tzinfo=UTC),
        synced_to_couch=False,
        save=AsyncMock(),
    )


def _couch(doc: dict | None) -> MagicMock:
    couch = MagicMock()
    couch.get_doc = AsyncMock(
        side_effect=[doc, {"_id": "volunteer:01", "type": "volunteer"}]
    )
    couch.put_doc = AsyncMock(return_value={"ok": True, "rev": "2-x"})
    return couch


@pytest.mark.asyncio
async def test_check_in_updates_assignment_and_volunteer():
    action = _action("check_in")
    couch = _couch({"_id": action.assignment_id, "status": "assigned"})

    assert await _apply_action(couch, action) is True
    assignment = couch.put_doc.await_args_list[0].args[1]
    volunteer = couch.put_doc.await_args_list[1].args[1]
    assert assignment["status"] == "checked_in"
    assert assignment["check_in_method"] == "portal"
    assert volunteer["checked_in"] is True
    assert action.synced_to_couch is True


@pytest.mark.asyncio
async def test_check_out_marks_assignment_completed():
    action = _action("check_out")
    couch = _couch({"_id": action.assignment_id, "status": "checked_in"})

    assert await _apply_action(couch, action) is True
    assignment = couch.put_doc.await_args_list[0].args[1]
    assert assignment["status"] == "completed"
    assert assignment["check_out_at"] == "2026-09-01T09:00:00Z"


@pytest.mark.asyncio
async def test_couch_conflict_keeps_action_pending():
    action = _action("withdraw")
    couch = _couch({"_id": action.assignment_id, "status": "assigned"})
    couch.put_doc = AsyncMock(return_value={"error": "conflict"})

    assert await _apply_action(couch, action) is False
    assert action.synced_to_couch is False
    action.save.assert_not_awaited()
