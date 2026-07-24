# T-31 — Daily Resource Calculation Engine: Demo Evidence

## 1. Purpose

Proves the engine's `need` / `have` / `gap` output matches hand-calculation for one shelter, one
full day — the DoD line for T-31: *"Demo คำนวณศูนย์ตัวอย่าง 1 วันเต็มตรงกับคำนวณมือ."*

## 2. Scenario

Shelter **SH001**, after `pnpm seed && pnpm seed:delete-dashboard` (required — otherwise
`seedDashboardData()` injects ~100 non-deterministic mock evacuees onto SH001 and occupancy isn't
a clean, hand-countable number).

- **Occupancy**: 10 evacuees, 3 households, all `current_stay.status: 'active'` — verified via
  direct CouchDB query immediately before the run.
- **SOP profile**: `catalog/sop_profile:master_sphere_baseline` ("Sphere Baseline"), version 1, 20
  ratios — verified value-for-value against Sphere-standard reference figures before the run.
- Not validated by this demo: recalculation behavior when occupancy or ratios change mid-day, or
  multi-day trend behavior (T-31.9's domain tests cover idempotency/recalculation directly).

## 3. Manual calculation

### 3.1 Scenario 1 — real seeded data (the evidence itself)

`need` / `have` / `gap` are the hand-arithmetic (occupancy × ratio, or ceiling-division) — the
actual manual calculation. `status` / `data_status` are the system's classification of that
arithmetic (deterministic business rules, not arithmetic themselves) — included so the persisted
output can be diffed row-for-row against §5, not because computing them by hand is the point.

Row order follows the real persisted `ordinal` (0–20), so this table lines up one-to-one with the
JSON in §5 and the Word report's §3 table.

| ordinal | kind | key | formula | **need** (manual) | **have** (manual) | status (system) | data_status (system) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | multiply | water_l_per_person_day | 10×15 | 150 | null | insufficient_data | stock_unsynced |
| 1 | multiply | drinking_water_l_per_person_day | 10×3 | 30 | null | insufficient_data | stock_unsynced |
| 2 | multiply | cooking_water_l_per_person_day | 10×6 | 60 | null | insufficient_data | stock_unsynced |
| 3 | multiply | hygiene_water_l_per_person_day | 10×6 | 60 | null | insufficient_data | stock_unsynced |
| 4 | multiply | kcal_per_adult_day | 10×2000 | 20000 | null | insufficient_data | stock_unsynced |
| 5 | divide | people_per_tap | ceil(10/80) | 1 | null | insufficient_data | stock_unsynced |
| 6 | divide | people_per_handpump | ceil(10/500) | 1 | null | insufficient_data | stock_unsynced |
| 7 | divide | people_per_open_well | ceil(10/400) | 1 | null | insufficient_data | stock_unsynced |
| 8 | divide | people_per_laundry | ceil(10/100) | 1 | null | insufficient_data | stock_unsynced |
| 9 | divide | people_per_bathing | ceil(10/50) | 1 | null | insufficient_data | stock_unsynced |
| 10 | divide | people_per_toilet_female | ceil(10/20) | 1 | null | insufficient_data | stock_unsynced |
| 11 | divide | people_per_toilet_male | ceil(10/35) | 1 | null | insufficient_data | stock_unsynced |
| 12 | divide | people_per_dining_point_adult | ceil(10/20) | 1 | null | insufficient_data | stock_unsynced |
| 13 | divide | people_per_dining_point_child | ceil(10/10) | 1 | null | insufficient_data | stock_unsynced |
| 14 | multiply | m2_per_person_living | 10×3.5 | 35 | null | insufficient_data | stock_unsynced |
| 15 | multiply | m2_per_person_living_cold | 10×4.5 | 45 | null | insufficient_data | stock_unsynced |
| 16 | multiply | m2_per_person_total | 10×45 | 450 | null | insufficient_data | stock_unsynced |
| 17 | threshold | max_waterpoint_distance_m | ceiling | n/a | n/a | constraint | complete |
| 18 | threshold | max_queue_minutes | ceiling | n/a | n/a | constraint | complete |
| 19 | divide | people_per_volunteer | ceil(10/50) | 1 | null | insufficient_data | stock_unsynced |
| 20 | multiply | rice_g_per_person_meal | 10×200 | 2000 | null | insufficient_data | stock_unsynced |

**Result: 21/21 rows match** — see §5 for the persisted output this table is diffed against.

### 3.2 Scenario 2 — illustrative proof (ok/gap/surplus)

Scenario 1's real data never exercises the `ok`/`gap`/`surplus` branches because `have` is always
`null` (see §8, Known Limitation). This script proves those branches work, using the real
`calculateResources()` with hand-picked `have` values — not wired to any DB, pure domain call:

```
water_l_per_person_day           need=150 have=100  -> gap       (need > have)
drinking_water_l_per_person_day  need=30  have=50   -> surplus   (need < have)
cooking_water_l_per_person_day   need=60  have=60   -> ok        (need = have)
people_per_toilet_female         need=1   have=0    -> gap
people_per_tap                   need=1   have=1    -> ok
people_per_volunteer             need=1   have=2    -> surplus
```

**Result: 6/6 rows match** the intended status for each branch.

## 4. System output

Triggered via the app's own on-demand recalculation path: logged in as a shelter-role user,
clicked **"คำนวณใหม่"** on `CalcStatusBadge` (T-31.7), which calls `useRunCalc()` →
`DailyCalcRemoteRepository.runOnDemand()` — the real production code path (cookie-session auth,
peer-barrel reads, deterministic `daily_calc:{date}` write).

The trigger mechanism itself is not part of what this demo verifies — only the resulting
persisted output is (§5) — so this doc doesn't lock in a specific implementation detail that could
go stale after a refactor.

Result: toast **"คำนวณใหม่เรียบร้อย"**, badge updated to **"อัปเดตล่าสุด 15 ก.ค. 2569 18:33"**.

## 5. API response

Persisted `daily_calc:2026-07-15` document in `shelter_sh001`, produced by the live UI trigger
in §4 (`GET /couch/shelter_sh001/daily_calc%3A2026-07-15`):

```json
{
  "_id": "daily_calc:2026-07-15",
  "type": "daily_calc",
  "schema_v": 1,
  "shelter_code": "SH001",
  "formula_v": "1.2.0",
  "sop_profile_version": 1,
  "occupancy_snapshot": 10,
  "created_by": "demo-t31.10",
  "updated_at": "2026-07-15T11:33:40.778Z",
  "results": [
    { "ordinal": 0,  "key": "water_l_per_person_day",           "kind": "multiply",  "need": 150,   "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 1,  "key": "drinking_water_l_per_person_day",  "kind": "multiply",  "need": 30,    "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 2,  "key": "cooking_water_l_per_person_day",   "kind": "multiply",  "need": 60,    "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 3,  "key": "hygiene_water_l_per_person_day",   "kind": "multiply",  "need": 60,    "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 4,  "key": "kcal_per_adult_day",                "kind": "multiply",  "need": 20000, "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 5,  "key": "people_per_tap",                   "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 6,  "key": "people_per_handpump",               "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 7,  "key": "people_per_open_well",              "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 8,  "key": "people_per_laundry",                "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 9,  "key": "people_per_bathing",                "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 10, "key": "people_per_toilet_female",          "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 11, "key": "people_per_toilet_male",            "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 12, "key": "people_per_dining_point_adult",     "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 13, "key": "people_per_dining_point_child",     "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 14, "key": "m2_per_person_living",              "kind": "multiply",  "need": 35,    "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 15, "key": "m2_per_person_living_cold",         "kind": "multiply",  "need": 45,    "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 16, "key": "m2_per_person_total",               "kind": "multiply",  "need": 450,   "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 17, "key": "max_waterpoint_distance_m",         "kind": "threshold", "need": null,  "have": null, "status": "constraint",        "data_status": "complete" },
    { "ordinal": 18, "key": "max_queue_minutes",                 "kind": "threshold", "need": null,  "have": null, "status": "constraint",        "data_status": "complete" },
    { "ordinal": 19, "key": "people_per_volunteer",              "kind": "divide",    "need": 1,     "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" },
    { "ordinal": 20, "key": "rice_g_per_person_meal",            "kind": "multiply",  "need": 2000,  "have": null, "status": "insufficient_data", "data_status": "stock_unsynced" }
  ]
}
```

(Full 21-row document, unedited, matches §3.1 row-for-row.)

## 6. Screenshots

`CalcStatusBadge` (T-31.7), post-trigger, showing the success toast and updated timestamp:

> **[✓] คำนวณใหม่เรียบร้อย**
> อัปเดตล่าสุด 15 ก.ค. 2569 18:33 · โดย demo-t31.10 [คำนวณใหม่]

Captured live in-session against the running dev app (logged in as `staff01`); the underlying
persisted document is the authoritative evidence and is reproduced verbatim in §5.

## 7. Verification matrix

| Requirement | Method | Evidence | Result |
| --- | --- | --- | --- |
| Hand-calc (Scenario 1) | Manual computation | Table in §3.1 vs §5 | **21/21 rows match exactly** |
| Persisted doc matches table | Live UI trigger + direct CouchDB read | §5 | `daily_calc:2026-07-15` results = §3.1 row-for-row |
| Formula-level ok/gap/surplus proof | `scripts/demo/t31-scenario-2-illustrative.ts` | §3.2 | **6/6 rows match** |

Persisted output is compared directly against the hand-calculation table without editing — no
manual adjustment of either side after system execution.

## 8. Known limitation

`resolveHave()` looks up stock by SOP-ratio-key; the stock ledger is keyed by catalog item IDs —
they never match with real seed data, so `have` is `null` for every multiply/divide resource
today. Not a formula bug — `calc.formula.ts` is validated by the T-31.9 domain test suite; it's an
unresolved upstream data-mapping seam, tracked as future work. **This limitation does not affect
verification of the calculation formula itself** — formula correctness is validated independently
by T-31.9's tests and Scenario 2 (§3.2).

## Appendix

**Setup**

```
pnpm seed && pnpm seed:delete-dashboard
pnpm dev
```

Full environment walkthrough (docker compose, `.env`) — see `docs/demo/README.md` if one exists
for general project setup; not duplicated here.

**Demo script** — `frontend/scripts/demo/t31-scenario-2-illustrative.ts`:

```
pnpm tsx --tsconfig .svelte-kit/tsconfig.json scripts/demo/t31-scenario-2-illustrative.ts
```
