---
id: draft
title: Food Sphere Standard — ปรับ Enum target_segment ให้ตรงกับ 7 กลุ่มอายุ Dashboard
status: proposed
date: 2026-09-17
requested_by: ทีมพัฒนา SOP Ratios & Demographics Dashboard
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/schema.md §4.6 (`food_sphere_standard`)
  - frontend/src/lib/features/sop-ratios/domain/food-sphere.ts
  - frontend/src/lib/features/sop-ratios/domain/food-sphere-calc.ts
  - frontend/src/lib/features/sop-ratios/domain/food-sphere.fixture.ts
---

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

## Decision Log

- 2026-09-17 — ร่าง Change Record (Proposed) เพื่อประสานเอกสาร `docs/data/schema.md` ให้สอดคล้องกับการเปลี่ยนแปลงในโค้ดและแดชบอร์ดศูนย์
