---
id: CR-067
title: เพิ่ม site_kind บน shelter — evacuation_center | host_house (คง doc type เดียว)
status: approved
date: 2026-08-13
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ (IMPS, approved 2026-08-13 — P1 เท่านั้น; P1b/T-76 = รอบ CR ถัดไป)
layer: volatile
parent: CR-066
affects:
  - docs/data/schema.md §3.1 shelter
  - schema_v shelter 4 → 5 (หลัง approve เท่านั้น — รอบนี้ยังไม่ bump ใน schema.md)
  - docs/data/data-model.md (ชนิดสถานที่)
  - frontend/src/lib/features/shelters/domain
  - frontend/src/lib/features/shelters/ui/shelter-form-page.svelte
  - frontend/src/lib/components/system-management-navbar/static.ts (ถอด nav host-houses)
  - ถอด route `/portal/system-management/host-houses` (D-HOST-NAV B′)
  - frontend/src/lib/features/public-portal/ (map icons)
  - docs/task-breakdown/00-baseline.md (T-66)
  - docs/task-breakdown/12-public.md (T-67)
  - docs/task-breakdown/07-B-sop.md (T-76 phase 2)
  - docs/changes/CR-014-design-v5-alignment.md (slice host_house — แนะนำ superseded)
---

# CR-067 — `site_kind` บน `shelter`

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เพิ่ม `site_kind` enum(`evacuation_center`,`host_house`) บน doc `shelter` เดิม; public map ใช้ไอคอนคนละชุด; **ถอด** หน้า/nav `/host-houses` — บ้านอยู่หน้ารายการศูนย์ + กรอง `site_kind` (D-HOST-NAV **B′**)
- **เพื่อใคร/ทำไม:** แยกศูนย์กับบ้านพี่เลี้ยงโดยไม่แยกโมเดล — occupancy/import/map ใช้ path เดียว
- **dev ต้อง build อะไร:** schema + ฟอร์ม + กรองรายการศูนย์ + default ตอนสร้างตาม filter + ไอคอน map (T-66, T-67). **ห้าม** ลดฟิลด์ SOP หรือคำนวณ Sphere ในรอบนี้. **ห้าม** stub หน้า `/host-houses`
- **กระทบ schema/scope ไหน:** shelter schema_v 4→5 ตอน implement หลัง approve; ตัดกับ CR-014 ที่เสนอ doc type `host_house` แยก — slice นั้น **superseded** (D-SITE-MODEL=A). **สไลซ์ที่ approve:** P1 (T-66, T-67). **ไม่รวม** Phase 2 / T-76 (D-SOP-LITE / D-HOST-STAFF / D-SPHERE-CAP) — รอบ CR ถัดไป

## Why

โค้ดรวมศูนย์ไว้ที่ `shelter` แล้ว. ไม่มี discriminator. `shelter_type` = ประเภทอาคาร. `project_level=community` ไม่ใช่ชนิดสถานที่. หน้า host-houses เป็น stub. CR-014 เสนอ `host_house` แยก — ยัง proposed และจะทำให้ import/occupancy/map แยก path.

**D-SITE-MODEL = A (ล็อก 2026-08-13):** คง doc เดียว + `site_kind`.
**D-HOST-NAV = B′ (ล็อก 2026-08-13):** ถอด nav/route `/host-houses`; กรองบนหน้ารายการศูนย์เดิม.

## Change

### Before → After

| Area | Before | After (D-SITE-MODEL=A, D-HOST-NAV=B′ ล็อก) |
| --- | --- | --- |
| Doc type | `shelter` อย่างเดียว ไม่มีชนิดสถานที่ | คง `shelter`; เพิ่ม `site_kind` |
| `shelter_type` | ประเภทอาคาร (โรงเรียน/วัด/…) | **ไม่เปลี่ยนความหมาย** |
| `project_level` | community/lao/provincial | **ไม่ใช้เป็นตัวแทนบ้านพี่เลี้ยง** |
| CR-014 `host_house` | proposed doc type ใหม่ | **superseded** เฉพาะ slice นี้; สไลซ์อื่นของ CR-014 (GBV, thermal, house_damage) ไม่ถูก CR นี้แตะ |
| Public map | จุดสีตาม `operation_status`; emoji จากสตริงประเภท | ไอคอนแยกตาม `site_kind` (สี health อยู่ CR-069) |
| `/host-houses` | stub ว่างใน nav | **D-HOST-NAV B′:** ถอด nav/route; บ้านอยู่หน้ารายการศูนย์ + กรอง `site_kind`. สร้างตาม filter: `host_house` → default `host_house`; `evacuation_center` → `evacuation_center`; แท็บ «ทั้งหมด» → ผู้ใช้ต้องเลือกชนิดก่อนบันทึก |

### Field (หลัง approve ค่อยลง schema.md)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `site_kind` | enum(`evacuation_center`,`host_house`) | req | default อ่าน doc เก่า = `evacuation_center` |

ชื่อ field = **`site_kind`** — ห้ามใช้ชื่อคลุมเครือ (`type`, `kind` เปล่า, `is_host`).

### Phase 1 (T-66, T-67) — ทำได้หลัง approve

- Zod + `validate_doc_update` รับ `site_kind`
- ฟอร์มสร้าง/แก้มีตัวเลือกชนิดสถานที่
- รายการศูนย์กรอง `site_kind` ได้; **ไม่มี** หน้า `/host-houses` (D-HOST-NAV B′)
- สร้างตาม filter ปัจจุบัน: กรองบ้าน → default `host_house`; กรองศูนย์ → `evacuation_center`; แท็บทั้งหมด → ต้องเลือกชนิดก่อนบันทึก
- Public map: ไอคอนศูนย์ ≠ ไอคอนบ้านพี่เลี้ยง
- Mint `code` / db `shelter_{code}` **เหมือนเดิม** ทั้งสองชนิด

### Phase 2 (T-76) — ห้ามทำจนกว่า workshop

> [NEEDS DECISION: D-SOP-LITE] ชุดฟิลด์บังคับของบ้านพี่เลี้ยง — ห้ามเดารายการ
> [NEEDS DECISION: D-HOST-STAFF] บ้านไม่ต้องมี user ประจำศูนย์ — ตัวเลือกใน program spec §0
> [NEEDS DECISION: D-SPHERE-CAP] `capacity = floor(area_m2 / 3.5)` — proposed สำหรับ host_house เท่านั้นหลังล็อก

P1 ใช้ฟอร์มศูนย์ชุดเดิมทั้งสองชนิด. Occupancy บ้าน = นับคน `active` เหมือนศูนย์ (D-BOOK-OCC อาจแยกภายหลัง).

## Requirements

- **FR-57..FR-63** ตาม [program spec](../features/site-occupancy-booking-program.md) §3

### Acceptance (T-66)

- สร้างศูนย์ `site_kind=evacuation_center` และบ้าน `host_house` ได้
- doc เก่าไม่มี field อ่าน/เขียนได้โดยเติม `evacuation_center`
- กรองรายการบนหน้ารายการศูนย์ตาม D-HOST-NAV B′; ไม่มี route `/host-houses`
- สร้างตาม filter (default ตามแท็บ; แท็บทั้งหมดต้องเลือกชนิดก่อน save)
- permission: สร้าง/แก้ศูนย์ยังเป็น SA ตาม path เดิม; **ไม่ขยาย role ใหม่ใน P1**
- unit test mapping default + enum reject ค่านอกชุด
- demo: สร้างบ้าน 1 หลัง แล้วเห็นในรายการกรอง + บน map คนละไอคอน (T-67)

### Acceptance (T-67)

- map public แยกไอคอน 2 ชนิด; filter ชนิดได้
- ไม่มี PII บนหมุด
- demo ศูนย์และบ้านบนแผนที่เดียวกัน

## Impact

- schema.md §3.1 หลัง approve; domain Zod `features/shelters`; ฟอร์ม; รายการศูนย์ + กรอง; ถอด navbar/route host-houses; public-portal map
- worker/FastAPI public shelter projection: ส่ง `site_kind` ออก public/external GET ที่มีอยู่ (ไม่ใช่ payload ONE PLATFORM ใหม่ — นั้น CR-073)
- tests: shelters domain + import (CR-068) + public map

## Migration

หลัง approve: shelter schema_v 4→5. Doc เดิมไม่มี `site_kind` → read-default `evacuation_center`; write ใหม่ต้องมี field. ไม่มี backfill batch บังคับ (lazy default). **รอบร่างนี้ยังไม่ bump ใน schema.md.**

## Out of scope

- SOP-lite field list, Sphere auto-capacity, RBAC «ไม่มี user ประจำ» (T-76)
- เปลี่ยน `operation_status` enum
- Doc type `host_house` แยก

## Decision log

- 2026-08-13 — proposed. Phase 2 จอด workshop. **ยังไม่ approve CR.**
- 2026-08-13 — **D-SITE-MODEL=A ล็อก:** `site_kind` บน `shelter`; doc ไม่มี field อ่านเป็น `evacuation_center`; `shelter_type` คงประเภทอาคาร; ห้ามใช้ `project_level=community` เป็นบ้านพี่เลี้ยง. CR-014 slice `host_house` doc type superseded สำหรับเรื่องนี้ (GBV/thermal/house_damage ไม่ถูกแตะ).
- 2026-08-13 — **D-HOST-NAV=B′ ล็อก** (ไม่ใช่ A และไม่ใช่ B เดิม): ถอด `/portal/system-management/host-houses`; บ้านอยู่หน้ารายการศูนย์ + กรอง; สร้างตาม filter. T-66 ไม่มี stub page.
- 2026-08-13 — **approved** โดยเจ้าของโครงการ (IMPS) เฉพาะ **P1** (D-SITE-MODEL=A, D-HOST-NAV=B′, T-66/T-67). Phase 2 / T-76 **ไม่ถูก approve** — จอดรอบ CR ถัดไป. **ไม่ bump schema.md ในรอบนี้** (shelter 4→5 ตอน implement ตาม Migration).
