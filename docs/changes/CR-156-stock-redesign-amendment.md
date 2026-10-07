---
id: CR-156
title: แก้เพิ่ม CR-143 — เหตุผลรับเข้า manual, note ของ other, ล็อตเกินอายุเก็บรักษา, และขอบเขตการรวมสินค้า
status: done
date: 2026-10-07
updated: 2026-10-08
requested_by: project owner (ผล review PR #373 / #374 ของ GitHub #331)
decided_by: project owner (approved 2026-10-07)
layer: volatile
amends: CR-143 (§A, §C, §D, §F)
affects:
  - docs/changes/CR-143-stock-redesign-rules.md §A FR-A4, §C FR-C1, §F FR-F4
  - docs/data/schema.md §2.1 stock_ledger (adjust_reason, note) — ไม่เปลี่ยนรูป doc, ไม่ bump schema_v
  - frontend/src/lib/features/operations/domain/operations.ts (adjustInputSchema, stockLedgerInputSchema, createStockLedger, buildReceiveEntry)
  - frontend/src/lib/features/operations/domain/lot-priority.ts (isUrgent, FR-A4)
  - frontend/src/lib/features/operations/ui/adjust-stock-form.svelte, distribute-stock-form.svelte
  - frontend/src/lib/server/shelter-access-design.ts (validate_doc_update — note ของ other)
  - frontend/src/lib/features/operations (merge dialog, item-merge), frontend/src/lib/features/catalog/domain/item-merge.ts
  - GitHub #340 (PR #373), #343 (PR #374), #346
why: review ของ PR #373 และ #374 พบช่องว่างที่ CR-143 ไม่ได้ระบุ 3 จุด และ owner เลือกแนวทางแล้ว (C2, D2, G2)
migration: N/A — ไม่เพิ่ม/ลบ field, ไม่เปลี่ยนชนิด, ไม่ bump schema_v (note เป็น field เดิมของ FR-C1)
---

# แก้เพิ่ม CR-143 — รับเข้า manual, note ของ `other`, ล็อตเกินอายุเก็บรักษา

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เพิ่มกติกา 5 ข้อให้ CR-143 — (D) ปรับยอดไม่ถูกบังคับวันหมดอายุ, (F) จำกัดการรวมสินค้าเฉพาะสินค้า local ของศูนย์, (C) การรับเข้าแบบ manual บันทึกเป็น adjust `found`, (D) เหตุผล `other` ต้องมี `note`, (G) ล็อตที่เกินอายุเก็บรักษาถือเป็นหมดอายุแล้ว
- **เพื่อใคร:** เจ้าหน้าที่คลังและผู้ตรวจรายงานความสูญเสีย ให้เหตุผลในบัญชีไม่ปนกันและไม่เบิกของที่เกินอายุอัตโนมัติ
- **Dev ต้อง build:** แก้ domain + ฟอร์ม + `validate_doc_update` ตาม FR-C7–C9 และ FR-A4a ใน PR #374 (§C) และ PR #373 (§A) และ FR-F4a ใน #346 (§F)
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

### §D — ขอบเขตของการบังคับวันหมดอายุ

- **FR-D2d** FR-D2 (บังคับ `lot.expiry` เมื่อ `requiresExpiry`) ใช้กับการ**รับเข้า**เท่านั้น (รับปกติ, รับบริจาค, walk-in, scan station) การปรับยอด (`reason='adjust'`) ทุกทิศทางและทุกล็อตไม่ถูกบังคับ ทั้งฝั่งฟอร์มปรับยอดและฝั่ง repo/server

### §F — ขอบเขตการรวมสินค้า

- **FR-F4a** การรวมสินค้า (§F) ใช้ได้เฉพาะสินค้า **local ของศูนย์** เท่านั้น สินค้าส่วนกลาง (central `item_master`) ห้ามเป็นต้นทางของการรวม แม้ผู้ใช้เป็น SA ทั้งใน UI (ซ่อน/ปิดปุ่ม "รวมกับรายการอื่น") และใน domain (`checkItemMerge` ปฏิเสธ) — แทนที่ส่วน "สินค้าส่วนกลาง: SA เท่านั้น" ของ FR-F4
- **FR-F4b** ปลายทางของการรวมเป็นสินค้า local หรือสินค้าส่วนกลางก็ได้ (ย้ายยอดเฉพาะศูนย์ที่กำลังใช้งาน) หน่วยต้องเข้ากันตาม FR-F3
- **FR-F4c** การรวมสินค้าส่วนกลางข้ามทุกศูนย์อยู่นอกขอบเขตของ CR นี้ ต้องมี CR แยกเมื่อต้องการ
- **FR-F6** ลำดับการเขียน: ระบบต้องตรวจความถูกต้องของการปิดสินค้าต้นทาง (หน่วย, `_rev`) **ก่อน** เขียน ledger และถ้าแถว `merge` ของต้นทางถูกเขียนแล้วแต่ยังไม่ได้ปิดต้นทาง การ retry ต้องปิดต้นทางโดยไม่เขียนแถวย้ายยอดซ้ำ (`_id` ของแถว `merge` เป็น deterministic)

### §H — สิทธิ์การเบิกจ่ายตาม Capability (UI Distribute Button Disabled)

- **FR-H1** ผู้ใช้ที่ไม่มี capability `warehouse_staff` (เช่น `staff03` สิทธิ์ `supply_coordinator`) ปุ่มเบิกจ่ายทุกจุดบน UI (Header, Table Row, Mobile Card, Action Bar, ItemDetailSheet) ต้องแสดงในสถานะ `disabled` พร้อม Tooltip แจ้งเตือน: `"ต้องมีสิทธิ์เจ้าหน้าที่คลัง (warehouse_staff) จึงจะเบิกจ่ายได้"` (แทนการซ่อนปุ่ม เพื่อความสม่ำเสมอของ Layout)

### §I — การแสดงยอดรับบริจาคไม่ครบ (Shortfall) ทั้งหน้าตรวจรับและหน้าติดตามผู้บริจาค (FR-B5)

- **FR-I1** เมื่อยอดนับจริงน้อยกว่ายอดแจ้ง (Counted < Declared): Scan Station แสดง Badge `⚠ รับไม่ครบ` พร้อมแสดงยอดนับจริงเทียบยอดแจ้ง
- **FR-I2** SvelteKit BFF Endpoint (`/api/public/v1/donations/[tracking_token]`) ต้อง overlay ข้อมูล CouchDB ล่าสุด เพื่อให้หน้าติดตามผู้บริจาค (`/donations/track/[token]`) แสดงผลยอดรับไม่ครบแบบ Real-time แม้ FastAPI ออฟไลน์
- **FR-I3** หน้าติดตามผู้บริจาคต้องแสดงกล่องข้อความแจ้งเตือนส่วนต่างอย่างสุภาพ และในตารางพัสดุต้องแสดง Badge `รับไม่ครบ (ขาด X)` พร้อมแสดงยอดจริงและขีดฆ่ายอดแจ้งเดิม

### §J — การนับและเตือนของหมดอายุตาม Shelf Life (`shelf_life_days`)

- **FR-J1** ล็อตที่ไม่มี `expires_at` ให้นับวันหมดอายุจาก `produced_at` หรือ `received_at` + `shelf_life_days` โดยให้แสดง Badge "หมดอายุ" ในตารางสต็อกหลัก และนับรวมเข้าสู่การ์ดสรุปยอด "หมดอายุ" บนหน้าจอหลัก

## Acceptance

- **AC-D7** สินค้า CHILLED หรือมี `shelf_life_days` ที่ล็อตเดิมไม่มี expiry → ปรับยอดบวกเข้าล็อตนั้นได้โดยไม่ต้องกรอก expiry; รับเข้าโดยไม่กรอก expiry ยังถูกปฏิเสธ (AC-D1)
- **AC-C5** รับเข้า manual 10 ชิ้น → ledger 1 แถว `reason: 'adjust'`, `adjust_reason: 'found'`
- **AC-C6** ปรับยอดด้วยเหตุผล `other` โดยไม่กรอก note → validation error ทั้ง Zod และ `validate_doc_update`
- **AC-C7** อ่านแถว `adjust` `other` เก่าที่ไม่มี note ได้ ยอดคงเหลือถูกต้อง
- **AC-A7** ล็อต `shelf_life_days = 30` อยู่ในคลัง 60 วัน ไม่มี expiry → ไม่ถูกเลือกอัตโนมัติ, ไม่อยู่ก่อนล็อตที่หมดอายุอีก 3 วัน, UI แจ้งให้ปรับยอดออก
- **AC-F4** SA รวมสินค้าส่วนกลางเป็นต้นทาง → ถูกปฏิเสธ และ UI ไม่แสดงปุ่มรวม; SA รวมสินค้า local เข้าสินค้าส่วนกลางได้
- **AC-F5** ย้ายยอดสำเร็จแต่ปิดต้นทางล้ม → retry ปิดต้นทางได้ ledger มีแถว `merge` ไม่ซ้ำ
- **AC-A8** ล็อต DRY ไม่มี expiry และไม่มี `shelf_life_days` อยู่ในคลัง 400 วัน → ยังเลือกได้ (ไม่ถือหมดอายุจาก `HORIZON`)
- **AC-H1** ล็อกอิน `staff03` (supply_coordinator) เปิดหน้าสต็อก → ปุ่มเบิกจ่ายทุกจุดแสดงเป็น disabled พร้อม Tooltip
- **AC-I1** บริจาคแจ้ง 10 kg ตรวจรับ 8 kg → Scan Station แสดง Badge `⚠ รับไม่ครบ`, หน้า `/donations/track/[token]` แสดงกล่องแจ้งเตือน และรายการพัสดุขีดฆ่า 10 แสดง 8 พร้อม Badge `รับไม่ครบ (ขาด 2)`
- **AC-J1** ล็อตผักรวมเกิน 5 วันนับจาก produced_at → การ์ดสรุป "หมดอายุ" นับรวม และแถวผักรวมแสดง Badge "หมดอายุ"

## Impact

- **docs:** `CR-143-stock-redesign-rules.md` §A/§C (ใส่ FR-A4a–c, FR-C7–C10, AC เพิ่ม), `docs/data/schema.md` §2.1 (ระบุว่า `note` บังคับเมื่อ `other`)
- **code:** ตาม `affects` ด้านบน — PR #374 (§C) และ PR #373 (§A)
- **test:** domain test ตาม AC-C5–C7, AC-A7–A8; regression `distribution/**`

## Migration

N/A — ไม่เพิ่ม field ไม่ bump `schema_v` แถวเก่าอ่านได้ตาม FR-C10

## Why

- **C:** การรับเข้า manual ถูกบันทึกเป็น `other` ทำให้รายงานเหตุผลปนกับการปรับยอดที่ผู้ใช้ตั้งใจเลือก `other`
- **D:** ฟอร์มเดิมบังคับกรอกเหตุผลอิสระ เมื่อ CR-143 เปลี่ยนเป็น enum ทำให้ `other` ว่างได้ หลักฐานของเหตุผลกว้างสุดจึงหาย
- **F:** การรวมสินค้าส่วนกลางเขียน `merged_into` ลง central DB ซึ่งซ่อนสินค้าทุกศูนย์ แต่ย้ายยอดเฉพาะศูนย์ที่ใช้งาน สต็อกของศูนย์อื่นจึงกำพร้า
- **D (FR-D2d):** สินค้าที่เพิ่งได้ shelf life หรือย้ายไปแช่เย็นหลังรับล็อตเข้ามา มีล็อตเดิมที่ไม่มี expiry ฟอร์มปรับยอดไม่มีช่องกรอก expiry ของล็อตเดิม การบังคับจึงทำให้แก้ยอดไม่ได้
- **G:** ล็อตที่เกินอายุเก็บรักษาแต่ไม่มี expiry จริง ถูกจัดเป็นเร่งด่วนและถูกเบิกก่อนของที่ใกล้หมดอายุจริง ซึ่งขัดเจตนาของ FR-A3/FR-A4
- **H/I/J:** ผลจากการตรวจสอบและมติ Owner ของ Issue #331 Followups เพื่อความสมบูรณ์และถูกต้องของ UI/UX สต็อกและการติดตามพัสดุ

## Decision log

- 2026-10-08 — **done** โดย project owner อนุมัติมติ 3 ข้อ (§H disable ปุ่มเบิก, §I แสดงรับไม่ครบ, §J นับของหมดอายุจาก shelf life) และผ่านการทดสอบ E2E พร้อมภาพหลักฐานเชิงประจักษ์
- 2026-10-07 — **approved** โดย project owner (PR #379) · รันเลข CR-156 · แก้ CR-143 §A/§C/§F และ docs/data/schema.md §2.1/§4.2 · สถานะ `done` เมื่อ PR #373, #374 และ #346 ที่เกี่ยวข้องเสร็จ
- 2026-10-07 — proposed (ร่างจากผล review PR #373 / #374) · owner เลือกแนวทาง C2, D2, G2 และ F4 = จำกัดเฉพาะสินค้า local (ก) และให้บันทึกเป็น CR amendment ของ CR-143 · รอ owner approve
