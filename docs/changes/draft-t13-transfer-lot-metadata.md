---
id: draft
title: T-13 โอนย้ายข้ามศูนย์ — Lot ต้นทาง/ปลายทาง + Split Allocation (advisory per-lot, schema_v 3 → 4)
status: proposed
date: 2026-09-02
requested_by: Team-C
decided_by: Project Owner
layer: volatile
affects:
  - docs/data/schema.md §5.5 (stock_transfer — field table, schema_v 3 → 4)
  - ~~docs/data/schema.md §5.5 (ลบย่อหน้า mirror-write สองทางที่ค้างเก่า — CR-059 ยกเลิกไปแล้ว
    2026-08-22)~~ แก้แล้ว 2026-09-03 (FR-22)
  - schema_v stock_transfer 3 → 4 (**ต่อจาก CR-089** — ต้อง land ก่อน ดู §Dependencies)
  - docs/task-breakdown/05-D-kitchen.md T-13
  - frontend/src/lib/features/operations/domain/operations.ts (StockTransferItem, StockTransfer, transferItemSchema, transferInputSchema, receivedItemSchema, createTransfer, dispatchTransfer, receiveTransfer, + lotBalanceByItem ใหม่)
  - frontend/src/lib/features/operations/data/transfer.server-repository.ts (assertSufficientStock, transition, + mint dest lot)
  - frontend/src/lib/features/operations/data/operations.remote.ts (payload ของ receive)
  - frontend/src/lib/features/operations/application/queries.ts
  - frontend/src/lib/features/operations/ui/transfer-form.svelte (lot picker + ปุ่มแบ่งล็อต + ฟอร์มตรวจรับ)
  - frontend/src/lib/server/lot-number.ts (ใช้ซ้ำ ไม่แก้)
  - CR-088 (ใช้ `lot_no`/`storage_zone`/ตัว mint ที่ CR-088 วางไว้ — ไม่ reinvent)
  - CR-089 (schema_v ต่อกัน 3 → 4), CR-091 (FR-03 "ไม่มี lot/source_lot" ถูก supersede)
  - CR-059 (ปิด backlog note กลุ่ม Lot ของ Flow 1 §4.1/§4.2)
---

# draft-t13-transfer-lot-metadata — T-13 โอนย้ายข้ามศูนย์: Lot ต้นทาง/ปลายทาง + Split Allocation

## สรุป (TL;DR)
CR-059 Flow 1 follow-up — 5 ข้อของกลุ่ม Lot (§4.1/§4.2) ที่ CR-089 ตัดออกทั้งหมด 2026-08-25 และยังไม่มี CR ไหน cover
ปิด 5 ข้อสุดท้ายของ CR-059 Flow 1 ที่ยังไม่มี CR cover: เลือก Lot จริงตอนเบิกออก, แบ่งเบิกข้ามล็อต,
ปลายทางสร้าง Lot ID ใหม่, อ้างอิง Lot ต้นทางแบบ read-only, แก้วันหมดอายุตอนตรวจรับ ·
`stock_transfer` schema_v 3 → 4 (เพิ่ม `line_id`, `source_lot`, `dest_lots[]`) · **ไม่แตะ `stock_ledger`** ·
ยอดคงเหลือรายล็อตเป็น **advisory (คำเตือน ไม่ block)** — การบังคับจริงยังเป็นระดับ `item_id` ตามเดิม

---

## Dependencies

- **ต้อง land หลัง [CR-089](CR-089-t13-transfer-driver-dispute.md)** — CR-089 ถือ `stock_transfer`
  schema_v 2 → 3 อยู่ CR นี้จึงเป็น 3 → 4 · ถ้าสลับลำดับ ต้องแก้เลขทั้งสองไฟล์ก่อนเริ่มโค้ด
- ไม่ผูกกับ [CR-090](CR-090-t13-transfer-delete-undo.md) · [CR-091](CR-091-t13-transfer-detail-page.md)
  ship ก่อนหรือหลังก็ได้ (แต่ FR-21 แก้ข้อความใน CR-091)

---

## Requirements

### กลุ่ม A — Line identity (เงื่อนไขนำหน้าของ Split Allocation)

- **FR-01** — `StockTransferItem` เพิ่ม `line_id` (str, req ตอนเขียนใหม่) — unique ภายใน `items[]` ของ
  คำร้องเดียวกัน, mint ตอน `createTransfer`
- **FR-02** — `items[]` รองรับหลายบรรทัดที่ `item_id` ซ้ำกันได้ (คือผลของการแบ่งล็อต) — ทุกจุดที่เดิม
  สมมติว่า 1 `item_id` = 1 บรรทัด ต้องเปลี่ยนมา key ด้วย `line_id`
- **FR-03** — `receiveTransfer` ต้อง map `received_qty` ด้วย `line_id` ไม่ใช่ `item_id`
  (`receivedItemSchema` เปลี่ยน key ตาม) — ปัจจุบันสองบรรทัดที่ `item_id` เดียวกันจะได้ค่าเดียวกันทั้งคู่
  ⇒ นับรับซ้ำ
- **FR-04** — doc ที่สร้างก่อน CR นี้ไม่มี `line_id` — ผู้อ่านทุกจุดต้อง fallback ไปใช้ `item_id`
  แทนโดยไม่ throw (ไม่มี Zod parse ตอน read อยู่แล้ว — `isStockTransfer` เช็คแค่ `type`)

### กลุ่ม B — Lot ต้นทาง (ปิด CR-059 §4.1 ข้อ "เลือก Lot สต็อกจริง" + "Split Allocation" + §4.2 "Traceability")

- **FR-05** — `StockTransferItem` เพิ่ม `source_lot` (opt object):
  | key | ชนิด | req ในอ็อบเจกต์ | หมายเหตุ |
  | --- | --- | --- | --- |
  | `ledger_id` | str | req | `stock_ledger:{ulid}` ของแถวขาเข้าที่เป็นที่มาของล็อตนี้ — **machine key** (unique by construction) |
  | `lot_no` | str | opt | snapshot ของ label ตอนเลือก (CR-088 `L-YYMMDD-XXX`) |
  | `storage_zone` | str | opt | snapshot |
  | `expiry` | ts | opt | snapshot |
- **FR-06** — ใช้ `ledger_id` เป็น key ไม่ใช่ `lot_no` — CR-088 ระบุว่า `lot_no` เป็น label ที่ยอมให้ชนกันได้
  เพราะไม่มี business rule ผูก · CR นี้ต้องไม่ทำให้ข้อความนั้นเป็นเท็จ
- **FR-07** — ฟอร์มสร้างคำร้อง (`transfer-form.svelte`) เลือกสินค้าผ่าน **lot picker** ที่ไล่รายการล็อตจาก
  ledger ของศูนย์ตนเอง (แถว `qty > 0` ที่มี `lot` ใดๆ) แสดง `lot_no` / `storage_zone` / `expiry`
  แบบ **read-only** ไม่ให้พิมพ์เอง
- **FR-08** — ปุ่ม **"+ แบ่งจากอีกล็อต/โซน"** เพิ่มบรรทัดใหม่ที่ `item_id` เดิมแต่ `source_lot` ต่างกัน
- **FR-09** — เพิ่ม domain fn `lotBalanceByItem(ledger, transfers)` คืนยอดคงเหลือรายล็อตแบบ **advisory**:
  ```
  advisory_remaining(lot) = inbound_qty(lot)
                          − Σ qty ของ transfer line ที่ source_lot.ledger_id = lot._id
                            และ status ∈ {shipped, received}
  ```
  แล้ว **clamp** ผลรวมของทุกล็อตต่อ item ไม่ให้เกิน `stockBalance(item_id)`
- **FR-10** — ยอด advisory **ห้าม block การ submit** — แสดงเป็นคำเตือนเท่านั้น · การบังคับจริงยังเป็นระดับ
  `item_id` ตาม FR-15 · UI ต้องมีป้ายกำกับชัดเจนว่าเป็นยอดโดยประมาณ
- **FR-11** — `source_lot` เป็น read-only เมื่อ `status` ออกจาก `requested` แล้ว
- **FR-12** — ตอน dispatch ถ้ายอด advisory ของล็อตที่เลือกไว้เปลี่ยนไปจากตอนสร้างคำร้อง ให้แสดงคำเตือนซ้ำ
  ก่อนยืนยัน (ไม่ block)

### กลุ่ม C — Lot ปลายทาง (ปิด CR-059 §4.2 "Destination Lot ID" + "ตรวจสอบวันหมดอายุจริง")

- **FR-13** — `StockTransfer` เพิ่ม `dest_lots` (opt array) — **หนึ่งรายการต่อหนึ่ง `item_id`** ของคำร้อง
  (ไม่ใช่ต่อบรรทัด — ดู §Rationale ข้อ 2):
  | key | ชนิด | req ในอ็อบเจกต์ | หมายเหตุ |
  | --- | --- | --- | --- |
  | `item_id` | str | req | ตรงกับ `items[].item_id` |
  | `lot_no` | str | req | `L-YYMMDD-XXX` ของ**ศูนย์ปลายทาง** |
  | `storage_zone` | str | opt | กรอกตอนตรวจรับ |
  | `expiry` | ts | opt | default = `source_lot.expiry` ของบรรทัดแรกของ item นั้น, แก้ได้ตอนตรวจรับ |
- **FR-14** — `lot_no` ปลายทาง **server mint เท่านั้น** ผ่าน `lib/server/lot-number.ts` ที่มีอยู่แล้ว
  โดยนับลำดับจาก ledger ของ **DB ศูนย์ปลายทาง** — schema ฝั่งรับ input ต้อง strip ค่าที่ client ส่งมาทิ้ง
  (กติกาเดียวกับ CR-088)
- **FR-15** — ห้ามใช้เลขล็อตต้นทางเป็นเลขล็อตปลายทาง — `dest_lots[].lot_no` ต้องไม่เท่ากับ
  `source_lot.lot_no` ใดๆ ของคำร้องนั้น (assert ฝั่ง server)
- **FR-16** — ฟอร์มตรวจรับมีช่อง `storage_zone` (opt) และ `expiry` ที่ **เติมค่าจากต้นทางให้ก่อนแต่แก้ได้**
  ตามของจริงที่ได้รับ

### กลุ่ม D — ความถูกต้องของการเขียน ledger (บั๊กที่ Split Allocation เปิดออกมา)

- **FR-17** — `dispatchTransfer` เขียน `transfer_out` **หนึ่งแถวต่อหนึ่ง `item_id`** โดยรวมยอดทุกบรรทัด
  ของ item นั้น (ไม่ใช่แถวต่อบรรทัด) — **ไม่ใส่ `lot`** เพราะแถวเดียวอาจมาจากหลายล็อต · ร่องรอยรายล็อต
  อยู่บน `stock_transfer` ที่ `ref_id` ชี้ถึงอยู่แล้ว
- **FR-18** — `receiveTransfer` เขียน `transfer_in` **หนึ่งแถวต่อหนึ่ง `item_id`** โดยรวม `received_qty`
  ทุกบรรทัดของ item นั้น (เขียนเฉพาะ item ที่ผลรวม > 0) พร้อม `lot` = รายการ `dest_lots[]` ของ item นั้น
- **FR-19** — `assertSufficientStock` ต้อง**รวมยอดตาม `item_id` ก่อนเทียบ balance** — ปัจจุบันเทียบทีละ
  บรรทัดแยกกัน (`transfer.server-repository.ts:176-185`) ⇒ ล็อต A 10 + ล็อต B 10 ผ่านได้ทั้งคู่ทั้งที่มี
  ของจริง 12
- **FR-20** — คีย์ idempotency เดิมของ `ledgerAlreadyWritten` (`{ref_id, item_id, reason}`) ยังใช้ได้
  **ก็ต่อเมื่อ** FR-17/FR-18 บังคับว่า 1 item = 1 แถวต่อ transition — ต้องมี test พิสูจน์เคส retry หลัง
  partial failure ของคำร้องที่มีบรรทัดซ้ำ `item_id` ว่าไม่เกิดทั้งการเขียนซ้ำและการข้ามเงียบ

### กลุ่ม E — เอกสาร

- **FR-21** — `schema.md` §5.5 อัปเดต field table (`items[]` + `dest_lots[]`), bump schema_v 3 → 4,
  และลบบรรทัด "การจัดสรรเบิกข้ามล็อต / Destination Lot ID" ออกจากรายการ "ยังไม่ approve ในรอบนี้"
- **FR-22** — ~~`schema.md` §5.5 **ลบย่อหน้า mirror-write สองทาง** (`shipped` → mirror เข้า
  `shelter_{to_shelter}`, `received` → mirror ย้อนกลับ) — CR-059 Decision Log 2026-08-22 ยกเลิกแนวทางนี้
  ทั้งหมดแล้ว (ตรวจพบว่า `referral` ไม่เคย mirror จริง และ `_security` ของ `central_ops` ล็อกที่ `_admin`)
  แต่ §5.5 ยังเขียนค้างไว้ ⇒ แทนที่ด้วยข้อความ refetch-on-interaction ตามที่ตัดสินใจจริง~~ **แก้ไปแล้ว
  2026-09-03** ในไฟล์นี้เลย (ก่อน draft ตัวนี้ approve) — เป็นการ sync เอกสารให้ตรงกับ decision ที่ CR-059
  เคาะไปแล้วจริงตั้งแต่ 2026-08-22 ไม่ใช่การเปลี่ยน rule ใหม่ ไม่ต้องรอ approve รอบนี้ ดู decision log
  ท้ายไฟล์
- **FR-23** — [CR-091](CR-091-t13-transfer-detail-page.md) FR-03 ระบุว่า "**ไม่มี `lot`/`source_lot`**"
  — ข้อความนั้นถูก supersede โดย CR นี้ · หน้ารายละเอียดต้องแสดง `source_lot` + `dest_lots` เมื่อมี
  (progressive แบบเดิม — ไม่มีก็ข้ามเงียบๆ)

---

## Acceptance (DoD)

- [ ] สร้างคำร้องโดยเลือกล็อตจาก picker ได้ · `lot_no`/`storage_zone`/`expiry` ขึ้นเป็น read-only
      ไม่มีช่องให้พิมพ์เอง (FR-07)
- [ ] กด "+ แบ่งจากอีกล็อต/โซน" แล้วได้บรรทัดที่ 2 ของ `item_id` เดิม · persist ครบทั้งสองบรรทัดพร้อม
      `line_id` ต่างกัน (FR-01, FR-08)
- [ ] คำร้องที่มี 2 บรรทัดของ item เดียวกัน รวม 20 ชิ้น แต่ของจริงมี 12 → dispatch ต้องถูก **server**
      ปฏิเสธ (FR-19)
- [ ] dispatch คำร้องที่มีบรรทัดซ้ำ item → ได้ `transfer_out` **1 แถว** ยอดรวมถูกต้อง ไม่มี `lot` (FR-17)
- [ ] จำลอง retry หลัง ledger เขียนสำเร็จแต่ PUT สถานะล้มเหลว → รอบสองไม่เขียน ledger ซ้ำ และไม่ข้าม
      บรรทัดใดเงียบๆ (FR-20)
- [ ] ตรวจรับแล้วได้ `dest_lots[]` 1 รายการต่อ item · `lot_no` เป็นของศูนย์ปลายทาง · ไม่ซ้ำกับเลขต้นทาง
      (FR-13, FR-14, FR-15)
- [ ] client ส่ง `lot_no` ปลายทางมาเองใน payload → ถูก strip ทิ้ง เลขที่ persist มาจาก server เท่านั้น (FR-14)
- [ ] แก้ `expiry` ตอนตรวจรับให้ต่างจากต้นทาง → ค่าที่ persist และที่ลงบน `transfer_in` ledger คือค่าที่แก้
      (FR-16, FR-18)
- [ ] ยอด advisory รายล็อตขึ้นเป็นคำเตือน · กด submit ต่อได้ ไม่ถูก block (FR-10)
- [ ] เปิดคำร้องที่สร้างก่อน CR นี้ landed (ไม่มี `line_id`/`source_lot`) — ทุกหน้าไม่ error (FR-04)

---

## Why

- CR-059 §4.1/§4.2 (Flow 1) กำหนด 5 requirement นี้ไว้ตั้งแต่ 2026-07-25 · CR-089 เคยรวมไว้เป็น "กลุ่ม Lot"
  แล้ว **project owner ตัดออกทั้งหมด 2026-08-25** เพราะซ้ำกับ CR-088 บางส่วน และเพราะจะให้ transfer ใช้
  `lot_no`/`storage_zone` ของ CR-088 ได้จริงต้องเพิ่ม field บน `StockTransferItem` อยู่ดี ⇒ Decision log ของ
  CR-089 บันทึกไว้ว่า 5 ข้อนี้ "กลับไปเป็น ❌ ไม่มี CR ไหน cover ในรอบนี้เลย" และให้เปิด CR ใหม่โดย
  **อ้างอิง CR-088 ตั้งแต่ต้น** — CR นี้คือ CR นั้น
- ระบบยังไม่มี lot-level balance เลย: `stockBalance()` รวมยอดตาม `item_id` อย่างเดียว และ
  `stock-table.svelte:158-164` บันทึกข้อจำกัดนี้ไว้แล้ว ("A proper fix requires per-lot balance tracking
  (FIFO/FEFO), which is out of scope for T-11") · การทำให้ล็อตเป็นหน่วยที่บังคับได้จริงต้องให้ ledger
  **ขาออกทุกใบ** ระบุว่าตัดจากล็อตไหน ซึ่งข้ามไปถึงครัวและ donation ⇒ อยู่นอก scope รอบนี้ (ดู §Non-goals)
- การแบ่งเบิกข้ามล็อตเปิดบั๊กที่มีอยู่แล้ว 3 ตัวขึ้นมาพร้อมกัน (FR-03, FR-19, FR-20) — ทั้งหมดมาจากรากเดียว
  คือ `items[]` ไม่เคยมี line identity ⇒ กลุ่ม A เป็นเงื่อนไขนำหน้า ไม่ใช่ของแถม

---

## Rationale (ทางเลือกที่ตัดทิ้ง)

1. **ยอดรายล็อตแบบ advisory แทนแบบบังคับ** — ทางเลือกที่บังคับได้จริงต้อง bump `stock_ledger`
   (schema_v 4 → 5) และแก้ผู้เขียน ledger ขาออกทุกจุดข้ามฟีเจอร์ (operations / kitchen / donations)
   ทั้งยังลบล้างข้อความของ CR-088 ที่ว่า `lot_no` ชนกันได้เพราะไม่มี business rule ผูก ⇒ แยกเป็น CR
   ต่างหาก (§Non-goals) · ผลที่ยอมรับ: ยอด advisory **สูงกว่าความจริงเสมอ** เพราะ `distribute` /
   `requisition` / `adjust` ติดลบ ไม่เคยบันทึกว่าตัดจากล็อตไหน — การ clamp ที่ FR-09 กันไม่ให้ผลรวม
   เกินยอดจริงของ item แต่กันการกระจายผิดล็อตไม่ได้ · ต้องเขียนกำกับใน UI ตาม FR-10
2. **`dest_lots[]` ต่อ `item_id` ไม่ใช่ต่อบรรทัด** — ตัวเลือกแรกคือ 1 ล็อตปลายทางต่อ 1 บรรทัด (สายเลือด
   source→dest แบบ 1:1) แต่ทำให้ `transfer_in` ต้องเขียนหลายแถวต่อ item ⇒ คีย์ idempotency ปัจจุบัน
   (`{ref_id, item_id, reason}`) ใช้ไม่ได้ ต้องเพิ่ม `line_id` ลงบน `stock_ledger` = bump schema_v ของ
   ledger โดยไม่จำเป็น · การรวมเป็น 1 ล็อตต่อ item ตรงกับพฤติกรรมคลังจริง (ของมาถึงรอบเดียว เก็บเป็น
   ล็อตเดียว) และ CR-059 §4.2 ไม่ได้กำหนด 1:1 ไว้ · ร่องรอยล็อตต้นทางทุกบรรทัดยังอยู่ครบบน `items[]`
3. **เลือกล็อตตอนสร้างคำร้อง ไม่ใช่ตอน dispatch** — ตามตัวอักษร CR-059 §4.1 ("การเลือกสินค้าต้องดึงจาก
   Lot ที่มีอยู่จริง" อยู่ในฟอร์มเบิกออก) · ชดเชยความ stale ด้วยคำเตือนซ้ำตอน dispatch (FR-12) ต่างจาก
   driver/plate ของ CR-089 ที่อยู่ที่ dispatch confirm เพราะเป็นข้อมูล ณ เวลาส่งมอบจริง

---

## Change (before → after)

| เรื่อง | ก่อน | หลัง (CR นี้) |
| --- | --- | --- |
| Line identity | ไม่มี — โค้ดสมมติ 1 `item_id` = 1 บรรทัด | `line_id` req, `item_id` ซ้ำได้ |
| เลือกสินค้าตอนเบิก | พิมพ์ `item_id`/จำนวนเอง ไม่มีล็อต | lot picker จาก ledger จริง + ยอด advisory |
| แบ่งข้ามล็อต | ไม่มี | ปุ่ม "+ แบ่งจากอีกล็อต/โซน" เพิ่มบรรทัด |
| ล็อตปลายทาง | ไม่มี — `transfer_in` ไม่มี `lot` เลย | `dest_lots[]` mint ฝั่ง server + ลงบน ledger |
| วันหมดอายุตอนตรวจรับ | ไม่มีช่อง | default จากต้นทาง แก้ได้ |
| `transfer_out`/`transfer_in` | 1 แถวต่อบรรทัด | 1 แถวต่อ `item_id` (รวมยอด) |
| ตรวจ balance | ทีละบรรทัด (บั๊ก) | รวมยอดตาม `item_id` ก่อนเทียบ |

---

## Impact

- **Docs:** `docs/data/schema.md` §5.5 (field table + schema_v 3 → 4 + ลบย่อหน้า mirror-write ค้างเก่า),
  `docs/task-breakdown/05-D-kitchen.md` T-13
- **Domain:** `operations.ts` — `StockTransferItem`(+`line_id`,+`source_lot`),
  `StockTransfer`(+`dest_lots`), `transferItemSchema` / `transferInputSchema` / `receivedItemSchema`
  (key เปลี่ยนเป็น `line_id`), `createTransfer` (mint `line_id`), `dispatchTransfer` / `receiveTransfer`
  (รวมยอดต่อ `item_id`), เพิ่ม `lotBalanceByItem()`
- **Data/server:** `transfer.server-repository.ts` — `assertSufficientStock` (รวมยอด), `transition`
  (mint `dest_lots` ตอน `received`, strip `lot_no` จาก client), ใช้ `lib/server/lot-number.ts` ซ้ำ
- **Client:** `operations.remote.ts` (payload ตรวจรับ), `application/queries.ts`
- **UI:** `transfer-form.svelte` — lot picker, ปุ่มแบ่งล็อต, ฟอร์มตรวจรับ (zone + expiry)
- **Test:** `operations.test.ts`, `transfer.server-repository.test.ts`,
  `routes/api/back-office/transfer/[id]/transition/server.test.ts`
- **CR อื่น:** ปิดกลุ่ม Lot ของ CR-059 Flow 1 ครบ · supersede CR-091 FR-03 ประโยค "ไม่มี lot/source_lot"

---

## Non-goals (ไม่อยู่ใน CR นี้)

- **ยอดคงเหลือรายล็อตแบบบังคับได้ (enforced per-lot balance) + FEFO** — ต้องให้ ledger ขาออกทุกใบระบุ
  ล็อตต้นทาง (`stock_ledger` schema_v 4 → 5) และแก้ผู้เขียนทุกจุดข้ามฟีเจอร์ · เป็นเงื่อนไขนำหน้าของ
  CR-059 Flow 3 (คลังเลือก Lot ตาม FEFO ตอนอนุมัติใบเบิกครัว) ⇒ เปิด CR แยกเมื่อจะทำ Flow 3
- **master data ของโซนจัดเก็บ** — `storage_zone` ยังเป็น free text ตาม CR-088
- **การย้ายปุ่ม action เข้าหน้ารายละเอียด** — ยังอยู่ที่ตาราง list ตาม CR-091 FR-05

---

## Migration

`stock_transfer` schema_v 3 → 4 — additive ทั้งหมด (`line_id` / `source_lot` / `dest_lots` เป็นของใหม่
ล้วน ไม่มี field เดิมเปลี่ยนชนิดหรือ req↔opt) · doc เดิมที่ไม่มี `line_id` **อ่านได้ปกติ** เพราะไม่มี Zod
parse ตอน read (`isStockTransfer` เช็คแค่ `type`) และผู้อ่านต้อง fallback ไป `item_id` ตาม FR-04 ·
pre-prod ไม่มี production data จริง ไม่ต้อง backfill · `stock_ledger` **ไม่ bump** (คง 4 ตาม CR-088) —
CR นี้ใช้ field `lot` ที่มีอยู่แล้ว ไม่เพิ่ม field ใหม่บน ledger

---

## Decision log

- 2026-09-02 — proposed — เปิดจากการตรวจ CR-059 Flow 1 เทียบโค้ดจริงบน `develop` แล้วพบว่า 5 ข้อของกลุ่ม
  Lot ยังไม่มี CR ไหน cover ตามที่ CR-089 Decision log 2026-08-25 บันทึกไว้เอง
- 2026-09-02 — project owner เลือกแนวทาง **advisory per-lot** (จาก 3 ตัวเลือกที่เสนอ: passthrough /
  advisory / enforced) — ปิดครบทั้ง 5 ข้อโดยแตะแค่ `stock_transfer` ไม่ลาม `stock_ledger` และไม่ลบล้าง
  สมมติฐาน "label only" ของ CR-088 · แนวทาง enforced ถูกย้ายไป §Non-goals ผูกกับ Flow 3
- 2026-09-02 — project owner ให้เก็บเรื่อง `schema.md` §5.5 ที่ยังเขียน mirror-write สองทางค้างไว้
  (CR-059 ยกเลิกแล้ว 2026-08-22) มาแก้ใน CR นี้ด้วย เพราะจะแตะ §5.5 อยู่แล้ว (FR-22)
- 2026-09-02 — รันเลข `CR-106` (ไม่ใช่ `CR-105` ที่เสนอไว้ตอนแรก) — `CR-105` ถูกใช้ไปแล้วบน `develop`
  (`CR-105-user-form-redesign-security-questions-and-passphrase-reset.md`, merge มากับ `e533bcac`) ·
  รันเลขก่อน approve โดยเจตนาเพื่อให้เปิด PR ให้ PM review ได้ — **`status` ยังเป็น `proposed`**
  การเคาะ `approved` จะเกิดใน PR นั้น ไม่ใช่ในคอมมิตนี้
- **ยังไม่ตัดสินใจ:** สถานะยังเป็น `proposed` · ต้อง approve ก่อนเริ่มโค้ด ·
  จุดที่ควรพิจารณาเป็นพิเศษ: FR-09/FR-10 (ยอด advisory ที่สูงกว่าความจริงเสมอ — ยอมรับได้หรือควรรอ
  enforced) และ FR-17/FR-18 (เปลี่ยน granularity ของ ledger จากต่อบรรทัดเป็นต่อ item)
- 2026-09-03 — **ย้อนกลับเป็น draft** — เลข `CR-106` ถูกรันก่อน approve (ผิด Policy §3: ต้องรันเลขและ
  ลง `_index.md` **หลัง** เจ้าของโครงการเคาะ `approved` เท่านั้น) · rename ไฟล์กลับเป็น
  `draft-t13-transfer-lot-metadata.md`, `id: draft`, ถอดแถวออกจาก `_index.md` · เนื้อหา requirement/
  rationale ไม่เปลี่ยน รอ approve แล้วรันเลขใหม่ตามลำดับจริงบน `develop` (ต้องเป็น `CR-107` ขึ้นไป — เลข
  `CR-106` ถูก `CR-106-daily-sop-assessment-workflow.md` ใช้ไปแล้วจริงบน `develop` ระหว่างนั้น)
- 2026-09-03 — **แก้ FR-22 ล่วงหน้าในไฟล์นี้เอง** (ก่อน draft approve) — ลบย่อหน้า mirror-write สองทางที่
  ค้างเก่าใน `schema.md` §5.5 ออก แทนที่ด้วยข้อความ refetch-on-interaction + state-check idempotency ให้
  ตรงกับ decision จริงของ CR-059 (2026-08-22) และโค้ดจริงใน `transfer.server-repository.ts` — ไม่ใช่การ
  เปลี่ยน rule ใหม่ (แค่ sync เอกสารให้ตรงกับสิ่งที่ approve/decided ไปแล้ว) จึงไม่ต้องรอ draft นี้ approve
  ก่อน แก้ไปพร้อมกับ commit นี้ ส่งรวมไปกับ draft ตอนเปิด PR — `schema.md` `updated:` bump เป็น
  2026-09-03 ด้วย
