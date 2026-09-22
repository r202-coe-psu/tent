"""Project registry ``master_data`` docs → the ``public_config`` collection (CR-100).

Only ``volunteer_skills`` reaches the public plane, and only the part of it the plane
actually needs: which skills are *controlled*. FastAPI decides whether a public
application must wait for a manager (``_needs_review``) and has no CouchDB client, so
the list has to be projected — the same bridge ``config:app`` uses for the donation TTL.

Written as an allow-list rather than a copy of the document: master data carries staff
authoring metadata (labels for every skill, defaults, descriptions) that the public gate
does not need, and a field added there later must not land in a public collection just
because nobody remembered this projector existed.

One document per master doc: the global list becomes ``config:volunteer_skills`` and a
shelter's own list becomes ``config:volunteer_skills:{SHELTER}``. FastAPI unions the two
for a job's shelter, so a skill controlled at either level forces review — deliberately
fail-safe in the "needs a human" direction.
"""

from typing import Any

VOLUNTEER_SKILLS_TYPE = "volunteer_skills"
VOLUNTEER_SKILLS_CONFIG_ID = "config:volunteer_skills"


def volunteer_skills_config_id(shelter_code: str | None) -> str:
    """``config:volunteer_skills`` for the global list, ``…:{CODE}`` for a shelter's."""
    return (
        f"{VOLUNTEER_SKILLS_CONFIG_ID}:{shelter_code.upper()}"
        if shelter_code
        else VOLUNTEER_SKILLS_CONFIG_ID
    )


def _is_controlled(item: dict[str, Any]) -> bool:
    # Master data has carried both casings since CR-010; the staff UI writes the
    # lowercase one and seeds still hold the upper.
    return str(item.get("category") or "").lower() == "controlled"


def project_master_data(doc: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
    if not doc or doc.get("master_type") != VOLUNTEER_SKILLS_TYPE:
        return "noop", None

    shelter_code = doc.get("shelter_code")
    items = doc.get("items") or []
    controlled = [
        item
        for item in items
        if isinstance(item, dict)
        and _is_controlled(item)
        and item.get("status") != "inactive"
    ]
    payload = {
        "_id": volunteer_skills_config_id(str(shelter_code) if shelter_code else None),
        "shelter_code": str(shelter_code).upper() if shelter_code else None,
        # Codes are what documents store from CR-100 on; the labels ride along so an
        # application written before it (or a `volunteer.skills` label, which CR-100
        # deliberately leaves as a label) still matches the gate.
        "controlled_codes": [
            str(item["code"]) for item in controlled if item.get("code")
        ],
        "controlled_labels": [
            str(item["label"]) for item in controlled if item.get("label")
        ],
    }
    return "upsert", payload
