"""Tests for the reservation TTL sweep (T-21 DoD — "TTL หมดอายุ")."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

from worker.quota.expiry import expire_declared_donations, should_expire

NOW = datetime(2026, 7, 29, 12, 0, 0, tzinfo=UTC)
PAST = "2026-07-29T11:00:00Z"
FUTURE = "2026-07-29T13:00:00Z"


# --- should_expire (pure) ---


def test_expires_a_declared_reservation_past_its_ttl():
    assert should_expire("declared", PAST, now=NOW) is True


def test_keeps_a_declared_reservation_still_within_ttl():
    assert should_expire("declared", FUTURE, now=NOW) is False


def test_expires_a_reservation_waiting_in_the_review_chain():
    """CR-052 opens public bookings at ``pending_review``, not ``declared``.

    Their TTL has to run all the same — gating on ``declared`` alone would leave every
    booking the wizard creates to sit past its expiry with the quota never handed back
    (CR-045).
    """
    for status in ("pending_review", "verifying"):
        assert should_expire(status, PAST, now=NOW) is True, status
        assert should_expire(status, FUTURE, now=NOW) is False, status


def test_never_expires_a_received_donation():
    """Goods arrived and consumed the target — the TTL must not undo that."""
    assert should_expire("received", PAST, now=NOW) is False


def test_never_re_expires_terminal_statuses():
    for status in ("expired", "cancelled", "rejected", "redirected"):
        assert should_expire(status, PAST, now=NOW) is False, status


def test_treats_naive_expires_at_as_utc():
    assert should_expire("declared", "2026-07-29T11:00:00", now=NOW) is True
    assert should_expire("declared", "2026-07-29T13:00:00", now=NOW) is False


def test_skips_missing_or_unparseable_expires_at():
    for value in (None, "", "not-a-date", 12345, {}):
        assert should_expire("declared", value, now=NOW) is False, value


# --- expire_declared_donations (against a CouchDB stub) ---


def _couch(docs_by_db, *, registry=None, put=None):
    registry = registry if registry is not None else [{"type": "shelter", "code": "SH001"}]

    async def iter_all_docs(database):
        rows = registry if database == "registry" else docs_by_db.get(database, [])
        for doc in rows:
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = iter_all_docs
    couch.put_doc = put or AsyncMock(return_value={"ok": True})
    return couch


def _donation(doc_id, status, expires_at):
    return {
        "_id": doc_id,
        "_rev": "1-abc",
        "type": "donation",
        "status": status,
        "expires_at": expires_at,
    }


async def test_flips_only_the_stale_reservations():
    couch = _couch(
        {
            "shelter_sh001": [
                _donation("donation:1", "declared", PAST),
                _donation("donation:2", "declared", FUTURE),
                _donation("donation:3", "received", PAST),
                {"_id": "donation_campaign:c1", "type": "donation_campaign", "status": "open"},
            ]
        }
    )

    count = await expire_declared_donations(couch, now=NOW)

    assert count == 1
    (database, written), _ = couch.put_doc.call_args
    assert database == "shelter_sh001"
    assert written["_id"] == "donation:1"
    assert written["status"] == "expired"
    assert written["updated_at"] == "2026-07-29T12:00:00Z"
    # The _rev must survive so CouchDB accepts the update instead of 409-ing.
    assert written["_rev"] == "1-abc"


async def test_sweeps_every_shelter_including_closed_ones():
    couch = _couch(
        {
            "shelter_sh001": [_donation("donation:1", "declared", PAST)],
            "shelter_sh002": [_donation("donation:2", "declared", PAST)],
        },
        registry=[
            {"type": "shelter", "code": "SH001", "status": "open"},
            {"type": "shelter", "code": "SH002", "status": "closed"},
        ],
    )

    assert await expire_declared_donations(couch, now=NOW) == 2


async def test_does_nothing_when_no_reservation_is_stale():
    couch = _couch({"shelter_sh001": [_donation("donation:1", "declared", FUTURE)]})

    assert await expire_declared_donations(couch, now=NOW) == 0
    couch.put_doc.assert_not_awaited()


async def test_one_failed_write_does_not_stop_the_sweep():
    put = AsyncMock(side_effect=[RuntimeError("couch down"), {"ok": True}])
    couch = _couch(
        {
            "shelter_sh001": [
                _donation("donation:1", "declared", PAST),
                _donation("donation:2", "declared", PAST),
            ]
        },
        put=put,
    )

    # First document fails, second still gets expired and is counted.
    assert await expire_declared_donations(couch, now=NOW) == 1
    assert put.await_count == 2


async def test_reads_all_documents_before_writing_any():
    """Writing mid-iteration would shift the _all_docs pages under the sweep."""
    order: list[str] = []

    async def iter_all_docs(database):
        if database == "registry":
            yield {"type": "shelter", "code": "SH001"}
            return
        for doc_id in ("donation:1", "donation:2"):
            order.append(f"read:{doc_id}")
            yield _donation(doc_id, "declared", PAST)

    async def put_doc(_database, doc):
        order.append(f"write:{doc['_id']}")
        return {"ok": True}

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = iter_all_docs
    couch.put_doc = put_doc

    await expire_declared_donations(couch, now=NOW)

    assert order == ["read:donation:1", "read:donation:2", "write:donation:1", "write:donation:2"]


async def test_skips_a_shelter_whose_database_is_missing():
    """Registry lists the shelter but its database is gone — sweep on, don't crash."""
    couch = _couch({"shelter_sh001": [_donation("donation:1", "declared", PAST)]})
    couch.database_exists = AsyncMock(side_effect=lambda db: db == "registry")

    assert await expire_declared_donations(couch, now=NOW) == 0
    couch.put_doc.assert_not_awaited()
