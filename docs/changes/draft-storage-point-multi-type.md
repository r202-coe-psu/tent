---
id: draft
title: "จุดเก็บของในศูนย์ — ประเภทอาหาร/ของที่เก็บได้เป็น multiple select + แสดงในหน้าคลัง"
status: proposed
date: 2026-10-19
requested_by: "feedback หน้างาน (ที่เก็บศูนย์อาหาร ข้อ 4.1) — issue #647"
decided_by: "TBD — รอเจ้าของโครงการเคาะ"
layer: volatile
affects:
  - docs/data/schema.md §3.1 (`shelter.common_areas.sub_storage[]`, schema_v 7 → 8)
  - frontend/src/lib/features/shelters/domain/schema.ts (`subStorageTypeSchema`, `subStorageItemSchema`)
  - frontend/src/lib/features/shelters/domain/storage-points.ts (`SUB_STORAGE_TYPE_LABELS`)
  - frontend/src/lib/features/shelters/ui/storage-points-section.svelte
  - frontend/src/routes/(protected)/back-office/supply/+page.svelte
why: >
  field feedback หน้างาน (ที่เก็บศูนย์อาหาร ข้อ 4.1): จุดเก็บของหนึ่งจุดเก็บของได้มากกว่าหนึ่งประเภท
  จริง (เช่น ทั้งอาหารแห้งและน้ำดื่มในที่เดียว) แต่ schema ปัจจุบันบังคับ single select ทำให้บันทึกได้
  ไม่ตรงสภาพจริง และหน้าคลังก็ยังไม่แสดงประเภทที่เก็บได้ของแต่ละจุดเลย
migration: >
  schema_v shelter 7 → 8 — `common_areas.sub_storage[].type` (single enum) → `.types` (array ของ
  enum เดิม, min 1). Backward-compat: อ่าน doc เดิมที่ยังมี `type` เดี่ยว → map เป็น `types: [type]`
  แบบ deterministic ตอน read (เหมือนแนวทาง `legacy-<index>` ของ CR-139), แล้ว persist ทับตอนบันทึก
  ครั้งถัดไป — **ไม่มี batch migration script แยก** (เจ้าของโครงการ confirm read-time fallback
  พอ 2026-10-19). key enum เดิมทั้ง 4 ตัว (`general`, `food_dry`, `drinking_water`,
  `medical_supplies`) คงไว้ไม่เปลี่ยน (เปลี่ยนแค่ label ของ `medical_supplies` เป็น "ยา") — ไม่ต้อง
  remap ข้อมูลเก่า
---

# จุดเก็บของในศูนย์ — ประเภทอาหาร/ของที่เก็บได้เป็น multiple select + แสดงในหน้าคลัง

## Why

หน้างานจริงพบว่าจุดเก็บของหนึ่งจุด (เช่น ห้องเก็บของกลาง) เก็บของได้หลายประเภทพร้อมกัน แต่ฟอร์ม
ศูนย์บังคับเลือกได้ประเภทเดียว (`common_areas.sub_storage[].type` เป็น single-select enum) ทำให้
ข้อมูลที่บันทึกไม่สะท้อนสภาพจริง และหน้าคลัง (`back-office/supply`) ก็ไม่ได้แสดงประเภทที่เก็บได้ของ
แต่ละจุดเลยในปัจจุบัน ที่มา: feedback หน้างาน (ที่เก็บศูนย์อาหาร ข้อ 4.1) — [issue #647](https://github.com/r202-coe-psu/tent/issues/647)

## Change

- **enum ใหม่ 7 ค่า** (เรียงตามลำดับที่ต้องแสดงทั้งฟอร์มศูนย์และหน้าคลัง):

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
- **UI ฟอร์มศูนย์** (`storage-points-section.svelte`): เปลี่ยนจาก `Select.Root type="single"` เป็น
  multi-select (checkbox group หรือ `Select.Root type="multiple"`), แสดง choice ตามลำดับในตาราง
- **หน้าคลัง** (`back-office/supply/+page.svelte`): เพิ่ม**ตารางจุดเก็บของ** ของศูนย์ — คอลัมน์
  ชื่อจุดเก็บของ, พื้นที่ (`area_m2`), ประเภทที่เก็บได้ (badge/chip หลายอัน) (ยังไม่แสดงอยู่ใน
  ปัจจุบัน — เป็นของใหม่ ไม่ใช่การแก้ของเดิม)
- **worker projector**: ตรวจแล้ว — ไม่มี projector ใด project `common_areas`/`sub_storage` ออก
  Mongo/public (`worker/src/worker/projectors/shelter.py` project แค่ status/capacity/address)
  ⇒ ไม่กระทบ public plane, ไม่ต้อง bump `PROJECTION_VERSION`

## Impact

- `docs/data/schema.md` §3.1 — `shelter.common_areas.sub_storage[]`: schema_v 7 → 8
- `frontend/src/lib/features/shelters/domain/schema.ts` — `subStorageTypeSchema` (เพิ่ม 3 enum
  ใหม่), `subStorageItemSchema` (`type` → `types: z.array(...).min(1)`)
- `frontend/src/lib/features/shelters/domain/storage-points.ts` — `SUB_STORAGE_TYPE_LABELS` เพิ่ม
  label 3 ตัวใหม่ + เปลี่ยน label `medical_supplies`
- `frontend/src/lib/features/shelters/ui/storage-points-section.svelte` — multi-select UI
- `frontend/src/routes/(protected)/back-office/supply/+page.svelte` — เพิ่มตารางจุดเก็บของ +
  ประเภท (ของใหม่)
- จุดอ่าน `sub_storage[].type` เดิมอื่นๆ (ถ้ามีนอกเหนือจาก 2 ไฟล์ข้างบน) ต้องตรวจสอบและย้ายมาอ่าน
  `types[]` แทน — ต้อง grep ซ้ำตอน implement
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

## Decisions (resolved 2026-10-19)

1. **Migration**: read-time fallback พอ ไม่ต้องมี batch script (ดู §Migration ด้านบน)
2. **UI หน้าคลัง**: ตารางจุดเก็บของ — ชื่อ, พื้นที่, ประเภทที่เก็บได้ (badge/chip หลายอัน ไม่ใช่
   filter chip)
3. **worker projector**: ตรวจแล้ว ไม่มีผลกระทบ (ไม่มี projector export `common_areas`)

## Decision log

- 2026-10-19 — proposed (draft)
