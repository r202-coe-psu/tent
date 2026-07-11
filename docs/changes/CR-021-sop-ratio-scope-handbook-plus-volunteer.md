---
id: CR-021
title: "SOP ratio scope — sop_profile.ratios = 19 handbook keys + volunteer ratio; remove rice from SOP (egg already belongs to kitchen) → item_master/recipe"
status: approved
date: 2026-06-29
updated: 2026-07-01
requested_by: T-18 — SOP ratio source audit (development team D)
decided_by: project owner
layer: stable
affects:
  - docs/changes/CR-006-sop-profile-master-override.md — amend §Canonical 20 keys (ถอด rice, เพิ่ม people_per_volunteer); supersede OQ-3
  - docs/changes/CR-018-sop-override-invariants.md — อัปเดต footnote whitelist (canonical set มาจาก CR-021)
  - docs/changes/CR-015-sop-ratio-schema-two-tier.md — sync validation (Zod) ก่อน deploy; ไม่ reopen CR
  - docs/data/schema.md §4.2 (+ §4.2.1 เมื่อ apply CR-006) — sop_profile.ratios whitelist
  - docs/source/handbooks/sop-ratio-reference-table.md — reference values (ไม่ใช่ schema truth)
  - docs/task-breakdown/05-D.md — T-25 (meal plan อ่านจากครัว ไม่ใช่ sop_profile)
  - docs/task-breakdown/07-B.md — T-30/T-31/T-32 (อาสา = key ใน sop_profile)
  - frontend/src/lib/features/sop-ratios/domain/sop-ratio.ts — SOP_RATIO_KEYS, SOP_RATIO_KIND, Zod
  - frontend/src/lib/features/sop-ratios/domain/sop-ratio.test.ts
  - frontend/src/lib/features/sop-ratios/data/sop-ratio.pouch.test.ts
  - frontend/scripts/seed.ts — seedCatalogSopRatios
  - schema_v — ไม่ bump; envelope doc ไม่เปลี่ยน
---

# CR-021 — SOP ratio scope: 19 handbook keys + volunteer ratio

**สรุป (TL;DR):** จัด `sop_profile.ratios` = SOP planning เท่านั้น (20 keys: 19 handbook + อาสา) ·
ถอด `rice_g_per_person_meal` → ครัว (`item_master`/`recipe`, CR-013) · เพิ่ม `people_per_volunteer`
(kind `divide`) · ไม่ bump `schema_v` · กระทบ validation (sync CR-015), `sop-ratios` feature,
T-25/30/31/32 · ต้องผ่าน PO ข้าม Module B ↔ C/D ↔ A ก่อน approve

## Why

T-18 audit source ของ 20 keys ใน [CR-006](CR-006-sop-profile-master-override.md) พบว่าคละ 2 ประเภท ownership:

| ประเภท | ตัวอย่าง | ที่มา |
| --- | --- | --- |
| SOP planning ratios | น้ำ, ส้วม, พื้นที่, จุดบริการ, ระยะ, อาสาทั่วไป | handbook ปภ.2565 + Sphere 2018 (19 keys) + project policy (อาสา) |
| Food / ingredient consumption | `rice_g_per_person_meal` | ไม่มีใน handbook — CR-006 ระบุ "derived" เอง |

ปัญหา:

1. ข้าว/ไข่ = วัตถุดิบครัว — มีที่เก็บแล้วใน `item_master.consumption_rate` + `recipe.ingredients`
   ([CR-013](CR-013-catalog-schema-definition.md)) → เก็บใน `sop_profile.ratios` ด้วย = ซ้ำซ้อน
2. อัตราอาสาทั่วไป (อาสาต่อผู้พักพิง) อยู่ใน design T-30/T-31/T-32 แต่ CR-006 20 keys ไม่มี

**หมายเหตุ `kcal_per_adult_day`:** คงไว้ใน SOP — เป็นมาตรฐานพลังงานระดับการวางแผน (handbook) ไม่ใช่
ปริมาณวัตถุดิบต่อมื้อ; ต่างจาก `rice_g_per_person_meal` ที่เป็น consumption coefficient ต่อ item

## Change

### Before → After (canonical whitelist)

| | CR-006 (ก่อน CR-021) | CR-021 (หลัง) |
| --- | --- | --- |
| จำนวน keys | 20 | 20 (ผลลัพธ์ของจัด ownership ไม่ใช่เป้าหมาย) |
| ถอด | — | `rice_g_per_person_meal` |
| เพิ่ม | — | `people_per_volunteer` (kind `divide`) |
| egg | ไม่เคยอยู่ใน SOP | ยืนยันอยู่ครัว (ไม่ใช่การย้าย) |

### Scope (normative)

`sop_profile.ratios` SHALL contain only planning ratios used to derive shelter capacity, facility
requirements, staffing requirements, or service quality constraints at SOP planning level.

Consumption coefficients for materials, ingredients, or inventory depletion MUST NOT be stored in
`sop_profile` (→ `item_master.consumption_rate` / `recipe`).

### Canonical 20 keys (หลัง CR-021)

ค่า default อ้างอิง: [`docs/source/handbooks/sop-ratio-reference-table.md`](../source/handbooks/sop-ratio-reference-table.md)
(schema truth อยู่ที่ `schema.md` หลัง apply)

| # | key | kind | source | หมายเหตุ |
| --- | --- | --- | --- | --- |
| 1 | `water_l_per_person_day` | multiply | ปภ. + Sphere | handbook |
| 2 | `drinking_water_l_per_person_day` | multiply | ปภ. + Sphere | handbook |
| 3 | `cooking_water_l_per_person_day` | multiply | ปภ. + Sphere | handbook |
| 4 | `hygiene_water_l_per_person_day` | multiply | ปภ. + Sphere | handbook |
| 5 | `kcal_per_adult_day` | multiply | ปภ. | handbook — energy standard (ไม่ใช่ ingredient qty) |
| 6 | `people_per_tap` | divide | ปภ. + Sphere | handbook |
| 7 | `people_per_handpump` | divide | Sphere | handbook |
| 8 | `people_per_open_well` | divide | Sphere | handbook |
| 9 | `people_per_laundry` | divide | ปภ. + Sphere | handbook |
| 10 | `people_per_bathing` | divide | Sphere | handbook |
| 11 | `people_per_toilet_female` | divide | ปภ. + Sphere | handbook |
| 12 | `people_per_toilet_male` | divide | ปภ. | handbook |
| 13 | `people_per_dining_point_adult` | divide | ปภ. | handbook |
| 14 | `people_per_dining_point_child` | divide | ปภ. | handbook |
| 15 | `m2_per_person_living` | multiply (min) | ปภ. + Sphere | handbook |
| 16 | `m2_per_person_living_cold` | multiply (min) | Sphere | handbook |
| 17 | `m2_per_person_total` | multiply (min) | ปภ. + Sphere | handbook |
| 18 | `max_waterpoint_distance_m` | threshold | ปภ. + Sphere | handbook — constraint ไม่ใช่ quantity gap |
| 19 | `max_queue_minutes` | threshold | Sphere | handbook — constraint ไม่ใช่ quantity gap |
| 20 | `people_per_volunteer` | divide | project (P-02) | **ไม่มีใน handbook** — อาสาทั่วไปต่อผู้พักพิง |

> แถว #6 เดิม (`rice_g_per_person_meal`) **ถูกถอด** — ย้ายไปครัว (CR-013)

**`people_per_volunteer` — ขอบเขต**

- Base/general staffing ratio (อาสาทั่วไปต่อผู้พักพิง) เท่านั้น
- สูตร: `volunteers_needed = ceil(occupancy / people_per_volunteer)`
- ownership (project-owned):

```yaml
owner:
  key: people_per_volunteer
  source: project_policy
  authority: P-02 / domain expert
  overridable: true
```

**ห้ามเพิ่ม care-key ใน `sop_profile`** — ตัวอย่างที่ reject:
`caregiver_per_elderly`, `nurse_per_patient`, `childcare_per_infant`, `special_volunteer_ratio`
→ care allocation = Module A / T-29 (skill matching จาก `evacuee.special_needs`)

### Handbook ratio policy (keys #1–19)

- default values มาจาก handbook
- local override ผ่าน `sop_override` เท่านั้น
- handbook baseline ต้องไม่ถูก mutate โดย override

### rice / egg → Module C/D (ครัว)

- **rice** — remove from SOP (`rice_g_per_person_meal`) → `item_master.consumption_rate` / `recipe`
- **egg** — confirm kitchen ownership (never was SOP ratio key)
- **T-25** (meal plan) อ่านจากครัว ไม่ผ่าน `sop_profile.ratios`

### ค่า (values)

| กลุ่ม | สถานะค่า |
| --- | --- |
| 19 handbook keys (#1–19) | มี source ครบ → sign-off ได้ (`sop-ratio-reference-table.md`) |
| `people_per_volunteer` (#20) | ไม่มีใน handbook → pending P-02 / expert (Q-T18-3) |
| rice / egg | ค่าอยู่ฝั่งครัว (P-02/expert, Module C/D) |

> **[NEEDS DECISION: `people_per_volunteer` บังคับใน master/override ตั้งแต่ create หรืออนุญาต unset
> จน P-02 sign-off?]** — ขัดกับ [CR-015](CR-015-sop-ratio-schema-two-tier.md) (full ratios) และ
> [CR-018](CR-018-sop-override-invariants.md) (override ครบทุก canonical key) จนกว่า PO จะเคาะ
> ทางเลือก: (A) บังคับครบ 20 keys ตั้งแต่ create, seed placeholder จน sign-off · (B) อนุญาต unset
> เฉพาะ `people_per_volunteer` ชั่วคราว + T-31/T-32 แสดง `no_value` แทน crash

## Requirements

1. **R-021-1** — `SOP_RATIO_KEYS` ต้องตรง whitelist 20 keys ตามตาราง §Canonical 20 keys (ถอด
   `rice_g_per_person_meal`, เพิ่ม `people_per_volunteer`)
2. **R-021-2** — `SOP_RATIO_KIND['people_per_volunteer']` = `divide`; keys อื่นคง kind ตาม CR-006
   (ยกเว้นแถว rice ที่ถูกถอด)
3. **R-021-3** — validation (Zod + `validate_doc_update`) ต้อง reject `rice_g_per_person_meal` และ
   key นอก whitelist ใน `sop_profile` / `sop_override`
4. **R-021-4** — validation ต้อง reject care-key และ food-consumption key ใด ๆ ใน SOP payload
   (รายการ negative ตาม §ห้ามเพิ่ม care-key)
5. **R-021-5** — T-31 คำนวณอาสาทั่วไปจาก effective profile:
   `volunteers_needed = ceil(occupancy / people_per_volunteer)` เมื่อค่า resolve ได้
6. **R-021-6** — T-25 ต้องไม่อ่าน rice/egg/วัตถุดิบจาก `sop_profile.ratios`; อ่านจาก
   `item_master.consumption_rate` + `recipe.ingredients` (CR-013)
7. **R-021-7** — T-29 รับผิดชอบ skill-based volunteer demand แยกจาก `people_per_volunteer`
8. **R-021-8** — amend [CR-006](CR-006-sop-profile-master-override.md) §Canonical 20 keys ให้สอดคล้อง
   CR-021 ก่อนหรือพร้อมกับ implementation
9. **R-021-9** — sync validation กับ [CR-015](CR-015-sop-ratio-schema-two-tier.md) ก่อน deployment
   (ไม่ reopen CR-015)

## Acceptance

- [ ] payload `sop_profile` / `sop_override` มี `rice_g_per_person_meal` → **reject**
- [ ] payload มี key นอก whitelist 20 keys → **reject**
- [ ] payload มี `caregiver_per_elderly` (หรือ care-key อื่นใน §ห้าม) → **reject**
- [ ] `SOP_RATIO_KEYS` มีครบ 20 keys, ไม่มี `rice_g_per_person_meal`, มี `people_per_volunteer`
- [ ] `SOP_RATIO_KIND` ครบทุก key ใน whitelist
- [ ] effective profile `people_per_volunteer: 50`, occupancy 120 → `volunteers_needed = 3`
- [ ] T-25 meal plan ไม่อ้าง `sop_profile.ratios` สำหรับข้าว/ไข่
- [ ] seed/test ที่ใช้ `rice_g_per_person_meal` ถูกอัปเดต (ลบ rice, เพิ่ม `people_per_volunteer`)
- [ ] NEEDS DECISION §`people_per_volunteer` unset — ผ่านหลัง PO เคาะทางเลือก A หรือ B

## Reconciliation (CR-006 ↔ CR-015 ↔ CR-018 ↔ schema)

CR-021 ปรับ canonical ratio set — มี alignment requirement กับงานที่มีอยู่แล้ว:

| CR | ความสัมพันธ์ |
| --- | --- |
| **CR-006** | amend §Canonical 20 keys; supersede OQ-3 (rice ใน SOP) |
| **CR-015** (`done`) | sync Zod validation ก่อน deploy — ถอด rice ไม่ใช่ silent change |
| **CR-018** (`approved`) | invariant/semantics คงเดิม; **whitelist อ้าง CR-021** แทน CR-006 แถวเดิม |
| **schema.md** | อัปเดต §4.2 ratios whitelist เมื่อ apply (§4.2.1 จะถูกสร้างพร้อม CR-006 full key list) |

**ลำดับ rollout (dependency):**

1. align CR-006 canonical table
2. apply CR-021 (remove rice / add volunteer)
3. schema + CR-015 validation alignment
4. อัปเดต footnote CR-018

## Impact

**Docs**

- [CR-006](CR-006-sop-profile-master-override.md) — amend canonical key list
- [CR-018](CR-018-sop-override-invariants.md) — footnote whitelist
- `docs/data/schema.md` §4.2 — ratios whitelist
- `docs/task-breakdown/05-D.md` — T-25 description
- `docs/task-breakdown/07-B.md` — T-30/T-31/T-32

**Code**

- `frontend/src/lib/features/sop-ratios/domain/sop-ratio.ts` — `SOP_RATIO_KEYS`, `SOP_RATIO_KIND`, schemas
- `frontend/src/lib/features/sop-ratios/domain/sop-ratio.test.ts`
- `frontend/src/lib/features/sop-ratios/data/sop-ratio.pouch.test.ts`
- `frontend/scripts/seed.ts` — `seedCatalogSopRatios`

**Modules**

- **Module B** — T-30 config / T-31 calc / T-32 dashboard: อาสา = key ใน sop_profile
- **Module C/D** — rice/egg/วัตถุดิบ = `item_master` / `recipe` (CR-013); ไม่อ้าง sop_profile
- **Module A** — T-29 skill matching แยกจาก `people_per_volunteer`

**schema_v:** ไม่ bump — envelope doc ไม่เปลี่ยน; ratio acceptance rules sync ผ่าน CR-006 + CR-015

**ปลด blocker:** Q-T18-3 ฝั่ง handbook (19 ค่า sign-off ได้) + CR-013 boundary ฝั่งอาหาร

## Migration

N/A — ไม่มี persisted `sop_profile` / `sop_override` ใน production

**Seed / test:** ลบ `rice_g_per_person_meal`, เพิ่ม `people_per_volunteer`; ย้าย logic ข้าวไปครัว

**Validation (หลัง NEEDS DECISION เคาะ):**

- reject `rice_g_per_person_meal` ใน `sop_profile.ratios`
- reject unknown / food-consumption / care-key ใน SOP payload
- ถ้า consuming workflow ต้องการ volunteer planning ค่าต้อง resolve จาก baseline หรือ override
  (พฤติกรรมเมื่อ unset = ตามทางเลือก A/B ที่ PO เคาะ)

## Decision log

- 2026-06-29 — proposed; ต้องผ่าน PO + เห็นชอบข้าม module (Module B ↔ C/D ↔ A) ก่อน approve
- 2026-06-29 — supersedes [CR-006](CR-006-sop-profile-master-override.md) OQ-3 / `rice_g_per_person_meal`
  ใน SOP; rice ownership → Module C/D ([CR-013](CR-013-catalog-schema-definition.md))
- 2026-07-01 — rewrite ตาม spec-authoring contract: เพิ่ม Requirements/Acceptance, ตาราง 20 keys,
  ขยาย `affects`, mark NEEDS DECISION (`people_per_volunteer` unset vs full-ratios)
- 2026-07-05 — **PR Review Update:** Option 1 (Strict 20-Key Snapshot) adopted, overriding CR-018 partial master invariant.

> **Architectural Note:** Per CR-026 ratification, "Option 1" (Strict 20-Key Snapshot) has been adopted. This officially overrides and deprecates the CR-018 invariant that previously allowed partial schemas (>= 1 key) for Master profiles. Both Master and Override profiles now strictly require the full canonical 20-key schema.
