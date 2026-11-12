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
  - worker/src/worker/projectors/shelter.py (`project_parking_points` ใหม่ → `public_shelters.parking_points`) · worker/src/worker/projection_version.py (bump `PROJECTION_VERSION`) · worker/tests
  - backend/apiapp/modules/shelter/schemas.py · use_case.py (`ShelterItem.parking_points` + `ShelterDetail.parking_points`, ฟิลเตอร์/มาตรฐาน list) · packages/tent-model/src/tent_model/public_shelter.py (`ParkingPoint` ใหม่ ข้าง `DonationPoint`) · backend/tests
  - frontend/src/lib/api-specs/fastapi.json · frontend/src/lib/api/openapi.d.ts (`pnpm openapi:update`)
  - frontend/src/lib/features/public-portal (ui/shelter-map.svelte หมุดจุดจอดรถ, หน้ารายละเอียดศูนย์, barrel index.ts) · frontend/src/routes/(public)/shelters/+page.svelte
  - frontend/src/lib/features/public-portal/domain/mappers.ts (`toPublicShelterCard` หยิบเฉพาะฟิลด์ที่รู้จัก ต้องส่ง `parking_points` และ `parking_vehicle_types` ต่อ) · ชนิด `PublicShelterCardModel`
  - frontend/src/lib/features/public-portal/ui/shelter-filter-panel.svelte (ต่อ state/URL ของ checkbox ที่จอดรถ) · frontend/src/routes/(public)/shelters/+page.ts (อ่าน `parking_*` และกรองฝั่ง client) · page.test.ts
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
> - **หน้า public:** หน้าค้นหาศูนย์พักพิง (`/shelters`) แสดงจุดจอดรถเป็นหมุด **ไอคอนที่จอดรถ** บนแผนที่ พร้อมชื่อ หมายเหตุ ประเภทรถและความจุ · ทำตามแบบ `donation_points` (CR-205)
> - **ตัวกรอง public:** ต่อสาย checkbox ที่จอดรถบนหน้า `/shelters` ให้ทำงานจริง (ตอนนี้ไม่ได้ต่อกับข้อมูล) โดยกรองฝั่ง client จาก `parking_vehicle_types` ที่ worker ฉาย
> - **กระทบ:** shelter schema_v 9 → 10 (additive, lazy) · worker projection field ใหม่ + bump `PROJECTION_VERSION` · FastAPI detail response + OpenAPI · แผนที่และตัวกรองหน้า public

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
- FR-10 — **ใช้ค่าเดิม** `parking_policy.supported_vehicles` เมื่อไม่มีจุดจอดรถที่ `vehicles` ไม่ว่างเลย (ศูนย์เดิม หรือเพิ่มจุดแล้วแต่ยังไม่ระบุรถ) · ตัวกรองไม่ใช้ `common_areas.parking_capacity` ตัดสินประเภทรถอีกต่อไป (Q6)
- FR-11 — `parking_policy.availability = 'none'` → ศูนย์ไม่มีที่จอดรถ ไม่ว่ามีจุดจอดรถหรือไม่ · ไม่ลบจุดจอดรถที่บันทึกไว้ (ดู Q5)
- FR-12 — `common_areas.parking_capacity` ไม่แก้ในรอบนี้ · import ยังเขียนต่อ (FR-24) · ตัวกรองไม่อ่านค่านี้แล้ว (Q6)

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

**ตัวกรองที่จอดรถ — route `transparency/shelters`**

- FR-21 — route `transparency/shelters` ที่คำนวณ `parking_car`, `parking_motorcycle`, `parking_boat` อ่านจากค่าที่ใช้จริงตาม FR-9/FR-10 (ใช้ฟังก์ชันคำนวณเดียวกับฟอร์ม ไม่เขียน logic ซ้ำ)
- FR-22 — ศูนย์ที่ยังไม่มีจุดจอดรถที่ระบุรถ ใช้ `supported_vehicles` เดิมกรอง · **ต่างจากเดิมข้อเดียว:** ศูนย์ที่มีแค่ `parking_capacity > 0` โดยไม่ระบุประเภทรถ ไม่ผ่านตัวกรอง `parking_car` / `parking_motorcycle` อีก (route `transparency/shelters` ไม่มีหน้าไหนเรียก จึงไม่กระทบผู้ใช้ตอนนี้)

**import ข้อมูลศูนย์** (`shelter-import`)

- FR-23 — import ไม่มีข้อมูลจุดจอดรถ (workbook ไม่มีคอลัมน์/sheet นี้) → คง `parking_points` เดิมของศูนย์ไว้ทั้งหมด (กติกา "แทนที่เฉพาะเมื่อมีข้อมูลมา" แบบเดียวกับ `food_distribution_points`)
- FR-24 — ไม่เพิ่ม sheet หรือคอลัมน์จุดจอดรถใน template รอบนี้ · คอลัมน์ประเภทรถ/ความจุเดิมยังเขียนลง `parking_policy.supported_vehicles` และ `common_areas.parking_capacity` เหมือนเดิม (มีผลต่อศูนย์ที่ยังไม่มีจุดจอดรถที่ระบุรถเท่านั้น ตาม FR-10)

**public plane**

**public plane — แสดงจุดจอดรถ** (Q3: รวมใน CR นี้)

- FR-25 — worker เพิ่ม `project_parking_points` เขียน `public_shelters.parking_points` = `[{ id, name, note, geo: { lat, lng }, vehicles: [{ type, max_capacity }] }]` · ออกจาก staff plane เฉพาะจุดที่มี `id` และ `name` ที่เป็น string และมีพิกัดจริง (ทั้ง `lat` และ `lng` อยู่ในช่วง ไม่ใช่ (0,0)) แบบเดียวกับ `project_donation_points` · จุดที่ยังไม่ปักหมุดไม่ถูกส่งออก (เห็นเฉพาะใน staff) · `note` ว่างหลัง trim → `null` · เอกสารเสีย (`parking_points` ไม่ใช่ list) ทิ้งแค่รายการจุด ไม่ทิ้งทั้ง shelter row
- FR-26 — ศูนย์ที่ `parking_policy.availability = 'none'` → `public_shelters.parking_points = []` (ไม่แสดงหมุด) ทั้งที่ doc ยังเก็บจุดไว้ (FR-11)
- FR-27 — bump `PROJECTION_VERSION` +1 ใน PR เดียวกับ projector (ตอนเขียน CR ค่าปัจจุบัน 18 → 19 · เลขจริงให้เทียบกับ `develop` ตอน implement) พร้อมเพิ่มบรรทัดอธิบายในไฟล์ · ศูนย์ที่ไม่มีการแก้ไขได้ field ใหม่จาก bootstrap ตอน deploy
- FR-28 — `tent_model.public_shelter` เพิ่ม `ParkingPoint` (ข้าง `DonationPoint`) · FastAPI เพิ่ม `ShelterItem.parking_points` ใน **list response** (`GET /public/v1/shelters`) และ `ShelterDetail.parking_points` ใน detail response (ทั้งคู่ default `[]`) · อ่านจาก field ที่ worker ฉาย ไม่อ่านจาก `raw_data` · ไม่เปลี่ยน route path · รัน `pnpm openapi:update` แล้ว commit `fastapi.json` + `openapi.d.ts`
- FR-29 — หน้าค้นหาศูนย์พักพิง (`/shelters`): แผนที่ (`ShelterMap`) วาดจุดจอดรถเป็นหมุด **ไอคอนที่จอดรถ** (รูปตัว P / รถ) · ขนาดเล็กแบบเดียวกับหมุดจุดรับบริจาค ไม่ใช้หมุดศูนย์และไม่ปนกับหมุดจุดรับบริจาค (สีและไอคอนต่างกัน) · คลิกหมุด → popup แสดงชื่อจุด หมายเหตุ และรายการประเภทรถพร้อมความจุ (หน่วยคันหรือลำ) · ข้อมูลต้องผ่าน `toPublicShelterCard` และชนิด `PublicShelterCardModel` ด้วย (ตัวแปลงนี้ตัดฟิลด์ที่ไม่รู้จักทิ้ง) · BFF `/api/public/v1/shelters` ส่งผ่านทั้งก้อนอยู่แล้ว ไม่ต้องแก้
- FR-30 — แผนที่หน้าค้นหาวาดหมุดจุดจอดรถ **ของทุกศูนย์ที่อยู่ในผลค้นหาพร้อมกัน** (ไม่ต้องเลือกศูนย์ก่อน) · ข้อมูลมาจาก list response (FR-28) · ศูนย์ที่ถูกกรองออกจากผลค้นหา หมุดจุดจอดรถของศูนย์นั้นหายไปด้วย · เลือกศูนย์ → หมุดจุดจอดรถของศูนย์นั้นเน้นหรือไม่ซ่อนศูนย์อื่น (รายละเอียด UI ตัดสินตอน implement) · ภาระข้อมูล: list ใหญ่ขึ้นตามจำนวนจุดจอดรถที่ปักหมุดของทุกศูนย์ (ดู Q7)
- FR-31 — หน้ารายละเอียดศูนย์ (`/shelters/{id}`) แสดงรายการจุดจอดรถ (ชื่อ หมายเหตุ ประเภทรถ+ความจุ) ถ้ามี · ไม่มี → ไม่แสดงส่วนนี้ · ข้อความใหม่ทุกข้อมีทั้งไทยและอังกฤษ: หมุดและ popup ใน `lib/constants/i18n/public-shelter-map.ts` (`PUBLIC_SHELTER_MAP_I18N` ใช้กับ `langState.current`), หน้ารายละเอียดใน `lib/constants/i18n/public-shelter-details.ts`
- FR-32 — `parking_points` ที่ฉายออก public ไม่ใช่ข้อมูลลับ (ชื่อ หมายเหตุ พิกัดสาธารณะของที่จอดรถ ความจุ) · เจ้าหน้าที่ต้องไม่ใส่ข้อมูลส่วนบุคคลในช่อง `note` — ให้ข้อความกำกับใต้ช่อง "หมายเหตุ" ในฟอร์มว่าข้อความนี้แสดงต่อสาธารณะ

**ตัวกรองที่จอดรถบนหน้า `/shelters`** (ต่อสายให้ทำงานจริง · ดู Q8)

- FR-33 — **ต่อสายตัวกรองบนหน้า `/shelters`** (ปัจจุบัน checkbox ไม่ได้ต่อกับข้อมูล: `buildFilterParams` ไม่ใส่ `parking_*` ลง URL, `+page.ts` ไม่อ่านและไม่ส่งใน `filters`) · `shelter-filter-panel.svelte` เพิ่ม state ของ checkbox ทั้งสาม (รถยนต์ มอเตอร์ไซค์ เรือ) และใส่ `parking_car` / `parking_motorcycle` / `parking_boat` = `on` ลง URL ผ่าน `buildFilterParams` เมื่อติ๊ก · `+page.ts` อ่าน param และคืนค่าใน `filters` · กรองจากฟิลด์ที่ผ่านตัวแปลง `toPublicShelterCard` มาแล้ว (ให้ checkbox แสดงสถานะที่ติ๊กไว้หลังโหลดหน้าใหม่)
- FR-34 — กรองฝั่ง client ใน `+page.ts` แบบเดียวกับ `q` / `type` / `hide_full` ที่กรองอยู่แล้ว (ไม่ส่ง parameter ไป FastAPI) · ติ๊กหลายประเภทพร้อมกัน = ศูนย์ต้องรองรับ **ทุกประเภทที่ติ๊ก** (AND) · ไม่ติ๊กเลย = ไม่กรอง · ศูนย์ที่ไม่ผ่านถูกตัดออกจากทั้งรายการและแผนที่ (รวมหมุดจุดจอดรถของศูนย์นั้น ตาม FR-30) · `count` และ `shelters_open` ใน summary นับหลังกรอง
- FR-35 — worker ฉาย `public_shelters.parking_vehicle_types` = รายการประเภทรถที่ศูนย์รองรับ (`motorcycle` / `car` / `truck` / `boat` ไม่ซ้ำ เรียงตามลำดับนี้) คำนวณตามกติกา FR-9/FR-10/FR-11 · `availability = 'none'` → `[]` · ใช้ค่าจากจุดจอดรถที่ **ปักหมุดหรือไม่ก็ได้** (ศูนย์รองรับรถประเภทนั้นเมื่อมีจุดใดระบุไว้) ต่างจาก `parking_points` ที่ฉายเฉพาะจุดที่ปักหมุดแล้ว (FR-25) · ศูนย์ที่ยังไม่มีจุดที่ระบุรถ → ใช้ `parking_policy.supported_vehicles` · ศูนย์ที่มีแค่ `common_areas.parking_capacity` ไม่ระบุประเภทรถ → `parking_vehicle_types = []` ไม่ใช้เลขรวมเดาประเภท (Q6 ตัวเลือก 1)
- FR-36 — FastAPI เพิ่ม `ShelterItem.parking_vehicle_types` ใน list response และ `ShelterDetail.parking_vehicle_types` ใน detail (default `[]`) · เหตุที่ต้องมีใน list: ฝั่ง client กรองได้เฉพาะข้อมูลที่ list ส่งมา และศูนย์เดิมที่ยังไม่มีหมุดต้องกรองจาก `supported_vehicles` ได้ด้วย (ซึ่ง list ไม่มี) · OpenAPI regen ตาม FR-28
- FR-37 — กติกา effective vehicles มี 2 ภาษา: TypeScript (ฟอร์ม + `transparency/shelters`) และ Python (worker) · ทั้งสองต้องผ่านชุดกรณีทดสอบเดียวกัน (ตารางกรณีเดียวกันใส่ใน test ทั้งสองฝั่ง) เพื่อไม่ให้ค่าที่ฟอร์มแสดงกับค่าที่ฉายไป public ต่างกัน

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

**Mongo `public_shelters`** (field ใหม่ ระดับเดียวกับ `donation_points`)

| field                       | ชนิด                                   | ค่าเมื่อไม่มี | กติกา                          |
| --------------------------- | -------------------------------------- | ------------- | ------------------------------ |
| `parking_points`            | `[{ id, name, note, geo, vehicles }]`  | `[]`          | เฉพาะจุดที่มีพิกัดจริง (FR-25) |
| `parking_points[].geo`      | `{ lat, lng }`                         | —             | ในช่วง ไม่ใช่ (0,0)            |
| `parking_points[].note`     | str \| null                            | `null`        | trim · ว่าง → `null`           |
| `parking_points[].vehicles` | `[{ type, max_capacity }]`             | `[]`          | ตามจุดใน CouchDB               |
| `parking_vehicle_types`     | `[enum(motorcycle, car, truck, boat)]` | `[]`          | ประเภทรถที่ศูนย์รองรับ (FR-35) |

FastAPI `GET /public/v1/shelters` → `shelters[].parking_points` และ `shelters[].parking_vehicle_types` และ `GET /public/v1/shelters/{id}` → `shelter.parking_points` · `availability = none` → `[]`

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
- [ ] worker: ศูนย์ที่มี 2 จุด (จุดแรกปักหมุดแล้ว จุดสองยังไม่ปักหมุด) → `public_shelters.parking_points` มี 1 รายการ (จุดแรก) พร้อม `geo` และ `vehicles` · จุดพิกัด (0,0) หรือเกินช่วง ไม่ถูกส่งออก · `note` ว่างเป็น `null`
- [ ] worker: `availability = none` → `parking_points = []` · ศูนย์ที่ `parking_points` ใน doc เสีย → row ยังอยู่ ได้ `[]`
- [ ] bump `PROJECTION_VERSION` แล้ว bootstrap เติม `parking_points` ให้ศูนย์ที่ไม่มีการแก้ไข
- [ ] FastAPI: `GET /public/v1/shelters` ทุกรายการมี `parking_points` และ `GET /public/v1/shelters/{id}` มี `parking_points` · ศูนย์ที่ยังไม่มี field ใน Mongo ได้ `[]` ไม่ error · `fastapi.json` + `openapi.d.ts` ตรงกับ backend
- [ ] หน้า `/shelters`: หมุดจุดจอดรถใช้ไอคอนที่จอดรถ · สีและไอคอนต่างจากหมุดศูนย์และหมุดจุดรับบริจาค · คลิกหมุด → popup ชื่อ หมายเหตุ ประเภทรถ+ความจุ
- [ ] หน้า `/shelters`: เปิดหน้าโดยไม่เลือกศูนย์ → เห็นหมุดไอคอนที่จอดรถของทุกศูนย์ในผลค้นหาที่มีจุดจอดรถ · ศูนย์ที่ไม่มีจุดจอดรถไม่มีหมุดจุดจอดรถ · กรองจนศูนย์หนึ่งหลุดจากผลค้นหา → หมุดจุดจอดรถของศูนย์นั้นหายด้วย
- [ ] หน้ารายละเอียดศูนย์: แสดงรายการจุดจอดรถเมื่อมี · ไม่มี → ไม่แสดงส่วนนี้ · สลับภาษาไทย/อังกฤษได้
- [ ] ฟอร์มศูนย์: ใต้ช่อง "หมายเหตุ" ของจุดจอดรถมีข้อความว่าแสดงต่อสาธารณะ
- [ ] หน้า `/shelters`: ติ๊ก "รถยนต์" → URL มี `parking_car=on` · รายการและแผนที่เหลือเฉพาะศูนย์ที่รองรับรถยนต์ · รีเฟรชแล้ว checkbox ยังติ๊กอยู่
- [ ] ติ๊ก "รถยนต์" และ "เรือ" พร้อมกัน → เหลือเฉพาะศูนย์ที่รองรับทั้งสองประเภท · เอาติ๊กออกทั้งหมด → กลับมาครบ
- [ ] ศูนย์เดิมที่มี `supported_vehicles` รถยนต์ (ไม่มีหมุด) → ผ่านตัวกรอง "รถยนต์" · ศูนย์ที่มีหมุดรถยนต์แต่ยังไม่ปักพิกัด → ผ่านตัวกรอง "รถยนต์" แต่ไม่มีหมุดบนแผนที่
- [ ] ศูนย์ที่มีแค่ `parking_capacity` = 40 ไม่ระบุประเภทรถและไม่มีจุดจอดรถ → ไม่ผ่านตัวกรอง "รถยนต์" และ "มอเตอร์ไซค์" · `parking_vehicle_types = []`
- [ ] ศูนย์ที่ `availability = none` → ไม่ผ่านตัวกรองทุกประเภท แม้มีจุดจอดรถ
- [ ] ตารางกรณี effective vehicles ชุดเดียวกัน ผ่านทั้ง test TypeScript (ฟอร์ม + `transparency/shelters`) และ test Python (worker `parking_vehicle_types`)
- [ ] Tests: domain (schema bounds, `type` ซ้ำ, ฟังก์ชันคำนวณ effective vehicles ทุกกรณี FR-9–FR-11, migration v9 → v10, chain, identity ของ `normalizeCurrent`) · transparency/shelters (ตัวกรองอ่านจากจุดจอดรถ + legacy) · import-row (FR-23) · worker (`project_parking_points` ทุกกรณี FR-25/26) · backend (detail มี field, list ไม่มี) · shelter-map dom test (หมุดจุดจอดรถ) · e2e shelters (เพิ่ม/ปักหมุด/ลบ/ชื่อว่าง/ใส่รถ) และ e2e หน้า `/shelters` (หมุดจุดจอดรถ)

## Open questions

- **Q1 — ค่าจริงของความจุ:** ✅ ตัดสินแล้ว (2026-11-12) — ความจุและประเภทรถเก็บรายจุด · ค่าระดับศูนย์คำนวณจากผลรวมรายจุด · ศูนย์เดิมที่ยังไม่มีจุดจอดรถใช้ `supported_vehicles` เดิมต่อ (ตัวเลือก ก) · ส่วนที่ 9 แสดงค่าเดิมอ่านอย่างเดียว
- **Q2 — จำนวนจุดสูงสุดต่อศูนย์:** ไม่จำกัด (จุดแจกอาหารก็ไม่จำกัด) · ต้องมีเพดานไหม — ยังรอ owner
- **Q3 — แสดงในหน้า public:** ✅ ตัดสินแล้ว (2026-11-13) — owner สั่งให้ทำใน CR นี้ ไม่แยก CR · หมุดบนหน้าค้นหาศูนย์ใช้ไอคอนที่จอดรถ (FR-25–FR-32)
- **Q4 — import:** ✅ ตัดสินแล้ว (2026-11-12) — ไม่เพิ่ม sheet จุดจอดรถใน template รอบนี้ (FR-24)
- **Q5 — `availability = none` กับจุดจอดรถที่บันทึกไว้:** ร่างนี้ไม่ลบจุด แค่ถือว่าศูนย์ไม่มีที่จอดรถ (FR-11) เพราะลบแล้วกู้พิกัดไม่ได้ · ยืนยันไหม
- **Q6 — `common_areas.parking_capacity`:** ✅ ตัดสินแล้ว (2026-11-13) — ตัวกรองเลิกใช้เลขรวมเดาประเภทรถ (FR-10, FR-22, FR-35) · ศูนย์ที่มีแต่เลขรวมโดยไม่ระบุประเภทรถ จะไม่ผ่านตัวกรองจนกว่าจะระบุประเภท · import ยังเขียนเลขรวมต่อ (FR-24) · งานต่อแยก CR: ให้ import ตรวจว่ากรอกเลขรวมต้องระบุประเภทรถด้วย
- **Q7 — หมุดจุดจอดรถบนหน้าค้นหา แสดงของศูนย์ไหน:** ✅ ตัดสินแล้ว (2026-11-13) — แสดงของทุกศูนย์พร้อมกัน (FR-30) · ต้องเพิ่ม `parking_points` ใน list response ทำให้ payload ของรายการศูนย์ใหญ่ขึ้น · ถ้าพบว่าช้าตอนข้อมูลจริงมาก ค่อยตัดสินใหม่ (เช่น ตัด `note` ออกจาก list)
- **Q8 — ตัวกรอง "ที่จอดรถ" บนหน้า `/shelters`:** ✅ ตัดสินแล้ว (2026-11-13) — ต่อสายในรอบนี้ (FR-33–FR-37) · ที่มา: ตรวจพบว่า checkbox ยานพาหนะไม่ได้ต่อกับข้อมูลจริงก่อน CR นี้ (`buildFilterParams` ไม่ใส่ `parking_*`, `+page.ts` ไม่อ่าน, `listPublicShelters` ไม่ส่ง) · route `transparency/shelters` ซึ่งเป็นตัวเดียวที่คำนวณตัวกรอง ไม่มีหน้าไหนเรียก

## Why

- #1352 ขอให้เพิ่มหมุดที่จอดรถของแต่ละศูนย์ "ทำคล้ายจุดแจกอาหาร" · `parking_policy` บอกได้แค่ว่ารับรถอะไร กี่คัน ไม่มีตำแหน่ง
- แยกจุดจอดรถเป็น field ของตัวเอง ไม่ใส่ใน `parking_policy` หรือ `common_areas` เพราะจุดจอดรถเป็นรายการสถานที่ เหมือนที่ `food_distribution_points` แยกจาก `common_areas`
- **ความจุรายจุดเป็นตัวจริง** เพื่อไม่ให้มีค่าความจุสามที่ขัดกัน (`parking_capacity`, `supported_vehicles`, รายจุด) · ค่าระดับศูนย์จึงคำนวณ ไม่กรอกซ้ำ
- ไม่ migrate `supported_vehicles` เข้าจุดจอดรถ เพราะศูนย์เดิมไม่มีพิกัด สร้างจุดให้เองไม่ได้ · จึงให้ค่าเดิมใช้ต่อจนกว่าจะมีจุดที่ระบุรถ ตัวกรองหน้า public ไม่ว่างระหว่างช่วงเปลี่ยนผ่าน
- เงื่อนไขสลับค่า (FR-9/FR-10) ใช้ "มีจุดที่ระบุรถ" ไม่ใช่ "มีจุดแรก" เพื่อไม่ให้ศูนย์หลุดจากตัวกรองทันทีที่เพิ่มจุดที่ยังไม่กรอกรถ
- แสดงบนหน้า public ใน CR เดียวกัน (owner สั่ง) โดยทำตามแบบ `donation_points` (CR-205) ที่มี worker projector, FastAPI field และหมุดบนแผนที่อยู่แล้ว · ส่งออกเฉพาะจุดที่ปักหมุดแล้ว เพราะจุดที่ไม่มีพิกัดวาดบนแผนที่ไม่ได้ · ต่างจาก `donation_points` ตรงที่ใส่ใน list response ด้วย เพราะ owner ต้องการเห็นหมุดจุดจอดรถของทุกศูนย์บนแผนที่ค้นหาพร้อมกัน
- ใช้รูปเดียวกับจุดแจกอาหารทุก field และรูปเดียวกับ `supported_vehicles` ในส่วน `vehicles` เพื่อใช้ schema, หน้าต่างแผนที่ และรูปแบบ test เดิมได้
- เพิ่มเป็นส่วนที่ 10 ต่อท้าย แทนการแทรกถัดจากส่วนที่ 3/4 เพราะเลข "ส่วนที่ N" ของแต่ละส่วนเขียนตายตัวในแต่ละ component · ต่อท้ายจึงไม่ต้องเลื่อนเลขส่วนอื่น และยังอยู่ติดกับนโยบายยานพาหนะ
- import: ทำแค่ "ไม่ลบข้อมูลเดิม" เพราะ sheet ใหม่ต้องแก้คอลัมน์ parser template job store UI และ test จำนวนมาก โดยยังไม่มีใครขอ
- งานต่อที่บันทึกไว้: (1) นี่เป็นรายการปักหมุดชุดที่ 3 (จุดแจกอาหาร, จุดเก็บของ, จุดจอดรถ) ควรแยก section ปักหมุดที่ใช้ร่วมกันใน PR refactor ต่างหาก (2) เลิกใช้ `parking_capacity` และ `supported_vehicles` เมื่อศูนย์ย้ายมาใช้จุดจอดรถครบ (3) CR แยกให้ import บังคับระบุประเภทรถเมื่อกรอกเลขรวม (Q6)

## Migration

- **shelter schema_v 9 → 10 (additive):** `migrateV9ToV10` เติม `parking_points = []` เมื่อไม่มี key · `normalizeCurrent` เติมค่าเดียวกัน (doc ที่ stamp 10 แต่ขาด key ก็อ่านถูก) และเติม `vehicles = []` ให้จุดที่ไม่มี · คืน object เดิมเมื่อไม่มีอะไรขาด (`updateMaster` ใช้ `===` ตัดสินว่าไม่ต้องเขียน) · ไม่มี batch script · เขียนครั้งถัดไป persist `[]` และ stamp 10
- **ไม่แตะ `parking_policy.supported_vehicles`:** ไม่ย้าย ไม่ลบ ไม่แปลงค่า · ศูนย์เดิมทุกแห่งอ่านค่าเดิมได้เหมือนเดิม (FR-10, FR-22)
- **แต่ละขั้นของ chain stamp เลขของตัวเอง** (ตามกติกา CR-205): ตอนนี้ `migrateV8ToV9` stamp `SHELTER_MASTER_SCHEMA_V` → เปลี่ยนให้ stamp `9` ตรงๆ แล้วต่อ `migrateV9ToV10` ท้าย chain ทุก branch ของ `migrateShelterV2ToCurrent` (v2–v8) และเพิ่มกรณี `schema_v === 9`
- `scripts/migrate-shelter.ts` และ `provisioner.ts` อ้างค่าคงที่อยู่แล้ว ไม่ต้องแก้
- **ลำดับ rollout:** deploy code ใหม่ก่อน · doc ถูกเขียนเป็น v10 เฉพาะเมื่อเจ้าหน้าที่แก้ศูนย์ · ก่อน merge ตรวจว่า app และ worker รุ่นเก่ายังอ่าน doc `schema_v: 10` ได้ (worker ไม่ตรวจ `schema_v` ของ shelter; app รุ่นเก่าเข้า branch `>= current` แล้ว normalize)
- **rollback:** deploy code รุ่นก่อน · array `parking_points` ที่เขียนไปแล้วถูกละไว้ ไม่ทำให้อ่าน doc ไม่ได้ · **ข้อควรระวังเพิ่ม:** รุ่นก่อนไม่รู้จักจุดจอดรถ จึงตัวกรอง public กลับไปอ่าน `supported_vehicles` เดิมทั้งหมด ศูนย์ที่เคยได้ค่าจากจุดจอดรถจะหายจากตัวกรองจนกว่าจะ roll forward · ก่อน merge ตรวจว่าทางเขียนของรุ่นก่อน (PATCH back-office, import, จุดเก็บของ) เขียนทับเฉพาะ field ที่แก้ ไม่ตัด key ที่ไม่รู้จักทิ้ง
- **Mongo / worker:** เพิ่ม `public_shelters.parking_points` · bump `PROJECTION_VERSION` (FR-27) → worker รัน full bootstrap หนึ่งครั้งตอน deploy · `raw_data` ยังได้ `parking_points` ทั้งก้อนเอง (รวมจุดที่ไม่ได้ปักหมุด) — FastAPI ห้ามอ่านจาก `raw_data` ไปแสดง ใช้ field ที่ฉายแล้วเท่านั้น
- **ลำดับ deploy public plane:** worker (field ใหม่ + bootstrap) → backend (อ่าน field ใหม่ · default `[]` เมื่อยังไม่มี จึง deploy ก่อน worker ก็ไม่ error) → frontend · เรียงตามทิศทางข้อมูลใน §4.2 (worker → FastAPI → SPA)
- **rollback public plane:** ไม่ลด `PROJECTION_VERSION` · backend/frontend รุ่นก่อนไม่รู้จัก field ใหม่และละไว้ · หมุดจุดจอดรถหายจากหน้า public จนกว่าจะ roll forward · ไม่มีข้อมูลเสียหาย

## Decision log

- 2026-11-12 — proposed (draft) จาก GitHub #1352 · รูปข้อมูล = รูปของจุดแจกอาหาร · import ทำแค่กันข้อมูลหาย
- 2026-11-12 — owner ตอบ open questions: Q1 ย้ายความจุและประเภทรถลงรายจุด (ค่ารวมคำนวณจากผลรวม) · ศูนย์เดิมใช้ `supported_vehicles` ต่อจนมีจุดที่ระบุรถ (ตัวเลือก ก) · ส่วนที่ 9 แสดงค่าเดิมอ่านอย่างเดียว · จุดจอดรถไม่ต้องมีพิกัด · Q3 ต้องการแสดงหน้า public (CR แยก) · Q4 ไม่ทำ sheet · วิธีติดตาม = แก้ไฟล์ CR นี้ใน PR #1374
- 2026-11-13 — owner สั่ง Q3: ไม่แยก CR แสดงผลหน้า public ทำใน CR นี้เลย · หมุดในหน้าค้นหาศูนย์พักพิงใช้ไอคอนที่จอดรถ · ช่องรายละเอียดของจุดจอดรถคงเดิม: ชื่อ หมายเหตุ พิกัด ประเภทรถ+ความจุ (หมายเหตุเป็นช่องข้อความอิสระ)
- 2026-11-13 — owner ตอบ Q7: แสดงหมุดจุดจอดรถของทุกศูนย์พร้อมกันบนหน้าค้นหา · เพิ่ม `parking_points` ใน list response ของ FastAPI

- 2026-11-13 — owner สั่ง: ต่อสายตัวกรองที่จอดรถบนหน้า `/shelters` ใน CR นี้ (Q8) · ตรวจพบก่อนหน้านี้ว่า checkbox ไม่ได้ต่อกับข้อมูลจริง
- 2026-11-13 — owner เลือก Q6 ตัวเลือก 1: ตัวกรองเลิกเดาจากเลขรวม · เรื่อง import บังคับระบุประเภทรถแยกเป็น CR ต่างหาก
