---
title: "Task Breakdown — Module A — Volunteer"
status: active
created: 2026-06-05
updated: 2026-09-01 # Re-scoped & aligned with CR-104 (Volunteer Backoffice V10 & Job Board Model)
module: A
note: decision-synced 2026-09-01 — CR-104 Volunteer Backoffice V10, Daily Shifts, Self Check-in & Compound Roles
---

# Module A — Volunteer

> volunteer job board, zero-friction fast application, digital ticket & self check-in, daily shifts & time-bound CouchDB access control

> **หมายเหตุ (CR-104):** คำว่า "Volunteer" ในโมดูลนี้คือ **domain/profile concept** (`volunteer:{ulid}`, `job:{ulid}`, `job_application:{ulid}`, `shift_assignment:{ulid}` doc ใน `shelter_{code}`) ไม่ใช่ RBAC RoleKey. การจัดการ Job Board และกะงาน (FR-42/43) เป็นความรับผิดชอบของ `shelter_manager` หรือ `volunteer_coordinator`. อาสาทั่วไป (Operational) ไม่ต้องมี account; อาสาช่วยงานระบบ (Staff-Capable) จะได้รับ account `_users` ชั่วคราว โดยระบบเปิดสิทธิ์บันทึกข้อมูลเฉพาะในเวลากะงานจริง (Dynamic Role Grant & Revocation via Worker Sweeper).

- **Team owner:** Team A — ชิโน, นัท, กาน (Volunteer; ดู [Squad Roster](../prd/squad-roster.md))
- **Phase:** R3
- **Design input (บริษัท):** P-02
- **Target ส่งมอบ:** ภายในกันยายน 2026

## Features / Tasks

| ID | Status | Feature / Task | FR | Phase | Stage | Scope | Raw MD | AI× | Adj MD | Depends |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-28 | ⬜ | Zero-Friction Fast Apply + Digital Ticket QR + Self Check-in & Portal | FR-42 | R3 | prod | ก.ย. | 6 | ÷1.5 | 4 | T-18 |
| T-29 | ⬜ | Job Board Hub + Daily Sub-Shifts + Tablet POS 40/60 & Dynamic Role Sweeper | FR-43 | R3 | prod | ก.ย. | 7 | ÷1.4 | 5 | T-28 |
|  |  | **รวมทั้งโมดูล** |  |  |  |  | **13** |  | **9** |  |

## Task Details

> DoD ทุก prod task ยึด [Standard DoD](_index.md#standard-dod): **UI + data/write path + validation + permission + test + demo ของ slice** — รายการด้านล่างคือเกณฑ์เฉพาะของ task นั้นเพิ่มจากมาตรฐานกลาง

### T-28 — Zero-Friction Fast Apply + Digital Ticket QR + Self Check-in & Portal (FR-42)

**Description:** รับสมัครอาสาสมัครผ่านหน้า Public Job Board ใน 30 วินาที (กรอกชื่อ-เบอร์โทร, เลข ปชช. ทางเลือก, ไร้ SMS OTP, ป้องกันสแปมด้วย reCAPTCHA v3), ออก Digital Ticket QR Code, พอร์ทัลค้นหาตารางงานด้วยเบอร์โทร (`/volunteer/portal`), และรองรับการรายงานตัวด้วยตนเอง (Self Check-in ผ่านป้าย Poster Wall QR Code)

**Definition of Done:**
- หน้าตลาดงานสาธารณะ (`/volunteers/jobs`): แสดงรายการงาน แยกตามศูนย์พักพิงและทักษะ, แถบโควตา 2 สี `[ 🟢 รับแล้ว | ⚪ ยังขาด ]`
- ฟอร์มสมัครด่วน 30s: รับชื่อ-นามสกุล และเบอร์โทรศัพท์ (ไม่บังคับเลขบัตรประชาชน), ตรวจสอบ reCAPTCHA v3
- หน้า Digital Ticket Pass (`/volunteer/ticket/[token]`): แสดง QR Code ขนาดใหญ่, วันเวลากะงาน, ปุ่มยกเลิก, และปุ่ม `[ 📷 สแกนป้ายศูนย์เพื่อเช็คอิน ]` (Poster Wall Self Check-in)
- หน้าพอร์ทัลบริการตนเอง (`/volunteer/portal`): กรอกเบอร์โทรเพื่อดึงการ์ดตารางงานและตั๋ว QR Code ทั้งหมดแบบอ่านอย่างเดียว
- บันทึกเอกสาร `volunteer:{ulid}` (schema_v 3) และ `job_application:{ulid}` (schema_v 2)
- Unit & E2E tests ครบถ้วน

### T-29 — Job Board Hub + Daily Sub-Shifts + Tablet POS 40/60 & Dynamic Role Sweeper (FR-43)

**Description:** ศูนย์บริหารจัดการจิตอาสาหลังบ้าน (`/back-office/volunteers`), ประกาศภารกิจงานอาสาพร้อมกะย่อยรายวัน (`shifts[]` ตัดรอบเที่ยงคืน), จุดรับรายงานตัวแท็บเล็ตหน้าศูนย์ (POS Layout 40/60 + Walk-in ด่วน 30s + โหมด Kiosk), กดยกเลิก/ระบุคนไม่มาปฏิบัติงาน (Manual No-Show), และระบบควบคุมสิทธิ์ตามเวลากะงาน (CouchDB Dynamic Role Sweeper)

**Definition of Done:**
- แดชบอร์ดจัดการจิตอาสาหลังบ้าน (`/back-office/volunteers`): แท็บกระดานงาน, กะงานปฏิบัติการ, และทำเนียบจิตอาสา
- ฟอร์มสร้าง/แก้ไขงาน: กำหนดกะย่อยรายวัน `shifts[]`, โควตากำลังพล, คำนวณยอดรวมอัตโนมัติ, แยกวันปฏิทินเดี่ยว
- จุดรับรายงานตัวแท็บเล็ต (`/back-office/volunteers/checkin`): หน้าจอแบ่ง 40/60 (สแกนกล้อง + การ์ดยืนยันตัวตน), บันทึก `check_in_by` ใน Audit Trail, รองรับ Walk-in ด่วนใน 30 วินาที, และปุ่มเปิดโหมด Kiosk
- การจัดการ No-Show: เจ้าหน้าที่กดยกเลิกหรือระบุคนไม่มาทำงานด้วยมือ คืนโควตาสีขาวทันที
- **Dynamic Role Provisioning & Worker Sweeper**: เพิ่มบทบาทชั่วคราวเข้า `_users.roles` เมื่อสแกนเช็คอิน และ Worker Sweeper ถอนสิทธิ์ออกอัตโนมัติเมื่อหมดเวลากะงาน (+5 นาที)
- Test matching logic, POS layout & Sweeper daemon ครบวงจร

## Effort by phase (Adj MD)

| Phase | Raw MD | Adj MD |
| --- | --- | --- |
| R3 | 13 | 9 |
| **รวม** | **13** | **9** |

## Dependencies

**Cross-module dependency (ขึ้นกับโมดูลอื่น):**

- `T-18` (Groundwork: SOP ratio data gathering + volunteer schema) — module **Module B — SOP & Resource Calc**
