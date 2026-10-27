"""Tests for the coordinator role-grant expiry sweep (#955)."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock

from worker.role_grants import expire_role_grants, revoke_expired_grants

NOW = datetime(2026, 10, 30, 12, 0, 0, tzinfo=UTC)
PAST = "2026-10-29T16:59:59.999Z"
FUTURE = "2026-10-31T16:59:59.999Z"


def _grant(role, expires_at, code="SH001"):
    return {
        "shelter_code": code,
        "role": role,
        "expires_at": expires_at,
        "granted_by": "coord01",
        "granted_at": "2026-10-27T03:00:00.000Z",
    }


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


def _couch(docs):
    store = {d["_id"]: d for d in docs}

    async def iter_all_docs(database):
        assert database == "_users"
        for doc in docs:
            yield doc

    async def update_doc(database, doc_id, mutate):
        changed = await mutate(store[doc_id])
        if changed is not None:
            store[doc_id] = changed
        return changed

    couch = AsyncMock()
    couch.iter_all_docs = iter_all_docs
    couch.update_doc = AsyncMock(side_effect=update_doc)
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
    couch, store = _couch([expired, live, plain])

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
    couch, store = _couch([a, b])
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
