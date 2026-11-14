"""Outbound HTTP client for the M6 central-warehouse API (AUTH-001/002, RES-001 … RES-008).

Draft CR — central warehouse M6 §3, §6. Mirrors the M5 client with these differences:

- Tokens are two-part: an access token (1 h) plus a rotating refresh token (24 h). The access
  token is renewed with AUTH-002 at least 60 s before it expires; the new refresh token is
  stored over the old one. ``invalid_grant`` or an expired refresh token falls back to AUTH-001.
- Each FastAPI process keeps its own token pair (re-issuing does not revoke older tokens).
- ``invalid_client`` (or a second 401 in a row) opens a circuit for 5 minutes. A 403 is a
  permission problem for one request, not a credential problem: it maps to ``M6_FORBIDDEN``
  and does not open the circuit.
- Errors are mapped by M6's ``code`` / ``detail`` string, not by HTTP status (M6 answers
  ``request_not_cancellable`` with 422 while our contract says 409).
- Every call writes one ``m6_outbound_logs`` row without any payload or PII.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import httpx
from tent_model import M6OutboundLog

from ...core.config import settings
from ...utils.ulid import new_ulid

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 15.0
_TOKEN_REFRESH_MARGIN_SECONDS = 60
_CIRCUIT_COOLDOWN_SECONDS = 300
_DEFAULT_ACCESS_TTL = 3600.0
_DEFAULT_REFRESH_TTL = 86400.0
_TOKEN_PATH = "/api/auth/token-third-party"


class M6NotConfigured(Exception):
    """M6_BASE_URL / M6_CLIENT_ID / M6_CLIENT_SECRET are not set."""


class M6Unavailable(Exception):
    """M6 timed out, could not be reached, or answered 5xx."""


class M6CredentialInvalid(Exception):
    """M6 rejected our credential (`invalid_client`, repeated 401). Do not retry."""


class M6Error(Exception):
    """A 4xx answer from M6 that the caller should see (mapped per CR §6).

    `m6_code` keeps M6's own code/detail string (e.g. `request_not_in_transit`) for callers
    that must branch on it.
    """

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        extra: dict[str, Any] | None = None,
        m6_code: str | None = None,
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}
        self.m6_code = m6_code


class _InvalidGrant(Exception):
    """AUTH-002 refused the refresh token: fall back to AUTH-001."""


@dataclass(frozen=True, slots=True)
class CallContext:
    """What the outbound log records about one call."""

    endpoint: str
    actor: str | None = None
    external_ref: str | None = None
    request_code: str | None = None
    line_count: int | None = None


def _body(res: httpx.Response) -> Any:
    try:
        return res.json()
    except ValueError:
        return None


def _m6_key(body: Any) -> tuple[str | None, dict[str, Any]]:
    """M6's machine code and the flat body it came from (`detail` may nest a dict)."""
    if not isinstance(body, dict):
        return None, {}
    detail = body.get("detail")
    flat = {**detail, **body} if isinstance(detail, dict) else body
    code = flat.get("code")
    if isinstance(code, str) and code:
        return code, flat
    if isinstance(detail, str) and detail:
        return detail, flat
    return None, flat


def _map_client_error(res: httpx.Response) -> M6Error:
    """Map an M6 4xx (other than 401) to an `M6Error` (CR §6 error table)."""
    key, flat = _m6_key(_body(res))
    if res.status_code == 403:
        return M6Error(403, "M6_FORBIDDEN", "ไม่ได้รับสิทธิ์ใช้งานรายการนี้จาก M6", m6_code=key)
    if key == "item_not_in_warehouse":
        return M6Error(422, "M6_ITEM_NOT_IN_WAREHOUSE", "ไม่มีรายการนี้ในคลังที่เลือก", m6_code=key)
    if key == "unit_mismatch":
        extra = {"expected_unit": flat["expected_unit"]} if "expected_unit" in flat else {}
        return M6Error(422, "M6_UNIT_MISMATCH", "หน่วยนับไม่ตรงกับคลัง", extra, m6_code=key)
    if key == "reference_not_found":
        return M6Error(422, "M6_REFERENCE_NOT_FOUND", "ไม่พบรายการนี้ในทะเบียนกลาง", m6_code=key)
    if key == "request_not_cancellable":
        return M6Error(
            409, "M6_NOT_CANCELLABLE", "ใบเบิกนี้ยกเลิกไม่ได้แล้ว ติดต่อเจ้าหน้าที่คลังกลาง", m6_code=key
        )
    if key in ("stock_insufficient", "insufficient_available"):
        return M6Error(409, "M6_STOCK_INSUFFICIENT", "ของในคลังไม่พอสำหรับคำขอนี้", m6_code=key)
    if res.status_code == 404:
        return M6Error(404, "M6_NOT_FOUND", "ไม่พบข้อมูลใน M6", m6_code=key)
    return M6Error(422, "M6_BAD_REQUEST", "ข้อมูลไม่ผ่านการตรวจของ M6", m6_code=key)


class HttpM6Client:
    """Process-wide M6 client. Use `get_m6_client()`; tests build one with a mock transport."""

    def __init__(
        self,
        *,
        base_url: str,
        client_id: str,
        client_secret: str,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Any = time.monotonic,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret
        self._transport = transport
        self._clock = clock
        self._access: str | None = None
        self._access_expires_at = 0.0
        self._refresh: str | None = None
        self._refresh_expires_at = 0.0
        self._scopes: list[str] = []
        self._resource_types: list[str] = []
        self._circuit_open_until = 0.0
        self._lock = asyncio.Lock()

    @property
    def configured(self) -> bool:
        return bool(self._base_url and self._client_id and self._client_secret)

    @property
    def scopes(self) -> list[str]:
        return list(self._scopes)

    @property
    def resource_types(self) -> list[str]:
        return list(self._resource_types)

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url, timeout=_TIMEOUT_SECONDS, transport=self._transport
        )

    async def _log(
        self, ctx: CallContext, method: str, status: int | None, error: str | None, started: float
    ) -> None:
        try:
            await M6OutboundLog(
                _id=new_ulid(),
                endpoint=ctx.endpoint,
                method=method,
                external_ref=ctx.external_ref,
                request_code=ctx.request_code,
                line_count=ctx.line_count,
                http_status=status,
                error=error,
                actor=ctx.actor,
                duration_ms=int((self._clock() - started) * 1000),
                at=datetime.now(UTC),
            ).insert()
        except Exception:  # noqa: BLE001 — the audit row must never break the call itself
            logger.warning("m6 outbound log write failed (endpoint=%s)", ctx.endpoint)

    def _check_ready(self) -> None:
        if not self.configured:
            raise M6NotConfigured
        if self._clock() < self._circuit_open_until:
            raise M6CredentialInvalid

    def _open_circuit(self) -> None:
        self._circuit_open_until = self._clock() + _CIRCUIT_COOLDOWN_SECONDS
        self._access = None
        self._refresh = None

    # --- tokens --------------------------------------------------------------------------

    def _store_tokens(self, body: dict[str, Any]) -> None:
        now = self._clock()
        self._access = body["access_token"]
        self._access_expires_at = now + float(body.get("expires_in") or _DEFAULT_ACCESS_TTL)
        # The refresh token rotates on every AUTH-001 / AUTH-002: always store over the old one.
        self._refresh = body.get("refresh_token") or None
        self._refresh_expires_at = now + float(
            body.get("refresh_expires_in") or _DEFAULT_REFRESH_TTL
        )
        scopes = body.get("scopes")
        self._scopes = [str(s) for s in scopes] if isinstance(scopes, list) else []
        types = body.get("resource_types")
        self._resource_types = [str(t) for t in types] if isinstance(types, list) else []

    async def _token_request(self, payload: dict[str, Any], endpoint: str) -> dict[str, Any]:
        """One AUTH-001 / AUTH-002 round trip. Returns the token body on success."""
        ctx = CallContext(endpoint=endpoint)
        started = self._clock()
        try:
            async with self._http() as http:
                res = await http.post(_TOKEN_PATH, json=payload)
        except httpx.TimeoutException as exc:
            await self._log(ctx, "POST", None, "timeout", started)
            raise M6Unavailable from exc
        except httpx.TransportError as exc:
            await self._log(ctx, "POST", None, "network", started)
            raise M6Unavailable from exc

        body = _body(res)
        if res.status_code == 200 and isinstance(body, dict) and body.get("access_token"):
            await self._log(ctx, "POST", 200, None, started)
            return body

        error = body.get("error") if isinstance(body, dict) else None
        await self._log(ctx, "POST", res.status_code, error or "unexpected", started)
        if res.status_code >= 500:
            raise M6Unavailable
        if endpoint == "AUTH-002" and error != "invalid_client":
            # invalid_grant (or anything else about the refresh token): start over.
            raise _InvalidGrant
        # invalid_client, unsupported_grant_type, missing credentials: config problem.
        self._open_circuit()
        raise M6CredentialInvalid

    async def _login(self) -> None:
        body = await self._token_request(
            {
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
            "AUTH-001",
        )
        self._store_tokens(body)

    async def _token(self, *, stale: str | None = None) -> str:
        """A usable access token.

        `stale` is the token a call just got 401 for: it is renewed even if it still looks
        valid, unless another coroutine already replaced it while we waited for the lock.
        """
        async with self._lock:
            now = self._clock()
            if (
                self._access
                and self._access != stale
                and now < self._access_expires_at - _TOKEN_REFRESH_MARGIN_SECONDS
            ):
                return self._access
            if self._refresh and now < self._refresh_expires_at - _TOKEN_REFRESH_MARGIN_SECONDS:
                try:
                    body = await self._token_request(
                        {"grant_type": "refresh_token", "refresh_token": self._refresh},
                        "AUTH-002",
                    )
                except _InvalidGrant:
                    self._refresh = None
                else:
                    self._store_tokens(body)
                    return self._access  # type: ignore[return-value]
            await self._login()
            return self._access  # type: ignore[return-value]

    # --- calls ---------------------------------------------------------------------------

    async def _call(
        self,
        method: str,
        path: str,
        ctx: CallContext,
        *,
        json: Any = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        self._check_ready()
        token = await self._token()
        for attempt in (1, 2):
            started = self._clock()
            try:
                async with self._http() as http:
                    res = await http.request(
                        method,
                        path,
                        json=json,
                        params=params,
                        headers={"Authorization": f"Bearer {token}"},
                    )
            except httpx.TimeoutException as exc:
                await self._log(ctx, method, None, "timeout", started)
                raise M6Unavailable from exc
            except httpx.TransportError as exc:
                await self._log(ctx, method, None, "network", started)
                raise M6Unavailable from exc

            body = _body(res)
            if res.status_code < 400:
                await self._log(ctx, method, res.status_code, None, started)
                return body

            key, _ = _m6_key(body)
            await self._log(ctx, method, res.status_code, key or "http_error", started)
            if res.status_code == 401:
                if attempt == 1:
                    token = await self._token(stale=token)
                    continue
                self._open_circuit()
                raise M6CredentialInvalid
            if res.status_code >= 500:
                raise M6Unavailable
            raise _map_client_error(res)
        raise M6Unavailable  # pragma: no cover — loop always returns or raises

    # --- RES endpoints -------------------------------------------------------------------

    async def check(self) -> None:
        """Health probe: token + one cheap authorised read (RES-001)."""
        await self._call("GET", "/api/thirdparty/warehouses", CallContext("RES-001"))

    async def warehouses(self) -> dict[str, Any]:
        return await self._call("GET", "/api/thirdparty/warehouses", CallContext("RES-001"))

    async def stock(self, code: str) -> dict[str, Any]:
        return await self._call(
            "GET",
            f"/api/thirdparty/warehouses/{quote(code, safe='')}/stock",
            CallContext("RES-002"),
        )

    async def catalog_search(
        self,
        q: str | None,
        type_code: str | None,
        warehouse_code: str | None,
        cursor: str | None,
        limit: int | None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            k: v
            for k, v in (
                ("q", q),
                ("type_code", type_code),
                ("warehouse_code", warehouse_code),
                ("cursor", cursor),
                ("limit", limit),
            )
            if v not in (None, "")
        }
        return await self._call(
            "GET", "/api/thirdparty/catalog/search", CallContext("RES-003"), params=params
        )

    async def create_withdrawal(self, payload: dict[str, Any], ctx: CallContext) -> dict[str, Any]:
        return await self._call("POST", "/api/thirdparty/withdrawals", ctx, json=payload)

    async def get_withdrawal(self, code: str, ctx: CallContext | None = None) -> dict[str, Any]:
        return await self._call(
            "GET",
            f"/api/thirdparty/withdrawals/{quote(code, safe='')}",
            ctx or CallContext("RES-006", request_code=code),
        )

    async def confirm_receipt(
        self,
        code: str,
        received_by: list[dict[str, Any]],
        note: str,
        ctx: CallContext | None = None,
    ) -> dict[str, Any]:
        return await self._call(
            "POST",
            f"/api/thirdparty/withdrawals/{quote(code, safe='')}/confirm-receipt",
            ctx or CallContext("RES-007", request_code=code),
            json={"received_by": received_by, "note": note},
        )

    async def cancel(
        self,
        code: str,
        cancelled_by_name: str,
        reason: str,
        ctx: CallContext | None = None,
    ) -> dict[str, Any]:
        return await self._call(
            "POST",
            f"/api/thirdparty/withdrawals/{quote(code, safe='')}/cancel",
            ctx or CallContext("RES-008", request_code=code),
            json={"cancelled_by": {"name": cancelled_by_name}, "reason": reason},
        )


_client: HttpM6Client | None = None


def get_m6_client() -> HttpM6Client:
    """FastAPI dependency: one client (and token cache) per process."""
    global _client
    if _client is None:
        _client = HttpM6Client(
            base_url=settings.M6_BASE_URL,
            client_id=settings.M6_CLIENT_ID,
            client_secret=settings.M6_CLIENT_SECRET,
        )
    return _client
