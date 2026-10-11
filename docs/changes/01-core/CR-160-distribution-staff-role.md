---
id: CR-160
title: เพิ่มบทบาท distribution_staff (เจ้าหน้าที่แจกจ่าย) แบบระบุศูนย์ {code}:distribution_staff
status: approved
date: 2026-10-11
updated: 2026-10-11
requested_by: ทีม (GitHub issue — Distribution Staff role)
decided_by: เจ้าของโครงการ
layer: volatile
affects:
  - docs/prd/role-permission-matrix.md §1.1, §3
  - frontend/src/lib/auth/roles.ts (STAFF_CAPABILITIES, label)
  - frontend/src/lib/features/distribution/application/food-supplies/auth.ts
  - frontend/src/lib/features/distribution/data/distribution.remote.ts
  - frontend/src/lib/server/shelter-access-design.ts (validate_doc_update)
  - frontend/src/lib/guards/auth.ts (requireDistributionDesk)
  - frontend/src/lib/features/portal/domain/portal-menu.ts (frontline-distribution tile)
  - frontend/src/lib/features/users/ui/user-form.svelte
  - no schema_v bump
why: ต้องการบทบาทเฉพาะสำหรับผู้ปฏิบัติงานจุดแจกจ่ายอาหาร/สิ่งของ โดยไม่ต้องให้สิทธิ์ registration_staff (PII ทะเบียน) หรือ warehouse_staff (คลัง) เกินหน้าที่
migration: N/A — เพิ่มค่าใน role vocabulary เท่านั้น; ผู้ใช้เดิมไม่เปลี่ยน
---

# CR-160: เพิ่มบทบาท `distribution_staff` (เจ้าหน้าที่แจกจ่าย)

## Summary

เพิ่ม capability ใหม่ `distribution_staff` ใน role kernel ให้ผู้ใช้ทำงานที่ Distribution Desk
(Station 4, `/onsite/distribution`) ได้ **เฉพาะศูนย์ของตน** (`shelter:{code}` + `{code}:distribution_staff`).
สิทธิ์ = สิทธิ์ frontline distribution ที่ `registration_staff` มีอยู่ในงานแจกจ่าย — ไม่รวมงานทะเบียน
ผู้ประสบภัย และไม่รวมงานคลัง/ใบเบิก.

## Why

ศูนย์ใช้เจ้าหน้าที่/อาสาแยกเฉพาะจุดแจกจ่าย. เดิมต้องให้ `registration_staff` ซึ่งเปิดการแก้ไข
ทะเบียนผู้ประสบภัย (PII) โดยไม่จำเป็น — ขัดหลัก least privilege.

## Change

### Requirements

- **R1** `_users.roles` รองรับ `{code}:distribution_staff` (compound) และ legacy flat `distribution_staff`
  เมื่อผู้ใช้มีศูนย์เดียว — ตามกติกา CR-093 เดิม.
- **R2** `distribution_staff` เป็น `STAFF_CAPABILITIES` → SM มอบให้เจ้าหน้าที่ในศูนย์ตนได้, SA มอบได้ทุกศูนย์
  ผ่านฟอร์มจัดการผู้ใช้. ป้ายภาษาไทย: **เจ้าหน้าที่แจกจ่าย**.
- **R3** ในศูนย์ของตน `distribution_staff` ทำได้ (ทั้ง client gate และ `validate_doc_update`):

  | เอกสาร / การกระทำ | before | after |
  | --- | --- | --- |
  | `distribution_request` สร้าง/ยกเลิก | REG, SM, SA | + DST |
  | `distribution_issue`, `_idempotency`, `_capacity`, `_one_time_guard` | REG, SM, SA | + DST |
  | `distribution_issue_gate` (ฝั่ง Issue) | REG, SM, SA | + DST |
  | Frontline Step 4 / 4B / 5 / 6 (`canPerformFrontlineDistribution`) | REG, SC, SM, SA | + DST |
  | `bulk_return_pool` claim, `bulk_return_claim` | REG, SC, SM, SA | + DST |
  | `loan_return_reservation` mode `BULK` / `NON_PHYSICAL` | REG, SC, SM, SA | + DST |
  | อ่านรายการแจกจ่าย / issue | REG, WS, SM, SA | + DST |

- **R4** `distribution_staff` **ทำไม่ได้**: สร้าง/อนุมัติ/dispatch ใบเบิก (ticket), รับของเข้าคลัง
  (`PHYSICAL`), ปิด gate ฝั่งคลัง, เข้า back-office, งานทะเบียนผู้ประสบภัย.
- **R5** Route guard `requireDistributionDesk` และไทล์ "จุดแจกจ่ายพัสดุและอาหาร" ใน `/onsite`
  รวมถึงไทล์ `frontline-distribution` บน `/portal` (`portal-menu.ts`) แสดงให้ `distribution_staff` ของศูนย์ที่เลือกอยู่.
- **R6** ข้ามศูนย์ไม่ได้: `SH001:distribution_staff` ไม่มีสิทธิ์ใน `shelter_SH002`.

## Impact

- Docs: `docs/prd/role-permission-matrix.md` §1.1 (แถว DST) + §3 (คอลัมน์ DST, แถว Distribution Desk).
- Code: ตาม `affects`. VDU (`shelter-access-design.ts`) ต้อง **push design doc ใหม่ไปทุก `shelter_{code}`**
  หลัง merge จึงจะมีผลที่ CouchDB.
- Tests: `roles.test.ts`, `guards/auth.test.ts`, `distribution/application/food-supplies/auth.test.ts`,
  `shelter-access-design.test.ts`, `distribution.remote.test.ts`, `portal-menu.test.ts`.
- หมายเหตุ: เมนูบน `/portal` ถูกขับเคลื่อนโดย `portal-menu.ts` (PR #452) ต้องเพิ่ม capability ของ `distribution_staff`
  ให้กับรายการ `frontline-distribution` (`/onsite/distribution`) พร้อมอัปเดต test `portal-menu.test.ts`.

## Migration

N/A — ไม่เปลี่ยนรูปร่าง doc ที่ persist, ไม่ bump `schema_v`.

## Decision log

- 2026-10-11 — proposed; owner เคาะแนวทาง (decision a) ใน issue แล้ว, implement บน branch.
- 2026-10-11 — approved โดยเจ้าของโครงการ (decision a, รันเลข CR-160).
