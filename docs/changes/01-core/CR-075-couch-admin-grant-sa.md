---
id: CR-075
title: Couch _admin เทียบเท่า SA สำหรับ grant system_admin
status: done
date: 2026-08-14
requested_by: project owner (login Couch admin แล้วสร้าง SA ไม่ได้)
decided_by: project owner (ยืนยัน 2026-08-14)
layer: volatile
affects:
  - docs/prd/role-permission-matrix.md §3 FR-34
  - docs/data/api-contract.md §3
  - docs/uat/smart-shelter-uat-checklist.csv UAT-122
  - frontend/src/lib/server/couch-admin.ts (assertCanGrant)
  - frontend/src/lib/server/couch-admin.test.ts
  - frontend/e2e/users/access-control.test.ts
supersedes_slice_of: CR-074 (grant SA gate เท่านั้น — exclusive roles / last-SA / bootstrap lock คงเดิม)
---

# CR-075 — Couch `_admin` grant `system_admin` ได้ (SA-equivalent)

## Why

CR-074 จำกัด mint `system_admin` ผ่าน `/api/v1/users` ให้เฉพาะ caller ที่ถือ app RoleKey
`system_admin` — Couch `_admin` ที่ login ผ่านแอปสร้าง SA ไม่ได้ ทั้งที่ `isSystemAdmin()`
ถือ `_admin` เป็น SA-equivalent ในที่อื่น และเจ้าของโครงการต้องการให้ผู้ดูแล CouchDB
จัดการ user SA ได้ (bootstrap / ยังไม่มี app SA ในระบบ)

## Change

**ก่อน (CR-074):** `assertCanGrant` ใช้ `isAppSystemAdmin(caller.roles)` → Couch `_admin` ได้
`FORBIDDEN` เมื่อ grant `system_admin`

**หลัง:** ใช้ `caller.isSA` (`isSystemAdmin` = `system_admin` **หรือ** `_admin`) สำหรับเกต
grant SA. ข้ออื่นของ CR-074 คงเดิม:

- exclusive `["system_admin"]` (ไม่ผสม shelter/capability)
- last app-SA ห้ามลบ/ลด
- bootstrap Couch admin ห้ามลบ/แก้/สร้างทับผ่านแอป
- ห้าม grant `_admin` ผ่านแอป

## Impact

- role-permission-matrix FR-34 หมายเหตุ grant SA
- api-contract.md §3
- UAT-122 อ้าง CR-075
- unit + e2e access-control

## Migration

N/A — ไม่ bump `schema_v`

## Decision log

- 2026-08-14 — owner รายงาน error `Only a system_admin may grant the system_admin role`
  เมื่อสร้าง admin ด้วยรหัส CouchDB; ยืนยันให้ `_admin` เทียบเท่า SA สำหรับ grant;
  track = CR ไฟล์
- 2026-08-14 — done: `assertCanGrant` + tests + spec sync
