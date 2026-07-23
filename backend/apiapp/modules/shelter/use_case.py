"""Shelter public list use case."""

from __future__ import annotations

from datetime import UTC, datetime

from tent_model.public_shelter import PublicShelter

from .schemas import ShelterItem, ShelterListResponse


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

        shelters = [
            ShelterItem(
                code=doc.shelter_code,
                name=doc.name,
                status=doc.status,
                capacity=doc.capacity,
                geo=doc.geo,
                province=doc.province,
                district=doc.district,
                subdistrict=doc.subdistrict,
                updated_at=doc.updated_at,
            )
            for doc in docs
        ]

        return ShelterListResponse(
            shelters=shelters,
            count=len(shelters),
            as_of=datetime.now(UTC),
        )


def get_shelter_use_case() -> ShelterUseCase:
    return ShelterUseCase()
