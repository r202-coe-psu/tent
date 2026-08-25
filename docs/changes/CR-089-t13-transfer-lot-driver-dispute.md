---
id: CR-089
title: T-13 โอนย้ายข้ามศูนย์ — Lot metadata (interim) + Driver/Plate + Dispute (schema_v 2 → 3)
status: proposed
date: 2026-08-25
requested_by: CR-059 follow-up — field ละเอียดของ stock_transfer ที่ CR-059 Decision Log 2026-08-22 ("T-13 write-path implementation detail") และ schema.md §5.5 ระบุไว้ว่า "ยังไม่ approve ในรอบนี้"
decided_by: Project Owner
layer: volatile
affects:
  - docs/data/schema.md §5.5 (stock_transfer, schema_v 2 → 3)
  - docs/task-breakdown/05-D-kitchen.md T-13
  - frontend/src/lib/features/operations/domain/operations.ts
  - frontend/src/lib/features/operations/domain/transfer.authorization.ts
  - frontend/src/lib/features/operations/data/transfer.server-repository.ts
  - frontend/src/lib/features/operations/data/operations.remote.ts
  - frontend/src/lib/features/operations/application/queries.ts
  - frontend/src/lib/features/operations/ui/transfer-form.svelte
  - frontend/src/lib/features/operations/ui/transfer-list.svelte
  - frontend/src/routes/api/back-office/transfer/[id]/transition/+server.ts (รองรับ to: disputed/requested)
  - CR-059 (ปิด backlog note "field ละเอียด...ยังไม่ approve ในรอบนี้" บางส่วน — ที่เหลือแยกไป CR-090/CR-091)
  - CR-090 (delete+undo — spun out, ไม่แตะ schema_v), CR-091 (หน้ารายละเอียด Ticket — spun out, ไม่แตะ schema_v)
---

# CR-089 — T-13 โอนย้ายข้ามศูนย์: Lot metadata + Driver/Plate + Dispute

> เดิม CR นี้รวม 5 กลุ่ม (Lot/Driver-Plate/Dispute/Delete+Undo/Detail Page) — แยก **Delete+Undo** ออกเป็น
> [CR-090](CR-090-t13-transfer-delete-undo.md) และ **หน้ารายละเอียด Ticket** ออกเป็น
> [CR-091](CR-091-t13-transfer-detail-page.md) แล้ว (2026-08-25) เพราะสองกลุ่มนั้นไม่แตะ `schema_v` เลย
> ไม่มีเหตุผลทางเทคนิคให้ต้องรอ approve พร้อมกับกลุ่มที่เปลี่ยน doc shape จริง — ดู Decision log ท้ายไฟล์

## สรุป (TL;DR)

เพิ่ม field ที่ CR-059 §4.1/4.3 (Flow 1) ระบุไว้แต่ `71fd0b35` ยังไม่ implement และเปลี่ยน doc shape ของ
`stock_transfer` จริง: lot metadata แบบ interim (ไม่ใช่ lot inventory จริง), บังคับกรอกผู้ขับขี่/ทะเบียน
รถก่อนส่งมอบ, สถานะ `disputed` (คัดค้าน/ระงับ) · `stock_transfer` schema_v 2 → 3 (additive) · กระทบ
`operations` feature ทั้ง 4 layer, ไม่มี route ใหม่ · **status ยังเป็น `proposed`** — รอ project owner
เคาะ `approved` ในไฟล์นี้ก่อนเริ่มโค้ดจริง

---

## Requirements

### กลุ่ม A — Lot metadata (interim; ไม่ใช่ lot inventory จริง)

- **FR-01** — เพิ่ม `lot?: {expiry?: ts, note?: str}` ใน `StockTransferItem` (โครงเดียวกับ
  `stock_ledger.lot` ที่มีอยู่แล้ว) — optional, additive
- **FR-02** — ฟอร์ม dispatch: แต่ละบรรทัด item มี dropdown เลือก lot จาก distinct `(lot.note,
  lot.expiry)` ที่เคย derive จาก `stock_ledger` ของ item นั้นในศูนย์ตนเอง (technique เดียวกับที่
  `stock-table.svelte` ใช้ derive "latest lot" อยู่แล้ว ขยายให้ list ครบทุก lot ไม่ใช่แค่ล่าสุด) —
  เลือกแล้วโชว์ zone (`note`) / expiry แบบ read-only; ถ้า item ไม่มีประวัติ lot เลยให้กรอกเป็น free
  text ได้ (fallback)
- **FR-03** — ฟอร์ม dispatch รองรับหลายบรรทัดของ `item_id` เดียวกันด้วย `lot` ต่างกัน (ใช้ `items[]`
  เดิม ไม่เปลี่ยน shape) — ปุ่ม "+ แบ่งจากอีกล็อต/โซน" เพิ่มบรรทัดใหม่
- **FR-04** — ฟอร์ม receive: ต้องกรอก `lot.note` ใหม่ของปลายทาง (ห้ามระบบ copy เลขล็อตต้นทางมาเป็นค่า
  เริ่มต้น) — เว้นว่างได้ ระบบ suggest `{to_shelter}-{short id}` ให้แก้ได้
- **FR-05** — item ที่รับเข้าเก็บ `lot` ที่ต้นทางส่งมาไว้ใน field ใหม่ `source_lot` (read-only เสมอ
  ไม่มีช่องแก้ในฟอร์ม) เพื่อสืบย้อน
- **FR-06** — `lot.expiry` ที่กรอกตอน receive pre-fill จาก `source_lot.expiry` แต่แก้ไขได้ (วันหมดอายุ
  จริงอาจไม่ตรงป้าย)
- **FR-07 (ข้อจำกัดที่ต้องประกาศ ไม่ใช่ implement)** — กลุ่มนี้ไม่ทำ per-lot balance จริง —
  `assertSufficientStock` ยังเช็ค balance รวมทั้ง item เหมือนเดิม ไม่เช็คว่า lot ที่เลือกมีของพอ
  (ข้อจำกัดเดียวกับที่ `stock-table.svelte` มีอยู่แล้วตั้งแต่ T-11) — UI ต้องใช้คำว่า "ตำแหน่งจัดเก็บ"
  ไม่ใช่ "Lot ID" เพื่อไม่สื่อว่าเป็น lot inventory จริง
- **FR-16 (แก้บั๊กที่ FR-03 เปิดออกมา)** — `assertSufficientStock`
  (`transfer.server-repository.ts:148-170`) ปัจจุบันเช็คแต่ละบรรทัดใน `items[]` แยกกันกับ balance เต็ม
  จำนวน ไม่รวมยอดหลายบรรทัดของ `item_id` เดียวกันก่อนเช็ค — ก่อนมี split allocation (FR-03) `items[]`
  ไม่เคยมี `item_id` ซ้ำมาก่อนจึงไม่เป็นปัญหา แต่ FR-03 เปิดให้มีหลายบรรทัด `item_id` เดียวกันได้ ⇒ ต้อง
  รวมยอด `qty` ต่อ `item_id` ก่อนเทียบกับ `currentQty` (ไม่ใช่ loop เช็คทีละบรรทัดเหมือนเดิม) — ไม่งั้น
  split allocation จะปล่อยให้ dispatch เกินสต็อกจริงได้ (เช่น ของเหลือ 8, แยกเบิก 2 บรรทัดบรรทัดละ 5 —
  แต่ละบรรทัดผ่านเพราะ `8≥5` ทั้งคู่ ทั้งที่รวมกันต้องการ 10 > 8 ที่มีจริง)

### กลุ่ม B — ผู้ขับขี่ / ทะเบียนรถ

- **FR-08** — transition เป็น `shipped` ต้องมี `driver_name` (str, ไม่ว่าง) และ `vehicle_plate` (str,
  ไม่ว่าง) แนบมาด้วยเสมอ — validate ทั้ง client (ฟอร์ม dispatch confirm ไม่ใช่ฟอร์ม create) และ server
  (`transition()` reject ก่อนตัดสต็อกถ้าขาด)
- **FR-09** — เก็บ `driver_name` / `vehicle_plate` เป็น field ระดับบนของ `StockTransfer` เขียนครั้งเดียว
  ตอน dispatch, read-only หลังจากนั้น

### กลุ่ม C — คัดค้าน/ระงับคำสั่ง (dispute)

- **FR-10** — transition `cancelled` (มีอยู่แล้ว, source-only, จาก `requested` เท่านั้น) เพิ่ม field
  บังคับ `cancel_reason: str`
- **FR-11** — เพิ่มค่า enum ใหม่ใน `TransferStatus`: `disputed`. Transition `requested → disputed` —
  source-only, ต้องมี `dispute_reason: str`
- **FR-12** — transition `disputed → requested` (resume) — source-only, ไม่ต้องมี field เพิ่ม (ล้าง
  block กลับสู่สถานะปกติ); ไม่เก็บ dispute history หลายรอบ — เก็บแค่ `dispute_reason` ล่าสุด (ของรอบ
  ก่อนหน้าถูกทับ)
- **FR-13** — ปลายทาง (`to_shelter`) ทำได้แค่อ่านตอนสถานะเป็น `disputed` — dispatch/receive/cancel/
  resume ทำไม่ได้ฝั่งปลายทาง (`assertActorMayTransition` เดิมครอบคลุมกฎนี้อยู่แล้วโดยไม่ต้องเพิ่ม logic
  ใหม่ เพราะ resume เป็น source-only เหมือน dispatch/cancel)
- **FR-14** — `disputed` reach ได้จาก `requested` เท่านั้น และออกได้แค่กลับไป `requested` เท่านั้น (ไม่ไป
  `shipped`/`received`/`cancelled` ตรงจาก `disputed`)
- **FR-15** — ปุ่ม "คัดค้าน/ระงับ" และ "กลับมาดำเนินการต่อ" (resume) ขึ้นที่ตาราง `transfer-list.svelte`
  เดิม (แถวเดียวกับปุ่ม dispatch/receive/cancel ที่มีอยู่แล้ว) — ไม่ผูกกับหน้ารายละเอียดใน CR-091 เพื่อให้
  CR นี้ ship ได้เองโดยไม่ต้องรอ CR-091

> ดู [CR-090](CR-090-t13-transfer-delete-undo.md) สำหรับลบคำร้อง+Undo และ
> [CR-091](CR-091-t13-transfer-detail-page.md) สำหรับหน้ารายละเอียด Ticket — ทั้งสองไม่แตะ `schema_v`
> ของ `stock_transfer` จึง approve/ship แยกจาก CR นี้ได้อิสระ ไม่ต้องเรียงลำดับก่อนหลัง

---

## Acceptance (DoD)

- [ ] สร้างคำร้องที่มีหลายบรรทัด `item_id` เดียวกันคนละ lot ได้ (FR-03) และ balance check reject เมื่อ
      **ผลรวม** ของทุกบรรทัด `item_id` เดียวกันเกิน balance จริง แม้แต่ละบรรทัดแยกกันจะไม่เกินก็ตาม
      (FR-07, FR-16)
- [ ] กด "อนุมัติส่งมอบ" โดยไม่กรอกผู้ขับขี่/ทะเบียนรถ ต้องถูก block ทั้ง client และ server (FR-08)
- [ ] source กด "คัดค้าน/ระงับ" ได้เฉพาะตอน `requested`, ต้องกรอกเหตุผล, กลับมา `requested` ได้ (resume)
      (FR-11, FR-12)
- [ ] ปลายทางเรียก dispatch/receive/resume บนคำร้องของศูนย์ตนเองไม่ได้ตาม role เดิม แม้สถานะเป็น
      `disputed` (FR-13)
- [ ] ปุ่มคัดค้าน/ระงับ/resume ใช้งานได้จากตาราง list เดิมโดยไม่ต้องมี CR-090/CR-091 ship มาก่อน (FR-15)

---

## Why

- CR-059 §4 (Flow 1) กำหนด requirement เหล่านี้ไว้ตั้งแต่ 2026-07-25 แต่ Decision Log 2026-08-22 ("T-13
  write-path implementation detail" + schema.md §5.5 หมายเหตุท้าย) ระบุชัดว่า field ละเอียด (lot split,
  driver/plate, destination lot, dispute) **ยังไม่ approve ในรอบนั้น** — ครอบคลุมแค่สถาปัตยกรรม cross-DB
  write path เท่านั้น ⇒ ต้องเปิด CR ใหม่แยกก่อนแตะ field เหล่านี้ตาม `docs/change-management.md` §2
- ตรวจโค้ดจริงพบว่าระบบทั้งระบบไม่มี concept ของ "lot" เป็น entity ที่มี `lot_id`/per-lot balance เลย
  (`lot` เป็นแค่ metadata ฝังใน `stock_ledger`, `stock-table.svelte:107-113` มี comment ยอมรับข้อจำกัดนี้
  มาตั้งแต่ T-11) — การทำ "เลือก lot จริง" แบบสมบูรณ์ (per-lot balance, FEFO) เป็นงานแก้ `stock_ledger`
  (stable core) ระดับหลายสัปดาห์ ไม่ทันกำหนดส่งที่ใกล้เข้ามา จึงเลือกทางแก้แบบ interim (กลุ่ม A) แทน —
  บันทึกไว้ชัดเป็นข้อจำกัดที่ตั้งใจ ไม่ใช่ bug ที่ลืมแก้
- ตัวเลือก tier ในแต่ละกลุ่ม (A/B/C) มาจาก project owner เทียบข้อดี-ข้อเสียแล้วเลือกในการสนทนา 2026-08-25
  — รายละเอียดการเทียบและเหตุผลที่เลือกแต่ละอันดู Decision log ด้านล่าง
- แยก D (delete+undo) และ E (หน้ารายละเอียด) ออกจาก CR นี้เพราะทั้งสองไม่เปลี่ยน doc shape ของ
  `stock_transfer` เลย — ไม่มีเหตุผลทางเทคนิคให้ต้องรอ approve พร้อมกับ A/B/C ที่ต้องเคาะ `schema_v` ร่วมกัน
  (ดู CR-090, CR-091)

---

## Change (before → after)

| เรื่อง | ก่อน (โค้ดใน `71fd0b35`) | หลัง (CR นี้) |
| --- | --- | --- |
| Lot | ไม่มี `lot` ใน `StockTransferItem` เลย, กรอก `item_id` แบบ free text | มี `lot?`/`source_lot?` optional, เลือกจาก distinct lot ที่เคยมีจริงในประวัติ ledger |
| Driver/Plate | ไม่มี field นี้เลย | บังคับกรอกก่อน transition เป็น `shipped` |
| Dispute | ไม่มี — มีแค่ `cancelled` (ไม่มี reason บังคับ) | เพิ่ม `disputed` (resumable) + `cancel_reason` บังคับ |

Delete+Undo และ Ticket detail page — ดู CR-090/CR-091 ตามลำดับ (spun out, ไม่กระทบตารางนี้)

---

## Impact

- **Docs:** `docs/data/schema.md` §5.5 (field table `stock_transfer` — เพิ่ม field ทั้งหมดข้างต้น,
  schema_v 2 → 3)
- **Domain:** `frontend/src/lib/features/operations/domain/operations.ts` —
  `StockTransferItem`(+`lot`,+`source_lot`), `StockTransfer`(+`driver_name`,+`vehicle_plate`,
  +`cancel_reason`,+`dispute_reason`), `transferStatusSchema`(+`disputed`), เพิ่ม
  `disputeTransfer()`/`resumeTransfer()` คู่ `dispatchTransfer`/`receiveTransfer`/`cancelTransfer` เดิม
- **Authorization:** `frontend/src/lib/features/operations/domain/transfer.authorization.ts` — ขยาย
  `isValidTransition()` ให้รู้จัก `disputed` (2 ทิศทาง)
- **Data/server:** `frontend/src/lib/features/operations/data/transfer.server-repository.ts` — ขยาย
  `transition()` รองรับ `disputed`; แก้ `assertSufficientStock()` ให้รวมยอด `qty` ต่อ `item_id` ก่อนเทียบ
  balance (FR-16); `routes/api/back-office/transfer/[id]/transition/+server.ts` รองรับ
  `to: 'disputed' | 'requested'` (resume) พร้อม validate `driver_name`/`vehicle_plate` ตอน
  `to: 'shipped'`
- **Client:** `operations.remote.ts`, `application/queries.ts` เพิ่ม hook `useDisputeTransfer` /
  `useResumeTransfer`
- **UI:** `transfer-form.svelte` (lot picker + split-lot lines + driver/plate ที่ dispatch confirm),
  `transfer-list.svelte` (เพิ่มปุ่มคัดค้าน/ระงับ/resume ในแถวเดิม)
- **Test:** ทุกไฟล์ `*.test.ts` คู่ของไฟล์ข้างต้น (`operations.test.ts`,
  `transfer.authorization.test.ts`, `transfer.server-repository.test.ts`, `server.test.ts` ของ
  `api/back-office/transfer/[id]/transition/`)
- ปิด backlog note ที่ค้างใน CR-059 (§5.5 "ยังไม่ approve ในรอบนี้") บางส่วน — Delete/Detail-page อยู่ใน
  CR-090/CR-091

---

## Migration

`stock_transfer` schema_v 2 → 3 — additive ล้วน (field ใหม่ทั้งหมด optional หรือมีค่าตอน transition ใหม่
เกิดขึ้นเท่านั้น) ยกเว้น `TransferStatus` enum ที่เพิ่มค่า `disputed` (additive, ไม่กระทบ enum เดิม) doc
เดิมที่สร้างจาก `71fd0b35` (ถ้ามีใน dev/seed) อ่านได้ปกติ — ไม่มี field ใหม่ = แสดงว่าง ไม่ throw ·
pre-prod ไม่มี production data จริง ไม่ต้อง backfill

---

## Decision log

- 2026-08-25 — proposed — เปิดจากการเทียบ CR-059 Flow 1 spec กับโค้ดจริงใน `71fd0b35` แล้วพบว่า field
  ละเอียด 5 กลุ่มยังไม่ implement (Lot / Driver-Plate / Dispute / Delete / Detail-page) ตรงกับที่
  CR-059 เองระบุไว้ว่า "ยังไม่ approve ในรอบนี้" — เปิดเป็น CR เดียวครอบคลุมทั้ง 5 กลุ่มก่อน
- 2026-08-25 — เลือก tier ของแต่ละกลุ่มโดย project owner หลังเทียบข้อดี-ข้อเสียที่เสนอ: กลุ่ม A (Lot) →
  **Interim** (ใช้ lot metadata ที่มีอยู่ ไม่สร้าง `stock_lot` entity ใหม่ — proper fix ต้องแก้
  `stock_ledger` ซึ่งเป็น stable core ระดับหลายสัปดาห์ ไม่ทันเดดไลน์; ตัวเลือก "เลื่อนออกไปทั้งหมด" ถูกตัด
  ออกเพราะเสีย traceability ที่ตกลงกับ Logistics ไปแล้ว) · กลุ่ม C (Dispute) → **ใช้ `cancelled` เดิมแทน
  ปฏิเสธ + เพิ่ม `disputed` ใหม่ 1 ตัวแทนระงับ** (schema surface เพิ่มน้อยสุดเทียบกับแยก 2 state ใหม่ทั้งคู่)
  — กลุ่ม D/E ดู decision log ของ CR-090/CR-091 แทน (แยกไฟล์แล้ว)
- 2026-08-25 — **แยก CR ออกเป็น 3 ไฟล์** หลัง project owner ถามว่าทำไมไม่แยก — เหตุผลทางเทคนิค: กลุ่ม A/B/C
  เปลี่ยน doc shape ของ `stock_transfer` จริง (ต้องเคาะ `schema_v` 2 → 3 ร่วมกันเป็นก้อนเดียว กันปัญหา
  สอง CR ประกาศ "2 → 3" ชนกันถ้า approve ไม่พร้อมกัน) ส่วนกลุ่ม D (delete+undo) และ E (หน้ารายละเอียด)
  ไม่แตะ `schema_v` เลย ไม่มีเหตุผลทางเทคนิคให้ผูกกับ A/B/C ⇒ แยกเป็น
  **[CR-090](CR-090-t13-transfer-delete-undo.md)** (D) และ
  **[CR-091](CR-091-t13-transfer-detail-page.md)** (E) — CR นี้เหลือแค่ A+B+C
- **ยังไม่ตัดสินใจ (รอ owner เคาะจริงในไฟล์นี้ก่อนเริ่มโค้ด):** สถานะ CR นี้ยังเป็น `proposed` — การเลือก
  tier ข้างต้นเป็นข้อเสนอจาก session สนทนาวันนี้ ยังไม่ใช่ `approved` อย่างเป็นทางการตาม
  `docs/change-management.md` §5 ข้อ 4
- 2026-08-25 — เพิ่ม **FR-16** — พบว่า `assertSufficientStock` (`transfer.server-repository.ts:148-170`)
  เช็ค balance ทีละบรรทัดแยกกัน ไม่รวมยอดหลายบรรทัดของ `item_id` เดียวกัน ตอนตอบคำถาม "ทำครบ 3 CR แล้วผ่าน
  Flow 1 ไหม" — ถ้าไม่แก้ split allocation (FR-03) จะปล่อยให้ dispatch เกินสต็อกจริงได้เมื่อแยกเบิกหลาย
  บรรทัดของ item เดียวกัน
