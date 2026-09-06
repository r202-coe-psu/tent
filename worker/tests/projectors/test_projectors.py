import hashlib
from decimal import Decimal

from worker.masking import (
    mask_last_name,
    mask_national_id,
    mask_passport,
    national_id_hash,
    passport_hash,
    phone_hash,
    sha256_hex,
    shelter_code_from_db_name,
)
from worker.projectors.compute_needs import compute_needs
from worker.projectors.donation_need_counter import plan_need_counters
from worker.projectors.evacuee import project_evacuee
from worker.projectors.occupancy import aggregate_occupancy
from worker.projectors.shelter import (
    is_shelter_open,
    map_public_shelter_status,
    project_shelter,
    resolve_site_kind,
)
from worker.projectors.stock import (
    calculate_reorder_threshold,
    category_to_type_code,
    compute_shelter_stocks,
    resolve_reorder_threshold,
)


def test_sha256_hex_matches_frontend_contract():
    assert sha256_hex("0811111111") == hashlib.sha256(b"0811111111").hexdigest()


def test_mask_last_name_long_thai():
    assert mask_last_name("ประเสริฐ") == "ปร****ริฐ"


def test_mask_last_name_short():
    assert mask_last_name("ดี") == "ดี****"


def test_mask_national_id_thirteen_digits():
    assert mask_national_id("3900100244192") == "390-XXXX-XX-192"


def test_phone_hash_none_for_missing():
    assert phone_hash(None) is None


def test_phone_hash_normalizes_formatting():
    assert phone_hash("081-111-1111") == sha256_hex("0811111111")
    assert phone_hash("+66811111111") == sha256_hex("0811111111")


def test_shelter_code_from_db_name():
    assert shelter_code_from_db_name("shelter_sh001") == "SH001"


def test_project_shelter_v1_open():
    doc = {
        "_id": "shelter:01TEST",
        "type": "shelter",
        "code": "SH001",
        "name": "ศูนย์ทดสอบ",
        "operation_status": "active",
        "capacity": 200,
        "location": {"lat": 7.0, "lng": 100.5},
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_shelter(doc)
    assert action == "upsert"
    assert payload is not None
    assert payload["_id"] == "SH001"
    assert payload["status"] == "open"
    assert payload["location_status"] == "open"
    assert payload["registry_id"] == "shelter:01TEST"
    assert payload["capacity"] == 200
    assert payload["geo"] == {"lat": 7.0, "lng": 100.5}
    assert payload["location"] == {"type": "Point", "coordinates": [100.5, 7.0]}
    assert payload["site_kind"] == "evacuation_center"
    assert payload["is_active"] is True
    assert payload["location_type"] == "shelter"
    assert "national_id" not in payload


def test_project_shelter_preserves_host_house_site_kind():
    action, payload = project_shelter(
        {
            "type": "shelter",
            "code": "SH002",
            "name": "บ้านทดสอบ",
            "site_kind": "host_house",
            "operation_status": "active",
            "updated_at": "2026-01-01T00:00:00.000Z",
        }
    )
    assert action == "upsert"
    assert payload is not None
    assert payload["site_kind"] == "host_house"


def test_resolve_site_kind_defaults_unknown_values_to_evacuation_center():
    assert resolve_site_kind({}) == "evacuation_center"
    assert resolve_site_kind({"site_kind": "host"}) == "evacuation_center"


def test_project_shelter_closed_soft_retains():
    """Partner ODT ("Soft Delete" / "State Separation") — a routine close is an
    Operational Status change only; it must never remove the row or flip `is_active`."""
    doc = {
        "type": "shelter",
        "code": "SH001",
        "name": "ศูนย์ทดสอบ",
        "operation_status": "closed",
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_shelter(doc)
    assert action == "upsert"
    assert payload is not None
    assert payload["status"] == "closed"
    assert payload["location_status"] == "closed"
    assert payload["is_active"] is True


def test_project_shelter_malformed_doc_deletes():
    """Only malformed/non-shelter docs hard-delete here — the true archive signal (a
    CouchDB tombstone) is handled separately via `apply_shelter_deactivate`."""
    assert project_shelter({"type": "household"}) == ("delete", None)
    assert project_shelter({"type": "shelter"}) == ("delete", None)


def test_compose_address_prefers_structured_fields_over_legacy():
    from worker.projectors.shelter import compose_address

    assert (
        compose_address(
            {
                "address_no": "99/1",
                "subdistrict": "หาดใหญ่",
                "district": "หาดใหญ่",
                "province": "สงขลา",
            }
        )
        == "99/1 ต.หาดใหญ่ อ.หาดใหญ่ จ.สงขลา"
    )
    assert (
        compose_address({"location": {"address": "legacy address"}}) == "legacy address"
    )
    assert compose_address({}) is None


def test_map_public_shelter_status():
    assert map_public_shelter_status({"operation_status": "full_capacity"}) == "full"
    assert map_public_shelter_status({"operation_status": "active"}) == "open"
    assert map_public_shelter_status({"operation_status": "standby"}) == "standby"
    assert map_public_shelter_status({"operation_status": "closed"}) == "closed"


def test_project_shelter_standby_keeps_status():
    action, payload = project_shelter(
        {
            "_id": "shelter:01STANDBY",
            "type": "shelter",
            "code": "SH001",
            "name": "ศูนย์สแตนด์บาย",
            "operation_status": "standby",
            "capacity": 100,
            "updated_at": "2026-01-01T00:00:00.000Z",
        }
    )
    assert action == "upsert"
    assert payload is not None
    assert payload["status"] == "standby"
    assert payload["location_status"] == "standby"
    assert payload["is_active"] is True


def test_is_shelter_open_variants():
    assert is_shelter_open({"operation_status": "active"}) is True
    assert is_shelter_open({"operation_status": "standby"}) is True
    assert is_shelter_open({"status": "open"}) is True
    assert is_shelter_open({"operation_status": "closed"}) is False


def test_project_evacuee_maps_person_id_and_masked_fields():
    doc = {
        "_id": "evacuee:01TEST",
        "type": "evacuee",
        "first_name": "สมชาย",
        "last_name": "ใจดี",
        "phone": "0811111111",
        "gender": "male",
        "person_id": {"cardType": "national_id", "number": "3900100244192"},
        "household_id": "household:01HH",
        "current_stay": {
            "status": "active",
            "zone": "โซนที่ General",
            "since": "2026-01-01T00:00:00.000Z",
        },
        "privacy": {"search_excluded": False},
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    household = {
        "subdistrict": "หาดใหญ่",
        "district": "หาดใหญ่",
        "province": "สงขลา",
    }
    action, payload = project_evacuee(doc, shelter_code="SH001", household=household)
    assert action == "upsert"
    assert payload is not None
    assert payload["first_name"] == "สมชาย"
    assert payload["last_name_masked"] == mask_last_name("ใจดี")
    assert payload["national_id_hash"] == national_id_hash("3900100244192")
    assert payload["national_id_masked"] == mask_national_id("3900100244192")
    assert payload["phone_hash"] == sha256_hex("0811111111")
    assert payload["gender"] == "male"
    assert payload["care_zone"] == "โซนที่ General"
    assert payload["household_id"] == "household:01HH"
    assert payload["address_masked"].startswith("**/*")
    assert "last_name" not in payload
    assert "phone" not in payload


def test_project_evacuee_passport():
    doc = {
        "_id": "evacuee:02TEST",
        "type": "evacuee",
        "first_name": "John",
        "last_name": "Doe",
        "person_id": {"cardType": "passport", "number": "AB1234567"},
        "current_stay": {"status": "pre_registered"},
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_evacuee(doc, shelter_code="SH001")
    assert action == "upsert"
    assert payload is not None
    assert payload["passport_hash"] == passport_hash("AB1234567")
    assert payload["passport_id_masked"] == mask_passport("AB1234567")


def test_project_evacuee_pink_card_hashes_national_id_field():
    doc = {
        "_id": "evacuee:03PINK",
        "type": "evacuee",
        "first_name": "สมหญิง",
        "last_name": "ใจดี",
        "person_id": {"cardType": "pink_card", "number": "3900100244192"},
        "current_stay": {"status": "active"},
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_evacuee(doc, shelter_code="SH001")
    assert action == "upsert"
    assert payload is not None
    assert payload["national_id_hash"] == national_id_hash("3900100244192")
    assert payload["national_id_masked"] == mask_national_id("3900100244192")


def test_project_evacuee_other_card_hashes_national_id_field():
    doc = {
        "_id": "evacuee:04OTHER",
        "type": "evacuee",
        "first_name": "สมปอง",
        "last_name": "ใจดี",
        "person_id": {"cardType": "other", "number": "DOC-999"},
        "current_stay": {"status": "active"},
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_evacuee(doc, shelter_code="SH001")
    assert action == "upsert"
    assert payload is not None
    assert payload["national_id_hash"] == national_id_hash("DOC-999")
    assert payload["national_id_masked"] == mask_national_id("DOC-999")


def test_project_evacuee_search_excluded_deletes():
    doc = {
        "_id": "evacuee:01OPT",
        "type": "evacuee",
        "first_name": "ลับ",
        "last_name": "ลับ",
        "privacy": {"search_excluded": True},
        "current_stay": {"status": "active"},
        "updated_at": "2026-01-01T00:00:00.000Z",
    }
    action, payload = project_evacuee(doc, shelter_code="SH001")
    assert action == "delete"
    assert payload == {"_id": "evacuee:01OPT"}


def test_compute_needs_aggregates_campaign_minus_donations():
    campaigns = [
        {
            "_id": "donation_campaign:01",
            "needs": [{"item_id": "item:rice", "qty_target": "10"}],
        }
    ]
    donations = [
        {
            "campaign_id": "donation_campaign:01",
            "status": "declared",
            "items": [{"item_id": "item:rice", "qty": "3"}],
        }
    ]
    remaining, item_campaign = compute_needs(campaigns, donations)
    assert remaining["item:rice"] == "7.0"
    assert item_campaign["item:rice"] == "donation_campaign:01"


# --- CR-060: plan_need_counters (pure) ---


def _campaign(**overrides):
    doc = {
        "_id": "donation_campaign:01",
        "type": "donation_campaign",
        "status": "open",
        "needs": [
            {"item_id": "item:rice", "qty_target": "10"},
            {"item_id": "item:water", "qty_target": 25},
        ],
    }
    doc.update(overrides)
    return doc


def test_plan_need_counters_one_seed_per_need():
    seeds = plan_need_counters(_campaign(), shelter_code="SH001")
    assert [(s.item_id, s.qty_target) for s in seeds] == [
        ("item:rice", Decimal(10)),
        ("item:water", Decimal(25)),
    ]
    assert {s.shelter_code for s in seeds} == {"SH001"}
    assert {s.campaign_id for s in seeds} == {"donation_campaign:01"}


def test_plan_need_counters_skips_closed_campaign():
    # FR-4: closed campaign yields no plan, so existing counters are never touched.
    assert plan_need_counters(_campaign(status="closed"), shelter_code="SH001") == []


def test_plan_need_counters_ignores_other_doc_types():
    assert plan_need_counters(_campaign(type="supply_item"), shelter_code="SH001") == []


def test_plan_need_counters_skips_unusable_needs():
    campaign = _campaign(
        needs=[
            {"qty_target": "5"},  # no item_id
            {"item_id": "item:rice"},  # qty_target missing
            {"item_id": "item:soap", "qty_target": "abc"},  # unparseable
            {"item_id": "item:blanket", "qty_target": "-3"},  # bad data
            {"item_id": "item:egg", "qty_target": "0"},  # kept: "งดรับ" must block
        ]
    )
    seeds = plan_need_counters(campaign, shelter_code="SH001")
    assert [(s.item_id, s.qty_target) for s in seeds] == [("item:egg", Decimal(0))]


def test_plan_need_counters_dedups_repeated_item():
    campaign = _campaign(
        needs=[
            {"item_id": "item:rice", "qty_target": "10"},
            {"item_id": "item:rice", "qty_target": "99"},
        ]
    )
    seeds = plan_need_counters(campaign, shelter_code="SH001")
    assert [(s.item_id, s.qty_target) for s in seeds] == [("item:rice", Decimal(10))]


# --- needs[].status closed — must mirror the TS computeNeeds (T-22 §1.6, CR-052) ---


def _open_campaign(campaign_id: str, needs: list[dict]) -> dict:
    return {
        "_id": campaign_id,
        "type": "donation_campaign",
        "status": "open",
        "needs": needs,
    }


def test_compute_needs_reports_a_closed_need_as_taking_nothing():
    remaining, _ = compute_needs(
        [
            _open_campaign(
                "c1",
                [{"item_id": "item:rice", "qty_target": "100", "status": "closed"}],
            )
        ],
        [],
    )
    assert remaining["item:rice"] == "0.0"


def test_compute_needs_keeps_a_closed_need_in_the_map():
    """A missing key reads as "not tracked" downstream and lets the booking through."""
    remaining, _ = compute_needs(
        [
            _open_campaign(
                "c1",
                [{"item_id": "item:rice", "qty_target": "100", "status": "closed"}],
            )
        ],
        [],
    )
    assert "item:rice" in remaining


def test_compute_needs_ignores_donations_against_a_closed_need():
    remaining, _ = compute_needs(
        [
            _open_campaign(
                "c1",
                [{"item_id": "item:rice", "qty_target": "100", "status": "closed"}],
            )
        ],
        [
            {
                "campaign_id": "c1",
                "status": "declared",
                "items": [{"item_id": "item:rice", "qty": "30"}],
            }
        ],
    )
    assert remaining["item:rice"] == "0.0"


def test_compute_needs_still_offers_an_item_another_campaign_has_open():
    remaining, item_campaign = compute_needs(
        [
            _open_campaign(
                "c1",
                [{"item_id": "item:rice", "qty_target": "100", "status": "closed"}],
            ),
            _open_campaign("c2", [{"item_id": "item:rice", "qty_target": "40"}]),
        ],
        [],
    )
    assert remaining["item:rice"] == "40.0"
    # Binding to the closed campaign would hand the donation to a counter with room
    # while the campaign that can actually take it goes unused.
    assert item_campaign["item:rice"] == "c2"


# --- on-hand stock (T-22 cut-off) — ต้องตรงกับ TS compute-needs.test.ts เคสต่อเคส ---


def _ledger(item_id: str, qty: str, reason: str = "donation", ref_id=None) -> dict:
    return {
        "type": "stock_ledger",
        "item_id": item_id,
        "qty": qty,
        "reason": reason,
        "ref_id": ref_id,
    }


def _don(did: str, campaign_id, status: str, item_id: str, qty: str) -> dict:
    return {
        "_id": did,
        "type": "donation",
        "campaign_id": campaign_id,
        "status": status,
        "items": [{"item_id": item_id, "qty": qty}],
    }


def test_compute_needs_counts_what_the_warehouse_holds():
    """540 kg on the shelf against a 500 kg target is not "ด่วน! ขาด 450"."""
    remaining, _ = compute_needs(
        [_open_campaign("c1", [{"item_id": "item:rice", "qty_target": "500"}])],
        [],
        [_ledger("item:rice", "540")],
    )
    assert remaining["item:rice"] == "-40.0"


def test_compute_needs_adds_on_hand_and_reserved():
    remaining, _ = compute_needs(
        [_open_campaign("c1", [{"item_id": "item:rice", "qty_target": "500"}])],
        [_don("donation:1", "c1", "declared", "item:rice", "50")],
        [_ledger("item:rice", "300")],
    )
    assert remaining["item:rice"] == "150.0"


def test_compute_needs_does_not_double_count_a_ledgered_receipt():
    remaining, _ = compute_needs(
        [_open_campaign("c1", [{"item_id": "item:rice", "qty_target": "500"}])],
        [_don("donation:1", "c1", "received", "item:rice", "100")],
        [_ledger("item:rice", "100", ref_id="donation:1")],
    )
    assert remaining["item:rice"] == "400.0"


def test_compute_needs_still_owes_a_receipt_not_in_the_ledger():
    remaining, _ = compute_needs(
        [_open_campaign("c1", [{"item_id": "item:rice", "qty_target": "500"}])],
        [_don("donation:1", "c1", "received", "item:rice", "100")],
        [],
    )
    assert remaining["item:rice"] == "400.0"


def test_compute_needs_reopens_when_stock_is_issued_out():
    """T-22 "เปิดรับใหม่อัตโนมัติ" — distributing out is a negative ledger row."""
    remaining, _ = compute_needs(
        [_open_campaign("c1", [{"item_id": "item:rice", "qty_target": "500"}])],
        [],
        [
            _ledger("item:rice", "500"),
            _ledger("item:rice", "-120", reason="distribute"),
        ],
    )
    assert remaining["item:rice"] == "120.0"


def test_compute_needs_without_ledgers_behaves_as_before():
    remaining, _ = compute_needs(
        [_open_campaign("c1", [{"item_id": "item:rice", "qty_target": "500"}])],
        [_don("donation:1", "c1", "declared", "item:rice", "50")],
    )
    assert remaining["item:rice"] == "450.0"


# --- EXT-005: aggregate_occupancy (pure) ---


def _active_evacuee(**overrides) -> dict:
    doc = {
        "_id": "evacuee:01",
        "type": "evacuee",
        "gender": "male",
        "current_stay": {"status": "active"},
    }
    doc.update(overrides)
    return doc


def test_aggregate_occupancy_counts_only_active_evacuees():
    total, breakdown = aggregate_occupancy(
        [
            _active_evacuee(_id="e1"),
            {
                "_id": "e2",
                "type": "evacuee",
                "gender": "female",
                "current_stay": {"status": "checked_out"},
            },
            {
                "_id": "e3",
                "type": "evacuee",
                "gender": "female",
                "current_stay": {"status": "pre_registered"},
            },
        ]
    )
    assert total == 1
    assert breakdown["male"] == 1
    assert breakdown["female"] == 0


def test_aggregate_occupancy_gender_split():
    total, breakdown = aggregate_occupancy(
        [
            _active_evacuee(_id="e1", gender="male"),
            _active_evacuee(_id="e2", gender="female"),
            _active_evacuee(_id="e3", gender="other"),
        ]
    )
    assert total == 3
    assert breakdown["male"] == 1
    assert breakdown["female"] == 1


def test_aggregate_occupancy_age_buckets():
    total, breakdown = aggregate_occupancy(
        [
            _active_evacuee(_id="e1", age=3),
            _active_evacuee(_id="e2", age=61),
            _active_evacuee(_id="e3", age=30),
        ]
    )
    assert total == 3
    assert breakdown["child_under_5"] == 1
    assert breakdown["elderly_over_60"] == 1


def test_aggregate_occupancy_special_needs_tags_are_case_insensitive():
    total, breakdown = aggregate_occupancy(
        [
            _active_evacuee(_id="e1", special_needs=["Pregnant"]),
            _active_evacuee(_id="e2", special_needs=["bedridden", "disabled"]),
        ]
    )
    assert total == 2
    assert breakdown["pregnant"] == 1
    assert breakdown["bedridden"] == 1
    assert breakdown["disabled"] == 1


def test_aggregate_occupancy_overlapping_groups_do_not_sum_to_total():
    """ODT EXT-005 note — breakdown groups may overlap and needn't sum to total."""
    total, breakdown = aggregate_occupancy(
        [
            _active_evacuee(
                _id="e1", age=61, gender="female", special_needs=["bedridden"]
            )
        ]
    )
    assert total == 1
    assert breakdown["female"] == 1
    assert breakdown["elderly_over_60"] == 1
    assert breakdown["bedridden"] == 1


def test_aggregate_occupancy_ignores_non_evacuee_docs_and_missing_age():
    total, breakdown = aggregate_occupancy(
        [
            {"_id": "x1", "type": "household"},
            _active_evacuee(_id="e1", age=None),
        ]
    )
    assert total == 1
    assert breakdown["child_under_5"] == 0
    assert breakdown["elderly_over_60"] == 0


def test_aggregate_occupancy_empty_list():
    total, breakdown = aggregate_occupancy([])
    assert total == 0
    assert breakdown == {
        "male": 0,
        "female": 0,
        "child_under_5": 0,
        "elderly_over_60": 0,
        "pregnant": 0,
        "bedridden": 0,
        "disabled": 0,
    }


# --- EXT-004/006: stock projector (pure) ---


def test_category_to_type_code_maps_known_categories():
    assert category_to_type_code("food") == "food"
    assert category_to_type_code("medicine") == "medication"
    assert category_to_type_code("medical equipment") == "medical-equipment"


def test_category_to_type_code_falls_back_to_genaral():
    """`genaral` (M6's own spelling) is the intentional catch-all — CR-109 / ADR 0002."""
    assert category_to_type_code("hygiene") == "genaral"
    assert category_to_type_code(None) == "genaral"
    assert category_to_type_code("") == "genaral"


def test_calculate_reorder_threshold_daily():
    # 100 occupants * 3 L/person/day * 2 days reserve = 600
    assert (
        calculate_reorder_threshold(
            100, consumption_rate="3", target_reserve_days=2, timeframe="daily"
        )
        == 600.0
    )


def test_calculate_reorder_threshold_weekly_divides_by_seven():
    assert (
        calculate_reorder_threshold(
            70, consumption_rate="7", target_reserve_days=1, timeframe="weekly"
        )
        == 70.0
    )


def test_calculate_reorder_threshold_missing_inputs_returns_none():
    assert (
        calculate_reorder_threshold(
            100, consumption_rate=None, target_reserve_days=2, timeframe=None
        )
        is None
    )
    assert (
        calculate_reorder_threshold(
            100, consumption_rate="3", target_reserve_days=None, timeframe=None
        )
        is None
    )


def test_resolve_reorder_threshold_override_reorder_level_wins_without_rate():
    threshold = resolve_reorder_threshold(
        occupancy=100,
        item={"consumption_rate": None, "target_reserve_days": None, "timeframe": None},
        override={
            "reorder_level": 50,
            "consumption_rate": None,
            "target_reserve_days": None,
        },
    )
    assert threshold == 50.0


def test_resolve_reorder_threshold_override_rate_takes_priority_over_reorder_level():
    threshold = resolve_reorder_threshold(
        occupancy=100,
        item={
            "consumption_rate": None,
            "target_reserve_days": None,
            "timeframe": "daily",
        },
        override={
            "reorder_level": 999,
            "consumption_rate": "1",
            "target_reserve_days": 2,
        },
    )
    assert threshold == 200.0


def test_resolve_reorder_threshold_falls_back_to_catalog_item_when_no_override():
    threshold = resolve_reorder_threshold(
        occupancy=100,
        item={"consumption_rate": "3", "target_reserve_days": 2, "timeframe": "daily"},
        override=None,
    )
    assert threshold == 600.0


def test_resolve_reorder_threshold_none_when_nothing_configured():
    assert (
        resolve_reorder_threshold(
            occupancy=100,
            item={
                "consumption_rate": None,
                "target_reserve_days": None,
                "timeframe": None,
            },
            override=None,
        )
        is None
    )


def test_compute_shelter_stocks_maps_fields_and_keeps_zero_balances():
    ledgers = [
        {"type": "stock_ledger", "item_id": "item:rice", "qty": "480"},
        {"type": "stock_ledger", "item_id": "item:blanket", "qty": "120"},
        {"type": "stock_ledger", "item_id": "item:soap", "qty": "10"},
        {"type": "stock_ledger", "item_id": "item:soap", "qty": "-10"},
    ]
    catalog = {
        "item:rice": {
            "name": "ข้าวสาร",
            "category": "food",
            "unit": "กก.",
            "sku": "GEN-005",
        },
        "item:blanket": {"name": "ผ้าห่ม", "category": None, "unit": "ผืน", "sku": None},
    }
    payloads = compute_shelter_stocks(ledgers, catalog, {}, occupancy=0)
    by_item = {p["item_id"]: p for p in payloads}

    assert by_item["item:rice"]["quantity_on_hand"] == 480.0
    assert by_item["item:rice"]["type_code"] == "food"
    assert by_item["item:rice"]["m6_item_code"] == "GEN-005"
    assert by_item["item:rice"]["m6_reference_id"] is None
    assert by_item["item:rice"]["source"] == "direct_donation"

    assert by_item["item:blanket"]["type_code"] == "genaral"
    assert by_item["item:blanket"]["name_th"] == "ผ้าห่ม"

    # Zero-balance items stay listed (unlike public_needs, which drops satisfied needs).
    assert by_item["item:soap"]["quantity_on_hand"] == 0.0
    assert (
        by_item["item:soap"]["name_th"] == "item:soap"
    )  # not in catalog — id fallback
