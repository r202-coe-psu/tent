"""Project registry ``config`` docs → the ``public_config`` collection.

Two singletons reach the public plane from here. ``config:public_portal`` carries the
FAQ copy the portal renders. ``config:app`` (schema.md §3.2) carries operational
settings, of which the public plane needs the donation reservation TTL — FastAPI stamps
``expires_at`` on every booking and has no CouchDB client to read the document itself,
the same gap CR-060 opened this route for.

``config:app`` is projected through an allow-list rather than copied whole. It is the
app-wide settings document and will keep growing; a staff-only or sensitive value added
to it later must not land in a collection the public plane reads just because nobody
remembered this projector existed.
"""

from typing import Any

APP_CONFIG_ID = "config:app"
PUBLIC_PORTAL_CONFIG_ID = "config:public_portal"

#: Fields of ``config:app`` the public plane is allowed to see (schema.md §3.2).
#: ``public_otp_required`` rides along because it gates the same public donation flow;
#: everything else in the document is staff-side and stays in CouchDB.
PUBLIC_APP_CONFIG_FIELDS = (
    "donation_reservation_ttl_hours",
    "public_otp_required",
)


def project_config(doc: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
    if not doc:
        return "noop", None

    doc_id = doc.get("_id", "")
    if doc_id == PUBLIC_PORTAL_CONFIG_ID:
        return "upsert", doc

    if doc_id == APP_CONFIG_ID:
        payload: dict[str, Any] = {"_id": APP_CONFIG_ID}
        for field in PUBLIC_APP_CONFIG_FIELDS:
            if field in doc:
                payload[field] = doc[field]
        return "upsert", payload

    return "noop", None
