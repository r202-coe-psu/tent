---
id: CR-019
title: "Master Data Phase 2 — เพิ่ม shelter_type + wire municipality_zone/community dropdown ใน household-form"
status: approved
date: 2026-06-29
requested_by: development team B
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §3.3 — master_type enum 7→8 (เพิ่ม shelter_type)
  - frontend/src/lib/features/master-data/domain/master-data.ts — MASTER_DATA_TYPES + MasterType enum
  - frontend/src/lib/features/master-data/domain/master-data.test.ts — unit tests ใหม่
  - frontend/src/lib/components/backoffice-navbar/static.ts — เพิ่ม 2 menu items
  - frontend/src/routes/(protected)/back-office/shelter-config/ — route ใหม่
  - frontend/src/routes/(protected)/back-office/household-master-data/ — route ใหม่
  - frontend/src/lib/features/people/ui/household-form.svelte — replace static constants → live query
  - frontend/src/lib/features/people/domain/people.ts — ลบ MUNICIPALITY_ZONES + COMMUNITIES
  - frontend/src/lib/features/people/domain/people.test.ts — อัปเดต tests
---

# CR-019 — Master Data Phase 2: Shelter Type Config + Household Dropdown Wiring

## สรุป (TL;DR)

เพิ่ม `shelter_type` เป็น master_data type ที่ 8 · สร้าง 2 routes ใหม่ที่เป็น page อิสระ
(`/back-office/shelter-config`, `/back-office/household-master-data`) ภายใต้เมนู "จัดการข้อมูลหลัก" ·
แทนที่ hardcoded `MUNICIPALITY_ZONES`/`COMMUNITIES` ใน `household-form.svelte` ด้วย live query จาก `master_data` ·
ไม่มี schema_v bump (doc shape ไม่เปลี่ยน)

---

## Why

### 1. ปัญหาที่เจอ

1. **Stale static data** — `household-form.svelte` import `MUNICIPALITY_ZONES` + `COMMUNITIES` จาก
   `people.ts` (บรรทัด 563–684) แทนที่จะ query `master_data` จริง ทำให้ admin แก้ label ใน
   `/registration-config` แล้ว form ไม่สะท้อนการเปลี่ยนแปลง
2. **ไม่มี `shelter_type`** — ยังไม่สามารถ configure ประเภทศูนย์พักพิง (เช่น โรงเรียน, ศาลาประชาคม,
   อาคารราชการ) ผ่านระบบ admin UI ได้
3. **เมนูไม่ครบ** — "จัดการข้อมูลหลัก" มีเพียง "ข้อมูลบุคคล" — ไม่มีทางเข้าสำหรับ shelter และ
   household configuration โดยตรง

### 2. เหตุผลที่เปลี่ยน

- **CR-012 Phase 1** implement admin CRUD UI ที่ `/registration-config` สำหรับ 7 types เรียบร้อย
  แต่ยังไม่ wire form ใดให้ query `master_data` จริง (Phase 2 ที่ค้างอยู่)
- **CR-011** กำหนดให้ `household.municipality_zone` และ `household.community` เป็น code จาก
  `master_data` แต่ implementation ยังค้างที่ static constants
- เพิ่ม `shelter_type` เพื่อให้ admin สามารถ configure ค่าที่ใช้แสดงใน shelter-related forms ได้

---

## Change

### 3. วิธีการเปลี่ยนแปลง

#### Before
- `master_type` enum: 7 ค่า (`vulnerable_group`, `health_condition`, `dietary_restrictions`,
  `pet_types`, `house_damage`, `municipality_zone`, `community`)
- `household-form.svelte`: อ่านจาก `MUNICIPALITY_ZONES` + `COMMUNITIES` constants (static)
- เมนู "จัดการข้อมูลหลัก": 1 item ("ข้อมูลบุคคล" → `/registration-config`)
- ไม่มี route สำหรับ shelter type หรือ household area config

#### After
- `master_type` enum: 8 ค่า — เพิ่ม `shelter_type`
- `household-form.svelte`: query `master_data:municipality_zone` + `master_data:community`
  ผ่าน TanStack Query hooks จาก master-data application layer
- เมนู "จัดการข้อมูลหลัก": 3 items อิสระ:
  - "ข้อมูลบุคคล" → `/back-office/registration-config` *(เดิม, 5 types)*
  - "Shelter Config" → `/back-office/shelter-config` *(ใหม่, `shelter_type` เท่านั้น)*
  - "Household Config" → `/back-office/household-master-data` *(ใหม่, `municipality_zone` + `community`)*
- ลบ `MUNICIPALITY_ZONES` + `COMMUNITIES` constants ออกจาก `people.ts`

#### Requirements

| ID | Requirement |
|----|-------------|
| FR-017-1 | `/back-office/shelter-config` แสดง MasterDataTypeList + MasterDataItemList กรองเฉพาะ `shelter_type` (reuse UI components เดิม) |
| FR-017-2 | `/back-office/household-master-data` แสดงเฉพาะ `municipality_zone` + `community` (reuse UI components เดิม) |
| FR-017-3 | admin add/edit/delete items ได้ใน 2 routes ใหม่ผ่าน MasterDataEditModal เดิม |
| FR-017-4 | seed data `shelter_type` ≥3 ค่าเริ่มต้น พร้อม `is_default: true` สำหรับ 1 ค่า — idempotent |
| FR-017-5 | navbar "จัดการข้อมูลหลัก" มี 2 menu items ใหม่: "Shelter Config" + "Household Config" |
| FR-017-6 | `municipality_zone` dropdown ใน household-form โหลดจาก `master_data:municipality_zone` |
| FR-017-7 | `community` dropdown โหลดจาก `master_data:community` และ filter `parent_code === selectedZoneCode` |
| FR-017-8 | dropdown แสดง loading/disabled state ขณะโหลด; แสดง empty state เมื่อไม่มีข้อมูล ไม่ crash |
| FR-017-9 | ลบ `MUNICIPALITY_ZONES` + `COMMUNITIES` ออกจาก `people.ts` และ `index.ts` barrel (ถ้า export อยู่) |

---

## Impact

### 4. ไฟล์ที่ได้รับผลกระทบ

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `docs/data/schema.md §3.3` | `master_type` enum 7→8 (เพิ่ม `shelter_type`); เพิ่ม seed note |
| `docs/changes/_index.md` | เพิ่มแถว CR-018 |
| `frontend/src/lib/features/master-data/domain/master-data.ts` | เพิ่ม `shelter_type` ใน `MASTER_DATA_TYPES` + `MasterType` enum + seed items |
| `frontend/src/lib/features/master-data/domain/master-data.test.ts` | เพิ่ม test ครอบ `shelter_type` |
| `frontend/src/lib/components/backoffice-navbar/static.ts` | เพิ่ม 2 menu items ใหม่ใต้ "จัดการข้อมูลหลัก" |
| `frontend/src/routes/(protected)/back-office/shelter-config/+page.ts` | route ใหม่ (requireAdmin guard) |
| `frontend/src/routes/(protected)/back-office/shelter-config/+page.svelte` | page ใหม่ — filter `shelter_type` |
| `frontend/src/routes/(protected)/back-office/household-master-data/+page.ts` | route ใหม่ (requireAdmin guard) |
| `frontend/src/routes/(protected)/back-office/household-master-data/+page.svelte` | page ใหม่ — filter `municipality_zone` + `community` |
| `frontend/src/lib/features/people/ui/household-form.svelte` | replace static → TanStack Query |
| `frontend/src/lib/features/people/domain/people.ts` | ลบ `MUNICIPALITY_ZONES` + `COMMUNITIES` |
| `frontend/src/lib/features/people/domain/people.test.ts` | ลบ/อัปเดต test ที่อ้าง constants เดิม |

### 5. Dependency

- **master-data application layer** (`queries.ts`) ต้องมี hook สำหรับ get items by type
  — ตรวจก่อน implement household-form wiring
- **CR-012** Phase 1 ต้อง done ก่อน (ตรวจแล้ว: `/registration-config` implement แล้ว)
- **RegistrationConfigPage** ต้องรับ optional `allowedTypes?: MasterType[]` prop
  — ถ้าไม่มีต้อง extend ก่อน render ใน routes ใหม่

### 6. นอก scope ของ Mock UI ที่ได้รับ

| ส่วน | สถานะ |
|------|-------|
| Household form dropdowns (zone/community) | มีใน `person-registration-flow-spec.html` แต่เป็น static mockup — live-query เป็น implementation detail |
| shelter_type ประเภทใหม่ | ไม่มีใน mock UI spec |
| **เมนู "Shelter Config" + "Household Config"** | **ไม่มีใน mock UI spec เลย — scope ใหม่** |

---

## Migration

- **ไม่มี schema_v bump** — `master_data` doc shape ไม่เปลี่ยน (เพิ่มแค่ items ใหม่); `household`
  doc shape ไม่เปลี่ยน (`municipality_zone`/`community` เป็น `string | null` เหมือนเดิม)
- **Code mismatch (dev DB)** — Household docs เดิมที่มี `municipality_zone` = semantic slug
  (`zone_1`, `z1_c01` ฯลฯ) จาก static constants ให้ลบ/reset ได้เลย (dev DB เท่านั้น,
  ไม่มี production data) — ไม่ต้อง migration script
- seed `municipality_zone` + `community` + `shelter_type` ใช้ ULID ตาม CR-012 spec

---

## Definition of Done

### Code
- [ ] `shelter_type` อยู่ใน `MASTER_DATA_TYPES` constant และ `MasterType` enum ใน `master-data.ts`
- [ ] seed `shelter_type` ≥3 items (ULID codes) พร้อม `is_default: true` 1 ค่า — idempotent
- [ ] `/back-office/shelter-config` render ได้โดยไม่ crash — แสดงเฉพาะ `shelter_type` type card
- [ ] `/back-office/household-master-data` render ได้โดยไม่ crash — แสดงเฉพาะ `municipality_zone` + `community` type cards
- [ ] navbar "จัดการข้อมูลหลัก" มี 3 items: ข้อมูลบุคคล / Shelter Config / Household Config
- [ ] `household-form.svelte` ไม่ import `MUNICIPALITY_ZONES` / `COMMUNITIES` จาก `people.ts`
- [ ] municipality_zone dropdown โหลด items จาก `master_data` ผ่าน TanStack Query
- [ ] community dropdown filter ด้วย `parent_code === selectedZoneCode` จาก `master_data`
- [ ] dropdown แสดง disabled/skeleton ขณะ query pending; แสดง empty state เมื่อ items = []
- [ ] `MUNICIPALITY_ZONES` + `COMMUNITIES` ลบออกจาก `people.ts` และ `index.ts` barrel แล้ว
- [ ] `RegistrationConfigPage` (หรือ wrapper) รับ `allowedTypes` prop และ filter cards ได้

### Tests
- [ ] `pnpm test` ผ่าน — unit tests ใน `master-data.test.ts` ครอบ `shelter_type` type
- [ ] `people.test.ts` ไม่มี reference ถึง `MUNICIPALITY_ZONES` / `COMMUNITIES` ที่ถูกลบ
- [ ] `pnpm check` — TypeScript 0 errors
- [ ] `pnpm lint` — ผ่าน (Prettier + ESLint)

### Manual verification
- [ ] เปิด `/back-office/shelter-config` → เห็น card + default seed items ของ shelter_type
- [ ] คลิก card → เพิ่ม/แก้ไข/ลบ item ได้ผ่าน modal เดิม
- [ ] เปิด `/back-office/household-master-data` → เห็น municipality_zone + community cards เท่านั้น
- [ ] แก้ label ของ zone item ใน household-master-data → reload household form → dropdown แสดง label ใหม่
- [ ] เลือก zone → community dropdown กรองเฉพาะ community ที่มี `parent_code` ตรงกัน
- [ ] ปิด network (offline) → household form แสดง loading/empty state ไม่ throw

---

## Decision log

- 2026-06-29 — proposed (ปิด gap CR-012 Phase 2: wiring + เพิ่ม shelter_type + เมนูใหม่)
- 2026-06-29 — เลือก ULID สำหรับ seed code (ไม่ใช่ semantic slug); Household docs เดิมให้ reset
- 2026-06-29 — routes ใหม่แยกอิสระ (`/shelter-config`, `/household-master-data`) ไม่ใช้ query param บน `/registration-config`
