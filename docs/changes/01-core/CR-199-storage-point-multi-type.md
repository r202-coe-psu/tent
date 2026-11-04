---
id: CR-199
title: "จุดเก็บของในศูนย์ — ประเภทอาหาร/ของที่เก็บได้เป็น multiple select + แสดงในตัวเลือกสถานที่จัดเก็บและหน้าคลัง"
status: approved
date: 2026-10-19
updated: 2026-10-26
requested_by: "feedback หน้างาน (ที่เก็บศูนย์อาหาร ข้อ 4.1) — issue #647"
decided_by: kong — approved 2026-10-26
layer: volatile
affects:
  - docs/data/schema.md §3.1 (`shelter.common_areas.sub_storage[]`, schema_v 7 → 8)
  - frontend/src/lib/features/shelters/domain/schema.ts (`subStorageTypeSchema`, `subStorageItemSchema`)
  - frontend/src/lib/features/shelters/domain/storage-points.ts (`SUB_STORAGE_TYPE_LABELS`, `sortSubStorageTypes`, `subStorageTypeLabels`)
  - frontend/src/lib/features/shelters/ui/storage-points-section.svelte
  - frontend/src/lib/features/operations/domain/lot-storage.ts (`StoragePointRef.typeLabels`)
  - frontend/src/lib/features/operations/application/use-storage-points.svelte.ts
  - frontend/src/lib/features/operations/ui/storage-point-select.svelte
  - frontend/src/lib/features/operations/ui/stock-table.svelte + ui/stock/stock-view.ts + ui/stock/stock-filters.svelte (filter "ที่เก็บ")
  - frontend/src/lib/features/operations/ui/item-detail-sheet.svelte + ui/stock/lot-view.ts (ประเภทใต้ล็อต)
  - frontend/src/lib/features/shelter-import/domain/{columns,import-row}.ts
why: >
  field feedback หน้างาน (ที่เก็บศูนย์อาหาร ข้อ 4.1): จุดเก็บของหนึ่งจุดเก็บของได้มากกว่าหนึ่งประเภท
  จริง (เช่น ทั้งอาหารแห้งและน้ำดื่มในที่เดียว) แต่ schema ปัจจุบันบังคับ single select ทำให้บันทึกได้
  ไม่ตรงสภาพจริง และตอนรับของเข้าคลังผู้ใช้ไม่เห็นว่าจุดเก็บแต่ละจุดเก็บอะไรได้
migration: >
  schema_v shelter 7 → 8 — `common_areas.sub_storage[].type` (single enum) → `.types` (array ของ
  enum เดิม, min 1). Backward-compat: อ่าน doc เดิมที่ยังมี `type` เดี่ยว → map เป็น `types: [type]`
  แบบ deterministic ตอน read (เหมือนแนวทาง `legacy-<index>` ของ CR-139), แล้ว persist ทับตอนบันทึก
  ครั้งถัดไป — **ไม่มี batch migration script แยก** (เจ้าของโครงการ confirm read-time fallback
  พอ 2026-10-19). key enum เดิมทั้ง 4 ตัว (`general`, `food_dry`, `drinking_water`,
  `medical_supplies`) คงไว้ไม่เปลี่ยน (เปลี่ยนแค่ label ของ `medical_supplies` เป็น "ยา") — ไม่ต้อง
  remap ข้อมูลเก่า
---

# จุดเก็บของในศูนย์ — ประเภทอาหาร/ของที่เก็บได้เป็น multiple select + แสดงในตัวเลือกสถานที่จัดเก็บและหน้าคลัง

> **สรุป:** `shelter.common_areas.sub_storage[].type` (เลือกได้ 1) → `.types[]` (เลือกได้หลายค่า,
> min 1, enum 4 → 7) · ฟอร์มศูนย์เลือกประเภทแบบ multi-select เรียงตาม enum · ตัวเลือก "สถานที่จัดเก็บ"
> ในฟอร์มสต็อกแสดงประเภทของแต่ละจุด · หน้าคลังแสดงประเภทใน filter "ที่เก็บ" และใต้ล็อตในรายละเอียด
> สินค้า (ไม่มีแท็บแยก) · shelter schema_v 7 → 8 (read-time fallback, ไม่มี batch
> migration) · ไม่กระทบ worker / public plane

## Why

หน้างานจริงพบว่าจุดเก็บของหนึ่งจุด (เช่น ห้องเก็บของกลาง) เก็บของได้หลายประเภทพร้อมกัน แต่ฟอร์ม
ศูนย์บังคับเลือกได้ประเภทเดียว (`common_areas.sub_storage[].type` เป็น single-select enum) ทำให้
ข้อมูลที่บันทึกไม่สะท้อนสภาพจริง และตอนรับของเข้าคลัง ตัวเลือก "สถานที่จัดเก็บ" แสดงแค่ชื่อจุด
ผู้ใช้จึงไม่รู้ว่าจุดไหนเก็บอะไรได้ ที่มา: feedback หน้างาน (ที่เก็บศูนย์อาหาร ข้อ 4.1) —
[issue #647](https://github.com/r202-coe-psu/tent/issues/647)

## Change

- **enum ใหม่ 7 ค่า** (เรียงตามลำดับที่ต้องแสดงในทุกหน้าจอ):

  | ลำดับ | label | key | ข้อมูลเดิม |
  | --- | --- | --- | --- |
  | 1 | ทั่วไป | `general` | = `general` เดิม |
  | 2 | อาหารเด็ก | `baby_food` | ใหม่ |
  | 3 | อาหารแห้ง | `food_dry` | = `food_dry` เดิม |
  | 4 | อาหารปรุงสุก | `cooked_food` | ใหม่ |
  | 5 | อาหารแช่เย็น/แข็ง | `food_cold` | ใหม่ |
  | 6 | ยา | `medical_supplies` | = `medical_supplies` เดิม (label เปลี่ยนจาก "เวชภัณฑ์" → "ยา") |
  | 7 | น้ำดื่ม | `drinking_water` | = `drinking_water` เดิม |

- **shape**: `sub_storage[].type` (single enum, required) → `sub_storage[].types` (`string[]`,
  min 1, ค่าตาม enum ใหม่) — before → after:
  - Before: `{ id, name, type: 'food_dry', area_m2 }`
  - After: `{ id, name, types: ['food_dry', 'drinking_water'], area_m2 }`
- **worker projector**: ตรวจแล้ว — ไม่มี projector ใด project `common_areas`/`sub_storage` ออก
  Mongo/public (`worker/src/worker/projectors/shelter.py` project แค่ status/capacity/address)
  ⇒ ไม่กระทบ public plane, ไม่ต้อง bump `PROJECTION_VERSION`

## Requirements

**ฟอร์มศูนย์ — ส่วน "จุดเก็บของ"** (`storage-points-section.svelte`)

- FR-1 — ช่องประเภทของจุดเก็บเป็น multi-select (shadcn `ToggleGroup type="multiple"`) แสดง choice
  ครบ 7 ค่าตามลำดับในตาราง §Change
- FR-2 — ค่า `types` ที่บันทึกต้องเรียงตามลำดับ enum เสมอ ไม่ใช่ลำดับที่ผู้ใช้กด
- FR-3 — เอาประเภทสุดท้ายที่เหลือออกไม่ได้: ประเภทนั้นยังถูกเลือกอยู่ และแสดง toast
  "ต้องเลือกอย่างน้อย 1 ประเภท"
- FR-4 — จุดเก็บที่เพิ่มใหม่เริ่มต้นด้วย `types: []` (ไม่เลือกประเภทไว้ให้); การบันทึกฟอร์มที่มีจุด
  เก็บไม่มีประเภทต้องไม่ผ่าน validation (min 1)

**ตัวเลือก "สถานที่จัดเก็บ" ในฟอร์มสต็อก** (`storage-point-select.svelte` — รับเข้า, ปรับปรุง,
นับสต็อก, รับบริจาค, รับของจากครัว)

- FR-5 — แต่ละตัวเลือกแสดงชื่อจุด และบรรทัดรองแสดง label ของประเภทที่เก็บได้ เรียงตามลำดับ enum
  (เช่น `📍 เก็บอาหารที่1` / `อาหารเด็ก, อาหารแช่เย็น/แข็ง, น้ำดื่ม`)
- FR-6 — ค่าที่เขียนลง `stock_ledger.lot` ไม่เปลี่ยน (`storage_point_id` + `storage_zone`) — ประเภท
  เป็นข้อมูลแสดงผลเท่านั้น ไม่ถูกบันทึกลง ledger

**filter "ที่เก็บ" ในแท็บสต็อก** (`stock-table.svelte`, `stock/stock-view.ts`)

- FR-7 — ตัวเลือกเรียงเป็น: จุดเก็บที่ตั้งค่าไว้ในศูนย์ (รวมจุดที่ยังไม่เคยรับของ) → ชื่อที่พบเฉพาะใน
  ledger (จุดที่ถูกลบ / ข้อมูลเก่า) ไม่ซ้ำ → "คลังหลัก"
- FR-8 — ตัวเลือก "คลังหลัก" (URL `?loc=main`) กรองเฉพาะรายการที่มีล็อตไม่ได้ระบุที่เก็บ

**หน้าคลัง — แสดงประเภทที่เก็บได้** (AC3 ของ #647; ไม่มีแท็บแยก — ดู Decision 2)

- FR-11 — ตัวเลือกของ filter "ที่เก็บ" ที่เป็นจุดเก็บที่ตั้งค่าไว้ แสดงบรรทัดรองเป็น label ของประเภทที่เก็บได้
  เรียงตามลำดับ enum (แบบเดียวกับ FR-5); ชื่อที่พบเฉพาะใน ledger และ "คลังหลัก" ไม่มีบรรทัดรอง
- FR-12 — ในรายละเอียดสินค้า (item detail) ล็อตที่อยู่ในจุดเก็บที่ตั้งค่าไว้ แสดงบรรทัด
  "เก็บได้: <label, …>" ของจุดนั้น; ล็อตที่ไม่ระบุที่เก็บ หรือจุดถูกลบไปแล้ว ไม่แสดงบรรทัดนี้

**import ข้อมูลศูนย์** (`shelter-import`)

- FR-9 — template รับประเภทใหม่ทั้ง 7 ค่า (ยังเป็นหนึ่งประเภทต่อจุดในหนึ่งเซลล์ — import เป็น
  `types: [type]`)
- FR-10 — รับ label เดิม "เวชภัณฑ์" เป็น alias ของ `medical_supplies` เพื่อให้ไฟล์ที่กรอกไว้ก่อนเปลี่ยน
  label ยัง import ได้

## Acceptance

- เลือก น้ำดื่ม → ทั่วไป → อาหารเด็ก แล้วบันทึก → doc เก็บ `['general', 'baby_food', 'drinking_water']`
- กดเอาประเภทเดียวที่เหลือออก → ประเภทนั้นยังถูกเลือก + toast ขึ้น
- เพิ่มจุดเก็บใหม่แล้วกดบันทึกโดยไม่เลือกประเภท → validation แจ้ง "เลือกอย่างน้อย 1 ประเภท"
- เปิด doc ศูนย์ schema_v 7 ที่มี `type: 'food_dry'` → ฟอร์มแสดง "อาหารแห้ง" ถูกเลือก; บันทึกแล้ว
  doc เป็น `types: ['food_dry']` และ schema_v 8
- ตัวเลือกสถานที่จัดเก็บแสดงบรรทัดประเภทใต้ชื่อจุด
- ศูนย์ที่ตั้งค่าจุดเก็บแต่ยังไม่เคยรับของ → filter "ที่เก็บ" มีจุดนั้น + "คลังหลัก"
- หน้าคลัง → เปิด filter "ที่เก็บ" → จุดเก็บที่ตั้งค่าไว้มีบรรทัดประเภทใต้ชื่อ
- หน้าคลัง → เปิดรายละเอียดสินค้าที่มีล็อตในจุดเก็บ → ใต้ล็อตมี "เก็บได้: อาหารแห้ง, น้ำดื่ม" (ตามประเภทของจุด)
- import แถวที่ประเภทเป็น "เวชภัณฑ์" → ได้ `types: ['medical_supplies']` ไม่ error

## Impact

- `docs/data/schema.md` §3.1 — `shelter.common_areas.sub_storage[]`: schema_v 7 → 8
- `shelters/domain/schema.ts` — `subStorageTypeSchema` (เพิ่ม 3 enum), `subStorageItemSchema`
  (`type` → `types: z.array(...).min(1)`), migrate v7 → v8
- `shelters/domain/storage-points.ts` — `SUB_STORAGE_TYPE_LABELS` (label ใหม่ 3 ตัว + เปลี่ยน label
  `medical_supplies`), `sortSubStorageTypes`, `subStorageTypeLabels`
- `shelters/ui/storage-points-section.svelte` — multi-select UI (FR-1 – FR-4)
- `operations` — `StoragePointRef.typeLabels`, `useStoragePoints`, `storage-point-select.svelte`
  (FR-5), `locationOptions` + `MAIN_STORE_LOCATION` ใน `stock-view.ts` (FR-7, FR-8, FR-11),
  `stock-filters.svelte` (FR-11), `buildLotRows` ใน `lot-view.ts` + `item-detail-sheet.svelte` (FR-12)
- `shelter-import` — choice ใหม่ + alias "เวชภัณฑ์" (FR-9, FR-10)
- `src/lib/components/ui/toggle`, `toggle-group` — vendored shadcn-svelte (ใหม่)
- หน้าคลัง `back-office/supply/+page.svelte` — **ไม่เปลี่ยน** (ไม่มีแท็บใหม่; ประเภทแสดงในแท็บสต็อกเดิม —
  ดู Decision 2)
- ไม่กระทบ worker/public plane — ยืนยันแล้วว่าไม่มี projector project `common_areas`

## Migration

schema_v shelter 7 → 8, additive-ish แต่เปลี่ยน shape ของ field เดิม (ไม่ใช่แค่เพิ่ม field ใหม่):

- doc เดิมที่มี `sub_storage[].type` (เดี่ยว) → ตอน **read** แปลงเป็น `types: [type]` แบบ
  deterministic (เหมือนแนวทาง `legacy-<index>` back-fill ของ [CR-139](00-baseline/CR-139-shelter-storage-points.md))
- ตอน **write** ครั้งถัดไป persist เป็น `types[]` ทับของเดิม — **ไม่มี batch migration script
  แยก** (ต่างจาก CR-139 ที่ต้องรัน `pnpm migrate:shelter --write --confirm` เพราะ CR-139 เติม `id`
  ที่ไม่มีค่า default ที่ derive ได้ฝั่ง read ส่วนที่นี่ derive ได้ตรงไปตรงมาจาก `type` เดิม) —
  confirmed โดยเจ้าของโครงการ 2026-10-19: read-time fallback + persist-on-save พอ
- key enum เดิมทั้ง 4 ตัวไม่เปลี่ยนความหมาย ไม่ต้อง remap ค่า — เปลี่ยนแค่ label แสดงผลของ
  `medical_supplies`
- FR-4 (default `[]`) กระทบเฉพาะจุดเก็บที่เพิ่มใหม่ในฟอร์ม ไม่กระทบ doc ที่บันทึกแล้ว

## Decisions

1. **Migration** (resolved 2026-10-19): read-time fallback พอ ไม่ต้องมี batch script (ดู §Migration)
2. **การแสดงประเภทในฝั่งคลัง** (revised 2026-10-26 — เดิม resolved 2026-10-19): เดิมเพิ่มแท็บ
   "จุดเก็บของ" ในหน้าคลัง เป็นตารางชื่อ / พื้นที่ / ประเภท (badge/chip) — **ตัดออก** ตามรีวิว PR #756
   (ตารางดูอย่างเดียว ซ้ำกับฟอร์มศูนย์ และไม่ได้ใช้ตอนทำงานจริง) แสดงประเภทในตัวเลือก
   "สถานที่จัดเก็บ" แทน (FR-5) ซึ่งเป็นจุดที่ผู้ใช้ต้องตัดสินใจว่าจะเก็บของไว้ที่ไหน
   และ (2026-10-26) ตอบ AC3 ของ #647 ("หน้าคลังแสดงประเภทที่เก็บได้") ภายในแท็บสต็อกเดิม: filter
   "ที่เก็บ" (FR-11) และใต้ล็อตในรายละเอียดสินค้า (FR-12) — ไม่มีตารางหรือแท็บแยก
   — เคาะ (kong, 2026-10-26): FR-5 + FR-11 + FR-12 (ไม่มีแท็บแยก) ถือว่าตอบ AC3 ของ #647 แทนตาราง
   ในหน้าคลังของ Decision 2 เดิม
3. **worker projector** (resolved 2026-10-19): ตรวจแล้ว ไม่มีผลกระทบ (ไม่มี projector export `common_areas`)
4. **ค่าเริ่มต้นของจุดเก็บใหม่** (resolved 2026-10-26): `types: []` แทน `['general']` (FR-4) — QA พบว่า
   ต้องกดเอา "ทั่วไป" ออกเกือบทุกครั้ง; validation min 1 จับตอนบันทึก — เคาะ (kong, 2026-10-26)

## Decision log

- 2026-10-19 — proposed (draft)
- 2026-10-19 — เจ้าของโครงการ confirm Decision 1 (read-time fallback) และ Decision 2 เดิม (ตารางในหน้าคลัง)
- 2026-10-24 — รีวิว PR #756 (fishcanwalk): ขอตัดแท็บ "จุดเก็บของ" ในหน้าคลัง, แสดงประเภทในตัวเลือก
  สถานที่จัดเก็บ, filter "ที่เก็บ" ต้องมีจุดเก็บที่ตั้งค่าไว้, เรียง `types` ตาม enum, รับ "เวชภัณฑ์"
  เป็น alias ตอน import; ชี้ว่า PR ใส่ index row `CR-175` ซึ่งชนกับ CR อื่นและไฟล์ยังเป็น draft
- 2026-10-26 — ปรับ draft ให้ตรงกับ implementation หลังรีวิว (FR-1 – FR-10, Decision 2 revised,
  Decision 4 ใหม่); ถอดแถว `CR-175` ออกจาก `_index.md` และให้ `schema.md` + code อ้างด้วย slug
  `draft-storage-point-multi-type` จนกว่าจะ approve และได้เลข CR
- 2026-10-26 — ทำ AC3 ของ #647 ในแท็บสต็อกเดิม: เพิ่ม FR-11 (ประเภทในตัวเลือก filter "ที่เก็บ") และ
  FR-12 (ประเภทใต้ล็อตในรายละเอียดสินค้า); ปรับ Decision 2 และ `[NEEDS DECISION]` ให้ครอบคลุม FR-11/12
- 2026-10-26 — approved โดย kong: รันเลข CR-199 (ย้ายเป็น `01-core/CR-199-storage-point-multi-type.md`),
  เคาะ Decision 2 (ไม่มีแท็บแยก ตอบ AC3) และ Decision 4 (FR-4 ค่าเริ่มต้น `types: []`); `schema.md` + code อ้าง CR-199
