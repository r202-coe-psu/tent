"""Outbound HTTP client for the M5 patient-referral API (AUTH-001, TRF-001 … TRF-006).

Draft CR — referral M5 integration §1, §5. Behaviour verified against M5 staging
(2026-11-11 spike):

- Tokens live 24 h and re-issuing does not revoke older tokens, so each FastAPI
  process keeps its own cached token (refreshed ≥ 60 s before expiry).
- A 401 on a TRF call refreshes the token and retries once.
- ``invalid_client`` / 403 open a circuit: no automatic retry until it cools down.
- Every call writes one ``m5_outbound_logs`` row without any payload or PII.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
from tent_model import M5OutboundLog

from ...core.config import settings
from ...utils.ulid import new_ulid

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 15.0
_TOKEN_REFRESH_MARGIN_SECONDS = 60
_CIRCUIT_COOLDOWN_SECONDS = 300


class M5NotConfigured(Exception):
    """M5_BASE_URL / M5_CLIENT_ID / M5_CLIENT_SECRET are not set."""


class M5Unavailable(Exception):
    """M5 timed out, could not be reached, or answered 5xx."""


class M5CredentialInvalid(Exception):
    """M5 rejected our credential (`invalid_client`) or scope (403). Do not retry."""


class M5Error(Exception):
    """A 4xx answer from M5 that the caller should see (mapped per CR §5)."""

    def __init__(
        self, status: int, code: str, message: str, extra: dict[str, Any] | None = None
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}


@dataclass(frozen=True, slots=True)
class CallContext:
    """What the outbound log records about one call."""

    endpoint: str
    actor: str | None = None
    external_ref: str | None = None
    code: str | None = None
    patient_count: int | None = None


_CONFLICT_CODES = {
    "external_ref_in_use": "M5_EXTERNAL_REF_CONFLICT",
    "not_pending": "NOT_PENDING",
    "cancel_needs_moph": "CANCEL_NEEDS_MOPH",
    "already_closed": "ALREADY_CLOSED",
}


def _body(res: httpx.Response) -> Any:
    try:
        return res.json()
    except ValueError:
        return None


def _map_client_error(res: httpx.Response) -> M5Error:
    """Map a TRF 4xx (other than 401/403) to an `M5Error` (CR §5 error table)."""
    body = _body(res)
    m5_code = body.get("code") if isinstance(body, dict) else None
    message = body.get("message", "") if isinstance(body, dict) else ""
    if m5_code == "destination_not_found":
        return M5Error(409, "M5_DESTINATION_NOT_FOUND", message)
    if m5_code in _CONFLICT_CODES:
        extra = {k: body[k] for k in ("status", "transfer_code") if k in body}
        return M5Error(409, _CONFLICT_CODES[m5_code], message, extra)
    if res.status_code == 404:
        return M5Error(404, "M5_NOT_FOUND", "ไม่พบใบส่งต่อใน M5")
    # Field validation: `{"<field>": ["…"]}` — passed through so the UI can point at a patient.
    fields = body if isinstance(body, dict) else {}
    return M5Error(422, "M5_VALIDATION", "ข้อมูลไม่ผ่านการตรวจของ M5", {"fields": fields})


class HttpM5Client:
    """Process-wide M5 client. Use `get_m5_client()`; tests build one with a mock transport."""

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
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._circuit_open_until = 0.0
        self._lock = asyncio.Lock()

    @property
    def configured(self) -> bool:
        return bool(self._base_url and self._client_id and self._client_secret)

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url, timeout=_TIMEOUT_SECONDS, transport=self._transport
        )

    async def _log(
        self, ctx: CallContext, method: str, status: int | None, error: str | None, started: float
    ) -> None:
        try:
            await M5OutboundLog(
                _id=new_ulid(),
                endpoint=ctx.endpoint,
                method=method,
                external_ref=ctx.external_ref,
                code=ctx.code,
                patient_count=ctx.patient_count,
                http_status=status,
                error=error,
                actor=ctx.actor,
                duration_ms=int((self._clock() - started) * 1000),
                at=datetime.now(UTC),
            ).insert()
        except Exception:  # noqa: BLE001 — the audit row must never break the call itself
            logger.warning("m5 outbound log write failed (endpoint=%s)", ctx.endpoint)

    def _check_ready(self) -> None:
        if not self.configured:
            raise M5NotConfigured
        if self._clock() < self._circuit_open_until:
            raise M5CredentialInvalid

    def _open_circuit(self) -> None:
        self._circuit_open_until = self._clock() + _CIRCUIT_COOLDOWN_SECONDS
        self._token = None

    async def _fetch_token(self, *, force: bool = False) -> str:
        async with self._lock:
            if (
                not force
                and self._token
                and self._clock() < self._token_expires_at - _TOKEN_REFRESH_MARGIN_SECONDS
            ):
                return self._token
            ctx = CallContext(endpoint="AUTH-001")
            started = self._clock()
            try:
                async with self._http() as http:
                    res = await http.post(
                        "/api/auth/token-third-party",
                        json={
                            "grant_type": "client_credentials",
                            "client_id": self._client_id,
                            "client_secret": self._client_secret,
                        },
                    )
            except httpx.TimeoutException as exc:
                await self._log(ctx, "POST", None, "timeout", started)
                raise M5Unavailable from exc
            except httpx.TransportError as exc:
                await self._log(ctx, "POST", None, "network", started)
                raise M5Unavailable from exc

            body = _body(res)
            if res.status_code == 200 and isinstance(body, dict) and body.get("access_token"):
                await self._log(ctx, "POST", 200, None, started)
                self._token = body["access_token"]
                self._token_expires_at = self._clock() + float(body.get("expires_in") or 0)
                return self._token

            error = body.get("error") if isinstance(body, dict) else None
            await self._log(ctx, "POST", res.status_code, error or "unexpected", started)
            if res.status_code >= 500:
                raise M5Unavailable
            # invalid_client, unsupported_grant_type, missing credentials: config problem.
            self._open_circuit()
            raise M5CredentialInvalid

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
        token = await self._fetch_token()
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
                raise M5Unavailable from exc
            except httpx.TransportError as exc:
                await self._log(ctx, method, None, "network", started)
                raise M5Unavailable from exc

            body = _body(res)
            if res.status_code < 400:
                await self._log(ctx, method, res.status_code, None, started)
                return body

            m5_code = body.get("code") if isinstance(body, dict) else None
            await self._log(ctx, method, res.status_code, m5_code or "http_error", started)
            if res.status_code == 401 and attempt == 1:
                token = await self._fetch_token(force=True)
                continue
            if res.status_code in (401, 403):
                self._open_circuit()
                raise M5CredentialInvalid
            if res.status_code >= 500:
                raise M5Unavailable
            raise _map_client_error(res)
        raise M5Unavailable  # pragma: no cover — loop always returns or raises

    # --- TRF endpoints -------------------------------------------------------------------

    async def check(self) -> None:
        """Health probe: token + one cheap authorised read (TRF-003, 1 row)."""
        await self._call(
            "GET", "/api/thirdparty/transfers", CallContext("TRF-003"), params={"limit": 1}
        )

    async def facilities(self, q: str | None) -> dict[str, Any]:
        params = {"q": q} if q else None
        return await self._call(
            "GET", "/api/thirdparty/facilities", CallContext("TRF-001"), params=params
        )

    async def create_transfer(self, body: dict[str, Any], ctx: CallContext) -> dict[str, Any]:
        return await self._call("POST", "/api/thirdparty/transfers", ctx, json=body)

    async def list_transfers(self, *, status: str | None, page: int, limit: int) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "limit": limit}
        if status:
            params["status"] = status
        return await self._call(
            "GET", "/api/thirdparty/transfers", CallContext("TRF-003"), params=params
        )

    async def get_transfer(self, code: str, ctx: CallContext | None = None) -> dict[str, Any]:
        # D5-1: the path form returns one bare object (the `?code=` form is TRF-003).
        return await self._call(
            "GET", f"/api/thirdparty/transfers/{code}", ctx or CallContext("TRF-004", code=code)
        )

    async def start(self, code: str, ctx: CallContext) -> dict[str, Any]:
        return await self._call("POST", f"/api/thirdparty/transfers/{code}/start", ctx)

    async def cancel(self, code: str, reason: str, ctx: CallContext) -> dict[str, Any]:
        return await self._call(
            "POST", f"/api/thirdparty/transfers/{code}/cancel", ctx, json={"reason": reason}
        )


_client: HttpM5Client | None = None


def get_m5_client() -> HttpM5Client:
    """FastAPI dependency: one client (and token cache) per process."""
    global _client
    if _client is None:
        _client = HttpM5Client(
            base_url=settings.M5_BASE_URL,
            client_id=settings.M5_CLIENT_ID,
            client_secret=settings.M5_CLIENT_SECRET,
        )
    return _client
