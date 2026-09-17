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
  - docs/data/schema.md §4.9 (`unit_of_measure` schema_v 1) and §8 validation rules
  - frontend/src/lib/features/catalog/domain/unit-of-measure.ts
  - frontend/src/lib/features/catalog/data/catalog.remote.ts
  - frontend/src/routes/(protected)/back-office/catalog/components/unit-of-measure-tab.svelte
  - frontend/scripts/sync-central-db.ts
  - frontend/scripts/seed/master-seed.ts
  - frontend/src/lib/server/shelter-access-design.ts
  - frontend/src/lib/server/shelter-access-design.test.ts
---

# CR-125 — Unit of Measure Master Data and Protected UOM Invariants

> **สรุป (TL;DR):** เพิ่ม `unit_of_measure` เป็น master data ใน `catalog` ด้วย `schema_v: 1` และ deterministic ID `unit_of_measure:{code}` · seed หน่วยมาตรฐาน 27 รายการแบบ idempotent · ป้องกันหน่วยระบบจากการลบ การเปลี่ยน `code`/`dimension` และการปลด `is_protected` · กระทบเฉพาะ Catalog UOM และจุดอ้างอิง `item_master.base_unit` โดยไม่ bump schema ของ `item_master`

## 1. Why

1. ระบบต้องใช้หน่วยนับชุดเดียวกันใน Catalog, Item Master, donation และ stock flow เพื่อให้การแสดงผลและการอ้างอิง `base_unit` ตรงกัน
2. หน่วยมาตรฐานต้องถูก seed ลง `catalog` ตั้งแต่เริ่มต้น และการ seed ซ้ำต้องไม่สร้างเอกสารซ้ำหรือเขียนทับ label ที่ `system_admin` ปรับแล้ว
3. หน่วย protected เป็นข้อมูลระบบ หากปลด `is_protected` ได้ จะเปิดทางให้การอัปเดตหรือลบในคำขอถัดไปหลุดจาก guard จึงต้องบังคับ invariant ที่ CouchDB VDU และ sync design

## 2. Change

| Area | Requirement |
| --- | --- |
| Document type | เพิ่ม `unit_of_measure` ใน `catalog`; `_id` เป็น `unit_of_measure:{code}`; `schema_v: 1` |
| Code | `code` ต้องเป็น lowercase `[a-z][a-z0-9_]{0,15}` และใช้เป็นค่าที่อ้างอิงจาก `item_master.base_unit` |
| Dimensions | รองรับ `count`, `mass`, `volume`, `length` |
| Labels | รองรับ `label_th`, `label_th_short`, `label_en` และลำดับ `sort_order` |
| Lifecycle | `deactivated` ใช้ปิดหน่วยจากตัวเลือกใหม่ โดยไม่ลบเอกสาร master |
| Protection | System-seeded UOM ต้องมี `is_protected: true`; ห้ามลบ ห้ามเปลี่ยน `code`/`dimension` และห้ามเปลี่ยน `true` เป็น `false` |
| Authorization | Global catalog UOM เขียนได้เฉพาะ `system_admin`/`_admin`; shelter client อ่านผ่าน catalog replica ตาม endpoint policy |

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

## 4. Protected UOM invariants

ระบบต้องบังคับกฎเดียวกันใน repository/UI และ CouchDB VDU:

- เมื่อ `oldDoc.type = unit_of_measure` และ `oldDoc.is_protected = true`, คำขอ update ต้องส่ง `is_protected: true` กลับมาเสมอ
- เมื่อเงื่อนไขข้างต้นไม่เป็นจริง ให้ reject ด้วย `Cannot unprotect a system protected unit of measure`
- การเปลี่ยน `code` หรือ `dimension` ของ protected UOM ให้ reject ด้วยข้อความเดิมของ guard
- การ delete protected UOM ให้ reject ด้วย `Cannot delete system protected unit of measure`
- การแก้ label, short label, ลำดับ หรือสถานะ deactivated ทำได้เมื่อยังรักษา invariants ข้างต้น

## 5. Implementation traceability

- `frontend/src/lib/features/catalog/domain/unit-of-measure.ts` — type, Zod input/update schema, deterministic factory, fallback labels และ formatter
- `frontend/src/lib/features/catalog/data/catalog.remote.ts` — repository CRUD และ client-side protected checks
- `frontend/src/routes/(protected)/back-office/catalog/components/unit-of-measure-tab.svelte` — หน้าจัดการ master UOM ที่ใช้ร่วมกับ back-office และ system-management
- `frontend/scripts/sync-central-db.ts` — central catalog seed และ `_design/access.validate_doc_update`
- `frontend/scripts/seed/master-seed.ts` — development/staging catalog seed
- `frontend/src/lib/server/shelter-access-design.ts` — shelter/edge design validator และ protected invariant guard
- `frontend/src/lib/server/shelter-access-design.test.ts` — regression test ของ VDU: delete, code/dimension mutation และ unprotect

## 6. Migration and compatibility

- เป็นการเพิ่ม doc type ใหม่แบบ additive; ไม่ต้อง migrate หรือลบเอกสารเดิม และไม่ bump `item_master.schema_v`
- ค่า `item_master.base_unit` เดิมยังใช้ต่อได้เมื่อเป็น UOM code ที่ valid
- `formatUnit` รองรับทั้ง UOM code และ label ภาษาไทย legacy เพื่อไม่ให้ข้อมูลเก่าแสดงผลเป็น raw code โดยไม่จำเป็น
- การ deploy ต้องติดตั้ง/อัปเดต catalog design document ก่อนเปิดให้ client เขียน master data

## 7. Acceptance Criteria

- [x] **AC-01:** Catalog schema ระบุ `unit_of_measure` พร้อม fields, `schema_v: 1`, deterministic ID และ 4 dimensions
- [x] **AC-02:** Seeder สร้าง/ซ่อมชุด canonical UOM 27 รายการแบบ idempotent และคง label ที่ผู้ดูแลแก้ไข
- [x] **AC-03:** Protected UOM ถูกปฏิเสธเมื่อ delete หรือเปลี่ยน `code`/`dimension`
- [x] **AC-04:** Protected UOM ถูกปฏิเสธเมื่อ request เปลี่ยน `is_protected` จาก `true` เป็น `false` ที่ VDU
- [x] **AC-05:** `item_master` schema เดิมยังใช้ได้ และ formatter แสดงผลทั้ง code ใหม่กับ label legacy

## 8. Decision Log

- **2026-09-17:** บันทึก Unit of Measure เป็น catalog master data แยกจาก `item_master` เพื่อให้หลาย feature ใช้ code และ label ชุดเดียวกัน
- **2026-09-17:** ใช้ deterministic `_id` จาก `code` และกำหนด canonical seed set 27 รายการเพื่อให้ provisioning ทำซ้ำได้อย่างปลอดภัย
- **2026-09-17:** กำหนด protected invariant สามชั้น — repository, catalog design validator และ shelter/edge design validator — โดยห้ามปลด `is_protected` จาก `true` เป็น `false`
