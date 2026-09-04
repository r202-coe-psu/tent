from worker.projectors.job import project_job, project_job_application
from worker.projectors.shift_assignment import project_shift_assignment


def _job_doc() -> dict:
    return {
        "_id": "job:01JOB",
        "type": "job",
        "status": "open",
        "title": "ครัว",
        "quota": 3,
        "shifts": [
            {
                "shift_id": "sft:morning",
                "date": "2026-09-10",
                "start_time": "08:00",
                "end_time": "12:00",
                "quota": 2,
                "slots_confirmed": 1,
            },
            {
                # Legacy source docs may still call the embedded key `id`; the
                # public projection normalises it to the canonical `shift_id`.
                "id": "sft:afternoon",
                "date": "2026-09-10",
                "start_time": "08:00",
                "end_time": "12:00",
                "quota": 1,
            },
        ],
    }


def test_job_projection_normalises_shift_identity_and_aggregates_counters():
    action, payload = project_job(_job_doc(), shelter_code="SH001")

    assert action == "upsert"
    assert [shift["shift_id"] for shift in payload["shifts"]] == [
        "sft:morning",
        "sft:afternoon",
    ]
    assert payload["quota"] == 3
    assert payload["slots_confirmed"] == 1
    assert payload["slots_remaining"] == 2


def test_application_projection_preserves_shift_id_and_snapshot():
    action, payload = project_job_application(
        {
            "_id": "job_application:01APP",
            "type": "job_application",
            "job_id": "job:01JOB",
            "shift_id": "sft:morning",
            "tracking_token_hash": "hash",
            "applicant": {"phone": "0812345678", "first_name": "A"},
            "selected_shift": {
                "shift_id": "sft:morning",
                "date": "2026-09-10",
                "start_time": "08:00",
                "end_time": "12:00",
                "station": "ครัว",
            },
        },
        shelter_code="SH001",
    )

    assert action == "upsert"
    assert payload["shift_id"] == "sft:morning"
    assert payload["selected_shift"]["date"] == "2026-09-10"
    assert payload["selected_shift"]["start_time"] == "08:00"


def test_assignment_projection_carries_shift_id_without_using_window_as_identity():
    action, payload = project_shift_assignment(
        {
            "_id": "shift_assignment:01ASSIGN",
            "type": "shift_assignment",
            "job_id": "job:01JOB",
            "shift_id": "sft:afternoon",
            "volunteer_id": "volunteer:01VOL",
            "date": "2026-09-10",
            "shift": "08:00-12:00",
            "duty_window": {
                "start_ts": "2026-09-10T08:00:00Z",
                "end_ts": "2026-09-10T12:00:00Z",
            },
        },
        shelter_code="SH001",
    )

    assert action == "upsert"
    assert payload["shift_id"] == "sft:afternoon"
