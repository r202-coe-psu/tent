"""Inbound loop — persist Mongo ``audit_events`` into CouchDB ``central_ops`` (CR-231).

The whole ``pii`` key is dropped before the doc is written: CouchDB audit docs are append-only
and cannot be deleted, so they must never hold PII. ``_id`` is shared with Mongo → idempotent.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from tent_model import AuditEvent

from worker.couch.client import CouchClient

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 15
#: Unreadable rows are retried every poll; log the traceback once per id, not every 15 s.
_reported_unreadable: set[str] = set()
CENTRAL_OPS_DB = "central_ops"

#: Mongo-only fields; everything else on the event is carried to CouchDB.
_MONGO_ONLY = {"pii", "synced_to_couch"}


def audit_couch_doc(audit: AuditEvent) -> dict[str, Any]:
    """CouchDB ``audit`` doc (schema.md §2.12 v2) for a Mongo event — never contains ``pii``."""
    body = audit.model_dump(mode="json", exclude=_MONGO_ONLY, exclude_none=True)
    body.pop("id", None)
    occurred = audit.occurred_at.isoformat().replace("+00:00", "Z")
    return {
        **body,
        "_id": audit.id,
        "type": "audit",
        "schema_v": 2,
        "occurred_at": occurred,
        "created_at": occurred,
    }


async def _persist_audit_event(couch: CouchClient, audit: AuditEvent) -> bool:
    await couch.ensure_database(CENTRAL_OPS_DB)
    couch_doc = audit_couch_doc(audit)

    try:
        result = await couch.put_doc(CENTRAL_OPS_DB, couch_doc)
    except Exception:
        logger.exception("Failed to persist audit_event %s to CouchDB", audit.id)
        return False

    if not result.get("ok"):
        logger.error(
            "CouchDB put for audit_event %s did not acknowledge ok: %s",
            audit.id,
            result,
        )
        return False

    audit.synced_to_couch = True
    try:
        await audit.set({AuditEvent.synced_to_couch: True})
    except Exception:
        # CouchDB already has the doc; the next poll re-puts it (same `_id`, idempotent).
        logger.exception(
            "Persisted audit_event %s but could not mark it synced", audit.id
        )
        return False
    logger.info("Persisted audit_event %s to %s", audit.id, CENTRAL_OPS_DB)
    return True


async def _pending_ids() -> list[str]:
    cursor = AuditEvent.get_pymongo_collection().find(
        {"synced_to_couch": False}, {"_id": 1}
    )
    return [row["_id"] async for row in cursor]


async def sync_pending(couch: CouchClient, *, stop_event: asyncio.Event) -> None:
    """One pass. Rows are loaded one by one so an unreadable row (unknown ``event_type`` from a
    newer FastAPI, malformed migration row) is logged and skipped instead of blocking the rest.
    """
    for audit_id in await _pending_ids():
        if stop_event.is_set():
            break
        try:
            audit = await AuditEvent.get(audit_id)
        except Exception:
            if audit_id not in _reported_unreadable:
                _reported_unreadable.add(audit_id)
                logger.exception("Skipping unreadable audit_event %s", audit_id)
            continue
        if audit is not None:
            await _persist_audit_event(couch, audit)


async def run_audit_inbound_loop(
    couch: CouchClient, *, stop_event: asyncio.Event
) -> None:
    while not stop_event.is_set():
        try:
            await sync_pending(couch, stop_event=stop_event)
        except Exception:
            logger.exception("Inbound audit_event poll failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
