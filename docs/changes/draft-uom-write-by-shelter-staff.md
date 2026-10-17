---
id: draft
title: "เจ้าหน้าที่คลังสร้างหน่วยนับ และสร้างรายการในคลังของศูนย์ได้จากหน้าตรวจรับบริจาค"
status: proposed
date: 2026-10-17
requested_by: "เจ้าของโครงการ — issue #622 และการตัดสินใจ 2026-10-17"
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/changes/03-C-supply/CR-125-unit-of-measure-master-data.md §2 (Authorization: system_admin เท่านั้น)
  - docs/data/schema.md §4.9 `unit_of_measure` (Write boundary & Authorization) และ §8 ข้อ 12
  - docs/prd/role-permission-matrix.md (ถ้ามีแถว catalog / หน่วยนับ)
  - frontend/scripts/sync-central-db.ts (validate_doc_update ของ DB `catalog`)
  - frontend/src/lib/features/catalog/application/queries.ts (`useCreateUnitOfMeasure`)
  - frontend/src/routes/(protected)/back-office/catalog/components/unit-of-measure-tab.svelte (sheet สร้างหน่วย)
  - frontend/src/lib/features/catalog/ui/master/master-item-sheet.svelte (sheet สร้างรายการ)
  - frontend/src/routes/(protected)/back-office/stock-donations/components/scan-station.svelte (ข้อตัดสินเดิม "ไม่สร้างรายการที่หน้านี้")
why: ของบริจาคที่ยังไม่มีในคลังรับเข้าไม่ได้ เพราะหน้าตรวจรับไม่ให้สร้างรายการ และสร้างหน่วยใหม่ได้แค่ผู้ดูแลระบบ เจ้าหน้าที่ต้องรอคนอื่นก่อนรับของ
migration: N/A — ไม่เปลี่ยนรูป doc ไม่ bump schema_v · ต้อง deploy design doc ของ DB `catalog` ใหม่
---

# เจ้าหน้าที่คลังสร้างหน่วยนับและรายการในคลังได้จากหน้าตรวจรับบริจาค

## สรุป

- **เปลี่ยน:** `warehouse_staff` และ `shelter_manager` สร้าง `unit_of_measure` ได้ (เดิม `system_admin` เท่านั้น) และสร้างรายการในคลังของศูนย์ตัวเองได้จากหน้าตรวจรับบริจาค
- **เพื่อ:** ของบริจาคที่ยังไม่มีในคลัง หรือมีหน่วยที่ระบบยังไม่รู้จัก รับเข้าได้ทันทีที่เคาน์เตอร์
- **dev ต้อง build:** ปุ่ม "สร้างรายการใหม่" ในช่องรายการในคลัง → sheet ขวา (สร้าง item master + หน่วยใหม่ได้ในที่เดียว) → บันทึกแล้วเลือกให้ทันที · เปิดสิทธิ์สร้างหน่วยทั้งชั้น app และ CouchDB
- **กระทบ:** CR-125 §2 · `schema.md` §4.9 และ §8 ข้อ 12 · ไม่เปลี่ยนรูป doc

## Requirements

### สิทธิ์สร้างหน่วยนับ
- **FR-1** — `warehouse_staff` และ `shelter_manager` สร้าง `unit_of_measure` ใหม่ได้ (ยังเก็บใน DB `catalog` กลางที่เดียว ทุกศูนย์เห็นร่วมกัน)
- **FR-2** — บทบาทในข้อ FR-1 **แก้หรือปิด**หน่วยที่มีอยู่ไม่ได้ (ยังเป็นสิทธิ์ `system_admin`) — เปิดเฉพาะการสร้างใหม่
- **FR-3** — กติกาเดิมของหน่วยยังบังคับครบ: `code` ตาม regex `^[a-z][a-z0-9_]{0,15}$` และ immutable · หน่วย `is_protected` ห้ามแก้/ลบ · ห้าม `code` ซ้ำ
- **FR-4** — บังคับทั้งชั้น app (`useCreateUnitOfMeasure`) และ CouchDB (`validate_doc_update` ของ `catalog`)
- **FR-5** — DB ของศูนย์ (`shelter_{code}`) ยังปฏิเสธการเขียน `unit_of_measure` ทุกกรณี (เดิม)

### สร้างรายการในคลังจากหน้าตรวจรับ
- **FR-6** — ช่อง "รายการในคลัง" ของแต่ละบรรทัดในหน้าตรวจรับ (และ Walk-in) มีปุ่ม "สร้างรายการใหม่"
- **FR-7** — กดแล้วเปิด sheet ที่สไลด์มาจากขวา (ใช้ `master-item-sheet.svelte` โหมดสร้าง หรือ component ที่แยกจากมัน) ค่าเริ่มต้นของชื่อมาจากชื่อที่ผู้บริจาคพิมพ์
- **FR-8** — ใน sheet ช่องหน่วยเป็น search-select ของหน่วยที่มีอยู่ และมีปุ่ม "เพิ่มหน่วยใหม่" ที่สร้าง `unit_of_measure` ได้ในขั้นเดียวกัน (FR-1)
- **FR-9** — รายการที่สร้างจากหน้านี้เป็น **รายการของศูนย์นี้เท่านั้น** (`item_master` ที่มี `shelter_code` ของศูนย์) — สิทธิ์ CouchDB รองรับอยู่แล้ว ไม่ต้องแก้ (`sync-central-db.ts` สาขา `newDoc.shelter_code`)
- **FR-10** — บันทึกสำเร็จ → sheet ปิด · บรรทัดนั้นเลือกรายการใหม่ · หน่วยของบรรทัดเป็น `base_unit` ของรายการใหม่ · ตัวเลือกในบรรทัดอื่นเห็นรายการใหม่ทันที
- **FR-11** — ยกเลิกข้อตัดสินเดิมใน `scan-station.svelte` ที่ไม่ให้สร้างรายการที่หน้านี้ (comment ที่อธิบายไว้ต้องลบออก)

## Change (before → after)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| ใครสร้าง `unit_of_measure` ได้ | `system_admin` เท่านั้น (CR-125 §2, `schema.md` §4.9, `queries.ts` `useCreateUnitOfMeasure`, VDU `unit_of_measure is central-only`) | `system_admin` + `warehouse_staff` + `shelter_manager` (สร้างใหม่เท่านั้น) |
| ใครแก้/ปิดหน่วย | `system_admin` | `system_admin` (เดิม) |
| สร้างรายการในคลังที่หน้าตรวจรับ | ไม่ได้ (ตั้งใจไว้ — ของที่ไม่ตรงให้เขียนในหมายเหตุ) | ได้ เป็นรายการของศูนย์นี้ |
| ของบริจาคที่พิมพ์เองและไม่มีรายการในคลังตรงกัน | ไม่เข้าคลัง (`donation-intake.ts` `toCountedItems` ตัดบรรทัด `free_text`) | เจ้าหน้าที่สร้างรายการแล้วรับเข้าคลังได้ในหน้าเดียว |

## Acceptance

- **AC-1** — `warehouse_staff` สร้างหน่วย `lang` ("ลัง") จาก sheet ได้ · `system_admin` เห็นหน่วยนี้ในหน้าจัดการหน่วย
- **AC-2** — `warehouse_staff` แก้ label หรือปิดหน่วยที่มีอยู่ → ถูกปฏิเสธทั้งชั้น app และ CouchDB
- **AC-3** — บทบาทอื่น (เช่น `registration_staff`) สร้างหน่วย → ถูกปฏิเสธ
- **AC-4** — ตรวจรับใบที่มีของพิมพ์เอง "สายชาร์จ" ซึ่งไม่มีในคลัง → กดสร้างรายการใหม่ → บันทึก → บรรทัดเลือก "สายชาร์จ" ให้ → รับเข้าคลังได้ · ledger มีแถวของรายการใหม่
- **AC-5** — รายการที่สร้างมี `shelter_code` ของศูนย์ และศูนย์อื่นไม่เห็นรายการนี้
- **AC-6** — สร้างหน่วยด้วย `code` ซ้ำ → ข้อความแจ้งว่ามีอยู่แล้ว

## Impact

- **frontend:** `queries.ts` (สิทธิ์) · แยก sheet สร้างหน่วยออกจาก `unit-of-measure-tab.svelte` เป็น component ใน `features/catalog/ui` (หน้า catalog ใช้ตัวเดียวกัน) · ปุ่มและ sheet สร้างรายการในหน้าตรวจรับ · test สิทธิ์ + component
- **CouchDB:** `frontend/scripts/sync-central-db.ts` อนุญาต `unit_of_measure` แบบ create-only สำหรับสองบทบาท · **ต้อง deploy design doc ของ `catalog` ใหม่**
- **docs:** CR-125 §2 (แถว Authorization) · `schema.md` §4.9 และ §8 ข้อ 12 · role-permission-matrix
- **ไม่กระทบ:** รูปของ doc, `schema_v`, ledger, worker, backend

## Migration

N/A — ไม่เปลี่ยนรูป doc ไม่ bump `schema_v` · หลัง merge ต้องรัน sync design doc ของ DB `catalog` บนทุก environment

## Why

- ของบริจาคที่พิมพ์เองและยังไม่มีในคลังรับเข้าไม่ได้เลย ต้องรอผู้ดูแลระบบสร้างรายการหรือหน่วยให้ก่อน ขณะที่ผู้บริจาคยืนรออยู่ที่เคาน์เตอร์
- ข้อกังวลเดิมของ CR-125 คือหน่วยกลางแตกแถว จึงเปิดเฉพาะ "สร้างใหม่" ไม่เปิด "แก้/ปิด" และยังบังคับ regex/immutable `code` เหมือนเดิม
- รายการที่สร้างจากหน้าตรวจรับเป็นของศูนย์นั้นเท่านั้น จึงไม่กระทบ catalog กลางของศูนย์อื่น
- ไม่ทำระบบตัวคูณใหม่: เจ้าของโครงการเห็นว่าผู้บริจาคระบุหน่วยเองชัดอยู่แล้ว (เช่น บริจาคเป็นแพ็คก็ระบุแพ็ค) รายละเอียดอื่นเขียนในหมายเหตุ · สินค้าที่ตั้งหน่วยแพ็คไว้แล้วให้เลือกแพ็คตอนรับได้ โดยระบบแปลงเป็นหน่วยฐานให้เอง (เป็นการใช้ `conversions` ที่มีอยู่ ไม่ใช่ spec ใหม่ — แก้ใน issue #623)

## Decision log

- 2026-10-17 — เจ้าของโครงการ: ให้ `warehouse_staff`/`shelter_manager` สร้างหน่วยได้ · สร้างรายการในคลังได้จากหน้าตรวจรับผ่าน sheet ขวา · รายการใหม่เป็นของศูนย์นี้เท่านั้น · ไม่ทำระบบตัวคูณ
- 2026-10-17 — proposed (track ด้วย CR file แยก branch ตามที่เจ้าของโครงการกำหนด)
