"""Revoke time-limited staff roles that a volunteer coordinator granted (#955, #879 item 2).

A coordinator grants a volunteer one of four staff roles until the end of a chosen day. The
grant lives on the ``_users`` doc as ``role_grants: [{shelter_code, role, expires_at, ...}]``
next to the compound role ``SHxxx:<role>`` it created. This sweep removes only the roles
whose grant has expired, and keeps the account so the next grant needs no new password.

Never touched: roles without a grant (given by a shelter manager), other shelters' roles, and
other grants. ``shelter:SHxxx`` goes only when no ``SHxxx:<role>`` is left for that shelter.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from worker.couch.client import CouchClient

logger = logging.getLogger(__name__)

USERS_DB = "_users"


def _is_expired(grant: Any, *, now: datetime) -> bool:
    if not isinstance(grant, dict):
        return False
    expires_at = grant.get("expires_at")
    if not isinstance(expires_at, str) or not expires_at:
        return False
    try:
        deadline = datetime.fromisoformat(expires_at)
    except ValueError:
        # Bad data must not stall the sweep for every other account.
        logger.warning("Unparseable grant expires_at %r - skipping", expires_at)
        return False
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=UTC)
    return deadline <= now


def revoke_expired_grants(
    doc: dict[str, Any], *, now: datetime
) -> dict[str, Any] | None:
    """The user doc without its expired grants and their roles, or ``None`` if nothing expired."""
    grants = doc.get("role_grants")
    if not isinstance(grants, list):
        return None
    expired = [g for g in grants if _is_expired(g, now=now)]
    if not expired:
        return None

    kept = [g for g in grants if not _is_expired(g, now=now)]
    expired_roles = {f"{g.get('shelter_code')}:{g.get('role')}" for g in expired}
    # A shelter manager may have re-issued the same role without a grant; a live grant for the
    # same role keeps it too.
    live_roles = {
        f"{g.get('shelter_code')}:{g.get('role')}" for g in kept if isinstance(g, dict)
    }
    roles = [
        r for r in doc.get("roles") or [] if r not in expired_roles or r in live_roles
    ]
    for code in {g.get("shelter_code") for g in expired}:
        if not any(r.startswith(f"{code}:") for r in roles):
            roles = [r for r in roles if r != f"shelter:{code}"]

    shelters = [r.removeprefix("shelter:") for r in roles if r.startswith("shelter:")]
    return {
        **doc,
        "roles": roles,
        "role_grants": kept,
        "shelter_id": shelters[0] if shelters else None,
    }


async def expire_role_grants(couch: CouchClient, *, now: datetime) -> int:
    """Sweep ``_users`` and revoke expired coordinator grants. Returns accounts changed."""
    # Collect before writing: updating docs mid-iteration would shift the pages under us.
    names = [
        doc["_id"]
        async for doc in couch.iter_all_docs(USERS_DB)
        if doc.get("role_grants") and revoke_expired_grants(doc, now=now) is not None
    ]
    total = 0
    for doc_id in names:
        try:

            async def mutate(current: dict[str, Any]) -> dict[str, Any] | None:
                return revoke_expired_grants(current, now=now)

            if await couch.update_doc(USERS_DB, doc_id, mutate) is not None:
                total += 1
        except Exception:
            logger.exception("Failed to revoke expired role grants for %s", doc_id)
    if total:
        logger.info("Revoked expired role grants on %d account(s)", total)
    return total
