---
id: draft
title: แก้เพิ่ม CR-143 — เหตุผลของการรับเข้า manual, note ของเหตุผล other, และล็อตที่เกินอายุเก็บรักษา
status: proposed
date: 2026-10-07
updated: 2026-10-07
requested_by: project owner (ผล review PR #373 / #374 ของ GitHub #331)
decided_by: project owner
layer: volatile
amends: CR-143 (§A, §C)
affects:
  - docs/changes/CR-143-stock-redesign-rules.md §A FR-A4, §C FR-C1
  - docs/data/schema.md §2.1 stock_ledger (adjust_reason, note) — ไม่เปลี่ยนรูป doc, ไม่ bump schema_v
  - frontend/src/lib/features/operations/domain/operations.ts (adjustInputSchema, stockLedgerInputSchema, createStockLedger, buildReceiveEntry)
  - frontend/src/lib/features/operations/domain/lot-priority.ts (isUrgent, FR-A4)
  - frontend/src/lib/features/operations/ui/adjust-stock-form.svelte, distribute-stock-form.svelte
  - frontend/src/lib/server/shelter-access-design.ts (validate_doc_update — note ของ other)
  - GitHub #340 (PR #373), #343 (PR #374)
why: review ของ PR #373 และ #374 พบช่องว่างที่ CR-143 ไม่ได้ระบุ 3 จุด และ owner เลือกแนวทางแล้ว (C2, D2, G2)
migration: N/A — ไม่เพิ่ม/ลบ field, ไม่เปลี่ยนชนิด, ไม่ bump schema_v (note เป็น field เดิมของ FR-C1)
---

# แก้เพิ่ม CR-143 — รับเข้า manual, note ของ `other`, ล็อตเกินอายุเก็บรักษา

## สรุป (TL;DR)
- **เปลี่ยนอะไร:** เพิ่มกติกา 3 ข้อให้ CR-143 — (C) การรับเข้าแบบ manual บันทึกเป็น adjust `found`, (D) เหตุผล `other` ต้องมี `note`, (G) ล็อตที่เกินอายุเก็บรักษาถือเป็นหมดอายุแล้ว
- **เพื่อใคร:** เจ้าหน้าที่คลังและผู้ตรวจรายงานความสูญเสีย ให้เหตุผลในบัญชีไม่ปนกันและไม่เบิกของที่เกินอายุอัตโนมัติ
- **Dev ต้อง build:** แก้ domain + ฟอร์ม + `validate_doc_update` ตาม FR-C7–C9 และ FR-A4a ใน PR #374 (§C) และ PR #373 (§A)
- **กระทบ schema:** ไม่มี — ไม่ bump `schema_v`

## Requirements

### §C — เหตุผลของ adjust
- **FR-C7** การรับเข้าแบบ `source = manual` ที่ปัจจุบันบันทึกเป็น `reason: 'adjust'` ต้องบันทึกด้วย `adjust_reason: 'found'` แทน `other`
- **FR-C8** ฟอร์มรับเข้า manual ต้องไม่แสดงตัวเลือกเหตุผลให้ผู้ใช้เลือก (ค่า `found` ตายตัว)
- **FR-C9** เมื่อ `adjust_reason = 'other'` ต้องมี `note` ที่ไม่ว่าง (trim ≥ 1 ตัวอักษร, ≤ 500) ทั้งใน Zod (`adjustInputSchema`, `stockLedgerInputSchema`) ฟอร์มปรับยอด และ `validate_doc_update`
- **FR-C10** แถวที่มี `adjust_reason = 'other'` และไม่มี `note` ซึ่งเขียนก่อนกติกานี้ (schema_v ≤ 6) ต้องยังอ่านได้โดยไม่ throw; FR-C9 ใช้กับการเขียนใหม่เท่านั้น

### §A — ล็อตเกินอายุเก็บรักษา
- **FR-A4a** ล็อตที่ `lot.expiry` ว่าง และ `daysLeft ≤ 0` โดย `daysLeft` มาจาก `shelf_life_days − ageDays` (ไม่ใช่ `HORIZON`) ต้องถือเป็นหมดอายุแล้วเช่นเดียวกับ FR-A4: ไม่ถูกเลือกอัตโนมัติ ไม่อยู่ในกลุ่มเร่งด่วน และ UI ต้องแจ้งให้ปรับยอดออก
- **FR-A4b** `isUrgent` ต้องใช้กับล็อตที่ `0 < daysLeft ≤ URGENT_DAYS` เท่านั้น
- **FR-A4c** ล็อตที่ `daysLeft ≤ 0` เพราะ `HORIZON` ไม่ถือเป็นหมดอายุ (คง FR-A3a)

## Acceptance
- **AC-C5** รับเข้า manual 10 ชิ้น → ledger 1 แถว `reason: 'adjust'`, `adjust_reason: 'found'`
- **AC-C6** ปรับยอดด้วยเหตุผล `other` โดยไม่กรอก note → validation error ทั้ง Zod และ `validate_doc_update`
- **AC-C7** อ่านแถว `adjust` `other` เก่าที่ไม่มี note ได้ ยอดคงเหลือถูกต้อง
- **AC-A7** ล็อต `shelf_life_days = 30` อยู่ในคลัง 60 วัน ไม่มี expiry → ไม่ถูกเลือกอัตโนมัติ, ไม่อยู่ก่อนล็อตที่หมดอายุอีก 3 วัน, UI แจ้งให้ปรับยอดออก
- **AC-A8** ล็อต DRY ไม่มี expiry และไม่มี `shelf_life_days` อยู่ในคลัง 400 วัน → ยังเลือกได้ (ไม่ถือหมดอายุจาก `HORIZON`)

## Impact
- **docs:** `CR-143-stock-redesign-rules.md` §A/§C (ใส่ FR-A4a–c, FR-C7–C10, AC เพิ่ม), `docs/data/schema.md` §2.1 (ระบุว่า `note` บังคับเมื่อ `other`)
- **code:** ตาม `affects` ด้านบน — PR #374 (§C) และ PR #373 (§A)
- **test:** domain test ตาม AC-C5–C7, AC-A7–A8; regression `distribution/**`

## Migration
N/A — ไม่เพิ่ม field ไม่ bump `schema_v` แถวเก่าอ่านได้ตาม FR-C10

## Why
- **C:** การรับเข้า manual ถูกบันทึกเป็น `other` ทำให้รายงานเหตุผลปนกับการปรับยอดที่ผู้ใช้ตั้งใจเลือก `other`
- **D:** ฟอร์มเดิมบังคับกรอกเหตุผลอิสระ เมื่อ CR-143 เปลี่ยนเป็น enum ทำให้ `other` ว่างได้ หลักฐานของเหตุผลกว้างสุดจึงหาย
- **G:** ล็อตที่เกินอายุเก็บรักษาแต่ไม่มี expiry จริง ถูกจัดเป็นเร่งด่วนและถูกเบิกก่อนของที่ใกล้หมดอายุจริง ซึ่งขัดเจตนาของ FR-A3/FR-A4

## Decision log
- 2026-10-07 — proposed (ร่างจากผล review PR #373 / #374) · owner เลือกแนวทาง C2, D2, G2 และให้บันทึกเป็น CR amendment ของ CR-143 · **รอ owner approve** ก่อนรันเลข CR และก่อนแก้โค้ด
