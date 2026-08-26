---
id: CR-093
title: Food Sphere Standard, Requirement Group และ Replenishment Policy Canonical Schemas (โภชนาการและการเติมสต็อกเสบียง)
status: proposed
date: 2026-08-26
requested_by: ทีมพัฒนาคลังสินค้าและโภชนาการ (Module D Kitchen & Module C Supply) / Sphere Standard Plan
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/schema.md §4.6 (`food_sphere_standard`), §4.7 (`requirement_group`), §4.8 (`replenishment_policy`)
  - docs/changes/CR-058-food-warehouse-nutrition-kitchen-overhaul.md (หมวดที่ 2)
  - docs/task-breakdown/05-D-kitchen.md (Task T-17, T-22)
  - docs/task-breakdown/03-C-supply.md (Task T-14)
  - docs/task-breakdown/07-B-sop.md (Task T-30, T-31)
  - docs/data/data-model.md §4
  - schema_v: food_sphere_standard 1 · requirement_group 1 · replenishment_policy 1
  - frontend/src/lib/features/catalog/
  - frontend/src/lib/features/kitchen/
---

# CR-093 — Food Sphere Standard, Requirement Group & Replenishment Policy Canonical Schemas

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เพิ่ม 3 Canonical Schemas ใหม่ (Purely Additive, `schema_v: 1` ทั้งหมด): (1) `food_sphere_standard` สำหรับเกณฑ์โภชนาการมาตรฐาน Sphere แยกตามกลุ่มประชากร (2) `requirement_group` สำหรับกลุ่มสารอาหารหลักและการแปลงหน่วยสินค้า (`conversion_factor` / `share_percent`) (3) `replenishment_policy` สำหรับนโยบายระยะเวลารอคอยสินค้าและเกณฑ์แจ้งเตือน Days of Coverage (DoC)
- **เพื่อใคร/ทำไม:** รองรับการคำนวณความต้องการเสบียงรายวัน (Sphere Analysis) และวางแผนเติมสต็อกคลังสินค้า (Reorder Point / DoC Alert) ตามมาตรฐานสากล Sphere Handbook โดยไม่ทำให้ระบบติดสถานะหารด้วยศูนย์ ($\text{DoC} = +\infty$) เมื่อยังไม่ได้ตั้งค่า
- **Dev ต้อง build:**
  - Data Models / Zod Schemas สำหรับ `food_sphere_standard`, `requirement_group`, `replenishment_policy` ใน `frontend/src/lib/features/`
  - Seed Script สำหรับ 14 รายการ Food Sphere Baseline และ 3 รายการ Baseline Replenishment Policies
  - ฟังก์ชันคำนวณ Total Daily Demand, Standard Reorder Days, DoC และ Shortage Qty พร้อม Fallback Logic สำหรับ Segment และศูนย์ที่ยังไม่ตั้งค่านโยบาย
- **กระทบ schema/scope:**
  - `docs/data/schema.md` เพิ่ม §4.6, §4.7, §4.8
  - `docs/changes/CR-058-food-warehouse-nutrition-kitchen-overhaul.md` (หมวดที่ 2)
  - Task Breakdown T-17, T-22 ใน `05-D-kitchen.md`

---

## 1. Requirements (ข้อกำหนดเชิงระบบ)

### FR-01: โครงสร้างข้อมูลเกณฑ์โภชนาการมาตรฐาน Sphere (`food_sphere_standard`)

1. ระบบต้องรองรับเอกสาร `food_sphere_standard` (`schema_v: 1`) ในฐานข้อมูล `catalog` (ส่วนกลาง, `source = SPHERE_BASELINE`) และ `shelter_{shelter_code}` (ศูนย์ปรับแต่ง, `source = SHELTER_OVERRIDE`)
2. รูปแบบ Primary Key (`_id`): `"sphere:{target_segment}:{req_group_id}"` โดย `req_group_id` คือ Raw Group ID (เช่น `"FOOD_ENERGY"`, `"FOOD_FAT"`, `"FOOD_PROTEIN"` อ้างอิงเอกสาร `req_group:{group_id}`)
3. ค่า `target_segment` ต้องอยู่ใน Whitelist: `ALL`, `INFANT_0_6`, `INFANT_6_23`, `CHILD_2_5`, `PREGNANT`, `LACTATING`, `ELDERLY`
4. ค่า `daily_demand` ต้องเป็นตัวเลขมากกว่า 0 (`num > 0`)
5. ค่า `effective_date` ต้องเป็นรูปแบบ ISO Date (`YYYY-MM-DD`)
6. เมื่อ `source = SHELTER_OVERRIDE` ต้องระบุฟิลด์ `shelter_code`; หากเป็น `SPHERE_BASELINE` ต้องไม่มีฟิลด์ `shelter_code`

### FR-02: โครงสร้างข้อมูลกลุ่มความต้องการสารอาหารและการแปลงหน่วยสินค้า (`requirement_group`)

1. ระบบต้องรองรับเอกสาร `requirement_group` (`schema_v: 1`) ในฐานข้อมูล `catalog` (ส่วนกลาง, `source = SPHERE_BASELINE`) และ `shelter_{shelter_code}` (ศูนย์ปรับแต่ง, `source = SHELTER_OVERRIDE`)
2. รูปแบบ Primary Key (`_id`): `"req_group:{group_id}"` (เช่น `"req_group:FOOD_ENERGY"`, `"req_group:FOOD_FAT"`, `"req_group:FOOD_PROTEIN"`)
3. ฟิลด์ `standard_uom` (เช่น `"kcal"`, `"gram"`, `"litre"`) ต้องถูกใช้เป็นค่าตั้งต้น (Auto-fill) สำหรับแสดงผลหน่วยนับในหน้าจอ Food Sphere Standard
4. รายการ `item_maps[]` ประกอบด้วย:
   - `item_id`: `str (req)` อ้างอิง `item_master:{sku|ulid}`
   - `base_uom`: `str (req)` ดึงจาก `item_master.base_unit` (Read-only)
   - `conversion_factor`: `num > 0 (req)` ตัวคูณแปลงจาก Base UOM เป็น Standard UOM
   - `share_percent`: `num (opt)` สัดส่วนเป้าหมายในเมนู ($0 \le \text{share\_percent} \le 100$)
5. เมื่อผลรวม `share_percent` ของสินค้าในกลุ่มเดียวกัน $\ne 100\%$ ระบบต้องแสดงผล Warning แต่ไม่บล็อกการบันทึกข้อมูล (Non-blocking warning)
6. เมื่อ `source = SHELTER_OVERRIDE` ต้องระบุฟิลด์ `shelter_code`; หากเป็น `SPHERE_BASELINE` ต้องไม่มีฟิลด์ `shelter_code`

### FR-03: โครงสร้างข้อมูลนโยบายการเติมสต็อกและ DoC Alert (`replenishment_policy`)

1. ระบบต้องรองรับเอกสาร `replenishment_policy` (`schema_v: 1`) ในฐานข้อมูล `catalog` และ `shelter_{shelter_code}`
2. รูปแบบ Primary Key (`_id`): `"replenishment_policy:{scope_type}:{target_id}"`
3. ค่า `scope_type` ต้องอยู่ใน Whitelist: `GLOBAL`, `REQUIREMENT_GROUP`, `ITEM`
4. ค่า `target_id` ต้องสัมพันธ์กับ `scope_type`:
   - `scope_type = GLOBAL` $\rightarrow$ `target_id = "DEFAULT"`
   - `scope_type = REQUIREMENT_GROUP` $\rightarrow$ `target_id = "{group_id}"` (เช่น `"FOOD_ENERGY"`)
   - `scope_type = ITEM` $\rightarrow$ `target_id = "item_master:{sku|ulid}"`
5. ค่า `lead_time_days`, `review_period_days`, `safety_days`, `min_doc_days`, `max_doc_days` ต้องเป็นจำนวนเต็ม $\ge 0$
6. Validation Rule: ต้องตรวจสอบเงื่อนไข $\text{min\_doc\_days} < \text{Standard Reorder Days}$ และ $\text{min\_doc\_days} < \text{max\_doc\_days}$ หากไม่ผ่านต้องบล็อกการบันทึกข้อมูล

### FR-04: สูตรและการคำนวณโภชนาการและการเติมสต็อก (Calculation Rules & Fallback Invariants)

1. **Standard Quantity Conversion:**
   $$\text{Standard Qty} = \text{Base Qty} \times \text{conversion\_factor}$$
2. **Total Daily Demand:**
   $$\text{Total Daily Demand} = \sum_{\text{segment}} (\text{Headcount}_{\text{segment}} \times \text{daily\_demand}_{\text{segment, group}})$$
   - *Segment Fallback Rule:* หากไม่มี `food_sphere_standard` สำหรับคู่ `(target_segment, req_group_id)` ระบบต้อง fallback ไปใช้ค่าของ `target_segment = ALL` ภายใต้ `req_group_id` เดียวกัน (ห้าม fallback ข้าม `req_group_id`)
3. **Standard Reorder Days:**
   $$\text{Standard Reorder Days} = \text{lead\_time\_days} + \text{review\_period\_days} + \text{safety\_days}$$
4. **Days of Coverage (DoC) & Shortage Quantity:**
   $$\text{DoC (Days)} = \frac{\text{Current Stock Qty}}{\text{Total Daily Demand}}$$
   $$\text{Shortage Qty} = (\text{Standard Reorder Days} \times \text{Total Daily Demand}) - \text{Current Stock Qty}$$
5. **Graceful DoC Fallback (Division-by-Zero / Unconfigured Handling):**
   - หาก $\text{Total Daily Demand} = 0$ หรือศูนย์ยังไม่ได้กำหนดนโยบายเติมสต็อก ระบบต้องไม่คำนวณจนเกิดค่า $+\infty$ หรือ $\text{NaN}$
   - ระบบต้องคืนสถานะ `'UNCONFIGURED'` และแสดงข้อความ `"ยังไม่ได้ตั้งค่านโยบาย"` บนหน้าจอ

---

## 2. Seed Data Specifications (ชุดข้อมูลตั้งต้น)

### 2.1 Food Sphere Baseline (14 รายการใน `catalog`)

| ลำดับ | Target Segment | Requirement Group ID | Daily Demand | Standard UOM | Effective Date | Source |
| :---: | :--- | :--- | :---: | :--- | :---: | :---: |
| 1 | `ALL` | `FOOD_ENERGY` | 2,100 | `kcal` | `2026-07-16` | `SPHERE_BASELINE` |
| 2 | `ALL` | `FOOD_FAT` | 40 | `gram` | `2026-07-16` | `SPHERE_BASELINE` |
| 3 | `ALL` | `FOOD_PROTEIN` | 53 | `gram` | `2026-07-16` | `SPHERE_BASELINE` |
| 4 | `INFANT_0_6` | `FOOD_ENERGY` | 550 | `kcal` | `2026-07-16` | `SPHERE_BASELINE` |
| 5 | `INFANT_6_23` | `FOOD_ENERGY` | 850 | `kcal` | `2026-07-16` | `SPHERE_BASELINE` |
| 6 | `CHILD_2_5` | `FOOD_ENERGY` | 1,250 | `kcal` | `2026-07-16` | `SPHERE_BASELINE` |
| 7 | `CHILD_2_5` | `FOOD_PROTEIN` | 25 | `gram` | `2026-07-16` | `SPHERE_BASELINE` |
| 8 | `PREGNANT` | `FOOD_ENERGY` | 2,400 | `kcal` | `2026-07-16` | `SPHERE_BASELINE` |
| 9 | `PREGNANT` | `FOOD_PROTEIN` | 70 | `gram` | `2026-07-16` | `SPHERE_BASELINE` |
| 10 | `PREGNANT` | `FOOD_FAT` | 45 | `gram` | `2026-07-16` | `SPHERE_BASELINE` |
| 11 | `LACTATING` | `FOOD_ENERGY` | 2,600 | `kcal` | `2026-07-16` | `SPHERE_BASELINE` |
| 12 | `LACTATING` | `FOOD_PROTEIN` | 75 | `gram` | `2026-07-16` | `SPHERE_BASELINE` |
| 13 | `ELDERLY` | `FOOD_ENERGY` | 1,900 | `kcal` | `2026-07-16` | `SPHERE_BASELINE` |
| 14 | `ELDERLY` | `FOOD_PROTEIN` | 60 | `gram` | `2026-07-16` | `SPHERE_BASELINE` |

### 2.2 Baseline Replenishment Policies (3 รายการใน `catalog`)

| ลำดับ | Scope Type | Target ID | Lead Time (วัน) | Review Period (วัน) | Safety Days (วัน) | Reorder Days รวม | Source |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| 1 | `GLOBAL` | `DEFAULT` | 2 | 3 | 2 | 7 วัน | `SPHERE_BASELINE` |
| 2 | `REQUIREMENT_GROUP` | `FOOD_ENERGY` | 3 | 4 | 3 | 10 วัน | `SPHERE_BASELINE` |
| 3 | `REQUIREMENT_GROUP` | `FOOD_PROTEIN` | 2 | 2 | 2 | 6 วัน | `SPHERE_BASELINE` |

---

## 3. Impact & Affected Files

- **Docs:**
  - `docs/data/schema.md` §4.6 (`food_sphere_standard`), §4.7 (`requirement_group`), §4.8 (`replenishment_policy`), §7 (Index), §8 (Validation Rules)
  - `docs/changes/CR-058-food-warehouse-nutrition-kitchen-overhaul.md` (หมวดที่ 2)
  - `docs/task-breakdown/05-D-kitchen.md` (Task T-17 & T-22)
  - `docs/data/data-model.md` §4
- **Code:**
  - `frontend/src/lib/features/catalog/`
  - `frontend/src/lib/features/kitchen/`
  - `frontend/src/lib/features/sop-ratios/`
  - Seed scripts (`scripts/seed.ts` หรือ catalog seeders)
- **Tests:**
  - Unit tests สำหรับฟังก์ชันคำนวณ Daily Demand, DoC, และ Division-by-Zero fallbacks

---

## 4. Migration

- **Data Migration:** N/A — เพิ่มเติม Schemas ใหม่ทั้งหมด (`schema_v: 1` Purely Additive) โดยไม่มีผลกระทบต่อเอกสารเดิมในฐานข้อมูล
- **Seeding:** รัน Seeding Script เพื่อใส่ค่าเริ่มต้น 14 รายการ Sphere Baseline และ 3 รายการ Baseline Replenishment Policies เข้าฐานข้อมูล `catalog`

---

## 5. Acceptance Criteria & Definition of Done

- [ ] **AC-01:** `docs/data/schema.md` ระบุสเปกระดับฟิลด์ของ `food_sphere_standard`, `requirement_group`, และ `replenishment_policy` ครบถ้วน พร้อม Index และ Validation Rules
- [ ] **AC-02:** Primary Key pattern ตรงตามมาตรฐาน: `sphere:{target_segment}:{req_group_id}`, `req_group:{group_id}`, `replenishment_policy:{scope_type}:{target_id}`
- [ ] **AC-03:** Zod schemas และ Model Interfaces ฝั่ง client ตรวจสอบ Type, Positive number constraints, และ Enums ตรงกับ Canonical Schema
- [ ] **AC-04:** ระบบคำนวณ DoC คืนค่า `'UNCONFIGURED'` (ไม่เกิด $+\infty$ / `NaN`) เมื่อ $\text{Demand} = 0$ หรือยังไม่มีนโยบาย
- [ ] **AC-05:** Seed data ทั้ง 14 รายการ Sphere Baseline และ 3 รายการ Replenishment Policies ถูกนำเข้าสู่ฐานข้อมูล `catalog` อย่างถูกต้อง

---

## 6. Decision Log

- 2026-08-26 — Proposed ตามแผนงาน `docs/plans/food-sphere-replenishment-schema-cr-plan.md`
