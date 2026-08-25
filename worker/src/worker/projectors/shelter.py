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
    status = resolve_operation_status(doc)
    if status in CLOSED_STATUSES:
        return "closed"
    if status == "full_capacity":
        return "full"
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


def project_shelter(doc: dict[str, Any]) -> tuple[ProjectionAction, dict[str, Any] | None]:
    if doc.get("type") != "shelter":
        return ("delete", None)

    code = doc.get("code")
    if not code:
        return ("delete", None)

    registry_id = doc.get("_id")

    if not is_shelter_open(doc):
        payload: dict[str, Any] = {"_id": code}
        if registry_id:
            payload["registry_id"] = registry_id
        return ("delete", payload)

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
    updated_at = (
        datetime.fromisoformat(updated_raw.replace("Z", "+00:00"))
        if isinstance(updated_raw, str)
        else datetime.now(UTC)
    )

    payload = {
        "_id": code,
        "shelter_code": code,
        "registry_id": registry_id,
        "name": doc.get("name") or code,
        "site_kind": resolve_site_kind(doc),
        "status": map_public_shelter_status(doc),
        "capacity": backfill_capacity(doc),
        "province": doc.get("province"),
        "district": doc.get("district"),
        "subdistrict": doc.get("subdistrict"),
        "raw_data": doc,
        "updated_at": updated_at,
    }
    if geo:
        payload["geo"] = geo
    if location_geojson:
        payload["location"] = location_geojson
    return ("upsert", payload)
