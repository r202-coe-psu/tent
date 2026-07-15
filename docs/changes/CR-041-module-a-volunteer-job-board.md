---
id: CR-041
title: "Module A expand — Volunteer Job Board, configurable shifts, affiliation tracking (volunteer vs staff)"
status: proposed
date: 2026-07-15
requested_by: project owner
decided_by: project owner
layer: volatile
affects:
  - docs/prd/phase-r3-operations.md FR-42 / FR-43 (+ JTBD volunteer)
  - docs/prd/role-permission-matrix.md FR-42/43 rows + affiliate UI notes (D-DUTY-ACCESS ถ้าเลือกนอกทาง A/C)
  - docs/task-breakdown/06-A.md T-28 / T-29 (+ task ย่อยถ้าเคาะหลังประชุม)
  - docs/sitemap.md — routes Job Board / volunteer schedule (หลังเคาะ path)
  - docs/data/schema.md §2.8 volunteer · §2.9 shift_assignment (+ doc types job / job_application ใหม่)
  - docs/data/data-model.md · schema-er-diagram.md
  - docs/features/volunteer-job-board-flow.md
  - docs/changes/CR-002 (reuse affiliation_tags — ไม่แก้สัญญา metadata-only)
  - docs/changes/CR-005 (ถ้า D-PUBLIC เปิด `/volunteer*` — แยก sync / amend)
  - schema_v: job 1 · job_application 1 · shift_assignment bump (เมื่อ D-SHIFT เคาะ)
  - frontend → features/volunteers / job-board (หลัง approve + ปิด open decisions ที่บังคับ)
---

# CR-041 — Module A: Volunteer Job Board + shifts + affiliation tracking

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ขยาย Module A (FR-42/43, T-28/T-29) จาก “ลงทะเบียนอาสา + มอบหมายกะแบบเดิม” เป็น **Job Board ต่อศูนย์ + กะตั้งค่าได้ + ปรับ job ได้ตลอด + track อาสา vs staff ประจำ**
- **เพื่อใคร/ทำไม:** SM จัดกำลังอาสาจริงในศูนย์; อาสาสมัคร/เห็นตาราง; แยกชัดว่าใครเป็นอาสาหรือ staff ประจำแม้ถือ RoleKey เดียวกัน
- **dev ต้อง build อะไร (หลัง approve + ปิด open decisions):** feature Job Board · application · shift ที่ผูก job · UI affiliation · (opt) duty-access ตามมติ
- **กระทบ schema/scope:** เพิ่ม `job` / `job_application`; ขยาย `shift_assignment`; ขยาย DoD T-28/T-29 · **ยังไม่ apply canonical docs จนกว่า CR `approved` และปิด decision ที่บังคับ schema**

## Why

- Baseline Module A รองรับโปรไฟล์อาสา + `shift_assignment` (enum กะตายตัว + `station`) แต่ยังไม่มี **ประกาศงานให้สมัคร (Job Board)** และ application workflow
- ความต้องการใช้งานจริง: กะตั้งค่าได้ต่อ job, ปรับประกาศได้ตลอดโดย SM, อาสาบางประเภทแทบไม่ใช้ระบบ (operational) ส่วนบางประเภทต้องใช้ flow เขียน (staff-capable)
- คนที่ถือ RoleKey เดียวกันต้อง **track ได้** ว่าเป็นอาสาหรือ staff ประจำ — field `_users.affiliation_tags` มีจาก [CR-002](CR-002-registration-staff-affiliation-tags.md) แต่ยังไม่บังคับใช้ใน UI Module A
- Flow/journey ร่างไว้แล้วใน [`docs/features/volunteer-job-board-flow.md`](../features/volunteer-job-board-flow.md) — CR นี้เป็นประตูเข้าสู่ canonical docs + task expand

## Decisions locked (2026-07-15)

| # | ID | คำตัดสิน |
| --- | --- | --- |
| 1 | **D-OWNER** | **SM** เป็นเจ้าของ Job Board / job ops ทั้งศูนย์ · **SA ไม่ทำ job ops** วันต่อวัน (เหลือ platform master: skill list / preset เท่านั้น) |
| 2 | **D-AFFIL** | Track อาสา vs staff ประจำด้วย `_users.affiliation_tags` มี `"volunteer"` = อาสา; ไม่มี + มี RoleKey = staff ประจำ · แสดงป้าย/กรองใน UI · **ห้าม** RoleKey ชื่อ `volunteer` · tag **ไม่ให้สิทธิ์** (CR-002) |
| 3 | RBAC vocabulary | คำว่า Volunteer ในโมดูล = domain/profile เท่านั้น — สอดคล้อง CR-002 / role-permission-matrix |

## Open decisions (ต้องปิดก่อน apply schema เต็ม / แตก task ย่อยละเอียด)

| ID | คำถาม | ทางเลือก | บล็อกอะไร |
| --- | --- | --- | --- |
| **D-TIER** | แยก job operational vs staff-capable ในผลิตภัณฑ์? | A แยกชัด · B ไม่แยก · C R3 เฉพาะ operational | job.capability / UX |
| **D-DUTY-ACCESS** | อาสาที่ใช้ระบบ (เช่น ทะเบียน) ได้สิทธิ์อย่างไร? | A RoleKey ถาวร · B ตามกะ/เวลา · C ไม่อาสาเขียน | **RBAC** (B ใกล้ stable core); UJ-V7 |
| **D-LEAD** | มีหัวหน้างานไหม? | A ไม่มี · B job-scoped grant · C RoleKey ใหม่ | permission / UI |
| **D-REG** | ช่องทางสมัครโปรไฟล์อาสา | A Public · B login จำกัด · C SM สร้างให้ | auth / CR-005 |
| **D-SHIFT** | โมเดลกะ | A enum เดิม · B เวลาอิสระ · C template+override | **schema `shift_assignment` bump** |
| **D-APP** | การเข้า job | A สมัครรออนุมัติ · B auto-accept · C SM assign อย่างเดียว | application flow |
| **D-DEMAND** | SOP → Job | A auto draft · B SM กดสร้าง · C ไม่ผูก | T-31 handoff |
| **D-MULTI** | อาสาหลายศูนย์ | A โปรไฟล์กลาง · B ต่อศูนย์ | data model |
| **D-PUBLIC** | เปิด `/volunteer*` บน public | A พร้อม Module A · B หลัง gate · C deep link | CR-005 |

> **ข้อเสนอแนะ (ยังไม่มติ):** R3 เริ่ม **D-DUTY-ACCESS = A หรือ C** ก่อน — เลื่อน B (time-bound) ถ้ายังไม่พร้อมแตะ RBAC ลึก

## Change

### A. FR-42 / FR-43 (before → after — หลัง approve)

| | Before | After (ทิศทาง) |
| --- | --- | --- |
| FR-42 | ลงทะเบียนอาสา + skills + availability | **คง** + ผูก Job Board entry (UJ-JOIN) + **บังคับ D-AFFIL** เมื่อมี login |
| FR-43 | Skill match + มอบหมายกะ (`station` + enum กะ) | **ขยาย** เป็น Job posting + application + กะตาม **D-SHIFT** + adjust ได้ตลอดโดย SM |
| Owner | SM (canonical) | **ยืนยัน D-OWNER** — ไม่มี SA เป็นคนดูแล board |

**Consequences (testable) — ส่วนที่ล็อกแล้ว:**

1. Job ops ของศูนย์ = SM (และ lead ถ้าเปิดภายหลังภายใต้ SM) — SA ไม่มี journey จัดการ job
2. รายชื่อ user / สมาชิกกะแสดงป้าย **อาสา** vs **Staff ประจำ** จาก `affiliation_tags`
3. สร้าง login ให้อาสาต้องตั้ง `affiliation_tags` มี `"volunteer"`; สร้าง staff ประจำห้ามใส่โดยปริยาย

**Consequences ที่รอ open decisions:** job entity ละเอียด, shift shape, self-apply, public สมัคร, duty-access

### B. Doc types (ทิศทาง — รายละเอียด field ล็อกหลัง D-SHIFT / D-APP / D-TIER)

| Doc | สถานะ | หมายเหตุ |
| --- | --- | --- |
| `volunteer:{ulid}` | มีแล้ว (§2.8) | คง; ผูก `user_name` เมื่อมี login |
| `shift_assignment:{ulid}` | มีแล้ว (§2.9) | **ขยาย/bump** เมื่อ D-SHIFT เคาะ (ลิงก์ `job_id`, เวลาอิสระ ฯลฯ) |
| `job:{ulid}` | **ใหม่** (เสนอ) | ประกาศงานต่อศูนย์; status draft/open/paused/filled/closed; ปรับได้ตลอดโดย SM |
| `job_application:{ulid}` | **ใหม่** (เสนอ ถ้า D-APP ≠ C) | สมัครเข้า job; status submitted → … |

> Field table ละเอียด **ยังไม่ฝังใน CR นี้** — เขียนลง `schema.md` หลังปิด D-SHIFT + D-APP + D-TIER (กัน draft schema ชนมติห้องประชุม). โครง state / journey อ้าง feature flow §3–§5

### C. Affiliation tracking (D-AFFIL — apply ได้หลัง approve โดยไม่ bump schema)

ใช้ field ที่มีอยู่:

| Field | พฤติกรรมที่บังคับในผลิตภัณฑ์ |
| --- | --- |
| `_users.affiliation_tags` | มี `"volunteer"` ↔ ป้ายอาสา; ไม่มี + มี RoleKey ↔ Staff ประจำ |
| UI user admin | ฟอร์มสร้าง/แก้ **บังคับเลือกชนิดคน** (R-AFFIL-1..2 ใน feature flow) |
| Filter | กรองรายชื่อเฉพาะอาสา / เฉพาะ staff ประจำ |

ไม่แก้สัญญา CR-002 (metadata only)

### D. Task / planning (`06-A.md` — หลัง approve; รายละเอียด DoD ปรับตาม open decisions)

| Task | ทิศทางหลัง approve |
| --- | --- |
| **T-28** | ขยาย DoD: UJ-JOIN + D-AFFIL เมื่อมี login · ช่องทางสมัครตาม D-REG |
| **T-29** | ขยาย DoD: Job Board + กะตาม D-SHIFT + application ตาม D-APP + adjust job · skill match คง |
| (opt) task ย่อย | แยก groundwork schema job/* ถ้าทีมต้องการ slice เล็กลง — ตั้ง ID หลังปิด open decisions |

**ยังไม่แก้** `06-A.md` จนกว่า `status: approved` (และอย่างน้อยปิด D-SHIFT / D-APP ที่กระทบ DoD)

### E. Permissions

| Action | หลัง approve (ขั้นต่ำตามที่ล็อก) |
| --- | --- |
| Job Board mutate (สร้าง/แก้/ปิด/อนุมัติ/จัดกะ) | `shelter_manager` (+ SA platform override ตามแพทเทิร์น) — **ไม่ใช่** SA เป็นผู้ใช้หลัก |
| Volunteer recruit (เดิม FR-42/43) | คง `VOLUNTEER_RECRUIT_ROLES` = {SA, SM} สำหรับ admin ข้ามศูนย์; **ops วันต่อวัน = SM** |
| Write path ทะเบียน/ครัว ฯลฯ | ตาม RoleKey เดิม — **ไม่**จาก tag `volunteer`; รายละเอียดเพิ่มตาม D-DUTY-ACCESS |

### F. Routes (ทิศทาง — path ล็อกหลัง approve)

| พื้นที่ | หมายเหตุ |
| --- | --- |
| Back-office Job Board / กะ / รายชื่ออาสา | ภายใต้ shelter scope · SM |
| ตารางอาสา (self) | ถ้ามี login ตาม D-REG |
| Public `/volunteer*` | ผูก D-PUBLIC / CR-005 — ห้ามเปิดเงียบๆ |

## Impact

| Artifact | หลัง approve |
| --- | --- |
| `schema.md` §2.8–2.9 + § ใหม่ | `job` / `job_application`; ขยาย `shift_assignment` ตาม D-SHIFT |
| data-model / ER | sync doc types |
| PRD R3 FR-42/43 | consequences Job Board + D-AFFIL + owner SM |
| role-permission-matrix | หมายเหตุ D-OWNER / D-AFFIL; แก้เพิ่มถ้า D-DUTY-ACCESS = B หรือ D-LEAD = C |
| `06-A.md` | ขยาย DoD T-28/T-29 |
| `sitemap.md` | routes Module A |
| feature flow | `draft for review` → `active` เมื่อ CR approved + open decisions ที่บังคับปิดครบ (หรือ mark deferred ใน CR) |
| Code | `features/` สำหรับ volunteers / job-board |
| CR-005 | amend เฉพาะถ้าเปิด public volunteer nav |

## Migration

- `volunteer` / `shift_assignment` อาจมี seed/dev data — migration ระบุเมื่อ bump `shift_assignment` (D-SHIFT)
- `job` / `job_application` = schema_v 1 ตั้งต้นหลัง approve; pre-prod wipe/re-seed ได้ถ้านโยบายโปรเจกต์อนุญาต
- D-AFFIL: **ไม่มี migrate อัตโนมัติ** จาก RoleKey → tag (ห้ามตาม CR-002); SM/SA ใส่ tag จากข้อมูลที่ยืนยันแล้ว

## Acceptance (เมื่อ CR ปิด done)

- [ ] Decision locked + open decisions ที่บังคับ schema ถูกปิดหรือ mark deferred ชัดใน CR
- [ ] Canonical docs อัปเดตครบตาม `affects`
- [ ] T-28/T-29 DoD สะท้อน Job Board + D-AFFIL
- [ ] ห้าม permission check จาก `affiliation_tags` / role ชื่อ `volunteer`
- [ ] Feature flow `active` หรือ superseded ชี้สเปก implement

## Decision log

- 2026-07-15 — **proposed**. Track = ไฟล์ CR ใน `docs/changes/` (เจ้าของโครงการสั่งเพิ่ม CR)
- 2026-07-15 — lock: D-OWNER (SM owns job ops; SA ไม่ดูแล board) · D-AFFIL (`affiliation_tags`) · ไม่มี RoleKey `volunteer`
- 2026-07-15 — ร่าง flow/journeys ใน `docs/features/volunteer-job-board-flow.md` (ยัง `draft for review`)
- 2026-07-15 — **ยังไม่ apply** schema.md / PRD / `06-A.md` / sitemap / role-matrix จนกว่า `approved` + ปิด open decisions ที่บล็อก schema
