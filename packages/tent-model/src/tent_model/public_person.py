from __future__ import annotations

from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import IndexModel


class PersonAddress(BaseModel):
    """Household residence, plaintext (CR-257) — masked or formatted by the API, never dumped."""

    address_no: str | None = None
    village_no: str | None = None
    subdistrict: str | None = None
    district: str | None = None
    province: str | None = None
    postal_code: str | None = None


class PublicPerson(Document):
    """Search projection of one evacuee.

    CR-257: holds plaintext PII (surname, ID numbers, phone, address). Exposure is decided by
    the API per endpoint/scope — the anonymous public search masks it, partner full mode does
    not. Never serialize this document as a whole into a response.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    shelter_code: str
    first_name: str
    # Plaintext (CR-257). `None` on rows projected before PROJECTION_VERSION 23.
    last_name: str | None = None
    # CR-166 name-search keys — never returned by the API. `first_name_key` is the
    # normalized first name (prefix match); `last_name_hash` is sha256 of the normalized
    # full surname (exact match) — surname search stays exact-hash only even though the
    # plaintext is stored now (CR-099 / CR-166 / CR-257 FR-10).
    first_name_key: str = ""
    last_name_hash: str | None = None

    # Plaintext ID (CR-257): `national_id` also carries `pink_card` / `other` numbers (so they
    # are found by `national_id_hash`); `id_card_type` tells them apart.
    national_id: str | None = None
    national_id_hash: str | None = None
    passport_id: str | None = None
    passport_hash: str | None = None
    id_card_type: str | None = None

    address: PersonAddress | None = None
    phone: str | None = None
    phone_hash: str | None = None

    # Deprecated (CR-257): written by the worker before PROJECTION_VERSION 23 only. Read as a
    # fallback on masked paths until every row is re-projected; never in partner full mode.
    last_name_masked: str | None = None
    national_id_masked: str | None = None
    passport_id_masked: str | None = None
    address_masked: str | None = None

    gender: str | None = None
    checked_in_at: datetime | None = None
    care_zone: str | None = None
    household_id: str | None = None

    search_excluded: bool = False
    status: str
    updated_at: datetime

    class Settings:
        name = "public_persons"
        indexes = [
            IndexModel([("first_name_key", 1)]),
            IndexModel([("last_name_hash", 1), ("first_name_key", 1)]),
            IndexModel([("first_name", 1)]),
            IndexModel([("national_id_hash", 1)]),
            IndexModel([("passport_hash", 1)]),
            IndexModel([("phone_hash", 1)]),
            IndexModel([("shelter_code", 1)]),
            IndexModel([("household_id", 1)]),
        ]
