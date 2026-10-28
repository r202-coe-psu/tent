"""Revoke time-limited staff roles that a volunteer coordinator granted (#955, #879 item 2).

A coordinator grants a volunteer one of four staff roles until the end of a chosen day. The
grant lives on the ``_users`` doc as ``role_grants: [{shelter_code, role, expires_at,
verified_by, ...}]`` next to the compound role ``SHxxx:<role>`` it created. This sweep removes
only the roles whose grant has expired or whose ``verified_by`` volunteer profile is no longer
``identity_verification.status == verified``, and keeps the account so the next grant needs no
new password. Each revocation is written as an ``audit`` doc into ``shelter_{code}``.

Never touched: roles without a grant (given by a shelter manager), other shelters' roles, and
other grants. ``shelter:SHxxx`` goes only when no ``SHxxx:<role>`` is left for that shelter.

The sweep writes ``_users`` with the worker's CouchDB admin credential (draft CR FR-12); the
``_users/_design/tent_guard`` validation lets only an admin touch ``role_grants``.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Collection
from datetime import UTC, datetime
from typing import Any

from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.timeutil import iso_utc
from worker.ulid import new_ulid

logger = logging.getLogger(__name__)

USERS_DB = "_users"
USER_PREFIX = "org.couchdb.user:"

REASON_EXPIRED = "role_grant.expired"
REASON_VERIFICATION_REVOKED = "role_grant.verification_revoked"

ACTOR = "worker"
AUDIT_ATTEMPTS = 3
AUDIT_RETRY_DELAY_SECONDS = 0.5

#: (shelter_code, volunteer_id) of a volunteer profile.
Profile = tuple[str, str]


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


def verified_by(grant: Any) -> Profile | None:
    """The profile a grant's identity check rests on, or ``None`` for a grant without one."""
    if not isinstance(grant, dict):
        return None
    ref = grant.get("verified_by")
    if not isinstance(ref, dict):
        return None
    code, volunteer_id = ref.get("shelter_code"), ref.get("volunteer_id")
    if (
        isinstance(code, str)
        and code
        and isinstance(volunteer_id, str)
        and volunteer_id
    ):
        return (code, volunteer_id)
    return None


def is_identity_verified(profile: dict[str, Any] | None) -> bool:
    """Same rule as the app's ``identityVerificationStatus``: the record wins over the flag."""
    if not isinstance(profile, dict):
        return False
    record = profile.get("identity_verification")
    if isinstance(record, dict) and record.get("status") is not None:
        return record["status"] == "verified"
    return profile.get("identity_verified") is True


def grants_to_revoke(
    doc: dict[str, Any],
    *,
    now: datetime,
    unverified: Collection[Profile] = (),
) -> list[tuple[dict[str, Any], str]]:
    """``(grant, audit reason)`` for every grant that has expired or lost its verification."""
    grants = doc.get("role_grants")
    if not isinstance(grants, list):
        return []
    out: list[tuple[dict[str, Any], str]] = []
    for grant in grants:
        if _is_expired(grant, now=now):
            out.append((grant, REASON_EXPIRED))
        elif (profile := verified_by(grant)) is not None and profile in unverified:
            out.append((grant, REASON_VERIFICATION_REVOKED))
    return out


def apply_revocations(
    doc: dict[str, Any], revoked: list[tuple[dict[str, Any], str]]
) -> dict[str, Any]:
    """The user doc without the revoked grants and their roles."""
    gone = [g for g, _ in revoked]
    kept = [g for g in doc.get("role_grants") or [] if not any(g is r for r in gone)]
    revoked_roles = {f"{g.get('shelter_code')}:{g.get('role')}" for g in gone}
    # A shelter manager may have re-issued the same role without a grant; a live grant for the
    # same role keeps it too.
    live_roles = {
        f"{g.get('shelter_code')}:{g.get('role')}" for g in kept if isinstance(g, dict)
    }
    roles = [
        r for r in doc.get("roles") or [] if r not in revoked_roles or r in live_roles
    ]
    for code in {g.get("shelter_code") for g in gone}:
        if not any(r.startswith(f"{code}:") for r in roles):
            roles = [r for r in roles if r != f"shelter:{code}"]

    shelters = [r.removeprefix("shelter:") for r in roles if r.startswith("shelter:")]
    return {
        **doc,
        "roles": roles,
        "role_grants": kept,
        "shelter_id": shelters[0] if shelters else None,
    }


def revoke_expired_grants(
    doc: dict[str, Any],
    *,
    now: datetime,
    unverified: Collection[Profile] = (),
) -> dict[str, Any] | None:
    """The user doc without its lapsed grants and their roles, or ``None`` if none lapsed."""
    revoked = grants_to_revoke(doc, now=now, unverified=unverified)
    return apply_revocations(doc, revoked) if revoked else None


def build_grant_audit(
    *,
    user_id: str,
    grant: dict[str, Any],
    reason: str,
    now: datetime,
) -> dict[str, Any]:
    """The ``audit`` doc of a revoked grant (schema.md §2.12; draft CR FR-14).

    Same envelope as the staff app's ``createAuditEntry``; ``action: other`` because the
    ``audit.action`` enum has no role-grant value, so ``reason`` says what happened.
    """
    stamp = iso_utc(now)
    return {
        "_id": f"audit:{new_ulid()}",
        "type": "audit",
        "schema_v": 1,
        "shelter_code": grant.get("shelter_code"),
        "created_at": stamp,
        "updated_at": stamp,
        "created_by": ACTOR,
        "action": "other",
        "target_type": "user",
        "target_id": user_id
        if user_id.startswith(USER_PREFIX)
        else USER_PREFIX + user_id,
        "reason": reason,
        "context": {
            "role": grant.get("role"),
            "expires_at": grant.get("expires_at"),
            "actor": ACTOR,
        },
        "occurred_at": stamp,
    }


async def write_grant_audit(couch: CouchClient, audit: dict[str, Any]) -> bool:
    """Store the audit after the ``_users`` change landed; never undo that change.

    Retries a few times, then logs the audit fields so it can be backfilled. A ``conflict``
    means an earlier attempt did land.
    """
    database = shelter_db_name(str(audit["shelter_code"]))
    error: object = None
    for attempt in range(1, AUDIT_ATTEMPTS + 1):
        try:
            rows = await couch.bulk_docs(database, [audit])
            error = next(
                (r for r in rows if r.get("error") and r["error"] != "conflict"), None
            )
            if error is None:
                return True
        except Exception as exc:  # noqa: BLE001 - any failure is retried, then logged
            error = exc
        if attempt < AUDIT_ATTEMPTS:
            await asyncio.sleep(AUDIT_RETRY_DELAY_SECONDS * attempt)
    logger.error(
        "Role grant audit not written: shelter_code=%s target_id=%s reason=%s "
        "context=%s occurred_at=%s error=%s",
        audit["shelter_code"],
        audit["target_id"],
        audit["reason"],
        audit["context"],
        audit["occurred_at"],
        error,
    )
    return False


async def _unverified_profiles(
    couch: CouchClient, wanted: set[Profile]
) -> set[Profile]:
    """The profiles among ``wanted`` that are missing or no longer identity-verified.

    A read that fails says nothing about verification, so that profile is left alone and
    its grants survive this round.
    """
    unverified: set[Profile] = set()
    for code, volunteer_id in sorted(wanted):
        try:
            profile = await couch.get_doc(shelter_db_name(code), volunteer_id)
        except Exception:
            logger.exception(
                "Could not read volunteer %s/%s - skipping", code, volunteer_id
            )
            continue
        if not is_identity_verified(profile):
            unverified.add((code, volunteer_id))
    return unverified


async def _revoke(
    couch: CouchClient,
    doc_id: str,
    *,
    now: datetime,
    unverified: Collection[Profile],
) -> list[tuple[dict[str, Any], str]] | None:
    """Write one account's revocations; the grants removed, or ``None`` if nothing changed."""
    revoked: list[tuple[dict[str, Any], str]] = []

    async def mutate(current: dict[str, Any]) -> dict[str, Any] | None:
        # Re-derived from the fresh doc on every attempt; the last plan is the one written.
        revoked[:] = grants_to_revoke(current, now=now, unverified=unverified)
        return apply_revocations(current, revoked) if revoked else None

    try:
        changed = await couch.update_doc(USERS_DB, doc_id, mutate)
    except Exception:
        logger.exception("Failed to revoke role grants for %s", doc_id)
        return None
    return revoked if changed is not None else None


async def expire_role_grants(couch: CouchClient, *, now: datetime) -> int:
    """Sweep ``_users`` and revoke lapsed coordinator grants. Returns accounts changed."""
    # Collect before writing: updating docs mid-iteration would shift the pages under us.
    users = [
        doc
        async for doc in couch.iter_all_docs(USERS_DB)
        if isinstance(doc.get("role_grants"), list) and doc["role_grants"]
    ]
    wanted = {
        profile
        for doc in users
        for grant in doc["role_grants"]
        if not _is_expired(grant, now=now)
        and (profile := verified_by(grant)) is not None
    }
    unverified = await _unverified_profiles(couch, wanted)

    total = 0
    for doc in users:
        if not grants_to_revoke(doc, now=now, unverified=unverified):
            continue
        revoked = await _revoke(couch, doc["_id"], now=now, unverified=unverified)
        if revoked is None:
            continue
        total += 1
        for grant, reason in revoked:
            await write_grant_audit(
                couch,
                build_grant_audit(
                    user_id=doc["_id"], grant=grant, reason=reason, now=now
                ),
            )
    if total:
        logger.info("Revoked lapsed role grants on %d account(s)", total)
    return total
