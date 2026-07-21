"""Inbound loop — persist family-search audit buffer into CouchDB ``central_ops``."""

from __future__ import annotations

import asyncio
import logging

from tent_model import SearchAudit

from worker.couch.client import CouchClient

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 15
CENTRAL_OPS_DB = "central_ops"


async def _persist_search_audit(couch: CouchClient, audit: SearchAudit) -> bool:
    await couch.ensure_database(CENTRAL_OPS_DB)

    occurred = audit.occurred_at.isoformat().replace("+00:00", "Z")
    couch_doc = {
        "_id": audit.id if audit.id.startswith("search_audit:") else f"search_audit:{audit.id}",
        "type": "search_audit",
        "schema_v": 1,
        "query_kind": audit.query_kind,
        "query_hash": audit.query_hash,
        "ip_hash": audit.ip_hash,
        "result_count": audit.result_count,
        "occurred_at": occurred,
        "created_at": occurred,
    }

    try:
        result = await couch.put_doc(CENTRAL_OPS_DB, couch_doc)
    except Exception:
        logger.exception("Failed to persist search_audit %s to CouchDB", audit.id)
        return False

    if not result.get("ok"):
        logger.error(
            "CouchDB put for search_audit %s did not acknowledge ok: %s",
            audit.id,
            result,
        )
        return False

    audit.synced_to_couch = True
    await audit.save()
    logger.info("Persisted search_audit %s to %s", audit.id, CENTRAL_OPS_DB)
    return True


async def run_search_audit_inbound_loop(couch: CouchClient, *, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            pending = await SearchAudit.find(
                SearchAudit.synced_to_couch == False  # noqa: E712
            ).to_list()
            for audit in pending:
                if stop_event.is_set():
                    break
                await _persist_search_audit(couch, audit)
        except Exception:
            logger.exception("Inbound search_audit poll failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
