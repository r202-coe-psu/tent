"""Aggregate public metrics from Mongo projections (public_shelters + public_persons)."""

from __future__ import annotations

from datetime import UTC, datetime

from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter

from .schemas import TransparencySummary, TransparencySummaryResponse

# Ready-to-serve (matches former CouchDB transparency OPEN+FULL mapping).
OPEN_SHELTER_STATUSES = frozenset({"open", "full"})

# Public metrics occupancy_total = Forecast (CR-112). Kitchen/partner stay active-only.
OCCUPANCY_STATUSES = (
    "pre_registered",
    "arriving",
    "active",
    "room_confirmed",
    "temporary_leave",
)


class TransparencyUseCase:
    async def get_summary(self) -> TransparencySummaryResponse:
        shelters = await PublicShelter.find_all().to_list()
        shelters_total = len(shelters)
        shelters_open = sum(1 for s in shelters if s.status in OPEN_SHELTER_STATUSES)

        occupancy_total = await PublicPerson.find(
            {"status": {"$in": list(OCCUPANCY_STATUSES)}}
        ).count()

        # as_of = when this aggregate was computed (OP-7 client stale check),
        # not max(shelter.updated_at) — shelter docs can sit unchanged for hours.
        now = datetime.now(UTC)

        return TransparencySummaryResponse(
            summary=TransparencySummary(
                shelters_total=shelters_total,
                shelters_open=shelters_open,
                occupancy_total=occupancy_total,
                # birth_year is not on public_persons — kill-switch stays on in flags,
                # but the value is withheld until the projection carries age data.
                vulnerable_count=None,
            ),
            last_updated=now,
            is_stale=False,
        )


def get_transparency_use_case() -> TransparencyUseCase:
    return TransparencyUseCase()
