---
id: draft
title: shelter — เพิ่มจุดจอดรถ (`parking_points`) ปักหมุดได้ พร้อมประเภทรถและความจุรายจุด
status: proposed
date: 2026-11-12
requested_by: ทีม — GitHub #1352
decided_by:
layer: volatile
affects:
  - docs/data/schema.md §3.1 `shelter.parking_points` (field ใหม่) · `parking_policy.supported_vehicles` (legacy) · shelter schema_v 9 → 10
  - docs/data/schema-er-diagram.md (SHELTER block)
  - frontend/src/lib/features/shelters/domain/schema.ts (`parkingPointSchema`, `SHELTER_MASTER_SCHEMA_V`, `migrateV9ToV10`, `normalizeCurrent`, chain ของ `migrateShelterV2ToCurrent`, ฟังก์ชันคำนวณประเภทรถ/ความจุรวมจากจุดจอดรถ) · index.ts
  - frontend/src/lib/features/shelters/data (shelters.repository.ts, shelters.remote.ts)
  - frontend/src/routes/api/back-office/shelter/+server.ts · [code]/+server.ts (GET mapping)
  - frontend/src/routes/api/public/v1/transparency/shelters/+server.ts (ตัวกรอง `parking_car` / `parking_motorcycle` / `parking_boat` อ่านจากจุดจอดรถ)
  - frontend/src/lib/features/shelters/ui (parking-points-section.svelte ใหม่, parking-policy-section.svelte ส่วนประเภทรถเป็นอ่านอย่างเดียว, shelter-form-page.svelte, shelter-form-validation.ts)
  - frontend/src/lib/features/shelter-import/domain/import-row.ts (import ต้องไม่ลบ `parking_points` เดิม)
  - frontend/e2e/shelters.test.ts
  - ไม่กระทบ worker / PROJECTION_VERSION / FastAPI / OpenAPI
why: >
  เจ้าหน้าที่ต้องบันทึกที่จอดรถจริงของแต่ละศูนย์พร้อมตำแหน่งบนแผนที่ และต้องรู้ว่าแต่ละจุดจอดรถอะไรได้กี่คัน
  ตอนนี้มีแค่นโยบายยานพาหนะระดับศูนย์ (รับรถประเภทไหน กี่คัน) ไม่มีที่บอกว่าจอดตรงไหน
migration: >
  additive — doc เดิมที่ไม่มี key อ่านเป็น `parking_points = []` (lazy default-fill) · ไม่มี batch script ·
  เขียนครั้งถัดไป stamp schema_v 10 · `parking_policy.supported_vehicles` คงไว้เป็นค่า legacy ใช้ต่อจนกว่าศูนย์จะมีจุดจอดรถที่ระบุรถ
---

# draft-shelter-parking-points — จุดจอดรถของศูนย์

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** doc `shelter` มี field ใหม่ `parking_points` = รายการจุดจอดรถ `{ id, name, note, lat, lng, vehicles[] }` · `vehicles` = ประเภทรถและความจุของจุดนั้น · default `[]`
> - **ค่าจริงของศูนย์:** ประเภทรถที่รองรับและความจุรวมของศูนย์ **คำนวณจากจุดจอดรถ** (ผลรวมรายจุด) ไม่กรอกซ้ำที่ระดับศูนย์ · ศูนย์เดิมที่ยังไม่มีจุดจอดรถที่ระบุรถ ใช้ `parking_policy.supported_vehicles` เดิมต่อ (อ่านอย่างเดียวในฟอร์ม)
> - **เพื่อใคร:** เจ้าหน้าที่ศูนย์บันทึกว่าที่จอดรถอยู่ตรงไหน จอดอะไรได้กี่คัน (#1352) · ตัวกรองหน้า public ใช้ค่าที่คำนวณนี้
> - **build:** หน้าตั้งค่าศูนย์เพิ่มส่วนที่ 10 "จุดจอดรถ" ต่อจากนโยบายยานพาหนะ (ส่วนที่ 9) · import ศูนย์ต้องไม่ลบจุดจอดรถเดิม
> - **กระทบ:** shelter schema_v 9 → 10 (additive, lazy) · ตัวกรอง public เปลี่ยนแหล่งอ่านข้อมูล · ไม่แก้ worker / FastAPI · การแสดงจุดจอดรถบนหน้า public ต้องมี CR แยก

---

## Requirements

**ข้อมูล (CouchDB `shelter`)**

- FR-1 — `shelter.parking_points`: `[{ id, name, note, lat, lng, vehicles }]` ตามตาราง §Change · default `[]`
- FR-2 — `id` เป็น string ไม่ว่าง (ULID ตอนเพิ่มใหม่) · ไม่เปลี่ยนเมื่อแก้ชื่อ หมายเหตุ ย้ายหมุด หรือแก้รถ
- FR-3 — `name` ตัดช่องว่างหัวท้ายแล้วต้องไม่ว่าง · ว่าง → บันทึกไม่ผ่าน ข้อความ "กรุณาระบุชื่อที่จอดรถ"
- FR-4 — `note`, `lat`, `lng` ไม่บังคับ (`null` ได้ — จุดที่ยังไม่ปักหมุดบันทึกได้) · `lat` อยู่ในช่วง −90..90, `lng` อยู่ในช่วง −180..180 (ช่วงเดียวกับ `food_distribution_points`)
- FR-5 — `vehicles`: `[{ type, max_capacity }]` · `type` ∈ `motorcycle`, `car`, `truck`, `boat` · `max_capacity` เป็นจำนวนเต็ม ≥ 0 หรือ `null` · รูปเดียวกับ `parking_policy.supported_vehicles` (ใช้ schema ย่อยเดิม) · default `[]`
- FR-6 — ภายในจุดเดียวกัน `type` ซ้ำกันไม่ได้ · ซ้ำ → บันทึกไม่ผ่าน
- FR-7 — `parkingPointSchema` = `foodDistributionPointSchema` ที่เปลี่ยนข้อความ error ของ `name` และเพิ่ม `vehicles` · ไม่สร้างชุด schema ซ้ำสำหรับ lat/lng
- FR-8 — `SHELTER_MASTER_SCHEMA_V` = 10 · doc ที่ไม่มี `parking_points` อ่านได้ `[]` · จุดที่ไม่มี `vehicles` อ่านได้ `[]` (§Migration)

**ค่าที่ใช้จริงของศูนย์ (effective vehicles)** — คำนวณตอนอ่าน ไม่เก็บเป็น field

- FR-9 — **ใช้ค่าจากจุดจอดรถ** เมื่อมีอย่างน้อยหนึ่งจุดที่ `vehicles` ไม่ว่าง · ประเภทรถที่รองรับ = ประเภทที่ปรากฏในจุดใดจุดหนึ่ง · ความจุของแต่ละประเภท = ผลรวม `max_capacity` ของจุดที่มีประเภทนั้น (ข้ามค่า `null`) · ถ้าทุกจุดของประเภทนั้นเป็น `null` ความจุรวมเป็น `null`
- FR-10 — **ใช้ค่าเดิม** `parking_policy.supported_vehicles` เมื่อไม่มีจุดจอดรถที่ `vehicles` ไม่ว่างเลย (ศูนย์เดิม หรือเพิ่มจุดแล้วแต่ยังไม่ระบุรถ) · ตัวกรอง `parking_capacity > 0` เดิมของฝั่ง legacy คงเดิม
- FR-11 — `parking_policy.availability = 'none'` → ศูนย์ไม่มีที่จอดรถ ไม่ว่ามีจุดจอดรถหรือไม่ · ไม่ลบจุดจอดรถที่บันทึกไว้ (ดู Q5)
- FR-12 — `common_areas.parking_capacity` ไม่แก้ในรอบนี้ (ดู Q6)

**หน้าตั้งค่าศูนย์ — ส่วนที่ 9 นโยบายยานพาหนะ**

- FR-13 — บล็อก "2. ประเภทรถที่รองรับและจำนวน" เปลี่ยนเป็น **อ่านอย่างเดียว** · แสดงค่าที่ใช้จริงตาม FR-9/FR-10 · มีข้อความกำกับว่าค่านี้แก้ได้ที่ส่วนที่ 10 "จุดจอดรถ" · ไม่มี checkbox/ช่องตัวเลขให้แก้
- FR-14 — `availability`, `rules`, `rules_other` ยังแก้ได้เหมือนเดิม · `feature-flag-policy-sync` เดิมคงไว้ (ตั้ง `none` แล้วล้าง `supported_vehicles` เดิม)

**หน้าตั้งค่าศูนย์ — ส่วนที่ 10 "จุดจอดรถ"**

- FR-15 — เพิ่มส่วน "จุดจอดรถ" (`id: 'parking-points'`, ไอคอน `Car`) เป็นส่วนที่ 10 ต่อจาก "นโยบายยานพาหนะ" (ส่วนที่ 9) · มีในเมนูนำทางด้านข้าง/ด้านล่างด้วย · ไม่เลื่อนเลขส่วนเดิม
- FR-16 — ทำงานเหมือนส่วน "จุดแจกอาหาร": ปุ่ม "เพิ่มจุดจอดรถ" · ช่อง "ชื่อจุดจอดรถ" (ตัวอย่าง "เช่น ลานจอดหน้าอาคารเรียน") · ช่อง "หมายเหตุ" · ปุ่ม "ปักหมุด" · ปุ่มลบ · **เพิ่ม:** รายการประเภทรถของจุด (เลือกประเภท + ใส่ "รองรับสูงสุด" หน่วยคัน, เรือหน่วยลำ) ใช้ pattern เดียวกับส่วนที่ 9 เดิม
- FR-17 — ปุ่ม "ปักหมุด" เปิดหน้าต่าง "ปักหมุดจุดจอดรถ" (แผนที่เดียวกับจุดแจกอาหาร มีช่องกรอกละติจูด/ลองจิจูด) · พิกัดเปลี่ยนเฉพาะเมื่อกด "ยืนยันปักหมุด" · กด "ยกเลิก" แล้วพิกัดเดิมไม่เปลี่ยน
- FR-18 — ไม่มีรายการ → แสดง "ยังไม่มีจุดจอดรถ กรุณาเพิ่มรายการใหม่"
- FR-19 — ชื่อว่าง หรือประเภทรถซ้ำในจุดเดียวกันตอนบันทึก → แสดง error ที่จุดนั้น และเมนูนำทางทำเครื่องหมายส่วน "จุดจอดรถ" ว่ามีส่วนที่ต้องแก้ไข
- FR-20 — สิทธิ์แก้ไขเท่าฟอร์มศูนย์เดิม ไม่เพิ่ม role/permission

**ตัวกรองหน้า public** (`transparency/shelters`)

- FR-21 — `parking_car`, `parking_motorcycle`, `parking_boat` อ่านจากค่าที่ใช้จริงตาม FR-9/FR-10 (ใช้ฟังก์ชันคำนวณเดียวกับฟอร์ม ไม่เขียน logic ซ้ำ)
- FR-22 — ศูนย์ที่ยังไม่มีจุดจอดรถที่ระบุรถ ได้ผลตัวกรองเท่าเดิมทุกประการ

**import ข้อมูลศูนย์** (`shelter-import`)

- FR-23 — import ไม่มีข้อมูลจุดจอดรถ (workbook ไม่มีคอลัมน์/sheet นี้) → คง `parking_points` เดิมของศูนย์ไว้ทั้งหมด (กติกา "แทนที่เฉพาะเมื่อมีข้อมูลมา" แบบเดียวกับ `food_distribution_points`)
- FR-24 — ไม่เพิ่ม sheet หรือคอลัมน์จุดจอดรถใน template รอบนี้ · คอลัมน์ประเภทรถ/ความจุเดิมยังเขียนลง `parking_policy.supported_vehicles` และ `common_areas.parking_capacity` เหมือนเดิม (มีผลต่อศูนย์ที่ยังไม่มีจุดจอดรถที่ระบุรถเท่านั้น ตาม FR-10)

**public plane**

- FR-25 — ไม่แก้ worker, ไม่ bump `PROJECTION_VERSION`, ไม่แก้ FastAPI / OpenAPI · ไม่มี projection field ใหม่
- FR-26 — `parking_points` ไม่ใช่ข้อมูลลับ: worker เขียน doc ทั้งก้อนลง `public_shelters.raw_data` (`worker/src/worker/projectors/shelter.py`) จึงมีจุดจอดรถ พิกัด และความจุอยู่ใน Mongo ด้วย เหมือน `food_distribution_points` · FastAPI ห้ามอ่าน `parking_points` จาก `raw_data` ไปแสดง จนกว่าจะมี CR เรื่องแสดงผล public (Q3 — owner ต้องการแสดง ต้องเปิด CR แยก)

## Change (before → after)

**CouchDB `shelter`** (field ใหม่ ระดับเดียวกับ `food_distribution_points`)

| field                              | ชนิด                                       | ค่าเมื่อ doc ไม่มี key | กติกา                        |
| ---------------------------------- | ------------------------------------------ | ---------------------- | ---------------------------- |
| `parking_points`                   | `[{ id, name, note, lat, lng, vehicles }]` | `[]`                   | —                            |
| `parking_points[].id`              | str                                        | —                      | ไม่ว่าง · ULID               |
| `parking_points[].name`            | str                                        | —                      | trim · ไม่ว่าง               |
| `parking_points[].note`            | str \| null                                | `null`                 | —                            |
| `parking_points[].lat`             | num \| null                                | `null`                 | −90..90                      |
| `parking_points[].lng`             | num \| null                                | `null`                 | −180..180                    |
| `parking_points[].vehicles`        | `[{ type, max_capacity }]`                 | `[]`                   | `type` ไม่ซ้ำในจุดเดียวกัน   |
| `parking_points[].vehicles[].type` | enum(`motorcycle`, `car`, `truck`, `boat`) | —                      | ชุดเดียวกับ `parking_policy` |
| `…vehicles[].max_capacity`         | int ≥ 0 \| null                            | `null`                 | หน่วยคัน (เรือ = ลำ)         |

**`parking_policy.supported_vehicles`**: ไม่เปลี่ยน shape · เปลี่ยนสถานะเป็น legacy — ฟอร์มไม่เขียนแล้ว (import ยังเขียนได้) · ใช้เมื่อไม่มีจุดจอดรถที่ระบุรถ (FR-10)

- ก่อน: ไม่มี `parking_points` · ประเภทรถและความจุกรอกที่ระดับศูนย์ใน `parking_policy.supported_vehicles`
- หลัง: `parking_points: [{ id: '01J…', name: 'ลานจอดหน้าอาคารเรียน', note: null, lat: 7.0086, lng: 100.4747, vehicles: [{ type: 'car', max_capacity: 30 }, { type: 'motorcycle', max_capacity: 100 }] }, { id: '01J…', name: 'ท่าน้ำ', note: null, lat: null, lng: null, vehicles: [{ type: 'boat', max_capacity: 10 }] }]` → ค่าที่ใช้จริงของศูนย์: รถยนต์ 30, มอเตอร์ไซค์ 100, เรือ 10
- shelter schema_v 9 → 10

## Acceptance

- [ ] เปิดศูนย์เดิม (schema_v 9 ไม่มี `parking_points`) → ฟอร์มเปิดได้ ไม่มี error · ส่วน "จุดจอดรถ" แสดง "ยังไม่มีจุดจอดรถ…" · ส่วนที่ 9 แสดงประเภทรถเดิมแบบอ่านอย่างเดียว
- [ ] ศูนย์เดิมที่มีรถยนต์ 200 คันใน `supported_vehicles` และยังไม่มีจุดจอดรถ → ตัวกรอง `parking_car` ผลเท่าเดิม
- [ ] เพิ่มจุดจอดรถ ตั้งชื่อ ปักหมุด ใส่รถยนต์ 30 ยืนยัน แล้วบันทึก → โหลดหน้าใหม่ยังเห็นจุดพร้อมพิกัดและรถ · doc เป็น schema_v 10
- [ ] ศูนย์มี 2 จุด (รถยนต์ 30 + มอเตอร์ไซค์ 100 / เรือ 10) → ส่วนที่ 9 แสดงรถยนต์ 30, มอเตอร์ไซค์ 100, เรือ 10 · ตัวกรองทั้งสามประเภทผ่าน · ค่า `supported_vehicles` เดิมไม่ถูกใช้
- [ ] เพิ่มจุดแต่ยังไม่ระบุรถ (ศูนย์เดิมมีรถยนต์ใน `supported_vehicles`) → ค่าที่ใช้จริงยังเป็นค่าเดิม
- [ ] `availability = none` → ตัวกรองทุกประเภทรถไม่ผ่าน แม้มีจุดจอดรถ · จุดจอดรถที่บันทึกไว้ไม่ถูกลบ
- [ ] จุดที่ไม่ปักหมุด (`lat`/`lng` เป็น `null`) → บันทึกได้
- [ ] ประเภทรถซ้ำในจุดเดียวกัน → บันทึกไม่ผ่าน · error ที่จุดนั้น
- [ ] ปักหมุดแล้วกด "ยกเลิก" → พิกัดเดิมไม่เปลี่ยน
- [ ] ชื่อว่าง → บันทึกไม่ผ่าน · error ที่แถวนั้น · เมนูนำทางทำเครื่องหมายส่วน "จุดจอดรถ"
- [ ] `lat` 91 หรือ `lng` 181 → schema ปฏิเสธ · `max_capacity` −1 → ปฏิเสธ
- [ ] ลบจุดแล้วบันทึก → จุดหายจาก doc · จุดอื่นคง `id` เดิม · ค่าที่ใช้จริงคำนวณใหม่
- [ ] import ศูนย์ที่มีจุดจอดรถอยู่แล้วด้วย workbook ที่ไม่มีข้อมูลจุดจอดรถ → `parking_points` เดิมอยู่ครบ
- [ ] doc v6, v7, v8, v9 ผ่าน `migrateShelterV2ToCurrent` → schema_v 10 และ `parking_points = []` · doc v10 ที่ครบแล้วได้ object เดิม (`===`)
- [ ] ส่วนที่ 1–9 ของฟอร์มเลขและลำดับเท่าเดิม
- [ ] Tests: domain (schema bounds, `type` ซ้ำ, ฟังก์ชันคำนวณ effective vehicles ทุกกรณี FR-9–FR-11, migration v9 → v10, chain, identity ของ `normalizeCurrent`) · transparency/shelters (ตัวกรองอ่านจากจุดจอดรถ + legacy) · import-row (FR-23) · e2e shelters (เพิ่ม/ปักหมุด/ลบ/ชื่อว่าง/ใส่รถ)

## Open questions

- **Q1 — ค่าจริงของความจุ:** ✅ ตัดสินแล้ว (2026-11-12) — ความจุและประเภทรถเก็บรายจุด · ค่าระดับศูนย์คำนวณจากผลรวมรายจุด · ศูนย์เดิมที่ยังไม่มีจุดจอดรถใช้ `supported_vehicles` เดิมต่อ (ตัวเลือก ก) · ส่วนที่ 9 แสดงค่าเดิมอ่านอย่างเดียว
- **Q2 — จำนวนจุดสูงสุดต่อศูนย์:** ไม่จำกัด (จุดแจกอาหารก็ไม่จำกัด) · ต้องมีเพดานไหม — ยังรอ owner
- **Q3 — แสดงในหน้า public:** ✅ owner ต้องการแสดง · ทำใน CR แยก (projection field + FastAPI + หน้า public) ไม่อยู่ใน CR นี้ (FR-25, FR-26)
- **Q4 — import:** ✅ ตัดสินแล้ว (2026-11-12) — ไม่เพิ่ม sheet จุดจอดรถใน template รอบนี้ (FR-24)
- **Q5 — `availability = none` กับจุดจอดรถที่บันทึกไว้:** ร่างนี้ไม่ลบจุด แค่ถือว่าศูนย์ไม่มีที่จอดรถ (FR-11) เพราะลบแล้วกู้พิกัดไม่ได้ · ยืนยันไหม
- **Q6 — `common_areas.parking_capacity`:** ซ้ำกับความจุรวมที่คำนวณได้แล้ว และไม่มีช่องกรอกในฟอร์ม แต่ import ยังเขียน และตัวกรอง legacy ยังอ่าน (`> 0` ทำให้ผ่านทั้งรถยนต์และมอเตอร์ไซค์) · ร่างนี้ไม่แตะ (FR-12) · ต้องการเลิกใช้ใน CR ถัดไปไหม

## Why

- #1352 ขอให้เพิ่มหมุดที่จอดรถของแต่ละศูนย์ "ทำคล้ายจุดแจกอาหาร" · `parking_policy` บอกได้แค่ว่ารับรถอะไร กี่คัน ไม่มีตำแหน่ง
- แยกจุดจอดรถเป็น field ของตัวเอง ไม่ใส่ใน `parking_policy` หรือ `common_areas` เพราะจุดจอดรถเป็นรายการสถานที่ เหมือนที่ `food_distribution_points` แยกจาก `common_areas`
- **ความจุรายจุดเป็นตัวจริง** เพื่อไม่ให้มีค่าความจุสามที่ขัดกัน (`parking_capacity`, `supported_vehicles`, รายจุด) · ค่าระดับศูนย์จึงคำนวณ ไม่กรอกซ้ำ
- ไม่ migrate `supported_vehicles` เข้าจุดจอดรถ เพราะศูนย์เดิมไม่มีพิกัด สร้างจุดให้เองไม่ได้ · จึงให้ค่าเดิมใช้ต่อจนกว่าจะมีจุดที่ระบุรถ ตัวกรองหน้า public ไม่ว่างระหว่างช่วงเปลี่ยนผ่าน
- เงื่อนไขสลับค่า (FR-9/FR-10) ใช้ "มีจุดที่ระบุรถ" ไม่ใช่ "มีจุดแรก" เพื่อไม่ให้ศูนย์หลุดจากตัวกรองทันทีที่เพิ่มจุดที่ยังไม่กรอกรถ
- ใช้รูปเดียวกับจุดแจกอาหารทุก field และรูปเดียวกับ `supported_vehicles` ในส่วน `vehicles` เพื่อใช้ schema, หน้าต่างแผนที่ และรูปแบบ test เดิมได้
- เพิ่มเป็นส่วนที่ 10 ต่อท้าย แทนการแทรกถัดจากส่วนที่ 3/4 เพราะเลข "ส่วนที่ N" ของแต่ละส่วนเขียนตายตัวในแต่ละ component · ต่อท้ายจึงไม่ต้องเลื่อนเลขส่วนอื่น และยังอยู่ติดกับนโยบายยานพาหนะ
- import: ทำแค่ "ไม่ลบข้อมูลเดิม" เพราะ sheet ใหม่ต้องแก้คอลัมน์ parser template job store UI และ test จำนวนมาก โดยยังไม่มีใครขอ
- งานต่อที่บันทึกไว้: (1) นี่เป็นรายการปักหมุดชุดที่ 3 (จุดแจกอาหาร, จุดเก็บของ, จุดจอดรถ) ควรแยก section ปักหมุดที่ใช้ร่วมกันใน PR refactor ต่างหาก (2) CR แสดงจุดจอดรถบนหน้า public (Q3) (3) เลิกใช้ `parking_capacity` และ `supported_vehicles` เมื่อศูนย์ย้ายมาใช้จุดจอดรถครบ (Q6)

## Migration

- **shelter schema_v 9 → 10 (additive):** `migrateV9ToV10` เติม `parking_points = []` เมื่อไม่มี key · `normalizeCurrent` เติมค่าเดียวกัน (doc ที่ stamp 10 แต่ขาด key ก็อ่านถูก) และเติม `vehicles = []` ให้จุดที่ไม่มี · คืน object เดิมเมื่อไม่มีอะไรขาด (`updateMaster` ใช้ `===` ตัดสินว่าไม่ต้องเขียน) · ไม่มี batch script · เขียนครั้งถัดไป persist `[]` และ stamp 10
- **ไม่แตะ `parking_policy.supported_vehicles`:** ไม่ย้าย ไม่ลบ ไม่แปลงค่า · ศูนย์เดิมทุกแห่งอ่านค่าเดิมได้เหมือนเดิม (FR-10, FR-22)
- **แต่ละขั้นของ chain stamp เลขของตัวเอง** (ตามกติกา CR-205): ตอนนี้ `migrateV8ToV9` stamp `SHELTER_MASTER_SCHEMA_V` → เปลี่ยนให้ stamp `9` ตรงๆ แล้วต่อ `migrateV9ToV10` ท้าย chain ทุก branch ของ `migrateShelterV2ToCurrent` (v2–v8) และเพิ่มกรณี `schema_v === 9`
- `scripts/migrate-shelter.ts` และ `provisioner.ts` อ้างค่าคงที่อยู่แล้ว ไม่ต้องแก้
- **ลำดับ rollout:** deploy code ใหม่ก่อน · doc ถูกเขียนเป็น v10 เฉพาะเมื่อเจ้าหน้าที่แก้ศูนย์ · ก่อน merge ตรวจว่า app และ worker รุ่นเก่ายังอ่าน doc `schema_v: 10` ได้ (worker ไม่ตรวจ `schema_v` ของ shelter; app รุ่นเก่าเข้า branch `>= current` แล้ว normalize)
- **rollback:** deploy code รุ่นก่อน · array `parking_points` ที่เขียนไปแล้วถูกละไว้ ไม่ทำให้อ่าน doc ไม่ได้ · **ข้อควรระวังเพิ่ม:** รุ่นก่อนไม่รู้จักจุดจอดรถ จึงตัวกรอง public กลับไปอ่าน `supported_vehicles` เดิมทั้งหมด ศูนย์ที่เคยได้ค่าจากจุดจอดรถจะหายจากตัวกรองจนกว่าจะ roll forward · ก่อน merge ตรวจว่าทางเขียนของรุ่นก่อน (PATCH back-office, import, จุดเก็บของ) เขียนทับเฉพาะ field ที่แก้ ไม่ตัด key ที่ไม่รู้จักทิ้ง
- **Mongo / worker:** ไม่มีการเปลี่ยน · ไม่ bump `PROJECTION_VERSION` · `raw_data` ได้ `parking_points` เองเมื่อ doc ถูกเขียนใหม่

## Decision log

- 2026-11-12 — proposed (draft) จาก GitHub #1352 · รูปข้อมูล = รูปของจุดแจกอาหาร · import ทำแค่กันข้อมูลหาย
- 2026-11-12 — owner ตอบ open questions: Q1 ย้ายความจุและประเภทรถลงรายจุด (ค่ารวมคำนวณจากผลรวม) · ศูนย์เดิมใช้ `supported_vehicles` ต่อจนมีจุดที่ระบุรถ (ตัวเลือก ก) · ส่วนที่ 9 แสดงค่าเดิมอ่านอย่างเดียว · จุดจอดรถไม่ต้องมีพิกัด · Q3 ต้องการแสดงหน้า public (CR แยก) · Q4 ไม่ทำ sheet · วิธีติดตาม = แก้ไฟล์ CR นี้ใน PR #1374
