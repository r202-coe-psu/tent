---
id: CR-006
title: "SOP profile สองชั้น — master (catalog, SA) + sop_override (shelter_*, shelter_manager); แก้ DB conflict §4.2 + เพิ่ม doc type ใหม่"
status: approved
date: 2026-06-22
requested_by: T-18 clarification round 1 (QR-1 · OQ-1) — field study / dev team
decided_by: project owner (session 2026-06-22)
layer: stable          # กระทบ sync direction + layer boundary + validate_doc_update → stable core
affects:
  - docs/data/schema.md §4.2 — `sop_profile` (master) ถอด `shelter_code`, อยู่ catalog; เพิ่ม §4.4 `sop_override`
  - schema_v sop_profile 1 → 2
  - frontend/src/lib/features/sop-ratios/domain — แยก sopMasterSchema / sopOverrideSchema + resolveEffectiveProfile()
  - frontend/src/lib/features/sop-ratios/data — factory แยก catalogDoc (master) vs makeDoc (override); seed master
  - docs/data/data-model.md — sync direction ของ master (catalog → shelter read-only)
  - docs/data/schema.md §7 — index: catalog sop_profile, shelter_* sop_override(active)
  - docs/data/schema.md §8 — validate_doc_update: master = SA only, override = shelter_code ตรง session
  - docs/task-breakdown/07-B.md — T-30 (แยก master/override CRUD + permission), T-31 (resolve override ?? master), T-32 (drill-down ระบุ source)
---

# CR-006 — SOP profile สองชั้น: master (catalog) + override (shelter_*)

## Why

`sop_profile` คือชุดอัตราส่วนมาตรฐานการดูแลผู้พักพิง (standard-of-care ratios) ที่ระบบใช้แปลง
จำนวนคนในศูนย์ → ทรัพยากรที่ต้องมี เป็นตัวเลขกลางที่ feed เข้า calc engine (T-31), dashboard gap
(T-32), และสายครัว→เบิกคลัง (`rice_g_per_person_meal` → T-25 → T-26)

**ปัญหาที่พบใน T-18 (QR-1 · OQ-1):** `sop_profile` มีความขัดกันระหว่างเอกสารกับโค้ด
- `schema.md §4.2` ระบุว่า `sop_profile` อยู่ใน `catalog` DB (central, admin ดูแล)
- domain code `frontend/src/lib/features/sop-ratios/domain/sop-ratio.ts:34` บังคับ
  `shelter_code: shelterCodeSchema` (required) → ทำให้ doc ลง `shelter_*` DB ไม่ใช่ `catalog`

ต้นเหตุจริงคือ ratio **มีสองความต้องการที่ขัดกันในตัวเดียว**: (1) เป็น master กลางที่ admin
คุมให้เป็นมาตรฐานเดียวกันทุกศูนย์ และ (2) ต้องปรับตามบริบทแต่ละศูนย์ได้ (ศูนย์เด็กเยอะ, น้ำจำกัด,
อากาศหนาว ใช้ ratio ไม่เท่ากัน) — เก็บใน doc/DB เดียวจึงตอบไม่ได้ทั้งคู่

CR นี้ยังปิด conflict ของ OQ-3 (`rice_g_per_person_meal` default: seed ค่ากลาง แต่ให้ศูนย์ปรับได้)
ไปพร้อมกัน

## Change

แยก SOP ratio เป็น **สองชั้น (master / override)** — concept หลัก: admin กลาง setting เป็น
master data, shelter manager adjust ให้เหมาะกับศูนย์ตัวเองได้อีกชั้น

### ชั้น 1 — Master (`sop_profile`, catalog DB)
- `system_admin` แก้ได้เท่านั้น; replicate ลงทุก shelter เป็น **read-only ฝั่ง shelter**
- **ถอด `shelter_code` ออกจาก master** (เป็น catalog doc กลาง ไม่ผูกศูนย์) — ใช้ `catalogDoc()` helper
- เป็นค่า default/baseline ที่ทุกศูนย์เริ่มจาก (เช่น "ปภ. มาตรฐาน 2565", "Sphere baseline")

### ชั้น 2 — Override (`sop_override`, shelter_* DB) — **doc type ใหม่**
- `shelter_manager` แก้ของศูนย์ตัวเองได้; อยู่ใน `shelter_*` (มี `shelter_code`, sync ปกติ)
- **override ทั้ง profile** (decision OQ-1 ข้อ 3): override doc เก็บ `ratios` **ครบทั้งชุด**
  ไม่ใช่ partial/per-key merge — เมื่อ active จะใช้ ratios ของ override ก้อนนั้นทั้งหมด
- **shelter set `active` ได้เอง** (decision OQ-1 ข้อ 4): shelter_manager เลือกว่าจะใช้ override
  ตัวไหนของศูนย์ตัวเอง

### Resolve rule (calc engine T-31 / dashboard T-32)
```
effective_profile =
    active sop_override ของ shelter นั้น  (ใช้ ratios ทั้งก้อน)
    ?? active sop_profile (master จาก catalog)   ← ไม่มี override = ใช้ master
```
ศูนย์ที่ยังไม่ override → inherit master อัตโนมัติ; admin อัปเดต master เมื่อใด ศูนย์ที่ไม่ override
ได้ค่าใหม่ทันทีโดยไม่ต้องตามแก้ทีละศูนย์

### Doc shape

**`sop_profile` (master · catalog · schema_v 2)** — เหมือนเดิมแต่ **ไม่มี `shelter_code`**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `name` | str | req | เช่น "ปภ. มาตรฐาน 2565", "Sphere baseline" |
| `ratios` | {key: num>0} | req | whitelist keys (ดู OQ-2 — ยังรอ PO อนุมัติ key list) |
| `version` | int | req | immutable versioning (สร้าง version ใหม่, ไม่ mutate) |
| `active` | bool | req | master active default |

**`sop_override` (shelter_* · schema_v 1) — ใหม่**

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `shelter_code` | str | req | ศูนย์ที่เป็นเจ้าของ override (ตรงกับ session) |
| `base_profile_id` | str | req | `_id` ของ master `sop_profile` ที่ override นี้อ้างอิง |
| `name` | str | req | ชื่อ override ของศูนย์ |
| `ratios` | {key: num>0} | req | **ครบทั้งชุด** (override ทั้ง profile); whitelist keys เดียวกับ master |
| `version` | int | req | immutable versioning |
| `active` | bool | req | shelter_manager set ได้เอง — active = ใช้ override นี้แทน master |

**Before → After**
- Before: `sop_profile` 1 doc type, อยู่ `catalog` ตาม §4.2 แต่ code มี `shelter_code` → ขัดกัน
- After: `sop_profile` (master, catalog, ไม่มี shelter_code, schema_v 2) + `sop_override`
  (shelter_*, doc type ใหม่, schema_v 1)

## Impact

**Docs**
- `docs/data/schema.md §4.2` — แก้ `sop_profile`: ลบ `shelter_code` ออก, ยืนยันอยู่ catalog,
  เพิ่มหมายเหตุ schema_v 2 + อ้าง CR-006
- `docs/data/schema.md §4.x` — เพิ่ม section `sop_override` (`sop_override:{ulid}`) ใน catalog/shelter
  group (อยู่ DB `shelter_*`)
- `docs/data/schema.md §7` — index: `catalog` เพิ่ม `sop_profile: active`; `shelter_*` เพิ่ม
  `sop_override: (active)`
- `docs/data/schema.md §8` — validate_doc_update: master `sop_profile` เขียนได้เฉพาะ SA;
  `sop_override` ต้องมี `shelter_code` ตรง session + role `shelter_manager`
- `docs/data/data-model.md` — sync direction: master catalog → shelter read-only (ฝั่ง shelter
  ห้ามเขียน master); override อยู่ใน shelter_* sync ปกติ
- `docs/changes/_index.md` — เพิ่มแถว CR-006

**Code** (`frontend/src/lib/features/sop-ratios/`)
- `domain/sop-ratio.ts` — แยกเป็น `sopMasterSchema` (ไม่มี `shelter_code`) + `sopOverrideSchema`
  (มี `shelter_code` + `base_profile_id`); เพิ่ม `resolveEffectiveProfile(override?, master)` คืน
  ratios ที่ใช้จริง; ปรับ `createInitialProfile`/`createNewVersion` ให้รองรับทั้งสอง type
- `data/` — factory แยก: master ใช้ `catalogDoc()` (ไม่มี shelter_code), override ใช้ `makeDoc(...ctx)`;
  seed master profile ลง `catalog`
- `domain/sop-ratio.test.ts` — เพิ่ม test: resolve (override active → ใช้ override; ไม่มี override
  → master), master ไม่มี shelter_code, override ต้องมี shelter_code + base_profile_id

**Task-breakdown** (`docs/task-breakdown/07-B.md` — Module B)
- **T-30 SOP ratio configuration (FR-44)** — เดิม DoD เป็น CRUD ratio หน้าเดียว "จำกัดสิทธิ์ตาม
  role-permission matrix" → ตอนนี้ scope แยก **2 surface**: (a) master CRUD = `system_admin`
  ที่ catalog, (b) override CRUD = `shelter_manager` ที่ shelter ตัวเอง (set active เองได้);
  seed (DoD line 52) ลง catalog master
- **T-31 calc engine (FR-45)** — เดิม "occupancy × SOP ratio (T-30)" → ต้องเรียก
  `resolveEffectiveProfile()` (override active ?? master) ก่อนคูณ; edge case (DoD line 62) เพิ่ม
  "ศูนย์ไม่มี override → fall back master"
- **T-32 dashboard (FR-46)** — drill-down (DoD line 71) ควรระบุว่าตัวเลขมาจาก master หรือ override
  ของศูนย์
- T-18 เอง: clarify ว่า seed target ของ "ตาราง SOP ratio ตั้งต้น" = catalog master (ไม่กระทบ scope/effort)
- T-42 what-if: ใช้ "ratio override" เชิง simulation อยู่แล้ว — ไม่กระทบ
- effort/MD: T-30 เพิ่มจาก 2 surface → **Raw 4→6, Adj 2.5→4**; Module B รวม Raw 28→30, Adj 20→21.5;
  grand total `task-breakdown/_index.md` 250→251.5 (applied 2026-06-22 — รอ PO/Lead ยืนยันตัวเลขใน
  workshop K-16); R3 phase Raw 16→18, Adj 10.5→12

## Migration

**schema_v sop_profile 1 → 2** (ถอด `shelter_code` ออกจาก master)
- ระบบยังไม่ deploy production / ยังไม่มี persisted `sop_profile` doc จริง (feature `sop-ratios` ยัง
  ไม่มี data path ที่เขียนจริง) → ไม่ต้อง backfill data จริง
- ถ้ามี doc ทดสอบเดิมที่มี `shelter_code`: doc ที่ตั้งใจเป็น master → ย้ายลง `catalog` + ลบ
  `shelter_code`; doc ที่ตั้งใจเป็น override → แปลงเป็น `sop_override` (เพิ่ม `base_profile_id`)
- reader ใหม่: master ที่อ่านมาแล้วยังมี `shelter_code` (schema_v 1) ให้ถือว่าเป็น legacy →
  ignore field; เขียนกลับเป็น schema_v 2 (ไม่มี `shelter_code`)

**`sop_override` (schema_v 1)** — doc type ใหม่, ไม่มี migration

## Open dependencies

- **OQ-2 (ratios canonical key list)** ยัง ⏳ รอ PO อนุมัติ — `ratios` whitelist ใน CR นี้ยังอ้าง
  3 keys เดิม (`water_l_per_person_day`, `rice_g_per_person_meal`, `toilet_per_person`); เมื่อ
  PO เคาะ key list จะตามด้วย CR แยก (bump schema_v อีกครั้ง) — โครงสร้าง master/override ของ CR-006
  ไม่ขึ้นกับจำนวน key
- **OQ-3 (rice default)** — seed master ด้วยค่ากลาง; ศูนย์ปรับผ่าน `sop_override` (CR นี้ทำให้ทำได้)

## Decision log

- 2026-06-22 — OQ-1 ตั้งคำถาม DB location ของ sop_profile (catalog vs shelter); เสนอ concept
  สองชั้น master/override
- 2026-06-22 — project owner decisions: (1) อนุมัติ doc type ใหม่ `sop_override`; (2) master อยู่
  `catalog` (SA คุม, replicate read-only); (3) **override ทั้ง profile** (ไม่ใช่ per-key merge);
  (4) **shelter set active override ได้เอง**; tracking method = CR file
- 2026-06-22 — CR-006 proposed + approved (เอกสารนี้)
- 2026-06-22 — applied to `task-breakdown/07-B.md` (T-30/T-31/T-32 DoD + effort) + `task-breakdown/_index.md`
  (Module B 20→21.5, total 250→251.5); implementation schema.md + sop-ratios code = งานถัดไป
