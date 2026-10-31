"""Tests for the coordinator role-grant expiry sweep (#955)."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from worker import role_grants
from worker.role_grants import (
    AUDIT_ATTEMPTS,
    build_grant_audit,
    expire_role_grants,
    is_identity_verified,
    revoke_expired_grants,
    write_grant_audit,
)

NOW = datetime(2026, 10, 30, 12, 0, 0, tzinfo=UTC)
PAST = "2026-10-29T16:59:59.999Z"
FUTURE = "2026-10-31T16:59:59.999Z"


VERIFIER = ("SH001", "volunteer:V1")


def _grant(role, expires_at, code="SH001", verified_by=VERIFIER):
    grant = {
        "shelter_code": code,
        "role": role,
        "expires_at": expires_at,
        "granted_by": "coord01",
        "granted_at": "2026-10-27T03:00:00.000Z",
    }
    if verified_by is not None:
        grant["verified_by"] = {
            "shelter_code": verified_by[0],
            "volunteer_id": verified_by[1],
        }
    return grant


def _user(roles, grants, name="vol@example.com"):
    return {
        "_id": f"org.couchdb.user:{name}",
        "_rev": "1-a",
        "name": name,
        "roles": roles,
        "shelter_id": "SH001",
        "role_grants": grants,
        "derived_key": "keep",
    }


def test_removes_only_the_expired_role_and_its_grant():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff", "SH001:distribution_staff"],
        [_grant("kitchen_staff", PAST), _grant("distribution_staff", FUTURE)],
    )
    out = revoke_expired_grants(doc, now=NOW)
    assert out["roles"] == ["shelter:SH001", "SH001:distribution_staff"]
    assert out["role_grants"] == [_grant("distribution_staff", FUTURE)]
    assert out["derived_key"] == "keep"


def test_drops_shelter_scope_when_no_role_is_left_in_it():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff"], [_grant("kitchen_staff", PAST)]
    )
    out = revoke_expired_grants(doc, now=NOW)
    assert out["roles"] == []
    assert out["role_grants"] == []
    assert out["shelter_id"] is None


def test_never_touches_a_role_a_manager_gave_without_a_grant():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff", "SH001:facility_staff"],
        [_grant("kitchen_staff", PAST)],
    )
    out = revoke_expired_grants(doc, now=NOW)
    assert out["roles"] == ["shelter:SH001", "SH001:facility_staff"]


def test_never_touches_another_shelters_roles():
    doc = _user(
        [
            "shelter:SH001",
            "SH001:kitchen_staff",
            "shelter:SH002",
            "SH002:kitchen_staff",
        ],
        [_grant("kitchen_staff", PAST)],
    )
    out = revoke_expired_grants(doc, now=NOW)
    assert out["roles"] == ["shelter:SH002", "SH002:kitchen_staff"]
    assert out["shelter_id"] == "SH002"


def test_expiry_instant_itself_is_expired():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff"],
        [_grant("kitchen_staff", NOW.isoformat())],
    )
    assert revoke_expired_grants(doc, now=NOW) is not None


def test_nothing_to_do_when_no_grant_has_expired_or_data_is_bad():
    assert (
        revoke_expired_grants(
            _user(["shelter:SH001"], [_grant("kitchen_staff", FUTURE)]), now=NOW
        )
        is None
    )
    assert (
        revoke_expired_grants(
            _user(["shelter:SH001"], [_grant("kitchen_staff", "junk")]), now=NOW
        )
        is None
    )
    assert revoke_expired_grants({"roles": []}, now=NOW) is None


VERIFIED = {
    "_id": "volunteer:V1",
    "type": "volunteer",
    "identity_verification": {"status": "verified"},
}


def _couch(docs, volunteers=None):
    """``volunteers`` maps ``(shelter_code, volunteer_id)`` to a profile doc."""
    store = {d["_id"]: d for d in docs}
    volunteers = {} if volunteers is None else volunteers
    audits = []

    async def iter_all_docs(database):
        assert database == "_users"
        for doc in docs:
            yield doc

    async def update_doc(database, doc_id, mutate):
        changed = await mutate(store[doc_id])
        if changed is not None:
            store[doc_id] = changed
        return changed

    async def get_doc(database, doc_id):
        code = database.removeprefix("shelter_").upper()
        return volunteers.get((code, doc_id))

    async def bulk_docs(database, new_docs):
        audits.extend((database, d) for d in new_docs)
        return [{"id": d["_id"], "rev": "1-a"} for d in new_docs]

    couch = AsyncMock()
    couch.iter_all_docs = iter_all_docs
    couch.update_doc = AsyncMock(side_effect=update_doc)
    couch.get_doc = AsyncMock(side_effect=get_doc)
    couch.bulk_docs = AsyncMock(side_effect=bulk_docs)
    couch.audits = audits
    return couch, store


async def test_sweep_keeps_the_account_and_skips_untouched_ones():
    expired = _user(
        ["shelter:SH001", "SH001:kitchen_staff"], [_grant("kitchen_staff", PAST)]
    )
    live = _user(
        ["shelter:SH001", "SH001:kitchen_staff"],
        [_grant("kitchen_staff", FUTURE)],
        "live@example.com",
    )
    plain = {"_id": "org.couchdb.user:mgr", "name": "mgr", "roles": ["shelter:SH001"]}
    couch, store = _couch([expired, live, plain], {VERIFIER: VERIFIED})

    assert await expire_role_grants(couch, now=NOW) == 1

    assert store[expired["_id"]]["roles"] == []
    assert store[expired["_id"]]["name"] == "vol@example.com"
    assert store[live["_id"]] == live
    assert couch.update_doc.await_count == 1


async def test_one_failed_write_does_not_stop_the_sweep():
    a = _user(
        ["shelter:SH001", "SH001:kitchen_staff"],
        [_grant("kitchen_staff", PAST)],
        "a@example.com",
    )
    b = _user(
        ["shelter:SH001", "SH001:kitchen_staff"],
        [_grant("kitchen_staff", PAST)],
        "b@example.com",
    )
    couch, store = _couch([a, b], {VERIFIER: VERIFIED})
    real = couch.update_doc.side_effect
    calls = []

    async def flaky(database, doc_id, mutate):
        calls.append(doc_id)
        if len(calls) == 1:
            raise RuntimeError("couch down")
        return await real(database, doc_id, mutate)

    couch.update_doc = AsyncMock(side_effect=flaky)
    assert await expire_role_grants(couch, now=NOW) == 1
    assert store[b["_id"]]["roles"] == []


# --- identity verification (FR-3, FR-12, AC-8) ---


def test_identity_verified_follows_the_record_then_the_legacy_flag():
    assert is_identity_verified({"identity_verification": {"status": "verified"}})
    assert not is_identity_verified({"identity_verification": {"status": "rejected"}})
    assert not is_identity_verified({"identity_verification": {"status": "pending"}})
    # The record wins over the legacy flag, as the app's identityVerificationStatus does.
    assert not is_identity_verified(
        {"identity_verified": True, "identity_verification": {"status": "rejected"}}
    )
    assert is_identity_verified({"identity_verified": True})
    assert not is_identity_verified({})
    assert not is_identity_verified(None)


def test_revokes_a_grant_whose_verifying_profile_is_no_longer_verified():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff", "SH001:facility_staff"],
        [
            _grant("kitchen_staff", FUTURE),
            _grant("facility_staff", FUTURE, verified_by=None),
        ],
    )
    out = revoke_expired_grants(doc, now=NOW, unverified={VERIFIER})
    assert out["roles"] == ["shelter:SH001", "SH001:facility_staff"]
    assert [g["role"] for g in out["role_grants"]] == ["facility_staff"]


def test_a_verified_profile_keeps_its_grants():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff"], [_grant("kitchen_staff", FUTURE)]
    )
    assert revoke_expired_grants(doc, now=NOW, unverified={("SH002", "x")}) is None


async def test_sweep_revokes_when_the_verifying_profile_was_rejected_and_audits_it():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff"], [_grant("kitchen_staff", FUTURE)]
    )
    rejected = {**VERIFIED, "identity_verification": {"status": "rejected"}}
    couch, store = _couch([doc], {VERIFIER: rejected})

    assert await expire_role_grants(couch, now=NOW) == 1

    assert store[doc["_id"]]["roles"] == []
    assert store[doc["_id"]]["role_grants"] == []
    ((database, audit),) = couch.audits
    assert database == "shelter_sh001"
    assert audit["reason"] == "role_grant.verification_revoked"


async def test_sweep_revokes_when_the_verifying_profile_is_gone():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff"], [_grant("kitchen_staff", FUTURE)]
    )
    couch, store = _couch([doc], {})
    assert await expire_role_grants(couch, now=NOW) == 1
    assert store[doc["_id"]]["roles"] == []


async def test_sweep_looks_at_the_profile_of_another_shelter():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff"],
        [_grant("kitchen_staff", FUTURE, verified_by=("SH002", "volunteer:V9"))],
    )
    verified = {**VERIFIED, "_id": "volunteer:V9"}
    couch, store = _couch([doc], {("SH002", "volunteer:V9"): verified})
    assert await expire_role_grants(couch, now=NOW) == 0
    couch.get_doc.assert_awaited_once_with("shelter_sh002", "volunteer:V9")
    assert store[doc["_id"]] == doc


async def test_an_unreadable_profile_does_not_revoke():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff"], [_grant("kitchen_staff", FUTURE)]
    )
    couch, store = _couch([doc], {VERIFIER: VERIFIED})
    couch.get_doc = AsyncMock(side_effect=RuntimeError("couch down"))
    assert await expire_role_grants(couch, now=NOW) == 0
    assert store[doc["_id"]] == doc


async def test_a_grant_without_verified_by_is_only_checked_for_expiry():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff"],
        [_grant("kitchen_staff", FUTURE, verified_by=None)],
    )
    couch, _ = _couch([doc], {})
    assert await expire_role_grants(couch, now=NOW) == 0
    couch.get_doc.assert_not_awaited()


# --- audit (FR-14, AC-4) ---


async def test_an_expiry_writes_an_audit_into_the_shelter_database():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff"], [_grant("kitchen_staff", PAST)]
    )
    couch, _ = _couch([doc], {VERIFIER: VERIFIED})
    await expire_role_grants(couch, now=NOW)
    ((database, audit),) = couch.audits
    assert database == "shelter_sh001"
    assert audit["_id"].startswith("audit:")
    assert audit["type"] == "audit"
    assert audit["schema_v"] == 1
    assert audit["shelter_code"] == "SH001"
    assert audit["created_by"] == "worker"
    assert audit["action"] == "other"
    assert audit["target_type"] == "user"
    assert audit["target_id"] == "org.couchdb.user:vol@example.com"
    assert audit["reason"] == "role_grant.expired"
    assert audit["context"] == {
        "role": "kitchen_staff",
        "expires_at": PAST,
        "actor": "worker",
    }
    assert audit["occurred_at"] == audit["created_at"] == "2026-10-30T12:00:00.000Z"


async def test_no_audit_when_nothing_was_revoked():
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff"], [_grant("kitchen_staff", FUTURE)]
    )
    couch, _ = _couch([doc], {VERIFIER: VERIFIED})
    await expire_role_grants(couch, now=NOW)
    assert couch.audits == []


def _audit():
    return build_grant_audit(
        user_id="org.couchdb.user:vol@example.com",
        grant=_grant("kitchen_staff", PAST),
        reason="role_grant.expired",
        now=NOW,
    )


@pytest.fixture
def no_retry_delay(monkeypatch):
    monkeypatch.setattr(role_grants, "AUDIT_RETRY_DELAY_SECONDS", 0)


async def test_audit_write_is_retried_then_logged_without_raising(
    no_retry_delay, caplog
):
    couch = AsyncMock()
    couch.bulk_docs = AsyncMock(side_effect=RuntimeError("couch down"))
    assert await write_grant_audit(couch, _audit()) is False
    assert couch.bulk_docs.await_count == AUDIT_ATTEMPTS
    assert "role_grant.expired" in caplog.text
    assert "org.couchdb.user:vol@example.com" in caplog.text
    assert "kitchen_staff" in caplog.text


async def test_audit_write_succeeds_on_a_retry_and_a_conflict_counts_as_written(
    no_retry_delay,
):
    couch = AsyncMock()
    couch.bulk_docs = AsyncMock(
        side_effect=[
            [{"id": "a", "error": "internal_server_error"}],
            [{"id": "a", "error": "conflict"}],
        ]
    )
    assert await write_grant_audit(couch, _audit()) is True
    assert couch.bulk_docs.await_count == 2


async def test_a_failed_audit_does_not_undo_the_revocation(no_retry_delay):
    doc = _user(
        ["shelter:SH001", "SH001:kitchen_staff"], [_grant("kitchen_staff", PAST)]
    )
    couch, store = _couch([doc], {VERIFIER: VERIFIED})
    couch.bulk_docs = AsyncMock(side_effect=RuntimeError("couch down"))
    assert await expire_role_grants(couch, now=NOW) == 1
    assert store[doc["_id"]]["roles"] == []
