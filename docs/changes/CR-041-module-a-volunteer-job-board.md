---
id: CR-041
title: "Module A expand — Volunteer Job Board, configurable shifts, affiliation tracking (volunteer vs staff)"
status: approved
date: 2026-07-15
updated: 2026-07-22
approved_on: 2026-07-22
requested_by: project owner
decided_by: project owner
layer: volatile
affects:
  - docs/prd/phase-r3-operations.md FR-42 / FR-43 (+ JTBD volunteer; FR-45→43 handoff เลื่อน — D-DEMAND=C)
  - docs/prd/role-permission-matrix.md FR-42/43 rows + affiliate UI + time-bound duty access (D-DUTY-ACCESS=B)
  - docs/task-breakdown/06-A-volunteer.md T-28 / T-29 (+ task ย่อย duty-access / job tier / public)
  - docs/sitemap.md — routes Job Board / volunteer schedule / public `/volunteer*`
  - docs/data/schema.md §2.8 volunteer (โปรไฟล์กลาง D-MULTI=A) · §2.9 shift_assignment · job / job_application
  - docs/data/data-model.md · schema-er-diagram.md
  - docs/features/volunteer-job-board-flow.md
  - docs/changes/CR-002 (reuse affiliation_tags — ไม่แก้สัญญา metadata-only)
  - docs/changes/CR-005 — **ต้อง amend** เปิด `/volunteer*` บน public (D-PUBLIC=A + D-REG=A)
  - schema_v: job 1 · job_application 1 · shift_assignment bump · volunteer อาจ bump (โปรไฟล์กลาง)
  - frontend → features/volunteers / job-board + public volunteer + guards time-bound
  - note: D-DUTY-ACCESS=B ใกล้ stable core — แยก epic RBAC + review ก่อน apply
---

# CR-041 — Module A: Volunteer Job Board + shifts + affiliation tracking

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ขยาย Module A เป็น **Job Board ต่อศูนย์ + กะ template/override + application (± auto-accept) + โปรไฟล์อาสากลาง + public `/volunteer*` + แยก job tier + สิทธิ์เขียนตามกะ + ป้ายอาสา/staff**
- **เพื่อใคร/ทำไม:** SM จัดกำลังอาสา; อาสาสมัครโปรไฟล์/งานจาก public; แยกอาสา vs staff ประจำ; staff-capable ใช้ flow หน้าที่ได้เฉพาะในกะ
- **dev ต้อง build:** Job Board · application · shifts · affiliation UI · public volunteer · central volunteer profile · **time-bound duty access** (epic แยกแนะนำ)
- **กระทบ schema/scope:** `job` / `job_application` ใหม่; bump `shift_assignment` + อาจ bump `volunteer` (D-MULTI=A); **ไม่ผูก SOP→Job ใน R3** (D-DEMAND=C) · มติ + follow-ups ปิดครบ · **`approved` 2026-07-22** — กำลังแตก epic/stories; apply canonical docs ตาม `affects`

## Why

- Baseline มีโปรไฟล์อาสา + `shift_assignment` แต่ไม่มี Job Board / application / กะตั้งค่าได้ / public สมัคร / time-bound duty
- Flow ร่างใน [`docs/features/volunteer-job-board-flow.md`](../features/volunteer-job-board-flow.md)

## Decisions locked

| # | ID | คำตัดสิน | วันที่ |
| --- | --- | --- | --- |
| 1 | **D-OWNER** | **SM** เจ้าของ Job Board / job ops ทั้งศูนย์ · SA เหลือ platform master เท่านั้น | 2026-07-15 |
| 2 | **D-AFFIL** | Track อาสา vs staff ด้วย `affiliation_tags` มี `"volunteer"` = อาสา · ห้าม RoleKey `volunteer` · tag ไม่ให้สิทธิ์ | 2026-07-15 |
| 3 | RBAC vocabulary | Volunteer = domain/profile เท่านั้น | 2026-07-15 |
| 4 | **D-TIER** | **A** — job มี `operational` \| `staff-capable` + required RoleKey เมื่อ staff-capable | 2026-07-22 |
| 5 | **D-DUTY-ACCESS** | **B** — สิทธิ์เขียนตามกะ/เวลาของ assignment ที่ active · นอกกะ write ปฏิเสธ · ใกล้ stable core | 2026-07-22 |
| 6 | **D-LEAD** | **A** — ไม่มีหัวหน้างานใน R3 | 2026-07-22 |
| 7 | **D-REG** | **A** — สมัครโปรไฟล์ผ่าน public (ไม่บังคับ login ตอนสมัคร) | 2026-07-22 |
| 8 | **D-SHIFT** | **C** — preset template + override ต่อ job · duty window = เวลาหลัง override | 2026-07-22 |
| 9 | **D-APP** | **A + optional auto-accept** · default = รออนุมัติ · setting เปิดได้ · รายละเอียด = **F-AUTO** | 2026-07-22 |
| 10 | **D-DEMAND** | **C — ไม่ผูก** SOP/T-31 → Job ใน R3 · คนละจอ; SM สร้าง job มือ · เลื่อน handoff FR-45→43 | 2026-07-22 |
| 11 | **D-MULTI** | **A — โปรไฟล์กลาง** · อาสาหนึ่งโปรไฟล์สมัคร/ถูกมอบหมายหลายศูนย์ได้ · schema/placement ต้องออกแบบตอน apply (อาจ bump `volunteer`) | 2026-07-22 |
| 12 | **D-PUBLIC** | **A — เปิด `/volunteer*` พร้อม Module A** · ต้อง amend CR-005 · มี nav/surface สมัคร (+ board ตาม sitemap) | 2026-07-22 |
| 13 | **F-AUTO** | auto-accept **ต่อ job** · เมื่อเปิด: มีโควตาว่าง + (opt) skill match · **staff-capable: default ห้ามเปิด** (หรือ confirm สองชั้นถ้าบังคับเปิด) · ค่าเริ่มต้นทุก job = ปิด | 2026-07-22 |
| 14 | **F-CLOCK** | เวลาอ้างอิง = **shelter local** · ยอมรับ clock skew **±5 นาที** รอบขอบกะ | 2026-07-22 |
| 15 | **F-OFFLINE** | นอกเครือข่ายเมื่ออยู่นอกหน้าต่างกะ (หรือ grant หมดอายุ) → **deny write** · ไม่มี grace period | 2026-07-22 |
| 16 | **F-OVERLAP** | หลาย assignment/job ได้ถ้า**ไม่ซ้อนเวลา** · กะข้ามเที่ยงคืน = หน้าต่างเวลาต่อเนื่องช่วงเดียว | 2026-07-22 |
| 17 | **F-REVOKE** | เมื่อถอน assignment หรือเลื่อนเวลาแล้ว `now` ไม่อยู่ในหน้าต่างใหม่ → **ตัด grant ทันที** · ต้องแจ้งอาสา | 2026-07-22 |
| 18 | **D-USER-PROVISION** | **สร้าง `_users`:** เฉพาะ **self-register** หรือ **SA สร้าง** — **SM สร้าง user ไม่ได้** · **แก้ RoleKey + ชนิดคน:** SM ทำได้ (รวมดึงอาสาเข้า RoleKey โดยไม่ต้องผ่าน Job Board) | 2026-07-22 |

### Open decisions / follow-ups

**ไม่มี** — มติผลิตภัณฑ์ + follow-ups duty-access ปิดครบแล้ว  
ขั้นถัดไป: apply canonical docs + field table + epic/stories (handoff)

## Change

### A. FR-42 / FR-43 (before → after — หลัง approve)

| | Before | After |
| --- | --- | --- |
| FR-42 | ลงทะเบียนอาสา + skills + availability | **คง** + public สมัคร + โปรไฟล์กลาง + Job Board entry + D-AFFIL เมื่อมี login |
| FR-43 | Skill match + กะ enum | Job Board + application (± auto-accept) + template/override + tier + time-bound duty · **ไม่** auto จาก SOP ใน R3 |
| Owner | SM | SM เท่านั้น (D-OWNER / D-LEAD=A) |

**Consequences (testable):**

1. Job ops = SM เท่านั้นใน R3 — ไม่มี lead · SA ไม่มี journey job ops
2. ป้ายอาสา / Staff ประจำจาก `affiliation_tags` + filter (R-AFFIL)
3. **สร้าง `_users`:** self-register หรือ SA เท่านั้น — SM สร้างไม่ได้ · **แก้ RoleKey + ชนิดคน:** SM ทำได้ (รวมดึงอาสาเข้า RoleKey นอก Job Board)
4. Job ต้องระบุ tier `operational` \| `staff-capable`; ถ้า staff-capable ต้องมี required RoleKey/capability
5. อาสาที่ถือ assignment ของ job staff-capable ใช้ write path ตาม capability ได้ **เฉพาะช่วงกะ active**; นอกกะ write = ปฏิเสธ · ห้ามเช็ค permission จาก tag `volunteer`
6. Public `/volunteer*` เปิดพร้อม Module A — สมัครโปรไฟล์ได้โดยไม่ login
7. โปรไฟล์อาสา **กลาง** — สมัครงานหลายศูนย์จากโปรไฟล์เดียว
8. กะ = template + override; duty window จากเวลาที่มีผล
9. Application รออนุมัติเป็นค่าเริ่มต้น; auto-accept ต่อ job ตาม F-AUTO
10. **ไม่มี** สร้าง/เติม job อัตโนมัติจาก SOP demand ใน R3 (D-DEMAND=C)
11. Duty clock = shelter local ±5 นาที; offline นอกกะ = deny write; ทับเวลากะห้าม; ถอน/เลื่อนตัด grant ทันที + แจ้งอาสา

### B. Doc types

| Doc | สถานะ | หมายเหตุ |
| --- | --- | --- |
| `volunteer:{ulid}` | มีแล้ว — **อาจ bump** | โปรไฟล์กลาง (D-MULTI=A); สร้างจาก public; ผูก login เมื่อมี |
| `shift_assignment:{ulid}` | bump | `job_id` + เวลาจาก template±override; ฐาน duty window; ผูก shelter ของ job |
| `job:{ulid}` | ใหม่ v1 | ต่อศูนย์; tier; required roles; templates/overrides; `auto_accept` (default false; staff-capable จำกัดตาม F-AUTO) |
| `job_application:{ulid}` | ใหม่ v1 | สมัครเข้า job; auto-accept ตาม setting |

> Field table เขียนลง `schema.md` หลัง `approved`

### C. Affiliation (D-AFFIL)

ไม่เปลี่ยนสัญญา CR-002 — บังคับ UI ตาม R-AFFIL-1..4 ใน feature flow

### D. Task / planning (หลัง approve)

| Task | ทิศทาง |
| --- | --- |
| **T-28** | public สมัคร + โปรไฟล์กลาง + skills/availability + D-AFFIL เมื่อ login |
| **T-29** | Job Board + template/override + application ± auto-accept + skill match + assign · **ตัด** DoD “demand จาก T-31 สร้างงาน” ออกจาก R3 (เลื่อน) |
| task ย่อยแนะนำ | (1) schema job/* + volunteer multi (2) public `/volunteer*` + CR-005 (3) **time-bound duty / guards** |

### E. Permissions

| Action | กติกา |
| --- | --- |
| Job Board mutate | `shelter_manager` (+ SA platform override ตามแพทเทิร์น) |
| Public สมัครโปรไฟล์ | anonymous → สร้าง `volunteer` (ไม่ให้ RoleKey) |
| สร้าง `_users` | **self-register** หรือ **SA** เท่านั้น — SM สร้างไม่ได้ (D-USER-PROVISION) |
| แก้ RoleKey / ชนิดคน (`affiliation_tags`) | **SM ได้** (ในศูนย์ตน) และ SA · รวมการให้อาสาถือ RoleKey โดยไม่ผ่าน Job Board |
| Write ทะเบียน/ครัว ฯลฯ ของอาสา | เฉพาะในกะ active ของ job staff-capable ที่ require capability นั้น |

### F. Routes

| พื้นที่ | หมายเหตุ |
| --- | --- |
| Back-office Job Board / กะ | shelter scope · SM |
| ตารางอาสา (self) | หลังมี login |
| Public `/volunteer*` | สมัครโปรไฟล์ + เข้าถึง board ตาม sitemap — **amend CR-005** |

## Impact

| Artifact | หลัง approve |
| --- | --- |
| `schema.md` + data-model / ER | job, job_application, shift bump, volunteer multi-shelter |
| PRD R3 FR-42/43 | ตาม consequences; หมายเหตุ FR-45→43 เลื่อน |
| role-permission-matrix | D-OWNER / D-AFFIL / time-bound duty |
| `06-A-volunteer.md` | ขยาย T-28/T-29; ตัด demand auto จาก DoD R3 |
| `sitemap.md` | Module A + public volunteer |
| feature flow | → `active` |
| CR-005 | **amend บังคับ** (D-PUBLIC=A) |
| Code | volunteers / job-board / public / duty guards |

## Migration

- `job` / `job_application` = v1 หลัง approve; pre-prod re-seed ได้ตามนโยบาย
- `shift_assignment` bump ตาม D-SHIFT=C
- `volunteer` โปรไฟล์กลาง: migration/วางที่เก็บ (shared vs per-shelter) ระบุตอนเขียน schema — **ห้ามเดาในโค้ดก่อน spec**
- D-AFFIL: ไม่ auto-tag จาก RoleKey
- D-DUTY-ACCESS=B: ไม่ auto-แปลง RoleKey ถาวรเป็น grant ตามกะ
- D-DEMAND=C: ไม่มี migrate จาก daily_calc → job

## Acceptance (เมื่อ CR ปิด done)

- [x] Product decisions หลักล็อกครบ (รวม F-AUTO)
- [x] F-CLOCK / F-OFFLINE / F-OVERLAP / F-REVOKE ล็อกแล้ว
- [x] `status: approved` (2026-07-22)
- [ ] Canonical docs + CR-005 amend ครบตาม `affects`
- [ ] T-28/T-29 DoD สะท้อนมติ (รวมตัด SOP→Job ใน R3)
- [ ] ห้าม permission จาก `affiliation_tags` / role ชื่อ `volunteer`
- [ ] Feature flow `active`
- [ ] Time-bound RBAC ผ่าน review ก่อน merge guard

## Decision log

- 2026-07-15 — **proposed**. Track = ไฟล์ CR ใน `docs/changes/`
- 2026-07-15 — lock: D-OWNER · D-AFFIL · ไม่มี RoleKey `volunteer`
- 2026-07-15 — ร่าง `volunteer-job-board-flow.md` (`draft for review`)
- 2026-07-15 — ยังไม่ apply canonical จนกว่า `approved`
- 2026-07-22 — lock D-TIER=A · D-DUTY-ACCESS=B
- 2026-07-22 — lock D-LEAD=A · D-REG=A · D-SHIFT=C · D-APP=A+opt auto-accept
- 2026-07-22 — lock F-AUTO (ต่อ job; โควตา+(opt) skill match; staff-capable default ห้ามเปิด)
- 2026-07-22 — lock D-DEMAND=C · D-MULTI=A · D-PUBLIC=A
- 2026-07-22 — lock F-CLOCK / F-OFFLINE / F-OVERLAP / F-REVOKE ตามข้อเสนอ · **workshop ปิดครบ**
- 2026-07-22 — **approved** โดย project owner · เริ่มแตก epic/stories สำหรับ handoff
- 2026-07-22 — lock **D-USER-PROVISION**: สร้าง `_users` = self-register หรือ SA เท่านั้น; SM สร้างไม่ได้ แต่แก้ RoleKey + ชนิดคนได้ (รวมให้อาสาถือ RoleKey นอก Job Board)
