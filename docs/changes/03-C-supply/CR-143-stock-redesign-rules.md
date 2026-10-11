---
id: CR-143
title: กติกาคลังชุดใหม่สำหรับ redesign หน้าคลังของศูนย์ (ลำดับล็อต, รับบริจาคหลายรายการ, เหตุผลปรับยอด, วันหมดอายุ, ปลายทางเบิก, รวมสินค้า)
status: done
date: 2026-10-02
updated: 2026-10-08
requested_by: project owner (UX review หน้าคลังของศูนย์ — GitHub #331)
decided_by: project owner (2026-10-02 — อนุมัติทุกหัวข้อ §A–§F; §C stable-core reviewed)
layer: stable # §C แตะ stock_ledger (append-only ledger = stable core) → ต้อง review ก่อน; §A §B §D §E §F = volatile
affects:
  - docs/data/schema.md §2.1 stock_ledger (§A ลำดับล็อต, §C adjust_reason/note, §D lot.expiry, §E lot.note ของ distribute)
  - docs/data/schema.md §2.3 donation (§B batch receive / shortfall)
  - docs/data/schema.md §4.2 item_master (§D requiresExpiry, §F merged_into)
  - schema_v stock_ledger 5 → 6 (§C)
  - schema_v item_master 4 → 5 (§F)
  - docs/task-breakdown/03-C-supply.md T-11, T-12, T-14
  - docs/changes/CR-058, CR-059, CR-118, CR-121 (นิยาม FEFO เดิม — §A แทนที่บางส่วน)
  - frontend/src/lib/features/operations/domain (operations.ts sortStockLotsByConsumptionOrder, adjustInputSchema, distributeInputSchema, keyDonationReceipt)
  - frontend/src/lib/features/operations/data/operations.remote.ts
  - frontend/src/lib/features/distribution/** (ใช้ลำดับล็อตเดียวกัน — §A)
  - frontend/src/lib/features/catalog/domain/catalog.ts (perishable, merged_into)
  - frontend/src/lib/server/shelter-access-design.ts (validate_doc_update — §C, §F)
  - worker/ projector ที่อ่าน stock_ledger (ตรวจผล §C)
why: หน้าคลังของศูนย์ redesign ตาม mockup ที่ owner review ผ่าน (GitHub #331) ต้องมีกติกาใหม่ 6 ข้อที่ spec ปัจจุบันไม่รองรับ
migration: §C stock_ledger schema_v 5→6 additive (แถวเก่าไม่มี adjust_reason = `other`); §F item_master schema_v 4→5 additive (`merged_into` opt); §A §B §D §E ไม่เปลี่ยนรูป doc
---

# กติกาคลังชุดใหม่สำหรับ redesign หน้าคลังของศูนย์

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** 6 หัวข้อ
  - §A ลำดับการใช้ล็อตแบบถ่วงน้ำหนัก (วันหมดอายุ × อายุในคลัง) + เบิกครั้งเดียวตัดได้หลายล็อต
  - §B รับของจากใบบริจาคหลายรายการในครั้งเดียว
  - §C เหตุผลการปรับยอดบน ledger
  - §D นิยามสินค้าที่ต้องกรอกวันหมดอายุ
  - §E บังคับระบุปลายทางตอนเบิกตรง
  - §F รวมสินค้าที่ซ้ำกัน
- **เพื่อใคร:** เจ้าหน้าที่คลัง (warehouse_staff / shelter_manager / supply_coordinator) บันทึกได้เร็วขึ้น และของที่อยู่นานหรือใกล้หมดอายุถูกใช้ก่อน
- **Dev ต้อง build:** domain + repo + UI ตาม GitHub #340–#347 (Phase B ของ #331)
- **กระทบ schema:** stock_ledger schema_v 5→6 (§C), item_master schema_v 4→5 (§F) ส่วนหัวข้ออื่นเปลี่ยนเฉพาะ rule

## การตัดสินรายหัวข้อ

owner อนุมัติทุกหัวข้อเมื่อ 2026-10-02 (§C เป็น stable-core ผ่าน review แล้ว)

| หัวข้อ | เรื่อง                      | layer      | schema_v         | ticket            | ผลตัดสิน  |
| ------ | --------------------------- | ---------- | ---------------- | ----------------- | --------- |
| §A     | ลำดับล็อต + เบิกหลายล็อต    | volatile   | —                | #340, #341        | ☑ อนุมัติ |
| §B     | รับบริจาคหลายรายการ         | volatile   | —                | #342              | ☑ อนุมัติ |
| §C     | เหตุผลปรับยอด               | **stable** | stock_ledger 5→6 | #343, #347        | ☑ อนุมัติ |
| §D     | สินค้าที่ต้องกรอกวันหมดอายุ | volatile   | —                | #344              | ☑ อนุมัติ |
| §E     | บังคับปลายทางตอนเบิกตรง     | volatile   | —                | #345              | ☑ อนุมัติ |
| §F     | รวมสินค้าซ้ำ                | volatile   | item_master 4→5  | #346 (ขึ้นกับ §C) | ☑ อนุมัติ |

---

## §A — ลำดับการใช้ล็อต และการเบิกหลายล็อต

### Change

- **Before:** `sortStockLotsByConsumptionOrder` (`operations/domain/operations.ts`) เรียงล็อตตาม expiry เร็วสุดก่อน (FEFO) และวางล็อตที่**ไม่มี expiry ไว้ท้ายสุดเสมอ** แล้วเรียงตาม `received_at` (FIFO) และ `lot_ref` ส่วนการเบิกตรงจากหน้าคลังรับได้เพียง `lot_ref` เดียวต่อครั้ง
- **After:**
  - เรียงล็อตด้วยคะแนนความเร่งด่วน (ค่าต่ำใช้ก่อน) ที่ถ่วงน้ำหนักทั้งวันหมดอายุและอายุในคลัง
  - การเบิกตรงหนึ่งครั้งตัดได้หลายล็อตตามลำดับนั้น

### Requirements — ลำดับล็อต

- **FR-A1** ระบบต้องคำนวณต่อล็อต (qty > 0):
  ```
  ageDays  = (now − (lot.produced_at ?? received_at)) / 1 วัน
  daysLeft = lot.expiry มีค่า              → (lot.expiry − now) / 1 วัน
             item.shelf_life_days มีค่า     → shelf_life_days − ageDays
             ไม่มีทั้งคู่                      → HORIZON[item.storage_type] − ageDays
  score    = W_EXPIRY × daysLeft − W_AGE × ageDays
  ```
- **FR-A2** ค่าตั้งต้น:
  - `W_EXPIRY = 1`, `W_AGE = 0.5`
  - `HORIZON` = DRY 365, CHILLED 7, FROZEN 90, CONTROLLED_MED 365; ถ้าไม่ทราบ storage_type ใช้ 365
  - `URGENT_DAYS = 7`
  - ค่าทั้งหมดอยู่ใน domain module เดียว (`operations/domain/lot-priority.ts`)
- **FR-A3** ลำดับการเรียง:
  1. **กลุ่มเร่งด่วน มาก่อนเสมอ:** ล็อตที่ `daysLeft ≤ URGENT_DAYS` และ `daysLeft` มาจากข้อมูลจริง (`lot.expiry` หรือ `shelf_life_days` ไม่ใช่ `HORIZON`) เรียงตาม `daysLeft` น้อยไปมาก
  2. **ล็อตที่เหลือ:** เรียงตาม `score` น้อยไปมาก
  3. **ค่าเท่ากัน:** `received_at` เก่ากว่าก่อน แล้วตามด้วย `lot_ref`
- **FR-A3a** `HORIZON` เป็นค่าประมาณ จึงไม่ทำให้ล็อตเข้ากลุ่มเร่งด่วน ถ้าไม่มีกลุ่มเร่งด่วน ล็อตที่ใกล้หมดอายุจริงอาจถูกแซงโดยของแห้งที่อยู่ในคลังนาน ซึ่งเสี่ยงให้ของเสียทิ้ง
- **FR-A4** ล็อตที่ `lot.expiry ≤ now` ต้องไม่ถูกเลือกอัตโนมัติ และ UI ต้องแจ้งให้ปรับยอดออก
- **FR-A4a–c** _(CR-156)_ ล็อตที่ไม่มี `lot.expiry` และ `daysLeft ≤ 0` โดย `daysLeft` มาจาก `shelf_life_days` ถือเป็นหมดอายุแล้วตาม FR-A4; `isUrgent` ใช้กับ `0 < daysLeft ≤ URGENT_DAYS` เท่านั้น; ค่าติดลบที่มาจาก `HORIZON` ไม่ถือเป็นหมดอายุ (FR-A3a)
- **FR-A5** ทุกจุดที่ใช้ลำดับล็อตต้องใช้ฟังก์ชันเดียวกัน ทั้งหน้าคลังและ distribution (dispatch / return / reconciliation)
- **FR-A6** UI ต้องแสดงเหตุผลสั้นของลำดับต่อล็อต เช่น "อยู่ในคลัง 200 วัน" หรือ "หมดอายุอีก 3 วัน"

> **Decision 2026-10-02:**
>
> - ใช้ค่าตั้งต้นตาม FR-A2 ไปก่อน การปรับค่าภายหลังให้บันทึกตาม `docs/change-management.md`
> - FR-A5 ใช้**ทั้งระบบ** รวม distribution (dispatch / return / reconciliation)
> - ข้อยกเว้น: comparator เดิมใน `projectStockLotBalances` ที่ใช้ replay แถว outbound legacy (ไม่มี `lot_ref`) **ห้ามเปลี่ยน** เพราะยอดรายล็อตของประวัติเดิมจะเปลี่ยน ลำดับใหม่ใช้เฉพาะการเลือกล็อตเพื่อเบิกและการแสดงผล

### Requirements — เบิกหลายล็อต

- **FR-A7** เมื่อจำนวนที่เบิกเกินยอดในล็อตแรก ระบบต้องวางแผนแบ่งล็อตตามลำดับ FR-A3 จนครบจำนวน และต้องข้ามล็อตตาม FR-A4
- **FR-A8** ทุกล็อตในแผนบันทึกเป็นแถว `distribute` แยกกัน (ผ่าน reservation claim ต่อล็อตตามเดิม) และใช้ `ref_id` (`requisition_ticket:direct-…`) **ค่าเดียวกัน**
- **FR-A9** ถ้าแถวใดล้มเหลว ระบบ**ไม่ rollback** แถวที่สำเร็จไปแล้ว (ledger เป็น append-only) และต้องรายงานว่าตัดสำเร็จกี่ล็อต จำนวนเท่าไร และเหลือที่ยังไม่ได้ตัดเท่าไร
- **FR-A10** ก่อนบันทึกต้องแสดงแผนการแบ่งล็อตให้ผู้ใช้เห็น และผู้ใช้ยังเลือกล็อตเองได้ (เปลี่ยนเป็นโหมดล็อตเดียว)
- **FR-A11** ถ้ายอดรวมทุกล็อตที่ใช้ได้ไม่พอ ต้องห้ามบันทึกและแสดงยอดที่มี

### Acceptance (§A)

- **AC-A1** ทั้งคู่มีวันหมดอายุ: ล็อต A หมดอายุอีก 300 วัน อยู่ในคลัง 60 วัน กับล็อต B หมดอายุอีก 310 วัน อยู่ในคลัง 2 วัน → A อยู่ก่อน B
- **AC-A2** มีกับไม่มีวันหมดอายุ: ล็อต C ไม่มีวันหมดอายุ (DRY) อยู่ในคลัง 200 วัน กับล็อต D หมดอายุอีก 400 วัน อยู่ในคลัง 5 วัน → C อยู่ก่อน D
- **AC-A1/A2 (ตัวเลขอ้างอิง):** A = 300 − 30 = 270, B = 310 − 1 = 309; C = (365 − 200) − 100 = 65, D = 400 − 2.5 = 397.5
- **AC-A3** ล็อต E หมดอายุอีก 3 วัน อยู่ในคลัง 30 วัน กับล็อต F ไม่มีวันหมดอายุ (DRY) อยู่ในคลัง 365 วัน → E อยู่ก่อน F เพราะอยู่กลุ่มเร่งด่วน (ถ้าใช้ score อย่างเดียว E = 3 − 15 = −12 และ F = 0 − 182.5 = −182.5 ซึ่งจะทำให้ F มาก่อน)
- **AC-A3b** ล็อต DRY ที่ไม่มีวันหมดอายุและอยู่ในคลัง 360 วัน (daysLeft = 5 จาก HORIZON) ต้อง**ไม่**อยู่ในกลุ่มเร่งด่วน
- **AC-A4** ล็อตที่หมดอายุแล้วไม่อยู่ในแผนเบิกอัตโนมัติ
- **AC-A5** เบิก 30 จากล็อตที่มี 6 / 20 / 16 ได้ 3 แถว คือ 6 / 20 / 4 โดยใช้ `ref_id` เดียวกัน
- **AC-A6** test ของ `distribution/**` ผ่านทั้งหมด หลังปรับ expectation ที่เปลี่ยนตาม FR-A5 แล้ว

### Why

`lot.expiry` ไม่บังคับกรอก ของที่ไม่มีวันหมดอายุจึงถูกเรียงไว้ท้ายสุดเสมอ แม้จะอยู่ในคลังมานาน ทำให้ของเก่าค้างคลัง ส่วนการเบิกที่ต้องเลือกทีละล็อตบังคับให้ผู้ใช้แยกบันทึกเองเมื่อจำนวนเกินยอดในล็อตเดียว

---

## §B — รับของจากใบบริจาคหลายรายการในครั้งเดียว

### Change

- **Before:** ฟอร์มรับเข้าบันทึกได้ครั้งละ 1 item ต่อ 1 ledger row; `keyDonationReceipt(donation, counted[], ctx)` มีอยู่ใน domain แต่ไม่มี repo เรียกใช้
- **After:** เลือกใบบริจาคแล้วระบบดึงทุกบรรทัดมาให้ยืนยันจำนวนที่รับจริง และบันทึกทุกบรรทัดในการเขียนครั้งเดียว

### Requirements

- **FR-B1** เมื่อเลือกใบบริจาค (`kind = items`) UI ต้องเติมบรรทัดจาก `donation.items[]` ที่มี `item_id` โดยค่าเริ่มของ "รับจริง" = จำนวนที่ระบุในใบ
- **FR-B2** บรรทัด `free_text` (ไม่มี `item_id`) ต้องให้ผู้ใช้จับคู่กับ item_master หรือสร้างสินค้าใหม่ (quick-create, #339) ก่อนบันทึก
- **FR-B3** ผู้ใช้เพิ่มบรรทัดนอกใบได้ ลบบรรทัดได้ และแก้จำนวนให้เป็น 0 ได้ (ถือว่าไม่ได้รับ)
- **FR-B4** repo `receiveDonationBatch(donation, counted[])` ต้องสร้าง rows ด้วย `keyDonationReceipt` (`reason: 'donation'`, `ref_id: donation._id`) และเขียนทุก row ใน `bulkDocs` ครั้งเดียว
- **FR-B4a** `_id` ของแต่ละ row ต้อง deterministic จาก `(donation._id, item_id, ลำดับบรรทัด)` (ใช้ `operations/domain/deterministic-ledger-id.ts`) เพื่อให้การ retry ไม่สร้างแถวซ้ำ
- **FR-B4b** transition donation เป็น `received` **หลังจากทุก row บันทึกสำเร็จแล้วเท่านั้น**
- **FR-B7** ถ้า `bulkDocs` สำเร็จบางแถว:
  - คงสถานะใบไว้ตามเดิม
  - UI ต้องแสดงว่าบรรทัดไหนบันทึกแล้ว (ล็อกไว้แก้ไม่ได้) และบรรทัดไหนล้ม พร้อมปุ่ม "ลองบันทึกเฉพาะรายการที่ไม่สำเร็จ"
  - retry ส่งเฉพาะบรรทัดที่ล้ม แล้วเมื่อครบทุกบรรทัดจึงทำ FR-B4b
- **FR-B8** ถ้า row ครบแล้วแต่ transition ใบล้ม การ retry ต้องทำเฉพาะ transition ไม่เขียน row ซ้ำ
- **FR-B9** ระหว่างที่ใบยังค้างบันทึกไม่ครบ ยอดจอง (`calculateReserved`) ต้องหักจำนวนที่บันทึกเข้า ledger แล้ว ไม่ให้นับซ้ำทั้งในยอดจองและยอดคงเหลือ
- **FR-B5** **ไม่เพิ่มสถานะใหม่** ใน donation โดย "รับไม่ครบ" = derived (declared − counted ต่อ item > 0) ซึ่ง UI ต้องแสดงในหน้ารับเข้าและในประวัติของใบ
- **FR-B6** ยอดที่ขาดต้อง**ไม่ค้างเป็นยอดจอง** (`calculateReserved`) หลังใบเป็น `received`

### Acceptance (§B)

- **AC-B1** ใบ 3 บรรทัด รับครบ → ledger 3 rows, ใบ = `received`
- **AC-B2** รับ 8 จาก 10 → แสดง "รับไม่ครบ 2" และยอดจองของ item นั้นกลับเป็น 0
- **AC-B3** บรรทัดที่รับ 0 ไม่สร้าง ledger row
- **AC-B4** 3 บรรทัด บันทึกสำเร็จ 2 ล้ม 1 → ใบยังไม่เป็น `received`, UI แสดงบรรทัดที่ล้ม, retry แล้วได้ ledger รวม 3 rows (ไม่มีแถวซ้ำ) และใบเป็น `received`
- **AC-B5** retry ซ้ำ 2 ครั้งด้วยข้อมูลเดิมไม่สร้างแถวเพิ่ม (deterministic `_id`)
- **AC-B6** ระหว่างค้าง (2 ใน 3 บันทึกแล้ว) ยอดคงเหลือ + ยอดจองของ item ที่บันทึกแล้วไม่ถูกนับซ้ำ

> **Decision 2026-10-02:** บันทึกสำเร็จบางแถว → retry เฉพาะแถวที่ล้ม ใบยังไม่เปลี่ยนสถานะจนกว่าจะครบ (FR-B4a–FR-B9)

### Why

ของบริจาคหนึ่งเที่ยวมีหลายรายการ การบันทึกทีละรายการทำให้ช้า และผู้ใช้มักเลือก source = manual แทนการผูกกับใบบริจาค ทำให้ใบค้างสถานะจองไว้

---

## §C — เหตุผลการปรับยอดบน stock_ledger (stable core)

### Change

- **Before:** `reason: 'adjust'` มี `ref_id: null` เสมอ และไม่มี field เหตุผล ใน UI ผู้ใช้พิมพ์เหตุผลได้ แต่ข้อความไม่ถูกบันทึกเป็นข้อมูลที่ใช้รายงานได้
- **After:** แถว `adjust` มี `adjust_reason` (enum) และ `note` (opt)

### Requirements

- **FR-C1** เพิ่ม field ใน `stock_ledger` (schema.md §2.1):

  | Field           | ชนิด                                                                      | req                                                   | หมายเหตุ            |
  | --------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------- |
  | `adjust_reason` | enum(`expired`,`damaged`,`count_mismatch`,`lost`,`found`,`merge`,`other`) | req เมื่อ `reason='adjust'` · ห้ามมีเมื่อ reason อื่น | เหตุผลการปรับยอด    |
  | `note`          | str ≤ 500                                                                 | opt (เฉพาะ `reason='adjust'`)                         | รายละเอียดเพิ่มเติม |

- **FR-C2** Zod (`adjustInputSchema`, `stockLedgerInputSchema.superRefine`) และ `createStockLedger` ต้องบังคับ FR-C1 และ writer ทุกที่ต้อง stamp `schema_v: 6`
- **FR-C3** `_design/access` (`src/lib/server/shelter-access-design.ts`) ต้องยอมรับ field ใหม่ และตรวจ enum `adjust_reason` เมื่อ `reason='adjust'`
- **FR-C4** reader (`stockBalance`, `calculateReserved`, `LedgerTable`, worker projector) ต้องอ่านแถว schema_v ≤ 5 ได้โดยไม่ throw และถือว่าแถวเก่าที่ไม่มี `adjust_reason` = `other`
- **FR-C5** `LedgerTable` และหน้าความเคลื่อนไหวต้องแสดงเหตุผล และกรองตามเหตุผลได้
- **FR-C6** `merge` ใช้ได้เฉพาะ flow รวมสินค้า (§F) และฟอร์มปรับยอดทั่วไปต้องไม่แสดงตัวเลือกนี้
- **FR-C7–C10** _(CR-156)_ รับเข้า `source=manual` บันทึกเป็น adjust `found` โดยฟอร์มไม่ให้เลือกเหตุผล; เหตุผล `other` ต้องมี `note` ไม่ว่าง (Zod, ฟอร์ม, `validate_doc_update`); แถว `other` เก่าที่ไม่มี note ยังอ่านได้

### Acceptance (§C)

- **AC-C1** ปรับยอดโดยไม่เลือกเหตุผล → validation error
- **AC-C2** แถว `distribute` ที่มี `adjust_reason` → reject ทั้ง Zod และ validate_doc_update
- **AC-C3** ledger ที่ผสมแถว schema_v 5 กับ 6 คำนวณยอดได้ถูกต้อง
- **AC-C4** worker sync ไม่ error กับแถว schema_v 6

### Migration (§C)

`stock_ledger` schema_v 5 → 6 — additive ไม่ต้อง backfill (ledger append-only แก้ย้อนหลังไม่ได้) แถวเก่าอ่านได้ปกติ โดย reader map ค่าที่ไม่มีเป็น `other` และ writer ใหม่ stamp `schema_v: 6`

### Why

เหตุผลการปรับยอด (หมดอายุ, เสียหาย, นับไม่ตรง, สูญหาย) จำเป็นต่อรายงานความสูญเสียและรายงานความโปร่งใส ข้อความอิสระที่ไม่ถูกบันทึกนำไปรายงานไม่ได้

---

## §D — นิยามสินค้าที่ต้องกรอกวันหมดอายุ

### Change

- **Before:** schema.md §2.1 ระบุว่า `lot.expiry` บังคับเมื่อ `item_master.perishable` แต่ **`item_master` ไม่มี field `perishable`** และโค้ดกำหนด `perishable: false` ให้ทุก item_master (`catalog.ts` `mergeCatalogGenerations`, `receive-stock-form.svelte`) ผลคือระบบไม่เคยบังคับวันหมดอายุของสินค้าใน master
- **After:** ใช้ derived rule แทน field ที่ไม่มีจริง

### Requirements

- **FR-D1** `requiresExpiry(item) = item.storage_type ∈ {CHILLED, FROZEN} || item.shelf_life_days != null`
- **FR-D2** ฟอร์มรับเข้า (ทั้งรับปกติ, รับบริจาคหลายรายการ §B และ walk-in) ต้องไม่ให้บันทึกโดย `lot.expiry` ว่าง เมื่อ `requiresExpiry` = true
- **FR-D2a** ถ้า item มี `shelf_life_days` ฟอร์มต้อง**เติมค่าเริ่มต้นให้อัตโนมัติ**: `lot.expiry = (lot.produced_at ?? วันที่รับเข้า) + shelf_life_days`
  - ผู้ใช้แก้ค่าได้
  - เมื่อเปลี่ยน `produced_at` และผู้ใช้ยังไม่ได้แก้วันหมดอายุเอง ต้องคำนวณใหม่
- **FR-D2b** ค่าที่เติมอัตโนมัติต้องแสดง label เตือนข้างช่องจนกว่าผู้ใช้จะแก้หรือยืนยัน: **"คำนวณจากอายุเก็บรักษา {n} วัน — กรุณาตรวจสอบกับฉลากอีกครั้ง"** label นี้เป็น UI เท่านั้น ไม่บันทึกลง ledger (ไม่เพิ่ม field)
- **FR-D2c** item CHILLED / FROZEN ที่ไม่มี `shelf_life_days` ไม่เติมค่าให้ ผู้ใช้ต้องกรอกเอง
- **FR-D2d** _(CR-156)_ FR-D2 ใช้กับการรับเข้าเท่านั้น การปรับยอดไม่ถูกบังคับ `lot.expiry`
- **FR-D3** `supply_item.perishable` (legacy) ยังใช้ได้ตามเดิม (OR กับ FR-D1)
- **FR-D4** ฟอร์มสร้างสินค้า (ทั้งเต็มและย่อ) ต้องแจ้งผลของการเลือกการเก็บรักษา เช่น "แช่เย็น / แช่แข็ง → ต้องกรอกวันหมดอายุทุกครั้งที่รับเข้า"
- **FR-D5** แก้ schema.md §2.1 ตาราง `lot.expiry` ให้อ้าง FR-D1 แทน `item_master.perishable`

### Acceptance (§D)

- **AC-D1** item CHILLED รับเข้าโดยไม่กรอกวันหมดอายุ → validation error
- **AC-D2** item DRY ที่ไม่มี `shelf_life_days` → ไม่บังคับวันหมดอายุ
- **AC-D3** item DRY ที่มี `shelf_life_days = 180` รับเข้าวันที่ 2 ต.ค. 2569 โดยไม่ระบุวันผลิต → ช่องวันหมดอายุเติม 31 มี.ค. 2570 พร้อม label "กรุณาตรวจสอบกับฉลากอีกครั้ง" และบันทึกได้
- **AC-D4** ระบุวันผลิต 1 ก.ย. 2569 → วันหมดอายุคำนวณใหม่เป็น 28 ก.พ. 2570
- **AC-D5** ผู้ใช้แก้วันหมดอายุเองแล้วเปลี่ยนวันผลิต → วันหมดอายุไม่ถูกเขียนทับ และ label หายไป
- **AC-D6** ผู้ใช้ลบค่าที่เติมจนช่องว่าง → บันทึกไม่ได้ (FR-D2)

> **Decision 2026-10-02:** สินค้าที่มี `shelf_life_days` ให้เติมวันหมดอายุอัตโนมัติ (แก้ได้) พร้อม label ให้ตรวจสอบอีกครั้ง (FR-D2a–FR-D2c)

### Why

spec อ้าง field ที่ไม่มีอยู่ ระบบจึงไม่เคยบังคับวันหมดอายุของอาหารสดหรือแช่เย็นที่อยู่ใน master

---

## §E — บังคับระบุปลายทางตอนเบิกตรง

### Change

- **Before:** `distributeInputSchema.note` (เก็บใน `lot.note` ของแถว distribute) เป็น optional
- **After:** การเบิกตรงจากหน้าคลัง (`ref_id` = `requisition_ticket:direct-…`) ต้องระบุปลายทาง

### Requirements

- **FR-E1** `note` ของการเบิกตรงต้องไม่ว่าง (trim ≥ 1 ตัวอักษร ≤ 100)
- **FR-E2** UI แสดงชิปปลายทางจาก storage points / zone ของศูนย์ และตัวเลือก "อื่นๆ" ที่พิมพ์เองได้
- **FR-E3** แถว distribute ที่มาจาก distribution feature (ticket ปกติ) ไม่อยู่ในขอบเขตของกฎนี้
- **FR-E4** แถวเก่าที่ไม่มี `note` อ่านได้ปกติ

### Acceptance (§E)

- **AC-E1** เบิกตรงโดยไม่เลือกปลายทาง → validation error
- **AC-E2** test ของ distribution feature ผ่านโดยไม่ต้องแก้

### Why

การเบิกตรงจากคลังไม่มี `distribution_log` ที่บอกผู้รับ ปลายทางจึงเป็นหลักฐานเดียวที่ใช้ตรวจสอบย้อนหลังได้

---

## §F — รวมสินค้าที่ซ้ำกัน (ขึ้นกับ §C)

### Change

- **Before:** ไม่มีวิธีรวมสินค้าที่ถูกสร้างซ้ำ (เช่น ศูนย์สร้าง "นมถั่วเหลือง 300 มล." ซ้ำกับสินค้าส่วนกลาง) ทำให้ยอดแยกเป็น 2 รายการ
- **After:** รวมสินค้าต้นทางเข้ากับปลายทาง โดยย้ายยอดผ่าน ledger และ deactivate ต้นทาง

### Requirements

- **FR-F1** ต่อทุกล็อตของต้นทางที่ qty > 0 เขียน `adjust` คู่ในการเขียนครั้งเดียว:
  - −qty ที่ต้นทาง
  - +qty ที่ปลายทาง โดยคง `lot` เดิม (expiry, produced_at, storage_point_id)
  - ทั้งคู่ใช้ `adjust_reason: 'merge'` และ `note` = id ของอีกฝั่ง
- **FR-F2** เพิ่ม field `merged_into` (str, opt → `item_master:{id}`) ใน `item_master` (schema.md §4.2) และตั้ง `deactivated: true` ที่ต้นทาง
- **FR-F3** ต้องใช้หน่วยฐานเดียวกัน หรือมี conversion ที่แปลงได้ ถ้าแปลงไม่ได้ต้องห้ามรวม
- **FR-F4** สิทธิ์:
  - สินค้า local ของศูนย์: SA หรือ shelter_manager / warehouse_staff ของศูนย์นั้น
  - สินค้าส่วนกลาง: SA เท่านั้น
- **FR-F4a–c, FR-F6** _(CR-156)_ สินค้าส่วนกลางห้ามเป็นต้นทางของการรวม (แทน "สินค้าส่วนกลาง: SA เท่านั้น" ของ FR-F4); ปลายทางเป็น local หรือส่วนกลางก็ได้; ตรวจการปิดต้นทางก่อนเขียน ledger และ retry ต้องปิดต้นทางได้โดยไม่ย้ายยอดซ้ำ
- **FR-F5** combobox และรายการสินค้าต้องซ่อนต้นทางที่มี `merged_into` และค้นชื่อต้นทางแล้วต้องพบปลายทาง

### Acceptance (§F)

- **AC-F1** รวม A (2 ล็อต, 24 + 6) เข้า B → ยอด A = 0, ยอด B เพิ่ม 30, ledger 4 แถว `merge`
- **AC-F2** หน่วยไม่เข้ากัน → ห้ามรวม
- **AC-F3** warehouse_staff รวมสินค้าส่วนกลาง → ถูกปฏิเสธ

### Migration (§F)

`item_master` schema_v 4 → 5 — additive เพิ่ม `merged_into` แบบ opt ไม่ต้อง backfill และ writer ใหม่ stamp `schema_v: 5`

### Why

quick-create (#339) ทำให้ศูนย์สร้างสินค้าเองได้ง่ายขึ้น โอกาสสร้างซ้ำจึงเพิ่มขึ้น และต้องมีทางแก้ที่ไม่ทำลาย ledger แบบ append-only

---

## Impact (รวม)

- **docs:**
  - `docs/data/schema.md` §2.1 (§A, §C, §D, §E), §2.3 (§B), §4.2 (§D, §F)
  - `docs/task-breakdown/03-C-supply.md` T-11 / T-12 / T-14
- **code:**
  - `operations/domain` (lot-priority ใหม่, operations.ts)
  - `operations/data/operations.remote.ts`
  - `distribution/**` (§A)
  - `catalog/domain/catalog.ts`
  - `src/lib/server/shelter-access-design.ts`
  - worker projector (§C)
- **test:**
  - domain test ใหม่ตาม AC ทุกข้อ
  - repo test ของ §B, §C, §F (in-memory dbs)
  - regression `distribution/**`

## Migration (รวม)

- **§C:** stock_ledger schema_v 5 → 6, additive
- **§F:** item_master schema_v 4 → 5, additive
- **§A, §B, §D, §E:** ไม่เปลี่ยนรูป doc — N/A

## Decision log

- 2026-10-02 — proposed (ร่างจากแผน redesign หน้าคลังของศูนย์ #331; owner กำหนดให้รวม CR เป็นฉบับเดียว และให้ลำดับล็อตถ่วงน้ำหนักวันหมดอายุกับจำนวนวันที่อยู่ในคลัง)
- 2026-10-02 — owner ตอบ open decision 4 ข้อ: (1) §A ใช้ค่าน้ำหนักตั้งต้นไปก่อน (2) §A ใช้ลำดับล็อตทั้งระบบ (3) §B บันทึกสำเร็จบางแถว → retry เฉพาะแถวที่ล้ม (4) §D เติมวันหมดอายุจาก `shelf_life_days` อัตโนมัติพร้อม label ให้ตรวจสอบอีกครั้ง · ยังรอการตัดสินรายหัวข้อ §A–§F
- 2026-10-02 — **approved** ทุกหัวข้อ §A–§F โดย project owner · §C (stable-core) reviewed: ยอมรับรายการ `adjust_reason` 7 ค่า, stock_ledger schema_v 5→6 และการ redeploy `_design/access` · รันเลข CR-143 · แก้ `docs/data/schema.md` §2.1/§2.3/§4.2 และ `docs/task-breakdown/03-C-supply.md` T-11/T-12/T-14 · สถานะ `done` เมื่อ ticket Phase B (#340–#347) ที่เกี่ยวข้องเสร็จ
- 2026-10-07 — แก้เพิ่มโดย [CR-156](CR-156-stock-redesign-amendment.md): FR-A4a–c, FR-C7–C10, FR-F4a–c, FR-F6 (approved โดย project owner)
