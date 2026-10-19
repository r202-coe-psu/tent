"""Looking donations up by phone number alone (CR-173)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from tent_model.donation_buffer import DonationBuffer, DonorBuffer
from tent_model.public_donation import DeclaredItem, PublicDonation
from tent_model.public_shelter import PublicShelter

from apiapp.modules.donations import use_case as donation_use_case
from apiapp.utils.masking import phone_hash, sha256_hex
from apiapp.utils.ulid import new_ulid

LOOKUP = "/public/v1/donations/lookup-by-phone"


@pytest.fixture(autouse=True)
def _fresh_counters() -> None:
    donation_use_case.phone_lookup_watch.clear()


async def _booking(
    *,
    ref: str,
    phone: str = "0812345678",
    shelter_code: str = "SH001",
    created_ago: timedelta = timedelta(0),
    expires_in: timedelta = timedelta(hours=72),
    status: str = "pending_review",
    items: int = 1,
    logistics: dict | None = None,
) -> DonationBuffer:
    created_at = datetime.now(UTC) - created_ago
    token = f"TX-{shelter_code}-{ref}"
    buffer = DonationBuffer(
        id=f"donation:{new_ulid()}",
        shelter_code=shelter_code,
        donor=DonorBuffer(name="ผู้บริจาค", phone=phone),
        donor_phone_hash=phone_hash(phone),
        items_declared=[{"free_text": f"ของ {i}", "qty": 1, "unit": "ea"} for i in range(items)],
        logistics=logistics,
        booking_ref=ref,
        tracking_token=token,
        tracking_token_hash=sha256_hex(token),
        status=status,
        synced_to_couch=False,
        created_at=created_at,
        expires_at=datetime.now(UTC) + expires_in,
    )
    await buffer.insert()
    return buffer


async def test_lookup_requires_bearer(client: AsyncClient) -> None:
    response = await client.post(LOOKUP, json={"phone": "0812345678"})
    assert response.status_code == 401


async def test_booking_stores_the_hash_of_the_normalized_phone(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="ศูนย์ทดสอบ",
        status="open",
        capacity=100,
        updated_at=datetime.now(UTC),
    ).insert()
    created = await client.post(
        "/public/v1/donations",
        headers=auth_headers,
        json={
            "shelter_code": "SH001",
            "donor": {"name": "Donor", "phone": "081-234-5678"},
            "items": [{"free_text": "น้ำดื่ม", "qty": 1, "unit": "pack"}],
        },
    )
    assert created.status_code == 201
    buffer = await DonationBuffer.find_one(
        DonationBuffer.booking_ref == created.json()["booking_ref"]
    )
    assert buffer is not None
    assert buffer.donor_phone_hash == sha256_hex("0812345678")


async def test_every_booking_of_the_number_newest_first(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="ศูนย์ทดสอบ",
        status="open",
        capacity=100,
        updated_at=datetime.now(UTC),
    ).insert()
    await _booking(ref="DN-100001", created_ago=timedelta(hours=5), items=2)
    await _booking(
        ref="DN-100002",
        created_ago=timedelta(hours=1),
        logistics={
            "delivery_method": "self_dropoff",
            "slot": {"date": "2026-10-20", "from": "09:00", "to": "12:00"},
        },
    )
    await _booking(ref="DN-100003", phone="0899999999")

    response = await client.post(LOOKUP, headers=auth_headers, json={"phone": "0812345678"})

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    items = response.json()["items"]
    assert [i["booking_ref"] for i in items] == ["DN-100002", "DN-100001"]
    newest, older = items
    # Full access: the token opens, edits and cancels the booking (FR-4).
    assert newest["tracking_token"] == "TX-SH001-DN-100002"
    assert newest["shelter_name"] == "ศูนย์ทดสอบ"
    assert newest["delivery_method"] == "self_dropoff"
    assert newest["slot"] == {"date": "2026-10-20", "from": "09:00", "to": "12:00"}
    assert newest["item_count"] == 1
    assert older["item_count"] == 2
    assert older["slot"] is None
    # Read back from Mongo naive; must still say it is UTC or the browser shifts it.
    assert datetime.fromisoformat(newest["created_at"]).utcoffset() == timedelta(0)


@pytest.mark.parametrize("typed", ["0812345678", "081-234-5678", "+66812345678", "081 234 5678"])
async def test_any_way_of_writing_the_number_finds_it(
    client: AsyncClient, auth_headers: dict[str, str], typed: str
) -> None:
    await _booking(ref="DN-200001", phone="081-234-5678")

    response = await client.post(LOOKUP, headers=auth_headers, json={"phone": typed})

    assert [i["booking_ref"] for i in response.json()["items"]] == ["DN-200001"]


async def test_a_number_with_no_bookings_answers_like_one_with_bookings(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await _booking(ref="DN-300001")

    hit = await client.post(LOOKUP, headers=auth_headers, json={"phone": "0812345678"})
    miss = await client.post(LOOKUP, headers=auth_headers, json={"phone": "0800000000"})

    assert hit.status_code == miss.status_code == 200
    assert miss.json() == {"success": True, "items": []}
    assert hit.json().keys() == miss.json().keys()


async def test_a_booking_past_its_ttl_is_not_returned(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """AC-7 — only what the buffer still holds; a row past its TTL awaits the purge."""
    await _booking(ref="DN-400001", expires_in=timedelta(minutes=-1))
    await _booking(ref="DN-400002")

    response = await client.post(LOOKUP, headers=auth_headers, json={"phone": "0812345678"})

    assert [i["booking_ref"] for i in response.json()["items"]] == ["DN-400002"]


async def test_status_comes_from_the_projection_when_there_is_one(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Staff move a booking on in CouchDB; the buffer row keeps its opening status."""
    buffer = await _booking(ref="DN-500001", status="pending_review")
    await PublicDonation(
        id=buffer.id,
        tracking_token_hash=buffer.tracking_token_hash,
        shelter_code="SH001",
        status="declared",
        booking_ref=buffer.booking_ref,
        items_declared=[DeclaredItem(item_name="a"), DeclaredItem(item_name="b")],
        updated_at=datetime.now(UTC),
    ).insert()

    response = await client.post(LOOKUP, headers=auth_headers, json={"phone": "0812345678"})

    [item] = response.json()["items"]
    assert item["status"] == "declared"
    assert item["item_count"] == 2


async def test_input_without_digits_finds_nothing(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(LOOKUP, headers=auth_headers, json={"phone": "--"})
    assert response.json() == {"success": True, "items": []}


async def test_the_phone_is_required_in_the_body(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(f"{LOOKUP}?phone=0812345678", headers=auth_headers, json={})
    assert response.status_code == 422


async def test_every_lookup_is_logged_by_hash_not_by_number(
    client: AsyncClient, auth_headers: dict[str, str], caplog: pytest.LogCaptureFixture
) -> None:
    await _booking(ref="DN-600001")
    headers = {**auth_headers, "X-Real-IP": "203.0.113.8"}

    with caplog.at_level(logging.INFO, logger=donation_use_case.logger.name):
        await client.post(LOOKUP, headers=headers, json={"phone": "081-234-5678"})

    [record] = [r for r in caplog.records if "donation phone lookup" in r.getMessage()]
    message = record.getMessage()
    assert "source=203.0.113.8" in message
    assert f"phone_hash={sha256_hex('0812345678')}" in message
    assert "results=1" in message
    assert "0812345678" not in message.replace(sha256_hex("0812345678"), "")
    assert "081-234-5678" not in message


async def test_many_numbers_from_one_source_raise_an_alert(
    client: AsyncClient, auth_headers: dict[str, str], caplog: pytest.LogCaptureFixture
) -> None:
    headers = {**auth_headers, "X-Real-IP": "203.0.113.9"}
    phones = [f"08100000{n:02d}" for n in range(donation_use_case._LOOKUP_ALERT_MAX_PHONES + 1)]

    with caplog.at_level(logging.INFO, logger=donation_use_case.logger.name):
        for phone in phones[:-1]:
            await client.post(LOOKUP, headers=headers, json={"phone": phone})
        assert not [r for r in caplog.records if r.levelno == logging.WARNING]
        await client.post(LOOKUP, headers=headers, json={"phone": phones[-1]})

    [alert] = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert "source=203.0.113.9" in alert.getMessage()
    assert f"phones={len(phones)}" in alert.getMessage()


def test_watch_counts_lookups_and_distinct_numbers_per_source() -> None:
    watch = donation_use_case._PhoneLookupWatch()
    assert watch.record("a", "h1") == (1, 1)
    assert watch.record("a", "h1") == (2, 1)
    assert watch.record("a", "h2") == (3, 2)
    assert watch.record("b", "h1") == (1, 1)


def test_watch_forgets_sources_that_went_quiet(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [1000.0]
    monkeypatch.setattr(donation_use_case.time, "monotonic", lambda: clock[0])
    watch = donation_use_case._PhoneLookupWatch()
    watch.record("quiet", "h1")

    clock[0] += donation_use_case._LOOKUP_ALERT_WINDOW_SECONDS + 1
    watch.record("busy", "h1")

    assert list(watch._seen) == ["busy"]
