"""``donation-quota`` CLI — CR-047 §Migration & Maintenance.

Two subcommands over the same core (``worker.quota.reconcile``):

``backfill``      one-time pre-rollout: seed ``qty_target`` for every open campaign
                  (CR-060 FR-5) then set ``reserved_qty`` from the systems of record.
``recalculate``   DR / data-inconsistency tool: recompute ``reserved_qty`` only, leaving
                  ``qty_target`` untouched.

**Dry-run is the default.** Nothing is written without ``--apply``, and ``--apply``
refuses to run without ``--confirm-write-path-locked`` — the operator must state that the
public write path is quiesced (CR-047 §Cutover Lock). Even then every write carries an
optimistic filter on the value just read, so a booking that slips through is reported as
a conflict and the command exits non-zero instead of stomping the live count.

    uv run --project worker donation-quota backfill
    uv run --project worker donation-quota backfill --apply --confirm-write-path-locked
    uv run --project worker donation-quota recalculate --shelter SH001 --apply \
        --confirm-write-path-locked
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import UTC, datetime

from tent_model import DonationNeedCounter, close_db, init_db

from worker.config import load_settings
from worker.couch.client import CouchClient
from worker.masking import shelter_db_name
from worker.mongo import apply_need_counters
from worker.projectors.donation_need_counter import plan_need_counters
from worker.quota import ShelterReconcileReport, reconcile_shelter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("donation-quota")

REGISTRY_DB = "registry"


async def _all_shelter_codes(couch: CouchClient) -> list[str]:
    """Every shelter in the registry — including closed ones.

    Not ``bootstrap.list_open_shelter_codes``: a closed shelter can still own counters
    with reserved quota, and skipping it would leave them permanently unreconciled.
    """
    codes: set[str] = set()
    if await couch.database_exists(REGISTRY_DB):
        async for doc in couch.iter_all_docs(REGISTRY_DB):
            if doc.get("type") == "shelter" and doc.get("code"):
                codes.add(str(doc["code"]))
    # Counters may outlive their registry entry — never silently drop those.
    for existing in await DonationNeedCounter.distinct("shelter_code"):
        codes.add(str(existing))
    return sorted(codes)


async def _seed_open_campaigns(couch: CouchClient, shelter_code: str, *, apply: bool) -> int:
    database = shelter_db_name(shelter_code)
    if not await couch.database_exists(database):
        return 0

    planned = 0
    async for doc in couch.iter_all_docs(database):
        if doc.get("type") != "donation_campaign":
            continue
        seeds = plan_need_counters(doc, shelter_code=shelter_code)
        planned += len(seeds)
        if apply and seeds:
            await apply_need_counters(seeds)
    return planned


def _print_report(report: ShelterReconcileReport, *, apply: bool) -> None:
    verb = "would change" if not apply else "changed"
    print(
        f"  {report.shelter_code}: {report.donations_counted} donation(s) counted, "
        f"{report.counters_examined} counter(s), {len(report.changes)} {verb}"
    )
    for (campaign_id, item_id), before, after in report.changes:
        print(f"    {campaign_id} / {item_id}: reserved_qty {before} → {after}")
    for (campaign_id, item_id), qty in report.missing_counters:
        print(f"    + no counter yet: {campaign_id} / {item_id} outstanding qty {qty}")
    for campaign_id, item_id in report.conflicts:
        print(f"    !! CONFLICT {campaign_id} / {item_id} — raced a live booking, not written")
    for line in report.unattributed_items:
        print(f"    ~ unattributed (no counter): {line}")


async def _run(args: argparse.Namespace) -> int:
    settings = load_settings()
    await init_db(settings.mongodb_uri)
    couch = CouchClient(settings)
    now = datetime.now(UTC)
    apply = bool(args.apply)

    try:
        codes = args.shelter or await _all_shelter_codes(couch)
        if not codes:
            print("No shelters found — nothing to do.")
            return 0

        mode = "APPLY" if apply else "DRY-RUN (nothing will be written)"
        print(f"donation-quota {args.command} — {mode} — {len(codes)} shelter(s)\n")

        seeded_total = 0
        reports: list[ShelterReconcileReport] = []
        for code in codes:
            if args.command == "backfill":
                seeded_total += await _seed_open_campaigns(couch, code, apply=apply)
            report = await reconcile_shelter(couch, code, now=now, apply=apply)
            reports.append(report)
            _print_report(report, apply=apply)

        changed = sum(len(r.changes) for r in reports)
        conflicts = sum(r.counters_conflicted for r in reports)
        unattributed = sum(len(r.unattributed_items) for r in reports)

        print("\nSummary")
        if args.command == "backfill":
            print(f"  qty_target seeds planned: {seeded_total}")
        print(f"  reserved_qty {'changed' if apply else 'to change'}: {changed}")
        print(f"  conflicts: {conflicts}")
        print(f"  unattributed items (need manual review): {unattributed}")
        if not apply:
            print("\nRe-run with --apply --confirm-write-path-locked to write.")

        return 1 if conflicts else 0
    finally:
        await couch.close()
        await close_db()


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="donation-quota",
        description="Backfill / recalculate donation_need_counter (CR-047)",
    )
    parser.add_argument(
        "command",
        choices=("backfill", "recalculate"),
        help="backfill = seed qty_target then recompute reserved_qty; "
        "recalculate = recompute reserved_qty only",
    )
    parser.add_argument(
        "--shelter",
        action="append",
        metavar="CODE",
        help="limit to this shelter code (repeatable); default = every shelter",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="actually write (default is a dry run)",
    )
    parser.add_argument(
        "--confirm-write-path-locked",
        action="store_true",
        help="required with --apply: confirms the public donation write path is quiesced "
        "for this run (CR-047 Cutover Lock)",
    )
    args = parser.parse_args()

    if args.apply and not args.confirm_write_path_locked:
        parser.error(
            "--apply requires --confirm-write-path-locked. Stop the public write path "
            "(or run inside a maintenance window) before reconciling quota counters."
        )

    sys.exit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
