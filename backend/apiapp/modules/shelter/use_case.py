"""Shelter public list use case."""

from __future__ import annotations

from datetime import UTC, datetime

from tent_model.public_shelter import PublicShelter

from .schemas import ShelterDetailResponse, ShelterItem, ShelterListResponse


class ShelterUseCase:
    """Read-only queries against the public_shelters projection."""

    async def list_shelters(
        self,
        *,
        province: str | None = None,
        district: str | None = None,
        subdistrict: str | None = None,
        status: str | None = None,
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

        if filters:
            docs = await PublicShelter.find(filters).sort("+name").to_list()
        else:
            docs = await PublicShelter.find_all().sort("+name").to_list()

        shelters = []
        for doc in docs:
            m = doc.raw_data or {}

            # extract pet_policy
            petStatus = "ไม่อนุญาต"
            admin_policy = m.get("admission_policy") or {}
            pet_policy = admin_policy.get("pet_policy") or {}
            zones = m.get("zones") or []
            facilities = m.get("facilities") or {}

            vul_groups = list(admin_policy.get("supported_vulnerable_groups") or [])
            if not vul_groups:
                if any(z.get("type") == "vulnerable" for z in zones):
                    vul_groups.append("กลุ่มเปราะบางทั่วไป")
                if any(z.get("type") == "quarantine" for z in zones):
                    vul_groups.append("ผู้ป่วยแยกกักโรค")
                if (facilities.get("toilets_accessible") or 0) > 0:
                    vul_groups.append("ผู้ใช้วีลแชร์")

            if not vul_groups:
                vul_groups = ["ไม่มีโซนเฉพาะ"]

            if pet_policy.get("policy") == "conditional":
                cats = []
                for c in pet_policy.get("categories") or []:
                    cat = c.get("category")
                    if cat == "small_general":
                        cats.append("สัตว์เล็กทั่วไป")
                    elif cat == "large_dog":
                        cats.append("สุนัขพันธุ์ใหญ่")
                    elif cat == "livestock":
                        cats.append("ปศุสัตว์")
                    else:
                        cats.append(str(cat))
                petStatus = f"อนุญาตแบบมีเงื่อนไข ({', '.join(cats)})"
            elif any(z.get("type") == "pet" for z in zones):
                petStatus = "อนุญาต (มีโซนสัตว์เลี้ยง)"

            admin_type = m.get("shelter_type") or "ไม่ระบุประเภท"

            shelters.append(
                ShelterItem(
                    code=doc.shelter_code,
                    name=doc.name,
                    status=doc.status,
                    capacity=doc.capacity,
                    geo=doc.geo,
                    province=doc.province,
                    district=doc.district,
                    subdistrict=doc.subdistrict,
                    pet_policy=petStatus,
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

        mappedStatus = "CLOSED"
        op_status = m.get("operation_status")
        if op_status == "active":
            mappedStatus = "OPEN"
        elif op_status == "full_capacity":
            mappedStatus = "FULL"
        elif op_status == "standby":
            mappedStatus = "PREPARE"

        occupancy = 0
        if mappedStatus in ("OPEN", "FULL"):
            occupancy = await PublicPerson.find({"shelter_code": code, "status": "active"}).count()

        capacity_total = m.get("capacity") or 0
        capacity_available = max(0, capacity_total - occupancy)
        occupancy_rate = round((occupancy / capacity_total) * 100) if capacity_total > 0 else 0

        area_type = m.get("area_type")
        building_status = "ไม่ระบุ"
        if area_type == "indoor":
            building_status = "อาคารปิด (ในร่ม)"
        elif area_type == "outdoor":
            building_status = "ลานเปิด (กลางแจ้ง)"
        elif area_type == "hybrid":
            building_status = "ผสมผสาน (มีทั้งในร่มและกลางแจ้ง)"

        admin_policy = m.get("admission_policy") or {}
        vul_groups = list(admin_policy.get("supported_vulnerable_groups") or [])
        zones = m.get("zones") or []
        facilities = m.get("facilities") or {}

        if not vul_groups:
            if any(z.get("type") == "vulnerable" for z in zones):
                vul_groups.append("กลุ่มเปราะบางทั่วไป")
            if any(z.get("type") == "quarantine" for z in zones):
                vul_groups.append("ผู้ป่วยแยกกักโรค")
            if (facilities.get("toilets_accessible") or 0) > 0:
                vul_groups.append("ผู้ใช้วีลแชร์")

        if not vul_groups:
            vul_groups = ["ไม่มีโซนเฉพาะ"]

        pet_policy = admin_policy.get("pet_policy") or {}
        petStatus = "ไม่อนุญาต"
        if pet_policy.get("policy") == "conditional":
            cats = []
            for c in pet_policy.get("categories") or []:
                cat = c.get("category")
                if cat == "small_general":
                    cats.append("สัตว์เล็กทั่วไป")
                elif cat == "large_dog":
                    cats.append("สุนัขพันธุ์ใหญ่")
                elif cat == "livestock":
                    cats.append("ปศุสัตว์")
                else:
                    cats.append(str(cat))
            petStatus = f"อนุญาตแบบมีเงื่อนไข ({', '.join(cats)})"
        elif any(z.get("type") == "pet" for z in zones):
            petStatus = "อนุญาต (มีโซนสัตว์เลี้ยง)"

        utilities = m.get("utilities") or {}
        power_source = utilities.get("power_source")
        power = "ไม่มีข้อมูล"
        if power_source == "generator":
            power = "เครื่องปั่นไฟ"
        elif power_source == "solar":
            power = "โซลาร์เซลล์"
        elif power_source == "city_grid":
            power = "การไฟฟ้า"

        water_source = utilities.get("water_source")
        water = "ไม่มีข้อมูล"
        if water_source == "groundwater":
            water = "น้ำบาดาล"
        elif water_source == "water_tank":
            water = "รถบรรทุกน้ำ"
        elif water_source == "city_water":
            water = "การประปา"

        comms_map = {"cellular": "สัญญาณมือถือ", "wifi": "Wi-Fi", "vhf_radio": "VHF"}
        comms = [comms_map.get(c, c) for c in (utilities.get("communications") or [])]

        common_areas = m.get("common_areas") or {}
        kitchen = "โรงครัวกลาง" if common_areas.get("central_kitchen") else "ไม่มีโรงครัว"
        parking = f"{common_areas.get('parking_capacity') or 0} คัน"

        contact = m.get("contact") or {}
        key_personnel = m.get("key_personnel") or {}
        eoc_liaison = key_personnel.get("eoc_liaison") or {}

        manager_name = contact.get("name") or eoc_liaison.get("name") or "เจ้าหน้าที่ประสานงาน"
        manager_phone = contact.get("phone") or eoc_liaison.get("phone") or "ไม่มีข้อมูลติดต่อ"

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
                "name": m.get("name") or doc.name or "ไม่มีชื่อศูนย์พักพิง",
                "status": mappedStatus,
                "admin_type": m.get("shelter_type") or "ไม่ระบุประเภท",
                "address": location.get("address") or "ไม่ระบุที่อยู่",
                "capacity": {"total": capacity_total, "available": capacity_available},
                "occupancy_rate": occupancy_rate,
                "building_status": building_status,
                "geo": doc.geo,
                "admission_policy": {"pets": petStatus, "vulnerable_groups": vul_groups},
                "travel": {
                    "route": risk.get("entrance_description") or "ไม่มีข้อมูล",
                    "altitude": (
                        f"{risk.get('elevation_m')} เมตร" if risk.get("elevation_m") else "ไม่มีข้อมูล"
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
