---
id: CR-037
title: "Thailand location reference data → CouchDB registry (province/district/subdistrict doc types, Mango-style ref)"
status: proposed
date: 2026-07-12
requested_by: development team B 
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/data/schema.md §3.4–3.6 (ใหม่) — location_province / location_district / location_subdistrict
  - schema_v location_province 1, location_district 1, location_subdistrict 1 (ใหม่)
  - docs/data/schema.md §7 — Mango index registry (provinceId, districtId)
  - frontend/src/lib/server/thailand-location.ts (เปลี่ยน source: in-memory JSON → CouchDB)
  - frontend/src/routes/api/v1/thailand-location/{provinces,districts,subdistricts}/+server.ts (คงสัญญา)
  - frontend/src/lib/features/people/ui/household-register-form.svelte (เลิก fetch static JSON)
  - frontend/static/data/thailand_location_data.json (ลดบทบาทเป็น seed source)
  - frontend/scripts/ (seed script ใหม่)
  - docs/thailand-location-couchdb-impact.md (analysis อ้างอิง)
---

# CR-037 — Thailand location reference data → CouchDB registry

> [!NOTE]
> **สรุป (TL;DR):** ย้ายข้อมูลตำบล/อำเภอ/จังหวัดไทย (~8,431 rows) จาก static JSON + in-memory
> index ฝั่ง server → เอกสารใน CouchDB `registry` เป็น 3 doc types (`location_province`,
> `location_district`, `location_subdistrict`) แบบ **MongoDB-style / Mango ref** (doc ลูกอ้าง
> `_id` พ่อผ่าน field + Mango index) · schema_v ใหม่ทั้ง 3 type = 1 · BFF `/api/v1/thailand-location/*`
> **คงสัญญาเดิม** เปลี่ยนแค่ implementation ให้ query CouchDB · dev ต้อง: เพิ่ม doc types + seed
> script + Mango index + สลับ source ฝั่ง server + รวม code path ของ household form.

## Why

- ปัจจุบันข้อมูล location ถูกใช้ **2 code path ไม่สอดคล้องกัน**: shelter form ยิง BFF
  `/api/v1/thailand-location/*` (server `import` JSON + index in-memory) ส่วน household register form
  `fetch('/data/thailand_location_data.json')` โหลดไฟล์ 1.3 MB มา filter ฝั่ง client เอง
- ภายใต้สถาปัตยกรรม **remote-first (CR-033)** ข้อมูลอ้างอิงที่ central-managed ควรอยู่ใน CouchDB
  `registry` (pull ลง device + edge fallback replica) เหมือน `master_data` / `shelter` ไม่ใช่ static
  asset ลอย ๆ นอกระบบ
- ต้องการให้ **แก้ข้อมูลตำบล/รหัสไปรษณีย์จากศูนย์กลางได้โดยไม่ redeploy** และให้ทุกฟอร์มดึงจาก
  source เดียว
- Rationale + trade-off เต็ม (bundle vs CouchDB) อยู่ใน `docs/thailand-location-couchdb-impact.md`

## Change

### 1. Doc types ใหม่ใน DB `registry` (schema.md §3.4–3.6)

รูปแบบ MongoDB-style: doc ลูกเก็บ `_id` ของพ่อเป็น field แล้ว query ผ่าน Mango index (CouchDB
query ตาม `_id` เท่านั้น — field อื่นต้องมี index ก่อน).

**§3.4 `location_province` — `location_province:{code}` · schema_v 1**

| field | type | req/opt | หมายเหตุ |
| --- | --- | --- | --- |
| `doc_type` | `"location_province"` | req | envelope §0 |
| `schema_v` | 1 | req | |
| `name` | str | req | ชื่อจังหวัด (ภาษาไทย) |

**§3.5 `location_district` — `location_district:{code}` · schema_v 1**

| field | type | req/opt | หมายเหตุ |
| --- | --- | --- | --- |
| `doc_type` | `"location_district"` | req | |
| `schema_v` | 1 | req | |
| `name` | str | req | ชื่ออำเภอ |
| `provinceId` | str | req | `_id` ของ `location_province` แม่ (foreign key) |

**§3.6 `location_subdistrict` — `location_subdistrict:{code}` · schema_v 1**

| field | type | req/opt | หมายเหตุ |
| --- | --- | --- | --- |
| `doc_type` | `"location_subdistrict"` | req | |
| `schema_v` | 1 | req | |
| `name` | str | req | ชื่อตำบล |
| `districtId` | str | req | `_id` ของ `location_district` แม่ (foreign key) |
| `zipcode` | str | req | รหัสไปรษณีย์ 5 หลัก (เก็บที่ระดับตำบล) |

- **`_id` deterministic + idempotent** — `{code}` เป็นคีย์เสถียรที่ derive จาก natural key
  (จังหวัด/จังหวัด+อำเภอ/จังหวัด+อำเภอ+ตำบล) เพื่อให้ re-seed ทับซ้ำแล้วไม่เกิด doc ซ้ำ.
  ห้ามใช้ ULID/random (ต้อง idempotent). ถ้ามี geocode ทางการ (TIS-1099) ในอนาคต ให้ migrate มาใช้แทน
- `zipcode` เปลี่ยนจาก `number` (ในไฟล์ JSON) → `str` เพื่อรักษาเลข 0 นำหน้าและให้ตรงกับ envelope
  convention (`municipality_zone`/`community` เป็น str code)

### 2. Mango index (schema.md §7, registry)

- `createIndex({ index: { fields: ['provinceId'] } })` — สำหรับ list อำเภอในจังหวัด
- `createIndex({ index: { fields: ['districtId'] } })` — สำหรับ list ตำบลในจังหวัด/อำเภอ
- provisioning ที่ CouchDB (central) ครั้งเดียว — replicate ไป edge ตามกลไก registry เดิม

### 3. Seed script

- อ่าน `frontend/static/data/thailand_location_data.json` → gen docs 3 ระดับ (dedupe จังหวัด/อำเภอ)
  → คำนวณ `_id` deterministic + set `provinceId`/`districtId` → bulk insert เข้า `registry`
- idempotent: รันซ้ำได้ (deterministic `_id` + upsert), ไม่สร้าง doc ซ้ำ
- mirror seed helper ที่มี (เช่น `frontend/src/lib/server/shelters.admin.ts`, `frontend/scripts/seed.ts`)

### 4. BFF implementation swap (สัญญา API เดิม)

- `frontend/src/lib/server/thailand-location.ts` — เปลี่ยนจาก `import` JSON + in-memory filter
  → query CouchDB `registry` ผ่าน admin client:
  - `listProvinces()` → `allDocs` prefix `location_province:` (sort by `name`)
  - `listDistricts(province)` → resolve province `_id` → `_find({ selector: { provinceId } })`
  - `listSubdistricts(province, district)` → resolve district `_id` → `_find({ selector: { districtId } })` (คืน `{ subdistrict, zipcode }`)
- `src/routes/api/v1/thailand-location/{provinces,districts,subdistricts}/+server.ts` — **คงเดิม**
  (response shape เดิม; client ไม่ต้องแก้)

### 5. รวม code path ฝั่ง client

- `frontend/src/lib/features/people/ui/household-register-form.svelte` — เลิกใช้ `getAllLocations()`
  (fetch static JSON) → ยิง `/api/v1/thailand-location/*` ผ่าน `shelters/data/thailand-location.api.ts`
  ให้ตรงกับ shelter form
- `getAllLocations()` + `static/data/thailand_location_data.json` — ลดบทบาทเหลือ seed source
  (พิจารณาย้ายไฟล์ออกจาก `static/` ให้ client ไม่ดาวน์โหลด)

## Impact

- **schema.md** — เพิ่ม §3.4–3.6 (3 doc types ใหม่) + §7 (Mango index registry)
- **schema_v** — `location_province` 1, `location_district` 1, `location_subdistrict` 1 (ทั้งหมดใหม่)
- **code (server):** `server/thailand-location.ts`, seed script ใหม่
- **code (client):** `household-register-form.svelte` (สลับ data source); `thailand-location.api.ts`
  `getAllLocations()` เลิกใช้
- **domain (ใหม่):** Zod schema + type guard ของ 3 doc types (feature ใหม่ เช่น `features/locations/`
  หรือใต้ `shelters/domain/`) + `validate_doc_update` (§8) ให้บังคับ doc types ใหม่
- **routes:** `/api/v1/thailand-location/*` implementation เปลี่ยน (สัญญาเดิม)
- **test:** `server/thailand-location.test.ts` ปรับให้ mock CouchDB แทน JSON; เพิ่ม unit test domain schema + seed idempotency
- **docs/changes/_index.md** — เพิ่มแถว CR-037

## Migration

- **doc types ใหม่ทั้งหมด (schema_v 1)** — ไม่มี persisted doc เดิมให้ย้าย (ข้อมูลเดิมเป็น static asset
  ไม่เคยอยู่ใน CouchDB)
- **Seeding เป็นขั้น provisioning:** รัน seed script เข้า `registry` (central) → replicate ไป device/edge
  ตามกลไก registry เดิม ก่อน cut-over BFF ให้ query CouchDB
- **Roll-forward เท่านั้น:** ถ้า seed ไม่ครบ BFF จะคืน list ว่าง → รัน seed script ซ้ำได้ (idempotent)
- **`zipcode` number → str:** แปลงตอน seed (`String(zipcode)`); ไม่มี consumer ที่คำนวณ zipcode เชิงตัวเลข

## Decision log
- 2026-07-12 — proposed (ร่างจาก analysis `docs/thailand-location-couchdb-impact.md`; owner เลือกแนวทาง
  B — CouchDB Mango-style — และสั่งเปิด CR)
- รอ: owner เคาะ `approved` + ยืนยันว่า track เป็น CR ไฟล์นี้เพียงพอ (ระดับรายละเอียด)
