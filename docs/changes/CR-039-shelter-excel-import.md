---
id: CR-039
title: Import ศูนย์พักพิงจาก Excel — download template + upload/validate + shelter_import_log doc type
status: proposed        # proposed | approved | done | rejected | superseded
date: 2026-07-14
requested_by: Dev Team-B
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/schema.md §3.7 (new — shelter_import_log)
  - schema_v shelter_import_log 1 (new doc type; ไม่แตะ shelter schema_v)
  - frontend/src/lib/features/shelter-import/ (new feature slice)
  - frontend/src/routes/(protected)/shelters/import/+page.svelte (new route, requireAdmin)
  - frontend/src/lib/features/shelters/index.ts (reuse createShelter — ไม่ขยาย barrel)
  - frontend/package.json (add dep: exceljs)
  - frontend/CONVENTIONS.md / task-breakdown (ถ้าต้อง cross-ref task ใหม่)
---

# CR-039 — Import ศูนย์พักพิงจาก Excel

## Why
- ปัจจุบันสร้างศูนย์พักพิงได้ทีละแห่งผ่านฟอร์ม (`POST /api/back-office/shelter`) เท่านั้น. onboarding
  หลายศูนย์พร้อมกัน (เช่น setup พื้นที่ใหม่) ทำด้วยมือช้าและ error-prone.
- เจ้าของโครงการต้องการให้ system_admin กรอกข้อมูลศูนย์เป็นชุดใน Excel แล้ว import เข้าระบบ พร้อม
  validate ตาม schema และเห็น error รายช่องก่อน commit.
- ต้องมีร่องรอย (audit) ว่า import batch ไหนสำเร็จ/ล้มเหลวอย่างไร → doc type ใหม่สำหรับเก็บ log.

## Change

### 1. Feature ใหม่ `shelter-import` (before → after)
- **before:** ไม่มีทาง import shelter เป็นชุด; ไม่มี template.
- **after:** feature slice ใหม่ `src/lib/features/shelter-import/` (4 layer ตาม CONTRIBUTING §feature-slicing)
  + route `(protected)/shelters/import/+page.svelte` (guard `requireAdmin` — endpoint create เป็น SA-only อยู่แล้ว).
  - **domain/** — column map (header TH ↔ field ↔ enum), `mapRowToShelter()` + `validateRow()` (pure,
    ใช้ `shelterSchema` จาก `$lib/features/shelters`), `shelterImportLogSchema` + factory + guard.
  - **data/** — `template.ts` (สร้าง `.xlsx` ด้วย exceljs พร้อม dropdown), `parse.ts` (อ่าน `.xlsx`),
    `import-log.remote.ts` (เขียน log doc ลง `registry`), reuse `createShelter()` จาก shelters barrel.
  - **application/** — `useDownloadTemplate`, `useImportShelters` (mutation), `useImportLogs`
    (query + `startShelterImportLiveQuery` invalidate จาก changes feed — ไม่ poll).
  - **ui/** — หน้า import: dropzone, preview table (สถานะราย row + error ราย field), สรุปผล, ปุ่ม
    download template, ส่วน "ประวัติการนำเข้า".

### 2. Field mapping — 19 คอลัมน์ Excel → `shelterSchema`
ทุก field อ้าง `shelterSchema` (features/shelters/domain/schema.ts) — CR นี้ **ไม่แก้** shelter schema.

| # | คอลัมน์ Excel (TH) | field | ชนิด | บังคับ | enum choices (value=label) |
|---|---|---|---|---|---|
| 1 | ชื่อศูนย์พักพิง | `name` | string | ✅ | — |
| 2 | สถานะ | `operation_status` | enum (default `standby`) | — | standby=เตรียมพร้อม · active=เปิดรับผู้อพยพ · full_capacity=เต็มความจุ · closed=ปิด |
| 3 | ระดับโครงการ | `project_level` | enum | — | community=ระดับชุมชน · lao=ระดับ อปท. · provincial=ระดับเมือง/จังหวัด |
| 4 | ที่อยู่ตามเขตการปกครอง | `location.address` | string | — | — |
| 5 | ละติจูด | `location.lat` | number (-90..90) | — | — |
| 6 | ลองจิจูด | `location.lng` | number (-180..180) | — | — |
| 7 | โซนเทศบาล | `municipality_zone` | string (master_data code) | — | dropdown จาก `master_data:municipality_zone` (label→code) |
| 8 | ชุมชน | `community` | string (master_data code) | — | dropdown จาก `master_data:community` (label→code) |
| 9 | บ้านเลขที่ | `address_no` | string | — | — |
| 10 | หมู่ที่ | `village_no` | string | — | — |
| 11 | จังหวัด | `province` | string | — | — |
| 12 | อำเภอ/เขต | `district` | string | — | — |
| 13 | ตำบล/แขวง | `subdistrict` | string | — | — |
| 14 | รหัสไปรษณีย์ | `postal_code` | string | — | — |
| 15 | ผู้จัดการศูนย์ | `contact.name` | string | — | — |
| 16 | เบอร์โทรผู้จัดการศูนย์ | `contact.phone` | string | — | — |
| 17 | ความจุสูงสุด (คน) | `capacity` | int > 0 | ✅ | — |
| 18 | พื้นที่ใช้สอยรวม (ตร.ม.) | `area_m2` | number ≥ 0 | — | — |
| 19 | สถานะพื้นที่อาคาร | `area_type` | enum | — | indoor=อาคารปิด · outdoor=ลานเปิด · hybrid=แบบผสม |

- field ที่ไม่มีใน Excel แต่ `shelterSchema` บังคับ (object `facilities`/`common_areas`/`utilities`/`risk`,
  array `zones`) → importer เติม default (`{}` / `[]`) — inner field ทั้งหมด nullish จึง `parse()` ผ่าน.
  ศูนย์ที่ import จะมี `zones: []` และไป config เพิ่มในฟอร์มภายหลัง.
- decision (owner 2026-07-14): คอลัมน์ 7–8 **dropdown label → resolve เป็น code** ก่อน validate;
  label ที่ไม่อยู่ใน master_data = error รายช่อง.

### 3. Doc type ใหม่ `shelter_import_log` (schema_v 1) — registry
- decision (owner 2026-07-14): เก็บใน `registry` db เดิม (envelope กลางแบบ `master_data` — **ไม่มี**
  `shelter_code`), `_id = import_log:{ulid}`, `type: 'shelter_import_log'`, `schema_v: 1`.
- ฟิลด์:
  - `source: 'shelter'`
  - `filename: string`
  - `imported_by: string` (จาก authStore)
  - `total_rows`, `success_count`, `error_count`: number
  - `results: Array<{ row: number; name: string | null; status: 'created' | 'validation_error' | 'server_error'; code?: string; errors?: Array<{ column: string; message: string }> }>`
  - `started_at`, `finished_at`: string (ISO) — envelope ให้ `created_at`/`updated_at`

### 4. Import/commit behaviour
- validate ราย row → เก็บ error `{ row, column: <TH header>, message: <ข้อความ Zod ไทย> }`.
- commit เฉพาะ row valid → ยิง `POST /api/back-office/shelter` **แบบ sequential** (endpoint mint code
  ด้วย `max(SHxxx)+1` จึงห้ามยิงขนาน) → เก็บผลราย row.
- หลังเสร็จเขียน `shelter_import_log` 1 doc/batch + invalidate `sheltersKeys`.
- partial success: ไม่ rollback อัตโนมัติ — บันทึกผลใน log.

### 5. Dependency
- เพิ่ม `exceljs` (pnpm) — เขียน data-validation dropdown ใน template ได้ (SheetJS community ทำไม่ได้)
  และอ่าน `.xlsx`. เป็น dep เดียวที่เพิ่ม.

## Impact
- **docs:** `docs/data/schema.md` เพิ่ม §3.7 `shelter_import_log` (registry doc type ใหม่) + ลง §7
  validation ถ้าจำเป็น; `docs/changes/_index.md` เพิ่มแถว CR-039.
- **code (new):** `features/shelter-import/**` (domain/data/application/ui + index.ts),
  `routes/(protected)/shelters/import/+page.svelte`, register `startShelterImportLiveQuery` ใน
  `routes/+layout.svelte`.
- **code (touch):** `package.json` (+ exceljs). ไม่แก้ `features/shelters/*` (reuse ผ่าน barrel).
- **tests:** unit test สำหรับ column-mapping + row-validation (รวม enum label→code, required-field,
  ค่านอกช่วง lat/lng) + import-log factory/guard.
- **ไม่กระทบ:** shelter schema_v (คงที่ 4), envelope กลาง, auth/sync priority, layer boundary.

## Migration
- ไม่ bump shelter schema_v. `shelter_import_log` เป็น doc type ใหม่ (schema_v 1) — ไม่มี doc เดิมให้
  migrate → **N/A**. Append-only log; ไม่มี back-fill.

## Open decisions (ตัดสินแล้ว 2026-07-14)
1. โซนเทศบาล/ชุมชน (คอลัมน์ 7–8) → **dropdown label → resolve เป็น code**.
2. ที่เก็บ `shelter_import_log` → **registry db เดิม**.
3. Excel library → **exceljs**.
4. วิธี track → **CR file** (เอกสารนี้).

## Decision log
- 2026-07-14 — proposed (รอเจ้าของโครงการเคาะก่อนแตะ schema.md + เขียน code)
