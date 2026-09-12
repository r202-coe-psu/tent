"""Canonical volunteer identity resolution for public application paths."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from tent_model.public_volunteer import PublicVolunteer
from tent_model.volunteer_identity import (
    candidate_conflicts,
    identity_status,
    normalize_phone,
    phone_hash,
)

ResolutionStatus = Literal["no_match", "matched_one", "ambiguous_match"]


@dataclass(frozen=True)
class IdentityResolution:
    status: ResolutionStatus
    phone_hash: str
    volunteer_id: str | None = None
    profile: dict[str, Any] | None = None
    candidates: tuple[dict[str, Any], ...] = ()


async def resolve_public_identity(phone: str, shelter_code: str) -> IdentityResolution:
    """Look up a phone only inside one shelter's projected volunteer collection."""
    normalized = normalize_phone(phone)
    hashed = phone_hash(normalized)
    collection = PublicVolunteer.get_motor_collection()
    rows = await collection.find(
        {"shelter_code": shelter_code.upper(), "phone_hash": hashed},
        {
            "_id": 1,
            "first_name": 1,
            "last_name": 1,
            "email": 1,
            "national_id_hash": 1,
            "volunteer_code": 1,
            "skills": 1,
            "identity_verified": 1,
            "identity_verification": 1,
            "skill_verifications": 1,
            "created_at": 1,
        },
    ).to_list(length=100)
    candidates = tuple(row for row in rows if isinstance(row.get("_id"), str))
    if not candidates:
        return IdentityResolution(status="no_match", phone_hash=hashed)
    if len(candidates) > 1:
        # Matching by a shared phone is not enough to choose a person when profiles
        # disagree. The caller must not reveal the other candidates or merge blindly.
        if candidate_conflicts(candidates) or len(candidates) != 1:
            return IdentityResolution(
                status="ambiguous_match", phone_hash=hashed, candidates=candidates
            )
    profile = candidates[0]
    return IdentityResolution(
        status="matched_one",
        phone_hash=hashed,
        volunteer_id=str(profile["_id"]),
        profile=profile,
        candidates=candidates,
    )


def masked_profile_summary(profile: dict[str, Any]) -> dict[str, Any]:
    first = str(profile.get("first_name") or "")
    last = str(profile.get("last_name") or "")
    masked_last = f"{last[:1]}***" if last else "***"
    return {
        "volunteer_code": str(profile.get("volunteer_code") or ""),
        "display_name": f"{first[:1]}*** {masked_last}".strip(),
        "identity_status": identity_status(profile),
        "existing_skills": [
            str(value) for value in profile.get("skills", []) if str(value).strip()
        ],
    }
