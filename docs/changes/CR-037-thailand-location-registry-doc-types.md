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
  - docs/data/schema.md §7 — Mango index registry (province_id, district_id)
  - frontend/src/lib/server/thailand-location.ts (เปลี่ยน source: in-memory JSON → CouchDB + write helpers SA-only)
  - frontend/src/routes/api/v1/thailand-location/{provinces,districts,subdistricts,all}/+server.ts (BFF read; `/all` ใหม่)
  - frontend/src/routes/api/back-office/thailand-location/+server.ts (BFF write SA-only — ใหม่)
  - frontend/src/lib/features/locations/ (feature ใหม่ — domain/data/application/ui + barrel)
  - frontend/src/routes/(protected)/back-office/location-config/+page.svelte (หน้า admin — ใหม่)
  - frontend/src/lib/features/people/ui/household-register-form.svelte (เลิก fetch static JSON → BFF `/all`)
  - frontend/static/data/thailand_location_data.json (ลดบทบาทเป็น seed source)
  - frontend/scripts/seed-thailand-location.ts (seed script + Mango index ใหม่)
---

# CR-037 — Thailand location reference data → CouchDB registry

> [!NOTE]
> **สรุป (TL;DR):** ย้ายข้อมูลตำบล/อำเภอ/จังหวัดไทย (~8,431 rows) จาก static JSON + in-memory
> index ฝั่ง server → เอกสารใน CouchDB `registry` เป็น 3 doc types (`location_province`,
> `location_district`, `location_subdistrict`) แบบ **MongoDB-style / Mango ref** (doc ลูกอ้าง
> `_id` พ่อผ่าน field + Mango index) · schema_v ใหม่ทั้ง 3 type = 1 · BFF read `/api/v1/thailand-location/*`
> **คงสัญญาเดิม** (+ `/all` ใหม่สำหรับ household form) เปลี่ยนแค่ implementation ให้ query CouchDB · dev ต้อง:
> เพิ่ม doc types + seed script + Mango index + สลับ source ฝั่ง server + รวม code path ของ household form ·
> **บวก management surface** (§6): write API SA-only (`/api/back-office/thailand-location`) + `LocationManager`
> UI + หน้า `/back-office/location-config` เพื่อแก้ข้อมูลจากศูนย์กลาง (สอดคล้องเป้าหมาย "แก้โดยไม่ redeploy").

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

**§3.4 `location_province` — `location_province:{province}` · schema_v 1**

| field | type | req/opt | หมายเหตุ |
| --- | --- | --- | --- |
| `type` | `"location_province"` | req | envelope §0 |
| `schema_v` | 1 | req | |
| `name` | str | req | ชื่อจังหวัด (ภาษาไทย) |

**§3.5 `location_district` — `location_district:{province}:{district}` · schema_v 1**

| field | type | req/opt | หมายเหตุ |
| --- | --- | --- | --- |
| `type` | `"location_district"` | req | envelope §0 |
| `schema_v` | 1 | req | |
| `name` | str | req | ชื่ออำเภอ |
| `province` | str | req | ชื่อจังหวัดแม่ (denormalized, immutable) |
| `province_id` | str | req | `_id` ของ `location_province` แม่ (foreign key) |

**§3.6 `location_subdistrict` — `location_subdistrict:{province}:{district}:{subdistrict}` · schema_v 1**

| field | type | req/opt | หมายเหตุ |
| --- | --- | --- | --- |
| `type` | `"location_subdistrict"` | req | envelope §0 |
| `schema_v` | 1 | req | |
| `name` | str | req | ชื่อตำบล |
| `province` | str | req | ชื่อจังหวัด (denormalized) |
| `district` | str | req | ชื่ออำเภอ (denormalized) |
| `district_id` | str | req | `_id` ของ `location_district` แม่ (foreign key) |
| `zipcode` | int | req | รหัสไปรษณีย์ 5 หลัก (lossless เป็น number) |

- **`_id` deterministic + idempotent** — เป็นคีย์เสถียรที่ derive จาก natural key path ของ
  จังหวัด/จังหวัด+อำเภอ/จังหวัด+อำเภอ+ตำบล เพื่อให้ re-seed ทับซ้ำแล้วไม่เกิด doc ซ้ำ
  (เช่น `location_district:สงขลา:หาดใหญ่`) ห้ามใช้ ULID/random
- `zipcode` ใช้ชนิดข้อมูล `int` (ตาม json file) เนื่องจากระบบรหัสไปรษณีย์ไทย 5 หลัก
  ไม่มีหลักใดขึ้นต้นด้วยเลข 0 จึงสามารถบันทึกเป็นตัวเลขได้โดยไม่สูญเสียข้อมูลนำหน้า

### 2. Mango index (schema.md §7, registry)

- `createIndex({ index: { fields: ['province_id'] } })` — สำหรับ list อำเภอในจังหวัด
- `createIndex({ index: { fields: ['district_id'] } })` — สำหรับ list ตำบลในจังหวัด/อำเภอ
- provisioning ที่ CouchDB (central) ครั้งเดียว — replicate ไป edge ตามกลไก registry เดิม

### 3. Seed script

- อ่าน `frontend/static/data/thailand_location_data.json` → gen docs 3 ระดับ (dedupe จังหวัด/อำเภอ)
  → คำนวณ `_id` deterministic + set `province_id`/`district_id` → bulk insert เข้า `registry`
- idempotent: รันซ้ำได้ (deterministic `_id` + upsert), ไม่สร้าง doc ซ้ำ
- mirror seed helper ที่มี (เช่น `frontend/src/lib/server/shelters.admin.ts`, `frontend/scripts/seed.ts`)

### 4. BFF implementation swap (สัญญา API เดิม)

- `frontend/src/lib/server/thailand-location.ts` — เปลี่ยนจาก `import` JSON + in-memory filter
  → query CouchDB `registry` ผ่าน admin client:
  - `listProvinces()` → `allDocs` prefix `location_province:` (sort by `name`)
  - `listDistricts(province)` → resolve province `_id` → `_find({ selector: { province_id } })`
  - `listSubdistricts(province, district)` → resolve district `_id` → `_find({ selector: { district_id } })` (คืน `{ subdistrict, zipcode }`)
  - `listAllLocations()` → `allDocs` prefix `location_subdistrict:` → flat records `{ province, district, subdistrict, zipcode }` (backing combined search-select ของ household form)
- `src/routes/api/v1/thailand-location/{provinces,districts,subdistricts}/+server.ts` — **คงเดิม**
  (response shape เดิม; client ไม่ต้องแก้)
- `src/routes/api/v1/thailand-location/all/+server.ts` — **ใหม่** — GET คืน flat list ทุกตำบล;
  แทนที่ไฟล์ static JSON 1.3 MB ที่ household form เคย fetch ตรง

### 5. รวม code path ฝั่ง client

- `frontend/src/lib/features/people/ui/household-register-form.svelte` — เดิม `fetch('/data/thailand_location_data.json')`
  โหลด static JSON 1.3 MB ฝั่ง client → เปลี่ยนเป็นเรียก `getAllLocations()` (ใน `shelters/data/thailand-location.api.ts`)
  ซึ่ง repoint ไปยิง BFF `/api/v1/thailand-location/all` แทน — client ไม่โหลด static JSON อีกต่อไป
- `getAllLocations()` — **คงชื่อ/สัญญาเดิมไว้** (คืน `LocationRecord[]` + cache ต่อ session) เปลี่ยนแค่ source
  เป็น BFF; เจตนา "รวม code path ให้ทุกฟอร์มดึงจาก CouchDB source เดียว" สำเร็จโดยไม่ต้องแก้ call site
- `static/data/thailand_location_data.json` — ลดบทบาทเหลือ seed source (ยังใช้โดย seed script);
  ไฟล์ยังอยู่ใน `static/` — การย้ายออกให้ client ไม่ดาวน์โหลด = follow-up (optional)

### 6. Location management surface (แก้ข้อมูลจากศูนย์กลาง — SA only)

เพื่อรองรับเป้าหมาย "แก้ข้อมูลตำบล/รหัสไปรษณีย์จากศูนย์กลางได้โดยไม่ redeploy" (Why ข้อ 3) จึงเพิ่ม
CRUD surface ครบ — **ทั้งหมด SA only** (guard `requireAdmin`), เป็น dev-server BFF (ไม่มีใน static prod build).

- **Write API** `frontend/src/routes/api/back-office/thailand-location/+server.ts` — `prerender = false`:
  - `POST` — สร้าง province / district / subdistrict (body `{ level, name, province?, district?, zipcode? }`);
    ตรวจ parent มีอยู่จริงก่อนสร้างลูก; 409 = "มีอยู่แล้ว"
  - `PATCH` — แก้ `zipcode` ของ subdistrict เท่านั้น (field เดียวที่แก้ได้; validate 5 หลัก 10000–99999)
  - `DELETE` — ลบ doc; **guarded** — province/district ที่ยังมีลูก (ผ่าน Mango `province_id`/`district_id`)
    ถูกปฏิเสธ; ลบ subdistrict ได้เสมอ; idempotent (doc หายแล้ว = ผ่าน)
- **Rename = delete + create** — เพราะ `_id` เป็น deterministic natural-key path การเปลี่ยนชื่อจึงไม่ใช่
  in-place update; UI ทำ create ใหม่ + delete เก่าแทน
- **Server helpers** (ใน `server/thailand-location.ts`, SA-only): `createProvince` / `createDistrict` /
  `createSubdistrict` / `updateSubdistrictZipcode` / `deleteLocation`
- **Feature `features/locations/`** (layered ครบ): `domain` (schemas/guards/factories/id helpers) ·
  `data/location.api.ts` (read `/api/v1/*` + write `/api/back-office/*`) · `application/queries.ts`
  (TanStack Query hooks: `useProvinces`/`useDistricts`/`useSubdistricts` + `useCreate*`/`useUpdateZipcode`/`useDeleteLocation`) ·
  `ui/location-manager.svelte` (`LocationManager`). Public barrel = จุด import เดียว
- **หน้า admin** `routes/(protected)/back-office/location-config/+page.svelte` — cascade เลือก
  จังหวัด→อำเภอ→ตำบล + แก้/ลบ; เข้าเมนู console ข้อ 8 "ข้อมูลที่อยู่ประเทศไทย"

## Impact

- **schema.md** — เพิ่ม §3.4–3.6 (3 doc types ใหม่) + §7 (Mango index registry)
- **schema_v** — `location_province` 1, `location_district` 1, `location_subdistrict` 1 (ทั้งหมดใหม่)
- **code (server):** `server/thailand-location.ts` — read (query CouchDB) + write helpers SA-only; seed script ใหม่
- **code (client):** `household-register-form.svelte` (สลับ source → BFF `/all`); `thailand-location.api.ts`
  `getAllLocations()` repoint ไป BFF (คงชื่อ)
- **feature ใหม่ `features/locations/`:** domain (Zod schema + type guards + factories + id helpers ของ 3 doc types) ·
  data · application (TanStack Query hooks) · ui (`LocationManager`) · barrel — mirror feature layering เดิม
- **routes:** `/api/v1/thailand-location/{provinces,districts,subdistricts}` (สัญญาเดิม) + `/all` (ใหม่);
  `/api/back-office/thailand-location` (write, SA-only — ใหม่); หน้า `(protected)/back-office/location-config`
- **role/permission:** write surface = **system_admin เท่านั้น** (`requireAdmin`) — reference data กลาง
- **validation:** `validate_doc_update` (§8) ให้บังคับ 3 doc types ใหม่ (provisioning ฝั่ง CouchDB `_design/app`)
- **test:** `server/thailand-location.test.ts` mock CouchDB (`adminRaw`); `features/locations/domain/location.test.ts`
  (deterministic id, dedupe, FK link, seed idempotency, type guards)
- **docs/changes/_index.md** — เพิ่มแถว CR-037

## Migration

- **doc types ใหม่ทั้งหมด (schema_v 1)** — ไม่มี persisted doc เดิมให้ย้าย (ข้อมูลเดิมเป็น static asset
  ไม่เคยอยู่ใน CouchDB)
- **Seeding เป็นขั้น provisioning:** รัน seed script เข้า `registry` (central) → replicate ไป device/edge
  ตามกลไก registry เดิม ก่อน cut-over BFF ให้ query CouchDB
- **Roll-forward เท่านั้น:** ถ้า seed ไม่ครบ BFF จะคืน list ว่าง → รัน seed script ซ้ำได้ (idempotent)
- `zipcode` เป็น integer อยู่แล้ว (ตาม static JSON) และไม่มี consumer ที่คำนวณ zipcode เชิงตัวเลข

## Decision log
- 2026-07-12 — proposed (ร่างจาก analysis `docs/thailand-location-couchdb-impact.md`; owner เลือกแนวทาง
  B — CouchDB Mango-style — และสั่งเปิด CR)
- 2026-07-13 — แก้ field discriminator ในตาราง §3.4–3.6 `doc_type` → `type` ให้ตรง envelope §0 +
  implementation (ปิด typo ที่ค้างจาก b656dbc "align CR-037 with implementation" ซึ่ง align ฟิลด์อื่น
  ครบแต่ตกแถวนี้). ไม่กระทบ code/seed
- 2026-07-13 — **ขยาย scope CR ให้ตรง implementation จริง** (develop): เพิ่ม endpoint read `/all` (§4),
  ปรับ §5 ให้ตรงว่า `getAllLocations()` ยังอยู่แต่ repoint ไป BFF, และเพิ่ม **§6 management surface**
  (write API `/api/back-office/thailand-location` SA-only + feature `features/locations/` + `LocationManager`
  + หน้า `/back-office/location-config`). เดิม CR วางเป็น read-only migration; ของจริงมี CRUD ครบ
  → เป็น API/permission surface ที่ต้อง track
- **รอ owner:** เคาะ `approved`; ยืนยันว่า (1) track เป็น CR ไฟล์นี้เพียงพอ (2) รับ scope §6 (write/admin
  surface, SA-only) เข้า CR-037 หรือแยกเป็น CR ใหม่
