"""Shelter public list use case."""

from __future__ import annotations

from datetime import UTC, datetime

from tent_model.public_shelter import PublicShelter

from .schemas import ShelterDetailResponse, ShelterItem, ShelterListResponse

# Stay statuses that hold a place at a shelter (CR-070 D-BOOK-OCC=C, FR-66):
# a web booking reserves the seat the moment it is made, so `pre_registered`
# counts alongside `active`. Kitchen/SOP head-counts stay `active`-only (CR-022).
OCCUPANCY_STATUSES = ("active", "pre_registered")


class ShelterUseCase:
    """Read-only queries against the public_shelters projection."""

    async def list_shelters(
        self,
        *,
        province: str | None = None,
        district: str | None = None,
        subdistrict: str | None = None,
        status: str | None = None,
        lat: float | None = None,
        lng: float | None = None,
        radius_km: float | None = None,
    ) -> ShelterListResponse:
        filters: dict[str, object] = {}
        if province:
            filters["province"] = province
        if district:
            filters["district"] = district
        if subdistrict:
            filters["subdistrict"] = subdistrict
        if status:
            filters["status"] = status

        has_near = False
        if lat is not None and lng is not None:
            near_query: dict[str, object] = {
                "$geometry": {
                    "type": "Point",
                    "coordinates": [lng, lat],
                }
            }
            if radius_km is not None and radius_km > 0:
                near_query["$maxDistance"] = radius_km * 1000.0  # meters
            filters["location"] = {"$nearSphere": near_query}
            has_near = True

        if has_near:
            docs = await PublicShelter.find(filters).to_list()
        elif filters:
            docs = await PublicShelter.find(filters).sort("+name").to_list()
        else:
            docs = await PublicShelter.find_all().sort("+name").to_list()

        shelters = []
        for doc in docs:
            m = doc.raw_data or {}

            # extract pet_policy
            pet_status = "ไม่อนุญาต"
            admin_policy = m.get("admission_policy") or {}
            pet_policy = admin_policy.get("pet_policy") or {}
            zones = m.get("zones") or []
            facilities = m.get("facilities") or {}

            vul_groups = list(admin_policy.get("supported_vulnerable_groups") or [])
            if not vul_groups:
                if any(z.get("type") == "vulnerable" for z in zones):
                    vul_groups.append("general_vulnerable")
                if any(z.get("type") == "quarantine" for z in zones):
                    vul_groups.append("quarantine")
                if (facilities.get("toilets_accessible") or 0) > 0:
                    vul_groups.append("wheelchair")

            if not vul_groups:
                vul_groups = ["none"]

            if pet_policy.get("policy") == "conditional":
                cats = [str(c.get("category")) for c in pet_policy.get("categories") or []]
                pet_status = f"conditional:{','.join(cats)}"
            elif any(z.get("type") == "pet" for z in zones):
                pet_status = "allowed"

            admin_type = m.get("shelter_type") or "unspecified"

            shelters.append(
                ShelterItem(
                    code=doc.shelter_code,
                    name=doc.name,
                    status=doc.status,
                    capacity=doc.capacity,
                    geo=doc.geo,
                    location=doc.location,
                    province=doc.province,
                    district=doc.district,
                    subdistrict=doc.subdistrict,
                    pet_policy=pet_status,
                    vulnerable_groups=vul_groups,
                    admin_type=admin_type,
                    updated_at=doc.updated_at,
                )
            )

        return ShelterListResponse(
            shelters=shelters,
            count=len(shelters),
            as_of=datetime.now(UTC),
        )

    async def get_shelter(self, code: str) -> ShelterDetailResponse | None:
        from tent_model.public_person import PublicPerson

        doc = await PublicShelter.find_one({"shelter_code": code})
        if not doc:
            return None

        m = doc.raw_data or {}

        mapped_status = "CLOSED"
        op_status = m.get("operation_status")
        if op_status == "active":
            mapped_status = "OPEN"
        elif op_status == "full_capacity":
            mapped_status = "FULL"
        elif op_status == "standby":
            mapped_status = "PREPARE"

        occupancy = 0
        if mapped_status in ("OPEN", "FULL"):
            occupancy = await PublicPerson.find(
                {"shelter_code": code, "status": {"$in": list(OCCUPANCY_STATUSES)}}
            ).count()

        capacity_total = m.get("capacity") or 0
        capacity_available = max(0, capacity_total - occupancy)
        occupancy_rate = round((occupancy / capacity_total) * 100) if capacity_total > 0 else 0

        area_type = m.get("area_type")
        building_status = (
            area_type if area_type in ("indoor", "outdoor", "hybrid") else "unspecified"
        )

        admin_policy = m.get("admission_policy") or {}
        vul_groups = list(admin_policy.get("supported_vulnerable_groups") or [])
        zones = m.get("zones") or []
        facilities = m.get("facilities") or {}

        if not vul_groups:
            if any(z.get("type") == "vulnerable" for z in zones):
                vul_groups.append("general_vulnerable")
            if any(z.get("type") == "quarantine" for z in zones):
                vul_groups.append("quarantine")
            if (facilities.get("toilets_accessible") or 0) > 0:
                vul_groups.append("wheelchair")

        if not vul_groups:
            vul_groups = ["none"]

        pet_policy = admin_policy.get("pet_policy") or {}
        pet_status = "not_allowed"
        if pet_policy.get("policy") == "conditional":
            cats = [str(c.get("category")) for c in pet_policy.get("categories") or []]
            pet_status = f"conditional:{','.join(cats)}"
        elif any(z.get("type") == "pet" for z in zones):
            pet_status = "allowed"

        utilities = m.get("utilities") or {}
        power = utilities.get("power_source") or "none"
        water = utilities.get("water_source") or "none"
        comms = utilities.get("communications") or []

        common_areas = m.get("common_areas") or {}
        kitchen = "central_kitchen" if common_areas.get("central_kitchen") else "none"
        parking = str(common_areas.get("parking_capacity") or 0)

        contact = m.get("contact") or {}
        key_personnel = m.get("key_personnel") or {}
        eoc_liaison = key_personnel.get("eoc_liaison") or {}

        manager_name = contact.get("name") or eoc_liaison.get("name") or "unspecified"
        manager_phone = str(contact.get("phone") or eoc_liaison.get("phone") or "unspecified")

        risk = m.get("risk") or {}

        location = m.get("location") or {}

        mapped_zones = []
        for z in zones:
            if isinstance(z, dict):
                mapped_zones.append(
                    {
                        "name": z.get("name"),
                        "type": z.get("type") or "general",
                        "capacity": z.get("capacity"),
                        "area_m2": z.get("area_m2"),
                    }
                )

        return ShelterDetailResponse(
            shelter={
                "id": code,
                "name": m.get("name") or doc.name or code,
                "status": mapped_status,
                "admin_type": m.get("shelter_type") or "unspecified",
                "address": location.get("address") or "unspecified",
                "capacity": {"total": capacity_total, "available": capacity_available},
                "occupancy_rate": occupancy_rate,
                "building_status": building_status,
                "geo": doc.geo,
                "location": doc.location,
                "admission_policy": {
                    "pets": pet_status,
                    "vulnerable_groups": vul_groups,
                },
                "travel": {
                    "route": risk.get("entrance_description") or "unspecified",
                    "altitude": (
                        str(risk.get("elevation_m")) if risk.get("elevation_m") else "unspecified"
                    ),
                    "flood_warning": risk.get("constraints"),
                },
                "facilities": {
                    "hygiene": {
                        "male": facilities.get("toilets_male") or 0,
                        "female": facilities.get("toilets_female") or 0,
                        "accessible": facilities.get("toilets_accessible") or 0,
                        "shower": facilities.get("showers") or 0,
                        "mobile_toilet": facilities.get("car_toilet_supported") or 0,
                    },
                    "power": power,
                    "water": water,
                    "comms": comms,
                    "kitchen": kitchen,
                    "parking": parking,
                },
                "zones": mapped_zones,
                "contact": {"manager": manager_name, "phone": manager_phone},
                "faq": [],
            }
        )


def get_shelter_use_case() -> ShelterUseCase:
    return ShelterUseCase()
