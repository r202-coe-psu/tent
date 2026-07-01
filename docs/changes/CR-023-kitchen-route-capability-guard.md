---
id: CR-023
title: Kitchen back-office routes require kitchen_staff capability (T-25)
status: approved
date: 2026-07-01
requested_by: PR #48 review (net-lynx) — route guard hardening
decided_by: project owner (session 2026-07-01)
layer: stable
affects:
  - docs/prd/role-permission-matrix.md (kitchen module access)
  - frontend/src/lib/guards/auth.ts (requireKitchen ใหม่)
  - frontend/src/lib/auth/roles.ts (hasStaffCapability helper)
  - frontend/src/routes/(protected)/back-office/kitchen/**/+page.ts
---

# CR-023 — Kitchen route capability guard

## Why

`/back-office/kitchen/*` เดิม guard ด้วย `requireAuth` เท่านั้น → user ที่ login ทุกคน (รวม
registration_staff, warehouse_staff) เข้าถึงและสร้าง/ยืนยันแผนอาหารได้ ซึ่งไม่ตรงกับหลัก
least-privilege (security-rbac guideline). PR #48 review ชี้ว่าครัวควรจำกัดเฉพาะผู้ที่มีหน้าที่ครัว.

## Change

- เพิ่ม guard `requireKitchen()` — อนุญาต `system_admin` | `shelter_manager` | `kitchen_staff`
- เปลี่ยน `+page.ts` ของ 3 route (`kitchen`, `kitchen/gas`, `kitchen/production-board`) จาก
  `requireAuth` → `requireKitchen`
- เพิ่ม helper `hasStaffCapability(roles, cap)` ใน `roles.ts`

> **หมายเหตุ:** guard นี้เป็น **UX gate** ชั้น client. ขอบเขต authorization จริงยังอยู่ที่ data layer /
> BFF (ตาม CLAUDE.md). ไม่ได้แทนที่การตรวจสิทธิ์ฝั่ง server.

## Impact

- role-permission matrix: Kitchen module access = system_admin / shelter_manager / kitchen_staff
- code: guards/auth.ts, auth/roles.ts, 3 kitchen route load functions
- ผู้ใช้ที่ไม่มีสิทธิ์ครัว → redirect ไป `/` (LANDING_ROUTE)

## Migration

N/A — ไม่มีการเปลี่ยนรูปร่าง persisted doc; เป็นการเข้มงวด client route guard.
ต้องมั่นใจว่า kitchen staff จริงได้รับ role `kitchen_staff` (ตอน seed/สร้าง user) — user เดิมที่เคย
เข้าครัวได้แต่ไม่มี capability จะถูก redirect จนกว่าจะได้รับ role

## Decision log

- 2026-07-01 — proposed จาก PR #48 review (route guard warning)
- 2026-07-01 — approved โดย project owner; guard = system_admin | shelter_manager | kitchen_staff;
  tracking = CR file
