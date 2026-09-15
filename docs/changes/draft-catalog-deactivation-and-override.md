---
id: draft
title: Catalog Schema Deactivation & Shelter Override Alignment — เพิ่มฟิลด์ deactivated, override, และ shelter_code ในเอกสาร Catalog
status: proposed
date: 2026-09-03
updated: 2026-09-12
requested_by: Module C team / Inventory & Warehouse operations
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §4.1, §4.2, §4.3
  - frontend/src/lib/features/catalog/domain/catalog.ts
  - frontend/src/lib/features/catalog/domain/catalog-deletion.ts
  - frontend/src/lib/features/catalog/data/catalog.remote.ts
  - frontend/src/routes/(protected)/back-office/catalog/components/item-category-tab.svelte
  - frontend/src/routes/(protected)/back-office/catalog/components/item-master-tab.svelte
  - frontend/src/routes/(protected)/back-office/catalog/components/recipe-tab.svelte
---

# Catalog Schema Deactivation & Shelter Override Alignment

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่มฟิลด์ `deactivated` (opt, bool, default `false`), `override` (opt, bool, default `false`), และ `shelter_code` (opt, str) ในเอกสาร Catalog ทั้ง 3 ประเภท (`item_category`, `item_master`, `recipe`) บน `docs/data/schema.md` §4, กำหนดนโยบายการลบเอกสารส่วนกลางเป็น Soft-Delete (`deactivate`) อย่างเดียว ห้าม Hard-Delete จากผล Client scan โดยเด็ดขาด, และกำหนดกลไก Master vs Override ในฐานข้อมูลระดับศูนย์พักพิง โดยคง `schema_v` เดิม (Additive Non-breaking)
> - **เพื่อใคร/ทำไม:** ป้องกันข้อมูลประวัติในศูนย์พักพิงเสียหาย (Dangling References) จากการ Hard-delete ข้อมูลกลาง, ป้องกันความเสี่ยงจากการที่ Client scan ข้ามศูนย์แล้วหลุด catch กว้างจนเผลอสั่งลบถาวร, แก้ปัญหา Multi-tenant Isolation & RBAC Violation ไม่ให้ Client-side วนลูป Query ข้ามฐานข้อมูลศูนย์พักพิง, และลดช่องว่าง Schema ระหว่างเอกสารสเปกกับโค้ดจริง
> - **Dev ต้อง build:**
>   - ปรับ Zod schema และ Types ใน `catalog.ts` ให้รองรับ `deactivated`, `override`, `shelter_code`
>   - ปรับ Deletion Policy ใน `catalog-deletion.ts`: ใน Central Scope กำหนดให้ส่งผลลัพธ์เป็น `deactivate` อย่างเดียวเท่านั้น (ตัด Branch `hard_delete` ออกทั้งหมดสำหรับส่วนกลาง) เพื่อขจัดความเสี่ยงข้อมูลสูญหายจากการสแกนของ Client
>   - ลบลูป `listShelters()` และการสแกนข้ามฐานข้อมูลศูนย์พักพิงใน `catalog.remote.ts` (~265–287 ใน `inspectCategoryUsage` รวมถึง `inspectItemMasterUsage` และ `inspectRecipeUsage`) ออกทั้งหมด โดยให้ตรวจสอบเฉพาะข้อมูลความสัมพันธ์ภายในฐานข้อมูล `catalog` ส่วนกลางเท่านั้น
>   - ปรับปรุง UI Tabs (`item-category-tab.svelte`, `item-master-tab.svelte`, `recipe-tab.svelte`) ให้มีปุ่ม "นำกลับมาใช้" (`RotateCcw`), Dialog พรีวิวการใช้งานก่อนลบ, และ Toast แจ้งผลตามการกระทำจริง (`reset`, `deactivate`, `hard_delete`)
> - **กระทบ schema/scope:**
>   - `docs/data/schema.md` §4.1, §4.2, §4.3 (คง `schema_v` เดิมทั้งหมด)

---

## 1. Requirements

### FR-01: Deactivation Field (ฟิลด์ปิดการใช้งาน)

1. เอกสาร `item_category`, `item_master`, และ `recipe` ต้องรองรับฟิลด์ `deactivated` ชนิด `bool` (optional, default `false`)
2. เมื่อ `deactivated === true`:
   - ต้องไม่ปรากฏใน Dropdown / ตัวเลือกสำหรับการสร้างเอกสารใหม่ (เช่น การบันทึกรับของบริจาค, การสร้างแผนอาหาร, การเพิ่มรายการสินค้าใหม่)
   - รายการประวัติย้อนหลัง (Stock ledger, Meal plan, Requisition, Donation) ที่เคยอ้างอิงเอกสารถึง `_id` นี้ ยังคงอ่านและแสดงผลชื่อ/ข้อมูลเดิมได้ตามปกติ
   - อนุญาตให้ผู้ดูแลระบบ (System Admin) หรือเจ้าหน้าที่ที่มีสิทธิ์จัดการข้อมูล เปิดใช้งานกลับมาใหม่ได้ (`deactivated = false`) ผ่านปุ่ม "นำกลับมาใช้" ในหน้า UI

### FR-02: Shelter Override Fields (ฟิลด์ระบุสิทธิ์และการปรับแต่งเฉพาะศูนย์)

1. เพื่อรองรับสถาปัตยกรรม Multi-tenant / Remote-first (Master vs Override Pattern ตาม `docs/data/data-model.md` §4):
   - **เอกสารในฐานข้อมูล `catalog` (ส่วนกลาง):** `shelter_code` ต้องเป็น `undefined`, `override` เป็น `undefined` หรือ `false`
   - **เอกสารในฐานข้อมูล `shelter_{code}` (เฉพาะศูนย์):**
     - กรณีปรับแต่งทับค่ามาตรฐานส่วนกลาง (Override): `override: true`, `shelter_code: "{code}"`, และ `_id` ตรงกับเอกสารมาตรฐานส่วนกลาง
     - กรณีศูนย์สร้างขึ้นเองใหม่เฉพาะศูนย์ (Custom): `override: false` หรือ `undefined`, `shelter_code: "{code}"`, และ `_id` เป็น ID ใหม่เฉพาะศูนย์

### FR-03: Deletion Policy & Scope Boundary (นโยบายการลบเอกสารและขอบเขตความปลอดภัย)

1. **นโยบายระดับส่วนกลาง (Central Master Scope — `catalog` DB):**
   - **นโยบาย Soft-Delete เสมอ (Strict Invariant):** เอกสาร Master Data ส่วนกลาง (`item_category`, `item_master`, `recipe`) **เมื่อถูกสั่งลบ จะต้องเปลี่ยนสถานะเป็น `deactivated = true` อย่างเดียวเท่านั้น**
   - **ห้ามมีผลลัพธ์เป็น `hard_delete` สำหรับเอกสารส่วนกลางเด็ดขาด (No hard_delete in Central scope):** แม้ผลการสแกนในส่วนกลางจะไม่พบรายการสินค้าหรือสูตรอาหารผูกอยู่ก็ตาม เพื่อป้องกันความเสี่ยงข้อมูลประวัติในศูนย์พักพิงภายนอกสูญหาย (Data Loss Prevention) จากการที่ Client ไม่สามารถรับรู้ข้อมูลของทุกศูนย์ได้สมบูรณ์
   - **ห้ามทำการ Query หรือสแกนข้ามฐานข้อมูลศูนย์พักพิงจาก Client-side (No cross-tenant scanning):** ตัดการเรียก `sheltersRepository().listShelters()` และลูปเปิด DB ข้ามศูนย์ใน `catalog.remote.ts` (~265–287) ออกทั้งหมด เพื่อกำจัดปัญหา Multi-tenant RBAC Violation (403 Forbidden), ปัญหา N+1 Performance Hazard, และป้องกันปัญหา Silent Fail จากบล็อก `catch` กว้าง
   - ในการตรวจสอบการใช้งาน (Usage Inspection) ของส่วนกลาง ให้ตรวจสอบเฉพาะความสัมพันธ์กับสินค้า/สูตรอาหารภายในฐานข้อมูล `catalog` ส่วนกลางเองเท่านั้น เพื่อนำข้อมูลมาแสดงผลใน Dialog ให้ผู้ดูแลระบบรับทราบ
2. **นโยบายระดับศูนย์พักพิง (Shelter Scope — `shelter_{code}` DB):**
   - หากเป็นเอกสาร Override (`override: true`) $\rightarrow$ ทำการ Hard delete เอกสารใน DB ของศูนย์ทิ้ง (Reset to central default) เพื่อให้ศูนย์กลับไปใช้ค่ามาตรฐานส่วนกลาง
   - หากเป็นเอกสารสร้างขึ้นเองเฉพาะศูนย์ (`override: false` หรือไม่มี):
     - หากมีข้อมูลภายในศูนย์อ้างอิงอยู่ (เช่น หมวดหมู่มีสินค้าในศูนย์ใช้งาน, สินค้ามีในสต็อกศูนย์, สูตรอาหารมีในแผนครัวศูนย์) $\rightarrow$ ห้ามลบจริง ให้เปลี่ยนเป็น `deactivated = true`
     - หากไม่มีข้อมูลอ้างอิงใดๆ ภายในศูนย์ $\rightarrow$ อนุญาตให้ Hard delete เอกสารออกจาก DB ของศูนย์ได้

### FR-04: UI Interactions & Feedback (การแสดงผลและการแจ้งเตือนในหน้าจอ)

1. ในตารางรายการ Catalog (`item-category-tab`, `item-master-tab`, `recipe-tab`):
   - รายการที่มีสถานะ `deactivated === true` ต้องแสดงป้ายกำกับ "ปิดใช้งาน (Deactivated)" และแสดงปุ่ม **"นำกลับมาใช้" (`RotateCcw`)** เพื่อให้ผู้ใช้สามารถกดเปิดใช้งานกลับมาได้โดยตรงจากตาราง
2. ใน Dialog ยืนยันการลบ:
   - ต้องตรวจสอบการใช้งานก่อนยืนยัน (Usage Inspection) และแสดงข้อความเหตุผลชัดเจนตามผลลัพธ์ (`reset` / `deactivate` / `hard_delete`)
   - หากเป็นการดำเนินการของส่วนกลาง ให้ระบุให้ชัดเจนว่าระบบจะดำเนินการ **"ปิดการใช้งาน (Deactivate)"** เพื่อรักษาความสมบูรณ์ของข้อมูลอ้างอิงในระบบ
3. ในการแจ้งเตือน (Toast):
   - ต้องแสดงข้อความให้ตรงกับผลลัพธ์จริง (`actionTaken`):
     - `reset`: "คืนค่ามาตรฐานสำเร็จ"
     - `deactivate`: "เปลี่ยนสถานะเป็นปิดใช้งาน (Deactivated) เรียบร้อยแล้ว"
     - `hard_delete`: "ลบข้อมูลถาวรสำเร็จ"

---

## 2. Acceptance Criteria (DoD)

- [ ] **AC-01:** ตาราง `docs/data/schema.md` §4.1, §4.2, §4.3 มีฟิลด์ `deactivated`, `override`, `shelter_code` ครบถ้วน พร้อมคำอธิบายชนิดและสถานะ required/optional
- [ ] **AC-02:** เอกสาร Catalog ที่มี `deactivated: true` ไม่ถูกนำไปแสดงใน Dropdown สำหรับการสร้างรายการใหม่ (เช่น ใบเบิก, ใบรับบริจาค, แผนอาหาร) แต่รายการประวัติเดิมยังแสดงชื่อได้ถูกต้อง
- [ ] **AC-03:** การสั่งลบเอกสาร Catalog ใน Central Scope (`catalog` DB) เปลี่ยนสถานะเอกสารเป็น `deactivated = true` อย่างเดียวเสมอ **ห้ามคืนค่า `hard_delete` เด็ดขาด** และไม่มีการยิง HTTP Request สแกนข้ามฐานข้อมูลศูนย์พักพิงจาก Client-side
- [ ] **AC-04:** ใน `catalog.remote.ts` ฟังก์ชัน `inspectCategoryUsage`, `inspectItemMasterUsage`, และ `inspectRecipeUsage` ไม่มีโค้ด `listShelters()` หรือลูปสแกนข้ามฐานข้อมูลศูนย์พักพิง
- [ ] **AC-05:** การสั่งลบเอกสาร Override ใน Shelter Scope (`shelter_{code}` DB) ทำการลบเอกสาร Override ออกจาก DB ของศูนย์ และคืนค่าการแสดงผลกลับไปเป็นค่ามาตรฐานจากส่วนกลาง
- [ ] **AC-06:** หน้าจอรายการ หมวดหมู่สินค้า (`item-category-tab`), ข้อมูลสินค้า (`item-master-tab`), และสูตรอาหาร (`recipe-tab`) มีปุ่ม "นำกลับมาใช้" (`RotateCcw`) สำหรับรายการที่ปิดใช้งาน และสามารถกดเพื่อเปิดใช้งานใหม่ได้
- [ ] **AC-07:** Dialog ยืนยันการลบและ Toast แจ้งผลแสดงข้อความตรงตาม Action ที่เกิดขึ้นจริง (`reset` / `deactivate` / `hard_delete`)

---

## 3. Why

1. **ป้องกัน Data Loss และคง Referential Integrity ข้ามระบบ:**
   - เอกสาร Catalog เช่น `item_category`, `item_master`, `recipe` ถูกอ้างอิงข้ามโดเมนอย่างกว้างขวาง (`stock_ledger`, `donation`, `meal_plan`, `kitchen_requisition`) ในศูนย์พักพิงทุกแห่ง
   - หากอนุญาตให้ Hard-delete ข้อมูลกลางจากผลการสแกนของ Client ที่ไม่สมบูรณ์ (เช่น เกิด Network error หรือติด 403 Forbidden แล้วลูปหลุดเข้า catch จนเข้าใจผิดว่าไม่มีใครใช้) จะทำให้เอกสารประวัติในศูนย์พักพิงกลายเป็น Dangling Reference ทันที
   - การกำหนดให้ส่วนกลางใช้กลไก Soft-Delete (`deactivated = true`) อย่างเดียว เป็นแนวทาง Safe by default ที่รับประกันความปลอดภัยของข้อมูล 100%
2. **รักษา Multi-tenant Isolation และป้องกัน N+1 Performance Hazard:**
   - ภายใต้สถาปัตยกรรม Remote-first ผู้ใช้ระดับศูนย์พักพิงไม่มีสิทธิ์เปิดอ่าน DB ของศูนย์อื่น (RBAC 403 Forbidden)
   - การสแกนข้ามศูนย์จากเบราว์เซอร์ก่อให้เกิด Network Request จำนวนมหาศาล ($1 + 2N$ requests) และเสี่ยงต่อการเกิด Silent Fail
   - การตัดการสแกนข้ามศูนย์ออก และให้ส่วนกลางตรวจสอบเฉพาะภายในฐานข้อมูลกลาง ช่วยให้ระบบทำงานได้รวดเร็วทันที ปลอดภัยต่อ Security และไม่กินทรัพยากรเครือข่าย
3. **ขจัดความไม่สอดคล้องระหว่างเอกสารสเปก (Docs) และโค้ดจริง (Code):**
   - ซอร์สโค้ดในระบบและ CR-084 มีการใช้งานฟิลด์ `deactivated`, `override`, และ `shelter_code` แล้ว แต่ในเอกสารหลัก `docs/data/schema.md` §4 ยังไม่ได้ระบุอย่างเป็นทางการ ทำให้เกิดความเข้าใจคลาดเคลื่อนระหว่างทีมพัฒนาและทีมตรวจรับ

---

## 4. Change (Before $\rightarrow$ After)

### 4.1 `docs/data/schema.md` §4.1: `item_category`

**Before:**

| Field        | ชนิด | req | หมายเหตุ                                         |
| ------------ | ---- | --- | ------------------------------------------------ |
| `name`       | str  | req | ห้ามว่างเปล่า                                    |
| `is_default` | bool | req | default`false`; ถ้า `true` จะเป็นหมวดหมู่ตั้งต้น |

**After:**

| Field          | ชนิด | req | หมายเหตุ                                                                        |
| -------------- | ---- | --- | ------------------------------------------------------------------------------- |
| `name`         | str  | req | ห้ามว่างเปล่า                                                                   |
| `deactivated`  | bool | opt | default`false`; ถ้า `true` คือปิดการใช้งาน (Soft-deleted) ไม่แสดงในตัวเลือกใหม่ |
| `override`     | bool | opt | default`false`; ถ้า `true` คือเอกสารปรับแต่งเฉพาะศูนย์ในฐานข้อมูล `shelter_*`   |
| `shelter_code` | str  | opt | รหัสศูนย์พักพิงเจ้าของเอกสาร (มีเฉพาะเอกสารใน DB ของศูนย์)                      |

_(หมายเหตุ: ลบ `is_default` ตาม CR-084)_

---

### 4.2 `docs/data/schema.md` §4.2: `item_master`

**Before:**
_(ไม่มีฟิลด์ `deactivated`, `override`, `shelter_code` ในตาราง)_

**After:**
เพิ่มแถวในตาราง `item_master`:

| Field          | ชนิด | req | หมายเหตุ                                                                      |
| -------------- | ---- | --- | ----------------------------------------------------------------------------- |
| `deactivated`  | bool | opt | default`false`; ถ้า `true` คือปิดการใช้งาน ห้ามเบิก/รับเข้า/เลือกใหม่         |
| `override`     | bool | opt | default`false`; ถ้า `true` คือเอกสารปรับแต่งเฉพาะศูนย์ในฐานข้อมูล `shelter_*` |
| `shelter_code` | str  | opt | รหัสศูนย์พักพิงเจ้าของเอกสาร (มีเฉพาะเอกสารใน DB ของศูนย์)                    |

---

### 4.3 `docs/data/schema.md` §4.3: `recipe`

**Before:**

| Field                     | ชนิด                                                      | req | หมายเหตุ                                                             |
| ------------------------- | --------------------------------------------------------- | --- | -------------------------------------------------------------------- |
| `label`                   | str                                                       | req | ชื่อแสดงผลภาษาไทย เช่น "ข้าวไข่เจียว"                                |
| `ingredients`             | [{`item_master_id`:str, `quantity`:qty_str>0, `uom`:str}] | req | รายการวัตถุดิบและปริมาณ;`item_master_id` → `item_master:{sku\|ulid}` |
| `standard_portions`       | qty_str>0                                                 | req | จำนวนที่ผลิตได้ต่อหนึ่งรอบประกอบอาหาร                                |
| `standard_duration_hours` | qty_str>0                                                 | req | ระยะเวลาปรุงในหน่วยชั่วโมง                                           |
| `is_default`              | bool                                                      | req | default`false`; ตั้งเป็นสูตรมาตรฐานหลักของศูนย์                      |

**After:**

| Field                     | ชนิด                                                      | req | หมายเหตุ                                                                          |
| ------------------------- | --------------------------------------------------------- | --- | --------------------------------------------------------------------------------- |
| `label`                   | str                                                       | req | ชื่อแสดงผลภาษาไทย เช่น "ข้าวไข่เจียว"                                             |
| `ingredients`             | [{`item_master_id`:str, `quantity`:qty_str>0, `uom`:str}] | req | รายการวัตถุดิบและปริมาณ;`item_master_id` → `item_master:{sku\|ulid}`              |
| `standard_portions`       | qty_str>0                                                 | req | จำนวนที่ผลิตได้ต่อหนึ่งรอบประกอบอาหาร                                             |
| `standard_duration_hours` | qty_str>0                                                 | req | ระยะเวลาปรุงในหน่วยชั่วโมง                                                        |
| `deactivated`             | bool                                                      | opt | default`false`; ถ้า `true` คือปิดการใช้งาน ไม่แสดงให้เลือกในแผนเตรียมอาหารใหม่    |
| `override`                | bool                                                      | opt | default`false`; ถ้า `true` คือเอกสารปรับแต่งสูตรเฉพาะศูนย์ในฐานข้อมูล `shelter_*` |
| `shelter_code`            | str                                                       | opt | รหัสศูนย์พักพิงเจ้าของเอกสาร (มีเฉพาะเอกสารใน DB ของศูนย์)                        |

_(หมายเหตุ: ลบ `is_default` ตาม CR-084)_

---

## 5. Impact

- **Docs:**
  - `docs/data/schema.md`: อัปเดตตาราง §4.1, §4.2, §4.3
- **Code:**
  - `frontend/src/lib/features/catalog/domain/catalog.ts`: Zod schema และ Interface รองรับฟิลด์ `deactivated`, `override`, `shelter_code`
  - `frontend/src/lib/features/catalog/domain/catalog-deletion.ts`: Logic การตัดสินใจ Deactivate vs Reset vs Delete โดยแยก Central Scope (Deactivate Always ห้าม Hard delete) และ Shelter Scope อย่างชัดเจน
  - `frontend/src/lib/features/catalog/data/catalog.remote.ts`: ลบลูป `listShelters()` และการสแกนข้ามศูนย์ (~265–287) ออกทั้งหมด ตัดปัญหา N+1 และความเสี่ยง 403 Forbidden
  - UI Components (`item-category-tab.svelte`, `item-master-tab.svelte`, `recipe-tab.svelte`): มีปุ่มเปิดใช้งานกลับมาใหม่ (`RotateCcw`), Dialog แจ้งเตือนพรีวิว และ Toast message แสดงผลตรงตาม Action
- **Tests:**
  - `catalog-deletion.test.ts`, `catalog.test.ts`, `catalog.remote.test.ts` ครอบคลุมการทำงานทั้ง Central และ Shelter Scope

---

## 6. Migration & Versioning

- **`schema_v`:** คงเดิม (Non-breaking additive change)
  - `item_category`: **schema_v 1**
  - `item_master`: **schema_v 3**
  - `recipe`: **schema_v 3**
- **Data Migration:**
  - เอกสารเดิมในฐานข้อมูลที่ไม่มีฟิลด์ `deactivated` จะถูกตีความเป็น `deactivated: false` (Active) โดยอัตโนมัติ ไม่จำเป็นต้องทำ batch backfill script
  - เอกสารเดิมที่ไม่มี `override` และอยู่ในฐานข้อมูล `catalog` กลาง จะถือเป็นเอกสาร Master อัตโนมัติ

---

## 7. Decision log

- 2026-09-03 — proposed (จัดทำ Draft CR เพื่อบันทึกฟิลด์ deactivation และ shelter override ลงใน Canonical Schema §4 ให้ตรงกับ implementation จริง)
- 2026-09-09 — revised (ปรับปรุงตามข้อเสนอแนะ PR Review #223: กำหนดนโยบาย Central Deactivate Always เพื่อขจัด Client-side cross-tenant scanning, กำหนดเงื่อนไข UX Reactivation, และเพิ่ม Acceptance Criteria ให้ครบถ้วน)
- 2026-09-12 — finalized (เน้นย้ำ Invariant: Central Category ใช้ Deactivate อย่างเดียว ห้าม Hard-Delete จากผล Client scan โดยเด็ดขาด, ตัดลูป listShelters() ใน catalog.remote.ts ~265–287 ออกอย่างสมบูรณ์ เพื่อปลด Blocker ก่อนขออนุมัติ Merge)
