---
title: "Step 03 — แท็บ 3 รายชื่อและการอนุมัติ + Walk-in + ออกสิทธิ์ + โอนย้ายศูนย์"
status: partially_blocked
created: 2026-08-26
updated: 2026-08-26
depends_on: 01-tab-job-board.md
blocked_by: D-VOL-PWDFLAG (03.4) · D-VOL-TRANSFER-APPROVE (03.5)
---

# Step 03 — แท็บ 3 (รายชื่อและการอนุมัติ)

## เป้าหมาย

ทำเนียบอาสาครบวงจร: ค้นหา/กรอง → อนุมัติทักษะควบคุม → ลงทะเบียน walk-in → ออกสิทธิ์หลังบ้าน → โอนย้ายศูนย์

## 03.1 ตารางทำเนียบ

- [ ] tabs ย่อย: `ทั้งหมด` · `🟡 รออนุมัติ` · `🟢 พร้อมปฏิบัติงาน` (นับจาก `hub-metrics.ts`)
- [ ] ตัวกรอง 5 ตัว: ค้นหา (ชื่อ/นามสกุล/เบอร์/รหัส) · ศูนย์พักพิง · ทักษะ · สถานะกะ · แหล่งที่มา (`source`) · บุคลากร (`user_name != null`)
- [ ] คอลัมน์: ข้อมูลบุคคล (ชื่อ + `volunteer_code` + badge ชนิดคน + badge on-site) · ทักษะ · สังกัดศูนย์ · สถานะยืนยันตัวตน & กะงาน · จัดการ
- [ ] badge: `ยืนยันตัวตนแล้ว` ← `identity_verified` · `ปฏิบัติหน้าที่อยู่` ← `checked_in`
- [ ] **PII mask ตาม role** (NFR-5/NFR-20): เบอร์แสดง `xxx-xxx-1234` เว้นแต่ role ที่มีสิทธิ์ · `national_id` ไม่แสดงในตารางทุกกรณี

## 03.2 อนุมัติทักษะควบคุม

- [ ] แถวสถานะ `pending_review` → ปุ่ม `[📋 ตรวจสอบ & อนุมัติ]` เปิด Audit Checklist (ตรวจใบประกอบวิชาชีพ)
- [ ] อนุมัติ → `identity_verified=true` + `status='active'` · ปฏิเสธ → บันทึกเหตุผล
- [ ] แถวที่ผ่านแล้ว → ปุ่ม `[✏️ จัดการข้อมูล]`

## 03.3 Walk-in modal (FR-VOL-10)

`ui/walk-in-dialog.svelte` — 3 ส่วนในฟอร์มเดียว

- [ ] **1. ข้อมูลบุคคล**: ชื่อ-นามสกุล\* · เบอร์โทร\* · เลขบัตร ปชช. 13 หลัก (**optional**) · สังกัดศูนย์\*
- [ ] **2. ทักษะ** — chips เลือกหลายค่าจาก master list; `การแพทย์/ปฐมพยาบาล` = controlled → บังคับตกเป็น `pending_review` ห้ามไป active (AC-094-08)
- [ ] **3. กะงาน** — `กะเช้า 08:00–16:00` · `กะบ่าย 16:00–00:00` · `กะดึก 00:00–08:00` · `ยืดหยุ่น (standby)`
- [ ] checkbox "เช็คอินเข้ากะและเริ่มปฏิบัติงานทันที" → สร้าง `volunteer` + `shift_assignment` + `check_in_at` **ในลำดับเดียว** และ rollback ถ้าขั้นใดพลาด (AC-094-06)
- [ ] `source='walk_in'`, `volunteer_code` gen ต่อศูนย์

## 03.4 ออกสิทธิ์ใช้งานระบบ 🔒 รอ D-VOL-PWDFLAG

- [ ] `ui/provision-access-dialog.svelte` — auto-fill ชื่อ/เบอร์/ศูนย์; ถ้าไม่มี email บังคับกรอก (ใช้เป็น username)
- [ ] server route `src/routes/api/back-office/volunteers/provision/+server.ts` (`$lib/server/couch-admin.ts`)
  - [ ] lookup `phone` / `national_id` → ถ้าเจอบัญชีเดิม **ผูก `volunteer.user_name` ห้ามสร้าง `_users` ซ้ำ** (AC-VOL-01)
  - [ ] ถ้าไม่มี → สร้าง `_users` + temp password ตาม [password-policy.md](../../data/password-policy.md)
  - [ ] ตั้ง `must_change_password` **ตามที่ D-VOL-PWDFLAG เคาะ**
- [ ] Credential Handoff Card สรุป username + temp password (copy ได้ ไม่ log)
- [ ] บังคับเปลี่ยนรหัสผ่านครั้งแรก — block ทุก route จนกว่าจะเปลี่ยน (AC-VOL-07)

## 03.5 โอนย้ายศูนย์ 🔒 รอ D-VOL-TRANSFER-APPROVE

- [ ] ปุ่ม `[ขอโอนย้ายศูนย์]` + badge นับคำขอค้าง (`volunteer_transfer.status='pending'` ที่ `to_shelter_code = ศูนย์ปัจจุบัน`)
- [ ] sheet รายการคำขอ → อนุมัติ/ปฏิเสธ (ผู้อนุมัติ = ตามมติ D-VOL-TRANSFER-APPROVE)
- [ ] `accepted` → อัปเดต `volunteer.current_shelter_code` + revoke role grant ของศูนย์ต้นทาง (ต่อกับ step 04)

## Tests

- [ ] unit: filter composition, PII mask ตาม role, walk-in → controlled skill → `pending_review`
- [ ] e2e: walk-in + เช็คอินทันที แล้วตัวนับ "ปฏิบัติหน้าที่อยู่ขณะนี้" +1 (AC-094-06) · ออกสิทธิ์ให้อาสาที่มีบัญชีเดิมแล้ว `_users` ไม่เพิ่มจำนวน (AC-VOL-01)

## DoD

- [ ] `pnpm lint` · `pnpm check` · `pnpm test` + `svelte-autofixer`
- [ ] AC-094-09 ผ่าน: ตัวนับ Control Hub ตรงกับข้อมูลในทั้ง 3 แท็บ
