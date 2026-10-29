---
id: CR-205 # renumbered from draft-storage-drop-off-points
title: ใช้จุดเก็บของเป็นจุดรับบริจาค พร้อมพิกัดบนแผนที่ และส่งออก public
status: approved
date: 2026-10-27
updated: 2026-10-29 # amendment: FR-DP-18 file pointers + PROJECTION_VERSION (approved 2026-10-28, Soravit Sukkarn, Team Lead)
requested_by: "feedback จาก demo 2026-10-23 (epic #825) — issue #812"
decided_by: Soravit Sukkarn (Team Lead)
decision_date: 2026-10-28
layer: volatile
affects:
  - docs/data/schema.md §3.1 `shelter.common_areas.sub_storage[]` — field ใหม่ `accepts_donations`, `lat`, `lng`, `location_note` · shelter schema_v 8 → 9
  - docs/data/schema.md §9.1 `public_shelters.donation_points` (projection field ใหม่)
  - docs/data/couchdb-mongodb-sync.md §3.2 `public_shelters` · PROJECTION_VERSION 10 → 11 (หรือเลขถัดไปตอน merge)
  - docs/data/api-contract.md §5 — response ของ `GET /public/v1/shelters/{code}` มี `donation_points` (list `GET /public/v1/shelters` ไม่เปลี่ยน)
  - frontend/src/lib/features/shelters (domain/schema.ts `subStorageItemSchema` + migrate v8 → v9, domain/storage-points.ts, ui/storage-points-section.svelte, ui/shelter-form-validation.ts)
  - frontend/src/lib/features/shelter-import/domain/import-row.ts
  - frontend/src/lib/features/donations (domain/drop-off.ts — ต่อยอด `resolveDropOffPoint` / `DropOffPoint` จาก #926)
  - frontend/src/lib/features/public-portal (domain/donation-map.ts `donationMapPointsOf`, ui/donation-needs-map.svelte ขั้น 1 + ui/drop-off-shelter-map.svelte ขั้น 3 — จาก #814 · FR-DP-18)
  - packages/tent-model/src/tent_model/public_shelter.py (`DonationPoint`, `PublicShelter.donation_points`)
  - worker/src/worker/projectors/shelter.py · worker/src/worker/projection_version.py
  - backend/apiapp/modules/shelter (schemas.py `ShelterDetail`, use_case.py) · backend/tests/test_shelter.py
  - frontend/src/lib/api (fastapi.json, openapi.d.ts)
why: >
  ผู้บริจาคเห็นแค่ที่อยู่ของศูนย์ ไม่รู้ว่าต้องนำของไปส่งตรงไหนในศูนย์ ทั้งที่ศูนย์ใหญ่มีจุดเก็บของหลายจุด
  และเจ้าหน้าที่ต้องย้ายของจากจุดที่รับไปยังจุดเก็บอีกรอบ — ให้จุดเก็บของที่ติ๊กไว้เป็นจุดรับบริจาคได้
  พร้อมพิกัด ของที่มาส่งจึงเข้าคลังของจุดนั้นเลย (epic #825)
migration: >
  additive — doc เดิมที่ไม่มี key อ่านเป็น `accepts_donations = false`, `lat = lng = location_note = null`
  ไม่ต้อง backfill · bump shelter schema_v 8 → 9 · bump PROJECTION_VERSION ให้ worker re-project
  `public_shelters` ทุกศูนย์
---

# ใช้จุดเก็บของเป็นจุดรับบริจาค พร้อมพิกัดบนแผนที่ และส่งออก public

## สรุป (TL;DR)

- จุดเก็บของแต่ละจุด (`shelter.common_areas.sub_storage[]`) มี checkbox "ใช้เป็นจุดรับบริจาค" · ติ๊กแล้วต้องปักหมุดพิกัด และใส่คำอธิบายตำแหน่งได้
- ไม่สร้าง entity "จุดรับบริจาค" แยก · ประเภทของที่จุดรับได้ = `types[]` ของจุดเก็บนั้น (CR-199)
- worker ส่งออกเฉพาะจุดที่ติ๊กและมีพิกัด ไปที่ `public_shelters.donation_points` · FastAPI อ่านจาก field นี้เท่านั้น ห้ามอ่านจุดเก็บจาก `raw_data`
- ศูนย์ที่ไม่มีจุดติ๊ก = มี "จุดหลัก" 1 จุดที่ตำแหน่งศูนย์ (คำนวณตอนอ่าน ไม่บันทึก)
- shelter schema_v 8 → 9 · PROJECTION_VERSION 10 → 11 (หรือเลขถัดไปตอน merge) · เป็นฐานของ #813 (แยกส่งหลายจุด), #814 (แผนที่ในหน้าบริจาค), #590/#591 (ปลายทางในหน้าติดตามและใบปะหน้า)

## Why

- ศูนย์หนึ่งมีจุดเก็บของได้หลายจุด เช่น โรงยิม ห้องพยาบาล โรงครัว แต่หน้าบริจาค public แสดงแค่ชื่อและที่อยู่ของศูนย์ ผู้บริจาคจึงไม่รู้ว่าต้องนำของไปส่งที่ไหน
- ของที่รับเข้ามาแล้วต้องย้ายไปจุดเก็บอีกรอบ ถ้าจุดรับ = จุดเก็บ ของจะเข้าคลังของจุดนั้นเลย (ล็อตมี `storage_point_id` อยู่แล้ว — schema.md §2.1, CR-139)
- ข้อมูลจุดเก็บตอนนี้เป็น staff-only ไม่มีพิกัด และไม่มีการบอกว่าจุดไหนรับบริจาค
- #812 ตัดสินแล้ว: ใช้จุดเก็บของ ไม่สร้าง entity ใหม่ (comment ของ Fishcanwalk 2026-10-24) และศูนย์ที่ไม่มีจุดติ๊ก = จุดหลักที่ตำแหน่งศูนย์

## Requirements

**ข้อมูลจุดเก็บของ (CouchDB `shelter`)**

- **FR-DP-1** — `sub_storage[]` แต่ละรายการมี 4 field ใหม่ตามตาราง §Change · doc ที่ไม่มี key อ่านได้ค่าเริ่มต้นในตาราง
- **FR-DP-2** — `accepts_donations = true` ต้องมีทั้ง `lat` และ `lng` · ไม่ครบ → บันทึกไม่ผ่าน และ error แสดงที่แถวของจุดนั้น
- **FR-DP-3** — `lat` อยู่ในช่วง −90..90, `lng` อยู่ในช่วง −180..180 (ช่วงเดียวกับ `food_distribution_points`) · `lat = 0` และ `lng = 0` พร้อมกัน → บันทึกไม่ผ่าน (เป็นค่าที่ได้เมื่อยังไม่ได้ปักหมุด ไม่ใช่ตำแหน่งจริง · `drop-off.ts` ของ #926 ก็ถือ (0,0) เป็น "ไม่มีพิกัด")
- **FR-DP-4** — `location_note` ตัดช่องว่างหัวท้าย · ว่าง → `null` · ยาวไม่เกิน 200 ตัวอักษร
- **FR-DP-5** — เอาติ๊ก `accepts_donations` ออก → คง `lat`/`lng`/`location_note` ไว้ (ติ๊กกลับไม่ต้องปักหมุดใหม่)

**หน้าตั้งค่าศูนย์ — ส่วน "จุดเก็บของ"** (`storage-points-section.svelte`)

- **FR-DP-6** — แต่ละจุดมี checkbox "ใช้เป็นจุดรับบริจาค"
- **FR-DP-7** — เมื่อติ๊ก แสดงปุ่ม "ปักหมุดตำแหน่ง" ที่เปิด dialog แผนที่ (`LocationMapPicker`) · แผนที่เริ่มที่พิกัดศูนย์ · ใน dialog มีช่องกรอก lat/lng เป็นตัวเลขด้วย (ใช้เมื่อแผนที่โหลดไม่ได้)
- **FR-DP-8** — เมื่อติ๊ก แสดงช่อง "คำอธิบายตำแหน่งสำหรับผู้มาส่ง" (เช่น "ประตู 2 ข้างโรงยิม")
- **FR-DP-9** — สิทธิ์แก้ไขเท่ากับฟอร์มศูนย์เดิม ไม่เพิ่ม role/permission

**import ข้อมูลศูนย์** (`shelter-import`)

- **FR-DP-10** — จุดเก็บที่ import มาได้ `accepts_donations = false` และ `lat = lng = location_note = null` · ไม่เพิ่มคอลัมน์ใน template

**public plane**

- **FR-DP-11** — worker เขียน `public_shelters.donation_points` = รายการจุดที่ `accepts_donations = true` **และ** มีทั้ง `lat`/`lng` ที่ไม่ใช่ (0,0) เท่านั้น · จุดอื่นไม่อยู่ใน field นี้
- **FR-DP-12** — แต่ละรายการใน `donation_points` มีเฉพาะ `id`, `name`, `types`, `geo`, `location_note` · ห้ามส่ง `area_m2`
- **FR-DP-13** — worker รองรับจุดเก็บทั้งรูปเดิม (`type` เดี่ยว, ก่อน schema_v 8) และรูปใหม่ (`types[]`) แปลงเป็น `types[]` เสมอ
- **FR-DP-14** — FastAPI `GET /public/v1/shelters/{code}` (`ShelterDetail`) คืน `donation_points` (ไม่มีจุด = `[]`) · list `GET /public/v1/shelters` (`ShelterItem`) **ไม่**มี field นี้ — ทุกหน้าที่ต้องใช้จุด (ฟอร์มบริจาคหลังเลือกศูนย์ #813, หน้าติดตาม #590, ใบปะหน้า #591) รู้ศูนย์แล้วจึงอ่านจาก detail · แผนที่เลือกศูนย์ (#814) ใช้ list แต่ปักหมุดระดับศูนย์ ไม่ใช่ระดับจุด จึงไม่ต้องให้ทุกศูนย์ใน list แบก `donation_points`
- **FR-DP-15** — FastAPI อ่าน `donation_points` จาก field ที่ worker project ไว้เท่านั้น · ห้ามอ่าน `raw_data.common_areas.sub_storage` (raw_data มีจุดที่ไม่ได้ติ๊กด้วย)
- **FR-DP-16** — ฝั่ง public frontend: ศูนย์ที่ `donation_points` ว่าง → ใช้ "จุดหลัก" 1 จุด ชื่อ = ชื่อศูนย์ พิกัด = `geo` ของศูนย์ · ไม่บันทึกจุดหลักลง CouchDB หรือ Mongo
- **FR-DP-17** — ศูนย์ที่มีจุดติ๊กอย่างน้อย 1 จุด → ผู้บริจาคเลือกได้เฉพาะจุดที่ติ๊ก ตำแหน่งศูนย์ไม่ใช่ตัวเลือก (ดู D-3)
- **FR-DP-18** — แผนที่เลือกศูนย์ในฟอร์มบริจาค (#814) แสดงหมุดศูนย์จาก list `GET /public/v1/shelters` · หมุดจุดรับบริจาคแสดง**เฉพาะศูนย์ที่ผู้บริจาคเลือกหรือถูกล็อกไว้** โดยอ่าน `donation_points` จาก detail ของศูนย์นั้น 1 request · ไม่ยิง detail ทุกศูนย์เพื่อวาดหมุดจุดของทุกศูนย์พร้อมกัน
  - ศูนย์ที่ `donation_points` ว่าง → ไม่วาดหมุดจุดเพิ่ม (หมุดศูนย์คือจุดหลักอยู่แล้ว ตาม FR-DP-16)
  - การเลือกจุดให้แต่ละรายการอยู่ใน CR-206 (#813) ไม่อยู่ใน CR นี้

## Change (before → after)

**CouchDB `shelter.common_areas.sub_storage[]`** (ต่อจาก shape ของ CR-199)

| field | ชนิด | ค่าเมื่อ doc ไม่มี key | กติกา |
| --- | --- | --- | --- |
| `accepts_donations` | bool | `false` | — |
| `lat` | num \| null | `null` | −90..90 · ต้องมีเมื่อ `accepts_donations = true` |
| `lng` | num \| null | `null` | −180..180 · ต้องมีเมื่อ `accepts_donations = true` |
| `location_note` | str \| null | `null` | trim · ≤ 200 ตัวอักษร |

- ก่อน: `{ id, name, types: ['food_dry'], area_m2 }`
- หลัง: `{ id, name, types: ['food_dry'], area_m2, accepts_donations: true, lat: 7.0086, lng: 100.4747, location_note: 'ประตู 2 ข้างโรงยิม' }`

**Mongo `public_shelters`** (field ใหม่)

```
donation_points: [{ id: str, name: str, types: [str], geo: { lat: num, lng: num }, location_note: str | null }]
```

- `id` = `sub_storage[].id` (ULID หรือ `legacy-<index>`) — ใช้อ้างจุดจากใบบริจาคใน #813 · จุดที่ส่งออกได้ต้องถูกติ๊กและบันทึกที่ schema_v 9 แล้ว `id` จึงถูก persist ใน doc เสมอ ไม่ใช่ค่าที่เติมตอนอ่าน
- `types` ส่งเป็น key ของ enum (CR-199) · frontend แปลงเป็น label เอง

**จุดที่เปลี่ยนหลังมีใบจองอ้างถึง** (ใบจองอ้างด้วย `id` เท่านั้น ไม่เก็บสำเนาชื่อหรือพิกัด)

| เหตุการณ์ | `donation_points` | ใบจองที่อ้างจุดนั้น |
| --- | --- | --- |
| ย้ายหมุด / แก้ชื่อ / แก้ `location_note` | แสดงค่าใหม่ | แสดงค่าใหม่ — ผู้บริจาคควรไปตำแหน่งปัจจุบัน |
| เอาติ๊กออก หรือลบจุด | จุดหายจาก field | กติกาอยู่ใน CR-206 (FR-MP-16, FR-MP-19): แสดงในกลุ่ม "ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้" พร้อมที่อยู่ศูนย์ ไม่ error และเจ้าหน้าที่จุดไหนก็รับรายการนั้นได้ |

CR นี้ไม่เพิ่มกติกาฝั่งใบจอง — แค่รับประกันว่า `id` ไม่เปลี่ยนเมื่อแก้จุด

**FastAPI** — `ShelterDetail.donation_points: list[DonationPoint] = []` (`ShelterItem` ไม่เปลี่ยน)

| เรื่อง | ก่อน | หลัง |
| --- | --- | --- |
| จุดเก็บของ | staff-only ไม่มีพิกัด | staff-only ยกเว้นจุดที่ติ๊กรับบริจาคและมีพิกัด |
| ปลายทางของผู้บริจาค | ที่อยู่ศูนย์ | จุดรับบริจาคที่ติ๊ก หรือจุดหลัก (= ตำแหน่งศูนย์) |
| shelter schema_v | 8 | 9 |
| PROJECTION_VERSION | 10 | 11 (หรือเลขถัดไปตอน merge) |

## Acceptance

- **AC-1** — เปิด doc ศูนย์ schema_v 8 ที่ไม่มี field ใหม่ → ฟอร์มแสดงทุกจุดไม่ติ๊ก · บันทึกแล้ว doc เป็น schema_v 9 และมี `accepts_donations: false`
- **AC-2** — ติ๊ก "ใช้เป็นจุดรับบริจาค" แต่ไม่ปักหมุด → บันทึกไม่ผ่าน และ error อยู่ที่แถวนั้น
- **AC-3** — ติ๊ก + ปักหมุด + ใส่คำอธิบาย → บันทึก → doc มีครบ 4 field
- **AC-4** — เอาติ๊กออกแล้วบันทึก → `lat`/`lng`/`location_note` ยังอยู่ใน doc
- **AC-5** — ศูนย์มี 3 จุด: ติ๊กพร้อมพิกัด 1 จุด, ติ๊กแต่ไม่มีพิกัด (doc เก่า) 1 จุด, ไม่ติ๊ก 1 จุด → `GET /public/v1/shelters/{code}` คืน `donation_points` 1 รายการ และไม่มี `area_m2`
- **AC-6** — ศูนย์ไม่มีจุดติ๊ก → `donation_points: []` และหน้าบริจาคแสดงจุดหลักที่ตำแหน่งศูนย์
- **AC-7** — import ศูนย์ที่มีจุดเก็บ → ทุกจุด `accepts_donations = false`
- **AC-8** — หลัง deploy worker ใหม่ → `public_shelters` ทุกแถวมี `donation_points` (re-project จาก PROJECTION_VERSION)
- **AC-9** — ติ๊กแล้วกรอก lat = 0, lng = 0 ในช่องตัวเลข → บันทึกไม่ผ่าน และ error อยู่ที่แถวนั้น
- **AC-10** — doc ศูนย์ schema_v 7 ที่จุดเก็บยังมี `type` เดี่ยว → อ่านแล้วได้ schema_v 9, `types[]` และค่าเริ่มต้นของ 4 field ใหม่ครบ
- **AC-11** — `GET /public/v1/shelters` (list) ไม่มี `donation_points` · `GET /public/v1/shelters/{code}` มี
- **AC-12** — ฟอร์มบริจาค: ศูนย์ A มี 2 จุดติ๊ก ศูนย์ B ไม่มี · ก่อนเลือกศูนย์ แผนที่มีแค่หมุดศูนย์ A และ B · เลือกศูนย์ A → มีหมุดจุดของ A เพิ่ม 2 หมุด และมี request detail ของ A เท่านั้น · เลือกศูนย์ B → ไม่มีหมุดจุดเพิ่ม

## Impact

- **frontend `shelters`**
  - `domain/schema.ts`: เพิ่ม 4 field ใน `z.object` ข้างใน `subStorageItemSchema` (ตัวนอกเป็น `z.preprocess` จึงใช้ `.extend()` ไม่ได้) + `superRefine` ตาม FR-DP-2 (error path `.lat`)
  - `SHELTER_MASTER_SCHEMA_V` 8 → 9 + `migrateV8ToV9` ต่อท้าย chain ของ `migrateShelterV2ToCurrent` (ดู §Migration เรื่องเลขที่แต่ละขั้น stamp)
  - `domain/storage-points.ts`: `listDonationPoints(shelter)` คัดเฉพาะจุดที่ติ๊ก
  - `ui/storage-points-section.svelte`: FR-DP-6 – FR-DP-8 (dialog แบบเดียวกับ `food-distribution-section.svelte`)
  - `ui/shelter-form-validation.ts`: map error ของ FR-DP-2 ไปที่แถว
- **frontend `shelter-import`**: `import-row.ts` `resolveSubStorage` ใส่ค่าตาม FR-DP-10
- **frontend `donations`**: ต่อยอด `domain/drop-off.ts` ของ #926 (ห้ามสร้าง logic จุดส่งของชุดใหม่ใน feature อื่น)
  - เพิ่ม `listDropOffPoints(shelter)` คืน `DropOffPoint[]` (FR-DP-16, FR-DP-17): map `id` → `pointId`, `location_note` → `note`, `geo` ผ่าน `cleanGeo` ตัวเดิม · `donation_points` ว่าง → `[resolveDropOffPoint(shelter)]` (จุดหลัก `pointId = null`)
  - `DropOffShelterSource` เพิ่ม `donation_points?`
  - ถ้า #926 ยังไม่ merge ตอน implement ให้ต่อจาก branch ของ #926
- **frontend `public-portal`** (แผนที่ของ #814 · FR-DP-18): `donation-needs-map.svelte` (ขั้น 1 · ศูนย์ที่แตะหมุด) และ `drop-off-shelter-map.svelte` (ขั้น 3 · ศูนย์ที่ล็อก) อ่าน detail ของศูนย์นั้น 1 request แล้วแปลง `donation_points` ด้วย `donationMapPointsOf` ส่งเข้า `pointsByShelter` ของ `buildDonationMap`
- **tent-model**: `DonationPoint` + `PublicShelter.donation_points: list[DonationPoint] = []`
- **worker**: `project_shelter()` สร้าง `donation_points` ตาม FR-DP-11 – FR-DP-13 · bump `PROJECTION_VERSION`
- **backend**: `ShelterDetail` เพิ่ม `donation_points` (`ShelterItem` ไม่เปลี่ยน) · `use_case.py` อ่านตาม FR-DP-15
- **OpenAPI**: regenerate `fastapi.json` + `openapi.d.ts`
- **legacy external** `GET /external/v1/shelters/{code}` ใช้ `ShelterDetailResponse` ตัวเดียวกัน → ได้ `donation_points` ด้วย (ข้อมูลเดียวกับที่ public เห็นอยู่แล้ว ดู D-4) · Partner API EXT-002/003 (`/external/locations`) ใช้ schema แยก ไม่เปลี่ยน
- **ไม่กระทบ**: `stock_ledger` (มี `lot.storage_point_id` อยู่แล้ว), `donation`, `donation_slot`, `food_distribution_points`
- **docs หลัง approve**: schema.md §3.1 (+ หมายเหตุ schema_v 9 และ Migration 8 → 9) และ §9.1 · couchdb-mongodb-sync.md §3.2 · api-contract.md §5 (endpoint shelters ยังไม่อยู่ในตาราง — เพิ่มแถว) · อัปเดต `updated:` ทุกไฟล์

## Migration

- **shelter schema_v 8 → 9 (additive):** reader เติมค่าเริ่มต้นตามตาราง §Change ให้จุดที่ไม่มี key · เขียนครั้งถัดไป persist ค่าเหล่านั้นและ stamp schema_v 9 · ไม่มี batch script
- **แต่ละขั้นของ chain stamp เลขของตัวเอง:** บน develop `migrateV7ToV8` stamp `schema_v: SHELTER_MASTER_SCHEMA_V` ถ้า bump ค่าคงที่เป็น 9 โดยไม่แก้ doc v7 จะถูก stamp 9 ก่อนเข้า `migrateV8ToV9` จึงต้อง:
  - เปลี่ยน `migrateV7ToV8` ให้ stamp `8` ตรงๆ และให้ `migrateV8ToV9` stamp `SHELTER_MASTER_SCHEMA_V`
  - ทุก branch ใน `migrateShelterV2ToCurrent` (v2–v7) ต่อ `migrateV8ToV9` ท้ายสุด และเพิ่มกรณี `schema_v === 8`
  - `migrateV8ToV9` เติมค่าเริ่มต้นโดยดูจาก key ที่ขาด ไม่ดูจาก `schema_v` · `normalizeCurrent` เติมค่าเดียวกันด้วย doc ที่ stamp 9 แต่ขาด key ก็ยังอ่านได้ถูก
  - test: doc v6, v7, v8 ผ่าน `migrateShelterV2ToCurrent` แล้วได้ schema_v 9 พร้อมค่าเริ่มต้นครบ
- **PROJECTION_VERSION:** bump ให้ worker bootstrap re-project `public_shelters` ทุกแถว · แถวที่ยังไม่ re-project ไม่มี key → FastAPI คืน `[]` (= จุดหลัก)
- **rollout:** หลัง deploy ไม่มีศูนย์ไหนมีจุดรับบริจาคจนกว่าเจ้าหน้าที่จะติ๊ก → ผู้บริจาคเห็นจุดหลักเหมือนเดิม

## ข้อตกลง

Soravit Sukkarn (Team Lead) ตัดสิน D-1..D-4 ใน review ของ PR #944 วันที่ 2026-10-27 และ approve CR นี้วันที่ 2026-10-28

- **D-1 — slot เวลารับของ** (คำถามค้างใน #812): ผูกกับศูนย์ต่อไป **หรือ** ผูกกับจุด
  - **ผล: ผูกกับศูนย์ไปก่อน** — ถ้าผูกกับจุด ต้องเปลี่ยน `_id` ของ `donation_slot` (§2.13), `donation_slot_counters` และสูตรที่ว่างของ CR-157 ทั้งหมด ซึ่งใหญ่กว่างานนี้มาก
- **D-2 — เวลาเปิดรับแยกต่อจุด** (คำถามค้างใน #812)
  - **ผล: ไม่มี** — จุดที่เปิดรับไม่ตรงกับศูนย์ ให้เขียนใน `location_note`
- **D-3 — ศูนย์ที่มีจุดติ๊กแล้ว ตำแหน่งศูนย์ยังเป็นตัวเลือกไหม**
  - **ผล: ไม่เป็น** (FR-DP-17) — ถ้าศูนย์อยากให้ส่งที่หน้าศูนย์ได้ด้วย ให้สร้างจุดเก็บ "หน้าศูนย์" แล้วติ๊ก
- **D-4 — legacy `/external/v1/shelters/{code}` ได้ `donation_points` ด้วย**
  - **ผล: ได้** — ข้อมูลชุดเดียวกับที่ public เห็น และแยก response model ออกจากกันเป็นงานที่ไม่จำเป็น

## Decision log

- 2026-10-27 — proposed (draft) จาก issue #812 และแผน epic #825
- 2026-10-27 — Team Lead (Soravit Sukkarn) ตัดสิน D-1..D-4 ตามข้อเสนอใน review ของ PR #944
- 2026-10-27 — แก้ตาม review PR #944:
  - Impact ชี้ไปต่อยอด `donations/domain/drop-off.ts` ของ #926 แทนการสร้างใหม่ใน `public-portal`
  - `donation_points` อยู่ใน detail อย่างเดียว ไม่ใส่ใน list (FR-DP-14)
  - Migration ระบุว่าแต่ละขั้น stamp เลขของตัวเอง
  - ปฏิเสธพิกัด (0,0) (FR-DP-3, FR-DP-11)
  - ระบุผลต่อใบจองเมื่อจุดถูกแก้ ลบ หรือเลิกติ๊ก (อ้าง CR ของ #813)
  - ตัด `created` ออกจาก frontmatter ตาม `_template.md`
  - ไม่จำกัดพิกัดให้อยู่ใกล้ศูนย์ เพราะศูนย์บางแห่งยังไม่มี `geo` และไม่มีระยะที่ตกลงกันไว้
- 2026-10-27 — เพิ่ม FR-DP-18 / AC-12: แผนที่ของ #814 แสดงหมุดจุดเฉพาะศูนย์ที่เลือกหรือล็อก อ่านจาก detail — ผลจากการตัด `donation_points` ออกจาก list
- 2026-10-28 — approved by Soravit Sukkarn (Team Lead) · รันเลข CR-205 (renumbered from draft-storage-drop-off-points) ย้ายเข้า `00-baseline/` (หมวดเดียวกับ CR-139 ที่สร้าง `sub_storage`)
- 2026-10-29 — amendment (PR #1004 · ยืนยันโดย Kunanon Nusaeng · ไม่เปลี่ยน rule): หลัง #995 (design A · decision sync 2026-10-28) แผนที่เลือกศูนย์แยกเป็น 2 ที่ — FR-DP-18 / AC-12 ใช้กับแผนที่ขั้น 1 ("เลือก" = ศูนย์ที่แตะหมุด) และแผนที่ขั้น 3 ("ล็อก") · แก้ชื่อไฟล์ใน affects / Impact (`donation-shelter-picker.svelte` ไม่มีแล้ว) · PROJECTION_VERSION ที่ใช้จริง 10 → 11 (develop อยู่ที่ 10 ตอน implement) ไม่ใช่ 9 → 10
- 2026-10-29 — ตัดสินช่องว่างใน CR (PR #1004 · ยืนยันโดย Kunanon Nusaeng · ไม่เปลี่ยน field/rule): (1) ที่อยู่ของจุด = ที่อยู่ศูนย์ — จุดไม่มี field ที่อยู่ของตัวเอง ตั๋ว/หน้าติดตาม/ใบปะหน้าใช้ชื่อ + พิกัด + `location_note` ของจุด กับที่อยู่ศูนย์ · (2) FR-DP-3 ปฏิเสธพิกัด (0,0) ทุกจุดเก็บ ไม่ว่าจะติ๊กรับบริจาคหรือไม่ · (3) worker ข้ามจุดที่ไม่มี `id` (จุดที่ติ๊กต้องบันทึกที่ schema_v 9 ซึ่งตั้ง `id` เสมอ) · (4) จุดที่ไม่มีประเภท worker ส่ง `types: []` ไม่ทิ้งจุด
