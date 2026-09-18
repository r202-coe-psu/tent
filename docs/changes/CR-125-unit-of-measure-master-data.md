---
id: CR-125
title: Unit of Measure master data and protected UOM invariants
status: done
date: 2026-09-17
updated: 2026-09-17
requested_by: Project Owner (PR review follow-up)
decided_by: Project Owner
layer: stable
affects:
  - docs/data/schema.md §4.2 (`item_master`), §4.9 (`unit_of_measure` schema_v 1) and §8 validation rules
  - docs/changes/CR-120-fuel-energy-gas-inventory.md §3.1/§4.1 (amend base_unit "ถัง" -> "cylinder")
  - docs/data/schema-er-diagram.md line 176 (item_master.base_unit)
  - frontend/src/lib/features/catalog/domain/unit-of-measure.ts
  - frontend/src/lib/features/catalog/data/catalog.remote.ts
  - frontend/src/routes/(protected)/back-office/catalog/components/unit-of-measure-tab.svelte
  - frontend/scripts/sync-central-db.ts
  - frontend/scripts/seed/master-seed.ts
  - frontend/src/lib/server/shelter-access-design.ts
  - frontend/src/lib/server/shelter-access-design.test.ts
---

# CR-125 — Unit of Measure Master Data and Protected UOM Invariants

> **สรุป (TL;DR):** เพิ่ม `unit_of_measure` เป็น master data ระดับส่วนกลางในฐานข้อมูล `catalog` ด้วย `schema_v: 1` และ deterministic ID `unit_of_measure:{code}` · seed หน่วยมาตรฐาน 27 รายการแบบ idempotent · บังคับ `code` เป็น immutable สำหรับทุกหน่วย · ป้องกันหน่วยระบบจากการลบ การเปลี่ยน `code`/`dimension` และการปลด `is_protected` · กำหนดขอบเขตชัดเจนว่าฐานข้อมูลศูนย์พักพิง (`shelter_*`) ไม่อนุญาตให้เขียน UOM (read-only replica) · ปรับแก้ CR-120 ให้ `base_unit` ของแก๊สเป็น `"cylinder"` พร้อมตาราง Legacy Compatibility Matrix ที่รองรับภาษาไทยเดิมผ่าน `formatUnit` โดยไม่กระทบเอกสารเดิม

## 1. Why

1. ระบบต้องใช้หน่วยนับชุดเดียวกันใน Catalog, Item Master, donation และ stock flow เพื่อให้การแสดงผลและการอ้างอิง `base_unit` ตรงกันตามรหัสมาตรฐานสากล
2. หน่วยมาตรฐานต้องถูก seed ลง `catalog` ตั้งแต่เริ่มต้น และการ seed ซ้ำต้องไม่สร้างเอกสารซ้ำหรือเขียนทับ label ที่ `system_admin` ปรับแล้ว
3. `code` เป็นส่วนหนึ่งของ deterministic `_id` และถูกอ้างอิงเป็น foreign key หากอนุญาตให้แก้ไข `code` ไม่ว่าจะเป็นหน่วยระบบหรือหน่วยที่สร้างเอง จะทำให้ `_id` และจุดอ้างอิงแตก
4. หน่วย protected เป็นข้อมูลระบบ หากปลด `is_protected` ได้ จะเปิดทางให้การอัปเดตหรือลบในคำขอถัดไปหลุดจาก guard จึงต้องบังคับ invariant ให้เคร่งครัด
5. เพื่อป้องกันไม่ให้ข้อมูล Master Data แตกแขนงในแต่ละศูนย์พักพิง เอกสาร UOM ต้องเขียนได้เฉพาะในฐานข้อมูล `catalog` ส่วนกลางเท่านั้น ส่วนฐานข้อมูลศูนย์พักพิง (`shelter_*`) ทำหน้าที่เป็นเพียง read-only replica

## 2. Change

| Area | Requirement |
| --- | --- |
| Document type | เพิ่ม `unit_of_measure` ใน `catalog` เท่านั้น; `_id` เป็น `unit_of_measure:{code}`; `schema_v: 1` |
| Code | `code` ต้องเป็น lowercase `[a-z][a-z0-9_]{0,15}`; **immutable สำหรับทุกเอกสาร UOM** (ทั้งระบบและ custom); ใช้เป็นค่าอ้างอิงใน `item_master.base_unit` |
| Dimensions | รองรับ `count`, `mass`, `volume`, `length` |
| Labels | รองรับ `label_th`, `label_th_short`, `label_en` และลำดับ `sort_order` |
| Lifecycle | `deactivated` ใช้ปิดหน่วยจากตัวเลือกใหม่ โดยไม่ลบเอกสาร master; หากต้องการเปลี่ยน code ของหน่วย custom ให้สร้างใหม่แล้ว deactivate หน่วยเดิม |
| Protection | System-seeded UOM ต้องมี `is_protected: true`; ห้ามลบ ห้ามเปลี่ยน `code`/`dimension` และห้ามปลดสถานะ `is_protected` เป็น `false` |
| Write Boundary | `unit_of_measure` จัดเก็บเฉพาะใน DB `catalog` ส่วนกลาง; ฐานข้อมูลศูนย์พักพิง (`shelter_{shelter_code}`) ปฏิเสธการเขียน UOM เด็ดขาด (`doc type not allowed yet`) |
| Authorization | ระดับ Application บังคับบทบาท `system_admin`; ระดับ CouchDB transport อนุญาตเฉพาะ role `system_admin` หรือ session `_admin` bypass |

## 3. Canonical seed set

Seeder ต้องจัดการหน่วยต่อไปนี้รวม 27 รายการแบบ idempotent:

| Dimension | Codes |
| --- | --- |
| `count` | `piece`, `unit`, `item`, `set`, `pair`, `box`, `pack`, `bag`, `sachet`, `bottle`, `can`, `tablet`, `bar`, `tube`, `roll`, `sheet`, `cloth`, `bundle`, `egg`, `fruit`, `cylinder` |
| `mass` | `g`, `kg` |
| `volume` | `gallon`, `ml`, `l` |
| `length` | `m` |

Seed behavior:

- เอกสารที่ไม่มีอยู่ต้องสร้างพร้อม `schema_v: 1`, metadata, labels, `dimension`, `sort_order`, `deactivated: false` และ `is_protected: true`
- เอกสารที่มีอยู่ต้องคง label และ metadata ที่ผู้ดูแลแก้ไขได้ แต่บังคับ `code`, `dimension`, `schema_v` และ `is_protected: true` ให้ตรงกับ master definition
- การรันซ้ำต้องเป็น idempotent และไม่สร้าง `_id` ใหม่

## 4. Invariants

ระบบต้องบังคับกฎเดียวกันใน Application Service, Repository/UI และ CouchDB VDU:

### 4.1 Universal Invariants (ทุกเอกสาร `unit_of_measure`)
- **Immutable Code:** ห้ามแก้ไขฟิลด์ `code` ในทุกกรณี (`oldDoc.code !== newDoc.code` จะถูก reject) เนื่องจากสัมพันธ์กับ `_id` และการอ้างอิง foreign key

### 4.2 Protected UOM Invariants (เมื่อ `oldDoc.is_protected === true`)
- **ห้ามลบ:** ปฏิเสธการลบ (`newDoc._deleted === true`) ด้วย `Cannot delete system protected unit of measure`
- **Immutable Code & Dimension:** ปฏิเสธการแก้ `code` หรือ `dimension` ด้วย `Cannot modify code or dimension of a protected unit of measure`
- **ห้ามปลดสถานะ Protected:** ปฏิเสธเมื่อคำขออัปเดตพยายามเปลี่ยนสถานะจาก true เป็น false:
  ```javascript
  if (oldDoc.type === 'unit_of_measure' && oldDoc.is_protected === true && newDoc.is_protected !== true) {
    throw { forbidden: 'Cannot unprotect a system protected unit of measure' };
  }
  ```
- **การแก้ไขข้อมูลทั่วไป:** การแก้ `label_th`, `label_th_short`, `label_en`, `sort_order` หรือสถานะ `deactivated` ทำได้ตามสิทธิ์ `system_admin` โดยต้องคง invariants ข้างต้นทั้งหมด

## 5. Implementation traceability & Topology

- `frontend/src/lib/features/catalog/domain/unit-of-measure.ts` — Type, Zod schemas (บังคับ `unitOfMeasureUpdateSchema` ไม่ให้มี `code` และ `dimension`), factory และ formatter
- `frontend/src/lib/features/catalog/data/catalog.remote.ts` — Repository CRUD พร้อม client-side guard ป้องกันการปลด `is_protected`, แก้ `code`/`dimension` หรือลบหน่วย protected
- `frontend/src/routes/(protected)/back-office/catalog/components/unit-of-measure-tab.svelte` — หน้าจัดการ master UOM รองรับการสร้าง/แก้ไข label/deactivate
- `frontend/scripts/sync-central-db.ts` — ซิงก์ Catalog DB VDU (`_design/access.validate_doc_update`) สำหรับตรวจสอบสิทธิ์ `system_admin`/`_admin` และป้องกันการแก้ไข protected UOM
- `frontend/scripts/seed/master-seed.ts` — Provisioning canonical seed 27 หน่วยแบบ idempotent
- `frontend/src/lib/server/shelter-access-design.ts` — VDU ของฐานข้อมูลศูนย์พักพิง (`shelter_{shelter_code}`) **ไม่รวม** `unit_of_measure` ใน whitelist doc types (`allowed`), ส่งผลให้ shelter ปฏิเสธการเขียน UOM ทุกกรณี (`doc type not allowed yet: unit_of_measure`)
- `frontend/src/lib/server/shelter-access-design.test.ts` — Regression test ยืนยันว่าการเขียน `unit_of_measure` ใน shelter DB ถูกปฏิเสธ

## 6. Migration and compatibility

- เป็นการเพิ่ม doc type ใหม่แบบ additive ที่ `schema_v: 1`; ไม่ต้อง bump `item_master.schema_v` หรือทำลายข้อมูลเดิม
- **Amends CR-120 (FUEL_ENERGY Gas Inventory):** ปรับแก้ข้อกำหนดเดิมของ CR-120 (§3.1 และ FR-04) ที่เคยล็อค `base_unit = "ถัง"` ให้เปลี่ยนเป็น canonical UOM code `base_unit = "cylinder"`; โดย UI และเอกสารแสดงผลเป็น `"ถัง"` อัตโนมัติผ่าน `formatUnit('cylinder')`
- **Legacy Base Unit Mapping Table:**
  ระบบรองรับการอ่านข้อมูลย้อนหลัง (Backward Compatibility) ทั้งรหัสใหม่และข้อความภาษาไทยเดิมผ่าน `formatUnit`:

  | Legacy Thai `base_unit` | Canonical `unit_of_measure.code` | คำแสดงผล (`formatUnit`) |
  | --- | --- | --- |
  | `ชิ้น` | `piece` | ชิ้น |
  | `ถัง` | `cylinder` | ถัง |
  | `กรัม` | `g` | กรัม |
  | `กิโลกรัม` | `kg` | กิโลกรัม |
  | `มิลลิลิตร` | `ml` | มิลลิลิตร |
  | `ลิตร` | `l` | ลิตร |
  | `กล่อง` | `box` | กล่อง |
  | `แพ็ค` / `แพค` | `pack` | แพ็ค |
  | `ขวด` | `bottle` | ขวด |
  | `กระป๋อง` | `can` | กระป๋อง |
  | `ซอง` | `sachet` | ซอง |
  | `แผง` / `เม็ด` | `tablet` | เม็ด |
  | `ชุด` | `set` | ชุด |

- **Write Path & Update Policy:**
  - สินค้าสร้างใหม่: บังคับ `base_unit` เป็น canonical code (regex `^[a-z][a-z0-9_]{0,15}$`)
  - สินค้าเดิม: สามารถอัปเดตฟิลด์อื่นได้โดยไม่ถูกบล็อก และแนะนำให้ normalize เป็นรหัสสากลเมื่อมีการแก้ไขข้อมูลหน่วย
- **Scope ของฟิลด์หน่วยอื่น:**
  - `default_inventory_uom` และ `default_issue_uom` ใน `item_master` ให้อ้างอิงตาม `unit_of_measure.code` หรือ conversion packaging
  - `conversions[].uom_name` เป็นชื่อบรรจุภัณฑ์ทวีคูณ (เช่น "กล่อง 24 ขวด") หรือ UOM code
  - `recipe.ingredients[].uom` อยู่นอกขอบเขตของ CR-125 (ยังคงเป็น `str` ตามสูตรอาหารเดิม)

## 7. Acceptance Criteria

- [x] **AC-01:** Catalog schema ระบุ `unit_of_measure` พร้อม fields, `schema_v: 1`, deterministic ID และ 4 dimensions
- [x] **AC-02:** Seeder สร้าง/ซ่อมชุด canonical UOM 27 รายการแบบ idempotent และคง label ที่ผู้ดูแลแก้ไข
- [x] **AC-03:** Protected UOM ถูกปฏิเสธเมื่อ delete หรือเปลี่ยน `code`/`dimension`
- [x] **AC-04:** Protected UOM ถูกปฏิเสธเมื่อ request เปลี่ยน `is_protected` จาก `true` เป็น `false` ที่ VDU
- [x] **AC-05:** ฟิลด์ `code` เป็น immutable สำหรับทุก UOM (ทั้งระบบและ custom)
- [x] **AC-06:** ฐานข้อมูลศูนย์พักพิง (`shelter_*`) ปฏิเสธการเขียน `unit_of_measure` ทุกกรณี
- [x] **AC-07:** `item_master` schema รองรับทั้ง code ใหม่และ label legacy โดย `formatUnit` แสดงผลถูกต้อง
- [x] **AC-08:** CR-120 และ `schema-er-diagram.md` ได้รับการปรับปรุงให้ใช้ `cylinder` สอดคล้องกัน

## 8. Decision Log

- **2026-09-17:** บันทึก Unit of Measure เป็น catalog master data ระดับส่วนกลางแยกจาก `item_master` เพื่อให้หลาย feature ใช้ code และ label ชุดเดียวกัน
- **2026-09-17:** ใช้ deterministic `_id` จาก `code` และกำหนด canonical seed set 27 รายการเพื่อให้ provisioning ทำซ้ำได้อย่างปลอดภัย
- **2026-09-17:** กำหนดให้ `code` เป็น immutable สำหรับทุก UOM เพื่อป้องกัน deterministic `_id` และ foreign key reference เสียหาย
- **2026-09-17:** กำหนด Topology ชัดเจน: UOM จัดเก็บใน `catalog` DB เท่านั้น โดยฐานข้อมูลศูนย์พักพิง (`shelter_*`) เป็น read-only replica และปฏิเสธการเขียน UOM เด็ดขาด
- **2026-09-17:** ปรับแก้ CR-120 ให้ใช้ `base_unit = "cylinder"` ทดแทนภาษาไทย `"ถัง"` พร้อมกำหนดตาราง Legacy Compatibility Matrix เพื่อความเข้ากันได้ย้อนหลัง 100%
