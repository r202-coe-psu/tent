---
id: CR-128
title: shelter — เพิ่ม food_distribution_points (จุดแจกอาหาร) + เปลี่ยนฟอร์มจาก 8-step wizard เป็น single-page scroll-spy
status: approved
date: 2026-09-18
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/data/schema.md §3.1
  - schema_v shelter 5 → 6
  - frontend/src/lib/features/shelters/domain
  - frontend/src/lib/features/shelters/ui
  - docs/uat/smart-shelter-uat-checklist.csv
  - docs/data/schema-er-diagram.md (SHELTER block)
why: >
  ต้องการที่เก็บ "จุดแจกอาหาร" (จุดที่มีชื่อ ระบุตำแหน่งได้) บน doc `shelter` เพื่อให้ staff
  บันทึกจุดแจกอาหารจริงในศูนย์ได้ และต้องการลดความ friction ของการสร้าง/แก้ศูนย์จากฟอร์ม
  8-step wizard เป็นฟอร์มหน้าเดียวพร้อม scroll-spy navigation
migration: >
  schema_v shelter 5 → 6 — additive; `food_distribution_points` default `[]` เติมบน read
  (lazy default-fill) และ re-stamp schema_v 6 เมื่อเขียนใหม่ผ่าน `scripts/migrate-shelter.ts`
---

# CR-128 — `food_distribution_points` + single-page shelter form

## สรุป (TL;DR)

- **เปลี่ยนอะไร (schema):** เพิ่ม `food_distribution_points` บน doc `shelter` (§3.1) — array ของ
  `{ id, name, note?, lat?, lng? }`, default `[]`, **staff-only plane** (ไม่ส่งออก FastAPI/partner API),
  ไม่ผูกกับ zone, ไม่มี feature flag
- **เปลี่ยนอะไร (UX — ไม่ใช่ schema change):** ฟอร์มสร้าง/แก้ศูนย์เปลี่ยนจาก 8-step wizard เป็น
  **single-page + scroll-spy navigation** (desktop sticky sidebar / mobile bottom dropdown).
  **บันทึกไว้เพื่อ traceability เท่านั้น — CR นี้ไม่ได้เปลี่ยนรูป doc เพราะเรื่องนี้**
- **เพื่อใคร/ทำไม:** staff บันทึกจุดแจกอาหารจริงได้; ลด friction การสร้าง/แก้ศูนย์และทำ UX ให้สอดคล้อง
  กับ unified registration
- **กระทบ schema/scope ไหน:** `schema_v shelter 5 → 6` (additive). ไม่แตะ envelope/auth/sync/layer
  boundary (stable core). ไม่มี worker/backend/OpenAPI change — ทั้ง doc ลง `public_shelters.raw_data` อยู่แล้ว

## Why

1. **จุดแจกอาหารยังไม่มีที่เก็บ.** ปัจจุบัน doc `shelter` เก็บ `zones[]`, `common_areas` (ครัวกลาง) แต่ไม่มี
   ที่ระบุ "จุดแจกอาหาร" ที่เป็นสถานที่จริงมีชื่อ (เช่น จุดแจกหน้าโรงครัว, จุดแจกโซน B) พร้อมพิกัดถ้าต้องการ
   ระบุตำแหน่ง. ต้องมี field บน `shelter` เพื่อให้ staff บันทึกได้โดยไม่สร้าง doc type ใหม่.
2. **ฟอร์ม 8-step wizard มี friction.** การสร้างศูนย์ใหม่ต้องกด Next ทีละ step, แก้ไขต้องไล่หา step,
   และ mobile navigation ไม่สอดคล้องกับ unified registration ที่ใช้ single-page + scroll-spy อยู่แล้ว.
   **ข้อเท็จจริงเพื่อ traceability:** CR-023 ไม่เคยกำหนดให้ฟอร์มเป็น wizard — มีเพียง code comment ที่ระบุ
   เป็น step. ดังนั้นการเปลี่ยน multi-step → single-page **ไม่ใช่ schema change** และบันทึกใน CR นี้
   เพื่อ traceability เท่านั้น (ไม่ใช่การแก้ spec ที่ CR-023 ล็อกไว้).

## Change

### Before → After — field

| Area | Before (schema_v 5) | After (schema_v 6) |
| --- | --- | --- |
| `food_distribution_points` | ❌ ไม่มี field | `[{ id, name, note?, lat?, lng? }]` — default `[]`; opt |
| Public/external plane | — | **ไม่เปลี่ยน** — ไม่ส่งออกผ่าน FastAPI `/public/v1/*` หรือ partner API; staff-only |
| zone linkage | — | **ไม่มี** — ไม่ผูก `zone` ใด ๆ |
| feature flag | — | **ไม่มี** — เปิดใช้เสมอเมื่อมี field |

### Field (ลง schema.md §3.1)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `food_distribution_points` | [{`id`:str, `name`:str, `note`:str\|null, `lat`:num\|null, `lng`:num\|null}] | opt | จุดแจกอาหาร; default `[]`; staff-only plane |

รายละเอียด element:

- `id` — `string` (ULID) — immutable ต่อ row
- `name` — `string` **required** (ห้ามว่าง)
- `note` — `string \| null` optional
- `lat` — `number \| null` optional, ช่วง `-90..90`
- `lng` — `number \| null` optional, ช่วง `-180..180`

### Before → After — UX (ไม่ใช่ schema change; บันทึกเพื่อ traceability)

| Area | Before | After |
| --- | --- | --- |
| โครงฟอร์ม | 8-step wizard (Next/Prev, แสดงทีละ step) | single page — 9 sections ใน `<form>` เดียว |
| Navigation (desktop) | stepper กดเปลี่ยน step | sticky sidebar + scroll-spy (click-to-scroll, error badge) |
| Navigation (mobile) | horizontal chip strip | bottom sticky dropdown (registration-style) |
| Submit | Next/Prev + Save ท้ายสุด | header Save เท่านั้น (Enter implicit submit ยังถูกบล็อก) |
| `food_distribution_points` section | — | section 4 «จุดแจกอาหาร» หลัง zones (เลข section 4–8 เดิมเลื่อนเป็น 5–9) |

> **หมายเหตุ:** ข้อ UX ทั้งหมดเป็นเรื่อง implementation/UI — ไม่เปลี่ยน field, ไม่ bump schema_v และ
> **ไม่ใช่** การแก้สิ่งที่ CR-023 กำหนด (CR-023 ไม่ได้กำหนด wizard).

## Impact

### Doc

- `docs/data/schema.md §3.1` — เพิ่มแถว `food_distribution_points`, `> **schema_v 6**` note และ
  `**Migration (schema_v 5 → 6)**`; bump `updated:` เป็น 2026-09-18
- `docs/data/schema-er-diagram.md` — SHELTER block ระบุ field ใหม่
- `docs/changes/_index.md` — เพิ่มแถว CR-128

### Code (implement ใน PR เดียวกัน — ไม่แก้ใน CR นี้)

- `frontend/src/lib/features/shelters/domain` — Zod `foodDistributionPointSchema` + เพิ่มใน `shelterSchema`
  + `ShelterMaster` + bump `SHELTER_MASTER_SCHEMA_V` 5 → 6 + `migrateV5ToV6` (idempotent default-fill `[]`)
- `frontend/src/lib/features/shelters/ui` — section «จุดแจกอาหาร» (repeatable rows, ปักหมุด dialog),
  ฟอร์ม single-page + scroll-spy nav
- `frontend/src/routes/api/back-office/shelter/+server.ts` — stamp `schema_v: 6`
- `frontend/scripts/migrate-shelter.ts` — re-stamp schema_v 6 (skip condition ต้องไม่ข้าม v5)

### Test

- `frontend/src/lib/features/shelters/domain/schema.test.ts` — default `[]`, reject `name` ว่าง,
  accept/omit lat/lng, bounds, migrate v5 → v6
- `frontend/e2e/shelters.test.ts` — single-page visibility + nav scroll + food-point add/remove
- `docs/uat/smart-shelter-uat-checklist.csv` — UAT-061 ปรับเป็น single-page + food-points step

### ไม่กระทบ (ยืนยัน)

- **ไม่** เปลี่ยน envelope / auth (`_session`) / sync priority / layer boundary (stable core)
- **ไม่** bump worker/backend/OpenAPI — `food_distribution_points` เป็น staff-only; ทั้ง doc ลง
  `public_shelters.raw_data` อยู่แล้ว
- **ไม่** ผูกกับ `zones[]`, ไม่มี feature flag, ไม่มี role/permission ใหม่

## Migration (schema_v 5 → 6)

**Purely additive.** `food_distribution_points` default `[]`:

- **Read:** doc `schema_v ≤ 5` ที่ไม่มี field → default-fill `[]` แบบ lazy (ไม่ต้อง backfill batch)
- **Write:** doc ที่ถูกเขียนใหม่ stamp `schema_v: 6`
- **`scripts/migrate-shelter.ts`:** re-stamp doc เดิมเป็น `schema_v: 6` (และเติม `[]`) — ต้องเช็คให้
  skip condition ยัง migrate doc v5 หลัง bump
- ไม่มี rename / ไม่มี semantic change / ไม่มี backfill ข้อมูลจริง (dev ยังไม่มี real data)

## Decision log

- 2026-09-18 — proposed (จาก grilling session): food point = named spot only (`id`/`name`/`note?`/`lat?`/`lng?`);
  no zone linkage; no feature flag; staff-only plane; `schema_v 5 → 6`
- 2026-09-18 — ฟอร์มเปลี่ยนเป็น single-page + scroll-spy; **บันทึกใน CR นี้เพื่อ traceability เท่านั้น**
  (ไม่ใช่ schema change; CR-023 ไม่เคยกำหนด wizard)
- 2026-09-18 — **approved** โดยเจ้าของโครงการ
