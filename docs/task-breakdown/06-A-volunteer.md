---
title: "Task Breakdown — Module A — Volunteer"
status: active
created: 2026-06-05
updated: 2026-08-21
module: A
note: decision-synced 2026-08-21 — CR-041 Module A Job Board, Digital Ticket & Time-Bound Access
---

# Module A — Volunteer

> volunteer job board, public application, digital ticket & QR check-in, configurable shifts & time-bound duty access

> **หมายเหตุ (CR-002, CR-041):** คำว่า "Volunteer" ในโมดูลนี้คือ **domain/profile concept** (`volunteer:{ulid}`, `job:{ulid}`, `job_application:{ulid}`, `shift_assignment:{ulid}` doc ใน `shelter_{code}`) ไม่ใช่ RBAC RoleKey. การจัดการ Job Board และกะงาน (FR-42/43) เป็นความรับผิดชอบของ `shelter_manager`. ผู้ที่มี login account สามารถมี `affiliation_tags: ["volunteer"]` เป็น metadata เพื่อระบุตัวตน แต่ไม่ให้สิทธิ์ใด ๆ นอกเหนือจาก RoleKey ที่ได้รับในช่วงกะงานที่ active (Time-Bound Duty Access).

- **Team owner:** Team A — ชิโน, นัท, กาน (Volunteer; ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** R3
- **Design input (บริษัท):** P-02 (กำหนดส่งก่อนกรกฎาคม 2026)
- **Target ส่งมอบ:** ภายในสิงหาคม 2026

## Features / Tasks

| ID | Status | Feature / Task | FR | Phase | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-28 | ⬜ | Volunteer registration + Public Application + Digital Ticket | FR-42 | R3 | prod | ส.ค. | 6 | ÷1.5 | 4 | T-18 |
| T-29 | ⬜ | Job Board + Configurable Shifts + Time-Bound Access Guard | FR-43 | R3 | prod | ส.ค. | 7 | ÷1.4 | 5 | T-28 |
|  |  | **รวมทั้งโมดูล** |  |  |  |  | **13** |  | **9** |  |

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง

### T-28 — Volunteer registration + Public Application + Digital Ticket (FR-42)

**Description:** รับสมัครอาสาสมัครผ่านหน้า Public No-Auth Form พร้อมออก Digital Ticket (URL + QR Code) สำหรับตรวจสอบสถานะและรายงานตัวหน้างาน — ป้องกันสแปมด้วย reCAPTCHA v3 + Rate Limiting (ไม่มีต้นทุน SMS OTP)

**Definition of Done:**
- ฟอร์มรับสมัครสาธารณะ (`/volunteer`, `/volunteer/jobs/[id]/apply`): ข้อมูลติดต่อ, skill tags (เลือกจาก master list), กะงานที่เลือก, reCAPTCHA v3 check
- หน้า Digital Ticket (`/volunteer/ticket/[token]`): แสดง QR Code ประจำตัว, สถานะการสมัคร (`pending`/`accepted`), วันเวลานัดหมาย, ปุ่มกดยกเลิก
- จุดสแกนรายงานตัวหน้างาน (`/volunteers/checkin`): เจ้าหน้าที่สแกน QR Ticket หรือค้นหาชื่อ/เบอร์ เพื่อบันทึกเวลา Check-in/Check-out และ feed ยอด `volunteers_active`
- บันทึกโปรไฟล์ลง `volunteer:{ulid}` และ `job_application:{ulid}`
- PII อาสา mask ตาม role (NFR-5) + ลง RoPA และ Unit/E2E tests ครบถ้วน

### T-29 — Job Board + Configurable Shifts + Time-Bound Access Guard (FR-43)

**Description:** Shelter Manager จัดการ Job Board ประจำศูนย์ (สร้าง/แก้ไข/ปิดรับสมัคร), ตั้งค่าโควตาและสถานะ, จัดการกะงาน (Template + Custom Override), และควบคุมสิทธิ์ **Time-bound Shift Access** สำหรับอาสากลุ่ม staff-capable

**Definition of Done:**
- Back-office Job Board (`/volunteers/jobs`): แสดงรายการงาน, โควตา (`quota`, `slots_confirmed`, `slots_pending`), ป้ายสถานะเปิดรับ, toggle auto-accept (เฉพาะ operational)
- Review & Approval flow: SM ตรวจสอบใบสมัคร กดยืนยัน/ปฏิเสธ, สร้าง account `_users` พร้อม tag `affiliation_tags: ["volunteer"]` สำหรับงาน staff-capable
- Shift Scheduling (`/volunteers/shifts`): กำหนดกะงาน, ตรวจสอบเวลาทับซ้อน (Overlap validation), บันทึก `shift_assignment:{ulid}` v2
- **Time-bound Shift Access Guard**: บังคับใช้ client & server guard ปฏิเสธ write path ของอาสา staff-capable ถ้านอกหน้าต่างกะที่ active (±5 นาที clock skew)
- Test matching logic, shift guard & demo flow ครบวงจร

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| R3 | 13 | 9 |
| **รวม** | **13** | **9** |

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- `T-18` (Groundwork: SOP ratio data gathering + volunteer schema) — module **Module B — SOP & Resource Calc**
