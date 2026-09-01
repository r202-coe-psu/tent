---
id: CR-095
title: Food Sphere Standard, Requirement Group และ Replenishment Policy Canonical Schemas (โภชนาการและการเติมสต็อกเสบียง)
status: done
date: 2026-08-27
updated: 2026-09-01
requested_by: ทีมพัฒนาคลังสินค้าและโภชนาการ (Module D Kitchen & Module C Supply) / Sphere Standard Plan
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/schema.md §4.6 (`food_sphere_standard`), §4.7 (`requirement_group`), §4.8 (`replenishment_policy`)
  - docs/changes/CR-058-food-warehouse-nutrition-kitchen-overhaul.md (หมวดที่ 2)
  - docs/changes/schema-update-sop-parameters-soft-delete.md
  - docs/task-breakdown/05-D-kitchen.md (Task T-17, T-22)
  - docs/task-breakdown/03-C-supply.md (Task T-14)
  - docs/task-breakdown/07-B-sop.md (Task T-30, T-31)
  - docs/data/data-model.md §4
  - schema_v: food_sphere_standard 1 · requirement_group 1 · replenishment_policy 1
  - frontend/src/lib/features/catalog/
  - frontend/src/lib/features/kitchen/
---

# CR-095 — Food Sphere Standard, Requirement Group & Replenishment Policy Canonical Schemas

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เพิ่ม 3 Canonical Schemas ใหม่ (Purely Additive, `schema_v: 1` ทั้งหมด): (1) `food_sphere_standard` สำหรับเกณฑ์โภชนาการมาตรฐาน Sphere แยกตามกลุ่มประชากร (2) `requirement_group` สำหรับกลุ่มสารอาหารหลักและการแปลงหน่วยสินค้า (`conversion_factor` / `share_percent`) (3) `replenishment_policy` สำหรับนโยบายระยะเวลารอคอยสินค้าและเกณฑ์แจ้งเตือน Days of Coverage (DoC) พร้อมฟิลด์ `status: 'active' | 'inactive'` (default `'active'`) และนโยบาย Soft-Delete (Delete-in-use policy ตาม CR-053 / `schema.md §3.3`)
- **เพื่อใคร/ทำไม:** รองรับการคำนวณความต้องการเสบียงรายวัน (Sphere Analysis) และวางแผนเติมสต็อกคลังสินค้า (Reorder Point / DoC Alert) ตามมาตรฐานสากล Sphere Handbook โดยไม่ทำให้ระบบติดสถานะหารด้วยศูนย์ ($\text{DoC} = +\infty$) เมื่อยังไม่ได้ตั้งค่า รวมถึงป้องกันปัญหา Orphaned References และรักษาประวัติการคำนวณย้อนหลังใน `daily_calc` ไม่ให้เสียหายเมื่อมีการยกเลิกการใช้งานพารามิเตอร์
- **Dev ต้อง build:**
  - Data Models / Zod Schemas สำหรับ `food_sphere_standard`, `requirement_group`, `replenishment_policy` ใน `frontend/src/lib/features/` พร้อมฟิลด์ `status`
  - ยกเลิก Hard-Delete (`repo.remove()`) ใน Data layer เปลี่ยนเป็น Soft-Delete (`status: 'inactive'`) พร้อมปุ่ม Reactivate
  - กรอง Dropdown ในฟอร์มสร้างใหม่เฉพาะ `status === 'active'` (ฟอร์มแก้ไข/ประวัติไม่กรองทิ้ง)
  - Seed Script สำหรับ 14 รายการ Food Sphere Baseline และ 3 รายการ Baseline Replenishment Policies (ประทับ `status: 'active'`)
  - ฟังก์ชันคำนวณ Total Daily Demand, Standard Reorder Days, DoC และ Shortage Qty พร้อม Fallback Logic กรองเฉพาะ active standards/policies
- **กระทบ schema/scope:**
  - `docs/data/schema.md` เพิ่ม §4.6, §4.7, §4.8
  - `docs/changes/CR-058-food-warehouse-nutrition-kitchen-overhaul.md` (หมวดที่ 2)
  - `docs/changes/schema-update-sop-parameters-soft-delete.md`
  - Task Breakdown T-17, T-22 ใน `05-D-kitchen.md`

---

## 1. Requirements (ข้อกำหนดเชิงระบบ)

### FR-01: โครงสร้างข้อมูลเกณฑ์โภชนาการมาตรฐาน Sphere (`food_sphere_standard`)

1. ระบบต้องรองรับเอกสาร `food_sphere_standard` (`schema_v: 1`) ในฐานข้อมูล `catalog` (ส่วนกลาง, `source = SPHERE_BASELINE`) และ `shelter_{shelter_code}` (ศูนย์ปรับแต่ง, `source = SHELTER_OVERRIDE`)
2. รูปแบบ Primary Key (`_id`): `"food_sphere_standard:{target_segment}:{req_group_id}"` โดย `req_group_id` คือ Raw Group ID (เช่น `"FOOD_ENERGY"`, `"FOOD_FAT"`, `"FOOD_PROTEIN"` อ้างอิงเอกสาร `requirement_group:{group_id}`)
3. ค่า `target_segment` ต้องอยู่ใน Whitelist: `ALL`, `INFANT_0_6`, `INFANT_6_23`, `CHILD_2_5`, `PREGNANT`, `LACTATING`, `ELDERLY`
4. ค่า `daily_demand` ต้องเป็นตัวเลขมากกว่า 0 (`num > 0`)
5. ฟิลด์ `standard_uom` (opt, เช่น `"kcal"`, `"gram"`) แคชหน่วยนับมาตรฐานจาก Requirement Group เพื่อแสดงผล
6. ค่า `effective_date` ต้องเป็นรูปแบบ ISO Date (`YYYY-MM-DD`)
7. ฟิลด์ `status` (req, default `'active'`): กำหนดสถานะการใช้งาน `'active'` (นำไปคำนวณ demand) หรือ `'inactive'` (ปิดการใช้งาน/Soft-deleted)
8. เมื่อ `source = SHELTER_OVERRIDE` ต้องระบุฟิลด์ `shelter_code`; หากเป็น `SPHERE_BASELINE` ต้องไม่มีฟิลด์ `shelter_code`

### FR-02: โครงสร้างข้อมูลกลุ่มความต้องการสารอาหารและการแปลงหน่วยสินค้า (`requirement_group`)

1. ระบบต้องรองรับเอกสาร `requirement_group` (`schema_v: 1`) ในฐานข้อมูล `catalog` (ส่วนกลาง, `source = SPHERE_BASELINE`) และ `shelter_{shelter_code}` (ศูนย์ปรับแต่ง, `source = SHELTER_OVERRIDE`)
2. รูปแบบ Primary Key (`_id`): `"requirement_group:{group_id}"` (เช่น `"requirement_group:FOOD_ENERGY"`, `"requirement_group:FOOD_FAT"`, `"requirement_group:FOOD_PROTEIN"`)
3. ฟิลด์ `standard_uom` (เช่น `"kcal"`, `"gram"`, `"litre"`) ต้องถูกใช้เป็นค่าตั้งต้น (Auto-fill) สำหรับแสดงผลหน่วยนับในหน้าจอ Food Sphere Standard
4. ฟิลด์ `status` (req, default `'active'`): กำหนดสถานะการใช้งาน `'active'` (ใช้งานปกติ) หรือ `'inactive'` (ปิดการใช้งาน/Soft-deleted)
5. รายการ `item_maps[]` ประกอบด้วย:
   - `item_id`: `str (req)` อ้างอิง `item_master:{sku|ulid}`
   - `base_uom`: `str (req)` ดึงจาก `item_master.base_unit` (Read-only)
   - `conversion_factor`: `num > 0 (req)` ตัวคูณแปลงจาก Base UOM เป็น Standard UOM
   - `share_percent`: `num (opt)` สัดส่วนเป้าหมายในเมนู ($0 \le \text{share\_percent} \le 100$)
6. เมื่อผลรวม `share_percent` ของสินค้าในกลุ่มเดียวกัน $\ne 100\%$ ระบบต้องแสดงผล Warning แต่ไม่บล็อกการบันทึกข้อมูล (Non-blocking warning)
7. เมื่อ `source = SHELTER_OVERRIDE` ต้องระบุฟิลด์ `shelter_code`; หากเป็น `SPHERE_BASELINE` ต้องไม่มีฟิลด์ `shelter_code`

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
7. ฟิลด์ `status` (req, default `'active'`): กำหนดสถานะการใช้งาน `'active'` (มีผลประเมิน DoC) หรือ `'inactive'` (ปิดการใช้งาน/Soft-deleted)

### FR-04: สูตรและการคำนวณโภชนาการและการเติมสต็อก (Calculation Rules & Fallback Invariants)

1. **Standard Quantity Conversion:**
   $$\text{Standard Qty} = \text{Base Qty} \times \text{conversion\_factor}$$
2. **Total Daily Demand:**
   $$\text{Total Daily Demand} = \sum_{\text{segment}} (\text{Headcount}_{\text{segment}} \times \text{daily\_demand}_{\text{segment, group}})$$
   - *Status Filter Rule:* คำนวณเฉพาะเกณฑ์ที่มีสถานะ `(s.status ?? 'active') === 'active'` หากกลุ่มใดไม่มีเกณฑ์ active ให้ถือว่า Demand เป็น 0
   - *Segment Fallback Rule:* หากไม่มี `food_sphere_standard` ที่ active สำหรับคู่ `(target_segment, req_group_id)` ระบบต้อง fallback ไปใช้เกณฑ์ active ของ `target_segment = ALL` ภายใต้ `req_group_id` เดียวกัน (ห้าม fallback ข้าม `req_group_id`)
3. **Standard Reorder Days:**
   $$\text{Standard Reorder Days} = \text{lead\_time\_days} + \text{review\_period\_days} + \text{safety\_days}$$
4. **Days of Coverage (DoC) & Shortage Quantity:**
   $$\text{DoC (Days)} = \frac{\text{Current Stock Qty}}{\text{Total Daily Demand}}$$
   $$\text{Shortage Qty} = (\text{Standard Reorder Days} \times \text{Total Daily Demand}) - \text{Current Stock Qty}$$
5. **Policy Resolution Hierarchy with Status:**
   - ฟังก์ชัน `resolveItemPolicy` ค้นหานโยบายตามลำดับ Priority: `ITEM` $\rightarrow$ `REQUIREMENT_GROUP` $\rightarrow$ `GLOBAL`
   - กรองเฉพาะนโยบายที่มีสถานะ `(p.status ?? 'active') === 'active'` เท่านั้น ถ้านโยบายลำดับสูงถูกปิดใช้งาน ให้ fallback ตกไปใช้นโยบายระดับถัดไป
6. **Graceful DoC Fallback (Division-by-Zero / Unconfigured Handling):**
   - หาก $\text{Total Daily Demand} = 0$ หรือศูนย์ยังไม่ได้กำหนดนโยบายเติมสต็อกที่เป็น active ระบบต้องไม่คำนวณจนเกิดค่า $+\infty$ หรือ $\text{NaN}$
   - ระบบต้องคืนสถานะ `'UNCONFIGURED'` และแสดงข้อความ `"ยังไม่ได้ตั้งค่านโยบาย"` บนหน้าจอ

### FR-05: นโยบายการลบข้อมูลแบบ Soft-Delete (Delete-in-use Policy & Lifecycle)

1. **ห้ามทำ Hard-Delete เด็ดขาด:** ยกเลิกการเรียก `repo.remove(doc)` ใน Application และ Data Layer ทั้งหมด
2. **การลบ = ปรับสถานะเป็น Inactive:** เมื่อผู้ใช้กดลบ ระบบจะอัปเดตเอกสารเดิมด้วย `{ status: 'inactive', updated_at: now() }`
3. **การกู้คืน (Reactivate):** รองรับ Action ให้ผู้ใช้สามารถกดเปิดใช้งานกลับมาเป็น `active` ได้ตลอดเวลา
4. **กฎการแสดงผลใน Dropdown และ Form:**
   - การสร้างรายการใหม่: Dropdown ในหน้าจอ (เช่น เลือกกลุ่มความต้องการในเกณฑ์โภชนาการ หรือเลือก Target ในนโยบายเติมสต็อก) ต้องกรองเฉพาะ `status === 'active'`
   - การแก้ไขรายการเดิม (Edit Form): อนุญาตให้แสดงค่าเดิมได้ แม้ว่าค่านั้นจะมีสถานะเป็น `inactive` เพื่อป้องกันปัญหาค่าในฟอร์มว่างเปล่าหรือหลุดหาย
   - การแสดงผลในตารางประวัติ/Audit Trail: ไม่กรอง `status` ทิ้ง สามารถ resolve ชื่อและ UOM ผ่าน `items.find(i => i._id === id)` ได้ตามปกติ
5. **ความเข้ากันได้ย้อนหลัง (Backward Compatibility):**
   - Read-time Fallback: ใช้ `doc.status ?? 'active'` เสมอ
   - Additive Schema: คง `schema_v: 1` ไม่ต้องรัน Batch Migration

---

## 2. Seed Data Specifications (ชุดข้อมูลตั้งต้น)

### 2.1 Food Sphere Baseline (14 รายการใน `catalog`)

ทุกรายการกำหนดสถานะตั้งต้นเป็น `status: 'active'`

| ลำดับ | Target Segment | Requirement Group ID | Daily Demand | Standard UOM | Status | Effective Date | Source |
| :---: | :--- | :--- | :---: | :--- | :---: | :---: | :---: |
| 1 | `ALL` | `FOOD_ENERGY` | 2,100 | `kcal` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 2 | `ALL` | `FOOD_FAT` | 40 | `gram` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 3 | `ALL` | `FOOD_PROTEIN` | 53 | `gram` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 4 | `INFANT_0_6` | `FOOD_ENERGY` | 550 | `kcal` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 5 | `INFANT_6_23` | `FOOD_ENERGY` | 850 | `kcal` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 6 | `CHILD_2_5` | `FOOD_ENERGY` | 1,250 | `kcal` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 7 | `CHILD_2_5` | `FOOD_PROTEIN` | 25 | `gram` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 8 | `PREGNANT` | `FOOD_ENERGY` | 2,400 | `kcal` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 9 | `PREGNANT` | `FOOD_PROTEIN` | 70 | `gram` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 10 | `PREGNANT` | `FOOD_FAT` | 45 | `gram` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 11 | `LACTATING` | `FOOD_ENERGY` | 2,600 | `kcal` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 12 | `LACTATING` | `FOOD_PROTEIN` | 75 | `gram` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 13 | `ELDERLY` | `FOOD_ENERGY` | 1,900 | `kcal` | `active` | `2026-07-16` | `SPHERE_BASELINE` |
| 14 | `ELDERLY` | `FOOD_PROTEIN` | 60 | `gram` | `active` | `2026-07-16` | `SPHERE_BASELINE` |

### 2.2 Baseline Replenishment Policies (3 รายการใน `catalog`)

ทุกรายการกำหนดสถานะตั้งต้นเป็น `status: 'active'`

| ลำดับ | Scope Type | Target ID | Lead Time (วัน) | Review Period (วัน) | Safety Days (วัน) | Reorder Days รวม | Status | Source |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | `GLOBAL` | `DEFAULT` | 2 | 3 | 2 | 7 วัน | `active` | `SPHERE_BASELINE` |
| 2 | `REQUIREMENT_GROUP` | `FOOD_ENERGY` | 3 | 4 | 3 | 10 วัน | `active` | `SPHERE_BASELINE` |
| 3 | `REQUIREMENT_GROUP` | `FOOD_PROTEIN` | 2 | 2 | 2 | 6 วัน | `active` | `SPHERE_BASELINE` |

---

## 3. Impact & Affected Files

- **Docs:**
  - `docs/data/schema.md` §4.6 (`food_sphere_standard`), §4.7 (`requirement_group`), §4.8 (`replenishment_policy`), §7 (Index), §8 (Validation Rules)
  - `docs/changes/CR-058-food-warehouse-nutrition-kitchen-overhaul.md` (หมวดที่ 2)
  - `docs/changes/schema-update-sop-parameters-soft-delete.md`
  - `docs/task-breakdown/05-D-kitchen.md` (Task T-17 & T-22)
  - `docs/data/data-model.md` §4
- **Code:**
  - `frontend/src/lib/features/catalog/`
  - `frontend/src/lib/features/kitchen/`
  - `frontend/src/lib/features/sop-ratios/`
  - Seed scripts (`scripts/seed.ts` หรือ catalog seeders)
- **Tests:**
  - Unit tests สำหรับฟังก์ชันคำนวณ Daily Demand, DoC, Division-by-Zero fallbacks และการกรอง inactive policies/standards

---

## 4. Migration

- **Data Migration:** N/A — เพิ่มเติม Schemas ใหม่ทั้งหมด (`schema_v: 1` Purely Additive) โดยไม่มีผลกระทบต่อเอกสารเดิมในฐานข้อมูล
- **Read-time Fallback:** ใน Application และ Domain Layer ให้กำหนด Default ค่า `const status = doc.status ?? 'active';` จึงไม่จำเป็นต้องรัน Batch Migration
- **Seeding:** รัน Seeding Script เพื่อใส่ค่าเริ่มต้น 14 รายการ Sphere Baseline และ 3 รายการ Baseline Replenishment Policies เข้าฐานข้อมูล `catalog` (พร้อม `status: 'active'`)

---

## 5. Acceptance Criteria & Definition of Done

- [ ] **AC-01:** `docs/data/schema.md` ระบุสเปกระดับฟิลด์ของ `food_sphere_standard`, `requirement_group`, และ `replenishment_policy` ครบถ้วน พร้อมฟิลด์ `status` ('active' | 'inactive'), Index และ Validation Rules
- [ ] **AC-02:** Primary Key pattern ตรงตามมาตรฐาน: `food_sphere_standard:{target_segment}:{req_group_id}`, `requirement_group:{group_id}`, `replenishment_policy:{scope_type}:{target_id}`
- [ ] **AC-03:** Zod schemas และ Model Interfaces ฝั่ง client ตรวจสอบ Type, Positive number constraints, Enums และ `status` ตรงกับ Canonical Schema
- [ ] **AC-04:** ระบบคำนวณ DoC คืนค่า `'UNCONFIGURED'` (ไม่เกิด $+\infty$ / `NaN`) เมื่อ $\text{Demand} = 0$ หรือยังไม่ได้ตั้งค่านโยบาย
- [ ] **AC-05:** Seed data ทั้ง 14 รายการ Sphere Baseline และ 3 รายการ Replenishment Policies ถูกนำเข้าสู่ฐานข้อมูล `catalog` อย่างถูกต้อง พร้อม `status: 'active'`
- [ ] **AC-06:** ปฏิบัติตาม Delete-in-use policy โดยไม่มีการเรียก `repo.remove(doc)` สำหรับทั้ง 3 สกีมา แต่เป็นการ Soft-Delete ด้วยการอัปเดต `status: 'inactive'` และรองรับการ Reactivate กลับมาใช้งาน
- [ ] **AC-07:** ฟังก์ชันคำนวณ Daily Demand และ Policy Resolution กรองเฉพาะรายการที่เป็น active พร้อม Fallback ตามลำดับ Hierarchy ถูกต้อง

---

## 6. Decision Log

- 2026-08-26 — Proposed ตามแผนงาน `docs/plans/food-sphere-replenishment-schema-cr-plan.md` (เดิมกำหนดเลข CR-093)
- 2026-08-27 — เปลี่ยนหมายเลขเป็น CR-095 (เนื่องจาก CR-093 ซ้ำ) และปรับแต่ง ID prefix (`food_sphere_standard:`, `requirement_group:`) พร้อมเพิ่มฟิลด์ `standard_uom` ใน `food_sphere_standard` ให้ตรงตาม Code Implementation
- 2026-08-30 — เพิ่มข้อกำหนด Soft-Delete และฟิลด์ `status: 'active' | 'inactive'` (default `'active'`, read-time fallback) ให้กับทั้ง 3 สกีมาตาม `docs/changes/schema-update-sop-parameters-soft-delete.md` เพื่อรองรับ Delete-in-use policy ป้องกัน Orphaned references และรักษาประวัติการคำนวณย้อนหลังใน `daily_calc`
