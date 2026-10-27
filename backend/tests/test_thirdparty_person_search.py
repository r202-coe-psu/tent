"""EXT-012 — partner person search tests (#736).

`POST /external/persons/search?purpose=` with scope `occupant-search`: reuses the public search
rules (`parse_search_query`, masking — CR-166 / CR-099) behind the partner envelope, drops
`cancelled` people, never returns `family_members`, and leaves a `ThirdPartyAccessLog` row that
holds no query text. It must NOT write a `search_audits` document.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.search_audit import SearchAudit
from tent_model.third_party_access_log import ThirdPartyAccessLog

from apiapp.modules.thirdparty_auth.scopes import mint_access_token
from apiapp.utils.masking import (
    last_name_hash,
    mask_last_name,
    name_key,
    national_id_hash,
    passport_hash,
    phone_hash,
)

URL = "/external/persons/search"
PURPOSE = {"purpose": "ext-012-check"}
CID = "3900100244192"
PHONE = "0812345678"
PASSPORT = "AA1234567"
FIRST_NAME = "สมชาย"
LAST_NAME = "ใจดี"
NAME_QUERY = f"{FIRST_NAME} {LAST_NAME}"


def _bearer(scopes: list[str], module_name: str | None = "M2") -> dict[str, str]:
    token, _ = mint_access_token(client_id="ext012-test", module_name=module_name, scopes=scopes)
    return {"Authorization": f"Bearer {token}"}


GRANTED = _bearer(["occupant-search"])


@pytest.fixture
async def shelter() -> PublicShelter:
    return await PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="ศูนย์หนึ่ง",
        status="open",
        location_status="open",
        is_active=True,
        capacity=100,
        updated_at=datetime.now(UTC),
    ).insert()


async def _person(
    suffix: str = "01",
    *,
    status: str = "active",
    search_excluded: bool = False,
    first_name: str = FIRST_NAME,
    household_id: str | None = None,
    keyed: bool = True,
    last_name_masked: str | None = None,
) -> PublicPerson:
    """One `public_persons` row findable by CID, phone, passport and name at once.

    `keyed=False` leaves out every search key (a household member nobody searches for).
    """
    return await PublicPerson(
        id=f"evacuee:{suffix}",
        shelter_code="SH001",
        first_name=first_name,
        first_name_key=name_key(first_name),
        last_name_masked=last_name_masked or mask_last_name(LAST_NAME),
        last_name_hash=last_name_hash(LAST_NAME) if keyed else None,
        national_id_masked="390-XXXX-XX-192",
        national_id_hash=national_id_hash(CID) if keyed else None,
        passport_id_masked="AA****67",
        passport_hash=passport_hash(PASSPORT) if keyed else None,
        phone_hash=phone_hash(PHONE) if keyed else None,
        gender="male",
        household_id=household_id,
        search_excluded=search_excluded,
        status=status,
        updated_at=datetime.now(UTC),
    ).insert()


async def _search(
    client: AsyncClient,
    query: str,
    *,
    headers: dict[str, str] = GRANTED,
    params: dict[str, str] | None = PURPOSE,
):
    return await client.post(URL, params=params, json={"search": query}, headers=headers)


# 1 ────────────────────────────────────────────────────────────────────────────


async def test_requires_bearer_token(client: AsyncClient) -> None:
    """401 (not 404) also proves the route is mounted — auto-discovery swallows ImportError."""
    response = await client.post(URL, params=PURPOSE, json={"search": CID})
    assert response.status_code == 401
    assert response.json()["code"] == "invalid_token"


# 2 ────────────────────────────────────────────────────────────────────────────


async def test_missing_purpose_is_400_and_logged(client: AsyncClient) -> None:
    response = await _search(client, CID, params=None)
    assert response.status_code == 400
    assert response.json()["code"] == "missing_purpose"

    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [log.status for log in logs] == ["denied_missing_purpose"]
    assert logs[0].endpoint == "EXT-012"


async def test_purpose_is_checked_before_scope(client: AsyncClient) -> None:
    """Order of checks: purpose → scope → validation (same as EXT-007 / EXT-011)."""
    response = await _search(client, "a", headers=_bearer(["location-read"]), params=None)
    assert response.status_code == 400
    assert response.json()["code"] == "missing_purpose"


# 3 ────────────────────────────────────────────────────────────────────────────


async def test_missing_scope_is_403_and_logged(client: AsyncClient) -> None:
    response = await _search(client, CID, headers=_bearer(["location-read", "residency-read"]))
    assert response.status_code == 403
    assert response.json()["code"] == "insufficient_scope"

    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [log.status for log in logs] == ["denied_insufficient_scope"]
    assert logs[0].endpoint == "EXT-012"


async def test_scope_is_checked_before_validation(client: AsyncClient) -> None:
    response = await _search(client, "a", headers=_bearer(["location-read"]))
    assert response.status_code == 403
    assert response.json()["code"] == "insufficient_scope"


# 4 ────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("query", ["a", "ก ข", "x" * 201])
async def test_invalid_query_is_422_and_logged(client: AsyncClient, query: str) -> None:
    response = await _search(client, query)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"

    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [log.status for log in logs] == ["denied_validation_error"]
    assert logs[0].endpoint == "EXT-012"
    # Compare field values, not the serialized JSON: a one-letter query like "a" is a
    # substring of ordinary keys such as "created_at".
    values = [v for v in logs[0].model_dump().values() if isinstance(v, str)]
    assert query not in values
    if len(query) >= 3:
        assert not any(query in v for v in values)


# 4b — a malformed body is judged by the use case (purpose → scope → validation) and logged,
# not rejected up front by FastAPI.
_BAD_BODIES = [
    {"json": {"search": 123}},
    {"json": {"search": ["0101234567890"]}},
    {"json": ["not", "an", "object"]},
    {"content": b"{not json", "headers": {"Content-Type": "application/json"}},
    {"content": b"[" * 200_000, "headers": {"Content-Type": "application/json"}},
    {"content": b'{"search": "\\ud800x ab"}', "headers": {"Content-Type": "application/json"}},
    {},
]


def _post_raw(client: AsyncClient, body: dict, *, headers: dict[str, str], params):
    extra = dict(body)
    merged = {**headers, **extra.pop("headers", {})}
    return client.post(URL, params=params, headers=merged, **extra)


@pytest.mark.parametrize("body", _BAD_BODIES)
async def test_malformed_body_without_purpose_is_400_and_logged(
    client: AsyncClient, body: dict
) -> None:
    response = await _post_raw(client, body, headers=GRANTED, params=None)
    assert response.status_code == 400
    assert response.json()["code"] == "missing_purpose"
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [log.status for log in logs] == ["denied_missing_purpose"]


@pytest.mark.parametrize("body", _BAD_BODIES)
async def test_malformed_body_without_scope_is_403_and_logged(
    client: AsyncClient, body: dict
) -> None:
    response = await _post_raw(client, body, headers=_bearer(["location-read"]), params=PURPOSE)
    assert response.status_code == 403
    assert response.json()["code"] == "insufficient_scope"
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [log.status for log in logs] == ["denied_insufficient_scope"]


@pytest.mark.parametrize("body", _BAD_BODIES)
async def test_malformed_body_is_422_validation_error_and_logged(
    client: AsyncClient, body: dict
) -> None:
    response = await _post_raw(client, body, headers=GRANTED, params=PURPOSE)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [log.status for log in logs] == ["denied_validation_error"]
    assert logs[0].endpoint == "EXT-012"


# 5────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("query", [CID, NAME_QUERY, PHONE, PASSPORT, PASSPORT.lower()])
async def test_search_returns_masked_envelope_without_family(
    client: AsyncClient, shelter: PublicShelter, query: str
) -> None:
    await _person("parent", household_id="household:01")
    await _person("child", first_name="ลูก", household_id="household:01", keyed=False)

    response = await _search(client, query)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == 200
    assert body["message"] == "Found Data."
    assert len(body["result"]) == 1
    item = body["result"][0]
    assert item["name"] == f"{FIRST_NAME} {mask_last_name(LAST_NAME)}"
    assert item["status"] == "active"
    assert item["national_id"] == "390-XXXX-XX-192"
    assert item["shelter_name"] == "ศูนย์หนึ่ง"
    # Masked / absent: no plaintext identifiers, and no household members at all.
    assert "family_members" not in item
    assert "phone" not in item
    assert "passport" not in item
    assert CID not in response.text
    assert PHONE not in response.text
    assert PASSPORT not in response.text


async def test_no_match_is_200_with_empty_result(client: AsyncClient) -> None:
    response = await _search(client, CID)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == 200
    assert body["result"] == []

    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [(log.status, log.result_count) for log in logs] == [("granted", 0)]


@pytest.mark.parametrize(
    "stay_status", ["pre_registered", "kiosk_registered", "checked_out", "transferred", "deceased"]
)
async def test_every_non_cancelled_status_is_reported_as_itself(
    client: AsyncClient, shelter: PublicShelter, stay_status: str
) -> None:
    await _person(status=stay_status)
    response = await _search(client, CID)
    assert response.status_code == 200
    assert [item["status"] for item in response.json()["result"]] == [stay_status]


# 6 ────────────────────────────────────────────────────────────────────────────


async def test_cancelled_person_is_not_returned(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    await _person(status="cancelled")
    for query in (CID, PHONE, PASSPORT, NAME_QUERY):
        response = await _search(client, query)
        assert response.status_code == 200
        assert response.json()["result"] == []


@pytest.mark.parametrize("query", [CID, PHONE, PASSPORT, NAME_QUERY])
async def test_cancelled_rows_are_filtered_before_the_ten_row_limit(
    client: AsyncClient, shelter: PublicShelter, query: str
) -> None:
    """10 cancelled rows sort ahead of the one active row: filtering after `.limit(10)` would
    return nothing, filtering in the Mongo query returns the active person."""
    for index in range(1, 11):
        await _person(f"a-cancelled-{index:02d}", status="cancelled")
    await _person("z-active", status="active")

    response = await _search(client, query)
    assert response.status_code == 200
    result = response.json()["result"]
    assert [item["status"] for item in result] == ["active"]


@pytest.mark.parametrize("query", [CID, PASSPORT, PHONE])
async def test_id_search_returns_the_first_ten_by_first_name_key(
    client: AsyncClient, shelter: PublicShelter, query: str
) -> None:
    """12 matches inserted in REVERSE order: the 10 returned are the first ten by first name
    (CR-166), whatever the insert order — same contract as public / legacy occupants search."""
    for index in range(12, 0, -1):
        await _person(
            f"{index:02d}",
            first_name=f"ทดสอบ{index:02d}",
            last_name_masked=f"ใจ{index:02d}",
        )

    response = await _search(client, query)
    assert response.status_code == 200
    names = [item["name"] for item in response.json()["result"]]
    assert names == [f"ทดสอบ{index:02d} ใจ{index:02d}" for index in range(1, 11)]


@pytest.mark.parametrize("query", [CID, PASSPORT, PHONE])
async def test_id_search_breaks_first_name_ties_by_id(
    client: AsyncClient, shelter: PublicShelter, query: str
) -> None:
    """Same first name for everyone: `_id` decides which 10 of 12 survive the cap."""
    for index in range(12, 0, -1):
        await _person(f"{index:02d}", first_name="สมศรี", last_name_masked=f"ใจ{index:02d}")

    response = await _search(client, query)
    assert response.status_code == 200
    names = [item["name"] for item in response.json()["result"]]
    assert names == [f"สมศรี ใจ{index:02d}" for index in range(1, 11)]


# 7 ────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("query", [CID, PHONE, PASSPORT, NAME_QUERY])
async def test_search_excluded_person_is_not_returned(
    client: AsyncClient, shelter: PublicShelter, query: str
) -> None:
    await _person("opted-out", search_excluded=True)
    await _person("visible", status="checked_out")

    response = await _search(client, query)
    assert response.status_code == 200
    assert [item["status"] for item in response.json()["result"]] == ["checked_out"]


@pytest.mark.parametrize("query", [CID, PHONE, PASSPORT, NAME_QUERY])
async def test_only_search_excluded_person_gives_empty_result(
    client: AsyncClient, shelter: PublicShelter, query: str
) -> None:
    await _person("opted-out", search_excluded=True)
    response = await _search(client, query)
    assert response.status_code == 200
    assert response.json()["result"] == []


async def test_basic_consent_person_is_absent_once_projection_is_deleted(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    """PDPA FR-40 — the worker deletes a basic-mode person's projection (worker
    `test_project_evacuee_basic_consent_deletes_projection`); partner search then skips them."""
    basic = await _person("basic")
    await _person("visible", status="checked_out")
    before = await _search(client, CID)
    assert len(before.json()["result"]) == 2

    await basic.delete()

    response = await _search(client, CID)
    assert response.status_code == 200
    assert [item["status"] for item in response.json()["result"]] == ["checked_out"]


# 8 ────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("query", [CID, PHONE, PASSPORT, NAME_QUERY])
async def test_no_search_audit_and_log_holds_no_query(
    client: AsyncClient, shelter: PublicShelter, query: str
) -> None:
    await _person()
    response = await _search(client, query, headers=_bearer(["occupant-search"], module_name=None))
    assert response.status_code == 200

    # ThirdPartyAccessLog is the only audit trail — public search's buffer stays untouched.
    assert await SearchAudit.find_all().to_list() == []

    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert len(logs) == 1
    log = logs[0]
    assert log.endpoint == "EXT-012"
    assert log.status == "granted"
    assert log.client_id == "ext012-test"
    assert log.module_name is None
    assert log.purpose == PURPOSE["purpose"]
    assert log.result_count == 1
    dumped = log.model_dump_json()
    for secret in (query, CID, PHONE, PASSPORT, FIRST_NAME, LAST_NAME, national_id_hash(CID)):
        assert secret not in dumped


# 9 ────────────────────────────────────────────────────────────────────────────


async def test_response_is_not_cacheable(client: AsyncClient, shelter: PublicShelter) -> None:
    await _person()
    response = await _search(client, CID)
    assert response.status_code == 200
    assert "no-store" in response.headers["cache-control"]


@pytest.mark.parametrize(
    ("headers", "params", "query", "expected"),
    [
        (GRANTED, None, CID, 400),
        (_bearer(["location-read"]), PURPOSE, CID, 403),
        (GRANTED, PURPOSE, "a", 422),
    ],
)
async def test_error_responses_are_not_cacheable(
    client: AsyncClient,
    headers: dict[str, str],
    params: dict[str, str] | None,
    query: str,
    expected: int,
) -> None:
    response = await _search(client, query, headers=headers, params=params)
    assert response.status_code == expected
    assert "no-store" in response.headers.get("cache-control", "")


# checked_in_at is Bangkok time with an explicit +07:00 offset, like EXT-008–011 (CR-181).


async def test_checked_in_at_is_bangkok_time_with_offset(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    person = await _person()
    person.checked_in_at = datetime(2026, 8, 20, 7, 30, tzinfo=UTC)
    await person.save()

    response = await _search(client, CID)
    assert response.status_code == 200
    assert response.json()["result"][0]["checked_in_at"] == "2026-08-20T14:30:00+07:00"


async def test_checked_in_at_stays_null_before_check_in(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    await _person(status="pre_registered")

    response = await _search(client, CID)
    assert response.status_code == 200
    assert response.json()["result"][0]["checked_in_at"] is None
