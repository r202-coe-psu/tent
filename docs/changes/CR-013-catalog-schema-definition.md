---
title: Catalog Schema Definition
status: approved
created: 2026-06-25
updated: 2026-06-25
module: C
note: Mapping UI Form Fields to Database Schema
---

## 1. ปัญหาที่เจอ

Schema ของ Catelog ตาม Spec เดิมใน `docs/data/schema.md` บาง Field ไม่ตรงกับ Mock UI ค่อนข้างที่จะเยอะ และมี schema ของ Item Category เพิ่มมา จากเดิม 3 จะเพิ่มมาเป็น 4 และตัวของ sop_profile เหมือนจะไม่มีใน mock UI

### 2.1 หมวดหมู่สิ่งของ (Item Category)

| Field Name (DB Key) | Data Type | UI Label (ไทย)        | Validation / Constraints & Description                              |
| :------------------ | :-------- | :-------------------- | :------------------------------------------------------------------ |
| `_id`               | `string`  | ID ของสินค้า          | รูปแบบ`item_master:<sku>` หรือ `item_master:<uuid>`                 |
| `type`              | `string`  | หมวดหมู่ข้อมูล (Type) | ค่าคงที่ "หมวดหมู่สิ่งของ (Item Category)"                          |
| `name`              | `string`  | ชื่อสินค้า\*          | **Required**, ห้ามว่างเปล่า                                         |
| `is_default`        | `boolean` | Set as Default        | ค่าเริ่มต้นเป็น`false` (หากเป็น `true` จะถูกใช้เป็นหมวดหมู่ตั้งต้น) |

### 2.2 รายการสิ่งของ (Item Master) อาจจะหมายถึง supply_item

| Field Name (DB Key)      | Data Type                                                  | UI Label (ไทย)                     | Validation / Constraints & Description                                                                                                                                                                                                                                                                                                     |
| :----------------------- | :--------------------------------------------------------- | :--------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_id`                    | `string`                                                   | ID ของสินค้า                       | รูปแบบ`item_master:<sku>` หรือ `item_master:<uuid>`                                                                                                                                                                                                                                                                                        |
| `name`                   | `string`                                                   | ชื่อสินค้า\*                       | **Required**, ห้ามว่างเปล่า                                                                                                                                                                                                                                                                                                                |
| `SKU`                    | `string`                                                   | รหัสสินค้า (SKU)                   | เช่น P-001                                                                                                                                                                                                                                                                                                                                 |
| `description`            | `string`                                                   | รายละเอียด / หมายเหตุ              | -                                                                                                                                                                                                                                                                                                                                          |
| `base_unit`              | `string`                                                   | หน่วยที่เล็กที่สุด (Base Unit)     | หน่วยวัดที่เล็กที่สุดในระบบคลัง เช่น`ชิ้น (piece)`, `กรัม (g)`, `มิลลิลิตร (ml)`                                                                                                                                                                                                                                                           |
| `conversions`            | [{`uom_name`:str}, {`multiplier:number`}, {`barcode:str`}] | หน่วยทวีคูณ                        | รายการข้อมูลหน่วยแปลงสำหรับรับ/จ่ายของล็อตใหญ่,`uom_name` ชื่อหน่วยทวีคูณ ตัวอย่าง:`กล่อง (box)`, `กิโลกรัม (kg)`, `แพ็ค (pack)`, ` multiplier` อัตราส่วน (เท่ากับกี่หน่วยฐาน) ตัวเลขแสดงผลคูณ เช่น แพ็คละ`12` ชิ้น หรือ กิโลกรัมละ `1000`, `barcode` บาร์โค้ด (Optional) รหัสบาร์โค้ดสำหรับสแกนตัวหน่วยนี้โดยตรง (เช่น บาร์โค้ดข้างกล่อง) |
| `default_purchasing_uom` | `string`                                                   | หน่วยสำหรับสั่งซื้อ                | หน่วยเริ่มต้นเวลาทำใบสั่งซื้อ (เช่น`แพ็ค` หรือ `ลัง`)                                                                                                                                                                                                                                                                                      |
| `default_inventory_uom`  | `string`                                                   | หน่วยสำหรับจัดเก็บ                 | หน่วยที่ใช้รายงานจำนวนในรายงานสต็อกหลัก (เช่น`กิโลกรัม` หรือ `ชิ้น`)                                                                                                                                                                                                                                                                       |
| `default_issue_uom`      | `string`                                                   | หน่วยสำหรับเบิกจ่าย                | หน่วยเริ่มต้นเวลาจัดสรรแจกจ่ายให้ผู้ลี้ภัย (เช่น`ชิ้น` หรือ `กระป๋อง`)                                                                                                                                                                                                                                                                     |
| `distribution_type`      | `enum`                                                     | ประเภทการแจกจ่าย                   | `'วัสดุสิ้นเปลือง'` (Consumable) หรือ `'One_time'` (รายคน)                                                                                                                                                                                                                                                                                 |
| `target_reserve_days`    | `number`                                                   | เป้าหมายการสำรองสูงสุด (วัน)       | จำนวนวันที่คลังต้องสำรองของชิ้นนี้ไว้สูงสุดเพื่อแจ้งเตือนความปลอดภัย                                                                                                                                                                                                                                                                       |
| `consumption_rate`       | `number`                                                   | อัตราการบริโภค                     | อัตราการใช้ของต่อคนหรือต่อครัวเรือนตาม`distribution_type`                                                                                                                                                                                                                                                                                  |
| `unit`                   | `enum`                                                     | หน่วยของอัตราการบริโภค             | -                                                                                                                                                                                                                                                                                                                                          |
| `timeframe`              | `enum`                                                     | กรอบเวลา                           | `'daily'` (ต่อวัน) หรือ `'weekly'` (ต่อสัปดาห์)                                                                                                                                                                                                                                                                                            |
| `sphere_standard`        | `number`                                                   | ตัวคูณมาตรฐานดำรงชีพ (Sphere / คน) | อ้างอิงเกณฑ์มาตรฐาน Sphere สากลต่อคน (เช่น น้ำใช้อัตรา 3 ลิตร/วัน)                                                                                                                                                                                                                                                                         |
| `overstock_alert_days`   | `number`                                                   | แจ้งเตือนสินค้าล้นสต็อก (วัน)      | จำนวนวันคงคลังหากมีของในคลังเกินจำนวนวันนี้จะแจ้งเตือน Overstock                                                                                                                                                                                                                                                                           |
| `target_audience_type`   | `enum`                                                     | เป้าหมายการแจกจ่าย                 | `'All / No Restriction'` (แจกทุกคน) หรือ `'Specific Segments'` (จำกัดเฉพาะกลุ่ม) **หมายเหตุ** มี field ย่อยให้เลือกอีก                                                                                                                                                                                                                     |
| `target_restrictions`    | `object`                                                   | เงื่อนไขจำกัดกลุ่มผู้รับ           | **Optional** (ใช้ระบุเมื่อ `target_audience_type === 'Specific Segments`)                                                                                                                                                                                                                                                                  |
| `├─ genders`             | `array [string]`                                           | เพศ                                | สมาชิกในเซ็ต:`['male', 'female', 'other']`                                                                                                                                                                                                                                                                                                 |
| `├─ vulnerable_groups`   | `array [string]`                                           | กลุ่มเปราะบาง                      | สมาชิกในเซ็ต:`['elderly', 'pregnant', 'bedridden', 'infant', 'isolated']`                                                                                                                                                                                                                                                                  |
| `└─ diet_religions`      | `array [string]`                                           | ศาสนา / อาหารเฉพาะกลุ่ม            | สมาชิกในเซ็ต:`['halal', 'vegetarian', 'vegan']`                                                                                                                                                                                                                                                                                            |
| `is_default`             | `boolean`                                                  | Set as Default                     | ตั้งค่ารายการสินค้าชิ้นนี้เป็นไอเทมมาตรฐานหลัก                                                                                                                                                                                                                                                                                             |

## 3. สูตรมาตรฐาน BOM (Standard Recipe BOM) อาจจะหมายถึง recipe

_ฐานข้อมูล: `catalog` | คอลเลกชันประเภท ( discriminator ): `recipe`_

| Field Name (DB Key)       | Data Type                                                   | UI Label (ไทย)                 | Validation / Constraints & Description                                                                                                                                                      |
| :------------------------ | :---------------------------------------------------------- | :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `_id`                     | `string`                                                    | ID ของสูตรอาหาร                | รูปแบบ`recipe:<uuid>`                                                                                                                                                                       |
| `type`                    | `string`                                                    | ประเภทเอกสาร                   | ค่าคงที่`'recipe'`                                                                                                                                                                          |
| `label`                   | `string`                                                    | ชื่อแสดงผลภาษาไทย\*            | **Required**, ห้ามว่างเปล่า (เช่น "ข้าวไข่เจียว", "แกงเขียวหวานไก่")                                                                                                                        |
| `ingredients`             | [{`item_master_id`:str}, {`quantity:number`}, {`uom: str`}] | รายการส่วนประกอบ (JSON)        | รายการวัตถุดิบและปริมาณใช้งานจริงในสูตรอาหาร**หมายเหตุ** มีปุ่มให้กดเพิ่ม ingredients ได้ `item_master_id` ค้นหาวัตถุดิบจากคลัง อ้างอิง ID ของ`item_master`, `quantity` ปริมาณ, `uom` หน่วย |
| `standard_portions`       | `number`                                                    | ยอดกำลังผลิตมาตรฐาน (Portions) | จำนวนที่ผลิตได้ต่อหนึ่งรอบประกอบอาหาร (เช่น 100 จาน)                                                                                                                                        |
| `standard_duration_hours` | `number`                                                    | ระยะเวลาผลิตมาตรฐาน (ชั่วโมง)  | ระยะเวลาทำงานปรุงสูตรนี้ตั้งแต่เตรียมจนเสร็จในหน่วยชั่วโมง                                                                                                                                  |
| `is_default`              | `boolean`                                                   | Set as Default                 | ตั้งค่าเป็นสูตรอาหารมาตรฐานหลักของศูนย์                                                                                                                                                     |

## 2. เหตุผลที่ปลี่ยน

- ความไม่สอดคล้องกัน: สเปกโครงสร้างข้อมูล (Schema) ในปัจจุบันสำหรับคลังสินค้า (Catalog) ไม่ตรงกับ Mock UI ของหน้า Back-office
- การแยกหมวดหมู่และรายการ: Mock UI ปัจจุบันแยกข้อมูลสิ่งของออกเป็น 2 แท็บ/ฟังก์ชันชัดเจน ได้แก่ หมวดหมู่สิ่งของ (Item Category) และ รายการสินค้าหลัก (Item Master) (เดิมใน `schema.md` มีเพียง `supply_item` แบบรวมๆ ทำให้ฟิลด์ไม่เอื้อต่อการใส่ข้อมูล SKU, conversions, หรือ restrictions ที่ละเอียดขึ้น)
- ตัดการเชื่อมโยง SOP Profile ออก: ในระบบเดิมผูกปุ่มแท็บ 2 ไปยัง `sop_profile` ซึ่งไม่ตรงกับ Mock UI และการออกแบบ SOP Ratios ใหม่ (CR-006)
- ปรับปรุงสูตรอาหาร (Standard Recipe BOM): เพื่อให้สอดรับกับการบันทึกปริมาณการผลิตมาตรฐาน (portions) ระยะเวลาผลิต และรายการวัตถุดิบ (ingredients) แบบเป็น Array

## 3. วิธีการเปลี่ยนแปลง

- Model & Type: สร้าง Zod schema และ Interface ใหม่สำหรับ `ItemCategory`, ปรับปรุง `SupplyItem (Item Master)` และ `Recipe` ให้ครอบคลุมฟิลด์ใหม่ทั้งหมด รวมถึงแก้ไข Factory functions ใน
  catalog.ts
- UI & Routing: แก้ไข tab states ใน `+page.svelte` ให้ชี้หาแท็บ Item Master ให้ถูกต้อง และพัฒนาตาราง/แบบฟอร์มแสดงผลภายใน `item-master-tab.svelte` และ`recipe-tab.svelte`

## 4. ไฟล์ที่ได้รับผลกระทบ

- เอกสาร: schema.md, schema-er-diagram.md
- แกนหลักของ Catalog Feature:
- catalog.ts, catalog.pouch.ts, catalog.repository.ts, index.ts
  `frontend/src/lib/features/catalog/domain/catalog.ts`

## 5. สิ่งที่ต้องปรับ Spec

- Version bump: ต้องมีการอัปเกรด schema_v ของ supply_item และ recipe จาก 1 เป็น 2 เนื่องจากมีการเปลี่ยนแปลงฟิลด์หลักอย่างชัดเจน
- CouchDB validation: ปรับแก้เงื่อนไขฟังก์ชันตรวจสอบเอกสาร (validate_doc_update) ที่ CouchDB ให้รองรับการตรวจสอบฟิลด์แบบใหม่ของ item_category และ recipe
