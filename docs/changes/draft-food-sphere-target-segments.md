---
id: draft
title: Food Sphere Standard target_segment ตาม 7 กลุ่มอายุ Dashboard + ตัดตัวแปร SOP ratio 20 → 9 คีย์ 
status: proposed
date: 2026-09-17
requested_by: ทีมพัฒนา SOP Ratios & Demographics Dashboard; Kontuch Suksawat (ส่วน B — requirement 2026-09-16 "สิ่งที่ตัดออกในตัวแปรมาตรฐาน Sphere")
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/schema.md §4.6 (`food_sphere_standard`)
  - frontend/src/lib/features/sop-ratios/domain/food-sphere.ts
  - frontend/src/lib/features/sop-ratios/domain/food-sphere-calc.ts
  - frontend/src/lib/features/sop-ratios/domain/food-sphere.fixture.ts
  - docs/data/schema.md §4.4 (`sop_profile`) — schema_v 3 → 4 (ส่วน B)
  - docs/data/schema.md §2.14 (`sop_override`) — schema_v 2 → 3 (ส่วน B)
  - docs/data/schema.md §2.20 (`simulation`) — schema_v 1 → 2 (ส่วน B)
  - docs/data/schema.md §2.15 (`daily_calc`) — หมายเหตุ whitelist + invariant (ส่วน B, schema_v 2 คงเดิม)
  - docs/data/data-model.md, docs/features/daily-sop-resource-calc-flow.md (ส่วน B)
  - docs/changes/CR-042-daily-sop-calc-follow-up.md OD-2 แถวที่ถูกตัด (ส่วน B)
  - frontend/src/lib/features/sop-ratios/{domain,data,application,ui} (ส่วน B)
  - frontend/src/lib/features/resource-calc/{data,domain,ui} (ส่วน B)
  - frontend/src/lib/features/sop-simulation/{domain,application,data,ui} (ส่วน B)
  - frontend/src/lib/server/shelter-access-design.ts — `_design/access` validate_doc_update (ส่วน B)
  - frontend/scripts/seed/master-seed.ts, frontend/scripts/sync-central-db.ts, frontend/scripts/demo/t31-scenario-2-illustrative.ts (ส่วน B)
---

> **ไฟล์นี้มี 2 การเปลี่ยนแปลง:** ส่วน A = `food_sphere_standard.target_segment` (หัวข้อ 1–6) · ส่วน B = ตัดตัวแปร SOP ratio 20 → 9 คีย์ (หัวข้อ B1–B9). ตอนอนุมัติแยกเลข CR ได้ทีละส่วน

# Draft — Food Sphere Standard target_segment Alignment with Demographics Dashboard

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ปรับ enum ของ `target_segment` ในเอกสาร `food_sphere_standard` จากเดิม 7 กลุ่มตามสรีรวิทยา (`ALL`, `INFANT_0_6`, `INFANT_6_23`, `CHILD_2_5`, `PREGNANT`, `LACTATING`, `ELDERLY`) เป็น 7 กลุ่มตามช่วงอายุจริงใน Demographics Dashboard (`ALL`, `INFANT`, `YOUNG_CHILD`, `OLDER_CHILD`, `TEEN`, `ADULT`, `ELDERLY`)
- **เพื่อใคร/ทำไม:** ข้อมูลผู้พักพิงในศูนย์ที่เก็บผ่านระบบทะเบียนและแสดงในแดชบอร์ดมีเพียงข้อมูลวันเกิด/ช่วงอายุ ไม่มีข้อมูลสรีรวิทยา เช่น การตั้งครรภ์หรือการให้นมบุตร การจับคู่ตัวเลขกลุ่มประชากรเข้ากับเกณฑ์โภชนาการ Sphere จึงต้องอิงตามช่วงอายุเดียวกันแบบ 1-to-1 เพื่อให้คำนวณ Demand ได้จริง
- **Dev ต้อง build:** อัปเดตนิยามใน `docs/data/schema.md §4.6` ให้ตรงกับโค้ดที่ implement แล้วใน `frontend/src/lib/features/sop-ratios/domain/food-sphere.ts`
- **กระทบ schema/scope:** `docs/data/schema.md §4.6` (enum whitelist และตัวอย่าง `_id`), ไม่ bump `schema_v` (`schema_v: 1` คงเดิม)

---

## 1. Requirements

### FR-01: ปรับ Whitelist ของ `target_segment` ใน `food_sphere_standard`
1. ฟิลด์ `target_segment` ต้องรองรับเฉพาะ 7 ค่าดังต่อไปนี้:
   - `ALL`: ประชากรทั้งหมด หรือประชากรที่ไม่ทราบช่วงอายุ
   - `INFANT`: ทารก (< 1 ปี)
   - `YOUNG_CHILD`: เด็กเล็ก (1–5 ปี)
   - `OLDER_CHILD`: เด็กโต (6–11 ปี)
   - `TEEN`: วัยรุ่น (12–19 ปี)
   - `ADULT`: ผู้ใหญ่ (20–59 ปี)
   - `ELDERLY`: ผู้สูงอายุ (60 ปีขึ้นไป)
2. ค่าเก่าที่ยกเลิก (`INFANT_0_6`, `INFANT_6_23`, `CHILD_2_5`, `PREGNANT`, `LACTATING`) ต้องถูกปฏิเสธ (validation fail)
3. รูปแบบ Primary Key (`_id`): `"food_sphere_standard:{target_segment}:{req_group_id}"` เช่น `"food_sphere_standard:ALL:FOOD_ENERGY"` หรือ `"food_sphere_standard:YOUNG_CHILD:FOOD_ENERGY"`

### FR-02: ความสอดคล้องกับ Demographics Dashboard
1. ฟังก์ชันคำนวณความต้องการเสบียง (`headcountsFromAgeGroups`) ต้องจับคู่กลุ่มอายุจาก Demographics (`<1`, `1-5`, `6-11`, `12-19`, `20-59`, `60+`, `unknown`) เข้าสู่ `TargetSegment` โดยตรง
2. ประชากรในกลุ่ม `unknown` (ไม่ระบุอายุ) ให้นับรวมเข้ากลุ่ม `ALL`
3. ประชากรทุกคนต้องถูกนับรวมเพียงครั้งเดียว (Total headcounts = Effective occupancy)

---

## 2. Why

1. **ความไม่สอดคล้องระหว่างโมเดลประชากรกับเกณฑ์โภชนาการ:** ใน CR-095 เดิม กำหนดเกณฑ์ Sphere ตามคู่มือ Sphere Handbook สากลที่มีกลุ่มเฉพาะทาง เช่น `PREGNANT` (หญิงมีครรภ์) และ `LACTATING` (หญิงให้นมบุตร) แต่ระบบลงทะเบียนหน้างานและ Demographics Dashboard ไม่ได้จำแนกหรือระบุสถิติหญิงมีครรภ์/ให้นมบุตรแยกออกมา ทำให้ไม่สามารถแมปจำนวนคนจริงเข้ากับเกณฑ์โภชนาการได้
2. **การบูรณาการระบบอัตโนมัติ:** เมื่อจัดกลุ่มตามช่วงอายุของ Dashboard (7 กลุ่ม) ระบบสามารถดึงตัวเลขจาก Demographics MapReduce View เข้าสู่ Calculation Engine ได้ทันทีโดยไม่มีช่องว่างของข้อมูล

---

## 3. Change (Before → After)

| มิติ | ก่อนหน้า (CR-095 / schema.md เดิม) | หลังปรับปรุง (ตาม Dashboard) |
| --- | --- | --- |
| **Enum values** | `ALL`, `INFANT_0_6`, `INFANT_6_23`, `CHILD_2_5`, `PREGNANT`, `LACTATING`, `ELDERLY` | `ALL`, `INFANT`, `YOUNG_CHILD`, `OLDER_CHILD`, `TEEN`, `ADULT`, `ELDERLY` |
| **การแมปช่วงอายุ** | อิงเกณฑ์สรีรวิทยา ไม่ตรงกับ Demographics View | แมปตรงกับ Demographics View: `<1`, `1-5`, `6-11`, `12-19`, `20-59`, `60+` |
| **ตัวอย่าง `_id` ใน schema.md** | `food_sphere_standard:INFANT_0_6:FOOD_ENERGY` | `food_sphere_standard:YOUNG_CHILD:FOOD_ENERGY` หรือ `food_sphere_standard:INFANT:FOOD_ENERGY` |
| **Schema Version** | `schema_v: 1` | `schema_v: 1` (คงเดิม) |

---

## 4. Impact

- **Documentation:**
  - `docs/data/schema.md §4.6`: ปรับ Enum whitelist และตัวอย่าง `_id`
- **Code (Implement เรียบร้อยแล้วใน commit `b0826f5ee`):**
  - `frontend/src/lib/features/sop-ratios/domain/food-sphere.ts`: `targetSegmentSchema` และ `TARGET_SEGMENT_LABELS`
  - `frontend/src/lib/features/sop-ratios/domain/food-sphere-calc.ts`: `AGE_BUCKET_BY_SEGMENT` และ `headcountsFromAgeGroups`
  - `frontend/src/lib/features/sop-ratios/domain/food-sphere.fixture.ts`: ปรับ fixture ให้ตรงกับ enum ใหม่
  - `frontend/src/lib/features/sop-ratios/ui/food-sphere-stock-tab.svelte`: เรียกใช้ `headcountsFromAgeGroups`
- **Test:**
  - `frontend/src/lib/features/sop-ratios/domain/food-sphere-calc.test.ts`: ทดสอบความถูกต้องของ schema, การ reject ค่าเดิม และการกระจาย headcount

---

## 5. Migration

- **ผลกระทบต่อเอกสารเดิม:** ปัจจุบันระบบยังอยู่ในช่วงทดสอบและ seed ข้อมูลระดับ local/staging ไม่มีเอกสาร `food_sphere_standard` ใน production ที่ต้องรัน batch migration
- **Baseline Seed:** ค่าเริ่มต้นใน fixture และ seed ปรับเป็น enum ใหม่เรียบร้อยแล้ว

---

## 6. Acceptance Criteria

- [ ] **AC-01:** เอกสาร `docs/data/schema.md §4.6` ระบุ `target_segment` เป็น `enum('ALL','INFANT','YOUNG_CHILD','OLDER_CHILD','TEEN','ADULT','ELDERLY')`
- [ ] **AC-02:** ตัวอย่าง `_id` ใน `docs/data/schema.md §4.6` ใช้นิพจน์กลุ่มเป้าหมายใหม่ เช่น `food_sphere_standard:YOUNG_CHILD:FOOD_ENERGY`
- [ ] **AC-03:** Unit tests สำหรับ target segments และ calculation logic ผ่านทั้งหมด

---

# ส่วน B — ตัดตัวแปร SOP ratio จาก 20 เหลือ 9 คีย์ ออกจาก schema จริง (แบบ B)

## B0. สรุป (TL;DR)

- **เปลี่ยนอะไร:** ลด canonical SOP ratio keys จาก 20 → 9 คีย์ ใน `sop_profile`, `sop_override`, `simulation` และเครื่องคำนวณ T-31 — ลบ 11 คีย์ออกจากโค้ด validator และเอกสารที่ persist (ไม่ใช่แค่ซ่อนในหน้าจอ)
- **เพื่อใคร/ทำไม:** requirement 2026-09-16 (Kontuch Suksawat) ให้หน้า "ตัวแปรมาตรฐาน Sphere" เหลือเฉพาะตัวแปรตาม PDF. การซ่อนในหน้าจอ (แบบ A) ทิ้งข้อมูลที่ไม่ได้ใช้ไว้ในฐานข้อมูลและ spec ยังระบุ 20 คีย์ — แบบ B ทำให้ data model ตรงกับ requirement
- **Dev ต้อง build:** แก้ domain/validator ให้เหลือ 9 คีย์ · bump `schema_v` 3 เอกสาร · migration script สร้างเวอร์ชันใหม่ของ master/override ที่มี 9 คีย์ · deploy `_design/access` ใหม่ · ถอดโค้ดกรองของแบบ A
- **กระทบ schema/scope:** `sop_profile` schema_v 3→4 · `sop_override` 2→3 · `simulation` 1→2 · `daily_calc` schema_v 2 คงเดิม (คีย์ generic) แต่ invariant เปลี่ยน · supersede CR-042 OD-2 แถว 1–5, 13–16, 18–19

## B1. ตัวแปร

**คงไว้ (9 คีย์ — ลำดับ canonical ใหม่):**

| ลำดับ | คีย์ | ชื่อแสดงผล | หน่วย | kind | แหล่ง `have` (CR-042 OD-2) |
| --- | --- | --- | --- | --- | --- |
| 1 | `people_per_tap` | ก๊อกน้ำ | คน/จุด | divide | shelter `facilities.water_points` |
| 2 | `people_per_handpump` | ปั๊มน้ำมือโยก | คน/จุด | divide | none → `null` |
| 3 | `people_per_open_well` | บ่อน้ำเปิด | คน/จุด | divide | none → `null` |
| 4 | `people_per_laundry` | จุดซักล้าง | คน/จุด | divide | none → `null` |
| 5 | `people_per_bathing` | ห้องอาบน้ำ | คน/ห้อง | divide | shelter `facilities.showers` |
| 6 | `people_per_toilet_female` | ห้องน้ำหญิง | คน/ห้อง | divide | shelter `facilities.toilets_female` |
| 7 | `people_per_toilet_male` | ห้องน้ำชาย | คน/ห้อง | divide | shelter `facilities.toilets_male` |
| 8 | `m2_per_person_total` | พื้นที่พักพิงรวม | ตร.ม./คน | multiply | shelter `area_m2` |
| 9 | `people_per_volunteer` | อาสาสมัคร | คน/อาสา 1 คน | divide | none → `null` |

**ลบ (11 คีย์):** `water_l_per_person_day`, `drinking_water_l_per_person_day`, `cooking_water_l_per_person_day`, `hygiene_water_l_per_person_day`, `kcal_per_adult_day`, `people_per_dining_point_adult`, `people_per_dining_point_child`, `m2_per_person_living`, `m2_per_person_living_cold`, `max_waterpoint_distance_m`, `max_queue_minutes`

> [NEEDS DECISION: B-D1] "พื้นที่พักพิงรวม" = คีย์ `m2_per_person_total` เดิม (ค่า baseline 45 ตร.ม./คน) โดยไม่รวมค่าจาก `m2_per_person_living` / `m2_per_person_living_cold` — ยืนยันหรือกำหนดค่าใหม่

## B2. Requirements

### FR-B01 — Domain (`sop-ratios/domain/sop-ratio.ts`)
1. `SOP_RATIO_KEYS` ต้องมีเฉพาะ 9 คีย์ใน B1 ตามลำดับ canonical ในตาราง
2. `SOP_RATIO_KIND` และ `RATIO_LABELS` ต้องมีเฉพาะ 9 คีย์; ป้าย `m2_per_person_total` = "พื้นที่พักพิงรวม"
3. `ratiosSchema` ยังเป็น strict: ครบ 9 คีย์ ขาด/เกินแม้คีย์เดียว = validation fail
4. `SOP_MASTER_SCHEMA_VERSION` = 4 และ `SOP_OVERRIDE_SCHEMA_VERSION` = 3
5. การเขียนเอกสารใหม่ทุกช่องทาง (create initial, create next version, override) ต้องเขียน schema_v ใหม่ + 9 คีย์เท่านั้น

### FR-B02 — เอกสารเวอร์ชันเก่า (legacy read)
1. เอกสาร `sop_profile` schema_v 3 และ `sop_override` schema_v 2 (20 คีย์) ที่ค้างในฐานข้อมูลต้อง**อ่านได้ในประวัติเวอร์ชัน** (read-only) — แสดงเฉพาะ 9 คีย์ที่ยังมีอยู่
2. เอกสาร legacy ต้อง**ไม่ถูกเลือกเป็น effective profile** ของการคำนวณ; pointer `sop_profile_active:global` ที่ชี้เอกสาร legacy = `SopMasterIntegrityError` (fail-closed ตาม CR-083) จนกว่าจะ migrate
3. การสร้างเวอร์ชันถัดไปจากเอกสาร legacy ต้องตัด 11 คีย์ทิ้งอัตโนมัติ (ไม่ต้องให้ผู้ใช้แก้เอง)

### FR-B03 — เครื่องคำนวณ T-31 (`resource-calc`)
1. `buildCalculationResources` / `calculateResources` ต้องผลิต `resource_inputs` และ `results` 9 แถวตามลำดับ canonical
2. `have-map.ts`: ลบกลุ่ม `WATER_RATIO_KEYS`, `AREA_RATIO_KEYS` (คงเฉพาะ `m2_per_person_total → area_m2`) และลด `NULL_HAVE_KEYS` เหลือ `people_per_handpump`, `people_per_open_well`, `people_per_laundry`, `people_per_volunteer`
3. `cr042HaveSnapshotIssues`: ลบ invariant "water keys must share item:water balance" และ "area keys must share area_m2"
4. `ui/sop-category.ts`: map เฉพาะ 9 คีย์; หมวด `food` ไม่มีรายการ
5. `daily_calc` เก่าที่มี 20 แถวต้องเปิดดูได้: UI ต้องข้ามแถวที่ `key` ไม่อยู่ใน `SOP_RATIO_KEYS` (ไม่ throw, ไม่แสดง)

### FR-B04 — SOP Simulation (T-42)
1. `scenario.schema.ts`: `resource_inputs`, `daily_results`, `horizon_results`, `comparison` ต้องมี 9 แถวตามลำดับ canonical; `ratio_overrides` รับเฉพาะ 9 คีย์
2. `simulation` schema_v = 2; เอกสารใหม่ต้องเขียน schema_v 2
3. `lib/server/shelter-access-design.ts` (`_design/access` validate_doc_update) ต้องตรวจ `simulation` ด้วย 9 คีย์ใหม่ และ deploy design doc ใหม่ในทุก `shelter_*` DB
4. `scenario-form.svelte`: กลุ่มที่ไม่มีคีย์เหลือ (อาหาร) ต้องไม่แสดง

> [NEEDS DECISION: B-D2] เอกสาร `simulation` schema_v 1 (20 แถว) ที่บันทึกแล้ว: (ก) ลบทิ้งด้วย tombstone ตอน migrate หรือ (ข) คงไว้และแสดงเป็น legacy read-only (ต้องเพิ่ม legacy parser)

### FR-B05 — Migration script
1. เพิ่ม script (เช่น `frontend/scripts/migrate-sop-ratio-keys-9.ts`) ที่รันซ้ำได้ (idempotent)
2. Master: อ่าน active master ผ่าน pointer → ถ้าเป็น schema_v 3 ให้สร้าง `sop_profile:{slug}:{version+1}` schema_v 4 ที่มี 9 คีย์ (ค่าเดิม) → ย้าย pointer ด้วย CAS (`onConflict: 'throw'`) → เขียน `audit` เหตุผล "CR-NNN: ตัดตัวแปร SOP ratio เหลือ 9 คีย์"
3. Override: ทุก `shelter_*` DB — `sop_override` ที่ `active: true` และ schema_v 2 → สร้างเวอร์ชันถัดไป schema_v 3 ที่มี 9 คีย์ → ปิด (`active: false`) เวอร์ชันเดิม → เขียน audit
4. เวอร์ชันเก่าไม่ถูกแก้ไข (immutable history)
5. Deploy `_design/access` ใหม่ทุก `shelter_*` DB
6. จัดการ `simulation` schema_v 1 ตาม B-D2
7. รายงานผล: จำนวนเอกสารที่ migrate / ข้าม / error ต่อ DB

> [NEEDS DECISION: B-D3] ลำดับ deploy บน staging: รัน migration **ก่อน** deploy frontend ใหม่ (ระหว่างนั้นระบบเดิมยังอ่าน schema_v 4 ไม่ได้) หรือ deploy frontend ที่อ่านได้ทั้ง legacy+ใหม่ก่อนแล้วค่อย migrate

### FR-B06 — Seed และ fixture
1. `sop-ratio.fixture.ts` `validRatios`: 9 คีย์
2. `scripts/seed/master-seed.ts` และ `scripts/sync-central-db.ts`: สร้าง master schema_v 4
3. `scripts/demo/t31-scenario-2-illustrative.ts`: ปรับเป็น 9 คีย์ หรือทำเครื่องหมาย deprecated

### FR-B07 — ถอดโค้ดของแบบ A
1. ลบ `VISIBLE_SOP_RATIO_KEYS`, `isVisibleSopRatioKey` และจุดที่กรองด้วยฟังก์ชันนี้ (หน้าพารามิเตอร์, supply dashboard, simulation form/compare panel/workspace) — ให้ใช้ `SOP_RATIO_KEYS` ตรง
2. คงข้อความ UI ที่เปลี่ยนแล้ว ("ตัวแปรมาตรฐาน Sphere", "พื้นที่พักพิงรวม")

> [NEEDS DECISION: B-D4] โค้ดแบบ A อยู่ใน branch `chore/sop-parameters-sphere-cleanup` (commit `35fb26ec`) ยังไม่ merge เข้า `develop`: (ก) merge PR แบบ A ก่อน แล้ว CR นี้ถอดออก หรือ (ข) ตัด commit `35fb26ec` ออกจาก PR แล้วทำแบบ B แทนโดยตรง

## B3. Why

1. **Requirement ใหม่:** PDF "สิ่งที่ตัดออกในตัวแปรมาตรฐาน Sphere" ขีดฆ่า 11 ตัวแปร และให้รวมพื้นที่พักพิงเป็นตัวเดียว
2. **แบบ A ไม่พอ:** ข้อมูลที่ไม่ได้ใช้ยังถูก persist, คำนวณ, และผ่าน validator; `schema.md` ยังระบุ 20 คีย์ → spec กับ requirement ไม่ตรงกัน และหน้าจอใหม่ที่ลืมกรองจะแสดงตัวแปรที่ตัดไปแล้ว
3. **ข้อมูลน้ำไม่ได้ใช้จริงอยู่แล้ว:** `have` ของน้ำ 4 คีย์ผูกกับ `item:water` แบบ hardcode (CR-042 OD-2) ซึ่งมีเฉพาะใน seed — บน staging แถวน้ำเป็น "รอสต็อก" ทุกแถว
4. **ทางเลือกที่ตัดทิ้ง:** แบบ A (ซ่อนในหน้าจอ) — ย้อนกลับง่ายแต่ data model ไม่ตรง requirement; ถูกเลือกไว้ชั่วคราว 2026-09-16

## B4. Change (Before → After)

| มิติ | ก่อน | หลัง |
| --- | --- | --- |
| Canonical SOP ratio keys | 20 (CR-021 / CR-026) | 9 |
| `sop_profile` | schema_v 3, `ratios` 20 คีย์ strict | schema_v 4, `ratios` 9 คีย์ strict |
| `sop_override` | schema_v 2, `ratios` 20 คีย์ strict | schema_v 3, `ratios` 9 คีย์ strict |
| `simulation` | schema_v 1, ทุก array 20 แถว | schema_v 2, ทุก array 9 แถว |
| `daily_calc` | schema_v 2, `results` 20 แถว | schema_v 2 (คงเดิม), `results` 9 แถว |
| `have` invariant (CR-042) | น้ำ 4 คีย์เท่ากัน, พื้นที่ 3 คีย์เท่ากัน, null 9 คีย์ | null 4 คีย์ |
| `_design/access` (shelter DB) | ตรวจ simulation ด้วย 20 คีย์ | 9 คีย์ |
| UI | แสดง 9 จาก 20 ด้วย `VISIBLE_SOP_RATIO_KEYS` (แบบ A) | แสดง `SOP_RATIO_KEYS` ทั้งหมด (9) |

## B5. Impact

**Docs**
- `docs/data/schema.md` §4.4 `sop_profile` (field `ratios` + schema_v note + migration note)
- `docs/data/schema.md` §2.14 `sop_override` (field `ratios` + schema_v note)
- `docs/data/schema.md` §2.20 `simulation` (ข้อความ "canonical SOP ratio keys ทั้ง 20 รายการ" → 9, schema_v)
- `docs/data/schema.md` §2.15 `daily_calc` (หมายเหตุ "whitelist 20 keys")
- `docs/data/data-model.md`, `docs/features/daily-sop-resource-calc-flow.md`
- `docs/changes/CR-042-daily-sop-calc-follow-up.md` — หมายเหตุว่า OD-2 แถวที่ตัดถูก supersede
- ไม่แก้ (บันทึกประวัติ): CR-006, CR-015, CR-021, `docs/demo/T-31-*`, `docs/questions/QR-001-*`, `docs/source/handbooks/sop-ratio-reference-table.md`

**Code (non-test)**
- `sop-ratios`: `domain/sop-ratio.ts`, `domain/sop-ratio.labels.ts`, `domain/sop-ratio.fixture.ts`, `data/sop-ratio.remote.ts` (legacy read), `ui/version-history-drawer.svelte` + UI ที่ใช้ `VISIBLE_SOP_RATIO_KEYS`
- `resource-calc`: `data/have-map.ts`, `data/daily-calc.validation.ts`, `ui/sop-category.ts`, `ui/resource-needs-dashboard.svelte`
- `sop-simulation`: `domain/scenario.schema.ts`, `ui/scenario-form.svelte`, `ui/scenario-compare-panel.svelte`, `ui/scenario-workspace.svelte`
- `lib/server/shelter-access-design.ts`
- `scripts/seed/master-seed.ts`, `scripts/sync-central-db.ts`, `scripts/demo/t31-scenario-2-illustrative.ts`, migration script ใหม่

**Tests (ต้องแก้ fixture/expectation 20 → 9)**
- `sop-ratios`: `domain/sop-ratio.test.ts`, `data/sop-ratio.remote.test.ts`, `application/queries.test.ts`
- `resource-calc`: `data/have-map.test.ts`, `data/daily-calc.validation.test.ts`, `data/daily-calc.remote.test.ts`, `domain/calc.formula.test.ts`, `domain/calc.schema.test.ts`
- `sop-simulation`: `application/use-run-simulation.test.ts`, `data/scenario.remote.test.ts`, `domain/scenario-display.test.ts`, `domain/scenario.projection.test.ts`, `domain/scenario.schema.test.ts`, `t42-flood-demo.test.ts`, `ui/scenario-mode.test.ts`
- `lib/server/shelter-access-design.test.ts`
- e2e: `e2e/sop-simulation.test.ts`

**ไม่กระทบ:** backend (FastAPI), worker, MongoDB projections, kitchen/meal-plan (ไม่มีการอ้าง 11 คีย์)

**ประมาณการ:** ~4–5 วันทำงาน (ไม่รวมรอบ review และการรัน migration บน staging)

## B6. Migration

- **Persisted docs ที่กระทบ:** `catalog/sop_profile:*` (schema_v 3), `shelter_*/sop_override:*` (schema_v 2), `shelter_*/simulation:*` (schema_v 1), `shelter_*/daily_calc:*` (ไม่ migrate — อ่านแบบข้ามแถวที่ไม่รู้จัก)
- **วิธี:** migration script ตาม FR-B05 — สร้างเวอร์ชันใหม่ ไม่แก้เอกสารเดิม (immutable history ตาม CR-006/CR-083)
- **ย้อนกลับ:** ย้าย pointer กลับไปเวอร์ชัน schema_v 3 เดิม + deploy frontend/`_design/access` รุ่นก่อน; เอกสารที่สร้างใหม่คงอยู่ในประวัติ
- **Pre-prod:** local/dev รัน unseed + seed ใหม่แทน migration ได้
- **Production:** ยังไม่มี production data — migration ใช้กับ staging

## B7. Acceptance Criteria

- [ ] **AC-B01:** `SOP_RATIO_KEYS` มี 9 คีย์ตาม B1; `ratiosSchema` ปฏิเสธ 11 คีย์ที่ลบและปฏิเสธ ratios ที่ขาดคีย์
- [ ] **AC-B02:** สร้าง master / override ใหม่ได้เอกสาร schema_v 4 / 3 ที่มี 9 คีย์
- [ ] **AC-B03:** หลังรัน migration บน staging: pointer ชี้ master schema_v 4, override active ทุกตัวเป็น schema_v 3, audit ครบทุกเอกสารที่ migrate; รันซ้ำแล้วไม่สร้างเวอร์ชันเพิ่ม
- [ ] **AC-B04:** ประวัติเวอร์ชันเปิดเอกสาร schema_v 3 / 2 ได้โดยไม่ error
- [ ] **AC-B05:** กด "คำนวณใหม่" ได้ `daily_calc` 9 แถว; เปิด `daily_calc` เก่า 20 แถวได้โดยแสดง 9 แถว
- [ ] **AC-B06:** หน้าจำลองรันและบันทึก scenario ได้ (schema_v 2, 9 แถว) ผ่าน `_design/access` ใหม่; เอกสาร schema_v 1 จัดการตาม B-D2
- [ ] **AC-B07:** ไม่มี `VISIBLE_SOP_RATIO_KEYS` / `isVisibleSopRatioKey` เหลือในโค้ด
- [ ] **AC-B08:** `pnpm lint`, `pnpm check` (0 error), `pnpm test`, `pnpm test:e2e` (sop-simulation, daily-sop) ผ่าน
- [ ] **AC-B09:** `docs/data/schema.md` §4.4, §2.14, §2.15, §2.20 อัปเดตพร้อม `updated:` และ migration note

## B8. Decisions ที่ต้องเคาะก่อน implement

| # | คำถาม | ข้อเสนอ |
| --- | --- | --- |
| B-D1 | "พื้นที่พักพิงรวม" ใช้ค่า `m2_per_person_total` เดิม (45 ตร.ม./คน) | ใช้ค่าเดิม |
| B-D2 | เอกสาร `simulation` schema_v 1 ที่บันทึกแล้ว | ลบด้วย tombstone (ยังเป็นข้อมูลทดสอบ) |
| B-D3 | ลำดับ deploy frontend กับ migration บน staging | deploy frontend ที่อ่าน legacy ได้ก่อน แล้วค่อย migrate |
| B-D4 | โค้ดแบบ A (`35fb26ec`) | ตัดออกจาก PR `chore/sop-parameters-sphere-cleanup` แล้วทำแบบ B ตรง |
| B-D5 | อยู่ใน phase ปัจจุบันหรือ backlog (change-management §5) | ให้เจ้าของโครงการกำหนด |

## B9. ความสัมพันธ์กับ CR อื่น

- **CR-021 / CR-026:** กำหนด 20 canonical keys — ส่วนนี้ลดขอบเขตเหลือ 9 (supersede เฉพาะรายการคีย์)
- **CR-006:** โครงสร้าง master/override และ immutable version — ยึดตามเดิม
- **CR-042 OD-2:** have map แถวน้ำ, พลังงาน, จุดรับอาหาร, พื้นที่ร้อน/หนาว, ระยะทาง, เวลารอคิว ถูก supersede
- **CR-079:** simulation — schema_v 1 → 2
- **CR-083:** pointer fail-closed — migration ต้องย้าย pointer ด้วย CAS

---

## Decision Log

- 2026-09-17 — ร่าง Change Record (Proposed) เพื่อประสานเอกสาร `docs/data/schema.md` ให้สอดคล้องกับการเปลี่ยนแปลงในโค้ดและแดชบอร์ดศูนย์
- 2026-09-17 — เพิ่มส่วน B (proposed): ตัดตัวแปร SOP ratio 20 → 9 คีย์ออกจาก schema จริง แทนแบบ A (ซ่อนในหน้าจอ) ที่ทำไว้ 2026-09-16 ใน branch `chore/sop-parameters-sphere-cleanup`
