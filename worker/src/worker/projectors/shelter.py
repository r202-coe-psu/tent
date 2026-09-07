"""Project registry shelter docs → public_shelters."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

ProjectionAction = Literal["upsert", "delete"]


OPEN_STATUSES = frozenset({"open", "active", "standby", "full_capacity"})
CLOSED_STATUSES = frozenset({"closed"})
SITE_KINDS = frozenset({"evacuation_center", "host_house"})


def resolve_operation_status(doc: dict[str, Any]) -> str | None:
    if doc.get("operation_status"):
        return str(doc["operation_status"])
    if doc.get("status"):
        return str(doc["status"])
    return None


def is_shelter_open(doc: dict[str, Any]) -> bool:
    status = resolve_operation_status(doc)
    if status is None:
        return False
    if status in CLOSED_STATUSES:
        return False
    if status in OPEN_STATUSES:
        return True
    return status != "closed"


def map_public_shelter_status(doc: dict[str, Any]) -> str:
    """Map registry operation_status → public_shelters.status (schema §9.1)."""
    status = resolve_operation_status(doc)
    if status in CLOSED_STATUSES:
        return "closed"
    if status == "full_capacity":
        return "full"
    if status == "standby":
        return "standby"
    # active / legacy "open"
    return "open"


def resolve_site_kind(doc: dict[str, Any]) -> str:
    site_kind = doc.get("site_kind")
    return site_kind if site_kind in SITE_KINDS else "evacuation_center"


def backfill_capacity(doc: dict[str, Any]) -> int:
    capacity = doc.get("capacity")
    if isinstance(capacity, (int, float)) and capacity > 0:
        return int(capacity)
    zones = doc.get("zones") or []
    zone_sum = sum(int(z.get("capacity") or 0) for z in zones if isinstance(z, dict))
    if zone_sum > 0:
        return zone_sum
    return 100


def _parse_timestamp(raw: Any) -> datetime | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def compose_address(doc: dict[str, Any]) -> str | None:
    """Compose a partner-facing address string from the structured Residence-style
    fields (schema §3.1, CR-023) — falls back to the legacy `location.address` string."""
    parts = [
        doc.get("address_no"),
        doc.get("village_no"),
        f"ต.{doc['subdistrict']}" if doc.get("subdistrict") else None,
        f"อ.{doc['district']}" if doc.get("district") else None,
        f"จ.{doc['province']}" if doc.get("province") else None,
    ]
    composed = " ".join(str(p) for p in parts if p)
    if composed:
        return composed
    location_doc = doc.get("location") or {}
    return location_doc.get("address")


def project_shelter(
    doc: dict[str, Any],
) -> tuple[ProjectionAction, dict[str, Any] | None]:
    """Upsert every valid registry shelter doc — never delete on `operation_status` alone.

    Per the partner ODT (B_Data_We_Request_From_Partner_Systems, "Soft Delete" / "State
    Separation"): closing a location must never hard-delete its `public_shelters` row —
    only a true CouchDB delete/archive signal does that, and even then the processor
    flips `is_active` to `False` rather than removing the row (see
    ``worker.couch.processor`` / ``worker.mongo.shelter.apply_shelter_deactivate``).
    """
    if doc.get("type") != "shelter":
        return ("delete", None)

    code = doc.get("code")
    if not code:
        return ("delete", None)

    registry_id = doc.get("_id")

    location_doc = doc.get("location") or {}
    lat = location_doc.get("lat")
    lng = location_doc.get("lng")
    geo = None
    location_geojson = None
    if lat is not None and lng is not None:
        lat_f = float(lat)
        lng_f = float(lng)
        geo = {"lat": lat_f, "lng": lng_f}
        location_geojson = {"type": "Point", "coordinates": [lng_f, lat_f]}

    updated_raw = doc.get("updated_at") or doc.get("created_at")
    updated_at = _parse_timestamp(updated_raw) or datetime.now(UTC)

    contact = doc.get("contact") or {}
    mapped_status = map_public_shelter_status(doc)

    payload: dict[str, Any] = {
        "_id": code,
        "shelter_code": code,
        "registry_id": registry_id,
        "name": doc.get("name") or code,
        "site_kind": resolve_site_kind(doc),
        "status": mapped_status,
        # Own stored field mirroring `status` — see PublicShelter.location_status.
        "location_status": mapped_status,
        "is_active": True,
        "location_type": "shelter",
        "location_subtype": doc.get("shelter_type"),
        "capacity": backfill_capacity(doc),
        "province": doc.get("province"),
        "district": doc.get("district"),
        "subdistrict": doc.get("subdistrict"),
        "address": compose_address(doc),
        "contact_name": contact.get("name"),
        "contact_phone": contact.get("phone"),
        "opened_at": _parse_timestamp(doc.get("opened_at")),
        "closed_at": _parse_timestamp(doc.get("closed_at")),
        "raw_data": doc,
        "updated_at": updated_at,
    }
    if geo:
        payload["geo"] = geo
    if location_geojson:
        payload["location"] = location_geojson
    return ("upsert", payload)
