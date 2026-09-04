"""DOPA administrative code lookup — API-layer only (ADR 0002 §4, EXT-002/003).

Maps free-text Thai province/district/subdistrict names (as stored on the CouchDB
`shelter` doc and copied verbatim onto `public_shelters`) to the standard TIS 1099
numeric administrative codes, without touching the CouchDB schema.

**Coverage caveat:** this is a partial reference table scoped to this project's
pilot area (the deep-south provinces + this project's actual seed data — Songkhla/
Hat Yai, Pattani). The specific numeric codes below were filled from general
knowledge of the TIS 1099 standard, not a verified authoritative DOPA export —
verify against the official dataset before relying on them for anything beyond
dev/research use. Unmapped names return ``None`` rather than a guessed code.
"""

from __future__ import annotations

from dataclasses import dataclass

# province_code — TIS 1099-2548, 2-digit.
_PROVINCE_CODES: dict[str, str] = {
    "กรุงเทพมหานคร": "10",
    "สงขลา": "90",
    "สตูล": "91",
    "ตรัง": "92",
    "พัทลุง": "93",
    "ปัตตานี": "94",
    "ยะลา": "95",
    "นราธิวาส": "96",
}

# district_code — province_code + 2-digit amphoe sequence.
_DISTRICT_CODES: dict[tuple[str, str], str] = {
    ("สงขลา", "เมืองสงขลา"): "9001",
    ("สงขลา", "หาดใหญ่"): "9007",
    ("ปัตตานี", "เมืองปัตตานี"): "9401",
}

# subdistrict_code — district_code + 2-digit tambon sequence.
_SUBDISTRICT_CODES: dict[tuple[str, str, str], str] = {
    ("สงขลา", "หาดใหญ่", "หาดใหญ่"): "900701",
    ("สงขลา", "หาดใหญ่", "คอหงส์"): "900704",
    ("สงขลา", "หาดใหญ่", "บ้านพรุ"): "900714",
}


@dataclass(frozen=True)
class DopaCodes:
    province_code: str | None
    district_code: str | None
    subdistrict_code: str | None


def lookup_dopa_codes(
    province: str | None, district: str | None, subdistrict: str | None
) -> DopaCodes:
    """Best-effort name → code lookup; missing/unmapped names resolve to ``None``."""
    province_code = _PROVINCE_CODES.get(province) if province else None
    district_code = _DISTRICT_CODES.get((province, district)) if province and district else None
    subdistrict_code = (
        _SUBDISTRICT_CODES.get((province, district, subdistrict))
        if province and district and subdistrict
        else None
    )
    return DopaCodes(
        province_code=province_code,
        district_code=district_code,
        subdistrict_code=subdistrict_code,
    )
