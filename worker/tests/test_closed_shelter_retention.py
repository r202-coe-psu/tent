"""CR-183: a closed shelter stays searchable until its retention deadline."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from unittest.mock import AsyncMock, call, patch

import pytest
from tent_model import (
    PublicNeed,
    PublicPerson,
    PublicShelter,
    RetentionAudit,
    ShelterOccupant,
    ShelterStock,
)

from worker.couch import bootstrap as bs
from worker.couch.bootstrap import list_listened_shelters
from worker.couch.processor import process_change
from worker.listeners.registry import ListenerManager
from worker.mongo import apply_shelter
from worker.projectors.shelter import (
    RetentionPhase,
    classify_retention,
    parse_retention_months,
    project_shelter,
)
from worker.retention.job import reconcile_closed_shelters, run_retention_once


def _registry_shelter(code: str, status: str, **extra) -> dict:
    return {
        "_id": f"shelter:{code}",
        "type": "shelter",
        "code": code,
        "operation_status": status,
        **extra,
    }


async def _insert_shelter(code: str, status: str, closed_at=None) -> None:
    await PublicShelter(
        id=code,
        shelter_code=code,
        registry_id=f"shelter:{code}",
        name=f"ศูนย์ {code}",
        status=status,
        location_status=status,
        capacity=10,
        closed_at=closed_at,
        updated_at=datetime.now(UTC),
    ).insert()


async def test_reopening_a_closed_shelter_rescans_its_database(db: None) -> None:
    await _insert_shelter("SH950", "closed", closed_at=datetime(2026, 9, 1, tzinfo=UTC))
    couch = AsyncMock()
    couch.database_exists.return_value = True
    change = {
        "seq": 1,
        "id": "shelter:SH950",
        "doc": _registry_shelter("SH950", "active"),
    }

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch(
            "worker.couch.bootstrap.bootstrap_database", new_callable=AsyncMock
        ) as bootstrap_db,
    ):
        await process_change(couch, "registry", change)

    bootstrap_db.assert_awaited_once_with(couch, "shelter_sh950")
    shelter = await PublicShelter.get("SH950")
    assert shelter is not None and shelter.status == "open"


def _seed_operations(code: str):
    now = datetime.now(UTC)
    return [
        PublicNeed(
            id=f"{code}:item:rice",
            shelter_code=code,
            item_name="ข้าวสาร",
            category="food",
            qty_needed=3.0,
            unit="kg",
            updated_at=now,
        ),
        ShelterStock(
            id=f"{code}:item_master:rice",
            shelter_code=code,
            item_id="item_master:rice",
            name_th="ข้าวสาร",
            type_code="food",
            unit_label="กก.",
            updated_at=now,
        ),
        ShelterOccupant(
            id=f"{code}:evacuee:01",
            shelter_code=code,
            occupant_ref="evacuee:01",
            name_masked="ส***",
            age_range="18-59",
            updated_at=now,
        ),
    ]


async def _insert_operations(code: str) -> None:
    for row in _seed_operations(code):
        await row.insert()


async def _operations_left(code: str) -> int:
    return sum(
        [
            await PublicNeed.find(PublicNeed.shelter_code == code).count(),
            await ShelterStock.find(ShelterStock.shelter_code == code).count(),
            await ShelterOccupant.find(ShelterOccupant.shelter_code == code).count(),
        ]
    )


async def _insert_person(code: str, person_id: str) -> None:
    await PublicPerson(
        id=person_id,
        shelter_code=code,
        first_name="สมชาย",
        last_name_masked="ใ***",
        status="active",
        updated_at=datetime.now(UTC),
    ).insert()


CLOSED_AT = datetime(2026, 6, 1, tzinfo=UTC)


@pytest.mark.parametrize(
    ("status", "closed_at", "now", "expected"),
    [
        ("active", None, CLOSED_AT, RetentionPhase.OPEN),
        ("standby", None, CLOSED_AT, RetentionPhase.OPEN),
        ("full", None, CLOSED_AT, RetentionPhase.OPEN),
        ("cancelled", None, CLOSED_AT, RetentionPhase.HIDDEN),
        (None, None, CLOSED_AT, RetentionPhase.HIDDEN),
        ("closed", None, CLOSED_AT, RetentionPhase.CLOSED_WITHOUT_DATE),
        (
            "closed",
            CLOSED_AT,
            datetime(2026, 8, 31, 23, 59, tzinfo=UTC),
            RetentionPhase.CLOSED_WITHIN_RETENTION,
        ),
        (
            "closed",
            CLOSED_AT,
            datetime(2026, 9, 1, tzinfo=UTC),
            RetentionPhase.CLOSED_EXPIRED,
        ),
        (
            "closed",
            CLOSED_AT.replace(tzinfo=None),
            datetime(2026, 9, 1, tzinfo=UTC),
            RetentionPhase.CLOSED_EXPIRED,
        ),
    ],
)
def test_classify_retention(status, closed_at, now, expected) -> None:
    phase = classify_retention(
        status=status, closed_at=closed_at, retention_months=3, now=now
    )
    assert phase is expected
    assert phase.is_bootstrapped is (
        expected in (RetentionPhase.OPEN, RetentionPhase.CLOSED_WITHIN_RETENTION)
    )
    assert phase.is_listened is (
        phase.is_bootstrapped or expected is RetentionPhase.CLOSED_WITHOUT_DATE
    )


@pytest.mark.parametrize(
    ("config_app", "expected"),
    [
        ({"retention_months_after_close": 6}, 6),
        ({"retention_months_after_close": 0}, 0),
        ({"retention_months_after_close": "6"}, 3),
        ({"retention_months_after_close": True}, 3),
        ({"retention_months_after_close": -1}, 3),
        ({}, 3),
        (None, 3),
    ],
)
def test_parse_retention_months_falls_back_to_three(config_app, expected) -> None:
    assert parse_retention_months(config_app) == expected


async def test_retention_keeps_persons_until_the_deadline_then_deletes_with_audit(
    db: None,
) -> None:
    await _insert_shelter("SH951", "closed", closed_at=CLOSED_AT)
    await _insert_person("SH951", "evacuee:p1")
    await _insert_person("SH951", "evacuee:p2")
    await _insert_operations("SH951")

    await reconcile_closed_shelters(
        "run-before", retention_months=3, now=datetime(2026, 8, 31, tzinfo=UTC)
    )

    assert await PublicPerson.find(PublicPerson.shelter_code == "SH951").count() == 2
    assert await _operations_left("SH951") == 0

    await reconcile_closed_shelters(
        "run-after", retention_months=3, now=datetime(2026, 9, 1, tzinfo=UTC)
    )

    assert await PublicPerson.find(PublicPerson.shelter_code == "SH951").count() == 0
    audits = await RetentionAudit.find(
        RetentionAudit.target_collection == "public_persons"
    ).to_list()
    assert sorted(a.target_id for a in audits) == ["evacuee:p1", "evacuee:p2"]
    assert {a.status for a in audits} == {"verified"}
    assert {a.trigger for a in audits} == {"scheduled"}
    assert audits[0].couchdb_ref == {"db": "registry", "doc_id": "shelter:SH951"}
    shelter = await PublicShelter.get("SH951")
    assert shelter is not None and shelter.status == "closed"


async def test_retention_keeps_persons_of_a_closed_shelter_without_closed_at(
    db: None, caplog: pytest.LogCaptureFixture
) -> None:
    await _insert_shelter("SH952", "closed", closed_at=None)
    await _insert_person("SH952", "evacuee:p3")

    with caplog.at_level(logging.WARNING, logger="worker.retention.job"):
        await reconcile_closed_shelters(
            "run-null", retention_months=0, now=datetime(2030, 1, 1, tzinfo=UTC)
        )

    assert await PublicPerson.get("evacuee:p3") is not None
    assert "SH952" in caplog.text
    assert await RetentionAudit.find_all().count() == 0


async def test_retention_leaves_open_shelters_alone(db: None) -> None:
    await _insert_shelter("SH953", "open")
    await _insert_person("SH953", "evacuee:p4")
    await _insert_operations("SH953")

    await reconcile_closed_shelters(
        "run-open", retention_months=0, now=datetime(2030, 1, 1, tzinfo=UTC)
    )

    assert await PublicPerson.get("evacuee:p4") is not None
    assert await _operations_left("SH953") == 3


async def test_retention_cycle_reads_the_months_from_registry_config(db: None) -> None:
    await _insert_shelter("SH954", "closed", closed_at=datetime(2020, 1, 1, tzinfo=UTC))
    await _insert_person("SH954", "evacuee:p5")
    couch = AsyncMock()
    couch.get_doc.return_value = {
        "_id": "config:app",
        "retention_months_after_close": 1200,
    }

    with (
        patch("worker.retention.job.expire_declared_donations", new_callable=AsyncMock),
        patch(
            "worker.retention.job.sweep_orphan_donation_photos", new_callable=AsyncMock
        ),
    ):
        await run_retention_once(couch)

    couch.get_doc.assert_awaited_once_with("registry", "config:app")
    assert await PublicPerson.get("evacuee:p5") is not None


async def test_closing_a_shelter_drops_operations_and_keeps_row_and_persons(
    db: None,
) -> None:
    await _insert_shelter("SH955", "open")
    await _insert_person("SH955", "evacuee:p6")
    await _insert_operations("SH955")
    change = {
        "seq": 2,
        "id": "shelter:SH955",
        "doc": _registry_shelter("SH955", "closed", closed_at="2026-10-01T00:00:00Z"),
    }

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch(
            "worker.couch.bootstrap.bootstrap_database", new_callable=AsyncMock
        ) as bootstrap_db,
    ):
        await process_change(AsyncMock(), "registry", change)

    shelter = await PublicShelter.get("SH955")
    assert shelter is not None
    assert shelter.status == "closed"
    assert shelter.closed_at is not None
    assert await PublicPerson.get("evacuee:p6") is not None
    assert await _operations_left("SH955") == 0
    bootstrap_db.assert_not_awaited()
    audits = await RetentionAudit.find_all().to_list()
    assert sorted((a.target_collection, a.target_id) for a in audits) == [
        ("public_needs", "SH955:item:rice"),
        ("shelter_occupants", "SH955:evacuee:01"),
        ("shelter_stocks", "SH955:item_master:rice"),
    ]
    assert {(a.status, a.trigger) for a in audits} == {("verified", "shelter_closed")}


async def test_closed_shelter_opt_out_removes_the_person_without_rebuilding_operations(
    db: None,
) -> None:
    await _insert_shelter("SH956", "closed", closed_at=CLOSED_AT)
    await _insert_person("SH956", "evacuee:p7")
    change = {
        "seq": 3,
        "id": "evacuee:p7",
        "doc": {
            "_id": "evacuee:p7",
            "type": "evacuee",
            "privacy": {"search_excluded": True},
        },
    }

    with (
        patch(
            "worker.couch.processor.save_checkpoint", new_callable=AsyncMock
        ) as save_cp,
        patch(
            "worker.couch.processor.refresh_shelter_occupants", new_callable=AsyncMock
        ) as refresh_occupants,
        patch(
            "worker.couch.processor.refresh_occupancy", new_callable=AsyncMock
        ) as refresh_occupancy,
    ):
        await process_change(AsyncMock(), "shelter_sh956", change)

    assert await PublicPerson.get("evacuee:p7") is None
    refresh_occupants.assert_not_awaited()
    refresh_occupancy.assert_not_awaited()
    save_cp.assert_awaited_once_with("shelter_sh956", 3)


async def test_opt_out_in_a_closed_shelter_without_closed_at_removes_the_person(
    db: None,
) -> None:
    await _insert_shelter("SH959", "closed", closed_at=None)
    await _insert_person("SH959", "evacuee:p8")
    change = {
        "seq": 5,
        "id": "evacuee:p8",
        "doc": {
            "_id": "evacuee:p8",
            "type": "evacuee",
            "privacy": {"search_excluded": True},
        },
    }

    with patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock):
        await process_change(AsyncMock(), "shelter_sh959", change)

    assert await PublicPerson.get("evacuee:p8") is None


def _evacuee_change(person_id: str, stay_status: str) -> dict:
    return {
        "seq": 6,
        "id": person_id,
        "doc": {
            "_id": person_id,
            "type": "evacuee",
            "first_name": "สมชาย",
            "last_name": "ใจดี",
            "current_stay": {"status": stay_status},
        },
    }


@pytest.mark.parametrize("closed_at", [None, CLOSED_AT])
async def test_closed_shelter_change_never_republishes_a_removed_person(
    db: None, closed_at: datetime | None
) -> None:
    """A replay from an old checkpoint must not undo the retention delete."""
    await _insert_shelter("SH960", "closed", closed_at=closed_at)

    with patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock):
        await process_change(
            AsyncMock(), "shelter_sh960", _evacuee_change("evacuee:gone", "checked_out")
        )

    assert await PublicPerson.get("evacuee:gone") is None


async def test_closed_shelter_change_updates_a_person_still_published(db: None) -> None:
    await _insert_shelter("SH961", "closed", closed_at=None)
    await _insert_person("SH961", "evacuee:p9")

    with patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock):
        await process_change(
            AsyncMock(), "shelter_sh961", _evacuee_change("evacuee:p9", "checked_out")
        )

    person = await PublicPerson.get("evacuee:p9")
    assert person is not None
    assert person.status == "checked_out"


async def test_closed_shelter_ignores_operational_changes(db: None) -> None:
    await _insert_shelter("SH957", "closed", closed_at=CLOSED_AT)
    change = {
        "seq": 4,
        "id": "stock_ledger:01",
        "doc": {"_id": "stock_ledger:01", "type": "stock_ledger", "reason": "donation"},
    }

    with (
        patch("worker.couch.processor.save_checkpoint", new_callable=AsyncMock),
        patch(
            "worker.couch.processor.refresh_shelter_stock", new_callable=AsyncMock
        ) as refresh_stock,
    ):
        await process_change(AsyncMock(), "shelter_sh957", change)

    refresh_stock.assert_not_awaited()


def _registry_couch(docs: list[dict], config_app: dict | None = None) -> AsyncMock:
    async def iter_all_docs(_database):
        for doc in docs:
            yield doc

    couch = AsyncMock()
    couch.database_exists = AsyncMock(return_value=True)
    couch.iter_all_docs = iter_all_docs
    couch.get_doc = AsyncMock(return_value=config_app)
    return couch


REGISTRY_DOCS = [
    _registry_shelter("SH001", "active"),
    _registry_shelter("SH002", "closed", closed_at="2026-10-01T00:00:00Z"),
    _registry_shelter("SH003", "closed", closed_at="2026-01-01T00:00:00Z"),
    _registry_shelter("SH004", "closed"),
    _registry_shelter("SH005", "cancelled"),
    {"_id": "config:app", "type": "config"},
]


async def test_listened_shelters_include_closed_without_date_but_not_expired() -> None:
    couch = _registry_couch(REGISTRY_DOCS, {"retention_months_after_close": 3})

    listened = await list_listened_shelters(
        couch, now=datetime(2026, 10, 25, tzinfo=UTC)
    )

    assert listened == {
        "SH001": RetentionPhase.OPEN,
        "SH002": RetentionPhase.CLOSED_WITHIN_RETENTION,
        "SH004": RetentionPhase.CLOSED_WITHOUT_DATE,
    }


async def test_listened_shelters_follow_the_configured_months() -> None:
    couch = _registry_couch(REGISTRY_DOCS, {"retention_months_after_close": 12})

    listened = await list_listened_shelters(
        couch, now=datetime(2026, 10, 25, tzinfo=UTC)
    )

    assert set(listened) == {"SH001", "SH002", "SH003", "SH004"}


async def test_bootstrap_all_scans_closed_shelters_for_persons_only() -> None:
    listened = {
        "SH001": RetentionPhase.OPEN,
        "SH002": RetentionPhase.CLOSED_WITHIN_RETENTION,
        "SH004": RetentionPhase.CLOSED_WITHOUT_DATE,
    }
    with (
        patch.object(bs, "bootstrap_database", new_callable=AsyncMock) as scan,
        patch.object(
            bs, "list_listened_shelters", new_callable=AsyncMock, return_value=listened
        ),
        patch.object(bs, "save_projection_version", new_callable=AsyncMock),
        patch.object(
            bs,
            "list_all_shelter_codes",
            new_callable=AsyncMock,
            return_value=["SH001", "SH002", "SH003", "SH004"],
        ),
        patch.object(bs, "refresh_occupancy", new_callable=AsyncMock) as occupancy,
        patch.object(
            bs, "refresh_shelter_occupants", new_callable=AsyncMock
        ) as occupants,
    ):
        couch = AsyncMock()
        await bs.bootstrap_all(couch)

    assert scan.await_args_list == [
        call(couch, "registry"),
        call(couch, "shelter_sh001", persons_only=False),
        call(couch, "shelter_sh002", persons_only=True),
    ]
    assert occupancy.await_args_list == [
        call(couch, "SH002"),
        call(couch, "SH003"),
        call(couch, "SH004"),
    ]
    occupants.assert_not_awaited()


async def test_bootstrap_persons_only_skips_operational_docs() -> None:
    docs = [
        {"_id": "evacuee:01", "type": "evacuee"},
        {"_id": "donation:01", "type": "donation"},
    ]
    couch = _registry_couch(docs)
    couch.db_update_seq = AsyncMock(return_value="9-x")

    with (
        patch.object(bs, "save_checkpoint", new_callable=AsyncMock) as save_cp,
        patch.object(bs, "apply_person", new_callable=AsyncMock) as apply_person,
        patch.object(bs, "apply_donation", new_callable=AsyncMock) as apply_donation,
        patch.object(
            bs, "refresh_shelter_occupants", new_callable=AsyncMock
        ) as occupants,
        patch.object(bs, "refresh_shelter_stock", new_callable=AsyncMock) as stock,
    ):
        await bs.bootstrap_database(couch, "shelter_sh002", persons_only=True)

    assert apply_person.await_count == 1
    apply_donation.assert_not_awaited()
    occupants.assert_not_awaited()
    stock.assert_not_awaited()
    save_cp.assert_awaited_once_with("shelter_sh002", "9-x")


async def test_listener_tails_every_listened_shelter() -> None:
    manager = ListenerManager(AsyncMock())
    with (
        patch(
            "worker.listeners.registry.list_listened_shelters",
            new_callable=AsyncMock,
            return_value={
                "SH001": RetentionPhase.OPEN,
                "SH002": RetentionPhase.CLOSED_WITHIN_RETENTION,
                "SH004": RetentionPhase.CLOSED_WITHOUT_DATE,
            },
        ),
        patch.object(manager, "ensure_listener", new_callable=AsyncMock) as ensure,
    ):
        await manager.sync_shelter_listeners()

    assert sorted(c.args[0] for c in ensure.await_args_list) == [
        "shelter_sh001",
        "shelter_sh002",
        "shelter_sh004",
    ]


async def test_unparseable_closed_at_keeps_the_projected_value(
    db: None, caplog: pytest.LogCaptureFixture
) -> None:
    await _insert_shelter("SH958", "closed", closed_at=CLOSED_AT)
    doc = _registry_shelter("SH958", "closed", closed_at="not-a-date")

    with caplog.at_level(logging.ERROR, logger="worker.projectors.shelter"):
        action, payload = project_shelter(doc)
        await apply_shelter(action, payload)

    assert payload is not None and "closed_at" not in payload
    assert "SH958" in caplog.text
    shelter = await PublicShelter.get("SH958")
    assert shelter is not None
    assert shelter.closed_at is not None
    assert shelter.closed_at.replace(tzinfo=UTC) == CLOSED_AT
