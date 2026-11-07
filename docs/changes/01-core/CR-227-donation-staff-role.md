---
id: CR-227
title: เพิ่มบทบาท donation_staff (เจ้าหน้าที่รับบริจาค) แบบระบุศูนย์ {code}:donation_staff — ทำงานบริจาคครบ ดูคลังอย่างเดียว
status: approved
date: 2026-11-04
updated: 2026-11-04
requested_by: ทีม (GitHub issue #1121 — Donation Staff role)
decided_by: Soravit Sukkarn (Team Lead)
layer: volatile
affects:
  - docs/prd/role-permission-matrix.md §1.1, §3
  - docs/data/api-contract.md (VC grantable role list)
  - docs/data/schema.md (stock_ledger VDU rule)
  - frontend/src/lib/auth/roles.ts (STAFF_CAPABILITIES, COORDINATOR_GRANTABLE_CAPABILITIES, label, new predicates)
  - frontend/src/lib/guards/auth.ts (requireDonationAccess, requireSupplyView)
  - frontend/src/lib/features/backoffice-navbar/static.ts
  - frontend/src/lib/features/portal/domain/portal-menu.ts, portal-preview.ts
  - frontend/src/lib/server/donation-intake.ts (authorizeDonation) + routes/api/back-office/donations/**
  - frontend/src/lib/server/shelter-access-design.ts (validate_doc_update — stock_ledger donation branch)
  - frontend/src/lib/features/catalog (canWriteShelterCatalog, enforceWriteAccess)
  - frontend/scripts/sync-central-db.ts, frontend/scripts/seed/master-seed.ts (catalog VDU)
  - frontend/src/lib/features/operations/ui (stock UI read-only for DON)
  - frontend/src/lib/features/users/ui/user-form.svelte, volunteer-access dialog + enums
  - no schema_v bump
why: งานบริจาคทั้งหมดผูกกับสิทธิ์คลัง — ผู้ดูแลงานบริจาคต้องได้ warehouse_staff ซึ่งติดสิทธิ์ปรับยอด เบิกจ่าย โอน merge จองล็อต ตั๋วเบิกไปด้วยเกินหน้าที่
migration: N/A สำหรับ schema — เพิ่มค่าใน role vocabulary; ต้อง redeploy VDU (shelter_* + catalog) ก่อนใช้งาน (ดู Migration)
---

# CR-227: เพิ่มบทบาท `donation_staff` (เจ้าหน้าที่รับบริจาค)

## Summary

เพิ่ม staff capability `donation_staff` (ตัวย่อ **DON**) สำหรับเจ้าหน้าที่ที่ดูแลงานบริจาคของศูนย์ตน
(`shelter:{code}` + `{code}:donation_staff`) — ทำงาน donation ได้ครบ สร้าง/แก้/ลบสินค้าใน catalog ของศูนย์ได้
เห็นหน้าคลังแบบอ่านอย่างเดียว แต่ปรับยอด เบิกจ่าย โอน merge จองล็อต และใบเบิกไม่ได้.
เป็นการ**เพิ่ม** role ไม่ใช่ย้ายสิทธิ์: `warehouse_staff` เดิมทำทุกอย่างได้เหมือนเดิม ไม่ต้อง migrate ผู้ใช้.

## Why

ถ้าจะให้ใครทำงานบริจาค ต้องออก `warehouse_staff` ซึ่งได้สิทธิ์คลังทั้งหมดติดไปด้วย (ปรับยอด, เบิกจ่ายตรง,
`distribution_batch`, merge สินค้า, จองล็อต, โอนข้ามศูนย์, ตั๋วเบิก) — ขัดหลัก least privilege
(แบบอย่าง [CR-161](CR-161-distribution-staff-role.md) ที่เพิ่ม `distribution_staff`).

## Change

### Requirements

- **R1** `_users.roles` รองรับ `{code}:donation_staff` (compound) และ legacy flat `donation_staff`
  เมื่อผู้ใช้มีศูนย์เดียว — ตามกติกา CR-093 เดิม.
- **R2** `donation_staff` เป็น `STAFF_CAPABILITIES` (SA มอบได้ทุกศูนย์, SM มอบในศูนย์ตน) และอยู่ใน
  `COORDINATOR_GRANTABLE_CAPABILITIES` (VC ออกสิทธิ์แบบจำกัดเวลาตาม CR-213 — ไม่เกิน 7 วัน — ทั้งฟอร์มจัดการผู้ใช้และ
  dialog "ออกสิทธิ์จิตอาสา"). ป้ายภาษาไทย: **เจ้าหน้าที่รับบริจาค**. จึงเป็น role ที่ VC ออกได้ 11 role.
- **R3** ในศูนย์ของตน `donation_staff` ทำได้ (client gate, BFF และ `validate_doc_update`):

  | เอกสาร / การกระทำ                                                                                                                       | before                                 | after                                                                                         |
  | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
  | หน้า `/back-office/stock-donations` + เมนู "บริจาค" (back-office nav, portal menu)                                                      | SA, SM, WH, SC                         | + DON                                                                                         |
  | Donation API ทุกตัว (`/api/back-office/donations/**`: list, walk-in, approve, reject, redirect, close, contact, receive, search, audit) | SA, SM, WH                             | + DON (จำกัดศูนย์ตน)                                                                          |
  | scan station (รับ/walk-in/ปิด/ส่งต่อ/ปฏิเสธ)                                                                                            | SA, SM, WH, SC                         | + DON                                                                                         |
  | `stock_ledger` `reason='donation'` (`qty > 0`, doc ใหม่) ผ่านทาง session (`receiveWalkInDonation`, `receiveDonationBatch`)              | WH, SC, SM, SA                         | + DON                                                                                         |
  | `donation_campaign` สร้าง/แก้ไข                                                                                                         | ทุกสมาชิก shelter DB (ไม่มี role gate) | ไม่เปลี่ยน — DON ใช้ได้                                                                       |
  | catalog สินค้าของศูนย์ (`item_master` สร้าง/แก้/ลบ — `canWriteShelterCatalog`, `enforceWriteAccess`, catalog VDU)                       | SA, SM, WH                             | + DON                                                                                         |
  | หน้า `/back-office/supply` (สต็อก, ledger, Sphere, สินค้า)                                                                              | SA, SM, WH, SC                         | + DON **แบบอ่านอย่างเดียว** (ไม่มีปุ่มรับเข้า/ปรับยอด/ตรวจนับ/เบิก/โอนย้าย, ไม่มีแท็บโอนย้าย) |

- **R4** `donation_staff` **ทำไม่ได้** (ปฏิเสธที่ VDU/BFF ไม่ใช่แค่ซ่อนปุ่ม):
  `stock_ledger` reason อื่นนอกจาก `donation` (`adjust`, `distribute`, `receive`, `requisition`, …),
  `distribution_batch`, `stock_lot_reservation`, `requisition_ticket`, merge สินค้า (`merged_into`, ledger `adjust_reason='merge'`),
  โอนย้าย (`/api/back-office/transfer/**`), ใบเบิกวัตถุดิบครัว, หน้า `/back-office/distribution` และ `/back-office/tickets`.
- **R5** ข้ามศูนย์ไม่ได้: `SH001:donation_staff` ไม่มีสิทธิ์ใน `shelter_SH002` ทั้งที่ VDU และ BFF (BFF scope ศูนย์สำหรับ DON;
  ช่องว่าง `warehouse_staff` ไม่ผูกศูนย์ของ #477 คงเดิม ไม่แก้ใน CR นี้).
- **R6** `canAccessWarehouse` / `canAccessTickets` / alias SC→WS **ไม่ขยาย** — เพิ่ม predicate ใหม่
  (`canAccessDonations`, `canViewSupply`) เพื่อไม่เปิดเมนูเบิกจ่าย โอน ใบเบิกให้ DON.

## Impact

- Docs: `docs/prd/role-permission-matrix.md` §1.1 (แถว DON), §3 (คอลัมน์ DON + แถว Donation + หมายเหตุ);
  `docs/data/api-contract.md` (รายการ role ที่ VC ออกได้ 10 → 11); `docs/data/schema.md` (ข้อยกเว้น `stock_ledger` ของ DON).
- Code: ตาม `affects`. VDU (`shelter-access-design.ts`) ต้อง **push design doc ใหม่ไปทุก `shelter_{code}`** และ catalog VDU
  (`sync-central-db.ts`) ต้อง push ไป `catalog` หลัง merge จึงจะมีผลที่ CouchDB.
- Tests: `roles.test.ts`, `role-grants.test.ts`, `volunteer-access-grant.test.ts`, `guards/auth.test.ts`, `static.test.ts`,
  `static.guards.test.ts`, `portal-menu.test.ts`, `portal-preview.test.ts`, `catalog-permissions.test.ts`,
  `shelter-access-design.test.ts`, BFF donation route tests (DON allowed / ศูนย์อื่น 403), transfer auth (ปฏิเสธ DON),
  stock UI dom tests, e2e `donation-staff.test.ts`.
- ความเสี่ยงที่ทราบ (ไม่แก้ใน CR นี้): `supply_coordinator` เข้าหน้า/เมนูบริจาคได้แต่ donation API ตอบ 403;
  item_master ใน shelter DB ไม่มี role gate ที่ VDU (มีแต่ `merged_into`).

## Migration

N/A — ไม่เปลี่ยนรูปร่าง doc ที่ persist, ไม่ bump `schema_v`; ผู้ใช้เดิมไม่ต้อง migrate.

**ต้องทำตอน deploy (ops):** redeploy VDU ของทุก `shelter_{code}` (`frontend/scripts/redeploy-access.ts`) และ catalog DB
(`frontend/scripts/sync-central-db.ts`) หลัง merge. ก่อน redeploy ผู้ใช้ DON จะรับของผ่าน BFF ได้
แต่ทาง session (`receiveWalkInDonation`/`receiveDonationBatch`) และการสร้างสินค้าจะถูก VDU เดิมปฏิเสธ.

## Decision log

- 2026-11-04 — approved: เจ้าของโครงการเคาะรายละเอียดตามข้อตัดสินใจใน issue #1121 (grill) และสั่งให้บันทึกเป็น CR-227 สถานะ approved โดยตรง.
- 2026-11-04 — ข้อตัดสินใจย่อย: (1) DON ได้สิทธิ์เขียน catalog ของศูนย์เต็ม (สร้าง/แก้/ลบ) แต่ **merge** ยังเป็น SM/WS เท่านั้น;
  (2) ทาง session walk-in เลือก "ยอมใน VDU" — DON เขียน `stock_ledger` ได้เฉพาะ `reason='donation'` + `qty > 0` doc ใหม่ ไม่ย้ายไป BFF;
  (3) DON สร้าง/แก้ donation campaign ได้; (4) BFF DON จำกัดศูนย์ตน, ไม่แก้ช่องว่าง WS ของ #477.
