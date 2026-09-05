---
id: 
title: Partner API EXT-004–007 — stock, occupancy, summary, occupant scaffold
status: proposed
date: 2026-09-05
requested_by: dev Team-B
decided_by:
layer: volatile
affects:
  - packages/tent-model/src/tent_model/public_shelter.py (new field: occupancy_breakdown)
  - packages/tent-model/src/tent_model/shelter_stock.py (new collection)
  - packages/tent-model/src/tent_model/third_party_access_log.py (new collection)
  - docs/data/schema.md §9 (new §9.3, §9.4; extend §9.1)
---

# Partner API EXT-004–007 — stock, occupancy, summary, occupant scaffold

## Why
EXT-001–003 (auth + Location Master) already shipped (commit e4d69d95). EXT-004–007 implement the
remaining four endpoints exactly as specified in the partner ODT
(`docs/source/B_Data_We_Request_From_Partner_Systems.odt`) and already-approved
`docs/adr/0002-partner-integration-architecture.md` — endpoint paths, methods, scopes, and response
field names are not decisions of this CR, they're just built as documented. This CR exists only to
record the two things that genuinely need sign-off: **new internal schema** (§2) the ODT doesn't
define (it only specifies the partner-facing API, not our MongoDB internals), and **judgment calls**
(§3) the ODT leaves unspecified and this implementation had to resolve one way.

## 1. Not included here
Per the ODT/ADR verbatim: the four endpoints and their required scopes
(`GET .../stock` → `location-stock-read`, `GET .../occupancy` → `occupancy-read`, `GET /summary` →
`location-read` + conditional `occupancy-read`, `GET .../occupants` → `occupancy-pii-read`, denied by
default), the response field names/types, and the EXT-007 default-deny + mandatory-`purpose` +
always-log behavior. None of that is listed below — implementing an already-fixed spec isn't a change
to track.

## 2. Schema additions (new)
The ODT specifies the partner-facing JSON only; it says nothing about our MongoDB internals, so the
collection/field design below is this CR's own to make and record.

- **`shelter_stocks`** (new collection, EXT-004/006) — one row per shelter+item: `item_id`,
  `m6_reference_id` (always `null` — pending catalog alignment, ADR 0002 §5), `m6_item_code`,
  `name_th`, `type_code`, `unit_label`, `unit_ratio`, `quantity_on_hand`, `source`
  (`direct_donation`/`m6_transfer`), plus an **internal-only** `reorder_threshold` (not part of the
  ODT's EXT-004 response — used only to derive EXT-006 `critical_items`, see §3).
- **`third_party_access_logs`** (new collection, EXT-007) — `client_id`, `module_name`, `endpoint`,
  `location_code`, `purpose`, `ip`, `status`, `result_count`, `created_at`; TTL index on `created_at`
  (ext-spec.md said "timestamp with TTL" but not a duration — this CR picks **1 year**; flagging for
  confirmation given these rows are PDPA-adjacent access records, not routine operational data).
- **`public_shelters.occupancy_breakdown`** (new field, EXT-005) — embedded `{male, female,
  child_under_5, elderly_over_60, pregnant, bedridden, disabled}`, all `int`, default `0`.
- `docs/data/schema.md` §9.1 was also rewritten to match the *already-shipped* EXT-002/003 fields
  (`is_active`, `location_status`, `site_kind`, …) that commit `e4d69d95` added to code but never
  recorded in schema.md. That's a documentation-debt fix, not new schema from this CR.

## 3. Judgment calls the ODT leaves open
- **EXT-004 envelope shape**: the Data Dictionary table lists `updated_at` as a per-item field, but
  the ODT's own worked JSON example only shows one `updated_at` at the location level. Followed the
  example (single top-level `updated_at`), not the table.
- **`unit_ratio` fixed at `1`**: the ODT defines it as "base units per counted unit"; our system has
  no concept of a counted unit distinct from the ledger's base unit, so this is always `1` rather than
  a computed value.
- **`type_code` mapping**: the ODT just says "same enum as M6" (`food`/`genaral`/`medical-equipment`/
  `medication`); there's no shared vocabulary with our own free-text `item_category`, so
  `category_to_type_code` is a best-effort keyword match (`worker/projectors/stock.py`) invented for
  this CR, not something the ODT specifies.
- **`reorder_threshold` / EXT-006 `critical_items` math**: the ODT says levels are "derived from
  reorder thresholds" but gives no formula. This CR reuses the existing staff-side formula
  (`calculateReorderLevel`, `frontend/.../threshold-calc.ts`) and reads the shelter's own
  `stock_threshold_override` docs (CR-094) — a deliberate choice to keep partner alerts consistent
  with what staff already see, not an ODT requirement.
- **EXT-007 "scope granted" path**: ext-spec.md's Out of Scope explicitly forbids building the real
  occupant-PII payload in this slice, but doesn't say what a call should do if a token *did* somehow
  carry `occupancy-pii-read` (none does today). This CR returns an empty `result: []` (200) and logs
  `status: granted_no_data_source`, rather than erroring — so the audit trail can show real demand
  before a future CR builds the actual data source.
- **`updated_by_role` (EXT-005)**: the ODT wants a job-title string, not a person's name. Since
  aggregation is fully worker-driven now, this CR hardcodes `"ระบบนับอัตโนมัติ (Sync Worker)"` rather
  than reading anything from CouchDB.

## Impact
- Code: `packages/tent-model`, `worker/src/worker/{projectors,mongo}`,
  `worker/src/worker/couch/{processor.py,bootstrap.py}` (new hooks on
  `evacuee`/`stock_ledger`/`stock_threshold_override` changes),
  `backend/apiapp/modules/thirdparty_{stock,occupancy,summary,occupants}` (new).
- Docs: `docs/data/schema.md` §9 (new §9.3/§9.4 + §9.1 rewrite).
- Tests: `worker/tests/projectors/test_projectors.py`, `worker/tests/test_mongo_{shelter,stock}.py`,
  `worker/tests/test_{processor,bootstrap}.py`, `backend/tests/test_thirdparty_{stock,occupancy,
  summary,occupants}.py` (new).

## Migration
Purely additive — new Mongo collections, one new optional-with-default field on `public_shelters`.
No existing persisted document shape changes; CouchDB SoR untouched. N/A for `schema_v` (MongoDB read
models in this project aren't schema_v-versioned).

