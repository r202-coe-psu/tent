---
id: draft
title: ผู้ประสานงานจิตอาสาออกสิทธิ์ใช้งานระบบให้จิตอาสาได้แบบจำกัด role และมีวันหมดอายุ
status: proposed
date: 2026-10-27
requested_by: "@net-lynx ใน #879 ข้อ 2 (2026-10-27) + ผู้รับงาน (@Mhapong) ตัดสินรายละเอียด"
decided_by: project owner
layer: stable
affects:
  - docs/data/schema.md §6 `_users` (เพิ่ม `role_grants`)
  - docs/prd/role-permission-matrix.md แถว VC + §4
  - docs/changes/06-A-volunteer/CR-104-volunteer-backoffice-and-user-management-v10.md (ตาราง role แถว `volunteer_coordinator` — อ้าง CR นี้)
  - ไม่ bump `schema_v` (`_users` ไม่มี common envelope / `schema_v`)
  - docs/data/api-contract.md (เพิ่ม `POST /api/v1/volunteer-access`, `PUT /api/v1/users` รับ `permanent_roles`)
  - frontend/src/lib/server/user-service.ts, frontend/src/lib/auth/role-grants.ts, frontend/src/routes/api/v1/volunteer-access/+server.ts, frontend/src/routes/api/v1/users/**
  - frontend/src/lib/features/volunteers (volunteer-access, volunteer-card, volunteer-access-dialog)
  - frontend/src/lib/features/users (user-form: แสดงวันหมดอายุ, ตัวเลือก "ไม่มีวันหมด")
  - worker/src/worker/role_grants.py + retention/job.py (sweep ถอน role ที่หมดอายุ)
  - frontend/e2e/volunteer-access-roles.test.ts (#841)
---

# draft-coordinator-limited-access-grant — coordinator ออกสิทธิ์แบบจำกัดและมีวันหมดอายุ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** `volunteer_coordinator` ออกสิทธิ์ใช้งานระบบให้จิตอาสาได้ เฉพาะศูนย์ตัวเอง, 4 role, จิตอาสาที่ยืนยันตัวตนแล้ว, วันหมดอายุบังคับเลือก ≤ 7 วัน
> - **เก็บ:** field ใหม่ `_users.role_grants` และ worker ถอน role ที่หมดอายุโดยเก็บบัญชีไว้
> - **ไม่เปลี่ยน:** SM/SA ให้ได้ทุก role ไม่มีวันหมด และ coordinator ยังใช้ `POST /api/v1/users` ไม่ได้
> - **layer: stable** (auth) ต้อง review ก่อน approve

---

## Why

- **ที่มา:** #879 ข้อ 2 คำอธิบาย role `volunteer_coordinator` (CR-104, role-permission-matrix แถว VC) บอกว่า "ออกสิทธิ์ระบบให้อาสาช่วยงาน" แต่ปุ่มและ BFF ยอมเฉพาะ SM/SA
- **คำตอบ @net-lynx (2026-10-27):** ทาง A แบบจำกัดสิทธิ์ เพราะการออกสิทธิ์คือการสร้างบัญชี จึงต้องจำกัดศูนย์, role, ยืนยันตัวตน และอายุ
- **ต่างจาก role-permission-matrix §4:** §4 ออกแบบ Time-Bound Dynamic Role Provisioning ที่เปิดและปิด role ตามช่วงกะ (เช็คอิน/เช็คเอาต์) แต่ CR นี้เลือก**วันหมดอายุ**แทนเพราะทำง่ายกว่ามาก §4 ยังไม่ถูกทำ และไม่ถูกแทนที่โดย CR นี้

## Change

### FR — การออกสิทธิ์โดย coordinator

- **FR-1:** coordinator ออกสิทธิ์ได้เฉพาะศูนย์ `SHxxx` ที่ตัวเองถือ `SHxxx:volunteer_coordinator` และจิตอาสาต้องเป็นของศูนย์นั้น
- **FR-2:** role ที่ให้ได้มีแค่ `registration_staff`, `kitchen_staff`, `distribution_staff`, `facility_staff`
  - บัญชีได้ role แค่ `shelter:SHxxx` และ `SHxxx:<role>`
- **FR-3:** จิตอาสาต้องผ่านการยืนยันตัวตน (`identity_verification.status` verified) อย่างใดอย่างหนึ่ง
  - (ก) ในโปรไฟล์ของศูนย์นี้
  - (ข) ในโปรไฟล์ของศูนย์อื่นที่ `phone_hash` ตรงกัน ตาม #886
  - จิตอาสาที่ไม่มีเบอร์ใช้ได้แค่ (ก)
- **FR-4:** ต้องระบุวันหมดอายุทุกครั้ง ไม่มีค่าเริ่มต้น
  - เลือกได้ตั้งแต่วันนี้ถึงวันนี้ +7 วัน (Asia/Bangkok)
  - หมดอายุตอนสิ้นวันที่เลือก (23:59:59 +07:00)
- **FR-5:** endpoint ใหม่ `POST /api/v1/volunteer-access` (เฉพาะ coordinator) บังคับ FR-1 ถึง FR-4 ทุกข้อ request ที่ไม่ผ่านได้ 403 (ศูนย์/role) หรือ 422 (วันหมด/ยืนยันตัวตน) และไม่เขียนอะไรเลย
- **FR-6:** coordinator ยังได้ 403 จาก `POST /api/v1/users` (สร้างผู้ใช้ทั่วไป)
- **FR-7:** ออกสิทธิ์ซ้ำให้บัญชีเดิม
  - เพิ่ม role และ grant หรือต่ออายุ grant เดิม โดยไม่เปลี่ยนรหัสผ่าน
  - ถ้าบัญชีมี role นั้นจาก SM อยู่แล้ว (ไม่มี grant) ไม่เปลี่ยนอะไร
- **FR-8:** coordinator ถอนหรือแก้ role และ grant เองไม่ได้

### FR — SM/SA และการหมดอายุ

- **FR-9:** SM/SA ให้ได้ทุก role ไม่มีวันหมดอายุเหมือนเดิม
- **FR-10:** หน้าแก้ไขผู้ใช้แสดงวันหมดอายุของ role ที่มาจาก grant
  - บันทึกฟอร์มโดยคง role ไว้ grant ยังอยู่
  - ตัวเลือก "ไม่มีวันหมด" ลบ grant ของ role นั้น ทำให้ role ถาวร (ส่ง `permanent_roles` ใน `PUT /api/v1/users`; SM ลบได้เฉพาะ grant ของศูนย์ตัวเอง)
  - ถอน role ใน form ลบ grant ของ role นั้นด้วย
- **FR-11:** worker กวาดทุกรอบ retention (ทุก 5 นาที `RETENTION_INTERVAL_SECONDS = 300`) ถือว่าหมดเมื่อ `expires_at <= now`
  - ถอน `SHxxx:<role>` ที่ grant หมดอายุ และลบ grant นั้นออก
  - ห้ามแตะ role ที่ไม่มี grant หรือ role ของศูนย์อื่น
  - ถอด `shelter:SHxxx` เมื่อไม่เหลือ role ในศูนย์นั้น
  - บัญชีและรหัสผ่านคงอยู่

### schema.md §6 `_users` — เพิ่ม field

| Field         | ชนิด                                                                                   | req | หมายเหตุ                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `role_grants` | [{`shelter_code`:str, `role`:str, `expires_at`:ts, `granted_by`:str, `granted_at`:ts}] | opt | role ที่ `volunteer_coordinator` ออกให้แบบมีวันหมด (draft-coordinator-limited-access-grant) — หนึ่งรายการต่อ (`shelter_code`, `role`); worker ถอน `SHxxx:<role>` เมื่อพ้น `expires_at`; role ที่ไม่มีรายการในนี้เป็น role ถาวร |

### role-permission-matrix แถว VC

- คงข้อความ "ออกสิทธิ์ระบบให้อาสาช่วยงาน" แล้วต่อท้ายว่า "(จำกัด 4 role, ศูนย์ตัวเอง, ยืนยันตัวตนแล้ว, หมดอายุ ≤ 7 วัน — draft-coordinator-limited-access-grant)"
- §4 เพิ่มหมายเหตุว่าการออกสิทธิ์โดย coordinator ใช้วันหมดอายุแทนช่วงกะ

## Acceptance

- **AC-1:** coordinator ของ SH001 ออก `distribution_staff` ให้จิตอาสาที่ยืนยันตัวตนแล้ว หมด 3 วัน ได้ role `shelter:SH001` + `SH001:distribution_staff` และ `role_grants` 1 รายการ
- **AC-2:** ยิง BFF ตรงๆ ด้วย role อื่นนอก 4 ตัว, ศูนย์อื่น, ไม่ระบุวันหมด, วันหมดเกิน 7 วัน หรือจิตอาสายังไม่ยืนยันตัวตน ได้ 4xx และ `_users` ไม่เปลี่ยน
- **AC-3:** จิตอาสาที่ยืนยันตัวตนที่ศูนย์อื่น (เบอร์เดียวกัน) ออกสิทธิ์ได้
- **AC-4:** พ้น `expires_at` แล้ว sweep ถอนเฉพาะ role นั้น role ที่ SM ให้ยังอยู่ บัญชียังอยู่ และออกสิทธิ์ใหม่ได้โดยไม่ต้องตั้งรหัส
- **AC-5:** SM เห็นวันหมดในหน้าแก้ไขผู้ใช้ บันทึกแล้ว grant ยังอยู่ และเลือก "ไม่มีวันหมด" แล้ว grant หาย
- **AC-6:** coordinator ไม่มีทางถอนหรือแก้ role (UI และ API)

## Impact

- **auth (stable core):**
  - ขยายสิทธิ์สร้างและแก้บัญชีจาก SM/SA ให้ coordinator ในขอบเขต FR-1 ถึง FR-4
  - ไม่เปลี่ยน `_session`, การ login หรือรูปแบบ role (ยังเป็น compound ตาม CR-093)
- **ช่วงเวลาที่ role ยังใช้ได้หลังหมดอายุ:** สูงสุดประมาณ 5 นาที (รอบ sweep) และ session ที่ login อยู่แล้วจะได้ role ใหม่เมื่อ CouchDB อ่าน `_users` ซ้ำ
- **test:**
  - unit test ของ policy, BFF, form และ worker sweep
  - e2e `volunteer-access-roles.test.ts` (#841) เปลี่ยน `test.fixme` ของ coordinator เป็นทดสอบจริง

## Migration

ไม่มี `role_grants` เป็น field เสริม บัญชีเดิมไม่มี field นี้ จึงมี role ถาวรทั้งหมดเหมือนเดิม

## Decision log

- 2026-10-25 — ผู้รับงานถามใน #841 และ #879 เรื่องคำอธิบาย role ไม่ตรงสิทธิ์จริง
- 2026-10-27 — @net-lynx ตอบ #879 ข้อ 2: ทาง A แบบจำกัดสิทธิ์
- 2026-10-27 — ผู้รับงานตัดสินรายละเอียด:
  - วันหมดอายุบังคับเลือก ไม่มีค่าเริ่มต้น
  - coordinator ถอนเองไม่ได้
  - SM บันทึกฟอร์มแล้ว grant คงอยู่ และมีตัวเลือก "ไม่มีวันหมด"
  - ยืนยันตัวตนนับผลข้ามศูนย์ตาม #886
  - เก็บใน `_users.role_grants`
- 2026-10-27 — proposed ใน #955 รอ @Jackyzaz review (stable core) และ approve
