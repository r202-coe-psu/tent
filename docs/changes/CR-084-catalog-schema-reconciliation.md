---
id: CR-084
title: Catalog Schema Reconciliation — Removing is_default flags & aligning item_category, item_master, recipe fields
status: done
date: 2026-08-22
updated: 2026-09-01
requested_by: Module C team / Kitchen & Warehouse operations
decided_by: project owner
layer: volatile
affects:
  - frontend/src/lib/features/catalog/domain/catalog.ts
  - frontend/src/lib/features/catalog/ui/item-category-form.svelte
  - frontend/src/lib/features/catalog/ui/item-master-form.svelte
  - frontend/src/lib/features/catalog/ui/recipe-form.svelte
---
# CR-084 — Catalog Schema Reconciliation: Field Cleanups & Food Security Alignment

> **สรุป (TL;DR):** ปรับปรุงโครงสร้างข้อมูลของ Catalog ทั้ง 3 ส่วนประกอบ (`item_category`, `item_master`, `recipe`) เพื่อลบฟิลด์สถานะเริ่มต้น `is_default` ที่ไม่จำเป็นและซ้ำซ้อนออก พร้อมปรับปรุงโครงสร้างของ `item_master` ให้รองรับระบบโภชนาการ/การจัดเก็บของโรงครัวคลังสินค้า (CR-058) และระบบแจกจ่ายสิ่งของคงทน (Durable)

---

## Why

1. **ความซ้ำซ้อนของฟิลด์ `is_default` ใน Category และ Recipe:**
   * ในการจำแนกประเภทสิ่งของ (`item_category`) และการปรุงอาหารตามสูตร (`recipe`) การตั้งสถานะเป็นค่าเริ่มต้นถาวร (`is_default`) ผ่านฐานข้อมูล Catalog ก่อให้เกิดความซับซ้อนเกินจำเป็นและไม่มีการใช้งานจริงในหน้าจอผู้ใช้ (UI) อีกทั้งการตั้งค่าเริ่มต้นของสูตรอาหารควรจัดการในระดับขั้นตอนการวางแผนรายวัน (Daily Planning) มากกว่าการตั้งค่าระดับ Catalog
2. **การล้างข้อมูล UOM และฟิลด์สำรองสินค้าที่ทับซ้อน:**
   * ใน `item_master` มีฟิลด์ล้าสมัย เช่น `default_purchasing_uom` (ขัดแย้งกับหลักการไม่มีระบบสั่งซื้อผ่านโปรแกรม) รวมถึงกลุ่มฟิลด์ `target_reserve_days`, `consumption_rate`, `sphere_standard` ที่ทับซ้อนกับระบบ SOP Ratio Engine (CR-006 / CR-015) ทำให้ต้องลบออกเพื่อป้องกันข้อมูลไม่ตรงกัน
3. **การรองรับความมั่นคงทางอาหารโรงครัวคลังสินค้าและการคัดกรองแจกจ่าย (CR-058 / CR-082):**
   * ขยายการจัดเก็บข้อมูลสินค้าให้สอดคล้องกับคุณสมบัติของสิ่งของจำพวกอาหาร (Storage temperature, Allergens, Dietary requirements) และเพศ/กลุ่มอายุเป้าหมาย พร้อมกับรองรับคุณสมบัติของสิ่งของคงทน (Durable assets) เช่น การติดตามการส่งคืนเครื่องมือเครื่องใช้คลัง

---

## Change

1. **ถอดฟิลด์ `is_default` ออกจาก Catalog:**
   * **`item_category`:** ลบ `is_default: bool` ออกจาก schema และ code เพื่อลดความสับสนในการใช้งาน
   * **`recipe`:** ลบ `is_default: bool` ออกจาก schema และ code เพื่อย้ายไปจัดการในขั้นตอน Daily Calculation แทน
2. **ปรับฟิลด์ใน `item_master` (Alignment):**
   * **ลบฟิลด์ล้าสมัย:** ลบ `default_purchasing_uom`, `target_reserve_days`, `consumption_rate`, `unit`, `timeframe`, `sphere_standard`, `overstock_alert_days`, `target_audience_type`, `target_restrictions`, และ `is_default` ออก
   * **ปรับ Enum `distribution_type`:** เปลี่ยนค่าตัวเลือกจาก `consumable` / `one_time` เป็น `recurring` (แจกซ้ำได้ตามรอบ) / `one_time` (แจกครั้งเดียวต่อคน)
   * **เพิ่มฟิลด์จำแนกประเภทและการจัดเก็บอาหาร:**
     * `type_class`: enum(`CONSUMABLE`, `DURABLE`, `EQUIPMENT`) [required]
     * `shelf_life_days`: number [optional]
     * `storage_type`: enum(`DRY`, `CHILLED`, `FROZEN`, `CONTROLLED_MED`) [optional]
     * `allergens`: [string] [required, default `[]`]
     * `target_gender`: enum(`ALL`, `FEMALE`, `MALE`) [optional]
     * `age_group`: enum(`ALL`, `INFANT`, `CHILD`, `ELDERLY`) [optional]
     * `dietary`: [enum(`HALAL`, `VEGAN`)] [required, default `[]`]
   * **เพิ่มฟิลด์สำหรับสินค้าคงทน (Durable / Equipment):**
     * `qty_per_person`: qty_str [optional]
     * `returnable`: boolean [optional]
     * `asset_status`: string [optional]

---

## Impact

* **Docs:**
  * [_index.md](_index.md): ลงทะเบียนเอกสาร CR-084
* **Code:**
  * [catalog.ts](../../frontend/src/lib/features/catalog/domain/catalog.ts): แก้ไข Schema ใน Zod และ Factories (`createItemCategory`, `createItemMaster`, `createRecipe`)
  * แบบฟอร์มของ UI ใน `frontend/src/lib/features/catalog/ui/`:
    * `item-category-form.svelte`: ถอดฟิลด์ Default category checkbox ออก
    * `recipe-form.svelte`: ถอดฟิลด์ Default recipe checkbox ออก
    * `item-master-form.svelte`: ถอดฟิลด์ที่ไม่ได้ใช้และเพิ่มการจัดกลุ่มการกรอกข้อมูลแยกตาม `type_class`
* **Tests:**
  * ปรับปรุง Unit test ใน `frontend/src/lib/features/catalog/domain/catalog.test.ts` และ mock seed data ให้สอดรับกับเวอร์ชัน schema ใหม่

---

## Migration

* **แนวทางการจัดการข้อมูลเดิม (Data Migration):**
  * ข้อมูลจำพวก category และ recipe เดิมใน DB ให้ทำการลบฟิลด์ `is_default` ออก
  * เอกสาร `item_master` รุ่น 3 เดิมในฐานข้อมูล จะต้องลบฟิลด์ที่ยกเลิก และทำการตั้งค่า `type_class` และข้อกำหนดเป้าหมายเริ่มต้นตามประเภทหมวดหมู่ของสินค้านั้น ๆ (Backfill)

---

## Decision log

* 2026-08-22 — proposed (จัดทำ Change Request เพิ่มเติมเพื่อให้ครอบคลุมการปรับปรุงฟิลด์ของ Catalog ทั้งระบบ)
