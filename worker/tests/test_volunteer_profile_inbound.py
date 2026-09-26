"""Tests for the inbound volunteer-profile loop.

This is the only path by which a volunteer's own edit reaches CouchDB. The failures that
matter are silent ones: a row marked synced when a document was never patched, or an
edit reaching fields the volunteer does not own.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from worker.inbound.volunteer_profile_updates import _apply_update


def _update(targets: list[SimpleNamespace] | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id="volunteer_profile_update:01TEST",
        phone_hash="abc",
        targets=targets
        if targets is not None
        else [
            SimpleNamespace(shelter_code="SH001", volunteer_id="volunteer:01A"),
            SimpleNamespace(shelter_code="SH002", volunteer_id="volunteer:01B"),
        ],
        skills=["ครัว", "ขับรถ"],
        requested_at=datetime(2026, 9, 2, tzinfo=UTC),
        synced_to_couch=False,
        save=AsyncMock(),
    )


def _volunteer(doc_id: str, skills: list[str] | None = None) -> dict:
    return {
        "_id": doc_id,
        "_rev": "1-a",
        "type": "volunteer",
        "skills": skills if skills is not None else ["ครัว"],
        "identity_verified": True,
        "volunteer_code": "V-001",
        "status": "active",
    }


def _couch(docs: dict[str, dict | None], put_result: dict | None = None) -> MagicMock:
    couch = MagicMock()
    couch.get_doc = AsyncMock(side_effect=lambda _db, doc_id: docs.get(doc_id))
    couch.put_doc = AsyncMock(return_value=put_result or {"ok": True, "rev": "2-x"})
    return couch


@pytest.mark.asyncio
async def test_the_edit_lands_on_every_shelter_the_person_helps_at():
    update = _update()
    couch = _couch(
        {
            "volunteer:01A": _volunteer("volunteer:01A"),
            "volunteer:01B": _volunteer("volunteer:01B"),
        }
    )

    assert await _apply_update(couch, update) is True  # type: ignore[arg-type]

    written = {
        call.args[1]["_id"]: call.args[1] for call in couch.put_doc.await_args_list
    }
    assert set(written) == {"volunteer:01A", "volunteer:01B"}
    assert written["volunteer:01A"]["skills"] == ["ครัว", "ขับรถ"]
    assert couch.put_doc.await_args_list[0].args[0] == "shelter_sh001"
    assert update.synced_to_couch is True


@pytest.mark.asyncio
async def test_it_never_touches_what_staff_own():
    update = _update(
        targets=[SimpleNamespace(shelter_code="SH001", volunteer_id="volunteer:01A")]
    )
    couch = _couch({"volunteer:01A": _volunteer("volunteer:01A")})

    await _apply_update(couch, update)  # type: ignore[arg-type]

    written = couch.put_doc.await_args.args[1]
    # The buffer has no field for these, and the patch must not invent one.
    assert written["identity_verified"] is True
    assert written["volunteer_code"] == "V-001"
    assert written["status"] == "active"


@pytest.mark.asyncio
async def test_a_document_already_holding_those_skills_is_not_rewritten():
    update = _update(
        targets=[SimpleNamespace(shelter_code="SH001", volunteer_id="volunteer:01A")]
    )
    couch = _couch(
        {"volunteer:01A": _volunteer("volunteer:01A", skills=["ครัว", "ขับรถ"])}
    )

    assert await _apply_update(couch, update) is True  # type: ignore[arg-type]
    couch.put_doc.assert_not_awaited()
    assert update.synced_to_couch is True


@pytest.mark.asyncio
async def test_a_partial_pass_is_not_marked_done():
    """One document patched and one conflicted is not "applied".

    Marking it synced there would leave the second shelter holding the old skills for
    good, with nothing left to retry from.
    """
    update = _update()
    couch = _couch(
        {
            "volunteer:01A": _volunteer("volunteer:01A"),
            "volunteer:01B": _volunteer("volunteer:01B"),
        },
        put_result={"error": "conflict"},
    )

    assert await _apply_update(couch, update) is False  # type: ignore[arg-type]
    assert update.synced_to_couch is False
    update.save.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_profile_staff_deleted_does_not_block_the_others():
    update = _update()
    couch = _couch(
        {"volunteer:01A": None, "volunteer:01B": _volunteer("volunteer:01B")}
    )

    assert await _apply_update(couch, update) is True  # type: ignore[arg-type]
    assert couch.put_doc.await_count == 1
    assert update.synced_to_couch is True


@pytest.mark.asyncio
async def test_an_edit_naming_nothing_is_dropped_rather_than_polled_forever():
    update = _update(targets=[])
    couch = _couch({})

    assert await _apply_update(couch, update) is True  # type: ignore[arg-type]
    couch.put_doc.assert_not_awaited()
    assert update.synced_to_couch is True
