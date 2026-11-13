"""CR-252 (#1242): external shelter projection and worker skip rules."""

from datetime import UTC, datetime

import pytest

from worker.projectors.shelter import (
    RetentionPhase,
    backfill_capacity,
    classify_registry_shelter,
    map_public_shelter_status,
    project_shelter,
)

NOW = datetime(2026, 11, 13, tzinfo=UTC)


def _doc(**overrides):
    doc = {
        "_id": "shelter:SH900",
        "type": "shelter",
        "code": "SH900",
        "name": "ศูนย์ภายนอก",
        "operation_status": "unknown",
        "is_external": True,
        "external_url": "https://example.org/s",
    }
    doc.update(overrides)
    return doc


def test_external_shelter_is_projected_as_unknown_not_hidden_nor_open():
    action, payload = project_shelter(_doc())
    assert action == "upsert"
    assert payload["status"] == "unknown"
    assert payload["location_status"] == "unknown"
    assert payload["is_external"] is True
    assert payload["external_url"] == "https://example.org/s"
    assert payload["is_active"] is True


def test_external_capacity_is_its_own_value_without_fallback_100():
    # decision sync 2026-11-13: show the shelter's own max capacity; 0 = not given.
    assert backfill_capacity(_doc()) == 0
    assert backfill_capacity(_doc(capacity=0, zones=[{"capacity": 30}])) == 0
    assert backfill_capacity(_doc(capacity=50, zones=[{"capacity": 30}])) == 50
    assert (
        backfill_capacity({"code": "SH1"}) == 100
    )  # regular shelters keep the fallback


@pytest.mark.parametrize(
    "url", [None, "", "   ", "http://x.org", "javascript:alert(1)"]
)
def test_non_https_external_url_projects_null(url):
    _, payload = project_shelter(_doc(external_url=url))
    assert payload["external_url"] is None


def test_regular_shelter_defaults_to_not_external():
    _, payload = project_shelter(_doc(operation_status="active", is_external=False))
    assert payload["is_external"] is False
    assert payload["external_url"] is None
    assert payload["status"] == "open"


def test_legacy_doc_without_is_external_reads_false():
    doc = _doc(operation_status="active")
    del doc["is_external"]
    _, payload = project_shelter(doc)
    assert payload["is_external"] is False


def test_cancelled_external_shelter_is_still_removed_from_public():
    action, payload = project_shelter(_doc(operation_status="cancelled"))
    assert action == "delete"
    assert payload == {"_id": "SH900"}


def test_unknown_maps_to_its_own_public_status():
    assert map_public_shelter_status({"operation_status": "unknown"}) == "unknown"


def test_external_shelter_is_neither_listened_nor_bootstrapped():
    phase = classify_registry_shelter(_doc(), retention_months=3, now=NOW)
    assert phase is RetentionPhase.EXTERNAL
    assert not phase.is_listened
    assert not phase.is_bootstrapped


def test_cancelled_external_shelter_is_hidden():
    phase = classify_registry_shelter(
        _doc(operation_status="cancelled"), retention_months=3, now=NOW
    )
    assert phase is RetentionPhase.HIDDEN
