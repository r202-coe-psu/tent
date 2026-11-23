---
id: draft
title: จัดการผู้ใช้ (User Management) ตรวจสิทธิ์ SM ในศูนย์ที่ทำงานอยู่ แทนศูนย์แรก
status: proposed
date: 2026-11-11
updated: 2026-11-24
requested_by: RBAC audit follow-ups (#473 → #477 ส่วน user management)
decided_by: <รอเจ้าของโครงการ>
layer: volatile # แตะ authz ของ BFF แต่ไม่เปลี่ยน auth/_session/envelope
affects:
  - docs/prd/role-permission-matrix.md §3 แถว User Management (ไม่เปลี่ยนตาราง — ดู "Why")
  - frontend/src/lib/server/couch-admin.ts (authorizeUserWrite, assertCanGrant, activeManagerShelter)
  - frontend/src/lib/server/user-service.ts (createOrMergeUser, listUsers, managerMayMutateTarget → updateUser/deleteUser, การตรวจ permanent_roles)
  - frontend/src/routes/api/v1/users/+server.ts
  - frontend/src/lib/features/users (users.api, queries, ui: user-create-page, user-edit-page, user-management-page)
  - frontend/src/lib/features/volunteers/application/volunteer-access.ts (ส่งศูนย์ของอาสาสมัครไปกับ listUsers/createUser/updateUser)
  - schema_v ไม่เปลี่ยน
---

# จัดการผู้ใช้ตรวจสิทธิ์ SM ในศูนย์ที่ทำงานอยู่ แทนศูนย์แรก

> **สรุป (TL;DR)**
> - **เปลี่ยนอะไร:** งานเขียนผู้ใช้ (สร้าง/merge/แก้/ลบ/ดูรายชื่อผู้ใช้) ของ SM ที่ดูแลหลายศูนย์ ต้องตรวจและใช้ศูนย์ที่ระบุใน request (`shelter_code`) แทนศูนย์แรกใน roles
> - **เพื่อใคร/ทำไม:** SM หลายศูนย์ ปัจจุบันถูกผูกกับศูนย์แรก ทำให้จัดการผู้ใช้ของศูนย์อื่นที่ตนเป็น SM ไม่ได้ และ grant ผิดศูนย์ได้
> - **dev ต้อง build:** ส่ง active shelter เข้า `authorizeUserWrite` → service และให้ UI ส่ง `shelter_code` ทุกคำขอ
> - **กระทบ:** ไม่เปลี่ยน schema, ไม่เปลี่ยนตารางสิทธิ์; เปลี่ยนพฤติกรรม API (SM หลายศูนย์ไม่ส่ง `shelter_code` ได้ 400)

## Requirements

- **FR-1** — `authorizeUserWrite` ต้องรับ `requestedShelter` และคืน `shelterCode` ที่ resolve แล้วด้วย `resolveActiveShelter` (เช่นเดียวกับ `authorizeTransfer`, #1205)
- **FR-2** — non-SA ส่ง `shelter_code`: ใช้ศูนย์นั้นเมื่อถือ `shelter_manager` ในศูนย์นั้น ไม่ถือ → `403`
- **FR-3** — non-SA ไม่ส่ง `shelter_code` และถือ `shelter_manager` หลายศูนย์ → `400`; ศูนย์เดียว → ใช้ศูนย์นั้น
- **FR-4** — `createOrMergeUser` (ทาง CONFLICT merge), `listUsers`, `managerMayMutateTarget` (ใช้ใน `updateUser`/`deleteUser`) และการตรวจ `permanent_roles` ใน `updateUser` ต้องใช้ศูนย์ที่ resolve แล้วจาก FR-1 ไม่ใช้ `managerShelterCodes(...)[0]`; `listUsers` ของ SM คืนเฉพาะผู้ใช้ของศูนย์นั้น (เดิมคืนทุกศูนย์ที่ดูแล)
- **FR-5** — SM ต้อง grant/แก้ role ได้เฉพาะ role ที่ขึ้นต้นด้วย `{ศูนย์ที่ resolve}:` (`assertCanGrant` เทียบกับศูนย์ที่ทำงานอยู่ ไม่ใช่ทุกศูนย์ที่ดูแล); กฎเดิม "เฉพาะ staff, ห้าม shelter_manager/system_admin" คงเดิม
- **FR-6** — SA: พฤติกรรมเดิมทุกประการ
- **FR-7** — หน้า `user-create-page`, `user-edit-page`, `user-management-page` และ `grantVolunteerAccess` ต้องส่ง `shelter_code` ของศูนย์ที่ active (ของอาสาสมัครสำหรับ `grantVolunteerAccess`) ไปกับทุกคำขอเขียน/อ่านรายชื่อ และไม่ใช้ `shelterCodeFromRoles` (ศูนย์แรก) เลือกศูนย์; SA ไม่ส่ง
- **FR-8** — route อื่นที่เรียก `authorizeUserWrite` (app-config, api-keys, thirdparty-clients, staff-card, ThaID/Google unlink, partner-logos, …) ไม่ส่งศูนย์ → ตรวจแค่ "SA หรือ SM" เหมือนเดิม ไม่เปลี่ยนพฤติกรรม

## Acceptance

- SM ถือ `SH001:shelter_manager` + `SH002:shelter_manager` ทำงานใน SH002: สร้าง/แก้/ลบผู้ใช้ของ SH002 สำเร็จ (ก่อนแก้ถูกตรวจกับ SH001)
- ผู้ใช้ที่เป็น `shelter_manager` ใน SH002 แต่เป็นแค่ staff ใน SH001 ขอ `shelter_code=SH001` → `403` และไม่มีการเขียน `_users`
- SM หลายศูนย์ไม่ส่ง `shelter_code` → `400`
- SM พยายามตั้ง `permanent_roles` ของศูนย์อื่นนอกศูนย์ที่ resolve → `403`
- SA ทำงานเหมือนเดิม; test เดิมของ `/api/v1/users` ผ่าน
- SM หลายศูนย์ทำงานใน SH002 ขอ grant role ของ SH001 (ศูนย์ที่ตนก็ดูแล) → `403`
- มี test ฝั่ง server ครบทุก FR-1..5 และ test ว่า users API client กับ `grantVolunteerAccess` ส่ง `shelter_code`

## Why

- #473 audit พบว่า BFF ตรวจ capability จาก "ศูนย์ใดก็ได้" แต่ทำงานกับศูนย์แรกใน roles; #1205 แก้ donations/referral/transfer แล้ว #1327 แก้ `stock/incoming` ส่วน user management ยังค้าง (บันทึกใน `docs/plans/rbac-audit-follow-ups-473-2026-10-30.md`)
- **spec เดิมกำหนดสิทธิ์รายศูนย์อยู่แล้ว:** `role-permission-matrix.md` แถว User Management ช่อง SM = `scope` ("สร้าง/แก้ไขผู้ใช้ประจำศูนย์ตน") และ §ข้ามหลายศูนย์ ระบุเป้าหมาย "ไม่มี Privilege Bleeding" การเปลี่ยนนี้จึงเป็นการทำให้ implementation ตรง spec ไม่ได้เพิ่มหรือลดสิทธิ์ที่ตารางกำหนด
- ถือเป็น **implementation ตาม spec เดิม** จึง track เป็น CR แบบเบา (ตัดสิน 2026-11-24)

## Impact

- **API:** `/api/v1/users` (GET/POST/PUT/DELETE) รับ `?shelter_code=`; SM หลายศูนย์ไม่ส่ง → `400` (เดิมตกไปศูนย์แรกเงียบ ๆ); `GET` ของ SM คืนเฉพาะศูนย์ที่ระบุ (เดิมทุกศูนย์ที่ดูแล)
- **UI:** 3 หน้า users + `grantVolunteerAccess` ส่ง `shelter_code`
- **ไม่กระทบ:** schema, `_users` doc shape, ตารางสิทธิ์, `validate_doc_update`
- **ตรวจแล้ว:** `grantCoordinatorRole` / `revokeCoordinatorGrant` (#1044) ไม่ใช้ `managerShelterCodes(...)[0]` จึงไม่แก้
- **ไม่อยู่ใน CR นี้:** `listShelterStaffDirectory` (รับ `code` จาก URL และผ่าน `requireShelterScopeOrSA` อยู่แล้ว), `staff-card-service.ts` (ใช้ `managerShelterCodes` แบบเดียวกัน — ติดตามต่อแยก)
- **แยก PR:** ทำเป็น 2 commit ได้ (1) server + test (2) UI — ถ้าปล่อย (1) เดี่ยว SM หลายศูนย์จะได้ `400` บนหน้าผู้ใช้จนกว่า (2) จะตามมา จึงควร merge พร้อมกัน

## Migration

N/A — ไม่เปลี่ยนรูป doc ที่ persist; ไม่ bump `schema_v`

## Decision log

- 2026-11-11 — proposed (วิธี track = CR file ตามที่เจ้าของโครงการเลือก)
- 2026-11-13 — เติม scope ตามที่ implement จริง (listUsers, assertCanGrant, volunteer-access); เลขที่ CR ให้ lead รันตอน PR (ยังเป็น `draft`)
- 2026-11-24 — ผู้รับผิดชอบเลือก: ถือเป็น implementation ตาม spec เดิม, track เป็น CR แบบเบา (ไฟล์นี้)
