---
id: CR-074
title: จัดการ user SA — grant เฉพาะ app system_admin, exclusive roles, last-SA, ล็อก Couch bootstrap admin
status: done
date: 2026-08-14
requested_by: project owner (SA user-management UI)
decided_by: project owner (implement plan 2026-08-14)
layer: volatile
affects:
  - docs/prd/role-permission-matrix.md §3 FR-34
  - docs/data/api-contract.md §3
  - docs/data/schema.md §6 (_users.roles ของ SA)
  - docs/uat/smart-shelter-uat-checklist.csv UAT-122
  - frontend/src/lib/auth/roles.ts
  - frontend/src/lib/server/couch-admin.ts
  - frontend/src/lib/server/user-service.ts
  - frontend/src/lib/features/users/**
  - frontend/scripts/seed.ts (sa01)
---

# CR-074 — จัดการ user SA (`system_admin`)

## Why

Role `system_admin` มีใน spec (FR-34) และ BFF รับ `roles: ['system_admin']` จาก SA ได้แล้ว แต่ UI
บังคับ shelter + capability จึงสร้าง SA จากแอปไม่ได้ และไม่มีเกตกัน (1) caller ที่ไม่ใช่ app SA
mint SA (2) ผสม `system_admin` กับ shelter scope (3) ลบ/ลด SA คนสุดท้าย (4) ลบ/แก้ CouchDB
server admin (`COUCHDB_USER` / `_admin`) ผ่านแอป

## Change

**ก่อน**

- `assertCanGrant`: `isSystemAdmin()` (รวม Couch `_admin`) grant บทบาทใดก็ได้ยกเว้น `_admin`
- `roles` ของ SA ไม่ถูกบังคับให้เป็น `["system_admin"]` คนเดียว
- `listUsers` โชว์ bootstrap admin; `deleteUser`/`updateUser` ลบ/แก้ได้
- ฟอร์ม user ไม่มีตัวเลือก `system_admin`; UAT-122 เขียนว่า "ถ้านโยบายอนุญาต"

**หลัง**

1. **Grant SA = app SA เท่านั้น** — `caller.roles` ต้อง include `system_admin` (ไม่ใช้
   `isSystemAdmin()` ซึ่งถือ `_admin` เป็น SA-equivalent). SM / staff / Couch `_admin` ที่ login
   ผ่านแอป mint SA ผ่าน `/api/v1/users` ไม่ได้. บูตสแรป SA ตัวแรก = seed / `PUT /_users` นอกแอป
2. **Exclusive SA** — ถ้าถือ `system_admin` แล้ว `roles` ต้องเป็น `["system_admin"]` เท่านั้น
   (`shelter_id = null`)
3. **Last app-SA** — ห้ามลบหรือลดสิทธิ์ `system_admin` คนสุดท้ายใน `_users` (นับเฉพาะ app role)
4. **Bootstrap admin immutable** — username จาก `COUCHDB_ADMIN_URL` / `COUCHDB_USER` หรือ
   `roles` มี `_admin` → ห้าม create ทับชื่อ / update / delete ผ่านแอป; กรองออกจาก `listUsers`;
   บันทึก blocked attempt ที่ server log
5. **UI** — ตัวเลือก SA เฉพาะ `/portal/system-management/users` (`allowSystemAdminRole`);
   back-office และฟอร์มแก้ shelter ไม่แสดง

## Impact

- role-permission matrix FR-34 หมายเหตุ: grant SA, exclusive roles, last-SA, bootstrap lock
- api-contract.md §3 authorization ของ `/api/v1/users`
- schema.md §6 รูป `roles` ของ SA
- UAT-122: สร้าง SA อื่นอนุญาตที่ portal; ห้ามลบ bootstrap admin
- BFF + users feature + seed `sa01` + E2E access-control

## Migration

N/A — ไม่ bump `schema_v`. `_users` ที่เป็น SA อยู่แล้วถ้าผสม shelter scope ต้องแก้ด้วยมือให้เหลือ
`["system_admin"]` ก่อนพึ่ง UI แก้ (UI/BFF จะปฏิเสธ PUT รูปผสม). Couch `_admin` ไม่ถูก migrate

## Decision log

- 2026-08-14 — proposed ในแผน feature; tracking = CR ไฟล์
- 2026-08-14 — approved โดย project owner (สั่ง implement แผน); grant SA = app `system_admin`
  เท่านั้น; bootstrap admin = CouchDB `COUCHDB_USER` ห้ามลบ/แก้ผ่านแอปเด็ดขาด
- 2026-08-14 — done: BFF + UI portal + seed sa01 + E2E + spec sync
- 2026-08-14 — **partially superseded by CR-075**: grant SA gate เปิดให้ Couch `_admin` ด้วย;
  exclusive roles / last-SA / bootstrap lock ของ CR-074 ยังใช้ต่อ
