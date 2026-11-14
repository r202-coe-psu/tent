"""`/v1/integrations/m6/*` — M6 outbound client, withdrawals, status gate and sync.

M6 is faked with `httpx.MockTransport` behind a real `HttpM6Client` (draft CR — central
warehouse M6 §3, §6). Behaviour of the fake follows the M6 guide v2.1.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from tent_model import M6ConfirmOutbox, M6OutboundLog, M6Withdrawal

from apiapp.modules.integrations_m5.client import HttpM5Client, get_m5_client
from apiapp.modules.integrations_m5.use_case import reset_caches as reset_m5_caches
from apiapp.modules.integrations_m6.client import (
    HttpM6Client,
    M6CredentialInvalid,
    M6Unavailable,
    get_m6_client,
)
from apiapp.modules.integrations_m6.use_case import reset_caches

SHELTER = "SH001"
REF = "TENT-SH001-01JC0000000000000000000000"
TS = "2026-11-12T03:04:05.123456"  # no offset, microseconds: M6 guide v2.1 quirks


class Clock:
    """Controllable monotonic clock for token-expiry tests."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeM6:
    """In-memory M6 staging stand-in."""

    def __init__(self) -> None:
        self.access_tokens: set[str] = set()
        self.refresh_tokens: set[str] = set()
        self.resource_types = ["nonfood", "food"]
        self.token_calls = 0
        self.refresh_calls = 0
        self.calls: list[str] = []
        self.auth_error: str | None = None
        self.always_401 = False
        self.next_response: httpx.Response | None = None
        self.raise_timeout = False
        self.withdrawals: dict[str, dict[str, Any]] = {}
        self.create_bodies: list[dict[str, Any]] = []
        self.confirm_bodies: list[dict[str, Any]] = []
        self.cancel_bodies: list[dict[str, Any]] = []
        self.warehouses = [
            {
                "warehouse_code": "WH-01",
                "name": "คลังกลางหาดใหญ่",
                "district": "หาดใหญ่",
                "lat": 7.0,
                "lng": 100.4,
            }
        ]
        self.stock = {
            "WH-01": [
                {
                    "item_code": "ITM-1",
                    "reference_id": 11,
                    "name": "ผ้าห่ม",
                    "type_code": "nonfood",
                    "unit": "ผืน",
                    "on_hand": 20.0,
                    "available": 18,
                },
                {
                    "item_code": "ITM-2",
                    "reference_id": 12,
                    "name": "น้ำดื่ม",
                    "type_code": "food",
                    "unit": "แพ็ค",
                    "on_hand": 5,
                    "available": 5.0,
                },
            ]
        }

    # --- helpers for tests ---------------------------------------------------------------

    def set_status(self, code: str, status: str, **extra: Any) -> None:
        self.withdrawals[code].update(status=status, **extra)

    def _issue(self) -> httpx.Response:
        self.token_calls += 1
        access, refresh = f"acc-{self.token_calls}", f"ref-{self.token_calls}"
        self.access_tokens.add(access)
        self.refresh_tokens.add(refresh)
        return httpx.Response(
            200,
            json={
                "access_token": access,
                "refresh_token": refresh,
                "token_type": "Bearer",
                "expires_in": 3600,
                "refresh_expires_in": 86400,
                "module_name": "TENT",
                "scopes": ["read", "request", "confirm"],
                "resource_types": self.resource_types,
            },
        )

    def _withdrawal_body(self, code: str) -> dict[str, Any]:
        w = self.withdrawals[code]
        return {
            "request_code": code,
            "status": w["status"],
            "source_warehouse_code": w["warehouse"],
            "submitted_at": TS,
            "approved_at": w.get("approved_at"),
            "completed_at": w.get("completed_at"),
            "lines": [
                {"item_code": ln["item_code"], "qty": float(ln["qty"]), "qty_fulfilled": f}
                for ln, f in zip(
                    w["lines"], w.get("fulfilled") or [None] * len(w["lines"]), strict=True
                )
            ],
            "destination": w["destination"],
            "received_by": None,
            "responded_at": TS,
        }

    # --- transport -----------------------------------------------------------------------

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if self.raise_timeout:
            self.calls.append(f"TIMEOUT {path}")
            raise httpx.ConnectTimeout("boom", request=request)
        if path == "/api/auth/token-third-party":
            body = json.loads(request.content)
            if body["grant_type"] == "refresh_token":
                self.calls.append("AUTH-002")
                self.refresh_calls += 1
                if body["refresh_token"] not in self.refresh_tokens:
                    return httpx.Response(401, json={"error": "invalid_grant"})
                self.refresh_tokens.discard(body["refresh_token"])  # rotation
                return self._issue()
            self.calls.append("AUTH-001")
            if self.auth_error:
                return httpx.Response(401, json={"error": self.auth_error})
            return self._issue()

        self.calls.append(f"{request.method} {path}")
        auth = request.headers.get("Authorization", "").removeprefix("Bearer ")
        if self.always_401 or auth not in self.access_tokens:
            return httpx.Response(401, json={"detail": "Given token not valid for any token type"})
        if self.next_response is not None:
            res, self.next_response = self.next_response, None
            return res

        if path == "/api/thirdparty/warehouses":
            return httpx.Response(
                200,
                json={
                    "data": self.warehouses,
                    "total": len(self.warehouses),
                    "responded_at": TS,
                },
            )
        if path.startswith("/api/thirdparty/warehouses/") and path.endswith("/stock"):
            code = path.split("/")[4]
            if code not in self.stock:
                return httpx.Response(404, json={"detail": f"warehouse {code} not found"})
            rows = self.stock[code]
            return httpx.Response(
                200, json={"warehouse_code": code, "data": rows, "total": len(rows)}
            )
        if path == "/api/thirdparty/catalog/search":
            self.catalog_params = dict(request.url.params)
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "reference_id": 11,
                            "name_th": "ผ้าห่ม",
                            "name_en": None,
                            "type_code": "nonfood",
                            "base_unit": "ผืน",
                            "external_code": None,
                            "verified": True,
                            "warehouses_count": 2.0,
                            "item_code": "ITM-1",
                            "in_warehouse": True,
                        }
                    ],
                    "cursor": 2,
                    "total": 1,
                },
            )
        if path == "/api/thirdparty/withdrawals" and request.method == "POST":
            body = json.loads(request.content)
            self.create_bodies.append(body)
            ref = body["requester"]["external_ref"]
            for code, w in self.withdrawals.items():
                if w["external_ref"] == ref:  # idempotent on external_ref
                    return httpx.Response(
                        200, json={"request_code": code, "status": w["status"], "responded_at": TS}
                    )
            code = f"REQ-20261112-{len(self.withdrawals) + 1:04d}"
            self.withdrawals[code] = {
                "status": "pending",
                "external_ref": ref,
                "warehouse": body["source_warehouse_code"],
                "lines": body["lines"],
                "destination": body["destination"],
            }
            return httpx.Response(
                201, json={"request_code": code, "status": "pending", "responded_at": TS}
            )

        parts = path.removeprefix("/api/thirdparty/withdrawals/").split("/")
        code = parts[0]
        if code not in self.withdrawals:
            return httpx.Response(404, json={"detail": "withdrawal not found"})
        w = self.withdrawals[code]
        if len(parts) == 1:
            return httpx.Response(200, json=self._withdrawal_body(code))
        if parts[1] == "confirm-receipt":
            self.confirm_bodies.append(json.loads(request.content))
            if w["status"] != "in_transit":
                return httpx.Response(422, json={"detail": "request_not_in_transit"})
            w["status"] = "received"
            return httpx.Response(200, json={"request_code": code, "status": "received"})
        if parts[1] == "cancel":
            self.cancel_bodies.append(json.loads(request.content))
            if w["status"] != "pending":
                return httpx.Response(422, json={"detail": "request_not_cancellable"})
            w["status"] = "cancelled"
            return httpx.Response(200, json={"request_code": code, "status": "cancelled"})
        return httpx.Response(404, json={"detail": "Not found."})


def _client_for(fake: FakeM6, *, configured: bool = True, clock: Any = None) -> HttpM6Client:
    extra = {"clock": clock} if clock else {}
    return HttpM6Client(
        base_url="https://m6.test" if configured else "",
        client_id="cid",
        client_secret="secret",
        transport=httpx.MockTransport(fake.handler),
        **extra,
    )


def _m5_off() -> HttpM5Client:
    """An unconfigured M5 client: the shared /status never touches the network."""
    return HttpM5Client(base_url="", client_id="", client_secret="")


@pytest.fixture(autouse=True)
def _reset_caches() -> None:
    reset_caches()
    reset_m5_caches()


@pytest.fixture
def fake() -> FakeM6:
    return FakeM6()


@pytest.fixture
async def m6_app(app: FastAPI, fake: FakeM6) -> AsyncGenerator[FastAPI]:
    m6 = _client_for(fake)
    m5 = _m5_off()
    app.dependency_overrides[get_m6_client] = lambda: m6
    app.dependency_overrides[get_m5_client] = lambda: m5
    yield app
    app.dependency_overrides.pop(get_m6_client, None)
    app.dependency_overrides.pop(get_m5_client, None)


def _create_body(ref: str = REF, shelter: str = SHELTER, **over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "shelter_code": shelter,
        "external_ref": ref,
        "source_warehouse_code": "WH-01",
        "source_warehouse_name": "คลังกลางหาดใหญ่",
        "requester": {
            "location_code": shelter,
            "location_type": "shelter",
            "location_name": "ศูนย์ทดสอบ",
            "contact_name": "สมชาย",
            "contact_role": "หัวหน้าศูนย์",
            "contact_phone": "081-000-0000",
            "external_ref": ref,
        },
        "destination": {
            "location_code": shelter,
            "name": "ศูนย์ทดสอบ",
            "type": "shelter",
            "lat": 7.0084,
            "lng": 100.4747,
            "address": "1 ถ.ทดสอบ",
        },
        "reason": "ผ้าห่มไม่พอ",
        "lines": [
            {"item_code": "ITM-1", "name": "ผ้าห่ม", "unit": "ผืน", "type_code": "nonfood", "qty": 10},
            {"item_code": "ITM-2", "name": "น้ำดื่ม", "unit": "แพ็ค", "qty": 3},
        ],
        "actor": {"name": "สมชาย ใจดี", "username": "manager1"},
    }
    return {**body, **over}


async def _row(ref: str = REF) -> dict | None:
    return await M6Withdrawal.get_pymongo_collection().find_one({"_id": ref})


async def _create(client: AsyncClient, headers: dict, **kw: Any) -> dict[str, Any]:
    res = await client.post(
        "/v1/integrations/m6/withdrawals", json=_create_body(**kw), headers=headers
    )
    assert res.status_code in (200, 201), res.text
    return res.json()


def _detail(code: str, shelter: str = SHELTER) -> str:
    return f"/v1/integrations/m6/withdrawals/{code}?shelter_code={shelter}"


# --- auth -----------------------------------------------------------------------------


async def test_routes_require_external_secret(client: AsyncClient, m6_app: FastAPI) -> None:
    assert (await client.get("/v1/integrations/m6/warehouses")).status_code == 401
    assert (await client.post("/v1/integrations/m6/sync")).status_code == 401


# --- tokens (client level) --------------------------------------------------------------


async def test_token_is_reused_then_renewed_with_auth002_before_expiry(fake: FakeM6) -> None:
    clock = Clock()
    m6 = _client_for(fake, clock=clock)
    await m6.warehouses()
    await m6.warehouses()
    assert fake.calls.count("AUTH-001") == 1 and "AUTH-002" not in fake.calls
    assert m6.scopes == ["read", "request", "confirm"]
    assert m6.resource_types == ["nonfood", "food"]

    clock.advance(3600 - 30)  # inside the 60 s margin
    await m6.warehouses()
    assert fake.calls.count("AUTH-001") == 1
    assert fake.calls.count("AUTH-002") == 1
    assert fake.refresh_tokens == {"ref-2"}  # the rotated token replaced the old one

    clock.advance(3600 - 30)
    await m6.warehouses()  # renews again with the *rotated* refresh token
    assert fake.refresh_calls == 2
    assert fake.calls.count("AUTH-001") == 1


async def test_invalid_grant_falls_back_to_auth001(fake: FakeM6) -> None:
    clock = Clock()
    m6 = _client_for(fake, clock=clock)
    await m6.warehouses()
    fake.refresh_tokens.clear()  # M6 forgot our refresh token
    clock.advance(3600)
    await m6.warehouses()
    assert fake.calls[-3:-1] == ["AUTH-002", "AUTH-001"]
    assert fake.token_calls == 2  # initial + fallback; the failed AUTH-002 issued nothing


async def test_expired_refresh_token_goes_straight_to_auth001(fake: FakeM6) -> None:
    clock = Clock()
    m6 = _client_for(fake, clock=clock)
    await m6.warehouses()
    clock.advance(86400 + 5)
    await m6.warehouses()
    assert fake.refresh_calls == 0
    assert fake.calls.count("AUTH-001") == 2


async def test_401_on_a_call_renews_the_token_and_retries_once(fake: FakeM6) -> None:
    m6 = _client_for(fake)
    await m6.warehouses()
    fake.access_tokens.clear()  # revoked server side while still "valid" for us
    res = await m6.warehouses()
    assert res["total"] == 1
    assert fake.refresh_calls == 1
    assert fake.calls.count("GET /api/thirdparty/warehouses") == 3


async def test_two_401s_in_a_row_open_the_circuit(fake: FakeM6) -> None:
    m6 = _client_for(fake)
    fake.always_401 = True
    with pytest.raises(M6CredentialInvalid):
        await m6.warehouses()
    calls = len(fake.calls)
    with pytest.raises(M6CredentialInvalid):
        await m6.warehouses()
    assert len(fake.calls) == calls  # circuit open: nothing was sent


async def test_timeout_is_unavailable(fake: FakeM6) -> None:
    fake.raise_timeout = True
    with pytest.raises(M6Unavailable):
        await _client_for(fake).warehouses()


# --- status gate ----------------------------------------------------------------------


async def test_status_returns_both_m5_and_m6(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    res = await client.get("/v1/integrations/status", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"m5", "m6"}
    assert body["m5"]["error"] == "not_configured"
    m6 = body["m6"]
    assert m6["configured"] and m6["token_ok"] and m6["reachable"]
    assert m6["error"] is None
    assert m6["resource_types"] == ["nonfood", "food"]
    assert m6["scopes"] == ["read", "request", "confirm"]
    assert m6["checked_at"] is not None
    calls = len(fake.calls)
    await client.get("/v1/integrations/status", headers=auth_headers)
    assert len(fake.calls) == calls  # served from the 45 s cache


async def test_status_not_configured(
    client: AsyncClient, app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    m6 = _client_for(fake, configured=False)
    m5 = _m5_off()
    app.dependency_overrides[get_m6_client] = lambda: m6
    app.dependency_overrides[get_m5_client] = lambda: m5
    try:
        res = await client.get("/v1/integrations/status", headers=auth_headers)
    finally:
        app.dependency_overrides.pop(get_m6_client, None)
        app.dependency_overrides.pop(get_m5_client, None)
    assert res.json()["m6"]["configured"] is False
    assert res.json()["m6"]["error"] == "not_configured"
    assert fake.calls == []


async def test_status_credential_invalid_opens_circuit(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    fake.auth_error = "invalid_client"
    res = await client.get("/v1/integrations/status", headers=auth_headers)
    assert res.json()["m6"]["error"] == "credential_invalid"
    assert res.json()["m6"]["token_ok"] is False
    reset_caches()
    await client.get("/v1/integrations/status", headers=auth_headers)
    assert fake.token_calls == 0 and fake.calls == ["AUTH-001"]  # circuit open: no second login


async def test_status_unavailable_on_timeout(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    fake.raise_timeout = True
    res = await client.get("/v1/integrations/status", headers=auth_headers)
    assert res.json()["m6"]["error"] == "unavailable"
    assert res.json()["m6"]["reachable"] is False


async def test_status_without_resource_types_is_credential_invalid(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    fake.resource_types = []
    m6 = (await client.get("/v1/integrations/status", headers=auth_headers)).json()["m6"]
    assert m6["error"] == "credential_invalid"
    assert m6["token_ok"] is True and m6["reachable"] is True
    assert m6["resource_types"] == []


# --- RES-001 / 002 / 003 ----------------------------------------------------------------


async def test_warehouses_pass_through_and_cache(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    res = await client.get("/v1/integrations/m6/warehouses", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["data"][0]["warehouse_code"] == "WH-01"
    assert res.json()["total"] == 1
    calls = len(fake.calls)
    await client.get("/v1/integrations/m6/warehouses", headers=auth_headers)
    assert len(fake.calls) == calls


async def test_stock_coerces_quantities_filters_and_caches(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    res = await client.get("/v1/integrations/m6/warehouses/WH-01/stock", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 2
    first = body["data"][0]
    assert first["on_hand"] == 20 and isinstance(first["on_hand"], int)  # 20.0 → 20
    assert first["available"] == 18
    assert isinstance(body["data"][1]["available"], int)

    calls = len(fake.calls)
    food = await client.get(
        "/v1/integrations/m6/warehouses/WH-01/stock?type_code=food", headers=auth_headers
    )
    assert [r["item_code"] for r in food.json()["data"]] == ["ITM-2"]
    assert food.json()["total"] == 1
    found = await client.get(
        "/v1/integrations/m6/warehouses/WH-01/stock?search=ผ้า", headers=auth_headers
    )
    assert [r["item_code"] for r in found.json()["data"]] == ["ITM-1"]
    assert len(fake.calls) == calls  # all three served from one cached upstream read


async def test_stock_unknown_warehouse_is_404(
    client: AsyncClient, m6_app: FastAPI, auth_headers: dict
) -> None:
    res = await client.get("/v1/integrations/m6/warehouses/NOPE/stock", headers=auth_headers)
    assert res.status_code == 404
    assert res.json()["errors"][0]["code"] == "M6_NOT_FOUND"


async def test_catalog_search_forwards_params_and_caches(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    url = "/v1/integrations/m6/catalog/search?q=ผ้า&type_code=nonfood&warehouse_code=WH-01&limit=20"
    res = await client.get(url, headers=auth_headers)
    assert res.status_code == 200
    assert fake.catalog_params == {
        "q": "ผ้า",
        "type_code": "nonfood",
        "warehouse_code": "WH-01",
        "limit": "20",
    }
    item = res.json()["data"][0]
    assert item["warehouses_count"] == 2 and item["in_warehouse"] is True
    assert res.json()["cursor"] == "2" and res.json()["total"] == 1
    calls = len(fake.calls)
    await client.get(url, headers=auth_headers)
    assert len(fake.calls) == calls


# --- error mapping (CR §6) --------------------------------------------------------------


@pytest.mark.parametrize(
    ("upstream", "status", "code", "extra"),
    [
        (
            httpx.Response(422, json={"detail": "item_not_in_warehouse"}),
            422,
            "M6_ITEM_NOT_IN_WAREHOUSE",
            {},
        ),
        (
            httpx.Response(
                422,
                json={
                    "detail": "unit does not match",
                    "code": "unit_mismatch",
                    "expected_unit": "แผง",
                },
            ),
            422,
            "M6_UNIT_MISMATCH",
            {"expected_unit": "แผง"},
        ),
        (
            httpx.Response(422, json={"detail": {"code": "unit_mismatch", "expected_unit": "แผง"}}),
            422,
            "M6_UNIT_MISMATCH",
            {"expected_unit": "แผง"},
        ),
        (
            httpx.Response(422, json={"detail": "reference_not_found"}),
            422,
            "M6_REFERENCE_NOT_FOUND",
            {},
        ),
        (
            httpx.Response(403, json={"detail": "resource_type_not_allowed"}),
            403,
            "M6_FORBIDDEN",
            {},
        ),
        (
            httpx.Response(403, json={"detail": "this client is not allowed any resource types"}),
            403,
            "M6_FORBIDDEN",
            {},
        ),
        (
            httpx.Response(409, json={"detail": "stock_insufficient"}),
            409,
            "M6_STOCK_INSUFFICIENT",
            {},
        ),
        (
            httpx.Response(409, json={"detail": "x", "code": "insufficient_available"}),
            409,
            "M6_STOCK_INSUFFICIENT",
            {},
        ),
        (httpx.Response(404, json={"detail": "warehouse WH-9 not found"}), 404, "M6_NOT_FOUND", {}),
        (httpx.Response(400, json={"detail": "lines: required"}), 422, "M6_BAD_REQUEST", {}),
        (httpx.Response(500, text="boom"), 503, "M6_UNAVAILABLE", {}),
        (httpx.Response(502, json={"detail": "bad gateway"}), 503, "M6_UNAVAILABLE", {}),
    ],
)
async def test_create_maps_m6_errors(
    client: AsyncClient,
    m6_app: FastAPI,
    fake: FakeM6,
    auth_headers: dict,
    upstream: httpx.Response,
    status: int,
    code: str,
    extra: dict,
) -> None:
    fake.next_response = upstream
    res = await client.post(
        "/v1/integrations/m6/withdrawals", json=_create_body(), headers=auth_headers
    )
    assert res.status_code == status
    detail = res.json()["errors"][0]
    assert detail["code"] == code
    assert detail["message"]
    for key, value in extra.items():
        assert detail[key] == value
    assert await _row() is None  # nothing stored when M6 refused


async def test_403_does_not_open_the_circuit(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    fake.next_response = httpx.Response(403, json={"detail": "resource_type_not_allowed"})
    res = await client.post(
        "/v1/integrations/m6/withdrawals", json=_create_body(), headers=auth_headers
    )
    assert res.status_code == 403
    ok = await client.post(
        "/v1/integrations/m6/withdrawals", json=_create_body(), headers=auth_headers
    )
    assert ok.status_code == 201
    assert fake.token_calls == 1  # same token, no circuit, no re-login


async def test_invalid_client_is_503_and_opens_circuit(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    fake.auth_error = "invalid_client"
    res = await client.get("/v1/integrations/m6/warehouses", headers=auth_headers)
    assert res.status_code == 503
    assert res.json()["errors"][0]["code"] == "M6_CREDENTIAL_INVALID"
    again = await client.get("/v1/integrations/m6/warehouses/WH-01/stock", headers=auth_headers)
    assert again.json()["errors"][0]["code"] == "M6_CREDENTIAL_INVALID"
    assert fake.calls == ["AUTH-001"]  # the circuit blocked the second attempt


async def test_timeout_is_503_unavailable(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    fake.raise_timeout = True
    res = await client.get("/v1/integrations/m6/warehouses", headers=auth_headers)
    assert res.status_code == 503
    assert res.json()["errors"][0]["code"] == "M6_UNAVAILABLE"


async def test_not_configured_is_503(
    client: AsyncClient, app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    m6 = _client_for(fake, configured=False)
    app.dependency_overrides[get_m6_client] = lambda: m6
    try:
        res = await client.get("/v1/integrations/m6/warehouses", headers=auth_headers)
    finally:
        app.dependency_overrides.pop(get_m6_client, None)
    assert res.status_code == 503
    assert res.json()["errors"][0]["code"] == "M6_NOT_CONFIGURED"
    assert fake.calls == []


# --- RES-005 ----------------------------------------------------------------------------


async def test_create_stores_row_and_sends_only_what_m6_needs(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    body = _create_body()
    # The caller's requester block must not be able to move the request to another shelter.
    body["requester"]["location_code"] = "SOMEWHERE-ELSE"
    res = await client.post("/v1/integrations/m6/withdrawals", json=body, headers=auth_headers)
    assert res.status_code == 201
    view = res.json()
    assert view["request_code"] == "REQ-20261112-0001"
    assert view["external_ref"] == REF and view["shelter_code"] == SHELTER
    assert view["status"] == "pending" and view["live"] is True
    assert view["requested_by"] == {"name": "สมชาย ใจดี", "username": "manager1"}
    assert view["lines"][0] == {
        "item_code": "ITM-1",
        "name": "ผ้าห่ม",
        "unit": "ผืน",
        "type_code": "nonfood",
        "qty": 10,
        "qty_fulfilled": None,
    }
    assert view["created_at"].endswith(("Z", "+00:00"))  # aware UTC, not a naive local time

    sent = fake.create_bodies[0]
    assert sent["lines"] == [
        {"item_code": "ITM-1", "qty": 10, "unit": "ผืน"},
        {"item_code": "ITM-2", "qty": 3, "unit": "แพ็ค"},
    ]
    assert sent["requester"]["external_ref"] == REF
    assert sent["requester"]["location_code"] == SHELTER

    row = await _row()
    assert row is not None
    assert row["shelter_code"] == SHELTER and row["status"] == "pending"
    assert row["rev"] == 1 and row["applied_rev"] == 0
    assert row["contact_role"] == "หัวหน้าศูนย์" and row["donation_id"] is None


async def test_create_replay_does_not_call_m6_again(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    first = await client.post(
        "/v1/integrations/m6/withdrawals", json=_create_body(), headers=auth_headers
    )
    second = await client.post(
        "/v1/integrations/m6/withdrawals", json=_create_body(), headers=auth_headers
    )
    assert (first.status_code, second.status_code) == (201, 200)
    assert second.json()["request_code"] == first.json()["request_code"]
    assert second.json()["live"] is False
    assert len(fake.create_bodies) == 1
    assert await M6Withdrawal.get_pymongo_collection().count_documents({}) == 1


async def test_create_replay_from_another_shelter_is_rejected(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    await _create(client, auth_headers)
    res = await client.post(
        "/v1/integrations/m6/withdrawals",
        json=_create_body(shelter="SH002", ref=REF),
        headers=auth_headers,
    )
    assert res.status_code == 422
    assert res.json()["errors"][0]["code"] == "M6_BAD_REQUEST"
    assert len(fake.create_bodies) == 1


async def test_create_rejects_empty_lines_and_zero_qty(
    client: AsyncClient, m6_app: FastAPI, auth_headers: dict
) -> None:
    bad_lines = await client.post(
        "/v1/integrations/m6/withdrawals", json=_create_body(lines=[]), headers=auth_headers
    )
    assert bad_lines.status_code == 422
    zero = _create_body()
    zero["lines"][0]["qty"] = 0
    res = await client.post("/v1/integrations/m6/withdrawals", json=zero, headers=auth_headers)
    assert res.status_code == 422


# --- list / detail ----------------------------------------------------------------------


async def test_list_is_per_shelter_newest_first_and_filters_status(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    a = await _create(client, auth_headers, ref="TENT-SH001-A")
    b = await _create(client, auth_headers, ref="TENT-SH001-B")
    await _create(client, auth_headers, ref="TENT-SH002-A", shelter="SH002")
    fake.set_status(b["request_code"], "approved")
    await client.get(_detail(b["request_code"]), headers=auth_headers)  # snapshot → approved

    res = await client.get(
        "/v1/integrations/m6/withdrawals?shelter_code=SH001", headers=auth_headers
    )
    body = res.json()
    assert body["total"] == 2
    assert [r["request_code"] for r in body["data"]] == [b["request_code"], a["request_code"]]
    assert all(r["shelter_code"] == "SH001" and r["live"] is False for r in body["data"])

    only = await client.get(
        "/v1/integrations/m6/withdrawals?shelter_code=SH001&status=approved", headers=auth_headers
    )
    assert [r["request_code"] for r in only.json()["data"]] == [b["request_code"]]
    other = await client.get(
        "/v1/integrations/m6/withdrawals?shelter_code=SH002", headers=auth_headers
    )
    assert other.json()["total"] == 1
    none = await client.get(
        "/v1/integrations/m6/withdrawals?shelter_code=SH999", headers=auth_headers
    )
    assert none.json() == {"data": [], "total": 0}
    missing = await client.get("/v1/integrations/m6/withdrawals", headers=auth_headers)
    assert missing.status_code == 422  # shelter_code is required


async def test_list_works_without_m6(
    client: AsyncClient, app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    m6 = _client_for(fake, configured=False)
    app.dependency_overrides[get_m6_client] = lambda: m6
    try:
        res = await client.get(
            "/v1/integrations/m6/withdrawals?shelter_code=SH001", headers=auth_headers
        )
    finally:
        app.dependency_overrides.pop(get_m6_client, None)
    assert res.status_code == 200


async def test_detail_refreshes_and_merges_fulfilled_without_losing_name_unit(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    created = await _create(client, auth_headers)
    code = created["request_code"]
    fake.set_status(code, "approved", approved_at=TS, fulfilled=[8.0, 3.0])

    res = await client.get(_detail(code), headers=auth_headers)
    assert res.status_code == 200
    view = res.json()
    assert view["live"] is True and view["status"] == "approved"
    assert view["approved_at"] is not None
    assert view["submitted_at"].startswith("2026-11-12T03:04:05.123")
    assert [(ln["name"], ln["unit"], ln["qty"], ln["qty_fulfilled"]) for ln in view["lines"]] == [
        ("ผ้าห่ม", "ผืน", 10, 8),
        ("น้ำดื่ม", "แพ็ค", 3, 3),
    ]
    row = await _row()
    assert row["lines"][0]["name"] == "ผ้าห่ม" and row["lines"][0]["qty_fulfilled"] == 8
    assert row["rev"] == 2


async def test_detail_of_another_shelters_request_is_404_without_calling_m6(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    created = await _create(client, auth_headers)
    calls = len(fake.calls)
    res = await client.get(_detail(created["request_code"], "SH002"), headers=auth_headers)
    assert res.status_code == 404
    assert res.json()["errors"][0]["code"] == "M6_NOT_FOUND"
    unknown = await client.get(_detail("REQ-NOPE"), headers=auth_headers)
    assert unknown.status_code == 404
    assert len(fake.calls) == calls


async def test_detail_falls_back_to_snapshot_when_m6_is_down(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    created = await _create(client, auth_headers)
    fake.raise_timeout = True
    res = await client.get(_detail(created["request_code"]), headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["live"] is False
    assert res.json()["status"] == "pending"
    assert res.json()["lines"][0]["name"] == "ผ้าห่ม"


# --- RES-008 ----------------------------------------------------------------------------


def _cancel(shelter: str = SHELTER) -> dict[str, Any]:
    return {
        "shelter_code": shelter,
        "reason": "สั่งผิดรายการ",
        "actor": {"name": "สมชาย ใจดี", "username": "manager1"},
    }


async def test_cancel_pending_withdrawal(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    code = (await _create(client, auth_headers))["request_code"]
    res = await client.post(
        f"/v1/integrations/m6/withdrawals/{code}/cancel", json=_cancel(), headers=auth_headers
    )
    assert res.status_code == 200
    view = res.json()
    assert view["status"] == "cancelled" and view["live"] is True
    assert view["cancel_reason"] == "สั่งผิดรายการ"
    assert view["cancelled_at"] is not None
    assert fake.cancel_bodies == [{"cancelled_by": {"name": "สมชาย ใจดี"}, "reason": "สั่งผิดรายการ"}]
    row = await _row()
    assert row["status"] == "cancelled" and row["rev"] == 2
    assert row["cancelled_by"] == {"name": "สมชาย ใจดี", "username": "manager1"}


async def test_cancel_not_cancellable_is_409_and_pulls_real_state(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    code = (await _create(client, auth_headers))["request_code"]
    fake.set_status(code, "approved", approved_at=TS)
    res = await client.post(
        f"/v1/integrations/m6/withdrawals/{code}/cancel", json=_cancel(), headers=auth_headers
    )
    assert res.status_code == 409
    assert res.json()["errors"][0]["code"] == "M6_NOT_CANCELLABLE"
    row = await _row()
    assert row["status"] == "approved" and row["cancelled_at"] is None  # refreshed, not cancelled
    assert row["rev"] == 2


async def test_cancel_other_shelters_request_is_404_without_calling_m6(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    code = (await _create(client, auth_headers))["request_code"]
    res = await client.post(
        f"/v1/integrations/m6/withdrawals/{code}/cancel",
        json=_cancel("SH002"),
        headers=auth_headers,
    )
    assert res.status_code == 404
    assert fake.cancel_bodies == []
    assert (await _row())["status"] == "pending"


# --- sync: RES-006 ------------------------------------------------------------------------


async def test_sync_with_nothing_to_do_does_not_call_m6(
    client: AsyncClient, app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    m6 = _client_for(fake, configured=False)  # even an unconfigured M6 must not 503 the tick
    app.dependency_overrides[get_m6_client] = lambda: m6
    try:
        res = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    finally:
        app.dependency_overrides.pop(get_m6_client, None)
    assert res.status_code == 200
    assert res.json() == {"polled": 0, "changed": 0, "confirmed": 0, "confirm_failed": 0}
    assert fake.calls == []


async def test_sync_bumps_rev_only_when_the_snapshot_changed(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    code = (await _create(client, auth_headers))["request_code"]
    # First poll learns submitted_at (null → value) even though the status is the same.
    first = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert first.json() == {"polled": 1, "changed": 1, "confirmed": 0, "confirm_failed": 0}
    assert (await _row())["rev"] == 2

    # Nothing moved on M6: polling again (timestamps with µs/no offset) must not bump rev.
    second = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert second.json()["polled"] == 1 and second.json()["changed"] == 0
    assert (await _row())["rev"] == 2

    fake.set_status(code, "approved", approved_at=TS, fulfilled=[10.0, 3.0])
    third = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert third.json()["changed"] == 1
    row = await _row()
    assert row["rev"] == 3 and row["status"] == "approved"
    assert [ln["qty_fulfilled"] for ln in row["lines"]] == [10, 3]
    assert row["lines"][0]["name"] == "ผ้าห่ม"

    again = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert again.json()["changed"] == 0 and (await _row())["rev"] == 3


async def test_sync_polls_only_open_statuses_and_skips_unreadable_rows(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    a = (await _create(client, auth_headers, ref="TENT-SH001-A"))["request_code"]
    b = (await _create(client, auth_headers, ref="TENT-SH001-B"))["request_code"]
    fake.set_status(a, "rejected")
    await client.post("/v1/integrations/m6/sync", headers=auth_headers)  # a → rejected (closed)
    calls = len(fake.calls)
    del fake.withdrawals[b]  # M6 no longer knows b: 404 must not fail the tick
    res = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["polled"] == 0  # only b is open, and it was unreadable
    assert fake.calls[calls:] == [f"GET /api/thirdparty/withdrawals/{b}"]


async def test_sync_is_503_when_m6_is_down(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    await _create(client, auth_headers)
    fake.raise_timeout = True
    res = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert res.status_code == 503
    assert res.json()["errors"][0]["code"] == "M6_UNAVAILABLE"


# --- sync: RES-007 outbox -----------------------------------------------------------------


async def _in_transit_with_outbox(
    client: AsyncClient, fake: FakeM6, headers: dict, *, row_status: str | None = None
) -> str:
    code = (await _create(client, headers))["request_code"]
    fake.set_status(code, "in_transit", approved_at=TS, fulfilled=[10.0, 3.0])
    coll = M6Withdrawal.get_pymongo_collection()
    await coll.update_one(
        {"_id": REF},
        {"$set": {"status": row_status or "in_transit", "donation_id": f"donation:m6-{code}"}},
    )
    await M6ConfirmOutbox(
        _id=code,
        external_ref=REF,
        shelter_code=SHELTER,
        donation_id=f"donation:m6-{code}",
        received_by=[{"name": "ผู้รับ หนึ่ง", "username": "staff1"}],
        note="รับครบ",
        created_at=datetime.now(UTC),
    ).insert()
    return code


async def _outbox(code: str) -> dict:
    row = await M6ConfirmOutbox.get_pymongo_collection().find_one({"_id": code})
    assert row is not None
    return row


async def test_outbox_confirmation_succeeds(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    code = await _in_transit_with_outbox(client, fake, auth_headers)
    res = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert res.json()["confirmed"] == 1 and res.json()["confirm_failed"] == 0
    assert fake.confirm_bodies == [
        {"received_by": [{"name": "ผู้รับ หนึ่ง", "username": "staff1"}], "note": "รับครบ"}
    ]
    outbox = await _outbox(code)
    assert outbox["done_at"] is not None and outbox["last_error"] is None
    row = await _row()
    assert row["status"] == "received" and row["confirmed_at"] is not None
    assert row["confirm_error"] is None
    rev = row["rev"]

    again = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert again.json()["confirmed"] == 0  # done rows are never sent twice
    assert len(fake.confirm_bodies) == 1 and (await _row())["rev"] == rev


async def test_outbox_request_not_in_transit_but_received_counts_as_success(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    code = await _in_transit_with_outbox(client, fake, auth_headers)
    fake.set_status(code, "received", completed_at=TS)  # confirmed earlier, answer was lost
    res = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert res.json()["confirmed"] == 1 and res.json()["confirm_failed"] == 0
    assert (await _outbox(code))["done_at"] is not None
    row = await _row()
    assert row["status"] == "received" and row["confirmed_at"] is not None
    assert row["confirm_error"] is None


async def test_outbox_request_not_in_transit_and_not_received_is_a_failure(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    code = await _in_transit_with_outbox(client, fake, auth_headers, row_status="issued")
    fake.set_status(code, "issued")  # M6 says: not in transit, not received either
    res = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert res.json()["confirmed"] == 0 and res.json()["confirm_failed"] == 1
    outbox = await _outbox(code)
    assert outbox["done_at"] is None and outbox["attempts"] == 1
    assert outbox["last_error"] == "request_not_in_transit"
    assert "request_not_in_transit" in (await _row())["confirm_error"]


async def test_outbox_failure_backs_off_and_records_confirm_error(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    code = await _in_transit_with_outbox(client, fake, auth_headers, row_status="issued")
    fake.set_status(code, "issued")
    fake.raise_timeout = True
    before = datetime.now(UTC).replace(tzinfo=None)

    first = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert first.json()["confirm_failed"] == 1
    outbox = await _outbox(code)
    assert outbox["attempts"] == 1 and outbox["last_error"] == "M6_UNAVAILABLE"
    wait = outbox["next_attempt_at"] - before
    assert timedelta(seconds=29) < wait < timedelta(seconds=35)  # 30 s · 2^0
    row = await _row()
    assert "M6_UNAVAILABLE" in row["confirm_error"]
    rev = row["rev"]

    # Not due yet: M6 is not contacted at all.
    calls = len(fake.calls)
    idle = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert idle.json()["confirm_failed"] == 0 and len(fake.calls) == calls

    # Due again: second failure doubles the wait; the same error text does not bump rev.
    await M6ConfirmOutbox.get_pymongo_collection().update_one(
        {"_id": code}, {"$set": {"next_attempt_at": datetime.now(UTC) - timedelta(seconds=1)}}
    )
    second = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert second.json()["confirm_failed"] == 1
    outbox = await _outbox(code)
    assert outbox["attempts"] == 2
    wait = outbox["next_attempt_at"] - datetime.now(UTC).replace(tzinfo=None)
    assert timedelta(seconds=55) < wait < timedelta(seconds=65)  # 30 s · 2^1
    assert (await _row())["rev"] == rev

    # M6 recovers and the row becomes in_transit again: success clears the error.
    fake.raise_timeout = False
    fake.set_status(code, "in_transit")
    await M6Withdrawal.get_pymongo_collection().update_one(
        {"_id": REF}, {"$set": {"status": "in_transit"}}
    )
    await M6ConfirmOutbox.get_pymongo_collection().update_one(
        {"_id": code}, {"$set": {"next_attempt_at": None}}
    )
    ok = await client.post("/v1/integrations/m6/sync", headers=auth_headers)
    assert ok.json()["confirmed"] == 1
    row = await _row()
    assert row["confirm_error"] is None and row["confirmed_at"] is not None
    assert row["rev"] > rev
    outbox = await _outbox(code)
    assert outbox["done_at"] is not None and outbox["last_error"] is None


# --- outbound log -------------------------------------------------------------------------


async def test_every_call_is_logged_without_payload(
    client: AsyncClient, m6_app: FastAPI, fake: FakeM6, auth_headers: dict
) -> None:
    await client.get("/v1/integrations/m6/warehouses", headers=auth_headers)
    await _create(client, auth_headers)
    rows = await M6OutboundLog.get_pymongo_collection().find({}).to_list(None)
    by_endpoint = {r["endpoint"]: r for r in rows}
    assert {"AUTH-001", "RES-001", "RES-005"} <= set(by_endpoint)
    create = by_endpoint["RES-005"]
    assert create["external_ref"] == REF
    assert create["line_count"] == 2
    assert create["actor"] == "manager1"
    assert create["http_status"] == 201
    assert create["method"] == "POST"
    blob = json.dumps(rows, default=str)
    assert "081-000-0000" not in blob and "secret" not in blob and "ผ้าห่ม" not in blob
