"""M6 integration use case — warehouses, withdrawals, status gate and sync (draft CR — central
warehouse M6 §3, §4, §6, §7).

`m6_withdrawals` is written by several FastAPI processes and read/marked by the worker, so
every write after the insert is a field-level `$set` plus an atomic `$inc` on `rev`; never
`save()`. `rev` only moves when the stored snapshot actually changed.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends
from pymongo.errors import DuplicateKeyError
from tent_model import M6_OPEN_STATUSES, M6ConfirmOutbox, M6Withdrawal

from .client import (
    CallContext,
    HttpM6Client,
    M6CredentialInvalid,
    M6Error,
    M6NotConfigured,
    M6Unavailable,
    get_m6_client,
)
from .schemas import (
    M6CancelRequest,
    M6CatalogResponse,
    M6Status,
    M6StockResponse,
    M6SyncResponse,
    M6WarehousesResponse,
    M6WithdrawalCreateRequest,
    M6WithdrawalListResponse,
    M6WithdrawalView,
)

logger = logging.getLogger(__name__)

_STATUS_CACHE_SECONDS = 45
_CACHE_SECONDS = 60
_SYNC_ACTOR = "m6:sync"
_BACKOFF_BASE_SECONDS = 30
_BACKOFF_CAP_SECONDS = 3600
_TS_KEYS = ("submitted_at", "approved_at", "completed_at")
_VIEW_TS_KEYS = (*_TS_KEYS, "cancelled_at", "confirmed_at", "fetched_at", "created_at")
_INFRA_FAILURES = (M6NotConfigured, M6CredentialInvalid, M6Unavailable)

_status_cache: tuple[float, M6Status] | None = None
_warehouses_cache: tuple[float, M6WarehousesResponse] | None = None
_stock_cache: dict[str, tuple[float, M6StockResponse]] = {}
_catalog_cache: dict[tuple[Any, ...], tuple[float, M6CatalogResponse]] = {}


def reset_caches() -> None:
    """Drop every per-process M6 cache (tests, credential rotation)."""
    global _status_cache, _warehouses_cache
    _status_cache = None
    _warehouses_cache = None
    _stock_cache.clear()
    _catalog_cache.clear()


# --- value helpers ---------------------------------------------------------------------


def _aware(value: datetime | None) -> datetime | None:
    """Mongo hands back naive UTC datetimes; the API must emit aware ones."""
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _parse_ts(value: Any) -> datetime | None:
    """An M6 timestamp as aware UTC truncated to ms (what Mongo keeps).

    M6 may omit the offset (guide v2.1); a naive value is read as UTC.
    """
    if value in (None, ""):
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    except ValueError:
        return None
    parsed = _aware(parsed)
    assert parsed is not None
    return parsed.replace(microsecond=parsed.microsecond // 1000 * 1000)


def _qty(value: Any) -> int | None:
    try:
        return None if value is None else int(float(value))
    except TypeError, ValueError:
        return None


def _same(key: str, stored: Any, new: Any) -> bool:
    if key in _TS_KEYS:
        return _aware(stored) == new
    return stored == new


def _view(doc: dict[str, Any], *, live: bool) -> M6WithdrawalView:
    data = {**doc, "external_ref": doc["_id"], "live": live}
    for key in _VIEW_TS_KEYS:
        if isinstance(data.get(key), datetime):
            data[key] = _aware(data[key])
    return M6WithdrawalView.model_validate(data)


def _not_found() -> M6Error:
    return M6Error(404, "M6_NOT_FOUND", "ไม่พบใบเบิกนี้")


def _snapshot(current: dict[str, Any], res: dict[str, Any]) -> dict[str, Any]:
    """Fields to persist from RES-006. Only keys M6 actually returned are included.

    RES-006 lines carry no name/unit, so only `qty_fulfilled` is merged (by `item_code`)
    into the lines we stored from the RES-005 request.
    """
    snap: dict[str, Any] = {}
    if isinstance(res.get("status"), str) and res["status"]:
        snap["status"] = res["status"]
    for key in _TS_KEYS:
        if key in res:
            snap[key] = _parse_ts(res[key])
    if isinstance(res.get("lines"), list):
        fulfilled = {
            line.get("item_code"): _qty(line.get("qty_fulfilled"))
            for line in res["lines"]
            if isinstance(line, dict)
        }
        snap["lines"] = [
            {**line, "qty_fulfilled": fulfilled.get(line["item_code"], line.get("qty_fulfilled"))}
            for line in current.get("lines") or []
        ]
    return snap


def _infra_code(exc: Exception) -> str:
    if isinstance(exc, M6NotConfigured):
        return "M6_NOT_CONFIGURED"
    if isinstance(exc, M6CredentialInvalid):
        return "M6_CREDENTIAL_INVALID"
    return "M6_UNAVAILABLE"


def _backoff(attempts_before: int) -> timedelta:
    return timedelta(seconds=min(_BACKOFF_BASE_SECONDS * 2**attempts_before, _BACKOFF_CAP_SECONDS))


class M6UseCase:
    def __init__(self, client: HttpM6Client, clock: Any = time.monotonic) -> None:
        self._client = client
        self._clock = clock

    @staticmethod
    def _collection():
        return M6Withdrawal.get_pymongo_collection()

    @staticmethod
    def _outbox():
        return M6ConfirmOutbox.get_pymongo_collection()

    # --- health gate --------------------------------------------------------------------

    async def status(self) -> M6Status:
        global _status_cache
        now = self._clock()
        if _status_cache and now - _status_cache[0] < _STATUS_CACHE_SECONDS:
            return _status_cache[1]

        checked_at = datetime.now(UTC)
        if not self._client.configured:
            m6 = M6Status(
                configured=False,
                token_ok=False,
                reachable=False,
                checked_at=checked_at,
                error="not_configured",
            )
        else:
            try:
                await self._client.check()
                types = self._client.resource_types
                m6 = M6Status(
                    configured=True,
                    token_ok=True,
                    reachable=True,
                    resource_types=types,
                    scopes=self._client.scopes,
                    checked_at=checked_at,
                    # No resource type bound to the key: M6 will refuse every request (CR §4).
                    error=None if types else "credential_invalid",
                )
            except M6CredentialInvalid:
                m6 = M6Status(
                    configured=True,
                    token_ok=False,
                    reachable=True,
                    checked_at=checked_at,
                    error="credential_invalid",
                )
            except M6Error as exc:
                forbidden = exc.status == 403
                m6 = M6Status(
                    configured=True,
                    token_ok=not forbidden,
                    reachable=True,
                    resource_types=self._client.resource_types,
                    scopes=self._client.scopes,
                    checked_at=checked_at,
                    error="credential_invalid" if forbidden else "unavailable",
                )
            except M6Unavailable:
                m6 = M6Status(
                    configured=True,
                    token_ok=False,
                    reachable=False,
                    checked_at=checked_at,
                    error="unavailable",
                )
        _status_cache = (now, m6)
        return m6

    # --- RES-001 / 002 / 003 (cached 60 s) ----------------------------------------------

    async def warehouses(self) -> M6WarehousesResponse:
        global _warehouses_cache
        if _warehouses_cache and self._clock() - _warehouses_cache[0] < _CACHE_SECONDS:
            return _warehouses_cache[1]
        res = M6WarehousesResponse.model_validate(await self._client.warehouses())
        _warehouses_cache = (self._clock(), res)
        return res

    async def stock(self, code: str, type_code: str | None, search: str | None) -> M6StockResponse:
        hit = _stock_cache.get(code)
        if hit and self._clock() - hit[0] < _CACHE_SECONDS:
            res = hit[1]
        else:
            res = M6StockResponse.model_validate(await self._client.stock(code))
            _stock_cache[code] = (self._clock(), res)
        needle = (search or "").strip().lower()
        rows = [
            r
            for r in res.data
            if (not type_code or r.type_code == type_code)
            and (not needle or needle in r.name.lower() or needle in r.item_code.lower())
        ]
        return M6StockResponse(warehouse_code=res.warehouse_code, data=rows, total=len(rows))

    async def catalog_search(
        self,
        q: str | None,
        type_code: str | None,
        warehouse_code: str | None,
        cursor: str | None,
        limit: int | None,
    ) -> M6CatalogResponse:
        key = ((q or "").strip(), type_code, warehouse_code, cursor, limit)
        hit = _catalog_cache.get(key)
        if hit and self._clock() - hit[0] < _CACHE_SECONDS:
            return hit[1]
        res = M6CatalogResponse.model_validate(
            await self._client.catalog_search(
                key[0] or None, type_code, warehouse_code, cursor, limit
            )
        )
        _catalog_cache[key] = (self._clock(), res)
        return res

    # --- RES-005 ------------------------------------------------------------------------

    async def create(self, req: M6WithdrawalCreateRequest) -> tuple[M6WithdrawalView, bool]:
        """Send a withdrawal to M6. Returns the stored view and whether it was a replay."""
        coll = self._collection()
        existing = await coll.find_one({"_id": req.external_ref})
        if existing is not None:
            return self._replay(existing, req), True

        body = {
            "source_warehouse_code": req.source_warehouse_code,
            # The shelter and the idempotency key are ours to set, whatever the caller sent.
            "requester": {
                **req.requester.model_dump(),
                "location_code": req.shelter_code,
                "external_ref": req.external_ref,
            },
            "destination": req.destination.model_dump(),
            "reason": req.reason,
            "lines": [
                {"item_code": ln.item_code, "qty": ln.qty, "unit": ln.unit} for ln in req.lines
            ],
        }
        ctx = CallContext(
            "RES-005",
            actor=req.actor.username or req.actor.name,
            external_ref=req.external_ref,
            line_count=len(req.lines),
        )
        res = await self._client.create_withdrawal(body, ctx)

        now = datetime.now(UTC)
        doc = {
            "_id": req.external_ref,
            "shelter_code": req.shelter_code,
            "request_code": res["request_code"],
            "status": res.get("status") or "pending",
            "source_warehouse_code": req.source_warehouse_code,
            "source_warehouse_name": req.source_warehouse_name,
            "lines": [
                {
                    "item_code": ln.item_code,
                    "name": ln.name,
                    "unit": ln.unit,
                    "type_code": ln.type_code,
                    "qty": ln.qty,
                    "qty_fulfilled": None,
                }
                for ln in req.lines
            ],
            "reason": req.reason,
            "requested_by": req.actor.model_dump(),
            "contact_role": req.requester.contact_role,
            "contact_phone": req.requester.contact_phone,
            "submitted_at": None,
            "approved_at": None,
            "completed_at": None,
            "cancelled_at": None,
            "cancelled_by": None,
            "cancel_reason": None,
            "donation_id": None,
            "confirmed_at": None,
            "confirm_error": None,
            "rev": 1,
            "applied_rev": 0,
            "fetched_at": now,
            "created_at": now,
            "updated_at": now,
        }
        try:
            await coll.update_one({"_id": req.external_ref}, {"$setOnInsert": doc}, upsert=True)
        except DuplicateKeyError:
            # A concurrent submit of the same ref won the race; M6 gave both the same code.
            winner = await coll.find_one({"_id": req.external_ref})
            if winner is None:
                raise
            return self._replay(winner, req), True
        return _view(doc, live=True), False

    @staticmethod
    def _replay(row: dict[str, Any], req: M6WithdrawalCreateRequest) -> M6WithdrawalView:
        if row["shelter_code"] != req.shelter_code:
            raise M6Error(422, "M6_BAD_REQUEST", "เลขอ้างอิงนี้ถูกใช้แล้ว")
        return _view(row, live=False)

    # --- list / detail ------------------------------------------------------------------

    async def list_withdrawals(
        self, shelter_code: str, status: str | None
    ) -> M6WithdrawalListResponse:
        query: dict[str, Any] = {"shelter_code": shelter_code}
        wanted = [s.strip() for s in (status or "").split(",") if s.strip()]
        if wanted:
            query["status"] = {"$in": wanted}
        rows = await self._collection().find(query).sort("created_at", -1).to_list(None)
        data = [_view(r, live=False) for r in rows]
        return M6WithdrawalListResponse(data=data, total=len(data))

    async def _own_row(self, code: str, shelter_code: str) -> dict[str, Any]:
        """The shelter's own row. Checked before any M6 call so nothing leaks across shelters."""
        row = await self._collection().find_one(
            {"request_code": code, "shelter_code": shelter_code}
        )
        if row is None:
            raise _not_found()
        return row

    async def _apply(self, current: dict[str, Any], res: dict[str, Any]) -> tuple[bool, dict]:
        """Refresh our row from RES-006. Returns (changed, row as stored now)."""
        snap = _snapshot(current, res)
        changed = any(not _same(k, current.get(k), v) for k, v in snap.items())
        now = datetime.now(UTC)
        fields: dict[str, Any] = {**snap, "fetched_at": now}
        update: dict[str, Any] = {"$set": fields}
        if changed:
            fields["updated_at"] = now
            update["$inc"] = {"rev": 1}
        await self._collection().update_one({"_id": current["_id"]}, update)
        return changed, {**current, **fields}

    async def get(self, code: str, shelter_code: str) -> M6WithdrawalView:
        row = await self._own_row(code, shelter_code)
        try:
            res = await self._client.get_withdrawal(code)
        except (*_INFRA_FAILURES, M6Error):
            # M6 is down (or refuses): the last snapshot is still worth showing.
            logger.warning("m6 detail refresh failed, serving snapshot (code=%s)", code)
            return _view(row, live=False)
        _, row = await self._apply(row, res)
        return _view(row, live=True)

    # --- RES-008 ------------------------------------------------------------------------

    async def cancel(self, code: str, req: M6CancelRequest) -> M6WithdrawalView:
        row = await self._own_row(code, req.shelter_code)
        actor = req.actor.username or req.actor.name
        try:
            res = await self._client.cancel(
                code,
                req.actor.name,
                req.reason,
                CallContext("RES-008", actor=actor, external_ref=row["_id"], request_code=code),
            )
        except M6Error as exc:
            if exc.code == "M6_NOT_CANCELLABLE":
                # The request moved on (approved, issued …): pull the real state now.
                await self._refresh_quietly(row, actor)
            raise
        now = datetime.now(UTC)
        fields = {
            "status": res.get("status") or "cancelled",
            "cancelled_at": now.replace(microsecond=now.microsecond // 1000 * 1000),
            "cancelled_by": req.actor.model_dump(),
            "cancel_reason": req.reason,
            "fetched_at": now,
            "updated_at": now,
        }
        await self._collection().update_one(
            {"_id": row["_id"]}, {"$set": fields, "$inc": {"rev": 1}}
        )
        return _view({**row, **fields}, live=True)

    async def _refresh_quietly(self, row: dict[str, Any], actor: str | None) -> None:
        try:
            ctx = CallContext(
                "RES-006", actor=actor, external_ref=row["_id"], request_code=row["request_code"]
            )
            await self._apply(row, await self._client.get_withdrawal(row["request_code"], ctx))
        except (*_INFRA_FAILURES, M6Error):
            logger.warning(
                "m6 refresh after a rejected action failed (code=%s)", row["request_code"]
            )

    # --- sync (worker tick) -------------------------------------------------------------

    async def sync(self) -> M6SyncResponse:
        """Poll every open withdrawal (RES-006), then send due confirmations (RES-007)."""
        coll = self._collection()
        out = M6SyncResponse()
        open_rows = await coll.find({"status": {"$in": list(M6_OPEN_STATUSES)}}).to_list(None)
        for row in open_rows:
            ctx = CallContext(
                "RES-006",
                actor=_SYNC_ACTOR,
                external_ref=row["_id"],
                request_code=row["request_code"],
            )
            try:
                res = await self._client.get_withdrawal(row["request_code"], ctx)
            except M6Error:
                logger.warning("m6 sync could not read withdrawal (code=%s)", row["request_code"])
                continue
            out.polled += 1
            changed, _ = await self._apply(row, res)
            if changed:
                out.changed += 1

        now = datetime.now(UTC)
        due = (
            await self._outbox()
            .find(
                {
                    "done_at": None,
                    "$or": [{"next_attempt_at": None}, {"next_attempt_at": {"$lte": now}}],
                }
            )
            .sort("created_at", 1)
            .to_list(None)
        )
        for item in due:
            if await self._send_confirmation(item):
                out.confirmed += 1
            else:
                out.confirm_failed += 1
        return out

    async def _send_confirmation(self, item: dict[str, Any]) -> bool:
        """RES-007 for one outbox row. Returns True once M6 holds the confirmation."""
        code = item["_id"]
        received_by = [
            {"name": p["name"], "username": p.get("username")}
            for p in item.get("received_by") or []
        ]
        ctx = CallContext(
            "RES-007", actor=_SYNC_ACTOR, external_ref=item.get("external_ref"), request_code=code
        )
        error: str
        try:
            await self._client.confirm_receipt(code, received_by, item["note"], ctx)
        except M6Error as exc:
            error = exc.m6_code or exc.code
            if exc.m6_code == "request_not_in_transit":
                # Already confirmed (e.g. an earlier answer was lost): accept if M6 agrees.
                try:
                    res = await self._client.get_withdrawal(
                        code, CallContext("RES-006", actor=_SYNC_ACTOR, request_code=code)
                    )
                except (*_INFRA_FAILURES, M6Error) as read_exc:
                    error = (
                        read_exc.code if isinstance(read_exc, M6Error) else _infra_code(read_exc)
                    )
                else:
                    if res.get("status") == "received":
                        await self._mark_confirmed(item, res)
                        return True
        except _INFRA_FAILURES as exc:
            error = _infra_code(exc)
        else:
            await self._mark_confirmed(item, None)
            return True
        await self._mark_failed(item, error)
        return False

    async def _mark_confirmed(self, item: dict[str, Any], res: dict[str, Any] | None) -> None:
        now = datetime.now(UTC)
        stamp = now.replace(microsecond=now.microsecond // 1000 * 1000)
        await self._outbox().update_one(
            {"_id": item["_id"]},
            {"$set": {"done_at": stamp, "last_error": None, "next_attempt_at": None}},
        )
        row = await self._collection().find_one({"request_code": item["_id"]})
        if row is None:
            return
        fields: dict[str, Any] = {
            "status": "received",
            "confirmed_at": stamp,
            "confirm_error": None,
            "updated_at": now,
        }
        if res is not None:
            fields |= {k: v for k, v in _snapshot(row, res).items() if k != "status"}
            fields["fetched_at"] = now
        await self._collection().update_one(
            {"_id": row["_id"]}, {"$set": fields, "$inc": {"rev": 1}}
        )

    async def _mark_failed(self, item: dict[str, Any], error: str) -> None:
        now = datetime.now(UTC)
        attempts = int(item.get("attempts") or 0)
        await self._outbox().update_one(
            {"_id": item["_id"]},
            {
                "$set": {"last_error": error, "next_attempt_at": now + _backoff(attempts)},
                "$inc": {"attempts": 1},
            },
        )
        text = f"ยืนยันกับ M6 ไม่สำเร็จ ({error})"
        row = await self._collection().find_one({"request_code": item["_id"]})
        if row is not None and row.get("confirm_error") != text:
            await self._collection().update_one(
                {"_id": row["_id"]},
                {"$set": {"confirm_error": text, "updated_at": now}, "$inc": {"rev": 1}},
            )


def get_m6_use_case(client: HttpM6Client = Depends(get_m6_client)) -> M6UseCase:  # noqa: B008
    return M6UseCase(client)
