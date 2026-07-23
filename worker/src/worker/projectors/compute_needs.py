"""Port of frontend ``computeNeeds`` for worker projections."""

from __future__ import annotations

from typing import Any


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def compute_needs(
    campaigns: list[dict[str, Any]],
    donations: list[dict[str, Any]],
) -> tuple[dict[str, str], dict[str, str]]:
    remaining: dict[str, float] = {}
    item_campaign: dict[str, str] = {}

    for campaign in campaigns:
        campaign_id = str(campaign.get("_id", ""))
        covered: dict[str, float] = {}
        for donation in donations:
            if donation.get("campaign_id") != campaign_id:
                continue
            if donation.get("status") in {"expired", "cancelled"}:
                continue
            for item in donation.get("items") or []:
                item_id = item.get("item_id")
                if not item_id:
                    continue
                covered[item_id] = covered.get(item_id, 0.0) + _to_float(item.get("qty"))

        for need in campaign.get("needs") or []:
            item_id = need.get("item_id")
            if not item_id:
                continue
            target = _to_float(need.get("qty_target"))
            rem = target - covered.get(item_id, 0.0)
            remaining[item_id] = remaining.get(item_id, 0.0) + rem
            if item_id not in item_campaign:
                item_campaign[item_id] = campaign_id

    return (
        {item_id: str(qty) for item_id, qty in remaining.items()},
        item_campaign,
    )
