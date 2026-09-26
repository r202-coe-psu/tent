---
id: CR-139
title: shelter — ตั้งค่าจุดเก็บของ (common_areas.sub_storage) เป็น master ของศูนย์ และใช้เป็นตัวเลือก "สถานที่จัดเก็บ" ในจัดการสต็อก (stock_ledger.lot.storage_point_id)
status: approved
date: 2026-09-26
requested_by: ทีม C — review หน้าจัดการสต็อก
decided_by: Kong 
layer: volatile
affects:
  - docs/data/schema.md §3.1 (schema_v shelter 6 → 7)
  - docs/data/schema.md §2.1 (schema_v stock_ledger 4 → 5)
  - frontend/src/lib/features/shelters/{domain,ui}
  - frontend/src/lib/features/shelter-import/domain
  - frontend/src/lib/features/operations/{domain,ui}
  - frontend/src/lib/features/sop-ratios/{domain,ui}
  - frontend/src/lib/features/{donations,distribution}/domain (lot input schemas)
  - frontend/src/routes/(protected)/back-office/stock-donations/components/scan-station.svelte (ทีม A รับไปทำ)
why: >
  ช่อง "สถานที่จัดเก็บ" ในจัดการสต็อกเป็นตัวเลือก Zone A/B/C ที่ hardcode ไว้ ทุกศูนย์เห็นเหมือนกัน
  ไม่ตรงกับพื้นที่จริง ขณะที่ doc shelter มีรายการคลังย่อย (`sub_storage`) อยู่แล้วแต่ไม่มีใครใช้
migration: >
  shelter 6 → 7 — back-fill `sub_storage[].id` ที่ขาดบน read แบบ deterministic (`legacy-<index>`)
  และ persist ผ่าน `pnpm migrate:shelter --write --confirm`. stock_ledger 4 → 5 — additive,
  append-only ⇒ ไม่ backfill แถวเดิม
---

# CR-139 — จุดเก็บของของศูนย์ → "สถานที่จัดเก็บ" ในจัดการสต็อก

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** `shelter.common_areas.sub_storage` (มีอยู่แล้ว) กลายเป็น **master จุดเก็บของของศูนย์**
  — แยกเป็น section "จุดเก็บของ" ในฟอร์มแก้ไขศูนย์ และ `id` บังคับมีค่า. ทุกหน้าจัดการสต็อกที่ถาม
  "สถานที่จัดเก็บ" เลือกจากรายการนี้แทน Zone A/B/C ที่ hardcode
- **เก็บลง ledger อย่างไร:** เขียน `lot.storage_zone` (ชื่อ ณ เวลาบันทึก) + field ใหม่
  `lot.storage_point_id` (→ `sub_storage[].id`). **เลิกใช้ `lot.note` เก็บสถานที่**
- **schema:** shelter `schema_v 6 → 7`, stock_ledger `schema_v 4 → 5` — additive ทั้งคู่
- **ไม่แตะ stable core** (envelope/auth/sync/layer boundary). ไม่มี worker/backend/OpenAPI change

## Requirements

### ฝั่งตั้งค่าศูนย์

- **FR-1** — ฟอร์มสร้าง/แก้ไขศูนย์มี section **"จุดเก็บของ"** แยก (nav ถัดจาก "จุดแจกอาหาร")
  สำหรับเพิ่ม/ลบรายการ `common_areas.sub_storage`: `name` (req), `type`
  (`general`/`food_dry`/`drinking_water`/`medical_supplies`), `area_m2` (opt)
- **FR-2** — ย้ายช่อง "คลังย่อยและสถานที่จัดเก็บ" ออกจาก section "โซนและสิ่งอำนวยความสะดวก" (ไม่มีช่องซ้ำสองที่)
- **FR-3** — ทุกรายการที่เขียนลง doc ต้องมี `id` ไม่ว่าง. รายการใหม่ใช้ ULID; รายการเดิมที่ไม่มี `id`
  ได้ค่า `legacy-<index>` ตอนอ่าน และถูก persist ค่านั้นเมื่อบันทึกครั้งถัดไป
- **FR-4** — นำเข้าศูนย์จาก Excel (คอลัมน์ "คลังย่อย") สร้าง ULID `id` ให้ทุกรายการ

### ฝั่งจัดการสต็อก

- **FR-5** — ช่อง "สถานที่จัดเก็บ" ในฟอร์ม **รับเข้า** และ **ปรับปรุงสต๊อก (สถานที่ใหม่)** แสดงตัวเลือก =
  จุดเก็บของของศูนย์ที่กำลังทำงาน + "ไม่ระบุ (คลังหลัก)"
- **FR-6** — เมื่อเลือกจุดเก็บของ ledger ต้องบันทึก `lot.storage_point_id = <id>` และ
  `lot.storage_zone = <name ณ เวลาบันทึก>`. เลือก "ไม่ระบุ" = ไม่ใส่ทั้งสอง field
- **FR-7** — ฟอร์มรับเข้า/ปรับปรุงไม่เขียนสถานที่ลง `lot.note` อีก
- **FR-8** — การแสดงสถานที่ของล็อต (ตารางสต็อก, ตัวกรองสถานที่, ประวัติ ledger, dropdown ล็อตตอนเบิกจ่าย/
  ปรับปรุง, ตาราง Food Sphere) ใช้ลำดับ: ชื่อปัจจุบันของ `storage_point_id` → `storage_zone` →
  `lot.note` แบบ legacy (ยกเว้นค่า system: `counter_loan_return`, `bulk_return_pool`,
  `distribution_return`) → "คลังหลัก"
- **FR-9** — การจัดกลุ่มล็อตตามสถานที่ (ปรับปรุงสต๊อก, ตัวกรองตารางสต็อก) ใช้ key เดียวกันทุกที่:
  `storage_point_id` ถ้ามี, ไม่งั้นชื่อที่ trim แล้วตาม FR-8
- **FR-10** — ศูนย์ที่ยังไม่มีจุดเก็บของ: dropdown มีแค่ "ไม่ระบุ (คลังหลัก)" + ข้อความชี้ไปตั้งค่าที่หน้าแก้ไขศูนย์
- **FR-11** — หน้าตรวจรับบริจาค (`scan-station.svelte`) ใช้ component/ helper เดียวกัน — **ทีม A รับไปทำ**
  ใน branch `team-A-donation` (กำลัง rewrite ไฟล์นี้อยู่)

## Acceptance

- AC-1 — เพิ่มจุดเก็บของ 2 จุดในศูนย์ → บันทึก → เปิดฟอร์มใหม่เห็นครบ และทุกจุดมี `id`
- AC-2 — ศูนย์ที่ doc เดิมมี `sub_storage` ไม่มี `id` เปิดฟอร์มได้, บันทึกได้, `id` = `legacy-<index>` ถูก persist
- AC-3 — รับเข้าโดยเลือกจุดเก็บ "ห้องเก็บของ 1" → แถว ledger มี `lot.storage_point_id` + `lot.storage_zone`,
  `schema_v: 5`, ไม่มีสถานที่ใน `lot.note`
- AC-4 — เปลี่ยนชื่อจุดเก็บ → ตารางสต็อกแสดงชื่อใหม่สำหรับล็อตเดิม, ตัวกรองไม่แตกเป็นสองกลุ่ม
- AC-5 — แถว ledger เดิมที่เก็บ "Zone A" ใน `lot.note` ยังแสดงสถานที่ "Zone A" และกรองได้
- AC-6 — แถวที่มี `lot.note = counter_loan_return` ไม่ถูกแสดงเป็นชื่อสถานที่
- AC-7 — Zod ปฏิเสธ `lot` ที่มี `storage_point_id` แต่ไม่มี `storage_zone`
- AC-8 — ศูนย์ที่ไม่มีจุดเก็บของ รับเข้าได้โดยเลือก "ไม่ระบุ (คลังหลัก)"

## Why

1. **ตัวเลือกไม่ตรงความจริง.** `receive-stock-form` / `adjust-stock-form` hardcode `Zone A (ของใช้ทั่วไป)`,
   `Zone B (ของที่เน่าเสียได้)`, `Zone C (ยาและเวชภัณฑ์)`; `scan-station` hardcode Zone A–F. แต่ละศูนย์มีพื้นที่
   เก็บของไม่เหมือนกัน (เช่น สนามปิงปอง, ห้องเรียน 3) — ตัวเลือกคงที่ทำให้ข้อมูลตำแหน่งของใช้ไม่ได้
2. **Master มีอยู่แล้วแต่ไม่ถูกใช้.** `common_areas.sub_storage` (CR-008/CR-023) เก็บชื่อ/ประเภท/พื้นที่คลังย่อย
   ของศูนย์ไว้แล้ว. CR-088 เพิ่ม `lot.storage_zone` เป็น free text โดยระบุว่า "ยังไม่มี master data โซน" —
   CR นี้ปิดช่องว่างนั้นด้วยการผูกสองอย่างเข้าด้วยกัน
3. **`lot.note` ถูกใช้หลายความหมาย.** ทั้งชื่อเมนู (CR-121), ค่า system (`counter_loan_return`,
   `bulk_return_pool`, `distribution_return`) และสถานที่. แยกสถานที่ไปที่ `storage_zone` ตามที่ CR-088 ออกแบบไว้
4. **ต้องมี `id`.** ถ้าอ้างด้วยชื่ออย่างเดียว การเปลี่ยนชื่อจุดเก็บจะทำให้ล็อตเดิมหลุดกลุ่ม. `storage_point_id`
   ทำให้ rename ได้โดยไม่เสียการจัดกลุ่ม ส่วน `storage_zone` เก็บชื่อ ณ เวลาบันทึกไว้เป็นหลักฐาน (append-only)

## Change

### `shelter` (§3.1) — schema_v 6 → 7

| Field | Before (v6) | After (v7) |
| --- | --- | --- |
| `common_areas.sub_storage[].id` | `str?` | `str` **req on write** — ULID (ใหม่) หรือ `legacy-<index>` (back-fill) |
| อื่น ๆ ใน `sub_storage[]` | `name`, `type`, `area_m2?` | ไม่เปลี่ยน |

### `stock_ledger.lot` (§2.1) — schema_v 4 → 5

| Field | Before (v4) | After (v5) |
| --- | --- | --- |
| `lot.storage_point_id` | ❌ | `str?` → `shelter.common_areas.sub_storage[].id` ของ `shelter_code` เดียวกัน |
| `lot.storage_zone` | free text ≤100, ไม่มี master | ชื่อจุดเก็บ ณ เวลาบันทึก (snapshot) ≤100; **บังคับมีค่าเมื่อมี `storage_point_id`** |
| `lot.note` | ชื่อเมนู / ค่า system / (โดยพฤตินัย) สถานที่ | ชื่อเมนู / ค่า system เท่านั้น — writer ใหม่ไม่เขียนสถานที่ |

### UI

| หน้า | Before | After |
| --- | --- | --- |
| แก้ไขศูนย์ | "คลังย่อยและสถานที่จัดเก็บ" ซ่อนใน "โซนและสิ่งอำนวยความสะดวก" | section "จุดเก็บของ" แยก (FR-1/2) |
| รับเข้า / ปรับปรุงสต๊อก | Zone A/B/C hardcode → `lot.note` | จุดเก็บของของศูนย์ → `storage_point_id` + `storage_zone` |
| ตารางสต็อก / ประวัติ / เบิกจ่าย / Food Sphere | แสดง `lot.note` | แสดงตาม FR-8 |

## Impact

| Area | Path |
| --- | --- |
| Shelter domain | `features/shelters/domain/schema.ts` — `subStorageItemSchema.id`, `SHELTER_MASTER_SCHEMA_V = 7`, `migrateV6ToV7`, `normalizeCurrent`, helper `listStoragePoints` |
| Shelter UI | `features/shelters/ui/storage-points-section.svelte` (ใหม่), `zones-facilities-section.svelte`, `shelter-form-page.svelte`, `shelter-form-validation.ts` |
| Shelter import | `features/shelter-import/domain/import-row.ts` |
| Operations domain | `features/operations/domain/operations.ts` — `StockLot`, `stockLotSchema`, `makeDoc('stock_ledger', 5)`, `stockLedgerDocSchema`, helpers `lotStorageKey` / `lotStorageLabel` |
| Operations UI | `receive-stock-form`, `adjust-stock-form`, `distribute-stock-form`, `stock-table`, `ledger-table`, `storage-point-select` (ใหม่) |
| อื่น ๆ | `sop-ratios` Food Sphere (แสดงผล), lot input schema ใน `donations/domain/{back-office,public-donation}.ts`, `distribution/domain/distribution.ts` |
| ไม่กระทบ | worker (ไม่อ่าน `lot`), FastAPI / OpenAPI, `validate_doc_update` (ไม่ตรวจ field ใน `lot`) |
| ทีมอื่น | `team-A-donation` — FR-11; `team-Leader-Implement-Kitchen-Ticket` แก้ `adjust-stock-form` / `stock-table` ด้วย → conflict ระดับข้อความ |

## Migration

- **shelter 6 → 7:** reader เติม `id = legacy-<index>` ให้รายการ `sub_storage` ที่ไม่มี `id` (deterministic
  — อ่านกี่ครั้งก็ได้ค่าเดิมจนกว่าจะมีการเขียน) แล้ว stamp `schema_v: 7`. เขียนใหม่ผ่านฟอร์ม = persist.
  `pnpm migrate:shelter --write --confirm` persist ให้ทุก doc. ไม่ใช้ ULID ตอนอ่านเพราะค่าจะเปลี่ยนทุกครั้งที่อ่าน
  จนกว่าจะถูกเขียน ทำให้ ledger อ้าง `id` ที่ไม่เคยลง doc ได้
- **stock_ledger 4 → 5:** additive; ledger เป็น append-only ⇒ ไม่แก้แถวเดิม. แถว v2–v4 อ่านได้ตามเดิม;
  สถานที่แบบ legacy (`lot.note` = "Zone A" ฯลฯ) แสดงผ่าน fallback ตาม FR-8

## Handoff — ทีม A: `scan-station.svelte` (FR-11)

**ถึง:** ทีม A (branch `team-A-donation`) · **ไฟล์:** `frontend/src/routes/(protected)/back-office/stock-donations/components/scan-station.svelte`

**สรุป:** หน้าตรวจรับบริจาคต้องเลิกใช้ `STORAGE_ZONE_OPTIONS` (Zone A–F ที่ hardcode) แล้วให้เลือกจากจุดเก็บของของศูนย์แทน
พร้อมบันทึก `lot.storage_point_id` + `lot.storage_zone` เหมือนฟอร์มรับเข้า/ปรับปรุงสต๊อก. ของที่ต้องใช้
export ไว้ใน barrel `$lib/features/operations` แล้ว (มีผลเมื่อ branch `feat/shelter-storage-locations` merge เข้า `develop`)

**API ที่ใช้ได้**

| Export | ใช้ทำอะไร |
| --- | --- |
| `useStoragePoints(() => shelterCode)` | คืน `{ points: StoragePointRef[]; isLoading }` — จุดเก็บของของศูนย์ (`{ id, name }`) |
| `StoragePointSelect` | dropdown สถานที่จัดเก็บ — props: `points`, `bind:value` (point id, `''` = ไม่ระบุ/คลังหลัก), `onchange(point \| null)`, `id?`, `disabled?`, `triggerProps?` |
| `storageLotFields(point \| null)` | คืน `{ storage_point_id, storage_zone }` ที่ต้องใส่ใน `lot` (หรือ `{}` เมื่อไม่ระบุ) |
| `lotStorageLabel(lot, points)` | ข้อความสถานที่สำหรับแสดงผล (fallback "คลังหลัก") |

**สิ่งที่ต้องแก้**

1. ลบ `STORAGE_ZONE_OPTIONS` และ `<Select.Root bind:value={item.storage_zone}>` เดิม → ใช้
   `<StoragePointSelect points={storagePoints.points} bind:value={item.storage_point_id} onchange={(p) => …} />`
   โดย `const storagePoints = useStoragePoints(() => getShelterCode());`
2. แต่ละ scanned item เก็บ `storage_point_id: string` (`''` = ไม่ระบุ) เพิ่มจาก `storage_zone`
3. ตอนประกอบ `lot` ให้ใช้ `...storageLotFields(point)` แทนการใส่ `storage_zone` เอง — ถ้าใส่
   `storage_point_id` โดยไม่มี `storage_zone` Zod (`stockLotSchema`) จะ reject
4. เงื่อนไขบังคับเลือกโซน (`scannedItems.every((it) => … it.storage_zone …)`) ปรับตามคำตอบ **N1**:
   ข้อเสนอคือบังคับเฉพาะเมื่อ `storagePoints.points.length > 0`
5. lot schema ฝั่ง API (`donations/domain/back-office.ts`, `public-donation.ts`) รับ `storage_point_id` แล้ว — ไม่ต้องแก้เพิ่ม

**Acceptance (ทีม A)**

- ศูนย์ที่ตั้งจุดเก็บของไว้ 2 จุด → dropdown แสดง 2 จุด + "ไม่ระบุ (คลังหลัก)"
- ตรวจรับแล้วแถว `stock_ledger` มี `lot.storage_point_id` + `lot.storage_zone`, `schema_v: 5`
- ศูนย์ที่ไม่มีจุดเก็บของ ตรวจรับได้ (ตาม N1)

**ลำดับ merge:** `feat/shelter-storage-locations` → `develop` ก่อน แล้วทีม A rebase/merge `develop` เข้า `team-A-donation` จึงเริ่มแก้

## Open decisions (Resolved)

> [DECIDED N1] หน้าตรวจรับบริจาค: บังคับเลือกจุดเก็บเมื่อศูนย์มีจุดเก็บ ≥1 และไม่บังคับเมื่อไม่มีเลย (เลือกคลังหลัก)
>
> [DECIDED N2] ลบจุดเก็บที่ยังมีของคงเหลือ: อนุญาต (ล็อตเดิมยังคงแสดงชื่อ snapshot ใน `storage_zone`)
>
> [DECIDED N3] ชื่อ section: ใช้ชื่อ **"จุดเก็บของ"**

## Decision log

- 2026-09-26 — approved โดย Kong ; กำหนดหมายเลข CR-139
- 2026-09-26 — proposed (branch `feat/shelter-storage-locations`); วิธี track = draft CR ไฟล์ + แก้ code/schema
  บน branch เดียวกัน, PM ตรวจและอนุมัติ (เจ้าของโครงการเลือก)
- 2026-09-26 — scan-station (FR-11) มอบให้ทีม A ทำใน `team-A-donation` เพื่อเลี่ยง conflict กับงาน rewrite ที่ค้างอยู่
