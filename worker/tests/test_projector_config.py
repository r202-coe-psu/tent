"""Projection of registry ``config`` singletons into ``public_config``."""

from worker.projectors.config import project_config


def test_projects_the_reservation_ttl_from_config_app():
    """FastAPI stamps expires_at and cannot read CouchDB — the TTL has to arrive here."""
    action, payload = project_config(
        {
            "_id": "config:app",
            "type": "config",
            "donation_reservation_ttl_hours": 6,
            "public_otp_required": True,
        }
    )

    assert action == "upsert"
    assert payload == {
        "_id": "config:app",
        "donation_reservation_ttl_hours": 6,
        "public_otp_required": True,
    }


def test_config_app_is_allow_listed_not_copied_whole():
    """The app-wide settings document keeps growing; staff-side values stay in CouchDB."""
    _, payload = project_config(
        {
            "_id": "config:app",
            "type": "config",
            "donation_reservation_ttl_hours": 24,
            "retention_months_after_close": 3,
            "duplicate_hint_threshold": 0.8,
            "fam_search_max_results": 10,
            "device_db_ttl_days": 30,
            "some_future_secret": "must not leak",
        }
    )

    assert payload is not None
    assert set(payload) == {"_id", "donation_reservation_ttl_hours"}


def test_absent_fields_are_omitted_so_readers_fall_back():
    """A half-written document must not project nulls over a reader's default."""
    _, payload = project_config({"_id": "config:app", "type": "config"})
    assert payload == {"_id": "config:app"}


def test_public_portal_config_is_still_copied_whole():
    doc = {"_id": "config:public_portal", "type": "config", "faqs": {"public": []}}
    assert project_config(doc) == ("upsert", doc)


def test_other_config_singletons_are_ignored():
    assert project_config({"_id": "config:something_else", "type": "config"}) == ("noop", None)


def test_empty_doc_is_ignored():
    assert project_config({}) == ("noop", None)
