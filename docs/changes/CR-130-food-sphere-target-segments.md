---
id: CR-130
title: Food Sphere Standard target_segment ตาม 7 กลุ่มอายุ Dashboard (schema_v 1 → 2) + ซ่อนตัวแปร SOP ratio ในหน้าจอเหลือ 9 คีย์ (แบบ A)
status: approved
date: 2026-09-17
updated: 2026-09-25
requested_by: ทีมพัฒนา SOP Ratios & Demographics Dashboard; Kontuch Suksawat (ส่วน B — requirement 2026-09-16 "สิ่งที่ตัดออกในตัวแปรมาตรฐาน Sphere")
decision_date: 2026-09-18 (PO decisions); อนุมัติอย่างเป็นทางการ 2026-09-25
decided_by: จาคี (Project Owner) — อนุมัติ 2026-09-25
layer: volatile
affects:
  - docs/data/schema.md §4.6 (`food_sphere_standard`) — enum `target_segment`, ตัวอย่าง `_id`, schema_v 1 → 2
  - frontend/src/lib/features/sop-ratios/domain/food-sphere.ts
  - frontend/src/lib/features/sop-ratios/domain/food-sphere-calc.ts
  - frontend/src/lib/features/sop-ratios/domain/food-sphere.fixture.ts
  - frontend/src/lib/features/sop-ratios/data/food-sphere.remote.ts (เขียน schema_v 2)
  - frontend/src/lib/features/sop-ratios/ui/food-sphere-stock-tab.svelte
  - frontend/src/lib/features/sop-ratios/domain/sop-ratio.ts (`VISIBLE_SOP_RATIO_KEYS` — ส่วน B แบบ A)
  - frontend/src/lib/features/sop-ratios/ui/ + resource-calc/ui/ + sop-simulation/ui/ (ตัวกรองการแสดงผล — ส่วน B แบบ A)
  - frontend/scripts/seed/master-seed.ts, frontend/scripts/sync-central-db.ts (seed schema_v 2)
  - PR #285 (`chore/sop-parameters-sphere-cleanup`) — โค้ดของทั้งสองส่วนอยู่ที่นี่ ยังไม่อยู่บน `develop`
---

> **CR เดียว 2 ส่วน (ตามมติเจ้าของโครงการ 2026-09-18):** ส่วน A = `food_sphere_standard.target_segment` + bump `schema_v` 1 → 2 (หัวข้อ 1–6) · ส่วน B = ซ่อนตัวแปร SOP ratio ในหน้าจอให้เหลือ 9 จาก 20 คีย์ โดย **ไม่แตะ schema** (หัวข้อ B1–B7). **ใช้เลข CR เดียวกันทั้งไฟล์ ไม่แยกเลขรายส่วน**
>
> โค้ดของทั้งสองส่วนอยู่บน **PR #285** (`chore/sop-parameters-sphere-cleanup`) ยังไม่ merge เข้า `develop` — เอกสาร CR นี้กับ PR #285 ต้องอนุมัติและ merge ไปด้วยกัน

# CR-130 — Food Sphere Standard target_segment Alignment with Demographics Dashboard

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ปรับ enum ของ `target_segment` ในเอกสาร `food_sphere_standard` จากเดิม 7 กลุ่มตามสรีรวิทยา (`ALL`, `INFANT_0_6`, `INFANT_6_23`, `CHILD_2_5`, `PREGNANT`, `LACTATING`, `ELDERLY`) เป็น 7 กลุ่มตามช่วงอายุจริงใน Demographics Dashboard (`ALL`, `INFANT`, `YOUNG_CHILD`, `OLDER_CHILD`, `TEEN`, `ADULT`, `ELDERLY`)
- **เพื่อใคร/ทำไม:** ข้อมูลผู้พักพิงในศูนย์ที่เก็บผ่านระบบทะเบียนและแสดงในแดชบอร์ดมีเพียงข้อมูลวันเกิด/ช่วงอายุ ไม่มีข้อมูลสรีรวิทยา เช่น การตั้งครรภ์หรือการให้นมบุตร การจับคู่ตัวเลขกลุ่มประชากรเข้ากับเกณฑ์โภชนาการ Sphere จึงต้องอิงตามช่วงอายุเดียวกันแบบ 1-to-1 เพื่อให้คำนวณ Demand ได้จริง
- **Dev ต้อง build:** อัปเดต `docs/data/schema.md §4.6` (enum + ตัวอย่าง `_id` + `schema_v`), bump `schema_v` ของ `food_sphere_standard` เป็น 2 ในโค้ดและ seed, และจัดการเอกสารเดิมที่ `_id` ฝังรหัสกลุ่มเก่า
- **กระทบ schema/scope:** `docs/data/schema.md §4.6` · **bump `schema_v` 1 → 2** (รูปเอกสารที่ persist เปลี่ยน: enum และ `_id`) · โค้ดอยู่บน PR #285 ยังไม่ถึง `develop`

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

### FR-03: Bump `schema_v` ของ `food_sphere_standard` 1 → 2
1. `food_sphere_standard` ต้องใช้ `schema_v: 2` เนื่องจากรูปเอกสารที่ persist เปลี่ยน 2 จุด: ค่าที่อนุญาตของ `target_segment` และ `_id` ที่ฝังรหัสกลุ่มไว้ (`food_sphere_standard:{target_segment}:{req_group_id}`)
2. เอกสารที่เขียนใหม่ทุกช่องทาง (หน้าจอ, seed, fixture) ต้องเขียน `schema_v: 2` พร้อมรหัสกลุ่มใหม่
3. เอกสาร `schema_v: 1` ที่ค้างอยู่ต้องอ่านได้โดยไม่ throw และต้อง **ไม่ถูกนำไปคำนวณ** เมื่อ `target_segment` ไม่อยู่ใน enum ใหม่
4. หน้าจอที่แสดงเอกสาร `schema_v: 1` ต้องแสดงรหัสกลุ่มเดิมตามข้อมูล ไม่ใช่ค่าว่าง

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
| **Schema Version** | `schema_v: 1` | **`schema_v: 2`** (รูปเอกสารที่ persist เปลี่ยน: enum + `_id`) |

---

## 4. Impact

- **Documentation:**
  - `docs/data/schema.md §4.6`: ปรับ Enum whitelist, ตัวอย่าง `_id`, `schema_v` 1 → 2 พร้อม migration note และอัปเดต `updated:`
- **Code (อยู่บน PR #285 `chore/sop-parameters-sphere-cleanup` commit `b0826f5e` — ยังไม่อยู่บน `develop`):**
  - `frontend/src/lib/features/sop-ratios/domain/food-sphere.ts`: `targetSegmentSchema` และ `TARGET_SEGMENT_LABELS`
  - `frontend/src/lib/features/sop-ratios/domain/food-sphere-calc.ts`: `AGE_BUCKET_BY_SEGMENT` และ `headcountsFromAgeGroups`
  - `frontend/src/lib/features/sop-ratios/domain/food-sphere.fixture.ts`: ปรับ fixture ให้ตรงกับ enum ใหม่
  - `frontend/src/lib/features/sop-ratios/ui/food-sphere-stock-tab.svelte`: เรียกใช้ `headcountsFromAgeGroups`
- **Code ที่ต้องเพิ่มจากมติ 2026-09-18 (ยังไม่ได้ทำใน `b0826f5e`):**
  - `frontend/src/lib/features/sop-ratios/domain/food-sphere.ts`: `FOOD_SPHERE_STANDARD_SCHEMA_VERSION = 2`
  - `frontend/src/lib/features/sop-ratios/data/food-sphere.remote.ts`: เขียน `schema_v: 2` และอ่านเอกสาร `schema_v: 1` แบบ legacy ได้
  - `frontend/scripts/seed/master-seed.ts`, `frontend/scripts/sync-central-db.ts`: seed เอกสาร `schema_v: 2`
- **Test:**
  - `frontend/src/lib/features/sop-ratios/domain/food-sphere-calc.test.ts`: ทดสอบความถูกต้องของ schema, การ reject ค่าเดิม และการกระจาย headcount
  - เพิ่มเทสต์: เขียนเอกสารใหม่ได้ `schema_v: 2` และอ่านเอกสาร `schema_v: 1` ได้โดยไม่ throw

---

## 5. Migration

**schema_v 1 → 2** — `_id` ฝังรหัสกลุ่มเป้าหมายไว้ เอกสารเดิมจึง **แก้ในที่ไม่ได้** ต้องสร้างเอกสารใหม่แทน

- **Production:** ยังไม่มีข้อมูล production — ไม่ต้องทำ batch migration
- **Local / dev:** unseed + seed ใหม่ (`pnpm seed:master`) ได้เอกสาร `schema_v: 2` ทั้งหมด
- **Staging:** ทำอย่างใดอย่างหนึ่ง แล้วบันทึกผลไว้ใน PR
  1. ถ้าไม่มีเกณฑ์ที่ตั้งเอง: unseed + seed ใหม่
  2. ถ้ามีเกณฑ์ที่ตั้งเอง: แปลงรหัสกลุ่มตามตารางด้านล่าง → สร้างเอกสารใหม่ `food_sphere_standard:{new_segment}:{req_group_id}` (`schema_v: 2`) → ลบเอกสารเดิมด้วย tombstone
- **ตารางแปลงรหัสกลุ่ม (ใช้เมื่อ migrate ด้วยมือ):** `INFANT_0_6` / `INFANT_6_23` → `INFANT` · `CHILD_2_5` → `YOUNG_CHILD` · `PREGNANT` / `LACTATING` → **ไม่มีกลุ่มรองรับ** ต้องให้ผู้ดูแลตัดสินว่าลบทิ้งหรือย้ายไป `ADULT` · `ALL` / `ELDERLY` คงเดิม
- **ระหว่างที่ยังไม่ migrate:** เอกสาร `schema_v: 1` ที่มีรหัสกลุ่มเก่าจะแสดงรหัสดิบในหน้าจอ และไม่ถูกนำไปคำนวณ (fallback `ALL` ตาม Invariant 8)
- **ย้อนกลับ:** revert โค้ดและเอกสาร แล้ว seed ใหม่ — เอกสาร `schema_v: 2` ที่สร้างไว้ต้องลบทิ้ง

---

## 6. Acceptance Criteria

- [ ] **AC-01:** เอกสาร `docs/data/schema.md §4.6` ระบุ `target_segment` เป็น `enum('ALL','INFANT','YOUNG_CHILD','OLDER_CHILD','TEEN','ADULT','ELDERLY')`
- [ ] **AC-02:** ตัวอย่าง `_id` ใน `docs/data/schema.md §4.6` ใช้นิพจน์กลุ่มเป้าหมายใหม่ เช่น `food_sphere_standard:YOUNG_CHILD:FOOD_ENERGY`
- [ ] **AC-03:** Unit tests สำหรับ target segments และ calculation logic ผ่านทั้งหมด
- [ ] **AC-04:** `docs/data/schema.md §4.6` ระบุ **schema_v 2** พร้อม migration note และอัปเดต `updated:` เป็นวันจริง
- [ ] **AC-05:** เอกสาร `food_sphere_standard` ที่สร้างจากหน้าจอและจาก seed มี `schema_v: 2`
- [ ] **AC-06:** เปิดหน้าพารามิเตอร์อาหารขณะที่ยังมีเอกสาร `schema_v: 1` ค้างอยู่ได้โดยไม่ error และเอกสารนั้นไม่ถูกนำไปคำนวณ
- [ ] **AC-07:** staging ทำ migration/reseed ตามหัวข้อ 5 แล้ว และบันทึกผลไว้ใน PR #285

---

# ส่วน B — ซ่อนตัวแปร SOP ratio ในหน้าจอให้เหลือ 9 จาก 20 คีย์ (แบบ A)

## B0. สรุป (TL;DR)

- **เปลี่ยนอะไร:** หน้าจอที่เกี่ยวกับตัวแปรมาตรฐาน Sphere แสดงเฉพาะ **9 คีย์** ตาม requirement 2026-09-16 โดย **คง canonical 20 คีย์ไว้ใน schema, validator, เครื่องคำนวณ และฐานข้อมูลตามเดิม**
- **เพื่อใคร/ทำไม:** เจ้าหน้าที่ศูนย์เห็นเฉพาะตัวแปรที่ใช้จริงตาม PDF "สิ่งที่ตัดออกในตัวแปรมาตรฐาน Sphere" ส่วนการตัดออกจาก schema จริงยังไม่ทำในรอบนี้เพราะย้อนกลับยากและต้อง migrate (มติเจ้าของโครงการ 2026-09-18)
- **Dev ต้อง build:** รายการคีย์ที่แสดง (`VISIBLE_SOP_RATIO_KEYS` หรือเทียบเท่า) ไว้ที่จุดเดียวใน domain แล้วให้ทุกหน้าจอกรองจากรายการนี้
- **กระทบ schema/scope:** **ไม่กระทบ schema** — ไม่แก้ `docs/data/schema.md`, ไม่ bump `schema_v`, ไม่ migrate ข้อมูล, ไม่แตะ `_design/access`

## B1. ตัวแปร

**แสดงในหน้าจอ (9 คีย์ ตามลำดับ canonical เดิม):**

| คีย์ | ชื่อแสดงผล | หน่วย |
| --- | --- | --- |
| `people_per_tap` | ก๊อกน้ำ | คน/จุด |
| `people_per_handpump` | ปั๊มน้ำมือโยก | คน/จุด |
| `people_per_open_well` | บ่อน้ำเปิด | คน/จุด |
| `people_per_laundry` | จุดซักล้าง | คน/จุด |
| `people_per_bathing` | ห้องอาบน้ำ | คน/ห้อง |
| `people_per_toilet_female` | ห้องน้ำหญิง | คน/ห้อง |
| `people_per_toilet_male` | ห้องน้ำชาย | คน/ห้อง |
| `m2_per_person_total` | พื้นที่พักพิงรวม | ตร.ม./คน |
| `people_per_volunteer` | อาสาสมัคร | คน/อาสา 1 คน |

**ซ่อนจากหน้าจอ (11 คีย์ — ยังคงอยู่ในฐานข้อมูลและยังถูกคำนวณ):** `water_l_per_person_day`, `drinking_water_l_per_person_day`, `cooking_water_l_per_person_day`, `hygiene_water_l_per_person_day`, `kcal_per_adult_day`, `people_per_dining_point_adult`, `people_per_dining_point_child`, `m2_per_person_living`, `m2_per_person_living_cold`, `max_waterpoint_distance_m`, `max_queue_minutes`

## B2. Requirements

### FR-B01 — รายการคีย์ที่แสดง (จุดกำหนดเดียว)
1. `frontend/src/lib/features/sop-ratios/domain/sop-ratio.ts` ต้องมีรายการคีย์ที่แสดง (`VISIBLE_SOP_RATIO_KEYS`) 9 คีย์ตาม B1 และฟังก์ชันตรวจ (`isVisibleSopRatioKey`) export ผ่าน barrel
2. `SOP_RATIO_KEYS`, `SOP_RATIO_KIND`, `ratiosSchema` (strict 20 คีย์), `SOP_MASTER_SCHEMA_VERSION`, `SOP_OVERRIDE_SCHEMA_VERSION` **ต้องไม่เปลี่ยน**
3. ป้ายของ `m2_per_person_total` แสดงเป็น "พื้นที่พักพิงรวม"

### FR-B02 — หน้าจอที่ต้องกรอง
1. หน้า 5. พารามิเตอร์ (ตารางมาสเตอร์, ค่าปรับเฉพาะศูนย์, ฟอร์มแก้ไข, ประวัติเวอร์ชัน) แสดงและแก้ไขได้เฉพาะ 9 คีย์ และตัวนับในแท็บแสดงจำนวนคีย์ที่แสดง
2. แท็บวิเคราะห์ความต้องการพื้นฐาน (แผงควบคุมสต็อก): ตาราง, KPI, ตัวกรองหมวด และไฟล์ส่งออก CSV ใช้เฉพาะ 9 คีย์
3. หน้าจำลองสถานการณ์ SOP: เลือกปรับค่าได้เฉพาะ 9 คีย์, ตารางผลเทียบและตัวนับแสดงเฉพาะ 9 คีย์, กลุ่มที่ไม่มีคีย์เหลือต้องไม่แสดง
4. การแก้ค่าต้องไม่ลบหรือเปลี่ยนค่าคีย์ที่ซ่อน (ส่งเฉพาะค่าที่เปลี่ยนแล้วรวมกับค่าเดิม)
5. การสร้างโปรไฟล์มาสเตอร์ใหม่ยังต้องได้เอกสารครบ 20 คีย์ตาม `ratiosSchema`

### FR-B03 — ข้อมูลและการคำนวณไม่เปลี่ยน
1. เครื่องคำนวณ T-31 ยังคำนวณครบ 20 แถว และ `daily_calc` ยังบันทึกครบ 20 แถว
2. `sop_profile`, `sop_override`, `simulation` และ `_design/access` ไม่เปลี่ยนรูปและไม่ bump `schema_v`
3. snapshot และ scenario ที่บันทึกไว้เดิมต้องเปิดดูได้ตามปกติ

### FR-B04 — เทสต์
1. unit test: รายการคีย์ที่แสดงมี 9 คีย์ ไม่ซ้ำ และทุกคีย์อยู่ใน `SOP_RATIO_KEYS`
2. unit test: คีย์ที่ต้องซ่อนทั้ง 11 คีย์ถูกซ่อนจริง และ `m2_per_person_total` ยังแสดง
3. e2e ที่อ้างคีย์ที่ถูกซ่อนต้องปรับไปใช้คีย์ที่ยังแสดง

## B3. Why

1. **Requirement:** PDF 2026-09-16 ของ Kontuch ขีดฆ่า 11 ตัวแปรและให้เหลือพื้นที่พักพิงตัวเดียว
2. **ทำไมเลือกแบบ A ก่อน (มติ PO 2026-09-18):** ปลอดภัยกว่าและย้อนกลับง่าย — ไม่ต้อง bump `schema_v`, ไม่ต้อง migrate staging, ไม่ต้อง deploy `_design/access` ใหม่ และโค้ดพร้อมอยู่บน PR #285 แล้ว
3. **ทำไมยังไม่ตัดออกจาก schema (แบบ B):** ต้องยืนยันกับ stakeholder ก่อนว่าคีย์ที่ตัดจะไม่ถูกใช้อีก ถ้าตัดแล้วต้องกลับมาใช้ ต้อง migrate ย้อนกลับซึ่งมีความเสี่ยงสูง

## B4. Change (Before → After)

| มิติ | ก่อน | หลัง |
| --- | --- | --- |
| จำนวนคีย์ในหน้าจอ | 20 | 9 |
| canonical keys ในโค้ด/ฐานข้อมูล | 20 | 20 (ไม่เปลี่ยน) |
| `sop_profile` / `sop_override` / `simulation` | schema_v 3 / 2 / 1 | เท่าเดิมทั้งหมด |
| `daily_calc` results | 20 แถว | 20 แถว (หน้าจอแสดง 9) |
| ป้าย `m2_per_person_total` | "พื้นที่รวม" | "พื้นที่พักพิงรวม" |
| `_design/access`, migration, seed ratios | — | ไม่เปลี่ยน |

## B5. Impact

- **Docs:** ไม่มี — `docs/data/schema.md` ยังระบุ canonical 20 คีย์ตามเดิม (CR-021 / CR-026 ไม่ถูก supersede)
- **Code (อยู่บน PR #285 แล้ว):** `sop-ratios/domain/sop-ratio.ts`, `sop-ratio.labels.ts`, UI ของหน้าพารามิเตอร์, `resource-calc/ui/resource-needs-dashboard.svelte`, `sop-simulation/ui/{scenario-form,scenario-compare-panel,scenario-workspace}.svelte` (commit `35fb26ec`, `04f10684`)
- **Test:** `sop-ratios/domain/sop-ratio.test.ts` (เทสต์ใหม่ 3 ข้อ) และ `e2e/sop-simulation.test.ts`
- **ไม่กระทบ:** เครื่องคำนวณ, ข้อมูลใน CouchDB, `_design/access`, backend, worker

## B6. นอกขอบเขตรอบนี้ (backlog)

รายการด้านล่าง **เลื่อนไปรอบ refactor** ตามมติ PO 2026-09-18 จะพิจารณาเมื่อ stakeholder ยืนยันว่าไม่ใช้คีย์ที่ตัดแล้ว และต้องเปิด CR ใหม่แยกต่างหาก

- ตัด canonical keys จาก 20 เหลือ 9 ใน `SOP_RATIO_KEYS` / `ratiosSchema`
- bump `sop_profile` schema_v 3 → 4, `sop_override` 2 → 3, `simulation` 1 → 2 และปรับ invariant ของ `daily_calc`
- migration script (สร้างเวอร์ชันใหม่ + ย้าย pointer แบบ CAS ตาม CR-083) และ deploy `_design/access` ใหม่ทุก `shelter_*` DB
- supersede CR-042 OD-2 แถวที่เกี่ยวกับคีย์ที่ตัด และแก้ `docs/data/schema.md` §4.4 / §2.14 / §2.15 / §2.20
- ถอดรายการคีย์ที่แสดง (`VISIBLE_SOP_RATIO_KEYS`) ออกเมื่อ canonical keys เหลือ 9 แล้ว
- คำถามที่ต้องเคาะเมื่อทำแบบ B (เดิมคือ B-D1…B-D5 — **ไม่ต้องเคาะในรอบนี้**): ค่าของ "พื้นที่พักพิงรวม", เอกสาร `simulation` เดิม, ลำดับ deploy กับ migration, การจัดการโค้ดแบบ A, phase ที่จะทำ

## B7. Acceptance Criteria

- [ ] **AC-B01:** หน้า 5. พารามิเตอร์ แสดงและแก้ไขได้ 9 คีย์ และตัวนับในแท็บตรงกับจำนวนที่แสดง
- [ ] **AC-B02:** แท็บวิเคราะห์ความต้องการพื้นฐานและหน้าจำลองสถานการณ์ SOP แสดงเฉพาะ 9 คีย์ (รวม CSV และตัวนับ)
- [ ] **AC-B03:** แก้ค่าคีย์ที่แสดงแล้วบันทึก เอกสารใหม่ยังมีครบ 20 คีย์ และค่าคีย์ที่ซ่อนไม่เปลี่ยน
- [ ] **AC-B04:** `daily_calc` ที่คำนวณใหม่ยังมี 20 แถว และ `sop_profile` / `sop_override` / `simulation` ยังเป็น schema_v เดิม
- [ ] **AC-B05:** `pnpm lint`, `pnpm check` (0 error), `pnpm test` ผ่าน และ e2e ที่เกี่ยวข้องไม่อ้างคีย์ที่ถูกซ่อน
- [ ] **AC-B06:** เอกสาร CR นี้และโค้ดบน PR #285 merge ไปพร้อมกัน

---

## Decision Log

- 2026-09-17 — ร่าง Change Record (Proposed) เพื่อประสานเอกสาร `docs/data/schema.md` ให้สอดคล้องกับการเปลี่ยนแปลงในโค้ดและแดชบอร์ดศูนย์
- 2026-09-17 — ร่างส่วน B ฉบับแรกเป็นแนวทาง "ตัดตัวแปร 20 → 9 ออกจาก schema จริง" (แบบ B)
- 2026-09-18 — **มติเจ้าของโครงการ (PR review #294):**
  1. รวมส่วน A และส่วน B เป็น **CR เดียว** ไม่แยกเลขรายส่วน
  2. ส่วน A **bump `food_sphere_standard` schema_v 1 → 2** เพราะ enum และ `_id` ของ `target_segment` ที่ persist เปลี่ยนรูป (ไม่ใช้วิธีไม่ bump แล้ว wipe อย่างเดียว)
  3. ส่วน B ใช้ **แบบ A** (ซ่อนในหน้าจอเหลือ 9 คีย์ คง canonical 20 คีย์ใน DB / validator / schema) เพราะปลอดภัยกว่าและย้อนกลับง่าย โค้ดมีอยู่แล้วบน PR #285
  4. **แบบ B (ตัด 20 → 9 ออกจาก schema จริง) เลื่อน** ไปรอบ refactor หลังคุย stakeholder และยืนยันว่าไม่ใช้คีย์ที่ตัดแล้ว · B-D1…B-D5 ไม่ต้องเคาะในรอบนี้
  5. คง commit ของแบบ A บน PR #285 ไว้ (ไม่ตัดออกตามข้อเสนอเดิมของแบบ B)
  6. รันเลข CR จาก `docs/changes/_index.md` ตอน approve และ merge เอกสารกับ PR #285 ไปพร้อมกัน
- 2026-09-25 — **เจ้าของโครงการ (จาคี) อนุมัติเอกสารและให้รันเลขเป็น CR-130 อย่างเป็นทางการ (status: approved)**

