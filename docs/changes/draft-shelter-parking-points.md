---
id: draft
title: shelter — เพิ่มจุดจอดรถ (`parking_points`) ปักหมุดได้ แบบเดียวกับจุดแจกอาหาร
status: proposed
date: 2026-11-12
requested_by: ทีม — GitHub #1352
decided_by:
layer: volatile
affects:
  - docs/data/schema.md §3.1 `shelter.parking_points` (field ใหม่) · shelter schema_v 9 → 10
  - docs/data/schema-er-diagram.md (SHELTER block)
  - frontend/src/lib/features/shelters/domain/schema.ts (`parkingPointSchema`, `SHELTER_MASTER_SCHEMA_V`, `migrateV9ToV10`, `normalizeCurrent`, chain ของ `migrateShelterV2ToCurrent`) · index.ts
  - frontend/src/lib/features/shelters/data (shelters.repository.ts, shelters.remote.ts)
  - frontend/src/routes/api/back-office/shelter/+server.ts · [code]/+server.ts (GET mapping)
  - frontend/src/lib/features/shelters/ui (parking-points-section.svelte ใหม่, shelter-form-page.svelte, shelter-form-validation.ts)
  - frontend/src/lib/features/shelter-import/domain/import-row.ts (import ต้องไม่ลบ `parking_points` เดิม)
  - frontend/e2e/shelters.test.ts
  - ไม่กระทบ worker / PROJECTION_VERSION / FastAPI / OpenAPI / public plane
why: >
  เจ้าหน้าที่ต้องบันทึกที่จอดรถจริงของแต่ละศูนย์พร้อมตำแหน่งบนแผนที่ ตอนนี้มีแค่นโยบายยานพาหนะ
  (รับรถประเภทไหน กี่คัน) แต่ไม่มีที่บอกว่าจอดตรงไหน
migration: >
  additive — doc เดิมที่ไม่มี key อ่านเป็น `parking_points = []` (lazy default-fill) · ไม่มี batch script ·
  เขียนครั้งถัดไป stamp schema_v 10
---

# draft-shelter-parking-points — จุดจอดรถของศูนย์

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** doc `shelter` มี field ใหม่ `parking_points` = รายการจุดจอดรถ `{ id, name, note, lat, lng }` รูปเดียวกับ `food_distribution_points` (CR-128) · default `[]`
> - **เพื่อใคร:** เจ้าหน้าที่ศูนย์บันทึกว่าที่จอดรถอยู่ตรงไหน ตั้งชื่อและปักหมุดบนแผนที่ได้ (#1352)
> - **build:** หน้าตั้งค่าศูนย์เพิ่มส่วนที่ 10 "จุดจอดรถ" ต่อจากนโยบายยานพาหนะ · import ศูนย์ต้องไม่ลบจุดจอดรถเดิม
> - **กระทบ:** shelter schema_v 9 → 10 (additive, lazy) · staff plane เท่านั้น ไม่แก้ worker / FastAPI / public

---

## Requirements

**ข้อมูล (CouchDB `shelter`)**

- FR-1 — `shelter.parking_points`: `[{ id, name, note, lat, lng }]` ตามตาราง §Change · default `[]`
- FR-2 — `id` เป็น string ไม่ว่าง (ULID ตอนเพิ่มใหม่) · ไม่เปลี่ยนเมื่อแก้ชื่อ หมายเหตุ หรือย้ายหมุด
- FR-3 — `name` ตัดช่องว่างหัวท้ายแล้วต้องไม่ว่าง · ว่าง → บันทึกไม่ผ่าน ข้อความ "กรุณาระบุชื่อที่จอดรถ"
- FR-4 — `note`, `lat`, `lng` ไม่บังคับ (`null` ได้) · `lat` อยู่ในช่วง −90..90, `lng` อยู่ในช่วง −180..180 (ช่วงเดียวกับ `food_distribution_points`)
- FR-5 — `parkingPointSchema` = `foodDistributionPointSchema` ที่เปลี่ยนเฉพาะข้อความ error ของ `name` · ไม่สร้าง schema ชุดใหม่
- FR-6 — `SHELTER_MASTER_SCHEMA_V` = 10 · doc ที่ไม่มี `parking_points` อ่านได้ `[]` (§Migration)

**หน้าตั้งค่าศูนย์ — ส่วนที่ 10 "จุดจอดรถ"**

- FR-7 — เพิ่มส่วน "จุดจอดรถ" (`id: 'parking-points'`, ไอคอน `Car`) เป็นส่วนที่ 10 ต่อจาก "นโยบายยานพาหนะ" (ส่วนที่ 9) · มีในเมนูนำทางด้านข้าง/ด้านล่างด้วย · ไม่เลื่อนเลขส่วนเดิม
- FR-8 — ทำงานเหมือนส่วน "จุดแจกอาหาร": ปุ่ม "เพิ่มจุดจอดรถ" · ช่อง "ชื่อจุดจอดรถ" (ตัวอย่าง "เช่น ลานจอดหน้าอาคารเรียน") · ช่อง "หมายเหตุ" (ตัวอย่าง "เช่น จอดได้เฉพาะรถยนต์") · ปุ่ม "ปักหมุด" · ปุ่มลบ
- FR-9 — ปุ่ม "ปักหมุด" เปิดหน้าต่าง "ปักหมุดจุดจอดรถ" (แผนที่เดียวกับจุดแจกอาหาร มีช่องกรอกละติจูด/ลองจิจูด) · พิกัดเปลี่ยนเฉพาะเมื่อกด "ยืนยันปักหมุด" · กด "ยกเลิก" แล้วพิกัดเดิมไม่เปลี่ยน
- FR-10 — ไม่มีรายการ → แสดง "ยังไม่มีจุดจอดรถ กรุณาเพิ่มรายการใหม่"
- FR-11 — ชื่อว่างตอนบันทึก → แสดง error ที่ช่องชื่อของจุดนั้น และเมนูนำทางทำเครื่องหมายส่วน "จุดจอดรถ" ว่ามีส่วนที่ต้องแก้ไข
- FR-12 — สิทธิ์แก้ไขเท่าฟอร์มศูนย์เดิม ไม่เพิ่ม role/permission

**import ข้อมูลศูนย์** (`shelter-import`)

- FR-13 — import ไม่มีข้อมูลจุดจอดรถ (workbook ไม่มีคอลัมน์/sheet นี้) → คง `parking_points` เดิมของศูนย์ไว้ทั้งหมด (กติกา "แทนที่เฉพาะเมื่อมีข้อมูลมา" แบบเดียวกับ `food_distribution_points`)
- FR-14 — ไม่เพิ่ม sheet หรือคอลัมน์จุดจอดรถใน template รอบนี้

**public plane**

- FR-15 — ไม่แก้ worker, ไม่ bump `PROJECTION_VERSION`, ไม่แก้ FastAPI / OpenAPI · ไม่มี projection field ใหม่
- FR-16 — `parking_points` ไม่ใช่ข้อมูลลับ: worker เขียน doc ทั้งก้อนลง `public_shelters.raw_data` (`worker/src/worker/projectors/shelter.py`) จึงมีจุดจอดรถและพิกัดอยู่ใน Mongo ด้วย เหมือน `food_distribution_points` · FastAPI ห้ามอ่าน `parking_points` จาก `raw_data` ไปแสดง จนกว่าจะมี CR เรื่องแสดงผล public

## Change (before → after)

**CouchDB `shelter`** (field ใหม่ ระดับเดียวกับ `food_distribution_points`)

| field | ชนิด | ค่าเมื่อ doc ไม่มี key | กติกา |
| --- | --- | --- | --- |
| `parking_points` | `[{ id, name, note, lat, lng }]` | `[]` | — |
| `parking_points[].id` | str | — | ไม่ว่าง · ULID |
| `parking_points[].name` | str | — | trim · ไม่ว่าง |
| `parking_points[].note` | str \| null | `null` | — |
| `parking_points[].lat` | num \| null | `null` | −90..90 |
| `parking_points[].lng` | num \| null | `null` | −180..180 |

- ก่อน: ไม่มี field
- หลัง: `parking_points: [{ id: '01J…', name: 'ลานจอดหน้าอาคารเรียน', note: 'จอดได้เฉพาะรถยนต์', lat: 7.0086, lng: 100.4747 }]`
- shelter schema_v 9 → 10

## Acceptance

- [ ] เปิดศูนย์เดิม (schema_v 9 ไม่มี `parking_points`) → ฟอร์มเปิดได้ ไม่มี error · ส่วน "จุดจอดรถ" แสดง "ยังไม่มีจุดจอดรถ…"
- [ ] เพิ่มจุดจอดรถ ตั้งชื่อ ปักหมุด ยืนยัน แล้วบันทึก → โหลดหน้าใหม่ยังเห็นจุดพร้อมพิกัด · doc เป็น schema_v 10 และมี `parking_points` 1 รายการ
- [ ] ปักหมุดแล้วกด "ยกเลิก" → พิกัดเดิมไม่เปลี่ยน
- [ ] ชื่อว่าง → บันทึกไม่ผ่าน · error ที่แถวนั้น · เมนูนำทางทำเครื่องหมายส่วน "จุดจอดรถ"
- [ ] `lat` 91 หรือ `lng` 181 → schema ปฏิเสธ
- [ ] ลบจุดแล้วบันทึก → จุดหายจาก doc · จุดอื่นคง `id` เดิม
- [ ] import ศูนย์ที่มีจุดจอดรถอยู่แล้วด้วย workbook ที่ไม่มีข้อมูลจุดจอดรถ → `parking_points` เดิมอยู่ครบ
- [ ] doc v6, v7, v8, v9 ผ่าน `migrateShelterV2ToCurrent` → schema_v 10 และ `parking_points = []` · doc v10 ที่ครบแล้วได้ object เดิม (`===`)
- [ ] ส่วนที่ 1–9 ของฟอร์มเลขและลำดับเท่าเดิม
- [ ] Tests: domain (schema bounds, migration v9 → v10, chain, identity ของ `normalizeCurrent`) · import-row (FR-13) · e2e shelters (เพิ่ม/ปักหมุด/ลบ/ชื่อว่าง)

## Open questions

- **Q1 — ความจุและประเภทรถรายจุด:** ตัดออกจาก CR นี้ เพราะซ้ำกับ `common_areas.parking_capacity` และ `parking_policy.supported_vehicles` ที่มีอยู่แล้ว ถ้าเพิ่มรายจุดต้องตัดสินก่อนว่าค่าไหนเป็นตัวจริง (ผลรวมรายจุด หรือค่ารวมของศูนย์) · ถามผู้ใช้ว่าต้องการไหม ถ้าต้องการเปิด CR ใหม่
- **Q2 — จำนวนสูงสุดต่อศูนย์:** ไม่จำกัด (จุดแจกอาหารก็ไม่จำกัด) · ต้องมีเพดานไหม
- **Q3 — แสดงในหน้า public:** ไม่แสดงในรอบนี้ (FR-15, FR-16) · ถ้าต้องการให้ประชาชนเห็นที่จอดรถ ต้องมี CR แยก (projection field + FastAPI + หน้า public)
- **Q4 — import:** ต้องการ sheet จุดจอดรถใน template ไหม (FR-14) · ถ้าต้องการเปิดเป็นงานต่อ

## Why

- #1352 ขอให้เพิ่มหมุดที่จอดรถของแต่ละศูนย์ "ทำคล้ายจุดแจกอาหาร" · `parking_policy` บอกได้แค่ว่ารับรถอะไร กี่คัน ไม่มีตำแหน่ง
- แยกเป็น field ของตัวเอง ไม่ใส่ใน `parking_policy` หรือ `common_areas` เพราะสองก้อนนั้นเก็บนโยบายและความจุ ส่วนจุดจอดรถเป็นรายการสถานที่ เหมือนที่ `food_distribution_points` แยกจาก `common_areas`
- ใช้รูปเดียวกับจุดแจกอาหารทุก field เพื่อใช้ schema, หน้าต่างแผนที่ และรูปแบบ test เดิมได้
- เพิ่มเป็นส่วนที่ 10 ต่อท้าย แทนการแทรกถัดจากส่วนที่ 3/4 เพราะเลข "ส่วนที่ N" ของแต่ละส่วนเขียนตายตัวในแต่ละ component · ต่อท้ายจึงไม่ต้องเลื่อนเลขส่วนอื่น และยังอยู่ติดกับนโยบายยานพาหนะ
- import: ทำแค่ "ไม่ลบข้อมูลเดิม" เพราะ sheet ใหม่ต้องแก้คอลัมน์ parser template job store UI และ test จำนวนมาก โดยยังไม่มีใครขอ
- งานต่อที่บันทึกไว้: นี่เป็นรายการปักหมุดชุดที่ 3 (จุดแจกอาหาร, จุดเก็บของ, จุดจอดรถ) · ควรแยก section ปักหมุดที่ใช้ร่วมกันใน PR refactor ต่างหาก ไม่ทำใน PR feature นี้

## Migration

- **shelter schema_v 9 → 10 (additive):** `migrateV9ToV10` เติม `parking_points = []` เมื่อไม่มี key · `normalizeCurrent` เติมค่าเดียวกัน (doc ที่ stamp 10 แต่ขาด key ก็อ่านถูก) และคืน object เดิมเมื่อไม่มีอะไรขาด (`updateMaster` ใช้ `===` ตัดสินว่าไม่ต้องเขียน) · ไม่มี batch script · เขียนครั้งถัดไป persist `[]` และ stamp 10
- **แต่ละขั้นของ chain stamp เลขของตัวเอง** (ตามกติกา CR-205): ตอนนี้ `migrateV8ToV9` stamp `SHELTER_MASTER_SCHEMA_V` → เปลี่ยนให้ stamp `9` ตรงๆ แล้วต่อ `migrateV9ToV10` ท้าย chain ทุก branch ของ `migrateShelterV2ToCurrent` (v2–v8) และเพิ่มกรณี `schema_v === 9`
- `scripts/migrate-shelter.ts` และ `provisioner.ts` อ้างค่าคงที่อยู่แล้ว ไม่ต้องแก้
- **ลำดับ rollout:** deploy code ใหม่ก่อน · doc ถูกเขียนเป็น v10 เฉพาะเมื่อเจ้าหน้าที่แก้ศูนย์ · ก่อน merge ตรวจว่า app และ worker รุ่นเก่ายังอ่าน doc `schema_v: 10` ได้ (worker ไม่ตรวจ `schema_v` ของ shelter; app รุ่นเก่าเข้า branch `>= current` แล้ว normalize)
- **rollback:** deploy code รุ่นก่อน · array `parking_points` ที่เขียนไปแล้วถูกละไว้ ไม่ทำให้อ่าน doc ไม่ได้ · ก่อน merge ตรวจว่าทางเขียนของรุ่นก่อน (PATCH back-office, import, จุดเก็บของ) เขียนทับเฉพาะ field ที่แก้ ไม่ตัด key ที่ไม่รู้จักทิ้ง
- **Mongo / worker:** ไม่มีการเปลี่ยน · ไม่ bump `PROJECTION_VERSION` · `raw_data` ได้ `parking_points` เองเมื่อ doc ถูกเขียนใหม่

## Decision log

- 2026-11-12 — proposed (draft) จาก GitHub #1352 · รูปข้อมูล = รูปของจุดแจกอาหาร · import ทำแค่กันข้อมูลหาย
