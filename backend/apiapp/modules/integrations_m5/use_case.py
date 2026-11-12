"""M5 integration use case — transfers, status gate and sync (draft CR — referral M5 §2, §5, §6).

`m5_transfers` is written by several FastAPI processes and read/marked by the worker, so
every write here is a field-level `$set` plus an atomic `$inc` on `rev`; never `save()`.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from typing import Any

from fastapi import Depends
from tent_model import M5_OPEN_STATUSES, M5Transfer

from .client import (
    CallContext,
    HttpM5Client,
    M5CredentialInvalid,
    M5Error,
    M5NotConfigured,
    M5Unavailable,
    get_m5_client,
)
from .schemas import (
    M5FacilitiesResponse,
    M5Status,
    M5SyncResponse,
    M5TransferCreateRequest,
    M5TransferCreateResponse,
    M5TransferView,
)

logger = logging.getLogger(__name__)

_STATUS_CACHE_SECONDS = 45
_FACILITIES_CACHE_SECONDS = 60
_SYNC_PAGE_LIMIT = 100
_SYNC_ACTOR = "m5:sync"
# Snapshot keys copied from an M5 transfer onto the `m5_transfers` row.
_SNAPSHOT_KEYS = ("code", "status", "destination", "original_destination", "review", "activity")

_status_cache: tuple[float, M5Status] | None = None
_facilities_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def reset_caches() -> None:
    """Drop the per-process status and facilities caches (tests, credential rotation)."""
    global _status_cache
    _status_cache = None
    _facilities_cache.clear()


def _snapshot(res: dict[str, Any], referral_ids: list[str]) -> dict[str, Any]:
    """Fields to persist from an M5 transfer. Only keys M5 actually returned are included."""
    snap = {k: res[k] for k in _SNAPSHOT_KEYS if k in res}
    if "patients" in res:
        rows = res.get("patients") or []
        snap["patients"] = [
            {
                "referral_id": rid,
                "acuity": (rows[i].get("acuity") or "") if i < len(rows) else "",
                "national_id_masked": (rows[i].get("national_id_masked") or "")
                if i < len(rows)
                else "",
            }
            for i, rid in enumerate(referral_ids)
        ]
    return snap


def _m5_body(req: M5TransferCreateRequest) -> dict[str, Any]:
    """TRF-002 body. Deterministic for the same input, so a retry is an M5 idempotent replay."""
    return {
        "external_ref": req.external_ref,
        "origin": req.origin.model_dump(),
        "requester": req.requester.model_dump(),
        "destination_facility_id": req.destination_facility_id,
        "patients": [
            p.model_dump(exclude={"referral_id"}, exclude_none=True) for p in req.patients
        ],
        "transport_vehicle_type": req.transport_vehicle_type,
        "transport_note": req.transport_note,
        "note": req.note,
    }


class M5UseCase:
    def __init__(self, client: HttpM5Client, clock: Any = time.monotonic) -> None:
        self._client = client
        self._clock = clock

    @staticmethod
    def _collection():
        return M5Transfer.get_pymongo_collection()

    # --- health gate --------------------------------------------------------------------

    async def status(self) -> M5Status:
        global _status_cache
        now = self._clock()
        if _status_cache and now - _status_cache[0] < _STATUS_CACHE_SECONDS:
            return _status_cache[1]

        checked_at = datetime.now(UTC)
        if not self._client.configured:
            m5 = M5Status(
                configured=False,
                token_ok=False,
                reachable=False,
                checked_at=checked_at,
                error="not_configured",
            )
        else:
            try:
                await self._client.check()
                m5 = M5Status(configured=True, token_ok=True, reachable=True, checked_at=checked_at)
            except M5CredentialInvalid:
                m5 = M5Status(
                    configured=True,
                    token_ok=False,
                    reachable=True,
                    checked_at=checked_at,
                    error="credential_invalid",
                )
            except M5Unavailable, M5Error:
                m5 = M5Status(
                    configured=True,
                    token_ok=False,
                    reachable=False,
                    checked_at=checked_at,
                    error="unavailable",
                )
        _status_cache = (now, m5)
        return m5

    # --- TRF-001 ------------------------------------------------------------------------

    async def facilities(self, q: str | None) -> M5FacilitiesResponse:
        key = (q or "").strip()
        hit = _facilities_cache.get(key)
        if hit and self._clock() - hit[0] < _FACILITIES_CACHE_SECONDS:
            return M5FacilitiesResponse.model_validate(hit[1])
        res = await self._client.facilities(key or None)
        _facilities_cache[key] = (self._clock(), res)
        return M5FacilitiesResponse.model_validate(res)

    # --- TRF-002 ------------------------------------------------------------------------

    async def create_transfer(self, req: M5TransferCreateRequest) -> M5TransferCreateResponse:
        ctx = CallContext(
            "TRF-002",
            actor=req.actor,
            external_ref=req.external_ref,
            patient_count=len(req.patients),
        )
        try:
            res = await self._client.create_transfer(_m5_body(req), ctx)
            replayed = bool(res.get("replayed"))
        except M5Error as exc:
            # Same ref, different body: M5 already holds this batch's transfer (the first
            # send succeeded but was not recorded, then evacuee data changed). Recover it
            # instead of failing — the batch members are fixed once created (D14).
            code = exc.extra.get("transfer_code")
            if exc.code != "M5_EXTERNAL_REF_CONFLICT" or not code:
                raise
            res = await self._client.get_transfer(
                code,
                CallContext("TRF-004", actor=req.actor, external_ref=req.external_ref, code=code),
            )
            if res.get("external_ref") != req.external_ref:
                raise
            replayed = True

        now = datetime.now(UTC)
        referral_ids = [p.referral_id for p in req.patients]
        await self._collection().update_one(
            {"_id": req.external_ref},
            {
                "$setOnInsert": {
                    "batch_id": req.batch_id,
                    "shelter_code": req.shelter_code,
                    "referral_ids": referral_ids,
                    "applied_rev": 0,
                    "created_at": now,
                },
                "$set": {**_snapshot(res, referral_ids), "fetched_at": now, "updated_at": now},
                "$inc": {"rev": 1},
            },
            upsert=True,
        )
        return M5TransferCreateResponse(
            code=res["code"],
            status=res["status"],
            external_ref=req.external_ref,
            replayed=replayed,
        )

    # --- snapshot refresh ---------------------------------------------------------------

    async def _apply(self, res: dict[str, Any]) -> bool:
        """Refresh our row from an M5 transfer. Returns True when the snapshot changed."""
        coll = self._collection()
        ref = res.get("external_ref")
        current = await coll.find_one({"_id": ref} if ref else {"code": res.get("code")})
        if current is None:
            return False  # a transfer this system never recorded (e.g. a manual test)
        snap = _snapshot(res, current.get("referral_ids") or [])
        changed = any(current.get(k) != v for k, v in snap.items())
        now = datetime.now(UTC)
        update: dict[str, Any] = {"$set": {**snap, "fetched_at": now}}
        if changed:
            update["$set"]["updated_at"] = now
            update["$inc"] = {"rev": 1}
        await coll.update_one({"_id": current["_id"]}, update)
        return changed

    # --- TRF-004 / 005 / 006 ------------------------------------------------------------

    async def get_transfer(self, code: str) -> M5TransferView:
        res = await self._client.get_transfer(code)
        await self._apply(res)
        return M5TransferView.model_validate(res)

    async def _refresh_quietly(self, code: str, actor: str | None) -> None:
        try:
            ctx = CallContext("TRF-004", actor=actor, code=code)
            await self._apply(await self._client.get_transfer(code, ctx))
        except M5Error, M5Unavailable, M5CredentialInvalid, M5NotConfigured:
            logger.warning("m5 refresh after a rejected action failed (code=%s)", code)

    async def start(self, code: str, actor: str | None) -> M5TransferView:
        try:
            res = await self._client.start(code, CallContext("TRF-005", actor=actor, code=code))
        except M5Error as exc:
            if exc.code == "NOT_PENDING":
                await self._refresh_quietly(code, actor)
            raise
        await self._apply(res)
        return M5TransferView.model_validate(res)

    async def cancel(self, code: str, reason: str, actor: str | None) -> M5TransferView:
        try:
            res = await self._client.cancel(
                code, reason, CallContext("TRF-006", actor=actor, code=code)
            )
        except M5Error as exc:
            # The real state moved on (approved or already closed): pull it now so the
            # worker applies it without waiting for the next tick.
            if exc.code in ("CANCEL_NEEDS_MOPH", "ALREADY_CLOSED"):
                await self._refresh_quietly(code, actor)
            raise
        await self._apply(res)
        return M5TransferView.model_validate(res)

    # --- sync (worker tick) -------------------------------------------------------------

    async def sync(self) -> M5SyncResponse:
        coll = self._collection()
        open_rows = await coll.find(
            {"status": {"$in": list(M5_OPEN_STATUSES)}}, {"_id": 1, "code": 1}
        ).to_list(None)
        if not open_rows:
            return M5SyncResponse(skipped=True)

        checked = changed = 0
        seen: set[str] = set()
        page = 1
        while True:
            res = await self._client.list_transfers(
                status=",".join(M5_OPEN_STATUSES), page=page, limit=_SYNC_PAGE_LIMIT
            )
            items = res.get("data") or []
            for item in items:
                checked += 1
                seen.add(item.get("code"))
                if await self._apply(item):
                    changed += 1
            if not items or page * _SYNC_PAGE_LIMIT >= int(res.get("total") or 0):
                break
            page += 1

        # Rows still open here but missing from M5's open list have closed
        # (rejected / arrived / cancelled): read each one to learn how.
        for row in open_rows:
            code = row["code"]
            if code in seen:
                continue
            try:
                item = await self._client.get_transfer(
                    code, CallContext("TRF-004", actor=_SYNC_ACTOR, code=code)
                )
            except M5Error:
                logger.warning("m5 sync could not read transfer (code=%s)", code)
                continue
            checked += 1
            if await self._apply(item):
                changed += 1
        return M5SyncResponse(skipped=False, checked=checked, changed=changed)


def get_m5_use_case(client: HttpM5Client = Depends(get_m5_client)) -> M5UseCase:  # noqa: B008
    return M5UseCase(client)
