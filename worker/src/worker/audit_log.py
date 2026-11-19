from __future__ import annotations

import logging
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

import httpx

from worker.masking import shelter_code_from_db_name
from worker.timeutil import iso_utc

logger = logging.getLogger(__name__)

AUDIT_LOG_DB = "audit_log"
SOURCE_PREFIX = "audit:"
EVENT_PREFIX = "audit_event:"


def is_audit_doc(doc: dict[str, Any] | None) -> bool:
    return bool(doc) and doc.get("type") == "audit"


def to_audit_event(
    source: dict[str, Any], db_name: str, now: datetime
) -> dict[str, Any] | None:
    source_id = str(source.get("_id") or "")
    if not source_id.startswith(SOURCE_PREFIX):
        return None
    ulid = source_id.removeprefix(SOURCE_PREFIX)
    if not ulid:
        return None

    stamp = iso_utc(now)
    created_by = source.get("created_by")
    if created_by:
        actor = {
            "name": str(created_by),
            "kind": "worker" if created_by == "worker" else "user",
        }
    else:
        actor = {"name": "system", "kind": "system"}

    action = source.get("action")
    reason = source.get("reason") or None
    event = reason if action == "other" and reason else f"audit.{action}"

    return {
        "_id": f"{EVENT_PREFIX}{ulid}",
        "type": "audit_event",
        "schema_v": 1,
        "occurred_at": source.get("occurred_at") or source.get("created_at") or stamp,
        "created_at": stamp,
        "updated_at": stamp,
        "created_by": actor["name"],
        "actor": actor,
        "action": "other",
        "event": event,
        "entity": {
            "type": source.get("target_type"),
            "id": source.get("target_id"),
            "label": None,
        },
        "shelter_code": source.get("shelter_code")
        or shelter_code_from_db_name(db_name),
        "reason": reason,
        "source": "worker_copy",
        "source_ref": source_id,
    }


class AuditCopy(StrEnum):
    COPIED = "copied"
    SKIPPED = "skipped"
    RETRY = "retry"


async def copy_audit_doc(
    couch: Any,
    source: dict[str, Any],
    db_name: str,
    *,
    now: datetime | None = None,
) -> AuditCopy:
    event = to_audit_event(source, db_name, now or datetime.now(UTC))
    if event is None:
        logger.warning(
            "Skipping audit doc %s in %s: not an audit:{ULID} id",
            source.get("_id"),
            db_name,
        )
        return AuditCopy.SKIPPED
    try:
        await couch.put_doc(AUDIT_LOG_DB, event, retry_conflict=False)
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status == 409:
            return AuditCopy.COPIED
        if status == 404:
            logger.warning(
                "Database %s does not exist — audit doc %s from %s not copied",
                AUDIT_LOG_DB,
                source.get("_id"),
                db_name,
            )
            return AuditCopy.SKIPPED
        logger.exception(
            "Failed to copy audit doc %s from %s to %s",
            source.get("_id"),
            db_name,
            AUDIT_LOG_DB,
        )
        return AuditCopy.RETRY
    except Exception:
        logger.exception(
            "Failed to copy audit doc %s from %s to %s",
            source.get("_id"),
            db_name,
            AUDIT_LOG_DB,
        )
        return AuditCopy.RETRY
    return AuditCopy.COPIED


async def copy_all_audit_docs(couch: Any, db_name: str) -> int:
    if not await couch.database_exists(db_name):
        return 0
    copied = 0
    async for doc in couch.iter_all_docs(db_name):
        if is_audit_doc(doc) and await copy_audit_doc(couch, doc, db_name):
            copied += 1
    return copied
