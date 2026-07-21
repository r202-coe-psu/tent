"""Needs public list use case."""

from __future__ import annotations

from datetime import UTC, datetime

from tent_model.public_need import PublicNeed
from tent_model.public_shelter import PublicShelter

from .schemas import NeedItemResponse, NeedsListResponse, ShelterNeedsResponse


class NeedsUseCase:
    async def list_needs(self) -> NeedsListResponse:
        needs = await PublicNeed.find_all().to_list()
        shelters = await PublicShelter.find(PublicShelter.status == "open").to_list()
        shelter_names = {shelter.shelter_code: shelter.name for shelter in shelters}

        grouped: dict[str, list[NeedItemResponse]] = {}
        for need in needs:
            if need.shelter_code not in shelter_names:
                continue
            grouped.setdefault(need.shelter_code, []).append(
                NeedItemResponse(
                    item_id=need.id.split(":item:", 1)[-1],
                    name=need.item_name,
                    qty_needed=str(need.qty_needed),
                    unit=need.unit,
                    status="open" if need.qty_needed > 0 else "closed",
                )
            )

        result = [
            ShelterNeedsResponse(
                code=code,
                name=shelter_names[code],
                needs=items,
            )
            for code, items in sorted(grouped.items())
        ]
        return NeedsListResponse(shelters=result, as_of=datetime.now(UTC))


def get_needs_use_case() -> NeedsUseCase:
    return NeedsUseCase()
