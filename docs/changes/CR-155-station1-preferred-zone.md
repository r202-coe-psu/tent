---
id: CR-155
title: Station 1 บันทึก "โซนที่ต้องการ" รายคนแบบไม่บังคับ — Station 3 ใช้เป็นค่าแนะนำ (ไม่ใช่การจัดโซน)
status: done
date: 2026-10-06
requested_by: feedback roleplay 2026-10-04 (#17) + หัวหน้าทีม (NetLynx) 2026-10-06
decided_by: หัวหน้าทีม (NetLynx) — ยืนยันผ่านทีม 2026-10-06
layer: volatile
affects:
  - docs/data/schema.md §1.1 evacuee — เพิ่ม `preferred_zone`; schema_v 12 → 13 (ต่อจาก CR-154)
  - docs/adr/0001-decoupled-registration-and-medical-screening-flow.md — หมายเหตุ: Station 1 บันทึกโซนที่ต้องการได้ (ไม่ใช่ zoning)
  - frontend/src/lib/features/people/domain/{people,unified-registration}.ts (+ tests)
  - frontend/src/lib/features/people/data/people.remote.ts (createFamilyRegistration, submitFamilyReportIn)
  - frontend/src/lib/features/people/ui/registration/unified-registration-member-card.svelte (accordion)
  - frontend/src/lib/features/people/ui/forms/zone-selection-fields.svelte (Station 3 ค่าแนะนำ)
  - frontend/src/routes/(protected)/onsite/zoning/[evacuee_id]/+page.svelte
---

# CR-155 — Station 1 บันทึก "โซนที่ต้องการ" แบบไม่บังคับ — Station 3 ใช้เป็นค่าแนะนำ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** การ์ดสมาชิกที่ Station 1 มีส่วน "โซนที่ต้องการ (ไม่บังคับ)" แบบพับเก็บ (accordion) — เลือกหรือข้ามก็ได้
> - **ไม่ใช่การจัดโซน:** ค่าที่เลือกเก็บใน field ใหม่ `evacuee.preferred_zone` เท่านั้น; `current_stay.zone` ยังเป็น `null` และสถานะยังเป็น `arriving` → **ทุกคนยังต้องผ่าน Station 2 และ 3** (ADR-0001 คงเดิม)
> - **Station 3:** แสดง "โซนที่สถานี 1 ระบุไว้" และเลือกไว้ให้ก่อน เว้นแต่คนนั้นมีอาการเฝ้าระวัง (EWAR) → คำแนะนำโซนกักโรคชนะ
> - **Schema:** `evacuee` schema_v 12 → 13 (field optional, ไม่ต้อง backfill)

## Requirements

### Station 1 (`/onsite/people/new`, report-in)
- **FR-01** การ์ดสมาชิกแต่ละคนต้องมี accordion "โซนที่ต้องการ (ไม่บังคับ)" ปิดไว้เป็นค่าเริ่มต้น
- **FR-02** ใน accordion เลือกได้เฉพาะโซนที่เปิดอยู่ (`status ≠ closed`) ของศูนย์ปัจจุบัน แสดงชื่อ + ประเภทโซนภาษาไทย; มีตัวเลือก "ไม่ระบุ"
- **FR-03** ไม่เลือก = บันทึกได้ตามปกติ (`preferred_zone = null`) — ห้ามมี validation บังคับ
- **FR-04** ค่าที่เลือกบันทึกใน `evacuee.preferred_zone` เท่านั้น; การบันทึกที่ Station 1 ต้องคง `current_stay.zone = null` และ `current_stay.status = arriving` (หรือสถานะเดิมของ report-in ตาม ADR-0001)
- **FR-05** ข้อความใต้ช่อง: "เป็นค่าแนะนำให้จุดจัดโซน (สถานี 3) — ทุกคนยังต้องผ่านจุดคัดกรองและจัดโซน"

### Station 3 (`/onsite/zoning/[evacuee_id]`)
- **FR-06** ถ้า `preferred_zone` มีค่าและโซนนั้นยังเปิดอยู่ → แสดง "โซนที่สถานี 1 ระบุไว้: <ชื่อโซน>" และเลือกไว้เป็นค่าเริ่มต้น
- **FR-07** ถ้าคนนั้นมีอาการเฝ้าระวังจาก Station 2 (EWAR ≥ 1) → **ต้อง**แนะนำโซนกักโรคเสมอ และ**ห้าม**เลือก `preferred_zone` ให้อัตโนมัติ; แสดง `preferred_zone` เป็นข้อมูลอ่านอย่างเดียว
- **FR-08** ถ้า `preferred_zone` ปิดแล้ว/ไม่มีในศูนย์ → ไม่เลือกให้; แสดงว่า "โซนที่ระบุไว้ไม่เปิดใช้งาน"
- **FR-09** staff เปลี่ยนเป็นโซนอื่นได้เสมอ — `preferred_zone` ไม่ล็อกการเลือก
- **FR-10** การกำหนดโซนหลายคนพร้อมกัน (bulk) ไม่ใช้ `preferred_zone`

### Data
- **FR-11** เพิ่ม `evacuee.preferred_zone: str|null` (opt) — zone `code` ของศูนย์เดียวกัน; trim; ค่าว่าง → `null`
- **FR-12** `preferred_zone` ไม่มีผลต่อ occupancy, queue classification (`classifyScreeningQueueTab`, `classifyZoningQueueTab`) หรือสถานะ
- **FR-13** ไม่ส่งออก public plane / external API (staff-only)

## Acceptance
- ลงทะเบียนที่ Station 1 โดยไม่เปิด accordion → บันทึกได้, `preferred_zone = null`
- เลือกโซนที่ Station 1 → คนนั้นยังอยู่คิว Station 2 (ถ้าเปิดคัดกรอง) และคิว Station 3 "รอจัดโซน"; `current_stay.zone = null`
- Station 3 เปิดคนที่มี `preferred_zone` และไม่มี EWAR → โซนนั้นถูกเลือกไว้ให้
- Station 3 เปิดคนที่มี `preferred_zone` และมี EWAR → แนะนำโซนกักโรค ไม่เลือกโซนที่ระบุไว้ให้
- unit test: `planFamilyRegistration` คง `zone: null` แม้มี `preferred_zone`; การเลือกค่าเริ่มต้นของ Station 3 ครบ 4 กรณี (มี/ไม่มี, EWAR, โซนปิด)

## Why
- Roleplay 2026-10-04: staff ที่ Station 1 มักรู้ว่าครอบครัวต้องการอยู่ร่วมโซนไหน (เช่น ตามสมาชิกที่เข้ามาก่อน) ขอให้เลือกได้
- เดิม Station 1 เลือกโซนแล้ว **จัดโซนจริง** (`active` + zone) ทำให้ข้าม Station 2/3 — ถูกเอาออกใน commit `32e8f53c` (2026-10-03) ตาม ADR-0001 และเป็นต้นเหตุ bug "ข้ามคัดกรอง" ใน roleplay
- CR นี้คืนความสามารถ "ระบุโซน" ที่ Station 1 โดยไม่ทำลายกฎ ADR-0001: เป็นข้อมูลแนะนำเท่านั้น การจัดโซนยังอยู่ที่ Station 3

## Change
| | ก่อน | หลัง |
| --- | --- | --- |
| Station 1 | ไม่มีการเลือกโซน (ตั้งแต่ 2026-10-03) | accordion "โซนที่ต้องการ (ไม่บังคับ)" |
| `evacuee` | ไม่มี `preferred_zone` (schema_v 12) | `preferred_zone: str\|null` (schema_v 13) |
| Station 3 | แนะนำโซนจากประเภทคน (EWAR / เปราะบาง / ทั่วไป) | + ใช้ `preferred_zone` เป็นค่าเลือกเริ่มต้นเมื่อไม่มี EWAR |
| `current_stay` ที่ Station 1 | `arriving` + `zone: null` | **เหมือนเดิม** |

## Impact
- `docs/data/schema.md` §1.1 — เพิ่มแถว `preferred_zone` + บันทึก schema_v 12
- `docs/adr/0001-…md` — เพิ่มหมายเหตุ: Station 1 บันทึก `preferred_zone` ได้ (non-binding) — invariant "Zoning never happens at Station 1" คงเดิม
- Code: domain schema + `schema_v` 12, member input (`unified-registration.ts`), persist (`people.remote.ts`), UI Station 1 + 3
- `validate_doc_update` ของ evacuee ตรวจแค่ว่ามี `schema_v` (ไม่ล็อกรุ่น) — ไม่ต้องแก้
- ไม่กระทบ public plane, worker projection, FastAPI

## Migration
- schema_v 12 → 13: field ใหม่เป็น optional — doc เดิมอ่านเป็น `preferred_zone = null` (ไม่ต้อง backfill, ไม่ rewrite doc เดิม)
- evacuee ที่สร้างผ่าน frontend `createEvacuee` (Station 1 / public / report-in สมาชิกใหม่) ได้ `schema_v: 13`
- writer อื่นที่ไม่เขียน `preferred_zone` (FastAPI `couch_birth`, worker partner booking, kiosk legacy) คงรุ่นเดิม — field เป็น optional จึงยังถูกต้องตาม v13

## Decision log
- 2026-10-06 — proposed. หัวหน้าทีม (NetLynx): "ทำเป็น optional ให้ Station 1 ยังเลือกได้ แต่ไม่จำเป็น ทำ UI เป็น accordion"
- 2026-10-06 — ทีมเลือกความหมาย "โซนที่แนะนำ ยังต้องผ่าน Station 2–3" (ไม่ใช่จัดโซนจริงที่ Station 1); track ด้วย CR file
- 2026-10-06 — FR-07 ตัดสินแล้ว: มีอาการเฝ้าระวัง (EWAR ≥ 1) → แนะนำโซนกักโรคเสมอ, `preferred_zone` แสดงเป็นข้อมูลอ่านอย่างเดียว
- 2026-10-06 — approved → CR-155 (เลขถัดจาก CR-154 บน develop); schema_v ปรับเป็น 12 → 13 เพราะ CR-154 ใช้ 12 แล้ว
- 2026-10-06 — done: schema.md §1.1 + ADR-0001 note + code/tests (people domain/data, Station 1 member card accordion, Station 3 zone picker)
