---
id: CR-071
title: People import xlsx/csv + inbound API จากหน่วยงาน (payload inbound รอ spec)
status: approved
date: 2026-08-13
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ (IMPS, approved 2026-08-13 — slice A/T-72 เท่านั้น; T-73 = รอบ CR ถัดไป)
layer: volatile
parent: CR-066
affects:
  - docs/data/schema.md §1.1 `registered_via` (ร่วม CR-070)
  - docs/data/schema.md §1.7 `people_import_log` (ใหม่, schema_v 1 — T-72)
  - frontend `src/lib/server/shelter-access-design.ts` (whitelist + append-only)
  - docs/task-breakdown/00-baseline.md (T-55 overlap)
  - docs/task-breakdown/02-people.md (T-72, T-73)
  - frontend people import UI (ใหม่หรือขยาย `/import`)
  - backend `/external/v1` POST (T-73 — blocked จนกว่า D-INBOUND-PLANE + partner spec)
---

# CR-071 — People import + inbound API

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ช่องนำเข้าคนสองทาง — ไฟล์ xlsx/csv (staff) และ POST จากหน่วยงาน
- **เพื่อใคร/ทำไม:** onboarding จำนวนมาก + รับรายชื่อจากหน่วยงานอื่นโดยไม่คีย์มือ
- **dev ต้อง build อะไร:** T-72 import ไฟล์ (ขยาย T-55); T-73 inbound **จอด** จนกว่ามี SPEC field จากเขา
- **กระทบ schema/scope ไหน:** `registered_via=import` มีแล้ว; **D-REG-VIA ล็อก** เพิ่ม `api` สำหรับ inbound (ร่วม `web` ใน CR-070); **T-72 ล็อก** initial stay=A (`pre_registered` ทุกแถว) + import permission=RS+SA+SM; **ห้ามเดาคอลัมน์/JSON ของหน่วยงาน**; D-INBOUND-PLANE ยังเปิด (Wave 4)

## Why

มี `registered_via: import|paper` และ T-55 (Excel fallback) แต่ยังไม่มี people xlsx/csv จบ และไม่มี inbound POST. Owner ต้องการทั้งไฟล์และ API จากหน่วยงาน.

## Change

### Slice A — T-72 staff file import (ทำได้หลัง approve + ล็อกคอลัมน์ภายใน)

| Before | After |
| --- | --- |
| T-55 planned, ยังไม่ใช่ช่องหลัก | Import xlsx **และ** csv; preview รายแถว; commit สร้าง `evacuee` (+ household ถ้ามีคอลัมน์); `registered_via=import` |
| Audit | ต้องมี import log (pattern CR-039 `*_import_log` — doc type ใหม่หลัง approve ถ้าไม่ reuse อย่างมีเหตุผล) |

คอลัมน์ภายใน **proposed ขั้นต่ำ** (ชุด T-48 required — ไม่ใช่รายการ SOP): `first_name`, `last_name`, `gender`, `phone` (ว่างได้ตาม T-48), `shelter_code` ปลายทาง. คอลัมน์เพิ่ม = opt ตาม schema evacuee ที่มี. **อย่าเพิ่มฟิลด์ schema ใหม่ใน T-72.**

**T-72 initial stay = A (ล็อก 2026-08-13):** ทุกแถวที่ import สำเร็จได้ `current_stay.status=pre_registered` เสมอ. นับ occupancy ตาม D-BOOK-OCC=C. เป็น `active` ผ่านประตู check-in หรือ staff เปลี่ยนสถานะเท่านั้น. **ห้าม** คอลัมน์เลือกสถานะต่อแถวในไฟล์.

**T-72 import permission (ล็อก 2026-08-13):** ใคร import ได้ = **RS (`registration_staff`) + SA (`system_admin`) + SM (`shelter_manager`)** — เจ้าของขยายจาก proposed SM+SA. บทบาทอื่นห้าม import.

### Slice B — T-73 inbound POST (**blocked**)

> [NEEDS DECISION: D-INBOUND-PLANE]
> - A: `POST /external/v1/...` + `X-API-Key` (CR-062)
> - B: BFF SA-only `/api/v1/people/inbound`
> - C: รอ partner spec แล้วเลือก
>
> **ห้ามสมมติ JSON body.** จอดจนกว่าหน่วยงานส่ง SPEC. เมื่อ SPEC เข้า: เปิด CR แก้ (หรือ amend CR นี้) แล้วค่อย implement.

`registered_via=api` = ล็อกชื่อค่าแล้ว (D-REG-VIA); ยังไม่ implement จนกว่า slice B เดิน.

## Requirements

- **FR-73, FR-74, FR-80, FR-81** ตาม program spec
- T-72: ใคร import ได้ = **RS + SA + SM** (ล็อก 2026-08-13 — เจ้าของขยายจาก proposed SM+SA)
- validation รายแถว; partial success; ไม่ rollback แถวที่สำเร็จ
- Public task ไม่ใช้กับ staff import; inbound ภายนอกต้อง rate-limit + audit key

### Acceptance (T-72)

- อัปโหลด xlsx และ csv ตัวอย่าง; แถวผิดไม่บล็อกแถวถูก
- คนเข้า CouchDB; `registered_via=import`; `current_stay.status=pre_registered` ทุกแถวสำเร็จ (ไม่มีคอลัมน์เลือก `active`)
- occupancy นับแถวที่ import ตาม D-BOOK-OCC=C
- RS, SA, SM import ได้; บทบาทอื่นถูกปฏิเสธ
- log เปิดดูย้อนหลังได้
- unit test parse/validate; demo ไฟล์ 10 แถวผสมถูก/ผิด
- **ขยาย/แทนที่** ช่องคนของ T-55 — ห้ามมีสอง importer คนละสูตร

### Acceptance (T-73)

- ยังไม่มีจนกว่า partner spec + D-INBOUND-PLANE
- หลังล็อก: OpenAPI + test auth 401/403 + ไม่รับ field นอกสัญญา

## Impact

- Team B = ไฟล์ import; Lead = plane/auth ของ inbound
- doc type `people_import_log` — **ล็อกแล้ว: อยู่ใน `shelter_*` ไม่ใช่ `registry`** (ดู Decision log 2026-08-22 และ schema.md §1.7)

## Migration

Additive. คนที่ import แล้วเป็น evacuee schema ปัจจุบัน. Bump เฉพาะเมื่อเพิ่ม enum `api`/`web` (ร่วม CR-070) หลัง approve.

## Out of scope

- เดา field list จาก ONE PLATFORM / หน่วยงาน
- เปลี่ยน occupancy formula
- Smart card / hardware (CR-014 สไลซ์อื่น)
- เลือก stay status ต่อแถวในไฟล์ import (T-72 initial stay=A)

## Decision log

- 2026-08-13 — proposed. T-73 blocked on partner spec. T-72 คอลัมน์ขั้นต่ำ = T-48 required เท่านั้น.
- 2026-08-13 — Wave 1 ล็อกใน CR-066 (D-TRACK-METHOD=CR+Notion). CR นี้ยัง `proposed`; inbound payload ยัง blocked.
- 2026-08-13 — **Wave 3 ล็อก D-REG-VIA:** คง `app`/`import`/`paper` เพิ่ม `web` (CR-070) และ `api` (inbound). D-INBOUND-PLANE ยังเปิด (Wave 4). **ไม่ bump schema.md.**
- 2026-08-13 — **T-72 ล็อก** (decision ≠ approve CR): **T-72 initial stay=A** (ทุกแถว `pre_registered`; นับ occupancy ตาม D-BOOK-OCC=C; เป็น `active` ที่ประตู/staff เท่านั้น — ห้ามเลือกต่อแถวในไฟล์) · **T-72 import permission=RS+SA+SM** (เจ้าของขยายจาก proposed SM+SA). T-73 / D-INBOUND-PLANE ยัง blocked. **ไม่ bump schema.md.**
- 2026-08-13 — **approved** โดยเจ้าของโครงการ (IMPS) เฉพาะ **slice A / T-72** (initial stay=A, import permission=RS+SA+SM, D-REG-VIA ชื่อค่า `api`). Slice B / T-73 / D-INBOUND-PLANE **ไม่ถูก approve** — จอดรอบ CR ถัดไป; **ห้ามเดา JSON**. **ไม่ bump schema.md ในรอบนี้.**
- 2026-08-22 — **ล็อกที่เก็บ import log:** ไม่ reuse `shelter_import_log` และ**ไม่**อยู่ใน `registry` —
  ใช้ doc type ใหม่ `people_import_log` (schema_v 1, append-only) ใน **`shelter_{code}`** เพราะ `results[]`
  มีชื่อผู้ประสบภัย ต้องอยู่ใน shelter scope เดียวกับข้อมูลคน. บันทึกเป็น **schema.md §1.7** และเพิ่มใน
  `_design/access` ของ `shelter_*` ทั้ง whitelist และ append-only list (§8 ข้อ 2); shelter db เดิมต้องรัน
  `pnpm redeploy:access` (อยู่ใน `pnpm db:sync` ของ Jenkins deploy อยู่แล้ว). **ไม่ bump schema_v ของ doc เดิม.**
