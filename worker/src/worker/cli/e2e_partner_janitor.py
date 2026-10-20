"""``e2e-partner-janitor`` CLI — sweep Mongo leftovers of the partner-API e2e suite.

The Playwright suite (``frontend/e2e/partner-api.test.ts``) creates third-party clients
named ``E2E partner <runId>`` and books through them. After its teardown four Mongo
collections still hold rows a browser cannot delete (staging Mongo is only reachable from
the docker network, so this runs inside the ``worker`` container):

    third_party_clients, external_bookings, third_party_access_logs,
    external_booking_idempotency

Selection is by the **client row only**: ``ThirdPartyClient.name`` starts with ``"E2E "``
AND ``created_at`` is older than ``--max-age-hours`` (so a run in flight is never touched).
Never select by regex, ``module_name`` or scope. CouchDB is never written to (the shelter
janitor ``scripts/staging-e2e-janitor.mjs`` owns it); the only access is the read-only 404
check behind the stranded-booking exception below.

Per selected client, in this order:

1. skip the whole client (warn) if any booking is still in flight: ``state == pending``,
   uncommitted (``committed == false``), ``cancel_requested``, or a terminal row the
   reconcile pass has not stamped. The worker may be writing it to CouchDB right now.
   One owner-approved exception (plan section 5): an in-flight row is treated as
   garbage, and swept with the client, when BOTH its shelter database
   ``shelter_<code>`` no longer exists in CouchDB (a read-only 404 check; any other
   answer or error counts as "still exists") AND its ``updated_at`` (else
   ``created_at``) is older than ``--max-age-hours``. The e2e teardown deletes the shelter
   before the worker can apply a cancel, which would otherwise strand the row (and its
   client) forever. If any in-flight row does not qualify the whole client is skipped;
2. revoke it (``is_active = false``) if it is still active;
3. delete ``external_booking_idempotency`` -> ``third_party_access_logs`` ->
   terminal ``external_bookings`` -> the client row (last, so a half-finished sweep is
   found again by the next run).

**Dry-run is the default.** Nothing is written without ``--execute``. ``--max-age-hours=0``
(every E2E client, including a run in flight) combined with ``--execute`` is refused (exit 2,
before any DB connection) unless every host in ``DATABASE_URI`` is local (``localhost``,
``127.0.0.1``, ``::1``); inside the staging container ``DATABASE_URI`` points at host
``mongodb``, so it is always refused there. A dry run with 0 is allowed anywhere. Jenkins always
passes a positive integer.
Output is limited to name, ``client_id``, age and row counts. Exit 0 when nothing is found;
non-zero when a delete fails.

The console script lives in the worker image's uv venv (``/app/.venv/bin``, not on
``PATH``), so inside the container always go through ``uv run`` (``--no-sync`` so the
production venv is never re-synced):

    uv run --no-sync --project worker e2e-partner-janitor --dry-run
    uv run --no-sync --project worker e2e-partner-janitor --execute --max-age-hours=6

Locally (repo root, ``DATABASE_URI`` pointing at the stack):

    uv run --project worker e2e-partner-janitor --dry-run --max-age-hours=0
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from pymongo.errors import PyMongoError
from pymongo.uri_parser import parse_uri
from tent_model import (
    ExternalBooking,
    ExternalBookingIdempotency,
    ThirdPartyAccessLog,
    ThirdPartyClient,
    close_db,
    init_db,
)

from worker.config import load_settings
from worker.couch.client import CouchClient
from worker.masking import shelter_db_name

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("e2e-partner-janitor")

NAME_PREFIX = "E2E "
DEFAULT_MAX_AGE_HOURS = 6
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


@dataclass
class ClientReport:
    name: str
    client_id: str
    age_hours: float
    skipped: bool = False
    revoked: bool = False
    idempotency: int = 0
    access_logs: int = 0
    bookings: int = 0
    client_deleted: bool = False
    in_flight: int = 0
    stranded: int = 0
    error: str | None = None


@dataclass
class JanitorReport:
    clients: list[ClientReport] = field(default_factory=list)

    @property
    def failed(self) -> bool:
        return any(c.error for c in self.clients)


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


_IN_FLIGHT_CLAUSES: list[dict] = [
    {"state": "pending"},
    {"committed": False},
    {"cancel_requested": True},
    {
        "state": {"$in": ["cancelled", "rejected"]},
        "reconciled_at": None,
        "$or": [{"evacuee_id": {"$ne": None}}, {"household_id": {"$ne": None}}],
    },
]


def _in_flight_filter(client_id: str) -> dict:
    """Rows the worker may still be writing (no age exception: the client is skipped)."""
    return {"client_id": client_id, "$or": _IN_FLIGHT_CLAUSES}


async def _shelter_is_gone(
    couch: CouchClient | None, shelter_code: str, cache: dict[str, bool]
) -> bool:
    """True only on a read-only CouchDB 404 for ``shelter_<code>``.

    No CouchDB client, an auth failure or any error means "still exists" (never delete on doubt).
    """
    if couch is None:
        return False
    if shelter_code not in cache:
        try:
            cache[shelter_code] = await couch.database_missing(
                shelter_db_name(shelter_code)
            )
        except Exception:  # noqa: BLE001 - any failure to check must mean "still exists"
            cache[shelter_code] = False
    return cache[shelter_code]


async def _stranded_ids(
    in_flight: list[ExternalBooking],
    *,
    cutoff: datetime,
    couch: CouchClient | None,
    cache: dict[str, bool],
) -> list[str] | None:
    """Ids of in-flight rows if ALL are garbage (shelter DB gone and row old), else None."""
    ids: list[str] = []
    for row in in_flight:
        stamp = _as_utc(row.updated_at or row.created_at)
        if stamp >= cutoff or not await _shelter_is_gone(
            couch, row.shelter_code, cache
        ):
            return None
        ids.append(row.id)
    return ids


async def _process_client(
    client: ThirdPartyClient,
    *,
    execute: bool,
    now: datetime,
    cutoff: datetime,
    couch: CouchClient | None,
    cache: dict[str, bool],
) -> ClientReport:
    client_id = client.client_id
    report = ClientReport(
        name=client.name or "",
        client_id=client_id,
        age_hours=(now - _as_utc(client.created_at)).total_seconds() / 3600,
    )

    bookings = ExternalBooking.get_pymongo_collection()
    idempotency = ExternalBookingIdempotency.get_pymongo_collection()
    access_logs = ThirdPartyAccessLog.get_pymongo_collection()
    clients = ThirdPartyClient.get_pymongo_collection()

    try:
        in_flight = await ExternalBooking.find(_in_flight_filter(client_id)).to_list()
        stranded: list[str] = []
        if in_flight:
            ids = await _stranded_ids(
                in_flight, cutoff=cutoff, couch=couch, cache=cache
            )
            if ids is None:
                report.skipped = True
                report.in_flight = len(in_flight)
                return report
            stranded = ids
        report.stranded = len(stranded)
        # Terminal rows plus the stranded in-flight rows proved garbage above.
        deletable = {
            "client_id": client_id,
            "$or": [{"$nor": _IN_FLIGHT_CLAUSES}, {"_id": {"$in": stranded}}],
        }

        report.idempotency = await idempotency.count_documents({"client_id": client_id})
        report.access_logs = await access_logs.count_documents({"client_id": client_id})
        report.bookings = await bookings.count_documents(deletable)
        if not execute:
            report.revoked = client.is_active
            report.client_deleted = True
            return report

        if client.is_active:
            await clients.update_one(
                {"_id": client.id},
                {"$set": {"is_active": False, "updated_at": now}},
            )
            report.revoked = True

        report.idempotency = (
            await idempotency.delete_many({"client_id": client_id})
        ).deleted_count
        report.access_logs = (
            await access_logs.delete_many({"client_id": client_id})
        ).deleted_count
        report.bookings = (await bookings.delete_many(deletable)).deleted_count

        # Keep the client row while any booking is left (one raced in mid-sweep): the next
        # run finds the client again.
        remaining = await bookings.count_documents({"client_id": client_id})
        if remaining:
            report.skipped = True
            report.in_flight = remaining
            return report
        await clients.delete_one({"_id": client.id})
        report.client_deleted = True
    except PyMongoError as exc:
        report.error = type(exc).__name__
    return report


async def run_janitor(
    *,
    execute: bool,
    max_age_hours: float,
    now: datetime | None = None,
    couch: CouchClient | None = None,
) -> JanitorReport:
    """Select stale ``E2E `` clients and sweep them. Beanie must be initialised.

    ``couch`` enables the stranded-row exception (read-only 404 checks); without it every
    in-flight booking skips its client.
    """
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(hours=max_age_hours)
    candidates = await ThirdPartyClient.find(
        {"name": {"$regex": "^E2E "}, "created_at": {"$lt": cutoff}}
    ).to_list()

    report = JanitorReport()
    cache: dict[str, bool] = {}
    # Re-check the prefix in Python: the regex is only a pre-filter, never the gate.
    for client in sorted(candidates, key=lambda c: c.created_at):
        if not (client.name or "").startswith(NAME_PREFIX):
            continue
        report.clients.append(
            await _process_client(
                client,
                execute=execute,
                now=now,
                cutoff=cutoff,
                couch=couch,
                cache=cache,
            )
        )
    return report


def _print_report(report: JanitorReport, *, execute: bool) -> None:
    verb = "deleted" if execute else "would delete"
    mode = "EXECUTE" if execute else "DRY-RUN (nothing will be deleted)"
    print(f"e2e-partner-janitor — {mode} — {len(report.clients)} client(s)\n")
    for c in report.clients:
        head = f"  {c.name} [{c.client_id}] age={c.age_hours:.1f}h"
        if c.error:
            print(f"{head} !! FAILED ({c.error})")
        elif c.skipped:
            print(
                f"{head} !! SKIPPED — {c.in_flight} booking(s) pending/cancel_requested/"
                "uncommitted/unreconciled; worker may still be writing"
            )
        else:
            revoke = ""
            if c.revoked:
                revoke = " revoke=yes" if execute else " revoke=would"
            print(
                f"{head}{revoke} {verb}: idempotency={c.idempotency} "
                f"access_logs={c.access_logs} bookings={c.bookings} client=1"
            )
            if c.stranded:
                print(
                    f"    of which {c.stranded} stranded booking(s) "
                    "(shelter database gone, older than age gate)"
                )
    skipped = sum(1 for c in report.clients if c.skipped and not c.error)
    failed = sum(1 for c in report.clients if c.error)
    done = sum(1 for c in report.clients if c.client_deleted and not c.error)
    stranded = sum(
        c.stranded for c in report.clients if c.client_deleted and not c.error
    )
    print("\nSummary")
    print(f"  clients {verb}: {done}")
    print(f"  stranded bookings {verb}: {stranded}")
    print(f"  clients skipped: {skipped}")
    print(f"  clients failed: {failed}")
    if not execute and report.clients:
        print("\nRe-run with --execute to delete.")


async def _run(args: argparse.Namespace) -> int:
    settings = load_settings()
    await init_db(settings.mongodb_uri)
    couch = CouchClient(settings)
    try:
        execute = bool(args.execute)
        report = await run_janitor(
            execute=execute, max_age_hours=args.max_age_hours, couch=couch
        )
        _print_report(report, execute=execute)
        return 1 if report.failed else 0
    except PyMongoError as exc:
        logger.error("janitor aborted: %s", type(exc).__name__)
        return 1
    finally:
        await couch.close()
        await close_db()


def _non_negative_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an integer") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be >= 0")
    return parsed


def is_local_mongo_uri(uri: str) -> bool:
    """True only when every host in the Mongo URI is local (never on doubt)."""
    if uri.startswith("mongodb+srv://"):
        return False  # SRV resolves hosts through DNS: not a local stack
    try:
        nodes = parse_uri(uri)["nodelist"]
    except Exception:  # noqa: BLE001 - an unparseable URI is not provably local
        return False
    return bool(nodes) and all(host.lower() in LOCAL_HOSTS for host, _port in nodes)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="e2e-partner-janitor",
        description="Delete stale 'E2E ' third-party clients and their Mongo leftovers",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="list what would be deleted (default)",
    )
    mode.add_argument(
        "--execute",
        action="store_true",
        help="actually delete (default is a dry run)",
    )
    parser.add_argument(
        "--max-age-hours",
        type=_non_negative_int,
        default=DEFAULT_MAX_AGE_HOURS,
        metavar="N",
        help=f"only clients created more than N hours ago (default {DEFAULT_MAX_AGE_HOURS}); "
        "0 selects every E2E client even a run in flight (LOCAL TESTING ONLY)",
    )
    args = parser.parse_args()
    if (
        args.execute
        and args.max_age_hours == 0
        and not is_local_mongo_uri(load_settings().mongodb_uri)
    ):
        parser.error(
            "--execute with --max-age-hours=0 would delete clients of an e2e run in "
            "flight and is allowed only when every DATABASE_URI host is local "
            "(localhost, 127.0.0.1, ::1); use a positive --max-age-hours, or --dry-run"
        )
    sys.exit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
