---
id: draft
title: ย้ายการจัดการแก๊สและเชื้อเพลิงมายังคลังพัสดุ (Supply) + ปรับฟอร์ม FUEL_ENERGY (LPG) + บริหารจัดการถังจริงรายใบ (fuel_cylinder)
status: proposed
date: 2026-09-13
requested_by: Team Leader
decided_by: project owner 
layer: volatile
affects:
  - docs/data/schema.md §2.7.1 (ทดแทน gas_cylinder_type ด้วย fuel_cylinder — schema_v 1)
  - docs/data/schema.md §2.7.2 (gas_ledger อ้างอิง fuel_cylinder._id)
  - docs/data/schema.md §4.2 (item_master เพิ่มฟิลด์สเปกพลังงานสำหรับหมวด FUEL_ENERGY)
  - docs/task-breakdown/05-D-kitchen.md T-25/T-26
  - frontend/src/lib/features/catalog/domain/catalog.ts
  - frontend/src/lib/features/catalog/ui/item-master-form.svelte
  - frontend/src/lib/features/operations/ui/stock-table.svelte
  - frontend/src/lib/features/operations/ui/receive-stock-form.svelte
  - frontend/src/lib/features/kitchen/domain/kitchen.ts
  - frontend/src/lib/features/kitchen/ui/meal-plan-form.svelte
  - frontend/src/lib/features/kitchen/ui/gas-management.svelte
  - frontend/src/lib/server/shelter-access-design.ts
  - frontend/src/routes/(protected)/back-office/kitchen/gas/+page.svelte
  - frontend/scripts/seed.ts
---

# ย้ายการจัดการแก๊สและเชื้อเพลิงมายังคลังพัสดุ (Supply) + ปรับฟอร์ม FUEL_ENERGY (LPG) + บริหารจัดการถังจริงรายใบ (fuel_cylinder)

> **สรุป (TL;DR):** ย้ายความรับผิดชอบการจัดการแก๊สจากโรงครัวมาที่คลังพัสดุ (Supply) · ปรับฟอร์ม `ItemMaster` เมื่อเลือกหมวด `item_category:fuel_energy` ให้ล็อคเฉพาะแก๊ส LPG พร้อมแสดงฟิลด์สเปกพลังงาน (`capacity_kg`, `burn_rate_kg_per_hour`, `time_multiplier`) และล็อคหน่วยฐานเป็น "ถัง" · ใช้โมเดล 2 ระดับ: Catalog เป็นสเปกชนิดแก๊ส + สร้าง Document Type ใหม่ `fuel_cylinder` จัดการถังจริงรายใบในคลัง (ผูก `item_master_id`) · แสดงผลในตารางพัสดุคลังด้วยยอด `X ถัง (Y กก.)` แบบไฮบริด (Inline Expand สรุปเร็ว + Dedicated Modal จัดการเต็มรูปแบบ) · ระบบ Dev/Test ใช้ Clean Replacement และเพิ่มข้อมูลเริ่มต้นใน `seed.ts` โดยไม่ทำสคริปต์ Database Migration

---

## 1. Why (บริบทและความจำเป็น)

1. **ขอบเขตหน้าที่ไม่ตรงกับความเป็นจริงหน้างาน (Role & Boundary Mismatch):**
   เดิมระบบบันทึกและจัดการถังแก๊สถูกฝังอยู่ในส่วนของโรงครัว (`/back-office/kitchen/gas` ภายใต้ CR-025 และ CR-086) แต่ในทางปฏิบัติศูนย์อพยพ แก๊สหุงต้มเป็นพัสดุที่รับเข้าผ่านการบริจาคหรือจัดซื้อเข้าคลังกลาง (Supply Warehouse) ฝ่ายคลังต้องเป็นผู้ตรวจนับจำนวนถัง สต็อกแก๊สคงเหลือรวม และจัดการส่งเติมถังเปล่า
2. **การสอดรับกับ Master Category ระบบ (`FUEL_ENERGY` ใน PR #272):**
   ตามข้อกำหนด Seed Categories มีการกำหนดหมวดหมู่ระบบคือ `FUEL_ENERGY` (`item_category:fuel_energy`) แต่ปัจจุบันหน้าฟอร์มสร้าง `ItemMaster` ยังเป็นฟอร์มแบบเดียวสำหรับสินค้าทั่วไป (แสดงช่องวันหมดอายุ สารก่อภูมิแพ้ โภชนาการ) ขาดการรองรับฟิลด์คุณสมบัติทางพลังงานและวิศวกรรมที่โรงครัวต้องนำไปคำนวณการประกอบอาหาร
3. **ปัญหา Mental Model ของถังแก๊ส (Catalog vs Reusable Container Asset):**
   เดิม `gas_cylinder_type` 1 เอกสารถูกใช้แทน "ถังจริง 1 ใบ" ทำให้เกิดความสับสนระหว่าง "ชนิด/รุ่นของถัง" กับ "ตัวถังจริงที่มีหมายเลขกำกับ" การปรับมาใช้โมเดล 2 ระดับ (Item Master = สเปกชนิดแก๊ส, `fuel_cylinder` = ถังจริงรายใบที่ผูกกับ Master) ช่วยให้ระบบขยายตัวได้ถูกต้องตามหลัก Master Data โดยถังแก๊สเป็น Reusable Container Asset ที่วนรอบสถานะ: เต็ม -> กำลังใช้ -> หมด -> เติมใหม่
4. **ความเรียบง่ายในสภาพแวดล้อมก่อนใช้งานจริง (Pre-production Simplicity):**
   เนื่องจากระบบยังอยู่ในขั้นตอนการพัฒนาและทดสอบ (Dev/Test) ฐานข้อมูลสามารถ Clean/Reset หรือ Re-seed ใหม่ได้ตลอดเวลา จึงไม่จำเป็นต้องเขียนและดูแลสคริปต์ Database Migration ที่ซับซ้อน แต่ให้ใช้การ Clean Replacement เพื่อลด Technical Debt ใน Codebase

---

## 2. Change (เปรียบเทียบก่อนและหลังปรับปรุง)

| มิติ | ก่อนปรับปรุง (Before) | หลังปรับปรุง (After) |
| :--- | :--- | :--- |
| **1. หน้าจอรับผิดชอบหลัก** | อยู่ที่โรงครัว (`/back-office/kitchen/gas`) ดูแลโดยเจ้าหน้าที่ครัว | ย้ายมาอยู่ที่คลังพัสดุ (`/back-office/supply` แท็บรายการพัสดุ) ดูแลโดยเจ้าหน้าที่คลัง |
| **2. ฟอร์ม Item Master หมวดเชื้อเพลิง** | แสดงฟิลด์อาหาร/ยา (Allergens, Dietary, Storage Type, Expiry) ไม่มีฟิลด์แก๊ส | ซ่อนฟิลด์อาหาร/ยา แสดงเฉพาะสเปกแก๊ส LPG (`capacity_kg`, `burn_rate`, `multiplier`) พร้อมล็อคหน่วยฐานเป็น "ถัง" อัตโนมัติ |
| **3. โครงสร้างข้อมูลถังแก๊ส** | `gas_cylinder_type` (schema_v 2) เป็นเอกสารเดี่ยวๆ ผูกติดกับระบบครัว | สร้างเอกสารใหม่ **`fuel_cylinder`** (schema_v 1) เชื่อมโยงกับ `item_master_id` และระบุรหัสถังกำกับ (`cylinder_code`) |
| **4. ความสัมพันธ์ของ Ledger** | `gas_ledger` แยกเดี่ยวแต่เข้าถึงได้เฉพาะหน้าครัว | คง `gas_ledger` เป็น Dedicated Ledger ต่อถังรายใบ ไม่รวมเข้า `stock_ledger` โดยคลังสินค้าเป็นผู้บันทึก Refill/Adjust |
| **5. การแสดงผลในตารางสต็อกคลัง (Stock Table)** | ไม่มียอดแก๊สในตารางคลังสินค้า หรือแสดงเฉพาะหน่วยชิ้นโดยไม่รู้ปริมาณแก๊สข้างใน | แสดงเป็นแถวพัสดุหมวด `FUEL_ENERGY` มียอดคงเหลือทั้งจำนวนถังและน้ำหนักแก๊สรวม เช่น `3 ถัง (45.0 กก.)` |
| **6. การเข้าถึงและการจัดการถัง** | ต้องเปิดเข้าหน้าครัว `/back-office/kitchen/gas` เท่านั้น | รองรับรูปแบบไฮบริด: คลี่แถว (Expandable Row) ดูสรุปเร็ว และมีปุ่มเปิด Dedicated Dialog จัดการถังเต็มรูปแบบ |
| **7. การลงทะเบียนถังใหม่** | กรอกสร้างทีละถังในหน้าครัว เริ่มต้นเป็นถังเปล่า | เพิ่มถังเดี่ยวหรือสร้างเป็นชุด (Batch) Auto-detect รหัสถังถัดไป มี Checkbox ค่าเริ่มต้นเป็น "ถังเต็มพร้อมใช้" (Full Tank) |
| **8. บทบาทของโรงครัว** | ต้องคอยสร้างถังและกดเติมแก๊สเอง | เมนูครัวเปลี่ยนเป็น Read-Only Overview ดูถังที่กำลังใช้ พร้อมลิงก์ไปคลังสินค้า และคงการตัดแก๊สตาม Meal Plan |
| **9. ยุทธศาสตร์ข้อมูลเดิม** | มีสคริปต์ Migration ย้ายเอกสารเดิม | Clean Replacement: ตัดสคริปต์ Migration ออก และเพิ่ม Seed Data มาตรฐานใน `seed.ts` |

---

## 3. Data Model & Schema Specification

### 3.1 ขยาย `item_master` (Catalog DB / Shelter DB) — `docs/data/schema.md` §4.2

เมื่อ `item_master.category` มีค่าเป็น `item_category:fuel_energy` จะจำกัดและรองรับเฉพาะแก๊ส LPG ในเฟสนี้:

| Field | Type | Req/Opt | รายละเอียด / ข้อกำหนด |
| :--- | :--- | :---: | :--- |
| `fuel_type` | `'LPG'` | Req | ชนิดเชื้อเพลิง; กำหนดค่าคงที่เป็น `'LPG'` อัตโนมัติเมื่อเลือกหมวดเชื้อเพลิง |
| `capacity_kg` | `qty_str > 0` | Req | น้ำหนักบรรจุแก๊สมาตรฐานต่อถัง (kg) เช่น `"15"`, `"48"`, `"4"` |
| `burn_rate_kg_per_hour` | `qty_str > 0` | Req | อัตราสิ้นเปลืองมาตรฐาน (kg/ชม.) เช่น `"0.5"` |
| `time_multiplier` | `qty_str > 0` | Opt | ตัวคูณเวลาประกอบอาหารมาตรฐาน (default `"1"`) |
| `base_unit` | `'ถัง'` | Req | ล็อคค่าเป็น `"ถัง"` อัตโนมัติ ไม่อนุญาตให้แก้ไขเป็นหน่วยอื่น |

*ข้อกำหนดการจัดเก็บ:* ซ่อนและตัดฟิลด์ที่ไม่เกี่ยวข้อง (`shelf_life_days`, `storage_type`, `allergens`, `dietary`, `target_gender`, `age_group`, `qty_per_person`, `returnable`, `asset_status`) ออกจากเอกสาร

---

### 3.2 Document Type ใหม่: `fuel_cylinder` (Shelter DB) — `docs/data/schema.md` §2.7.1 (ทดแทน `gas_cylinder_type`)

เอกสารตัวแทนถังจริง 1 ใบในศูนย์อพยพ จัดเก็บในฐานข้อมูล `shelter_{shelter_code}` (สืบทอด `BaseDoc` โดยมี `shelter_code`, `created_at`, `updated_at`, `created_by`):
**Pattern `_id`:** `fuel_cylinder:{ulid}` · **schema_v:** `1` · **Mutable (LWW)**

| Field | Type | Req/Opt | รายละเอียด / ข้อกำหนด |
| :--- | :--- | :---: | :--- |
| `type` | `'fuel_cylinder'` | Req | ค่าคงที่ `'fuel_cylinder'` |
| `schema_v` | `1` | Req | เวอร์ชันเอกสาร |
| `item_master_id` | `str` | Req | รหัสอ้างอิง `item_master._id` ต้นทางในหมวด `FUEL_ENERGY` |
| `cylinder_code` | `str` | Req | รหัสถังกำกับที่ติดบนตัวถังจริง เช่น `"TANK-01"`, `"LPG-01"` (Unique ภายในศูนย์, Trim, Case-insensitive) |
| `name` | `str` | Req | ชื่อหรือป้ายระบุถัง เช่น `"เตาแก๊สหลัก 1"`, `"เตาต้มน้ำซุป"` |
| `capacity_kg` | `qty_str > 0` | Req | ความจุน้ำหนักแก๊สของถังใบนี้ (kg) — ดึงจาก `item_master` เป็นค่าเริ่มต้น (สามารถ override ได้) |
| `burn_rate_kg_per_hour` | `qty_str > 0` | Req | อัตราเผาผลาญของหัวเตาที่ต่อกับถังนี้ (kg/ชม.) |
| `time_multiplier` | `qty_str > 0` | Req | ตัวคูณเวลาประกอบอาหาร (default `"1"`) |
| `tare_weight_kg` | `qty_str > 0` | Opt | น้ำหนักถังเปล่ามาตรฐาน (kg) สำหรับกรณีชั่งน้ำหนักตรวจเช็ค |
| `deactivated` | `boolean` | Opt | Flag ระบุถังชำรุด เลิกใช้งาน หรือปลดระวาง (`true` = ซ่อนจากรายการเลือกในครัวและสต็อกพร้อมใช้) |

#### สถานะถัง (Computed Lifecycle Status — ห้ามเก็บ running total):
$$\text{remaining\_kg} = \sum_{e \in \text{gas\_ledger}} e\text{.qty\_kg (สำหรับ cylinder\_id นี้)}$$

- **`deactivated` (ชำรุด/ปลดระวาง):** เมื่อ `deactivated === true`
- **`unused` (ยังไม่ใช้ / ถังเต็ม):** เมื่อ `remaining_kg >= capacity_kg`
- **`in_use` (กำลังใช้งาน):** เมื่อ `0 < remaining_kg < capacity_kg`
- **`empty` (ถังเปล่า / หมดแล้ว):** เมื่อ `remaining_kg <= 0`

---

### 3.3 `gas_ledger` (Shelter DB) — `docs/data/schema.md` §2.7.2 (คงเดิม)

ยังคงใช้โครงสร้าง `gas_ledger` เดิม (schema_v 1, Append-only) โดยเปลี่ยนฟิลด์ `cylinder_id` ให้ชี้ไปยัง `fuel_cylinder._id`:

| Field | Type | Req/Opt | รายละเอียด |
| :--- | :--- | :---: | :--- |
| `type` | `'gas_ledger'` | Req | ค่าคงที่ |
| `cylinder_id` | `str` | Req | อ้างอิง `fuel_cylinder._id` |
| `qty_kg` | `qty_str` (signed, non-zero) | Req | ลบ = เบิกใช้ (`consumption`)/ตัดเศษ (`adjust`), บวก = เติมแก๊ส (`refill`) |
| `reason` | enum(`consumption`, `refill`, `adjust`) | Req | วัตถุประสงค์รายการ |
| `ref_id` | `str \| null` | Opt | `meal_plan_id` เมื่อ `reason = 'consumption'`; `null` เมื่อ `refill`/`adjust` |
| `occurred_at` | `ts` | Req | เวลาที่เกิดรายการจริง |

---

### 3.4 สิทธิ์และการเข้าถึง (CouchDB `_design/access`)

ปรับปรุงไฟล์ `frontend/src/lib/server/shelter-access-design.ts`:
- นำ `'gas_cylinder_type'` ออกจาก `allowed` doc types list และแทนที่ด้วย `'fuel_cylinder'`
- กำหนดให้สิทธิ์ `warehouse_staff`, `shelter_manager`, และ `system_admin` สามารถสร้าง แก้ไข และ deactivate `fuel_cylinder` ได้
- `gas_ledger` อนุญาตให้ `kitchen_staff`, `warehouse_staff`, `shelter_manager`, และ `system_admin` เขียนได้เพื่อรองรับ atomic commit ใน `issueRequisition` และการเติม/ตัดเศษแก๊สจากคลัง

---

## 4. Requirements (ข้อกำหนดระบบ)

### 4.1 ฟอร์ม Item Master ใน Catalog (Catalog Form Adaptation)
- **FR-01 (Dynamic LPG Specs Section):** ในหน้าสร้าง/แก้ไขสินค้า (`item-master-form.svelte`) เมื่อผู้ใช้เลือกหมวดหมู่เป็น `item_category:fuel_energy` ระบบต้องสลับการแสดงผลอัตโนมัติ:
  - ซ่อนเซกชัน: อายุการเก็บรักษา (Shelf Life), สภาพการจัดเก็บ (Storage Type), สารก่อภูมิแพ้ (Allergens), ข้อกำหนดโภชนาการ (Dietary), สินค้าคงทน/ครุภัณฑ์
  - แสดงเซกชัน: **"คุณสมบัติแก๊สหุงต้ม LPG (LPG Fuel Specifications)"**
- **FR-02 (Single Fuel Scope - LPG):** กำหนดชนิดเชื้อเพลิงเป็น `LPG` เสมอในเฟสนี้ ไม่ต้องแสดง Dropdown เลือกชนิดเชื้อเพลิงหลายตัว
- **FR-03 (LPG Engineering Parameters):** บังคับกรอกสเปกวิศวกรรมสำหรับแก๊ส LPG:
  - `capacity_kg`: ตัวเลขทศนิยมบวก (> 0) ระบุน้ำหนักแก๊สบรรจุมาตรฐาน (เช่น `"15"`)
  - `burn_rate_kg_per_hour`: ตัวเลขทศนิยมบวก (> 0) ระบุอัตราเผาผลาญมาตรฐาน (เช่น `"0.50"`)
  - `time_multiplier`: ตัวเลขทศนิยมบวก (ค่าเริ่มต้น `"1.0"`)
- **FR-04 (Auto Base Unit Locking):** เมื่อเลือกหมวด `item_category:fuel_energy` ระบบต้องตั้งค่าและล็อคช่อง `base_unit` เป็น `"ถัง"` โดยอัตโนมัติ (Disabled ไม่ให้พิมพ์แก้)

### 4.2 ตารางรายการพัสดุในคลัง (Supply Stock Table & Hybrid UX)
- **FR-05 (Stock Balance Dual Display):** ในตารางรายการพัสดุ (`stock-table.svelte`) เมื่อแสดงแถวสินค้าในหมวด `FUEL_ENERGY` คอลัมน์ "จำนวนคงเหลือ" ต้องแสดงผลทั้งจำนวนถังที่ใช้งานได้และน้ำหนักแก๊สรวม เช่น `"3 ถัง (38.5 กก.)"` (คำนวณจากผลรวม `remaining_kg` ของถังที่มีสถานะ `unused` หรือ `in_use` และ `!deactivated`)
- **FR-06 (Inline Expandable Row):** แถวของไอเทมแก๊สในตารางหลักมีปุ่มขยายแถว (Chevron icon) เพื่อคลี่ดูรายการสรุปถังแก๊สจริงทั้งหมดใต้แถวนั้นได้อย่างรวดเร็ว
- **FR-07 (Dedicated Cylinder Modal):** มีปุ่ม "จัดการถังแก๊ส" ในคอลัมน์การจัดการ (Actions) ของแถวสินค้า เพื่อเปิด Dialog จัดการถังแบบเต็มจอ รองรับการจัดการถังทั้งหมด การเติมแก๊ส ตัดเศษ และการสร้างถังใหม่
- **FR-08 (Batch Cylinder Generation with Auto-Sequence):** ในการสร้างถังแก๊สใหม่ สามารถเลือกสร้างเป็นชุด (Batch) โดย:
  - ระบุ Prefix (ค่าเริ่มต้น `"LPG-"`) และจำนวนถังที่ต้องการสร้าง
  - ระบบค้นหาเลขรหัสสูงสุดเดิมที่มี Prefix เดียวกันในศูนย์โดยอัตโนมัติ และรันลำดับถัดไปด้วยเลข 2 หลัก (เช่น มี `LPG-02` แล้ว ถัดไปจะสร้าง `LPG-03`, `LPG-04`..)
  - แสดงหน้าต่างพรีวิวรายการรหัสและชื่อถังให้ตรวจสอบหรือแก้ไขก่อนกดยืนยันบันทึก
  - ตรวจสอบความซ้ำซ้อนของ `cylinder_code` ภายในศูนย์ (Unique Validation)

### 4.3 ธุรกรรมถังแก๊สในคลัง (Cylinder Actions)
- **FR-09 (Initial Full Tank Checkbox):** ในฟอร์มสร้างถังใหม่ (ทั้งเดี่ยวและชุด) มี Checkbox **"บันทึกเป็นถังเต็มพร้อมใช้งาน (Full Tank)"** โดยมีค่าเริ่มต้นเป็น Checked (ติ๊กถูก)
  - หากติ๊กถูก: สร้างเอกสาร `fuel_cylinder` พร้อมบันทึก `gas_ledger` (`reason: 'refill'`, `qty_kg: capacity_kg`) ทันที (สถานะถังเป็น `unused`)
  - หากไม่ติ๊กถูก: สร้างเฉพาะเอกสาร `fuel_cylinder` โดยไม่มี ledger (ยอดเหลือเริ่มต้นเป็น 0, สถานะถังเป็น `empty`)
- **FR-10 (Refill Action):** ปุ่ม "เติมแก๊ส" เปิด Dialog ให้ระบุน้ำหนักแก๊สที่เติม (kg) โดยคำนวณขีดจำกัดสูงสุดที่ไม่เกินความจุ (`maxRefillKg = capacity_kg - remaining_kg`) เมื่อกดยืนยัน บันทึกเอกสาร `gas_ledger` (`reason: 'refill'`, `qty_kg: +amount`)
- **FR-11 (Write-off / Adjust Action):** ปุ่ม "ตัดเศษแก๊ส" มี AlertDialog ยืนยัน เมื่อยืนยัน บันทึกเอกสาร `gas_ledger` (`reason: 'adjust'`, `qty_kg: -remaining_kg`) เพื่อปรับยอดคงเหลือให้เป็น 0 พอดี และบล็อกการกดซ้ำหากถังมียอดเหลือ <= 0 อยู่แล้ว
- **FR-12 (Deactivate Cylinder):** ปุ่ม "ปลดระวาง/ชำรุด" ทำการบันทึก `deactivated: true` บนเอกสาร `fuel_cylinder` ถังที่ปลดระวางจะไม่ถูกนำไปคำนวณในสต็อกที่พร้อมใช้ และไม่ปรากฏในตัวเลือกของโรงครัว

### 4.4 การเชื่อมโยงกับการรับเข้าพัสดุ (Receive Stock Integration)
- **FR-13 (Receive Stock Auto-Gen):** ในหน้าต่างรับเข้าพัสดุ (`receive-stock-form.svelte`) เมื่อเลือกรายการสินค้าที่เป็นแก๊ส LPG และกรอกจำนวนถังที่รับเข้า ระบบต้องมีตัวเลือกว่า:
  - "ลงทะเบียนเป็นถังใหม่": ระบุ Prefix เพื่อสร้าง `fuel_cylinder` พร้อมบันทึก `gas_ledger` เติมเต็มความจุอัตโนมัติ
  - "เติมแก๊สเข้าถังเดิมที่มีอยู่": เลือกถังที่มีสถานะ `empty` เพื่อบันทึกการเติมกลับ

### 4.5 การใช้งานฝั่งโรงครัวและความเข้ากันได้ (Kitchen Flow Continuity)
- **FR-14 (Meal Plan Cylinder Selection & Atomic Requisition):**
  - ในหน้าจัดทำแผนอาหาร (`meal-plan-form.svelte`) ตัวเลือกถังแก๊สดึงข้อมูลจาก `fuel_cylinder` (เฉพาะถังที่ `!deactivated` และสถานะไม่เป็น `empty`)
  - เมื่อครัวกดเบิกจ่ายแผนอาหาร (`issueRequisition`) ระบบต้องตัดยอดแก๊สลง `gas_ledger` (`reason: 'consumption'`) พร้อมกับ `stock_ledger` ของวัตถุดิบอาหารในธุรกรรม `bulkDocs` เดียวกันแบบ Atomic หากแก๊สไม่พอต้อง Throw บล็อกทั้งหมด
- **FR-15 (Kitchen Route Read-Only Overview):** หน้าจอ `/back-office/kitchen/gas` ปรับเป็นหน้าสรุปมุมมองของครัว (Kitchen View - Read Only) แสดงถังที่กำลังใช้งานในครัว ปริมาณแก๊สคงเหลือรวม และมีปุ่ม Action ชัดเจน: "จัดการคลังถังแก๊ส (ไปที่คลังสินค้า)" นำทางไปยัง `/back-office/supply?tab=inventory&category=item_category:fuel_energy`

---

## 5. User Interface Specifications & Layout

### 5.1 ฟอร์ม Item Master — ส่วนคุณสมบัติพลังงาน (LPG Only)
```
+-------------------------------------------------------------------------+
| หมวดหมู่: เชื้อเพลิงและพลังงาน (FUEL_ENERGY)                            |
+-------------------------------------------------------------------------+
| [✓] ข้อมูลคุณสมบัติเฉพาะ: แก๊สหุงต้ม LPG                                 |
|                                                                         |
| [ความจุกระบอก/ถัง (kg)] *      [อัตราสิ้นเปลือง (kg/ชม.)] *             |
| [ 15                  ]        [ 0.50                 ]                 |
|                                                                         |
| [ตัวคูณเวลาปรุงอาหาร]          [หน่วยฐาน (Base UOM)]                    |
| [ 1.00                ]        [ ถัง (ถูกล็อคอัตโนมัติ) ]              |
+-------------------------------------------------------------------------+
```

### 5.2 ตารางรายการพัสดุในคลัง — รูปแบบไฮบริด (Inline Expand + Dedicated Dialog)
```
+-----------------------------------------------------------------------------------------------+
| ชื่อพัสดุ              | หมวดหมู่      | คงเหลือ          | สถานะ  | จัดการ                    |
+-----------------------------------------------------------------------------------------------+
| [v] แก๊สหุงต้ม LPG 15kg | เชื้อเพลิง    | 3 ถัง (38.5 กก.)  | ปกติ   | [จัดการถัง] [รับเข้า] [...] |
|   +-----------------------------------------------------------------------------------------+ |
|   | สรุปถังแก๊สในศูนย์ (3 ถัง):                                      [เปิดหน้าต่างจัดการเต็มจอ] | |
|   | --------------------------------------------------------------------------------------- | |
|   | รหัสถัง    | ชื่อป้ายกำกับ        | แก๊สคงเหลือ / ความจุ     | สถานะ      | การจัดการ      | |
|   | LPG-01    | เตาแก๊สหลัก 1        | [====----]  8.5 / 15 kg | [กำลังใช้] | [เติม] [ตัดเศษ] | |
|   | LPG-02    | เตาต้มน้ำซุป          | [========] 15.0 / 15 kg | [ยังไม่ใช้] | [เติม] [ตัดเศษ] | |
|   | LPG-03    | ถังสำรอง             | [========] 15.0 / 15 kg | [ยังไม่ใช้] | [เติม] [ตัดเศษ] | |
|   +-----------------------------------------------------------------------------------------+ |
| น้ำดื่มสะอาด 600ml     | น้ำดื่มสะอาด  | 1,200 ขวด        | ปกติ   | [เบิกจ่าย] [รับเข้า] [...] |
+-----------------------------------------------------------------------------------------------+
```

---

## 6. Impact & Traceability (การวิเคราะห์ผลกระทบ)

### 6.1 เอกสารที่ได้รับผลกระทบ
- `docs/data/schema.md` §2.7.1: ปรับเอกสารเป็น `fuel_cylinder` (schema_v 1) แทนที่ `gas_cylinder_type` พร้อมอธิบายความสัมพันธ์กับ `item_master`
- `docs/data/schema.md` §2.7.2: อัปเดต `cylinder_id` ใน `gas_ledger` ให้ชี้ไปยัง `fuel_cylinder`
- `docs/data/schema.md` §4.2: เพิ่มฟิลด์ทางเลือกสำหรับสเปกพลังงานใน `item_master`
- `docs/task-breakdown/05-D-kitchen.md`: ปรับ Task T-25 และ T-26 ให้ชี้ไปยัง `fuel_cylinder`
- `docs/changes/_index.md`: ลงทะเบียน Change Record เมื่องานนี้ได้รับการอนุมัติ

### 6.2 ซอร์สโค้ดที่ได้รับผลกระทบ
- `frontend/src/lib/features/catalog/domain/catalog.ts`: เพิ่ม Zod Schemas และ Fields ใน Interface `ItemMaster`
- `frontend/src/lib/features/catalog/ui/item-master-form.svelte`: ปรับฟอร์มแสดงสเปกแก๊ส LPG และล็อคหน่วยฐานเป็น "ถัง"
- `frontend/src/lib/features/operations/ui/stock-table.svelte`: เพิ่มกลไกไฮบริด (Inline Expand + Dedicated Dialog) และคำนวณผลรวมน้ำหนักแก๊ส
- `frontend/src/lib/features/operations/ui/receive-stock-form.svelte`: รองรับการ Gen รหัสถังแก๊สเมื่อรับเข้าพัสดุหมวดเชื้อเพลิง
- `frontend/src/lib/features/kitchen/domain/kitchen.ts` & `gas-ledger.ts`: นิยาม `FuelCylinder` ทดแทน `GasCylinderType`
- `frontend/src/lib/features/kitchen/data/kitchen.remote.ts`: ปรับ Query และ Mutation ให้ชี้ไปยัง `fuel_cylinder`
- `frontend/src/lib/features/kitchen/ui/meal-plan-form.svelte`: ปรับการดึงข้อมูลถังแก๊สจาก `fuel_cylinder`
- `frontend/src/lib/server/shelter-access-design.ts`: ถอด `gas_cylinder_type` ออก และเพิ่ม `fuel_cylinder` ใน `allowed` types
- `frontend/src/routes/(protected)/back-office/kitchen/gas/+page.svelte`: ปรับปรุงหน้าจอเป็น Read-only view ชี้ทางไปยัง Supply
- `frontend/scripts/seed.ts`: Seed Item Master "แก๊สหุงต้ม LPG 15 กก." ใน Catalog และ 3 ถังตัวอย่างในศูนย์ `SH001`

---

## 7. Legacy Cleanup & Seed Data (การแทนที่ Schema และข้อมูลเริ่มต้น)

เนื่องจากระบบปัจจุบันอยู่ในระยะก่อนใช้งานจริง (Pre-production / Dev-test phase) ฐานข้อมูลสามารถล้างข้อมูล (Wipe/Reset) ได้ จึงไม่มีความจำเป็นต้องพัฒนาสคริปต์ Database Migration โดยมีแนวปฏิบัติดังนี้:

1. **Clean Schema Replacement:**
   - ถอดนิยามและฟังก์ชันที่เกี่ยวข้องกับ `gas_cylinder_type` ออกจาก Codebase ทั้งหมด และแทนที่ด้วย `fuel_cylinder`
   - ปรับปรุง `frontend/src/lib/server/shelter-access-design.ts` ให้ถอด `gas_cylinder_type` ออกจากสิทธิ์ของฐานข้อมูลศูนย์ และเพิ่ม `fuel_cylinder` แทนที่
   - รันคำสั่ง `pnpm redeploy:access` เพื่ออัปเดต design document ของ CouchDB
2. **Seed Data Integration (`frontend/scripts/seed.ts`):**
   - **Catalog DB (`seedCatalog`):** เพิ่ม Item Master มาตรฐานสำหรับแก๊สหุงต้ม:
     ```typescript
     {
       _id: 'item_master:lpg_15kg',
       type: 'item_master',
       name: 'แก๊สหุงต้ม LPG 15 กิโลกรัม',
       category: 'item_category:fuel_energy',
       base_unit: 'ถัง',
       fuel_type: 'LPG',
       capacity_kg: '15',
       burn_rate_kg_per_hour: '0.50',
       time_multiplier: '1.0',
       distribution_type: 'recurring',
       type_class: 'CONSUMABLE'
     }
     ```
   - **Shelter DB (`seedShelter` สำหรับ `SH001`):** เพิ่มเอกสาร `fuel_cylinder` 3 ใบจำลองสถานการณ์จริง:
     - `LPG-01`: ถังเต็ม (`remaining_kg = 15`, สถานะ `unused`, มี ledger `refill: 15`)
     - `LPG-02`: กำลังใช้งานที่เตาหลัก (`remaining_kg = 8.5`, สถานะ `in_use`, มี ledger `refill: 15` และ `consumption: -6.5`)
     - `LPG-03`: ถังเปล่ารอส่งเติม (`remaining_kg = 0`, สถานะ `empty`, ไม่มีการบันทึกแก๊สคงเหลือ)

---

## 8. Acceptance Criteria & Definition of Done (เกณฑ์การตรวจรับ)

- [ ] **AC-01 (Form Adaptation):** เมื่อสร้างหรือแก้ไข Item Master แล้วเลือกหมวดหมู่เป็น `item_category:fuel_energy` เซกชันอาหาร/ยาต้องถูกซ่อน และเซกชันคุณสมบัติแก๊ส LPG ปรากฏขึ้นพร้อมบังคับกรอก `capacity_kg` และ `burn_rate_kg_per_hour`
- [ ] **AC-02 (Item Creation & Unit Lock):** บันทึก Item Master แก๊สสำเร็จ ฟิลด์ `base_unit` ถูกล็อคและจัดเก็บเป็น `"ถัง"` และ `fuel_type` เป็น `'LPG'`
- [ ] **AC-03 (Stock Table Dual Display):** ในหน้าคลังสินค้าแท็บพัสดุ แถวของไอเทมแก๊สแสดงยอดคงเหลือเป็น `"X ถัง (Y กก.)"` ถูกต้องตรงตามผลรวมของถังที่ใช้งานได้จริง
- [ ] **AC-04 (Hybrid UI - Expand & Modal):** สามารถกดคลี่แถวเพื่อดูสรุปสถานะถังย่อยในตารางได้ และมีปุ่มเปิด Dialog จัดการถังแก๊สเต็มรูปแบบ
- [ ] **AC-05 (Batch Generation with Auto-Sequence):** สามารถสร้างถังแก๊สใหม่เป็นชุดโดยระบุ Prefix ระบบสแกนหาเลขรหัสถัดไปอัตโนมัติ พร้อมหน้าต่าง Preview ก่อนกดยืนยันสร้าง
- [ ] **AC-06 (Initial Full Tank Option):** หน้าลงทะเบียนถังใหม่มี Checkbox "ถังเต็มพร้อมใช้" ติ๊กถูกเป็นค่าเริ่มต้น เมื่อบันทึกจะได้ถังสถานะ `unused` พร้อมประวัติ `gas_ledger` รายการแรกทันที
- [ ] **AC-07 (Refill & Adjust in Supply):** เจ้าหน้าที่คลังสามารถกดเติมแก๊ส (Refill) หรือตัดเศษแก๊ส (Adjust) ได้ ยอดคงเหลือของถังและยอดรวมในตารางอัปเดตแบบ Reactive ทันที
- [ ] **AC-08 (Kitchen Continuity):** หน้าสร้าง Meal Plan ของโรงครัวสามารถเลือกถังที่ลงทะเบียนในคลังได้ และเมื่อทำการเบิกจ่าย ยอดแก๊สถูกหักจากถังที่เลือกแบบ Atomic ร่วมกับการตัดวัตถุดิบอาหาร
- [ ] **AC-09 (Seed Data Validation):** เมื่อรัน `pnpm seed` สำเร็จ มี Item Master แก๊ส LPG ใน Catalog และมีถังตัวอย่าง 3 ใบในศูนย์ `SH001` แสดงผลในระบบคลังและครัวทันที

---

## 9. Decision Log

- **2026-09-13 (Decision 1 - Mental Model):** เลือกใช้โมเดล 2 ระดับ (Two-Level Architecture): `item_master` ใน Catalog เป็นสเปกชนิดแก๊ส + `fuel_cylinder` ในศูนย์เป็นรายการถังจริงรายใบ เพื่อความเป็นระเบียบของ Master Data และรองรับการจัดการถังหลายใบในศูนย์
- **2026-09-13 (Decision 2 - Dynamic Form):** กำหนดให้ฟอร์ม Item Master สลับโหมดไดนามิกเมื่อเลือกหมวดหมู่ `item_category:fuel_energy` เพื่อแสดงฟิลด์สเปกพลังงาน (`capacity_kg`, `burn_rate_kg_per_hour`, `time_multiplier`) แทนฟิลด์อาหาร/ยา
- **2026-09-13 (Decision 3 - Document Type Clean Naming):** เลือกแนวทางสร้าง Document Type ใหม่ `fuel_cylinder` (schema_v 1) แทนการต่อเติมบน `gas_cylinder_type` เดิม เพื่อความสะอาดของชื่อเอกสารและสถาปัตยกรรมระยะยาว
- **2026-09-13 (Decision 4 - Table UX & Dual Display):** รวมการบริหารจัดการถังแก๊สเข้าในหน้า "รายการพัสดุในคลัง" (Inventory Tab) ของคลังสินค้า โดยคอลัมน์ยอดคงเหลือแสดงทั้งจำนวนถังและน้ำหนักรวม `X ถัง (Y กก.)`
- **2026-09-13 (Decision 5 - Role Transition):** หน้าที่การลงทะเบียนถัง เติมแก๊ส และตัดเศษ ย้ายให้ฝ่ายคลังสินค้า (Supply) ดูแล 100% ส่วนโรงครัวคงไว้เฉพาะการเลือกถังที่พร้อมใช้ตอนวางแผนอาหาร (Meal Plan)
- **2026-09-13 (Decision 6 - Tracking Method):** บันทึกการเปลี่ยนแปลงเป็น Change Record ฉบับเต็มที่ [`docs/changes/draft-fuel-energy-gas-inventory.md`](draft-fuel-energy-gas-inventory.md)
- **2026-09-13 (Decision 7 - Drop Migration & Clean Reset):** ตัดสคริปต์ Database Migration ออกทั้งหมดตามข้อตกลง Grill-me เนื่องจากระบบยังเป็น Pre-production ทำการแทนที่ schema และ cleanup code เก่าโดยตรง
- **2026-09-13 (Decision 8 - Dedicated Gas Ledger Retained):** คง `gas_ledger` แยกจาก `stock_ledger` เนื่องจากถังแก๊สเป็น Reusable Container Asset และการเบิกใช้ในครัวคำนวณลดทอนเป็นกิโลกรัมต่อเนื่อง
- **2026-09-13 (Decision 9 - Hybrid Supply UX):** เลือกใช้ UI รูปแบบไฮบริด โดยมีปุ่มคลี่แถว (Expandable Row) ในตารางหลักเพื่อดูสรุปเร็ว และปุ่มเปิด Dedicated Dialog จัดการถังแบบเต็มจอ
- **2026-09-13 (Decision 10 - Auto-sequence Batch Code):** การสร้างถังเป็นชุดจะสแกนหาเลขรหัสสูงสุดของ Prefix นั้นในศูนย์อัตโนมัติ บังคับรหัสไม่ซ้ำ และมีหน้าต่าง Preview ให้ตรวจทาน
- **2026-09-13 (Decision 11 - Initial Full Tank Checkbox):** การลงทะเบียนถังใหม่มี Checkbox "บันทึกเป็นถังเต็มพร้อมใช้งาน" ติ๊กถูกเป็นค่าเริ่มต้น ช่วยลดขั้นตอนการเติมแก๊สซ้ำซ้อน
- **2026-09-13 (Decision 12 - LPG Scoping):** กำหนดหมวด `FUEL_ENERGY` ในเฟสนี้ให้โฟกัสเฉพาะแก๊ส LPG โดยล็อค `fuel_type: 'LPG'` และล็อคหน่วยฐานเป็น `"ถัง"` อัตโนมัติ
- **2026-09-13 (Decision 13 - Seed Data Integration):** บรรจุ Item Master แก๊ส LPG และถังตัวอย่าง 3 ใบ (เต็ม, กำลังใช้, หมด) ลงใน `frontend/scripts/seed.ts` เพื่อความพร้อมในการทดสอบระบบทันที
