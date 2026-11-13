"""`/v1/integrations/*` — M5 outbound client, status gate, transfers and sync.

M5 is faked with `httpx.MockTransport` behind a real `HttpM5Client` (draft CR — referral
M5 integration §5). Behaviour of the fake follows the M5 guide v1.0 and the 2026-11-11
staging spike.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from tent_model import M5OutboundLog, M5Transfer

from apiapp.modules.integrations_m5.client import HttpM5Client, get_m5_client
from apiapp.modules.integrations_m5.use_case import reset_caches

NATIONAL_ID = "1101700203450"


class FakeM5:
    """In-memory M5 staging stand-in."""

    def __init__(self) -> None:
        self.transfers: dict[str, dict[str, Any]] = {}  # code -> transfer
        self.bodies: dict[str, dict[str, Any]] = {}  # external_ref -> TRF-002 body
        self.tokens: set[str] = set()
        self.token_calls = 0
        self.calls: list[str] = []
        self.auth_error: str | None = None
        self.next_response: httpx.Response | None = None
        self.raise_timeout = False

    def _transfer(self, code: str, ref: str, body: dict[str, Any]) -> dict[str, Any]:
        return {
            "objectid": len(self.transfers) + 1,
            "code": code,
            "status": "awaiting_review",
            "origin": {"kind": "shelter", "module": "M4", **body["origin"]},
            "destination": {"facility_id": body["destination_facility_id"], "name": "รพ.ทดสอบ"},
            "original_destination": None,
            "patients": [
                {
                    "acuity": p["acuity"],
                    "name": p.get("name", ""),
                    "national_id_masked": "x-xxxx-xxxxx-45-0" if p.get("national_id") else "",
                    "age": p.get("age"),
                    "condition": p.get("condition", ""),
                }
                for p in body["patients"]
            ],
            "external_ref": ref,
            "review": {"note": "", "by": None, "at": None},
            "activity": [{"action": "create", "by": "x", "at": "2026-11-11T00:00:00Z", "note": ""}],
            "created_at": "2026-11-11T00:00:00Z",
        }

    def set_status(self, code: str, status: str, **extra: Any) -> None:
        self.transfers[code] = {**self.transfers[code], "status": status, **extra}

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append(f"{request.method} {path}")
        if self.raise_timeout:
            raise httpx.ConnectTimeout("boom", request=request)
        if path == "/api/auth/token-third-party":
            self.token_calls += 1
            if self.auth_error:
                return httpx.Response(401, json={"error": self.auth_error})
            token = f"tok-{self.token_calls}"
            self.tokens.add(token)
            return httpx.Response(
                200,
                json={
                    "access_token": token,
                    "token_type": "Bearer",
                    "expires_in": 86400,
                    "module_name": "M4",
                    "scopes": ["transfer-write"],
                },
            )
        auth = request.headers.get("Authorization", "").removeprefix("Bearer ")
        if auth not in self.tokens:
            return httpx.Response(401, json={"detail": "Given token not valid for any token type"})
        if self.next_response is not None:
            res, self.next_response = self.next_response, None
            return res

        if path == "/api/thirdparty/facilities":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "facility_id": 6,
                            "name": "รพ.สนามหาดใหญ่",
                            "category": "general",
                            "district": "หาดใหญ่",
                            "province": "สงขลา",
                            "latitude": 7.0086,
                            "longitude": 100.4747,
                            "readiness": None,
                        }
                    ],
                    "total": 1,
                },
            )
        if path == "/api/thirdparty/transfers" and request.method == "POST":
            body = json.loads(request.content)
            ref = body["external_ref"]
            if ref in self.bodies:
                code = next(c for c, t in self.transfers.items() if t["external_ref"] == ref)
                if self.bodies[ref] != body:
                    return httpx.Response(
                        409,
                        json={
                            "code": "external_ref_in_use",
                            "message": "ใช้แล้ว",
                            "transfer_code": code,
                        },
                    )
                return httpx.Response(200, json={**self.transfers[code], "replayed": True})
            code = f"TRF-20261111-{len(self.transfers) + 1:04d}"
            self.bodies[ref] = body
            self.transfers[code] = self._transfer(code, ref, body)
            return httpx.Response(201, json={**self.transfers[code], "replayed": False})
        if path == "/api/thirdparty/transfers" and request.method == "GET":
            wanted = request.url.params.get("status")
            items = [
                t for t in self.transfers.values() if not wanted or t["status"] in wanted.split(",")
            ]
            limit = int(request.url.params.get("limit", 50))
            return httpx.Response(
                200, json={"data": items[:limit], "total": len(items), "page": 1, "limit": limit}
            )
        parts = path.removeprefix("/api/thirdparty/transfers/").split("/")
        code = parts[0]
        transfer = self.transfers.get(code)
        if transfer is None:
            return httpx.Response(404, json={"detail": "Not found."})
        if len(parts) == 1:
            return httpx.Response(200, json=transfer)
        if parts[1] == "start":
            if transfer["status"] != "pending":
                return httpx.Response(
                    409,
                    json={"code": "not_pending", "message": "ยัง", "status": transfer["status"]},
                )
            self.set_status(code, "in_transit")
            return httpx.Response(200, json=self.transfers[code])
        if parts[1] == "cancel":
            if transfer["status"] == "awaiting_review":
                self.set_status(code, "cancelled")
                return httpx.Response(200, json=self.transfers[code])
            m5_code = "cancel_needs_moph" if transfer["status"] == "pending" else "already_closed"
            return httpx.Response(
                409, json={"code": m5_code, "message": "x", "status": transfer["status"]}
            )
        return httpx.Response(404, json={"detail": "Not found."})


def _client_for(fake: FakeM5, *, configured: bool = True) -> HttpM5Client:
    return HttpM5Client(
        base_url="https://m5.test" if configured else "",
        client_id="cid",
        client_secret="secret",
        transport=httpx.MockTransport(fake.handler),
    )


@pytest.fixture(autouse=True)
def _reset_m5_caches() -> None:
    reset_caches()


@pytest.fixture
def fake() -> FakeM5:
    return FakeM5()


@pytest.fixture
async def m5_app(app: FastAPI, fake: FakeM5) -> AsyncGenerator[FastAPI]:
    m5 = _client_for(fake)
    app.dependency_overrides[get_m5_client] = lambda: m5
    yield app
    app.dependency_overrides.pop(get_m5_client, None)


def _create_body(ref: str = "TENT-SH001-01JC0000000000000000000000", **over: Any) -> dict:
    body = {
        "shelter_code": "SH001",
        "batch_id": "01JC0000000000000000000000",
        "external_ref": ref,
        "origin": {
            "location_code": "SH001",
            "location_name": "ศูนย์ทดสอบ",
            "latitude": 7.0084,
            "longitude": 100.4747,
        },
        "requester": {"contact_name": "สมชาย", "contact_role": "หัวหน้า", "contact_phone": "081"},
        "destination_facility_id": 6,
        "transport_vehicle_type": "van",
        "patients": [
            {
                "referral_id": "referral:A",
                "acuity": "red",
                "name": "ผู้ป่วย หนึ่ง",
                "national_id": NATIONAL_ID,
                "age": 67,
                "condition": "หายใจลำบาก",
            },
            {"referral_id": "referral:B", "acuity": "yellow", "name": "ผู้ป่วย สอง"},
        ],
        "actor": "manager1",
    }
    return {**body, **over}


async def _row(ref: str) -> dict | None:
    return await M5Transfer.get_pymongo_collection().find_one({"_id": ref})


# --- auth -----------------------------------------------------------------------------


async def test_routes_require_external_secret(client: AsyncClient, m5_app: FastAPI) -> None:
    res = await client.get("/v1/integrations/status")
    assert res.status_code == 401


# --- status gate ----------------------------------------------------------------------


async def test_status_not_configured(
    client: AsyncClient, app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    m5 = _client_for(fake, configured=False)
    app.dependency_overrides[get_m5_client] = lambda: m5
    try:
        res = await client.get("/v1/integrations/status", headers=auth_headers)
    finally:
        app.dependency_overrides.pop(get_m5_client, None)
    assert res.status_code == 200
    m5_status = res.json()["m5"]
    assert m5_status["configured"] is False
    assert m5_status["error"] == "not_configured"
    assert fake.calls == []


async def test_status_ready_is_cached(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    first = await client.get("/v1/integrations/status", headers=auth_headers)
    calls = len(fake.calls)
    second = await client.get("/v1/integrations/status", headers=auth_headers)
    assert first.json()["m5"] | {"checked_at": None} == {
        "configured": True,
        "token_ok": True,
        "reachable": True,
        "checked_at": None,
        "error": None,
    }
    assert second.status_code == 200
    assert len(fake.calls) == calls  # served from cache


async def test_status_credential_invalid_opens_circuit(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    fake.auth_error = "invalid_client"
    res = await client.get("/v1/integrations/status", headers=auth_headers)
    assert res.json()["m5"]["error"] == "credential_invalid"
    reset_caches()
    await client.get("/v1/integrations/status", headers=auth_headers)
    assert fake.token_calls == 1  # circuit open: no second token request


async def test_status_unavailable_on_timeout(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    fake.raise_timeout = True
    res = await client.get("/v1/integrations/status", headers=auth_headers)
    assert res.json()["m5"]["error"] == "unavailable"
    assert res.json()["m5"]["reachable"] is False


# --- TRF-001 --------------------------------------------------------------------------


async def test_facilities_pass_through_and_cache(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    res = await client.get("/v1/integrations/m5/facilities?q=หาดใหญ่", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["data"][0]["facility_id"] == 6
    calls = len(fake.calls)
    await client.get("/v1/integrations/m5/facilities?q=หาดใหญ่", headers=auth_headers)
    assert len(fake.calls) == calls


# --- TRF-002 --------------------------------------------------------------------------


async def test_create_transfer_records_row_without_full_national_id(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    body = _create_body()
    res = await client.post("/v1/integrations/m5/transfers", json=body, headers=auth_headers)
    assert res.status_code == 201
    assert res.json() == {
        "code": "TRF-20261111-0001",
        "status": "awaiting_review",
        "external_ref": body["external_ref"],
        "replayed": False,
    }
    # referral_id never reaches M5; absent optional fields are omitted, not null.
    sent = fake.bodies[body["external_ref"]]
    assert "referral_id" not in sent["patients"][0]
    assert sent["patients"][1] == {"acuity": "yellow", "name": "ผู้ป่วย สอง"}

    row = await _row(body["external_ref"])
    assert row is not None
    assert row["referral_ids"] == ["referral:A", "referral:B"]
    assert row["rev"] == 1 and row["applied_rev"] == 0
    assert row["patients"][0] == {
        "referral_id": "referral:A",
        "acuity": "red",
        "national_id_masked": "x-xxxx-xxxxx-45-0",
    }
    assert NATIONAL_ID not in json.dumps(row, default=str)
    assert "ผู้ป่วย" not in json.dumps(row, default=str, ensure_ascii=False)

    logs = await M5OutboundLog.get_pymongo_collection().find({"endpoint": "TRF-002"}).to_list(None)
    assert len(logs) == 1
    assert logs[0]["actor"] == "manager1" and logs[0]["patient_count"] == 2
    assert NATIONAL_ID not in json.dumps(logs, default=str)


async def test_create_transfer_replay_is_idempotent(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    body = _create_body()
    await client.post("/v1/integrations/m5/transfers", json=body, headers=auth_headers)
    res = await client.post("/v1/integrations/m5/transfers", json=body, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["replayed"] is True
    assert len(fake.transfers) == 1
    row = await _row(body["external_ref"])
    assert row is not None and row["created_at"] is not None


async def test_create_transfer_recovers_existing_on_ref_conflict(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    body = _create_body()
    await client.post("/v1/integrations/m5/transfers", json=body, headers=auth_headers)
    await M5Transfer.get_pymongo_collection().delete_many({})  # first send never recorded
    changed = _create_body(note="แก้ไข")
    res = await client.post("/v1/integrations/m5/transfers", json=changed, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["code"] == "TRF-20261111-0001"
    assert res.json()["replayed"] is True
    assert (await _row(body["external_ref"])) is not None
    assert len(fake.transfers) == 1


@pytest.mark.parametrize(
    ("m5_response", "status", "code"),
    [
        (
            httpx.Response(400, json={"code": "destination_not_found", "message": "x"}),
            409,
            "M5_DESTINATION_NOT_FOUND",
        ),
        (
            httpx.Response(400, json={"patients": [{"national_id": ["13 หลัก"]}]}),
            422,
            "M5_VALIDATION",
        ),
        (httpx.Response(502, text="bad gateway"), 503, "M5_UNAVAILABLE"),
        (httpx.Response(403, json={"detail": "scope"}), 503, "M5_CREDENTIAL_INVALID"),
    ],
)
async def test_create_transfer_error_mapping(
    client: AsyncClient,
    m5_app: FastAPI,
    fake: FakeM5,
    auth_headers: dict,
    m5_response: httpx.Response,
    status: int,
    code: str,
) -> None:
    await client.get("/v1/integrations/m5/facilities", headers=auth_headers)  # warm token
    fake.next_response = m5_response
    res = await client.post(
        "/v1/integrations/m5/transfers", json=_create_body(), headers=auth_headers
    )
    assert res.status_code == status
    detail = res.json()["errors"][0]
    assert detail["code"] == code
    if code == "M5_VALIDATION":
        assert detail["fields"] == {"patients": [{"national_id": ["13 หลัก"]}]}
    assert await _row(_create_body()["external_ref"]) is None


async def test_expired_token_is_refreshed_once(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    await client.get("/v1/integrations/m5/facilities", headers=auth_headers)
    fake.tokens.clear()  # M5 forgets the cached token
    reset_caches()
    res = await client.get("/v1/integrations/m5/facilities?q=x", headers=auth_headers)
    assert res.status_code == 200
    assert fake.token_calls == 2


async def test_create_transfer_rejects_bad_request(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    res = await client.post(
        "/v1/integrations/m5/transfers", json=_create_body(patients=[]), headers=auth_headers
    )
    assert res.status_code == 422
    assert fake.calls == []


# --- TRF-004 / 005 / 006 --------------------------------------------------------------


async def _created(client: AsyncClient, auth_headers: dict) -> str:
    res = await client.post(
        "/v1/integrations/m5/transfers", json=_create_body(), headers=auth_headers
    )
    return res.json()["code"]


async def test_start_before_approval_is_not_pending(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    code = await _created(client, auth_headers)
    res = await client.post(
        f"/v1/integrations/m5/transfers/{code}/start", json={}, headers=auth_headers
    )
    assert res.status_code == 409
    assert res.json()["errors"][0] | {"message": None} == {
        "code": "NOT_PENDING",
        "message": None,
        "status": "awaiting_review",
    }


async def test_start_after_approval_moves_to_in_transit(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    code = await _created(client, auth_headers)
    fake.set_status(code, "pending")
    res = await client.post(
        f"/v1/integrations/m5/transfers/{code}/start", json={"actor": "m"}, headers=auth_headers
    )
    assert res.status_code == 200 and res.json()["status"] == "in_transit"
    row = await _row(_create_body()["external_ref"])
    assert row is not None and row["status"] == "in_transit" and row["rev"] == 2


async def test_cancel_awaiting_review(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    code = await _created(client, auth_headers)
    res = await client.post(
        f"/v1/integrations/m5/transfers/{code}/cancel",
        json={"reason": "อาการดีขึ้น"},
        headers=auth_headers,
    )
    assert res.status_code == 200 and res.json()["status"] == "cancelled"
    row = await _row(_create_body()["external_ref"])
    assert row is not None and row["status"] == "cancelled"


async def test_cancel_after_approval_needs_moph_and_refreshes_row(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    code = await _created(client, auth_headers)
    fake.set_status(code, "pending", review={"note": "ok", "by": "สธ.", "at": "t"})
    res = await client.post(
        f"/v1/integrations/m5/transfers/{code}/cancel", json={"reason": "x"}, headers=auth_headers
    )
    assert res.status_code == 409
    assert res.json()["errors"][0]["code"] == "CANCEL_NEEDS_MOPH"
    row = await _row(_create_body()["external_ref"])
    assert row is not None and row["status"] == "pending" and row["review"]["by"] == "สธ."


async def test_cancel_requires_reason(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    code = await _created(client, auth_headers)
    res = await client.post(
        f"/v1/integrations/m5/transfers/{code}/cancel", json={"reason": ""}, headers=auth_headers
    )
    assert res.status_code == 422


async def test_transfer_code_is_validated(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    res = await client.get("/v1/integrations/m5/transfers/..%2Fadmin", headers=auth_headers)
    assert res.status_code in (404, 422)
    assert fake.calls == []


async def test_get_transfer_unknown_is_404(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    res = await client.get("/v1/integrations/m5/transfers/TRF-20261111-9999", headers=auth_headers)
    assert res.status_code == 404
    assert res.json()["errors"][0]["code"] == "M5_NOT_FOUND"


# --- sync -----------------------------------------------------------------------------


async def test_sync_skips_without_open_rows(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    res = await client.post("/v1/integrations/m5/sync", headers=auth_headers)
    assert res.json() == {"skipped": True, "checked": 0, "changed": 0}
    assert fake.calls == []


async def test_sync_applies_open_and_closed_changes(
    client: AsyncClient, m5_app: FastAPI, fake: FakeM5, auth_headers: dict
) -> None:
    ref_a = "TENT-SH001-A"
    ref_b = "TENT-SH001-B"
    a = await client.post(
        "/v1/integrations/m5/transfers",
        json=_create_body(ref_a, batch_id="A"),
        headers=auth_headers,
    )
    b = await client.post(
        "/v1/integrations/m5/transfers",
        json=_create_body(ref_b, batch_id="B"),
        headers=auth_headers,
    )
    review = {"note": "เปลี่ยนปลายทาง", "by": "สธ.", "at": "2026-11-11T01:00:00Z"}
    fake.set_status(
        a.json()["code"],
        "pending",
        review=review,
        destination={"facility_id": 2, "name": "รพ.ใหม่"},
        original_destination={"facility_id": 6, "name": "รพ.ทดสอบ"},
    )
    fake.set_status(b.json()["code"], "arrived")  # closed: no longer in the open list

    res = await client.post("/v1/integrations/m5/sync", headers=auth_headers)
    assert res.json() == {"skipped": False, "checked": 2, "changed": 2}

    row_a = await _row(ref_a)
    row_b = await _row(ref_b)
    assert row_a is not None and row_b is not None
    assert row_a["status"] == "pending" and row_a["review"] == review
    assert row_a["original_destination"]["facility_id"] == 6
    assert row_a["rev"] == 2 and row_b["status"] == "arrived" and row_b["rev"] == 2

    again = await client.post("/v1/integrations/m5/sync", headers=auth_headers)
    assert again.json() == {"skipped": False, "checked": 1, "changed": 0}
    assert (await _row(ref_a))["rev"] == 2
