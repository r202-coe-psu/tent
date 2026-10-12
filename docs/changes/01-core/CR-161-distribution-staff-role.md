---
id: CR-161
title: เพิ่มบทบาท distribution_staff (เจ้าหน้าที่แจกจ่าย) แบบระบุศูนย์ {code}:distribution_staff
status: approved
date: 2026-10-11
updated: 2026-10-11
requested_by: ทีม (GitHub issue — Distribution Staff role)
decided_by: Kong
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
migration: N/A สำหรับ schema — เพิ่มค่าใน role vocabulary; REG, SC, WH เสียสิทธิ์หน้า /onsite/distribution (ดู Migration)
---

# CR-161: เพิ่มบทบาท `distribution_staff` (เจ้าหน้าที่แจกจ่าย)

## Summary

เพิ่ม capability ใหม่ `distribution_staff` ใน role kernel ให้ผู้ใช้ทำงานที่ Distribution Desk
(Station 4, `/onsite/distribution`) ได้ **เฉพาะศูนย์ของตน** (`shelter:{code}` + `{code}:distribution_staff`).
สิทธิ์ของหน้า `/onsite/distribution` = SA, SM, DST ตาม CR-159 บังคับใช้ระดับหน้า — ไม่รวมงานทะเบียน
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
  | `distribution_request` สร้าง/ยกเลิก | REG, SM, SA | SA, SM, DST (REG ถูกตัดออกตาม CR-159) |
  | `distribution_issue`, `_idempotency`, `_capacity`, `_one_time_guard` | REG, SM, SA | SA, SM, DST (REG ถูกตัดออกตาม CR-159) |
  | `distribution_issue_gate` (ฝั่ง Issue) | REG, SM, SA | SA, SM, DST (REG ถูกตัดออกตาม CR-159) |
  | Frontline Step 4 / 4B / 5 / 6 (`canPerformFrontlineDistribution`) | REG, SC, SM, SA | SA, SM, DST (REG, SC ถูกตัดออกจาก `/onsite/distribution` ตาม CR-159) |
  | `bulk_return_pool` claim, `bulk_return_claim` | REG, SC, SM, SA | + DST (ข้อยกเว้น: คงสิทธิ์ระดับระบบเดิม; การจำกัดหน้าตาม CR-159 เป็นระดับหน้า) |
  | `loan_return_reservation` mode `BULK` / `NON_PHYSICAL` | REG, SC, SM, SA | SA, SM, DST (REG, SC ถูกตัดออกตาม CR-159) |
  | อ่านรายการแจกจ่าย / issue | REG, WH, SM, SA | SA, SM, DST (REG, WH ถูกตัดออกตาม CR-159) |
  | รับคืนแบบมีของ (`PHYSICAL` → `receive` เข้าคลัง) | WH, SC, SM, SA | + DST |

- **R4** `distribution_staff` **ทำไม่ได้**: สร้าง/อนุมัติ/dispatch ใบเบิก (ticket), ปิด gate ฝั่งคลัง, เข้า back-office, งานทะเบียนผู้ประสบภัย. (รับคืนแบบมีของ `PHYSICAL` ย้ายไปเป็นสิทธิ์ใน R3 ตามคำสั่ง Kong 2026-10-11)
- **R5** Route guard `requireDistributionDesk` และไทล์ "จุดแจกจ่ายพัสดุและอาหาร" ใน `/onsite`
  รวมถึงไทล์ `frontline-distribution` บน `/portal` (`portal-menu.ts`) แสดงให้ `distribution_staff` ของศูนย์ที่เลือกอยู่.
- **R6** ข้ามศูนย์ไม่ได้: `SH001:distribution_staff` ไม่มีสิทธิ์ใน `shelter_SH002`.

## Impact

- Docs: `docs/prd/role-permission-matrix.md` §1.1 (แถว DST) + §3 (คอลัมน์ DST, แถว Distribution Desk).
- Docs (ต้องทำตามมา): `docs/data/schema.md` §2.33 และ VDU Rule 16 — โหมด `PHYSICAL` ของ `distribution_log` ต้องเพิ่ม DST ยังไม่ได้แก้ใน CR นี้.
- Code: ตาม `affects`. VDU (`shelter-access-design.ts`) ต้อง **push design doc ใหม่ไปทุก `shelter_{code}`**
  หลัง merge จึงจะมีผลที่ CouchDB.
- Tests: `roles.test.ts`, `guards/auth.test.ts`, `distribution/application/food-supplies/auth.test.ts`,
  `shelter-access-design.test.ts`, `distribution.remote.test.ts`, `portal-menu.test.ts`.
  ค่าคาดหวังที่ต้องเปลี่ยน: REG, SC, WH ไม่ผ่าน `canPerformFrontlineDistribution` / `requireDistributionDesk` อีกต่อไป.
- หมายเหตุ: เมนูบน `/portal` ถูกขับเคลื่อนโดย `portal-menu.ts` (PR #452) ต้องเพิ่ม capability ของ `distribution_staff`
  ให้กับรายการ `frontline-distribution` (`/onsite/distribution`) พร้อมอัปเดต test `portal-menu.test.ts`.

## Migration

N/A — ไม่เปลี่ยนรูปร่าง doc ที่ persist, ไม่ bump `schema_v`.

**ผู้ใช้ที่เสียสิทธิ์:** REG, SC, WH เข้า `/onsite/distribution` ไม่ได้อีกต่อไปตาม CR-159 ผู้ใช้ที่มี role เหล่านี้และใช้หน้านี้อยู่ต้องได้รับ DST หรือถูกมอบสิทธิ์ใหม่โดย SM/SA. ผู้ใช้ที่ไม่ได้ใช้หน้านี้ไม่กระทบ. สิทธิ์ระดับระบบของ WH และ SC สำหรับงานคลัง (รับคืนที่คลัง, สร้าง bulk pool) ไม่เปลี่ยน.

## Decision log

- 2026-10-11 — proposed; owner เคาะแนวทาง (decision a) ใน issue แล้ว, implement บน branch.
- 2026-10-11 — approved โดย Kong (decision a, เดิมรันเลข CR-160; เปลี่ยนเป็น CR-161 เพื่อแก้เลขซ้ำกับ CR-160 e2e RATE_LIMIT switch).
- 2026-10-11 — แก้ตามคำสั่ง Kong: `distribution_staff` รับคืนแบบมีของ (`PHYSICAL`) ได้ — ย้ายจาก R4 ไป R3 (แถวใหม่ในตาราง).
- 2026-10-11 — ยืนยันข้อเสนอ: การจำกัด `/onsite/distribution` เป็นระดับหน้า. แถว PHYSICAL คืนเป็น WH, SC, SM, SA + DST (ไม่แตะ `canReceivePhysicalStock`). แถว claim คืนเป็น REG, SC, SM, SA + DST เป็นข้อยกเว้น. แถว Frontline, loan BULK/NON_PHYSICAL, request, issue, gate และอ่านรายการ ยังตามที่เลือกไว้ก่อนหน้า.
- 2026-10-11 — จำกัดขอบเขตให้ตรง CR-159: แถว Frontline, PHYSICAL และ bulk/loan ใน R3 ตัด REG, SC, WH ออกจากการใช้งานหน้า `/onsite/distribution` (ตามที่เลือกทางที่ 1). แถว capability อื่นไม่แก้.
- 2026-10-11 — ขยายทางที่ 1 ไปยังแถว `distribution_request`, `distribution_issue` (ทั้ง 4 แถวของ document), `distribution_issue_gate` และแถวอ่านรายการแจกจ่าย: ตัด REG ออก (และ WH ออกจากแถวอ่าน) ให้สอดคล้องกับ CR-159. แก้ `WS` เป็น `WH`.
