---
id: CR-104
title: Volunteer Backoffice & User Management V10 — สถาปัตยกรรมรวมศูนย์การบริหารจัดการงานอาสาสมัคร, ระบบกะย่อยรายวัน, การโอนย้ายข้ามศูนย์, และ 10 Role Taxonomy
status: draft
date: 2026-08-31
requested_by: Dev Team B & เจ้าของโครงการ (รวบ CR-101, CR-102, และ CR-103)
decided_by: เจ้าของโครงการ
layer: stable + volatile   # Time-bound auth & CouchDB write path = stable core
affects:
  - docs/changes/CR-101-volunteer-backoffice-v10-reconcile.md (superseded)
  - docs/changes/CR-102-volunteer-job-shifts-personnel-type.md (superseded)
  - docs/changes/CR-103-user-management-role-taxonomy-form-redesign.md (superseded)
  - docs/changes/CR-092-volunteer-management-v10-flow.md (amend §1 FR-VOL-05, §5 routing table)
  - docs/changes/CR-041-module-a-volunteer-job-board.md (แทนที่ job/shift enum และ slots fields)
  - docs/data/schema.md §2.8 volunteer (v3) · §2.9 shift_assignment (v3) · §2.17 job (v3) · §2.18 job_application (v2) · §2.21 volunteer_transfer (v1) · §6 _users
  - docs/data/couchdb-mongodb-sync.md (projector ใหม่ `public_jobs`)
  - docs/data/api-contract.md (/public/v1/volunteer/*)
  - docs/prd/role-permission-matrix.md §1.1 & §4 (RoleKey vocabulary, dispatch, time-bound grant)
  - docs/sitemap.md §2.6 (routes ย้ายมาใต้ `/back-office/volunteers`)
  - docs/task-breakdown/06-A-volunteer.md (T-28 / T-29 re-scope)
  - frontend/src/lib/features/volunteers/**
  - frontend/src/lib/features/users/**
  - frontend/src/routes/(protected)/back-office/volunteers/**
  - frontend/src/routes/api/v1/users/**
  - worker/ (projector `public_jobs` + revoke sweeper)
  - backend/apiapp/modules/volunteers/
---

# CR-104 — Volunteer Backoffice & User Management V10 (ฉบับรวมสมบูรณ์)

> ⚠️ **สถานะเอกสาร:** `draft` — เอกสารนี้สร้างขึ้นเพื่อรวบรวมและยกระดับข้อกำหนดจาก CR-101 (เดิม CR-094), CR-102 (เดิม CR-097), และ CR-103 (เดิม CR-098) ให้เป็น Single Source of Truth (SSOT) ฉบับสมบูรณ์ รายละเอียดเชิงลึกของแต่ละส่วนจะถูกเติมเต็มและทบทวนร่วมกันในขั้นตอนถัดไป

---

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** รวมสเปกและสถาปัตยกรรมของระบบบริหารจัดการอาสาสมัคร (Volunteer Management V10) และการจัดการบัญชีผู้ใช้งาน (User Management V10) เข้าด้วยกัน:
  1. **สถาปัตยกรรม Remote-First แท้จริง:** ย้ายหน้าจอหลังบ้านมาที่ `/back-office/volunteers/*` และบังคับใช้ **Time-Bound Write Access ที่ระดับ CouchDB** (`_security` + `validate_doc_update`) แทนการผ่าน Server BFF
  2. **Job Management & กะย่อยรายวัน (`shifts[]`):** รองรับการประกาศงานอาสาที่มีหลายกะ หลายวัน (รวมกะข้ามเที่ยงคืน), คำนวณโควตารวมอัตโนมัติ (`quota = sum(shifts[].quota)`), มี Batch Generator, และแสดงแถบโควตา 3 สี (🟢 ตอบรับแล้ว / 🟡 เสนอแล้ว / ⚪ ยังขาดอีก)
  3. **Public Plane Projection:** งานที่เปิดรับ (`open`/`almost_full`) จะถูก Worker ดูดไปเก็บใน MongoDB collection `public_jobs` (No PII) เพื่อให้ประชาชนเปิดดูผ่าน Public SPA (No-Auth) ได้อย่างปลอดภัย
  4. **Flow หน้างานฉุกเฉิน:**
     - **Walk-in Registration 30 วินาที:** รับอาสาหน้าศูนย์ด้วยเบอร์โทร + เลือกลงกะ + เช็คอินเริ่มงานทันที (หากมีทักษะควบคุมจะติด `pending_review`)
     - **Manual Override Check-in:** เจ้าหน้าที่กดยืนยันเช็คอินแทนได้เมื่อสแกน QR ไม่ผ่าน พร้อมบันทึก Actor, เหตุผล และ Audit Trail
     - **โอนย้ายอาสาข้ามศูนย์ (`volunteer_transfer`):** ขอย้ายกำลังพลระหว่างศูนย์พักพิง
  5. **10 Role Taxonomy & การผูกโปรไฟล์อาสา:** ขยายบทบาทผู้ใช้เป็น 10 บทบาทเฉพาะทางตามหน้างานจริง และเชื่อมโยงฟอร์มสร้างผู้ใช้งานเข้ากับทะเบียนอาสาสมัคร (`volunteer`) พร้อมรองรับ `personnel_type` (อาสา vs เจ้าหน้าที่) และ `duty_window`

---

## โครงสร้างหัวข้อหลักที่จะเขียนในฉบับสมบูรณ์ (Structure & Outlines)

### 1. Architecture & Security Spine (Remote-First Core)
- นโยบายการเขียนตรงสู่ CouchDB และการจัดการ Role Membership บน `_security`
- กฎการตรวจสอบเวลาใน `validate_doc_update` ต่อฐานข้อมูล `shelter_{code}`
- กลไกการตัดสิทธิ์อัตโนมัติ (Revoke Sweeper Daemon ใน Worker)

### 2. Back-Office Routing & UI Flows
- `/back-office/volunteers` (3 แท็บ: กระดานงาน, กำลังพลปฏิบัติหน้าที่/เช็คอิน, ทะเบียนอาสา)
- `/back-office/volunteers/checkin` (Kiosk สแกน QR 40/60)
- `/back-office/volunteers/settings` (Master Data ทักษะและการควบคุม)
- `/portal/system-management/users` และ `/back-office/users` (Redesigned Form + Volunteer Picker)

### 3. Public Plane Handoff & Sync Contract
- Pipeline: CouchDB `job` -> Worker Projector -> MongoDB `public_jobs` -> FastAPI `/public/v1/volunteer/*` -> Public SPA
- Write Path: การสมัครงานจาก Public Form ผ่าน BFF พร้อม reCAPTCHA และ Server-side privilege write

### 4. Canonical Data Schemas & Invariants
- `volunteer` (**schema_v 3**)
- `shift_assignment` (**schema_v 3**)
- `job` (**schema_v 3**)
- `job_application` (**schema_v 2**)
- `volunteer_transfer` (**schema_v 1** — doc type ใหม่)
- `_users` metadata & volunteer linkage policy

### 5. Role Taxonomy (10 บทบาท) & Access Matrix
- นิยาม 10 RoleKey: `system_admin`, `shelter_manager`, `registration_staff`, `triage_staff`, `medical_staff`, `kitchen_staff`, `supply_coordinator`, `volunteer_coordinator`, `security_officer`, `facility_staff`
- ขอบเขตความรับผิดชอบและสิทธิ์การเข้าถึงข้อมูลแต่ละโมดูล

### 6. Acceptance Criteria (AC-101-01 .. AC-101-15)
- รวมเกณฑ์การทดสอบระดับ End-to-End ครบทุก Flow

### 7. Migration Guide & Data Compatibility
- แนวทางการ Migrate ข้อมูลเดิม (Additive & Seed migration)
