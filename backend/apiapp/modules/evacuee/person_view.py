"""Per-field rendering of a `PublicPerson` row — masked or full (CR-257).

The row holds plaintext PII since PROJECTION_VERSION 23; rows projected before that carry only
the legacy `*_masked` fields. Two rules:

- **masked** (public search, EXT-012 without `pii-full`): mask the plaintext; on a legacy row
  fall back to the stored `*_masked` value, so the public output never changes.
- **full** (legacy `/external/v1/occupants`, EXT-012 with `pii-full`): the plaintext as is; on a
  legacy row the field is `None` — never a masked string a partner would store as real data
  (CR-257 FR-9).

A row is "plaintext" when `last_name` is set: the worker always writes it (possibly `""`) from
version 23 on.
"""

from __future__ import annotations

from tent_model.public_person import PublicPerson

from ...utils.masking import (
    format_full_address,
    full_name,
    mask_address,
    mask_last_name,
    mask_national_id,
    mask_passport,
)


def has_plaintext(person: PublicPerson) -> bool:
    return person.last_name is not None


def display_name(person: PublicPerson, *, full: bool) -> str:
    if full:
        return full_name(person.first_name, person.last_name)
    if has_plaintext(person):
        surname = mask_last_name(person.last_name or "")
    else:
        surname = person.last_name_masked or mask_last_name("")
    return f"{person.first_name} {surname}"


def national_id(person: PublicPerson, *, full: bool) -> str | None:
    if full:
        return person.national_id
    if has_plaintext(person):
        return mask_national_id(person.national_id) if person.national_id else None
    return person.national_id_masked


def passport_id(person: PublicPerson, *, full: bool) -> str | None:
    if full:
        return person.passport_id
    if has_plaintext(person):
        return mask_passport(person.passport_id) if person.passport_id else None
    return person.passport_id_masked


def origin_address(person: PublicPerson, *, full: bool) -> str | None:
    address = person.address
    if full:
        if address is None:
            return None
        return format_full_address(**address.model_dump())
    if has_plaintext(person):
        if address is None:
            return None
        return mask_address(address.subdistrict, address.district, address.province)
    return person.address_masked
