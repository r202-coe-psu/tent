---
id: CR-105
title: User Management Redesign, Phone Username, Security Questions Self-Service Recovery, and Admin Passphrase Reset
status: done
layer: stable + volatile
created: 2026-09-01
updated: 2026-09-01
affects:
  - docs/data/schema.md §6
  - docs/data/password-policy.md
  - docs/prd/role-permission-matrix.md
  - frontend/src/lib/auth/roles.ts
  - frontend/src/lib/auth/security-questions.ts
  - frontend/src/lib/server/security-questions.ts
  - frontend/src/lib/server/passphrase-generator.ts
  - frontend/src/lib/server/user-service.ts
  - frontend/src/lib/features/users/
  - frontend/src/routes/(auth)/
  - frontend/scripts/seed.ts
---

# CR-105: User Management Redesign, Phone Username, Security Questions Self-Service Recovery, and Admin Passphrase Reset

> **สรุป (TL;DR):**  
> ปรับปรุงระบบจัดการผู้ใช้และฟอร์มสร้าง/แก้ไขผู้ใช้ให้รองรับ Username เป็นเบอร์โทรศัพท์ 10 หลัก, เพิ่มข้อมูลสังกัด/ตำแหน่ง/ประเภทบุคลากร, รองรับการกำหนด Multiple Roles แบบแบ่งหมวดหมู่, เพิ่มระบบกู้คืนรหัสผ่านด้วยตนเองผ่าน Security Questions (6 คำถามมาตรฐาน + Salted Hash), และเพิ่มระบบ Admin Temporary Passphrase Reset จากพูล 100 คำ พร้อมกลไก Force Setup ตอนเข้าใช้งานครั้งแรก

---

## 1. Context & Motivation (Why)

1. **การใช้งานจริงภาคสนาม:** เจ้าหน้าที่และจิตอาสาหน้างานมักจำ Username ภาษาอังกฤษไม่ได้ การใช้เบอร์โทรศัพท์ 10 หลักเป็น Username ช่วยลดความผิดพลาดและสะดวกในการติดต่อสื่อสาร
2. **ความต้องการข้อมูลสังกัดและประเภทบุคลากร:** ในภาวะภัยพิบัติ มีบุคลากรจากหลากหลายหน่วยงาน (เช่น ปภ., รพ., มูลนิธิ) ระบบจำเป็นต้องบันทึก `organization`, `position`, `personnel_type` (เจ้าหน้าที่ vs อาสา) เพื่อจัดสรรงานและตรวจสอบที่มา
3. **ปัญหาการลืมรหัสผ่านและคอขวดแอดมิน:** เดิมการรีเซ็ตรหัสผ่านต้องพึ่งพา System Admin โดยตรง การเพิ่มระบบ Self-Service Recovery ด้วย **คำถามความปลอดภัย (Security Questions)** ช่วยให้ผู้ใช้กู้คืนบัญชีได้เองทันที และกรณีที่ต้องให้ Admin ช่วยรีเซ็ต ระบบจะสร้าง **Memorable Temporary Passphrase** (เช่น `Safe-Camp-2026!`) แทนการตั้งรหัสผ่านแบบสุ่มที่จำยาก
4. **ความต่อเนื่องในการ Deploy:** ไม่ต้องการให้การขึ้นระบบใหม่สร้างภาระแก่แอดมิน ผู้ใช้เดิมสามารถล็อกอินด้วยรหัสผ่านเดิม แล้วระบบจะนำทางให้บันทึกคำถามความปลอดภัยโดยอัตโนมัติ (Zero-Admin Intervention on Deploy)

---

## 2. Requirements & Specification

### 2.1 Username & Extended Profile Fields
- **FR-01 (Phone Username):** ฟิลด์ `name` (Username) สำหรับผู้ใช้ทั่วไป (Staff/Volunteer) ต้องเป็นหมายเลขโทรศัพท์มือถือ 10 หลักของไทย (`08xxxxxxxx`, `09xxxxxxxx`, `06xxxxxxxx`) สำหรับบัญชี System Admin (`sa01`) ยังคงอนุญาตให้ใช้ตัวอักษรภาษาอังกฤษได้
- **FR-02 (Extended Profile Fields):** ขยายฟิลด์ในเอกสาร `_users`:
  - `personnel_type`: `'staff'` (เจ้าหน้าที่ประจำ) หรือ `'volunteer'` (อาสาสมัครช่วยงานระบบ)
  - `organization`: หน่วยงานต้นสังกัด (**Required** สำหรับ staff, **Optional** สำหรับ volunteer)
  - `position`: ตำแหน่ง/หน้าที่/วิชาชีพ (Optional)
  - `phone`: เบอร์โทรศัพท์ติดต่อ (Required 10 หลัก)
  - `email`: อีเมลติดต่อ (Optional)
  - `notes`: หมายเหตุเพิ่มเติม (Optional)
  - `duty_window`: กำหนดช่วงเวลาปฏิบัติหน้าที่ `{ start_ts: ISO, end_ts: ISO }` สำหรับอาสาสมัคร

### 2.2 Multi-Role Categorized Selection
- **FR-03 (Categorized Checkboxes):** ในหน้าฟอร์มสร้าง/แก้ไขผู้ใช้ ต้องแสดงบทบาทเป็น Checkbox Card แบ่งตาม 4 ฝ่าย:
  1. *งานทะเบียนและคัดกรองหน้าด่าน:* `registration_staff`, `triage_staff`
  2. *งานการแพทย์และพยาบาล:* `medical_staff`
  3. *งานคลังและครัวกลาง:* `kitchen_staff`, `supply_coordinator`, `facility_staff`
  4. *งานประสานงานและความปลอดภัย:* `volunteer_coordinator`, `security_officer`
  5. *ผู้บริหารศูนย์พักพิง:* `shelter_manager` (เฉพาะ SA)
  6. *ผู้ดูแลระบบส่วนกลาง:* `system_admin` (เฉพาะ SA)
- **FR-04 (Compound Roles Storing):** บันทึกสิทธิ์หลายบทบาทในศูนย์เดียวกันเป็น `["shelter:SH001", "registration_staff", "triage_staff"]`

### 2.3 Security Questions Self-Service Recovery
- **FR-05 (6 Standard Questions Catalog):** กำหนดชุดคำถามความปลอดภัย 6 ข้อมาตรฐาน:
  1. `high_school`: โรงเรียนมัธยมที่คุณเคยศึกษาคือที่ใด?
  2. `birth_province`: จังหวัดที่คุณเกิดคือจังหวัดใด?
  3. `first_pet`: สัตว์เลี้ยงตัวแรกของคุณชื่ออะไร?
  4. `primary_school`: โรงเรียนประถมที่คุณเคยศึกษาคือที่ใด?
  5. `favorite_teacher`: คุณครูที่คุณประทับใจมากที่สุดชื่ออะไร?
  6. `first_workplace`: สถานที่ทำงานหรือบริษัทแห่งแรกของคุณคือที่ใด?
- **FR-06 (Salted SHA-256 Storage):** คำตอบจะถูกตัดช่องว่างหัวท้าย แปลงเป็นตัวพิมพ์เล็ก และบันทึกในรูปแบบ `{ question_id, answer_hash, salt, set_at }` ใน `_users` โดยเซิร์ฟเวอร์
- **FR-07 (2-Step Recovery Flow):** เส้นทาง `/forgot-password`:
  - Step 1: ผู้ใช้กรอกเบอร์โทร $\rightarrow$ ระบบคืน `question_label`
  - Step 2: ผู้ใช้กรอกคำตอบ + รหัสผ่านใหม่ $\rightarrow$ ระบบตรวจสอบและรีเซ็ตรหัสผ่านพร้อมล็อกอินให้อัตโนมัติ

### 2.4 Admin Memorable Passphrase Reset
- **FR-08 (Passphrase Generator):** สุ่มคำ 2 คำจากพูล 100 คำภาษาอังกฤษที่จำง่าย ประกอบกับตัวเลขและเครื่องหมาย `!` ในรูปแบบ `Word1-Word2-Digits!` (เช่น `Safe-Camp-2026!`) ความยาว $\ge 10$ ตัวอักษร สอดคล้องกับ Password Policy
- **FR-09 (Admin Reset Endpoint & UI):** Endpoint `/api/v1/users/reset-password` สร้างรหัสผ่านชั่วคราว ตั้งค่า `must_change_password: true` และแสดง Modal พร้อมปุ่ม Copy Password ในหน้าจัดการผู้ใช้

### 2.5 First-Login & Force Setup Gate
- **FR-10 (Post-Login Interceptor):** เมื่อผู้ใช้เข้าสู่ระบบ:
  - หาก `must_change_password: true` $\rightarrow$ นำทางไป `/force-setup` บังคับตั้งรหัสผ่านใหม่ + เลือกคำถามความปลอดภัย
  - หาก `has_security_question: false` (ผู้ใช้เดิมในวัน Deploy) $\rightarrow$ นำทางไป `/force-setup` บังคับเลือกคำถามความปลอดภัย (ช่องรหัสผ่านใหม่เป็นทางเลือกเสริม ไม่บังคับเปลี่ยน)

---

## 3. Acceptance Criteria (DoD)

- [x] **AC-01:** ฟอร์มสร้างผู้ใช้รองรับการสลับ Staff/Volunteer และตรวจสอบเงื่อนไข Organization ตามประเภทบุคลากร
- [x] **AC-02:** สามารถเลือกหลายบทบาท (Multiple Roles) พร้อมกันในศูนย์พักพิงเดียวได้ และบันทึกลง CouchDB ถูกต้อง
- [x] **AC-03:** หน้า `/forgot-password` ดำเนินการกู้คืนรหัสผ่านด้วยคำถามความปลอดภัยสำเร็จ และนำผู้ใช้เข้าสู่ระบบได้
- [x] **AC-04:** Admin สามารถกดรีเซ็ตรหัสผ่านชั่วคราวแบบ Memorable Passphrase และคัดลอกรหัสผ่านไปแจ้งผู้ใช้ได้
- [x] **AC-05:** ผู้ใช้เดิมล็อกอินด้วยรหัสผ่านเดิมได้ในวัน Deploy และถูกส่งไปหน้า `/force-setup` เพื่อบันทึกคำถามความปลอดภัยโดยไม่ต้องเปลี่ยนรหัสผ่านเดิม
- [x] **AC-06:** สคริปต์ `scripts/seed.ts` มีข้อมูลผู้ใช้ตัวอย่างครบถ้วนตาม Schema ใหม่ และสามารถรันซ้ำได้โดยไม่เกิด Conflict
- [x] **AC-07:** การทดสอบ Unit Test และ TypeScript Check ผ่าน 100%

---

## 4. Changes by File

| File | Change Details |
| :--- | :--- |
| `docs/data/schema.md` | อัปเดตตารางฟิลด์ใน §6 DB `_users` เพิ่ม `organization`, `position`, `phone`, `email`, `notes`, `duty_window`, `security_question` |
| `docs/data/password-policy.md` | เพิ่มมาตรฐาน Memorable Temporary Passphrase (Admin OTP) และนโยบายคำถามความปลอดภัย |
| `frontend/src/lib/auth/security-questions.ts` | Master Catalog ของ 6 คำถามความปลอดภัยมาตรฐาน |
| `frontend/src/lib/server/security-questions.ts` | ฟังก์ชันการ Hash คำตอบด้วย Salted SHA-256 และฟังก์ชัน Verification |
| `frontend/src/lib/server/passphrase-generator.ts` | 100-word pool และเครื่องมือสร้างรหัสผ่านชั่วคราวตามรูปแบบ `Word1-Word2-Digits!` |
| `frontend/src/lib/auth/roles.ts` | Taxonomy 10 บทบาทและ Thai Labels |
| `frontend/src/lib/features/users/domain/schema.ts` | Zod Schemas สำหรับ User Form, Recovery, และ Force Setup |
| `frontend/src/lib/server/user-service.ts` | ขยายฟิลด์ผู้ใช้, Admin reset, Challenge retrieval, และคำถามความปลอดภัย |
| `frontend/src/lib/features/users/ui/user-form.svelte` | Redesign ฟอร์มผู้ใช้ด้วย Categorized Multi-Role Checkboxes และ Profile Fields |
| `frontend/src/lib/features/users/ui/user-list.svelte` | เพิ่มคอลัมน์สังกัด/ประเภท และปุ่ม Admin Reset Password |
| `frontend/src/lib/features/users/ui/user-management-page.svelte` | เพิ่ม Dialog รีเซ็ตรหัสผ่านชั่วคราวและปุ่ม Copy Passphrase |
| `frontend/src/routes/forgot-password/+page.svelte` | หน้าจอ Self-Service Forgot Password 2 ขั้นตอน |
| `frontend/src/routes/force-setup/+page.svelte` | หน้าจอบังคับตั้งค่าความปลอดภัย / รหัสผ่านใหม่ |
| `frontend/src/routes/api/v1/auth/me/+server.ts` | Endpoint ตรวจสอบสถานะความปลอดภัยของผู้ใช้ปัจจุบัน |
| `frontend/scripts/seed.ts` | อัปเกรดข้อมูลผู้ใช้ตัวอย่าง (`sa01`, `staff01`–`staff03`, `0891234567`) |
