"""Shared identity and profile-merge rules for public volunteer applications."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Iterable, Mapping
from typing import Any


def normalize_phone(phone: str) -> str:
    """Return the canonical digit-only Thai phone representation."""
    digits = re.sub(r"[\s\-()]+", "", phone)
    if digits.startswith("+66"):
        return f"0{digits[3:]}"
    if digits.startswith("66") and len(digits) >= 11:
        return f"0{digits[2:]}"
    return digits


def phone_hash(phone: str) -> str:
    return hashlib.sha256(normalize_phone(phone).encode("utf-8")).hexdigest()


def normalize_skill(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip()).casefold()


def merge_skills(existing: Iterable[str], submitted: Iterable[str]) -> list[str]:
    """Union skills while keeping the existing display order."""
    result: list[str] = []
    seen: set[str] = set()
    for value in [*existing, *submitted]:
        clean = value.strip()
        key = normalize_skill(clean)
        if clean and key not in seen:
            seen.add(key)
            result.append(clean)
    return result


def identity_status(profile: Mapping[str, Any] | None) -> str:
    if not profile:
        return "pending"
    record = profile.get("identity_verification")
    if isinstance(record, Mapping) and record.get("status") in {"verified", "pending", "rejected"}:
        return str(record["status"])
    return "verified" if profile.get("identity_verified") is True else "pending"


def skill_status(profile: Mapping[str, Any] | None, skill: str) -> str | None:
    if not profile:
        return None
    records = profile.get("skill_verifications")
    if not isinstance(records, Mapping):
        return None
    wanted = normalize_skill(skill)
    for key, record in records.items():
        if normalize_skill(str(key)) == wanted and isinstance(record, Mapping):
            status = record.get("status")
            return str(status) if status is not None else None
    return None


def has_verified_skill(profile: Mapping[str, Any] | None, skill: str) -> bool:
    return skill_status(profile, skill) == "verified"


def candidate_conflicts(candidates: Iterable[Mapping[str, Any]]) -> bool:
    """Conservative conflict check for profiles sharing a phone hash."""
    rows = list(candidates)
    names = {
        (normalize_skill(str(row.get("first_name", ""))), normalize_skill(str(row.get("last_name", ""))))
        for row in rows
        if row.get("first_name") or row.get("last_name")
    }
    national_ids = {
        str(row["national_id_hash"])
        for row in rows
        if row.get("national_id_hash")
    }
    emails = {
        normalize_skill(str(row["email"]))
        for row in rows
        if row.get("email")
    }
    return len(names) > 1 or len(national_ids) > 1 or len(emails) > 1


def merge_profile(
    existing: Mapping[str, Any],
    *,
    first_name: str,
    last_name: str,
    phone: str,
    phone_hash_value: str,
    national_id: str | None,
    national_id_hash: str | None,
    email: str | None,
    submitted_skills: Iterable[str],
    controlled_skills: Iterable[str],
    now: str,
) -> dict[str, Any]:
    """Merge an application into an existing profile without downgrading evidence."""
    merged = dict(existing)
    submitted = [value.strip() for value in submitted_skills if value.strip()]
    controlled = {normalize_skill(value) for value in controlled_skills}
    merged["phone"] = phone.strip() or existing.get("phone")
    merged["phone_hash"] = phone_hash_value
    merged["skills"] = merge_skills(existing.get("skills", []), submitted)
    if first_name.strip():
        merged["first_name"] = first_name.strip()
    if last_name.strip():
        merged["last_name"] = last_name.strip()
    if email is not None and email.strip():
        merged["email"] = email.strip()
    if national_id and not existing.get("national_id"):
        merged["national_id"] = national_id
        merged["national_id_hash"] = national_id_hash

    identity = dict(existing.get("identity_verification") or {})
    identity.setdefault("status", "verified" if existing.get("identity_verified") is True else "pending")
    identity.setdefault("reviewed_at", None)
    identity.setdefault("reviewed_by", None)
    identity.setdefault("notes", None)
    merged["identity_verification"] = identity
    merged["identity_verified"] = identity.get("status") == "verified"

    records: dict[str, Any] = {
        str(key): dict(value) if isinstance(value, Mapping) else value
        for key, value in (existing.get("skill_verifications") or {}).items()
    }
    for skill in submitted:
        if normalize_skill(skill) not in controlled:
            continue
        key = next((key for key in records if normalize_skill(key) == normalize_skill(skill)), skill)
        old = records.get(key)
        if isinstance(old, Mapping) and old.get("status") in {"verified", "rejected"}:
            # Verified evidence is reusable; rejected evidence is not silently promoted.
            continue
        record = dict(old) if isinstance(old, Mapping) else {}
        record.setdefault("reviewed_at", None)
        record.setdefault("reviewed_by", None)
        record.setdefault("notes", None)
        record["status"] = "pending"
        records[key] = record
    merged["skill_verifications"] = records
    merged["updated_at"] = now
    merged["updated_by"] = "public"
    return merged
