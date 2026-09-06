"""Use case for EXT-006 partner cross-location summary (partner ODT, ADR 0002 §5)."""

from __future__ import annotations

from datetime import UTC, datetime

from tent_model.public_shelter import PublicShelter
from tent_model.shelter_stock import ShelterStock

from .schemas import CriticalItem, SummaryEnvelope, SummaryLocationItem, SummaryResult


def stock_alert_level(quantity_on_hand: float, reorder_threshold: float | None) -> str | None:
    """`critical` when qty ≤ 0, `low` when below the reorder threshold, `None` (omit)
    when healthy or no threshold is configured — ADR 0002 §5 / ext-spec.md."""
    if quantity_on_hand <= 0:
        return "critical"
    if reorder_threshold is not None and quantity_on_hand < reorder_threshold:
        return "low"
    return None


def _critical_items(rows: list[ShelterStock]) -> list[CriticalItem]:
    items: list[CriticalItem] = []
    for row in rows:
        level = stock_alert_level(row.quantity_on_hand, row.reorder_threshold)
        if level is None:
            continue
        items.append(
            CriticalItem(
                name_th=row.name_th,
                quantity_on_hand=row.quantity_on_hand,
                unit_label=row.unit_label,
                level=level,
            )
        )
    return items


class ThirdPartySummaryUseCase:
    async def get_summary(self, *, include_occupancy: bool) -> SummaryEnvelope:
        shelters = (
            await PublicShelter.find(PublicShelter.is_active == True)  # noqa: E712
            .sort("+shelter_code")
            .to_list()
        )

        locations: list[SummaryLocationItem] = []
        occupancy_total = 0
        capacity_total = 0

        for shelter in shelters:
            capacity_total += shelter.capacity
            occupancy_total += shelter.occupancy_total
            stock_rows = await ShelterStock.find(
                ShelterStock.shelter_code == shelter.shelter_code
            ).to_list()
            locations.append(
                SummaryLocationItem(
                    location_code=shelter.shelter_code,
                    name_th=shelter.name,
                    location_status=shelter.location_status,
                    latitude=shelter.geo.lat if shelter.geo else None,
                    longitude=shelter.geo.lng if shelter.geo else None,
                    capacity=shelter.capacity,
                    occupancy_total=shelter.occupancy_total,
                    critical_items=_critical_items(stock_rows),
                    updated_at=shelter.updated_at,
                )
            )

        return SummaryEnvelope(
            result=SummaryResult(
                generated_at=datetime.now(UTC),
                location_count=len(locations),
                occupancy_total=occupancy_total if include_occupancy else None,
                capacity_total=capacity_total,
                locations=locations,
            )
        )


def get_thirdparty_summary_use_case() -> ThirdPartySummaryUseCase:
    return ThirdPartySummaryUseCase()
