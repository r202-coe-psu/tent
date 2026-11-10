"""``migrate-search-audits`` — one-off ``search_audits`` → ``audit_events`` (CR-231 FR-17a).

Every legacy row becomes ``event_type=public.search`` (old rows cannot tell public from
external). ``search_audit:{ULID}`` → ``audit:{ULID}`` so a re-run is idempotent. The source
collection is never modified or deleted, and nothing is dual-written. ``synced_to_couch`` is
carried over: rows already in ``central_ops`` as ``search_audit:*`` stay there (not rewritten);
unsynced rows are picked up by the new inbound loop as ``audit:*`` docs.

Run after the FastAPI/worker cutover has stopped writing ``search_audits``:

    uv run --project worker migrate-search-audits
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError
from tent_model import AuditEvent, close_db, init_db
from tent_model.audit_event import validate_event

from worker.config import load_settings

logger = logging.getLogger("migrate-search-audits")

SOURCE = "search_audits"


def to_audit_event(row: dict[str, Any]) -> dict[str, Any]:
    """Map one raw ``search_audits`` row to an ``audit_events`` document."""
    old_id = str(row["_id"])
    ulid = old_id.removeprefix("search_audit:")
    context: dict[str, Any] = {
        "query_kind": row["query_kind"],
        "query_hash": row["query_hash"],
        "ip_hash": row["ip_hash"],
        "result_count": row["result_count"],
    }
    for key in ("purpose", "consent_version"):
        if row.get(key):
            context[key] = row[key]
    pii: dict[str, Any] | None = None
    if row.get("searcher") or row.get("client_ip") or row.get("purpose_note"):
        pii = {
            "searcher": row.get("searcher"),
            "client_ip": row.get("client_ip"),
            "purpose_note": row.get("purpose_note"),
        }
    return {
        "_id": f"audit:{ulid}",
        "schema_v": 1,
        "event_type": "public.search",
        "domain": "public",
        "occurred_at": row["occurred_at"],
        "actor": {"kind": "anonymous"},
        "outcome": "ok",
        "context": context,
        "pii": pii,
        "synced_to_couch": bool(row.get("synced_to_couch", False)),
        "migrated_from": SOURCE,
    }


async def migrate(db: AsyncDatabase) -> tuple[int, int]:
    """Copy rows not yet migrated; returns ``(inserted, skipped)`` (already present or malformed)."""
    target = db[AuditEvent.Settings.name]
    inserted = skipped = 0
    async for row in db[SOURCE].find({}):
        try:
            doc = to_audit_event(row)
            validate_event(
                "public.search", "public", doc["context"], doc["pii"], legacy=True
            )
        except KeyError, ValueError:
            logger.exception("Skipping malformed search_audits row %s", row.get("_id"))
            skipped += 1
            continue
        try:
            await target.insert_one(doc)
        except DuplicateKeyError:
            skipped += 1
            continue
        inserted += 1
    return inserted, skipped


async def _run() -> None:
    settings = load_settings()
    await init_db(settings.mongodb_uri)
    try:
        client = AuditEvent.get_pymongo_collection().database
        inserted, skipped = await migrate(client)
        logger.info(
            "Migrated %d search_audits row(s); %d already present", inserted, skipped
        )
    finally:
        await close_db()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s"
    )
    asyncio.run(_run())


if __name__ == "__main__":
    main()
