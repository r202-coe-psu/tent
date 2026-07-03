---
id: CR-027
title: User schema update and password policy
status: approved
date: 2026-07-01
updated: 2026-07-03
requested_by: Soravit Sukkarn
decided_by: project owner (2026-07-03)
layer: volatile
affects:
  - docs/data/schema.md
  - frontend/src/routes/api/v1/users/
  - frontend/src/routes/(protected)/back-office/users/
  - frontend/src/lib/server/user-service.ts
  - frontend/src/lib/features/users/
---

# CR-027 — User schema update and password policy

**สรุป (TL;DR):** เพิ่มฟิลด์ `display_name` ใน schema ของ `_users`

---

## Why

| เหตุผล                                | ผลที่ได้                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ต้องการข้อมูลชื่อแสดงผลของเจ้าหน้าที่ | เพิ่ม `display_name` ใน `_users` DB (บังคับกรอกผ่าน UI)                                                                                                   |
| เพิ่ม Password Policy                 | เพิ่มเอกสาร [Password Policy](../data/password-policy.md) แยกเฉพาะ เพื่อจดบันทึกการเปลี่ยนแปลง และ implement การบังคับใช้ทั้งฝั่ง Client (Zod) และ Server |

---

## Requirements

- **Design v5** — schema `_users` ต้องรองรับฟิลด์ `display_name` (optional ในระดับ DB แต่บังคับระดับ UI)
- **Stakeholder Request** — Password Policy: รหัสผ่านต้องมีความยาวอย่างน้อย 10 ตัวอักษร, ประกอบด้วยตัวพิมพ์ใหญ่ (A-Z) อย่างน้อย 1 ตัว, ตัวพิมพ์เล็ก (a-z) อย่างน้อย 1 ตัว, ตัวเลข (0-9) อย่างน้อย 1 ตัว และอักขระพิเศษอย่างน้อย 1 ตัว โดยบังคับใช้ทั้งฝั่ง Client (Zod) และ Server (`validatePassword`)

---

## Change (before → after)

**Before:**

- การสร้างผู้ใช้อาจทำผ่าน CouchDB ตรง หรือ API `register` แบบเจาะจง
- เอกสาร `_users` ไม่มีฟิลด์สำหรับระบุชื่อแสดงผล (`display_name`)
- ไม่มี UI พื้นฐานสำหรับจัดการ Staff ภายในศูนย์โดย Manager

**After:**

- เพิ่ม `display_name: string | null` ลงใน spec ของ `_users`
- เพิ่มเอกสาร [Password Policy](../data/password-policy.md) แยกเฉพาะ เพื่อจดบันทึกการเปลี่ยนแปลง และ implement การบังคับใช้ทั้งฝั่ง Client (Zod) และ Server

---

## Impact & Migration

- **Schema:** ปรับปรุง `docs/data/schema.md` (เพิ่ม `display_name` ลงในตาราง `_users`) — ไม่ต้องมีการ bump `schema_v` เนื่องจาก `_users` เป็น system DB ที่ไม่มีฟิลด์ `schema_v` และ `display_name` สามารถเป็น null ได้
- **Backward Compatibility:** doc เดิมใน DB ที่ไม่มี `display_name` สามารถทำงานต่อได้ผ่าน UI ที่ให้กรอกเพิ่มเติมตอนแก้ไข

## Decision log

- 2026-07-03 — approved (เดิมบันทึกเป็น CR-026 ชนกับ SOP ratio ratification CR)
- 2026-07-03 — renumbered CR-026 → **CR-027** (index ครบ CR-001..027; CR-026 คงให้ SOP governance ratification)
