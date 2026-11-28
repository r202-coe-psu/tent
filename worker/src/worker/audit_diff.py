from __future__ import annotations

import hashlib
import json
import logging
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from worker.audit_log import (
    AUDIT_LOG_DB,
    EVENT_PREFIX,
    RETRYABLE_STATUSES,
    AuditCopy,
)
from worker.couch.client import CATALOG_DB, WORKER_ACTOR
from worker.masking import shelter_code_from_db_name
from worker.timeutil import iso_utc

logger = logging.getLogger(__name__)

AUDITED_TYPES: frozenset[str] = frozenset(
    {
        "item_category",
        "item_master",
        "recipe",
        "unit_of_measure",
        "food_sphere_standard",
        "requirement_group",
        "replenishment_policy",
        "evacuee",
        "household",
        "medical",
    }
)

# Every changed field of an audited type is recorded with its before -> after values, except
# the ones below, which keep only the field name ("changed"): personal data and PDPA s.26
# sensitive data (health, disability, religion), per the audit/privacy spec. `audit_log` is
# append-only, so a value that lands there can never be removed.
ALL_FIELDS = "*"
VALUE_DENYLIST: dict[str, frozenset[str]] = {
    "medical": frozenset({ALL_FIELDS}),
    "evacuee": frozenset(
        {
            "first_name",
            "last_name",
            "nickname",
            "phone",
            "age",
            "birth_year",
            "person_id",
            "photo",
            "card_snapshot",
            "emergency_contact",
            "religion",
            "religion_other",
            "vulnerable_groups",
            "disability_other_detail",
            "special_needs",
            "consent",
        }
    ),
    "household": frozenset(
        {
            "label",
            "notes",
            "vehicles",
            "assets",
            "community",
            "municipality_zone",
            "residence_landmark",
            "address_no",
            "village_no",
            "subdistrict",
            "district",
            "province",
            "postal_code",
            "dorm_name",
            "dorm_building",
            "dorm_floor",
            "dorm_room",
        }
    ),
}

# A value bigger than this (as JSON) is recorded as "changed" only, so one edit of a large
# nested doc cannot bloat the append-only log.
MAX_VALUE_JSON_CHARS = 2000

LABEL_FIELDS: dict[str, str] = {
    "item_category": "name",
    "item_master": "name",
    "recipe": "label",
    "unit_of_measure": "label_th",
}

IGNORED_FIELDS: frozenset[str] = frozenset(
    {
        "_id",
        "_rev",
        "type",
        "schema_v",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
        "password",
        "password_sha",
        "password_scheme",
        "derived_key",
        "salt",
        "iterations",
        "pbkdf2_prf",
    }
)

STATUS_FIELDS: tuple[str, ...] = ("status", "operation_status", "deactivated", "active")

EVENT_VERBS: dict[str, str] = {
    "create": "created",
    "update": "updated",
    "delete": "deleted",
    "status_change": "status_changed",
}

REV_EVENT_PREFIX = f"{EVENT_PREFIX}rev:"
PUBLIC_ACTOR = "public"


@dataclass(frozen=True)
class AuditDiffConfig:
    enabled: bool = False
    public_writer: str = "public_writer"


_config = AuditDiffConfig()


def configure_audit_diff(*, enabled: bool, public_writer: str) -> None:
    global _config
    _config = AuditDiffConfig(enabled=enabled, public_writer=public_writer)


def audit_diff_config() -> AuditDiffConfig:
    return _config


def is_audit_diff_database(database: str) -> bool:
    return database.startswith("shelter_") or database == CATALOG_DB


def audit_event_id(database: str, doc_id: str, rev: str) -> str:
    digest = hashlib.sha256(f"{database}|{doc_id}|{rev}".encode()).hexdigest()
    return f"{REV_EVENT_PREFIX}{digest}"


def _number(value: float) -> str:
    if not math.isfinite(value):
        return "null"
    if value == int(value):
        return json.dumps(int(value))
    return json.dumps(value)


def canonical(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return _number(value)
    if isinstance(value, list | tuple):
        return "[" + ",".join(canonical(v) for v in value) + "]"
    if isinstance(value, dict):
        entries = [
            f"{json.dumps(str(k))}:{canonical(value[k])}"
            for k in sorted(value, key=str)
        ]
        return "{" + ",".join(entries) + "}"
    return json.dumps(value)


def _value_hidden(entity_type: str, field: str) -> bool:
    denied = VALUE_DENYLIST.get(entity_type, frozenset())
    return ALL_FIELDS in denied or field in denied


def _is_loggable(value: Any) -> bool:
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False)
    except TypeError, ValueError:
        return False
    return len(encoded) <= MAX_VALUE_JSON_CHARS


def compute_changes(
    entity_type: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    prev = before or {}
    nxt = after or {}
    fields = sorted((set(prev) | set(nxt)) - IGNORED_FIELDS)
    changes: list[dict[str, Any]] = []
    for field in fields:
        old = prev.get(field)
        new = nxt.get(field)
        if canonical(old) == canonical(new):
            continue
        if (
            not _value_hidden(entity_type, field)
            and _is_loggable(old)
            and _is_loggable(new)
        ):
            changes.append({"field": field, "from": old, "to": new})
        else:
            changes.append({"field": field})
    return changes


def _status_changed(before: dict[str, Any], after: dict[str, Any]) -> bool:
    return any(
        canonical(before.get(field)) != canonical(after.get(field))
        for field in STATUS_FIELDS
    )


def entity_type_of(doc: dict[str, Any], doc_id: str) -> str | None:
    doc_type = doc.get("type")
    if isinstance(doc_type, str) and doc_type:
        return doc_type
    if ":" in doc_id:
        return doc_id.split(":", 1)[0]
    return None


def resolve_actor(doc: dict[str, Any], *, public_writer: str) -> dict[str, str]:
    """Who made this revision — only ever from ``updated_by``.

    ``created_by`` is not a fallback, even on rev 1: the access rule checks ``updated_by``
    against the session user but not ``created_by``, so a client could create a doc that
    names someone else there. A revision with no ``updated_by`` is ``unknown`` (W2).
    """
    name = doc.get("updated_by")
    if not isinstance(name, str) or not name:
        return {"name": "unknown", "kind": "unknown"}
    if name == WORKER_ACTOR:
        return {"name": name, "kind": "worker"}
    if name == PUBLIC_ACTOR or (public_writer and name == public_writer):
        return {"name": PUBLIC_ACTOR, "kind": "system"}
    if name.startswith(("kiosk:", "system:")):
        return {"name": name, "kind": "system"}
    return {"name": name, "kind": "user"}


def entity_label(entity_type: str, doc: dict[str, Any] | None) -> str | None:
    field = LABEL_FIELDS.get(entity_type)
    if not field or not doc:
        return None
    value = doc.get(field)
    return value if isinstance(value, str) and value else None


def _shelter_code(database: str, *docs: dict[str, Any] | None) -> str | None:
    from_db = shelter_code_from_db_name(database)
    if from_db:
        return from_db
    for doc in docs:
        code = (doc or {}).get("shelter_code")
        if isinstance(code, str) and code:
            return code
    return None


def _rev_of(change: dict[str, Any], doc: dict[str, Any]) -> str | None:
    rev = doc.get("_rev")
    if isinstance(rev, str) and rev:
        return rev
    for row in change.get("changes") or []:
        candidate = row.get("rev") if isinstance(row, dict) else None
        if isinstance(candidate, str) and candidate:
            return candidate
    return None


def _rev_number(rev: str) -> int:
    head = rev.split("-", 1)[0]
    return int(head) if head.isdigit() else 0


class PreviousRevReadError(RuntimeError):
    """Raised on a transient error reading the previous revision."""


async def read_previous_rev(
    couch: Any, database: str, doc_id: str, rev: str
) -> dict[str, Any] | None:
    try:
        current = await couch.get_doc_rev(database, doc_id, rev, revs=True)
        revisions = (current or {}).get("_revisions") or {}
        start = revisions.get("start")
        ids = revisions.get("ids") or []
        if not isinstance(start, int) or len(ids) < 2:
            return None
        previous = f"{start - 1}-{ids[1]}"
        return await couch.get_doc_rev(database, doc_id, previous)
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if 400 <= status < 500 and status not in RETRYABLE_STATUSES:
            logger.warning(
                "Could not read the previous revision of %s/%s at %s (HTTP %s)",
                database,
                doc_id,
                rev,
                status,
                exc_info=True,
            )
            return None
        logger.warning(
            "Transient error reading the previous revision of %s/%s at %s",
            database,
            doc_id,
            rev,
            exc_info=True,
        )
        raise PreviousRevReadError(
            f"Transient error reading previous revision of {database}/{doc_id} at {rev}"
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning(
            "Network error reading the previous revision of %s/%s at %s",
            database,
            doc_id,
            rev,
            exc_info=True,
        )
        raise PreviousRevReadError(
            f"Network error reading previous revision of {database}/{doc_id} at {rev}"
        ) from exc
    except Exception:
        logger.warning(
            "Could not read the previous revision of %s/%s at %s",
            database,
            doc_id,
            rev,
            exc_info=True,
        )
        return None


async def build_audit_diff_event(
    couch: Any,
    database: str,
    change: dict[str, Any],
    *,
    public_writer: str,
    now: datetime,
) -> dict[str, Any] | None:
    doc_id = change.get("id")
    doc = change.get("doc") or {}
    if not doc_id:
        doc_id = doc.get("_id")
    if not isinstance(doc_id, str) or not doc_id or doc_id.startswith("_design/"):
        return None
    entity_type = entity_type_of(doc, doc_id)
    if entity_type not in AUDITED_TYPES:
        return None
    rev = _rev_of(change, doc)
    if not rev:
        return None

    deleted = bool(change.get("deleted") or doc.get("_deleted"))
    first_rev = _rev_number(rev) == 1
    changes: list[dict[str, Any]] | None = None
    changes_unknown = False
    previous: dict[str, Any] | None = None

    if deleted:
        action = "delete"
        if _rev_number(rev) > 1:
            previous = await read_previous_rev(couch, database, doc_id, rev)
    elif first_rev:
        action = "create"
    else:
        previous = await read_previous_rev(couch, database, doc_id, rev)
        if previous is None:
            action = "update"
            changes_unknown = True
        elif previous.get("_deleted"):
            action = "create"
            previous = None
        else:
            action = "status_change" if _status_changed(previous, doc) else "update"
            changes = compute_changes(entity_type, previous, doc)

    stamp = iso_utc(now)
    actor = resolve_actor(doc, public_writer=public_writer)
    label_source = previous if deleted else doc
    event: dict[str, Any] = {
        "_id": audit_event_id(database, doc_id, rev),
        "type": "audit_event",
        "schema_v": 1,
        "occurred_at": doc.get("updated_at") or doc.get("created_at") or stamp,
        "created_at": stamp,
        "updated_at": stamp,
        "created_by": actor["name"],
        "actor": actor,
        "action": action,
        "event": f"{entity_type}.{EVENT_VERBS[action]}",
        "entity": {
            "type": entity_type,
            "id": doc_id,
            "label": entity_label(entity_type, label_source),
        },
        "shelter_code": _shelter_code(database, doc, previous),
        "reason": None,
        "source": "worker_diff",
        "source_ref": doc_id,
    }
    if changes is not None:
        event["changes"] = changes
    if changes_unknown:
        event["changes_unknown"] = True
    return event


async def audit_diff(
    couch: Any,
    database: str,
    change: dict[str, Any],
    *,
    now: datetime | None = None,
) -> AuditCopy:
    """Write the audit event for one change; the outcome says whether to retry it.

    Classified like ``copy_audit_doc``: ``RETRY`` only for a write that may land
    next time (5xx, 408/429, network) — the caller holds the checkpoint so the
    event is not lost. Anything a retry cannot fix (no event to write, a 4xx
    such as a missing ``audit_log`` DB, a build bug) is ``SKIPPED`` and logged.
    """
    config = audit_diff_config()
    if not config.enabled or not is_audit_diff_database(database):
        return AuditCopy.SKIPPED
    try:
        event = await build_audit_diff_event(
            couch,
            database,
            change,
            public_writer=config.public_writer,
            now=now or datetime.now(UTC),
        )
    except PreviousRevReadError:
        return AuditCopy.RETRY
    except Exception:
        logger.exception(
            "Failed to build audit event for %s/%s", database, change.get("id")
        )
        return AuditCopy.SKIPPED
    if event is None:
        return AuditCopy.SKIPPED
    try:
        await couch.put_doc(AUDIT_LOG_DB, event, retry_conflict=False)
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status == 409:
            return AuditCopy.COPIED
        if 400 <= status < 500 and status not in RETRYABLE_STATUSES:
            logger.warning(
                "%s rejected the audit event for %s/%s with HTTP %s — not written",
                AUDIT_LOG_DB,
                database,
                change.get("id"),
                status,
            )
            return AuditCopy.SKIPPED
        logger.exception(
            "Failed to write audit event for %s/%s", database, change.get("id")
        )
        return AuditCopy.RETRY
    except Exception:
        logger.exception(
            "Failed to write audit event for %s/%s", database, change.get("id")
        )
        return AuditCopy.RETRY
    return AuditCopy.COPIED
