"""Projection of registry ``master_data`` docs into ``public_config`` (CR-100)."""

from worker.projectors.master_data import (
    project_master_data,
    volunteer_skills_config_id,
)


def _doc(**overrides):
    doc = {
        "_id": "master_data:volunteer_skills",
        "type": "master_data",
        "master_type": "volunteer_skills",
        "items": [
            {
                "code": "kitchen",
                "label": "ครัวสนาม",
                "category": "operational",
                "status": "active",
            },
            {
                "code": "medical",
                "label": "ปฐมพยาบาล",
                "category": "controlled",
                "status": "active",
            },
        ],
    }
    doc.update(overrides)
    return doc


def test_projects_controlled_codes_and_labels():
    """FastAPI gates public applications and cannot read CouchDB — the list must arrive."""
    action, payload = project_master_data(_doc())

    assert action == "upsert"
    assert payload == {
        "_id": "config:volunteer_skills",
        "shelter_code": None,
        "controlled_codes": ["medical"],
        "controlled_labels": ["ปฐมพยาบาล"],
    }


def test_is_an_allow_list_not_a_copy():
    """Staff authoring metadata stays in CouchDB even as master data keeps growing."""
    _, payload = project_master_data(
        _doc(
            items=[
                {
                    "code": "medical",
                    "label": "ปฐมพยาบาล",
                    "category": "controlled",
                    "status": "active",
                    "description": "ต้องตรวจใบประกอบวิชาชีพ",
                    "is_default": True,
                }
            ],
            disabled_global_codes=["kitchen"],
            default_global_code="kitchen",
        )
    )

    assert set(payload) == {
        "_id",
        "shelter_code",
        "controlled_codes",
        "controlled_labels",
    }


def test_accepts_the_upper_case_category_seeds_still_carry():
    _, payload = project_master_data(
        _doc(
            items=[
                {
                    "code": "m",
                    "label": "M",
                    "category": "CONTROLLED",
                    "status": "active",
                }
            ]
        )
    )
    assert payload["controlled_codes"] == ["m"]


def test_skips_inactive_items():
    """A skill switched off must stop forcing review."""
    _, payload = project_master_data(
        _doc(
            items=[
                {
                    "code": "medical",
                    "label": "ปฐมพยาบาล",
                    "category": "controlled",
                    "status": "inactive",
                }
            ]
        )
    )
    assert payload["controlled_codes"] == []


def test_a_shelter_list_lands_on_its_own_document():
    action, payload = project_master_data(
        _doc(_id="master_data:volunteer_skills:sh001", shelter_code="sh001")
    )
    assert action == "upsert"
    assert payload["_id"] == "config:volunteer_skills:SH001"
    assert payload["shelter_code"] == "SH001"


def test_other_master_types_stay_in_couchdb():
    action, payload = project_master_data(
        {
            "_id": "master_data:vulnerable_group",
            "type": "master_data",
            "master_type": "vulnerable_group",
        }
    )
    assert (action, payload) == ("noop", None)


def test_empty_doc_is_a_noop():
    assert project_master_data({}) == ("noop", None)


def test_config_id_helper_matches_what_fastapi_reads():
    assert volunteer_skills_config_id(None) == "config:volunteer_skills"
    assert volunteer_skills_config_id("sh002") == "config:volunteer_skills:SH002"
