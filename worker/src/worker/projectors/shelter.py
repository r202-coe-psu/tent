"""Project registry shelter docs → public_shelters."""

from __future__ import annotations

import logging
import math
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from dateutil.relativedelta import relativedelta

logger = logging.getLogger(__name__)

ProjectionAction = Literal["upsert", "delete"]


OPEN_STATUSES = frozenset({"open", "active", "standby", "full_capacity"})
CLOSED_STATUSES = frozenset({"closed"})
# A cancelled shelter (set up by mistake / never opened) is hidden from the whole
# public plane — unlike `closed`, which stays listed as a closed location
# (docs/changes/draft-shelter-cancelled-status.md).
CANCELLED_STATUSES = frozenset({"cancelled"})
SITE_KINDS = frozenset({"evacuation_center", "host_house"})


def resolve_operation_status(doc: dict[str, Any]) -> str | None:
    if doc.get("operation_status"):
        return str(doc["operation_status"])
    if doc.get("status"):
        return str(doc["status"])
    return None


def is_shelter_cancelled(doc: dict[str, Any]) -> bool:
    return resolve_operation_status(doc) in CANCELLED_STATUSES


DEFAULT_RETENTION_MONTHS_AFTER_CLOSE = 3


class RetentionPhase(StrEnum):
    """Where a shelter stands on the public plane (CR-183, data-model §7)."""

    OPEN = "open"
    CLOSED_WITHIN_RETENTION = "closed_within_retention"
    CLOSED_EXPIRED = "closed_expired"
    # D-5: no clock to count from, so persons are kept indefinitely.
    CLOSED_WITHOUT_DATE = "closed_without_date"
    # Cancelled, or no status at all: never part of the public plane.
    HIDDEN = "hidden"

    @property
    def is_listened(self) -> bool:
        """Whether `_changes` of the shelter DB is tailed (FR-7). Every phase that
        still has persons on the public plane, so an opt-out reaches it (FR-10)."""
        return self in (
            RetentionPhase.OPEN,
            RetentionPhase.CLOSED_WITHIN_RETENTION,
            RetentionPhase.CLOSED_WITHOUT_DATE,
        )

    @property
    def is_bootstrapped(self) -> bool:
        """Whether a bootstrap scan rebuilds the shelter DB (FR-8). Not a closed one
        without date: a scan would bring back persons the pre-CR-183 retention
        already deleted."""
        return self in (RetentionPhase.OPEN, RetentionPhase.CLOSED_WITHIN_RETENTION)


def classify_retention(
    *,
    status: str | None,
    closed_at: datetime | None,
    retention_months: int,
    now: datetime,
) -> RetentionPhase:
    """Classify a shelter by its status and close time.

    ``status`` is either the registry ``operation_status`` (legacy ``status``) or the
    projected ``public_shelters.status``; both spell a closed shelter ``closed``."""
    if status is None or status in CANCELLED_STATUSES:
        return RetentionPhase.HIDDEN
    if status not in CLOSED_STATUSES:
        return RetentionPhase.OPEN
    if closed_at is None:
        return RetentionPhase.CLOSED_WITHOUT_DATE
    # PyMongo returns BSON dates naive (UTC).
    if closed_at.tzinfo is None:
        closed_at = closed_at.replace(tzinfo=UTC)
    if now >= closed_at + relativedelta(months=retention_months):
        return RetentionPhase.CLOSED_EXPIRED
    return RetentionPhase.CLOSED_WITHIN_RETENTION


def classify_registry_shelter(
    doc: dict[str, Any], *, retention_months: int, now: datetime
) -> RetentionPhase:
    return classify_retention(
        status=resolve_operation_status(doc),
        closed_at=_parse_timestamp(doc.get("closed_at")),
        retention_months=retention_months,
        now=now,
    )


def parse_retention_months(config_app: dict[str, Any] | None) -> int:
    """``config:app.retention_months_after_close``, or the default when unusable (FR-6)."""
    value = (config_app or {}).get("retention_months_after_close")
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return DEFAULT_RETENTION_MONTHS_AFTER_CLOSE


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
    if doc.get("address_no"):
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
    loc_addr = location_doc.get("address")
    if loc_addr:
        return loc_addr
    parts = [
        f"ต.{doc['subdistrict']}" if doc.get("subdistrict") else None,
        f"อ.{doc['district']}" if doc.get("district") else None,
        f"จ.{doc['province']}" if doc.get("province") else None,
    ]
    composed = " ".join(str(p) for p in parts if p)
    return composed or None


def _sub_storage_types(point: dict[str, Any]) -> list[str]:
    """``types[]`` (schema_v 8+), or the single ``type`` of a pre-v8 point, as a list (FR-DP-13)."""
    types = point.get("types")
    if isinstance(types, list):
        return [t for t in types if isinstance(t, str)]
    legacy = point.get("type")
    return [legacy] if isinstance(legacy, str) else []


def _pin_coordinate(value: Any, limit: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) and abs(number) <= limit else None


def project_donation_points(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """``public_shelters.donation_points`` (CR-205 FR-DP-11/12).

    Only ticked storage points with a real pin (both coordinates in range, not (0,0)) and
    a persisted ``id`` leave the staff plane. ``area_m2`` and every unticked point stay out.
    """
    # A malformed ``common_areas`` / ``sub_storage`` drops only the points, not the whole
    # shelter row.
    areas = doc.get("common_areas")
    points = areas.get("sub_storage") if isinstance(areas, dict) else None
    if not isinstance(points, list):
        return []
    out: list[dict[str, Any]] = []
    for point in points:
        if not isinstance(point, dict) or point.get("accepts_donations") is not True:
            continue
        point_id = point.get("id")
        name = point.get("name")
        lat = _pin_coordinate(point.get("lat"), 90)
        lng = _pin_coordinate(point.get("lng"), 180)
        if not point_id or not isinstance(point_id, str) or not isinstance(name, str):
            continue
        if lat is None or lng is None or (lat == 0 and lng == 0):
            continue
        note = point.get("location_note")
        note = note.strip() if isinstance(note, str) else ""
        out.append(
            {
                "id": point_id,
                "name": name,
                "types": _sub_storage_types(point),
                "geo": {"lat": lat, "lng": lng},
                "location_note": note or None,
            }
        )
    return out


def project_shelter(
    doc: dict[str, Any],
) -> tuple[ProjectionAction, dict[str, Any] | None]:
    """Upsert every valid registry shelter doc — never delete on `closed` (CR-183 FR-1).

    Per the partner ODT (B_Data_We_Request_From_Partner_Systems, "Soft Delete" / "State
    Separation"): closing a location must never hard-delete its `public_shelters` row —
    only a true CouchDB delete/archive signal does that, and even then the processor
    flips `is_active` to `False` rather than removing the row (see
    ``worker.couch.processor`` / ``worker.mongo.shelter.apply_shelter_deactivate``).

    The one status exception is ``cancelled`` (draft-shelter-cancelled-status.md): the
    shelter was never a real location, so it answers ``("delete", {"_id": code})`` and
    the caller deletes the row together with every shelter-scoped projection
    (persons, occupants, needs, stocks, jobs). Reverting the status re-projects it.

    A closed shelter keeps its row for good; its ``public_persons`` stay searchable until
    ``closed_at`` + ``retention_months_after_close`` (``worker.retention.job``).
    """
    if doc.get("type") != "shelter":
        return ("delete", None)

    code = doc.get("code")
    if not code:
        return ("delete", None)

    if is_shelter_cancelled(doc):
        return ("delete", {"_id": code})

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
        "donation_points": project_donation_points(doc),
        "raw_data": doc,
        "updated_at": updated_at,
    }
    raw_closed_at = doc.get("closed_at")
    closed_at = _parse_timestamp(raw_closed_at)
    if raw_closed_at and closed_at is None:
        # FR-24: leave the key out so the upsert keeps the stored value — a null here
        # would stop the retention clock of a closed shelter.
        logger.error(
            "Unparseable closed_at %r on shelter %s — keeping the projected value",
            raw_closed_at,
            code,
        )
    else:
        payload["closed_at"] = closed_at
    if geo:
        payload["geo"] = geo
    if location_geojson:
        payload["location"] = location_geojson
    return ("upsert", payload)
