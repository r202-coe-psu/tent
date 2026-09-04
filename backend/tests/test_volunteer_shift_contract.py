from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from tent_model.public_job import JobShift

from apiapp.modules.volunteers.schemas import VolunteerApplyRequest
from apiapp.modules.volunteers.use_case import _select_concrete_shift


def _job() -> SimpleNamespace:
    return SimpleNamespace(
        shifts=[
            JobShift(
                shift_id="sft:one",
                date="2026-09-10",
                start_time="08:00",
                end_time="12:00",
                quota=1,
            ),
            JobShift(
                shift_id="sft:two",
                date="2026-09-10",
                start_time="08:00",
                end_time="12:00",
                quota=1,
            ),
        ],
        updated_at=datetime.now(UTC),
    )


def test_apply_contract_selects_the_explicit_shift_id():
    selected = _select_concrete_shift(
        _job(),
        VolunteerApplyRequest(
            first_name="A", last_name="B", phone="0812345678", shift_id="sft:two"
        ),
    )
    assert selected is not None
    assert selected.shift_id == "sft:two"


def test_date_only_apply_is_rejected_when_two_shifts_share_a_window():
    with pytest.raises(HTTPException) as error:
        _select_concrete_shift(
            _job(),
            VolunteerApplyRequest(
                first_name="A", last_name="B", phone="0812345678", shift_date="2026-09-10"
            ),
        )
    assert error.value.detail["error"] == "SHIFT_DATE_AMBIGUOUS"
