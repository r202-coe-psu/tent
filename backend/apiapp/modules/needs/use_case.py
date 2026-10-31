"""Needs public list use case."""

from __future__ import annotations

from datetime import UTC, datetime

from tent_model.public_need import PublicNeed
from tent_model.public_shelter import PublicShelter

from .schemas import (
    ExternalNeedItemResponse,
    ExternalNeedsListResponse,
    ExternalShelterNeedsResponse,
    NeedItemResponse,
    NeedsListResponse,
    ShelterNeedsResponse,
)

#: The projector writes ``normal`` / ``critical``; any other value ranks between them.
_URGENCY_RANK = {"normal": 0, "critical": 2}


def _item_id(need: PublicNeed) -> str:
    """``item_id`` from the field; rows projected before PROJECTION_VERSION 15 have none.

    Their ``_id`` is ``{shelter}:{item_id}`` and the item id itself holds colons
    (``item_master:x``), so only the shelter prefix is removed, never split on the first
    colon of the item.
    """
    if need.item_id:
        return need.item_id
    return need.id.removeprefix(f"{need.shelter_code}:")


class NeedsUseCase:
    async def _open_shelters(self) -> dict[str, PublicShelter]:
        shelters = await PublicShelter.find({"status": {"$in": ["open", "full"]}}).to_list()
        return {shelter.shelter_code: shelter for shelter in shelters}

    async def list_needs(self) -> NeedsListResponse:
        needs = await PublicNeed.find_all().to_list()
        shelters = await self._open_shelters()

        grouped: dict[str, list[NeedItemResponse]] = {}
        for need in needs:
            shelter = shelters.get(need.shelter_code)
            if shelter is None:
                continue
            point_id = need.drop_off_point_id
            point_names = {point.id: point.name for point in shelter.donation_points}
            grouped.setdefault(need.shelter_code, []).append(
                NeedItemResponse(
                    item_id=_item_id(need),
                    drop_off_point_id=point_id,
                    drop_off_point_name=point_names.get(point_id) if point_id else None,
                    name=need.item_name,
                    qty_needed=str(need.qty_needed),
                    qty_target=str(need.qty_target),
                    on_hand=str(need.on_hand),
                    reserved=str(need.reserved),
                    unit=need.unit,
                    category=need.category,
                    urgency=need.urgency,
                    status="open" if need.qty_needed > 0 else "closed",
                )
            )

        result = [
            ShelterNeedsResponse(
                code=code,
                name=shelters[code].name,
                needs=sorted(items, key=lambda n: (n.item_id, n.drop_off_point_id or "")),
            )
            for code, items in sorted(grouped.items())
        ]
        return NeedsListResponse(shelters=result, as_of=datetime.now(UTC))

    async def list_needs_external(self) -> ExternalNeedsListResponse:
        """``/external/v1/needs`` keeps its pre-A2 shape: one row per shelter + item.

        The card rows are summed back (CR-206 A2 FR-AP-27): ``qty_needed`` /
        ``qty_target`` / ``reserved`` add up, ``on_hand`` is item-level so any row's
        value is the item's, ``urgency`` is the highest, ``status`` is ``open`` when the
        summed ``qty_needed`` is above 0.
        """
        needs = await PublicNeed.find_all().to_list()
        shelters = await self._open_shelters()

        merged: dict[str, dict[str, ExternalNeedItemResponse]] = {}
        sums: dict[tuple[str, str], list[float]] = {}
        for need in needs:
            if need.shelter_code not in shelters:
                continue
            item_id = _item_id(need)
            key = (need.shelter_code, item_id)
            by_item = merged.setdefault(need.shelter_code, {})
            if item_id not in by_item:
                by_item[item_id] = ExternalNeedItemResponse(
                    item_id=item_id,
                    name=need.item_name,
                    qty_needed="0",
                    on_hand=str(need.on_hand),
                    unit=need.unit,
                    status="closed",
                    urgency=need.urgency,
                    category=need.category,
                )
                sums[key] = [0.0, 0.0, 0.0]
            row = by_item[item_id]
            totals = sums[key]
            totals[0] += need.qty_needed
            totals[1] += need.qty_target
            totals[2] += need.reserved
            if _URGENCY_RANK.get(need.urgency, 1) > _URGENCY_RANK.get(row.urgency, 1):
                row.urgency = need.urgency

        result: list[ExternalShelterNeedsResponse] = []
        for code, by_item in sorted(merged.items()):
            items: list[ExternalNeedItemResponse] = []
            for item_id, row in sorted(by_item.items()):
                needed, target, reserved = sums[(code, item_id)]
                row.qty_needed = str(needed)
                row.qty_target = str(target)
                row.reserved = str(reserved)
                row.status = "open" if needed > 0 else "closed"
                items.append(row)
            result.append(
                ExternalShelterNeedsResponse(code=code, name=shelters[code].name, needs=items)
            )
        return ExternalNeedsListResponse(shelters=result, as_of=datetime.now(UTC))


def get_needs_use_case() -> NeedsUseCase:
    return NeedsUseCase()
