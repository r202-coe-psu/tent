"""``e2e-partner-janitor`` — selection gates and per-client delete order (live test Mongo)."""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime, timedelta

import pytest
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import PyMongoError
from tent_model import (
    ExternalBooking,
    ExternalBookingIdempotency,
    ThirdPartyAccessLog,
    ThirdPartyClient,
)

from worker.cli import e2e_partner_janitor as janitor

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
OLD = NOW - timedelta(hours=24)
FRESH = NOW - timedelta(minutes=30)
MAX_AGE = 6


async def _client(
    client_id: str,
    name: str,
    *,
    created_at: datetime = OLD,
    is_active: bool = False,
) -> ThirdPartyClient:
    row = ThirdPartyClient(
        id=f"row-{client_id}",
        client_id=client_id,
        client_secret_hash="x",
        name=name,
        allowed_scopes=["location-read"],
        is_active=is_active,
        created_at=created_at,
        updated_at=created_at,
    )
    await row.insert()
    return row


async def _booking(
    client_id: str,
    row_id: str,
    state: str = "written",
    *,
    updated_at: datetime = OLD,
    shelter_code: str = "SH001",
    **overrides,
) -> None:
    await ExternalBooking(
        id=row_id,
        booking_id=f"BK-{row_id}",
        client_id=client_id,
        shelter_code=shelter_code,
        cid_hash=f"hash-{row_id}",
        state=state,
        created_at=OLD,
        updated_at=updated_at,
        **overrides,
    ).insert()


async def _idem(client_id: str, key: str) -> None:
    await ExternalBookingIdempotency(
        id=f"IK-{client_id}-{key}",
        client_id=client_id,
        key=key,
        request_hash="h",
        booking_id="BK-1",
        status="completed",
        created_at=OLD,
    ).insert()


async def _log(client_id: str, log_id: str) -> None:
    await ThirdPartyAccessLog(
        id=log_id,
        client_id=client_id,
        endpoint="/external/occupants",
        location_code="SH001",
        purpose="test",
        ip="127.0.0.1",
        status="granted",
        created_at=OLD,
    ).insert()


async def _seed_client_data(client_id: str) -> None:
    await _idem(client_id, "k1")
    await _idem(client_id, "k2")
    await _log(client_id, f"log-{client_id}-1")
    await _booking(client_id, f"{client_id}-w", "written")
    await _booking(client_id, f"{client_id}-c", "cancelled")
    await _booking(client_id, f"{client_id}-r", "rejected")


async def _counts(client_id: str) -> tuple[int, int, int, int]:
    return (
        await ThirdPartyClient.get_pymongo_collection().count_documents(
            {"client_id": client_id}
        ),
        await ExternalBookingIdempotency.get_pymongo_collection().count_documents(
            {"client_id": client_id}
        ),
        await ThirdPartyAccessLog.get_pymongo_collection().count_documents(
            {"client_id": client_id}
        ),
        await ExternalBooking.get_pymongo_collection().count_documents(
            {"client_id": client_id}
        ),
    )


async def test_dry_run_deletes_nothing(db) -> None:
    await _client("cid-e2e", "E2E partner run1", is_active=True)
    await _seed_client_data("cid-e2e")

    report = await janitor.run_janitor(execute=False, max_age_hours=MAX_AGE, now=NOW)

    assert [c.client_id for c in report.clients] == ["cid-e2e"]
    only = report.clients[0]
    assert (only.idempotency, only.access_logs, only.bookings) == (2, 1, 3)
    assert only.revoked is True  # reported as "would revoke"
    assert await _counts("cid-e2e") == (1, 2, 1, 3)
    row = await ThirdPartyClient.find_one({"client_id": "cid-e2e"})
    assert row is not None and row.is_active is True


async def test_non_prefixed_and_fresh_clients_are_untouched(db) -> None:
    await _client("cid-real", "Real partner")
    await _client("cid-lower", "e2e partner lower")
    await _client("cid-nospace", "E2Epartner")
    await _client("cid-infix", "My E2E partner")
    await _client("cid-fresh", "E2E partner fresh", created_at=FRESH)
    for cid in ("cid-real", "cid-lower", "cid-nospace", "cid-infix", "cid-fresh"):
        await _seed_client_data(cid)

    report = await janitor.run_janitor(execute=True, max_age_hours=MAX_AGE, now=NOW)

    assert report.clients == []
    for cid in ("cid-real", "cid-lower", "cid-nospace", "cid-infix", "cid-fresh"):
        assert await _counts(cid) == (1, 2, 1, 3)


async def test_client_with_pending_booking_is_skipped_whole(db) -> None:
    await _client("cid-busy", "E2E partner busy", is_active=True)
    await _seed_client_data("cid-busy")
    await _booking("cid-busy", "cid-busy-p", "pending")

    report = await janitor.run_janitor(execute=True, max_age_hours=MAX_AGE, now=NOW)

    assert [(c.client_id, c.skipped) for c in report.clients] == [("cid-busy", True)]
    assert not report.failed
    assert await _counts("cid-busy") == (1, 2, 1, 4)
    row = await ThirdPartyClient.find_one({"client_id": "cid-busy"})
    assert row is not None and row.is_active is True  # not even revoked


async def test_client_with_cancel_requested_booking_is_skipped(db) -> None:
    await _client("cid-cancel", "E2E partner cancel")
    await _booking(
        "cid-cancel", "cid-cancel-w", "written", cancel_requested=True, updated_at=FRESH
    )
    await _idem("cid-cancel", "k1")

    report = await janitor.run_janitor(execute=True, max_age_hours=MAX_AGE, now=NOW)

    assert report.clients[0].skipped is True
    assert await _counts("cid-cancel") == (1, 1, 0, 1)


class FakeCouch:
    """Stands in for ``CouchClient``: ``missing`` lists databases that answer 404."""

    def __init__(self, missing: set[str] | None = None, *, error: bool = False) -> None:
        self.missing = missing or set()
        self.error = error
        self.calls: list[str] = []

    async def database_missing(self, database: str) -> bool:
        self.calls.append(database)
        if self.error:
            raise RuntimeError("couch unreachable")
        return database in self.missing


async def test_stale_cancel_requested_without_couch_still_skips_client(db) -> None:
    # No CouchDB client (cannot check) -> never delete on doubt.
    await _client("cid-stale", "E2E partner stale", is_active=True)
    await _seed_client_data("cid-stale")
    await _booking("cid-stale", "cid-stale-x", "written", cancel_requested=True)

    report = await janitor.run_janitor(execute=True, max_age_hours=MAX_AGE, now=NOW)

    assert [(c.client_id, c.skipped) for c in report.clients] == [("cid-stale", True)]
    assert not report.failed
    assert await _counts("cid-stale") == (1, 2, 1, 4)


async def test_stranded_booking_with_shelter_gone_and_old_is_swept(db) -> None:
    await _client("cid-str", "E2E partner stranded", is_active=True)
    await _seed_client_data("cid-str")
    await _booking("cid-str", "cid-str-x", "written", cancel_requested=True)
    await _booking("cid-str", "cid-str-p", "pending")
    couch = FakeCouch(missing={"shelter_sh001"})

    dry = await janitor.run_janitor(
        execute=False, max_age_hours=MAX_AGE, now=NOW, couch=couch
    )
    assert dry.clients[0].stranded == 2
    assert await _counts("cid-str") == (1, 2, 1, 5)

    report = await janitor.run_janitor(
        execute=True, max_age_hours=MAX_AGE, now=NOW, couch=couch
    )

    only = report.clients[0]
    assert (only.skipped, only.stranded, only.bookings) == (False, 2, 5)
    assert not report.failed
    assert await _counts("cid-str") == (0, 0, 0, 0)


async def test_stranded_booking_with_shelter_still_present_skips_client(db) -> None:
    await _client("cid-live", "E2E partner live")
    await _booking("cid-live", "cid-live-x", "written", cancel_requested=True)
    await _idem("cid-live", "k1")

    report = await janitor.run_janitor(
        execute=True, max_age_hours=MAX_AGE, now=NOW, couch=FakeCouch()
    )

    assert report.clients[0].skipped is True
    assert await _counts("cid-live") == (1, 1, 0, 1)


async def test_stranded_booking_newer_than_age_gate_skips_client(db) -> None:
    await _client("cid-new", "E2E partner new")
    await _booking(
        "cid-new", "cid-new-x", "written", cancel_requested=True, updated_at=FRESH
    )

    report = await janitor.run_janitor(
        execute=True,
        max_age_hours=MAX_AGE,
        now=NOW,
        couch=FakeCouch(missing={"shelter_sh001"}),
    )

    assert report.clients[0].skipped is True
    assert await _counts("cid-new") == (1, 0, 0, 1)


async def test_couch_error_counts_as_shelter_still_present(db) -> None:
    await _client("cid-err", "E2E partner err")
    await _booking("cid-err", "cid-err-x", "written", cancel_requested=True)

    report = await janitor.run_janitor(
        execute=True, max_age_hours=MAX_AGE, now=NOW, couch=FakeCouch(error=True)
    )

    assert report.clients[0].skipped is True
    assert not report.failed
    assert await _counts("cid-err") == (1, 0, 0, 1)


async def test_one_non_stranded_in_flight_row_skips_whole_client(db) -> None:
    await _client("cid-mix", "E2E partner mix")
    await _booking("cid-mix", "cid-mix-a", "written", cancel_requested=True)
    await _booking(
        "cid-mix", "cid-mix-b", "written", cancel_requested=True, shelter_code="SH002"
    )
    couch = FakeCouch(missing={"shelter_sh001"})  # SH002 still exists

    report = await janitor.run_janitor(
        execute=True, max_age_hours=MAX_AGE, now=NOW, couch=couch
    )

    assert report.clients[0].skipped is True
    assert await _counts("cid-mix") == (1, 0, 0, 2)


async def test_uncommitted_booking_skips_client(db) -> None:
    await _client("cid-unc", "E2E partner unc")
    await _booking("cid-unc", "cid-unc-u", "written", committed=False)

    report = await janitor.run_janitor(execute=True, max_age_hours=MAX_AGE, now=NOW)

    assert report.clients[0].skipped is True
    assert await _counts("cid-unc") == (1, 0, 0, 1)


async def test_unreconciled_terminal_booking_skips_client(db) -> None:
    await _client("cid-recon", "E2E partner recon")
    await _booking(
        "cid-recon",
        "cid-recon-c",
        "cancelled",
        household_id="HH-1",
        updated_at=FRESH,
    )

    report = await janitor.run_janitor(execute=True, max_age_hours=MAX_AGE, now=NOW)

    assert report.clients[0].skipped is True
    assert await _counts("cid-recon") == (1, 0, 0, 1)


async def test_reconciled_fresh_terminal_booking_does_not_block(db) -> None:
    await _client("cid-done", "E2E partner done")
    await _booking(
        "cid-done",
        "cid-done-c",
        "cancelled",
        household_id="HH-1",
        reconciled_at=FRESH,
        updated_at=FRESH,
    )

    report = await janitor.run_janitor(execute=True, max_age_hours=MAX_AGE, now=NOW)

    assert report.clients[0].skipped is False
    assert await _counts("cid-done") == (0, 0, 0, 0)


async def test_execute_deletes_all_four_collections_only_for_target(db) -> None:
    await _client("cid-e2e", "E2E partner run1")
    await _seed_client_data("cid-e2e")
    await _client("cid-other", "Real partner")
    await _seed_client_data("cid-other")
    await _client("cid-e2e-2", "E2E partner run2")
    await _seed_client_data("cid-e2e-2")

    report = await janitor.run_janitor(execute=True, max_age_hours=MAX_AGE, now=NOW)

    assert {c.client_id for c in report.clients} == {"cid-e2e", "cid-e2e-2"}
    assert not report.failed
    assert await _counts("cid-e2e") == (0, 0, 0, 0)
    assert await _counts("cid-e2e-2") == (0, 0, 0, 0)
    assert await _counts("cid-other") == (1, 2, 1, 3)

    # Second pass finds nothing — idempotent.
    again = await janitor.run_janitor(execute=True, max_age_hours=MAX_AGE, now=NOW)
    assert again.clients == []


async def test_active_client_is_revoked_before_delete(db, monkeypatch) -> None:
    await _client("cid-live", "E2E partner live", is_active=True)
    await _seed_client_data("cid-live")

    seen: list[bool | None] = []
    original = AsyncCollection.delete_many

    async def spy(self, *args, **kwargs):
        if self.name == "external_booking_idempotency":
            row = await ThirdPartyClient.find_one({"client_id": "cid-live"})
            seen.append(row.is_active if row else None)
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(AsyncCollection, "delete_many", spy)

    report = await janitor.run_janitor(execute=True, max_age_hours=MAX_AGE, now=NOW)

    assert report.clients[0].revoked is True
    assert seen == [False]  # already inactive when the first delete ran
    assert await _counts("cid-live") == (0, 0, 0, 0)


async def test_max_age_zero_selects_every_prefixed_client(db) -> None:
    await _client("cid-fresh", "E2E partner fresh", created_at=FRESH)

    report = await janitor.run_janitor(execute=True, max_age_hours=0, now=NOW)

    assert [c.client_id for c in report.clients] == ["cid-fresh"]
    assert await _counts("cid-fresh") == (0, 0, 0, 0)


async def test_delete_failure_is_reported_and_keeps_client_row(db, monkeypatch) -> None:
    await _client("cid-fail", "E2E partner fail")
    await _seed_client_data("cid-fail")

    original = AsyncCollection.delete_many

    async def boom(self, *args, **kwargs):
        if self.name == "third_party_access_logs":
            raise PyMongoError("boom")
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(AsyncCollection, "delete_many", boom)

    report = await janitor.run_janitor(execute=True, max_age_hours=MAX_AGE, now=NOW)

    assert report.failed is True
    assert report.clients[0].error == "PyMongoError"
    clients, _, logs, _ = await _counts("cid-fail")
    assert (clients, logs) == (1, 1)  # client row survives so the next run retries


def test_non_negative_int_accepts_zero_and_rejects_negative_or_text() -> None:
    assert janitor._non_negative_int("0") == 0
    assert janitor._non_negative_int("6") == 6
    for bad in ("-1", "x"):
        with pytest.raises(argparse.ArgumentTypeError):
            janitor._non_negative_int(bad)


def _run_main(monkeypatch, argv: list[str]) -> argparse.Namespace:
    seen: dict[str, argparse.Namespace] = {}

    async def fake_run(args: argparse.Namespace) -> int:
        seen["args"] = args
        return 0

    monkeypatch.setattr(janitor, "_run", fake_run)
    monkeypatch.setattr(sys, "argv", ["e2e-partner-janitor", *argv])
    with pytest.raises(SystemExit) as exit_info:
        janitor.main()
    assert exit_info.value.code == 0
    return seen["args"]


def test_main_defaults_to_dry_run(monkeypatch) -> None:
    args = _run_main(monkeypatch, [])
    assert args.execute is False
    assert args.max_age_hours == janitor.DEFAULT_MAX_AGE_HOURS


def test_main_accepts_zero_max_age_execute_on_local_uri(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URI", "mongodb://localhost:27017/tentdb")
    args = _run_main(monkeypatch, ["--execute", "--max-age-hours=0"])
    assert args.execute is True
    assert args.max_age_hours == 0


def test_main_refuses_execute_with_zero_max_age_on_non_local_uri(
    monkeypatch, capsys
) -> None:
    monkeypatch.setenv("DATABASE_URI", "mongodb://mongodb:27017/tentdb")
    ran: list[argparse.Namespace] = []

    async def fake_run(args: argparse.Namespace) -> int:
        ran.append(args)
        return 0

    monkeypatch.setattr(janitor, "_run", fake_run)
    monkeypatch.setattr(
        sys, "argv", ["e2e-partner-janitor", "--execute", "--max-age-hours=0"]
    )
    with pytest.raises(SystemExit) as exit_info:
        janitor.main()
    assert exit_info.value.code == 2
    assert "local" in capsys.readouterr().err
    assert ran == []  # refused before any DB work


def test_main_allows_dry_run_with_zero_max_age_on_non_local_uri(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URI", "mongodb://mongodb:27017/tentdb")
    args = _run_main(monkeypatch, ["--dry-run", "--max-age-hours=0"])
    assert args.execute is False
    assert args.max_age_hours == 0


@pytest.mark.parametrize(
    ("uri", "expected"),
    [
        ("mongodb://localhost:27017/tentdb", True),
        ("mongodb://127.0.0.1/tentdb", True),
        ("mongodb://[::1]:27017/tentdb", True),
        ("mongodb://user:pw@LOCALHOST:27017/tentdb", True),
        ("mongodb://mongodb:27017/tentdb", False),
        ("mongodb://localhost:27017,mongodb:27017/tentdb", False),
        ("mongodb://localhost.evil.example/tentdb", False),
        ("mongodb+srv://localhost/tentdb", False),
        ("not-a-uri", False),
    ],
)
def test_is_local_mongo_uri(uri: str, expected: bool) -> None:
    assert janitor.is_local_mongo_uri(uri) is expected


def test_main_accepts_positive_max_age(monkeypatch) -> None:
    args = _run_main(monkeypatch, ["--execute", "--max-age-hours=6"])
    assert args.max_age_hours == 6
