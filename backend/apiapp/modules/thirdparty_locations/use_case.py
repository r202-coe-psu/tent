"""Use case for EXT-002/003 partner Location Master endpoints (partner ODT)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from tent_model.public_shelter import PublicShelter

from .dopa_codes import lookup_dopa_codes
from .schemas import (
    LocationDetailEnvelope,
    LocationDetailItem,
    LocationItem,
    LocationListEnvelope,
)


def _location_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"error": {"code": code, "message": message}}
    )


def _compose_facilities(raw: dict[str, Any]) -> list[str]:
    """Best-effort free-text facility list from the structured registry fields — the
    partner ODT expects free text (e.g. "ห้องน้ำ 12 ห้อง"); our schema stores counts/flags."""
    facilities = raw.get("facilities") or {}
    common_areas = raw.get("common_areas") or {}
    utilities = raw.get("utilities") or {}
    items: list[str] = []

    toilets = sum(
        int(facilities.get(key) or 0)
        for key in ("toilets_female", "toilets_male", "toilets_accessible")
    )
    if toilets:
        items.append(f"ห้องน้ำ {toilets} ห้อง")
    if facilities.get("showers"):
        items.append(f"ห้องอาบน้ำ {int(facilities['showers'])} ห้อง")
    if facilities.get("water_points"):
        items.append(f"จุดน้ำดื่ม {int(facilities['water_points'])} จุด")

    if common_areas.get("central_kitchen"):
        items.append("ครัวกลาง")
    if common_areas.get("isolation_room"):
        items.append("ห้องแยกกักตัว")
    if common_areas.get("women_child_friendly_space"):
        items.append("พื้นที่ปลอดภัยสำหรับผู้หญิงและเด็ก")
    if common_areas.get("helipad"):
        items.append("ลานจอดเฮลิคอปเตอร์")

    power_source = utilities.get("power_source")
    if power_source == "generator":
        items.append("ไฟฟ้าสำรอง (เครื่องปั่นไฟ)")
    elif power_source == "solar":
        items.append("ไฟฟ้าสำรอง (โซลาร์เซลล์)")

    return items


def _to_item(doc: PublicShelter) -> LocationItem:
    dopa = lookup_dopa_codes(doc.province, doc.district, doc.subdistrict)
    return LocationItem(
        location_code=doc.shelter_code,
        name_th=doc.name,
        name_short=doc.name_short,
        location_type=doc.location_type,
        location_subtype=doc.location_subtype,
        location_status=doc.location_status,
        latitude=doc.geo.lat if doc.geo else None,
        longitude=doc.geo.lng if doc.geo else None,
        address=doc.address,
        subdistrict_code=dopa.subdistrict_code,
        district_code=dopa.district_code,
        province_code=dopa.province_code,
        capacity=doc.capacity,
        contact_phone=doc.contact_phone,
        contact_name=doc.contact_name,
        operating_org=doc.operating_org,
        accepts_delivery=doc.accepts_delivery,
        delivery_note=doc.delivery_note,
        opened_at=doc.opened_at,
        closed_at=doc.closed_at,
        is_active=doc.is_active,
        occupancy_total=doc.occupancy_total,
        updated_at=doc.updated_at,
    )


def _to_detail(doc: PublicShelter) -> LocationDetailItem:
    return LocationDetailItem(
        **_to_item(doc).model_dump(),
        facilities=_compose_facilities(doc.raw_data),
    )


class ThirdPartyLocationsUseCase:
    async def list_locations(
        self,
        status_filter: str | None,
        updated_since: datetime | None,
        include_inactive: bool,
    ) -> LocationListEnvelope:
        query: dict[str, Any] = {}
        if status_filter:
            query["location_status"] = status_filter
        if not include_inactive:
            query["is_active"] = True
        if updated_since:
            query["updated_at"] = {"$gte": updated_since}

        docs = await PublicShelter.find(query).sort("+shelter_code").to_list()
        items = [_to_item(doc) for doc in docs]
        return LocationListEnvelope(result=items)

    async def get_location(self, location_code: str) -> LocationDetailEnvelope:
        doc = await PublicShelter.find_one(PublicShelter.shelter_code == location_code)
        if doc is None:
            raise _location_error(
                status.HTTP_404_NOT_FOUND,
                "location_not_found",
                f"No location with code '{location_code}'",
            )
        return LocationDetailEnvelope(result=_to_detail(doc))


def get_thirdparty_locations_use_case() -> ThirdPartyLocationsUseCase:
    return ThirdPartyLocationsUseCase()
