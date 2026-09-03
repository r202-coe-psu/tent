---
id: draft
title: Catalog Schema Deactivation & Shelter Override Alignment — เพิ่มฟิลด์ deactivated, override, และ shelter_code ในเอกสาร Catalog
status: proposed
date: 2026-09-03
requested_by: Module C team / Inventory & Warehouse operations
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §4.1, §4.2, §4.3
  - frontend/src/lib/features/catalog/domain/catalog.ts
  - frontend/src/lib/features/catalog/domain/catalog-deletion.ts
  - frontend/src/lib/features/catalog/data/catalog.remote.ts
  - frontend/src/lib/features/catalog/ui/item-category-form.svelte
  - frontend/src/lib/features/catalog/ui/item-master-form.svelte
  - frontend/src/lib/features/catalog/ui/recipe-form.svelte
---

# Catalog Schema Deactivation & Shelter Override Alignment

> **สรุป (TL;DR):** เพิ่มฟิลด์ `deactivated` (opt, bool, default `false`), `override` (opt, bool, default `false`), และ `shelter_code` (opt, str) ในเอกสาร Catalog ทั้ง 3 ประเภท (`item_category`, `item_master`, `recipe`) บน `docs/data/schema.md` §4 เพื่อรองรับกลไก Soft-Delete (ปิดการใช้งานเมื่อมีข้อมูลอ้างอิง) และสถาปัตยกรรม Remote-first Shelter Override โดยคง `schema_v` เดิม (Additive Non-breaking)

---

## 1. Requirements

- **FR-01 (Deactivation Field):**
  - เอกสาร `item_category`, `item_master`, และ `recipe` ต้องรองรับฟิลด์ `deactivated` ชนิด `bool` (optional, default `false`)
  - เมื่อ `deactivated === true`:
    - ต้องไม่ปรากฏใน Dropdown / ตัวเลือกสำหรับการสร้างเอกสารใหม่ (เช่น การลงทะเบียนรับของ, การสร้างเมนูอาหาร, การสร้างสินค้าใหม่)
    - รายการประวัติย้อนหลัง (Stock ledger, Meal plan, Requisition) ที่เคยอ้างอิงเอกสารนี้ยังคงอ่านและแสดงผลชื่อเดิมได้ตามปกติ
    - อนุญาตให้ผู้ดูแลระบบ (Admin) หรือผู้จัดการศูนย์ (Manager) เปิดใช้งานกลับมาใหม่ได้ (`deactivated = false`)
- **FR-02 (Shelter Override Fields):**
  - เพื่อรองรับสถาปัตยกรรม Multi-tenant / Remote-first (Master vs Override Pattern ตาม `docs/data/data-model.md` §4):
    - เอกสารในฐานข้อมูล `catalog` (ส่วนกลาง): `shelter_code` เป็น `undefined`, `override` เป็น `undefined` หรือ `false`
    - เอกสารในฐานข้อมูล `shelter_{code}` (เฉพาะศูนย์):
      - กรณีปรับแต่งทับค่ามาตรฐานส่วนกลาง: `override: true`, `shelter_code: "{code}"`, `_id` ตรงกับส่วนกลาง
      - กรณีศูนย์สร้างขึ้นเองใหม่เฉพาะศูนย์: `override: false` หรือ `undefined`, `shelter_code: "{code}"`, `_id` เป็น ID ใหม่
- **FR-03 (Deletion Flow Invariant):**
  - เมื่อมีคำสั่งลบเอกสาร Catalog:
    - หากเป็นเอกสาร `override: true` $\rightarrow$ ทำการ Hard delete เอกสารใน DB ของศูนย์ทิ้ง (Reset to central default)
    - หากเป็นเอกสารที่มีข้อมูลอ้างอิงอยู่ (เช่น หมวดหมู่ถูกสินค้าใช้, สินค้ามีในสต็อก, สูตรอาหารมีในแผนครัว) $\rightarrow$ ห้ามลบจริง ให้เปลี่ยนเป็น `deactivated = true`
    - หากไม่มีการอ้างอิงใดๆ $\rightarrow$ อนุญาตให้ Hard delete ได้

---

## 2. Why

1. **ป้องกัน Data Corruption จากการ Hard-delete:**
   - ข้อมูลใน Catalog เช่น `item_category`, `item_master`, `recipe` ถูกอ้างอิงข้ามโดเมนอย่างกว้างขวาง (สต็อกคงคลัง `stock_ledger`, การจ่ายของบริจาค `donation`, แผนประกอบอาหาร `meal_plan`, ใบเบิกวัตถุดิบ `kitchen_requisition`)
   - หากผู้ใช้ลบรายการที่มีประวัติอยู่จริง เอกสารประวัติจะกลายเป็น Dangling reference แสดงชื่อเป็นค่าว่างหรือไม่สามารถคำนวณยอดได้
   - การมีสถานะ `deactivated` ทำให้สามารถซ่อนรายการเลิกใช้ได้ โดยไม่สูญเสียความสมบูรณ์ของข้อมูลย้อนหลัง
2. **Schema Inconsistency ระหว่าง Code และ Documentation:**
   - ในซอร์สโค้ด (`catalog.ts`, Form UI, Repository) และ CR-084 มีการประกาศและใช้งานฟิลด์ `deactivated`, `override`, และ `shelter_code` อยู่แล้ว แต่ในตารางสเปกหลัก `docs/data/schema.md` §4.1–§4.3 ยังไม่ได้ระบุฟิลด์เหล่านี้ ทำให้เกิดช่องว่างในการตรวจรับงานของทีม Dev และ QA
3. **การทำให้กลไก Master vs Override สอดคล้องกับมาตรฐานความปลอดภัย (RBAC):**
   - ศูนย์พักพิงไม่มีสิทธิ์เขียนฐานข้อมูลกลาง `catalog` (Read-only for shelters) การปรับแต่งค่าเฉพาะศูนย์จึงต้องเขียนเป็นเอกสาร Override ในฐานข้อมูล `shelter_{code}` ของตนเอง การบันทึก `override` และ `shelter_code` ใน schema ช่วยให้การตรวจสอบสิทธิ์และ Data synchronizer ทำงานได้อย่างถูกต้อง

---

## 3. Change (Before $\rightarrow$ After)

### 3.1 `docs/data/schema.md` §4.1: `item_category`

**Before:**
| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | ห้ามว่างเปล่า |
| `is_default` | bool | req | default `false`; ถ้า `true` จะเป็นหมวดหมู่ตั้งต้น |

**After:**
| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | ห้ามว่างเปล่า |
| `deactivated` | bool | opt | default `false`; ถ้า `true` คือปิดการใช้งาน (Soft-deleted) ไม่แสดงในตัวเลือกใหม่ |
| `override` | bool | opt | default `false`; ถ้า `true` คือเอกสารปรับแต่งเฉพาะศูนย์ในฐานข้อมูล `shelter_*` |
| `shelter_code` | str | opt | รหัสศูนย์พักพิงเจ้าของเอกสาร (มีเฉพาะเอกสารใน DB ของศูนย์) |

_(หมายเหตุ: ลบ `is_default` ตาม CR-084)_

---

### 3.2 `docs/data/schema.md` §4.2: `item_master`

**Before:**
_(ไม่มีฟิลด์ `deactivated`, `override`, `shelter_code` ในตาราง)_

**After:**
เพิ่มแถวในตาราง `item_master`:
| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `deactivated` | bool | opt | default `false`; ถ้า `true` คือปิดการใช้งาน ห้ามเบิก/รับเข้า/เลือกใหม่ |
| `override` | bool | opt | default `false`; ถ้า `true` คือเอกสารปรับแต่งเฉพาะศูนย์ในฐานข้อมูล `shelter_*` |
| `shelter_code` | str | opt | รหัสศูนย์พักพิงเจ้าของเอกสาร (มีเฉพาะเอกสารใน DB ของศูนย์) |

---

### 3.3 `docs/data/schema.md` §4.3: `recipe`

**Before:**
| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `label` | str | req | ชื่อแสดงผลภาษาไทย เช่น "ข้าวไข่เจียว" |
| `ingredients` | [{`item_master_id`:str, `quantity`:qty_str>0, `uom`:str}] | req | รายการวัตถุดิบและปริมาณ; `item_master_id` → `item_master:{sku\|ulid}` |
| `standard_portions` | qty_str>0 | req | จำนวนที่ผลิตได้ต่อหนึ่งรอบประกอบอาหาร |
| `standard_duration_hours` | qty_str>0 | req | ระยะเวลาปรุงในหน่วยชั่วโมง |
| `is_default` | bool | req | default `false`; ตั้งเป็นสูตรมาตรฐานหลักของศูนย์ |

**After:**
| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `label` | str | req | ชื่อแสดงผลภาษาไทย เช่น "ข้าวไข่เจียว" |
| `ingredients` | [{`item_master_id`:str, `quantity`:qty_str>0, `uom`:str}] | req | รายการวัตถุดิบและปริมาณ; `item_master_id` → `item_master:{sku\|ulid}` |
| `standard_portions` | qty*str>0 | req | จำนวนที่ผลิตได้ต่อหนึ่งรอบประกอบอาหาร |
| `standard_duration_hours` | qty_str>0 | req | ระยะเวลาปรุงในหน่วยชั่วโมง |
| `deactivated` | bool | opt | default `false`; ถ้า `true` คือปิดการใช้งาน ไม่แสดงให้เลือกในแผนเตรียมอาหารใหม่ |
| `override` | bool | opt | default `false`; ถ้า `true` คือเอกสารปรับแต่งสูตรเฉพาะศูนย์ในฐานข้อมูล `shelter*\*`|
|`shelter_code` | str | opt | รหัสศูนย์พักพิงเจ้าของเอกสาร (มีเฉพาะเอกสารใน DB ของศูนย์) |

_(หมายเหตุ: ลบ `is_default` ตาม CR-084)_

---

## 4. Impact

- **Docs:**
  - `docs/data/schema.md`: อัปเดตตาราง §4.1, §4.2, §4.3
- **Code:**
  - `frontend/src/lib/features/catalog/domain/catalog.ts`: Zod schema และ interface มีฟิลด์นี้รองรับอยู่แล้ว
  - `frontend/src/lib/features/catalog/domain/catalog-deletion.ts`: มี Logic การตัดสินใจ Deactivate vs Reset vs Delete รองรับอยู่แล้ว
  - `frontend/src/lib/features/catalog/data/catalog.remote.ts`: มีการจัดการ query และ filter `deactivated` และ `override` รองรับอยู่แล้ว
  - UI Forms (`item-category-form.svelte`, `item-master-form.svelte`, `recipe-form.svelte`): มี toggle เปิด/ปิด `deactivated` พร้อมใช้งาน
- **Tests:**
  - `catalog-deletion.test.ts`, `catalog.test.ts`, `catalog.remote.test.ts` ครอบคลุมการทำงานแล้ว

---

## 5. Migration & Versioning

- **`schema_v`:** คงเดิม (Non-breaking additive change)
  - `item_category`: **schema_v 1**
  - `item_master`: **schema_v 3** (หรือ 4 ตาม CR-082)
  - `recipe`: **schema_v 3**
- **Data Migration:**
  - เอกสารเดิมในฐานข้อมูลที่ไม่มีฟิลด์ `deactivated` จะถูกตีความเป็น `deactivated: false` (Active) โดยอัตโนมัติ ไม่จำเป็นต้องทำ batch backfill script
  - เอกสารเดิมที่ไม่มี `override` และอยู่ในฐานข้อมูล `catalog` กลาง จะถือเป็นเอกสาร Master อัตโนมัติ

---

## 6. Decision log

- 2026-09-03 — proposed (จัดทำ Draft CR เพื่อบันทึกฟิลด์ deactivation และ shelter override ลงใน Canonical Schema §4 ให้ตรงกับ implementation จริง)
