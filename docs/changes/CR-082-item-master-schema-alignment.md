---
id: CR-082
title: Item Master — Schema Alignment, Base Unit Locking, & Storage Properties (T-10) Team C
status: approved
date: 2026-08-20
requested_by: project owner
decided_by: project owner (2026-08-21)
layer: volatile
affects:
  - docs/data/schema.md §4.2
  - schema_v item_master 3 → 4
  - frontend/src/lib/features/catalog/domain/catalog.ts
  - frontend/src/lib/features/catalog/ui/item-master-form.svelte
---
# CR-082 — Item Master: Schema Alignment, Base Unit Locking, & Storage Properties

> **สรุป (TL;DR):** ปรับปรุงโครงสร้างข้อมูล `item_master` เพื่อสอดรับกับสเปกโรงครัวคลังสินค้า (CR-058) · เพิ่มฟิลด์ใหม่ `item_class` ในรูปแบบ `enum` ประกอบด้วย `CONSUMABLE`, `DURABLE`, `EQUIPMENT` โดยคงฟิลด์ `category` เพื่ออ้างอิงหมวดหมู่ตามเดิม · เพิ่มฟิลด์โภชนาการ/การจัดเก็บ `shelf_life_days`, `storage_type`, `allergens` · ล็อกการแก้ไข `base_unit` หลังบันทึกครั้งแรก · นำฟิลด์ `default_purchasing_uom` และ `distribution_mode` ออก · ปรับรุ่นโครงสร้างข้อมูล `schema_v` ของ `item_master` จาก `3` เป็น `4`

---

## Why

1. **ปัญหาหน่วยจัดซื้อที่ตกค้าง:** โครงสร้างข้อมูลเดิมใน [schema.md](../data/schema.md#L730) ยังมีฟิลด์ `default_purchasing_uom` ซึ่งไม่จำเป็นและขัดแย้งกับหลักการ **A6 — ไม่มีระบบจัดซื้อ (Purchase Order) ในระบบ** ของศูนย์พักพิง
2. **การป้องกันสต็อกย้อนหลังพัง:** การแก้ไขหน่วยนับพื้นฐาน (`base_unit`) ของสินค้าที่มีความเคลื่อนไหวในบัญชีสต็อกแล้ว ส่งผลให้การคำนวณยอดสต็อกย้อนหลังเสียหาย จำเป็นต้องป้องกันการแก้ไขฟิลด์นี้หลังสร้างรายการสินค้า
3. **การทำงานร่วมกับระบบความมั่นคงทางอาหารโรงครัว (CR-058):** ระบบครัวและการจำแนกวัตถุดิบต้องการข้อมูลที่ละเอียดขึ้น เช่น ประเภทการจัดเก็บ (Storage Type), อายุการจัดเก็บ (Shelf Life) และกลุ่มสารก่อภูมิแพ้ (Allergens) รวมถึงขยายมิติของการตรวจสิทธิ์ผู้รับแจกจ่าย (Eligibility Tags) ให้รองรับ 3 มิติ เพื่อคัดกรองความปลอดภัยของอาหารอย่างเหมาะสม

---

## Change

1. **เพิ่มฟิลด์ชั้นสินค้า (Item Class) และคงฟิลด์หมวดหมู่เดิม (Category):**

   * ฟิลด์ `category` ใน `item_master` ยังคงเป็น `str` (optional) อ้างอิงชื่อหมวดหมู่ยืดหยุ่นจาก `item_category` เช่นเดิม
   * เพิ่มฟิลด์ใหม่ `item_class` (required enum) ประกอบด้วยตัวเลือก:
     * `CONSUMABLE` (วัสดุสิ้นเปลือง / เบิกจ่ายหมดไป เช่น อาหาร ยา สบู่)
     * `DURABLE` (สินค้าคงทน เช่น มุ้ง เต็นท์ ผ้าห่ม)
     * `EQUIPMENT` (เครื่องมือ/อุปกรณ์ เช่น ถังแก๊ส เครื่องปรุงครัวขนาดใหญ่)
2. **ล็อกการแก้ไขหน่วยนับพื้นฐาน (Base Unit Locking):**

   * เพิ่มกฎความปลอดภัยของข้อมูล: ห้ามแก้ไขฟิลด์ `base_unit` หลังการบันทึกครั้งแรกที่มีข้อมูลระบุชัดเจนแล้วเท่านั้น (มีผลทั้งระดับ Zod schema validation และ UI)
3. **ล้างฟิลด์ล้าสมัยและไม่ได้ใช้งาน (Cleanup):**

   * ถอดฟิลด์ `default_purchasing_uom` ออกจาก Schema
   * ถอดฟิลด์ `distribution_mode` (GENERAL/CONTROLLED) ออก
   * ลบ Checkbox "Set as Default Option" ออกจากแบบฟอร์มลงทะเบียนสินค้าหลัก
4. **เพิ่มคุณสมบัติการจัดเก็บและสารก่อภูมิแพ้ (Storage & Allergens):**

   * เพิ่มฟิลด์ `shelf_life_days` (จำนวนวันอายุการจัดเก็บ, optional number)
   * เพิ่มฟิลด์ `storage_type` เป็น enum (optional): `DRY` (แห้ง) | `CHILLED` (แช่เย็น) | `FROZEN` (แช่แข็ง) | `CONTROLLED_MED` (ยาควบคุมอุณหภูมิ)
   * เพิ่มฟิลด์ `allergens` (array of strings, optional) สำหรับระบุประเภทสารก่อภูมิแพ้ของอาหาร
5. **ขยายมิติคุณสมบัติผู้รับ (Eligibility Tags):**

   * ปรับโครงสร้าง `target_restrictions` ให้รองรับ 3 มิติ ได้แก่:
     * `genders` (เพศที่รับได้): `male` | `female` | `other`
     * `vulnerable_groups` (กลุ่มเปราะบาง): `elderly` | `pregnant` | `bedridden` | `infant` | `isolated`
     * `diet_religions` (ข้อจำกัดด้านอาหาร/ศาสนา): `halal` | `vegetarian` | `vegan`

---

## Impact

* **Docs:**
  * [schema.md](../data/schema.md) §4.2: แก้ไขโครงสร้างตารางข้อมูลและคำอธิบายฟิลด์ของ `item_master` (เพิ่ม `item_class` และลบ UOM ล้าสมัย)
  * [_index.md](_index.md): ลงทะเบียนเอกสาร CR-082
* **Code:**
  * [catalog.ts](../../frontend/src/lib/features/catalog/domain/catalog.ts): ปรับปรุง `itemMasterInputSchema` และอินเตอร์เฟส `ItemMaster`
  * [item-master-form.svelte](../../frontend/src/lib/features/catalog/ui/item-master-form.svelte): ลบฟิลด์ที่ไม่ได้ใช้, เพิ่ม input fields ใหม่, และปิดปุ่มแก้ไข `base_unit` เมื่อเป็น edit mode
* **Tests:**
  * แก้ไข mock seed และ unit tests ใน `frontend/src/lib/features/catalog/` ที่มี dependencies ต่อฟิลด์ที่เปลี่ยนไป

---

## Migration

* **`schema_v` ของ `item_master` เปลี่ยนจาก `3` → `4`**
* ข้อมูลสินค้าเดิมที่บันทึกไว้ในระบบจะต้องทำการย้ายรุ่น (Migration):
  * เพิ่มฟิลด์ `item_class` และ backfill ค่าให้กับเอกสารสินค้าเดิมตามประเภทย้อนหลัง (เช่น category `"food"` ให้ backfill เป็น `"CONSUMABLE"`)
  * ลบฟิลด์ `default_purchasing_uom` ออกจากเอกสารสินค้าที่มีอยู่เดิม

---

## Decision log

* 2026-08-20 — proposed (ร่างเอกสาร Change Request สำหรับ Schema Alignment ของ Item Master ในระบบคลังสินค้า; renumbered เป็น CR-082 หลบ CR-081)
* 2026-08-21 — approved (project owner อนุมัติสเปก CR-082)
