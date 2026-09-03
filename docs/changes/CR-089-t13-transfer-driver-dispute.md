---
id: CR-089
title: T-13 โอนย้ายข้ามศูนย์ — Driver/Plate + Dispute (schema_v 2 → 3)
status: approved
date: 2026-08-25
updated: 2026-08-31
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
  - CR-088 (stock_ledger.lot_no/storage_zone) — เดิม CR นี้มีกลุ่ม Lot ที่ซ้ำกับ CR-088 ตัดออกแล้ว ดู Decision log
---

# CR-089 — T-13 โอนย้ายข้ามศูนย์: Driver/Plate + Dispute

> เดิม CR นี้รวม 5 กลุ่ม (Lot/Driver-Plate/Dispute/Delete+Undo/Detail Page) — แยก **Delete+Undo** ออกเป็น
> [CR-090](CR-090-t13-transfer-delete-undo.md) และ **หน้ารายละเอียด Ticket** ออกเป็น
> [CR-091](CR-091-t13-transfer-detail-page.md) แล้ว (2026-08-25) เพราะสองกลุ่มนั้นไม่แตะ `schema_v` เลย —
> **ต่อมาตัดกลุ่ม Lot ออกทั้งหมดด้วย** (2026-08-25 เช่นกัน) หลังพบว่าซ้ำกับ
> [CR-088](CR-088-stock-ledger-lot-storage-zone.md) ที่ approve ไปวันเดียวกัน — ดู Decision log ท้ายไฟล์
> สำหรับรายละเอียดทั้งสองจุด

## สรุป (TL;DR)

เพิ่ม field ที่ CR-059 §4.1/4.3 (Flow 1) ระบุไว้แต่ `71fd0b35` ยังไม่ implement และเปลี่ยน doc shape ของ
`stock_transfer` จริง: บังคับกรอกผู้ขับขี่/ทะเบียนรถก่อนส่งมอบ, สถานะ `disputed` (คัดค้าน/ระงับ) ·
`stock_transfer` schema_v 2 → 3 (additive) · กระทบ `operations` feature ทั้ง 4 layer, ไม่มี route ใหม่ ·
**status ยังเป็น `proposed`** — รอ project owner เคาะ `approved` ในไฟล์นี้ก่อนเริ่มโค้ดจริง ·
**ไม่ครอบคลุมเรื่อง Lot อีกต่อไป** (ตัดออกแล้ว — ดู Decision log)

---

## Requirements

### กลุ่ม A — ผู้ขับขี่ / ทะเบียนรถ

- **FR-01** — transition เป็น `shipped` ต้องมี `driver_name` (str, ไม่ว่าง) และ `vehicle_plate` (str,
  ไม่ว่าง) แนบมาด้วยเสมอ — validate ทั้ง client (ฟอร์ม dispatch confirm ไม่ใช่ฟอร์ม create) และ server
  (`transition()` reject ก่อนตัดสต็อกถ้าขาด)
- **FR-02** — เก็บ `driver_name` / `vehicle_plate` เป็น field ระดับบนของ `StockTransfer` เขียนครั้งเดียว
  ตอน dispatch, read-only หลังจากนั้น

### กลุ่ม B — คัดค้าน/ระงับคำสั่ง (dispute)

- **FR-03** — transition `cancelled` (มีอยู่แล้ว, source-only, จาก `requested` เท่านั้น) เพิ่ม field
  บังคับ `cancel_reason: str`
- **FR-04** — เพิ่มค่า enum ใหม่ใน `TransferStatus`: `disputed`. Transition `requested → disputed` —
  source-only, ต้องมี `dispute_reason: str`
- **FR-05** — transition `disputed → requested` (resume) — source-only, ไม่ต้องมี field เพิ่ม (ล้าง
  block กลับสู่สถานะปกติ); ไม่เก็บ dispute history หลายรอบ — เก็บแค่ `dispute_reason` ล่าสุด (ของรอบ
  ก่อนหน้าถูกทับ)
- **FR-06** — ปลายทาง (`to_shelter`) ทำได้แค่อ่านตอนสถานะเป็น `disputed` — dispatch/receive/cancel/
  resume ทำไม่ได้ฝั่งปลายทาง (`assertActorMayTransition` เดิมครอบคลุมกฎนี้อยู่แล้วโดยไม่ต้องเพิ่ม logic
  ใหม่ เพราะ resume เป็น source-only เหมือน dispatch/cancel)
- **FR-07** — `disputed` reach ได้จาก `requested` เท่านั้น และออกได้แค่กลับไป `requested` เท่านั้น (ไม่ไป
  `shipped`/`received`/`cancelled` ตรงจาก `disputed`)
- **FR-08** — ปุ่ม "คัดค้าน/ระงับ" และ "กลับมาดำเนินการต่อ" (resume) ขึ้นที่ตาราง `transfer-list.svelte`
  เดิม (แถวเดียวกับปุ่ม dispatch/receive/cancel ที่มีอยู่แล้ว) — ไม่ผูกกับหน้ารายละเอียดใน CR-091 เพื่อให้
  CR นี้ ship ได้เองโดยไม่ต้องรอ CR-091

> ดู [CR-090](CR-090-t13-transfer-delete-undo.md) สำหรับลบคำร้อง+Undo และ
> [CR-091](CR-091-t13-transfer-detail-page.md) สำหรับหน้ารายละเอียด Ticket — ทั้งสองไม่แตะ `schema_v`
> ของ `stock_transfer` จึง approve/ship แยกจาก CR นี้ได้อิสระ ไม่ต้องเรียงลำดับก่อนหลัง

---

## Acceptance (DoD)

- [ ] กด "อนุมัติส่งมอบ" โดยไม่กรอกผู้ขับขี่/ทะเบียนรถ ต้องถูก block ทั้ง client และ server (FR-01)
- [ ] source กด "คัดค้าน/ระงับ" ได้เฉพาะตอน `requested`, ต้องกรอกเหตุผล, กลับมา `requested` ได้ (resume)
      (FR-04, FR-05)
- [ ] ปลายทางเรียก dispatch/receive/resume บนคำร้องของศูนย์ตนเองไม่ได้ตาม role เดิม แม้สถานะเป็น
      `disputed` (FR-06)
- [ ] ปุ่มคัดค้าน/ระงับ/resume ใช้งานได้จากตาราง list เดิมโดยไม่ต้องมี CR-090/CR-091 ship มาก่อน (FR-08)

---

## Why

- CR-059 §4 (Flow 1) กำหนด requirement เหล่านี้ไว้ตั้งแต่ 2026-07-25 แต่ Decision Log 2026-08-22 ("T-13
  write-path implementation detail" + schema.md §5.5 หมายเหตุท้าย) ระบุชัดว่า field ละเอียด (driver/plate,
  dispute) **ยังไม่ approve ในรอบนั้น** — ครอบคลุมแค่สถาปัตยกรรม cross-DB write path เท่านั้น ⇒ ต้องเปิด
  CR ใหม่แยกก่อนแตะ field เหล่านี้ตาม `docs/change-management.md` §2
- ตัวเลือก tier ของกลุ่ม B (Dispute) มาจาก project owner เทียบข้อดี-ข้อเสียแล้วเลือกในการสนทนา 2026-08-25
  — รายละเอียดการเทียบและเหตุผลที่เลือกดู Decision log ด้านล่าง
- แยก D (delete+undo) และ E (หน้ารายละเอียด) ออกจาก CR นี้เพราะทั้งสองไม่เปลี่ยน doc shape ของ
  `stock_transfer` เลย — ไม่มีเหตุผลทางเทคนิคให้ต้องรอ approve พร้อมกับกลุ่มที่ต้องเคาะ `schema_v` ร่วมกัน
  (ดู CR-090, CR-091)
- **กลุ่ม Lot ถูกตัดออกทั้งหมด** หลังพบว่าซ้ำกับ [CR-088](CR-088-stock-ledger-lot-storage-zone.md)
  (approve วันเดียวกัน 2026-08-25) — CR-088 เพิ่ม `lot_no`/`storage_zone` จริงบน `StockLot` ไปแล้ว
  ทำให้สมมติฐานเดิมของกลุ่มนี้ ("ระบบไม่มี concept lot ที่มี lot_id/storage_zone เลย") ไม่จริงอีกต่อไป —
  รายละเอียดเต็มอยู่ใน Decision log ด้านล่าง

---

## Change (before → after)

| เรื่อง | ก่อน (โค้ดใน `71fd0b35`) | หลัง (CR นี้) |
| --- | --- | --- |
| Driver/Plate | ไม่มี field นี้เลย | บังคับกรอกก่อน transition เป็น `shipped` |
| Dispute | ไม่มี — มีแค่ `cancelled` (ไม่มี reason บังคับ) | เพิ่ม `disputed` (resumable) + `cancel_reason` บังคับ |

Delete+Undo และ Ticket detail page — ดู CR-090/CR-091 ตามลำดับ (spun out, ไม่กระทบตารางนี้)

---

## Impact

- **Docs:** `docs/data/schema.md` §5.5 (field table `stock_transfer` — เพิ่ม `driver_name`,
  `vehicle_plate`, `cancel_reason`, `dispute_reason`, ค่า enum `disputed`, schema_v 2 → 3)
- **Domain:** `frontend/src/lib/features/operations/domain/operations.ts` —
  `StockTransfer`(+`driver_name`,+`vehicle_plate`,+`cancel_reason`,+`dispute_reason`),
  `transferStatusSchema`(+`disputed`), เพิ่ม `disputeTransfer()`/`resumeTransfer()` คู่
  `dispatchTransfer`/`receiveTransfer`/`cancelTransfer` เดิม
- **Authorization:** `frontend/src/lib/features/operations/domain/transfer.authorization.ts` — ขยาย
  `isValidTransition()` ให้รู้จัก `disputed` (2 ทิศทาง)
- **Data/server:** `frontend/src/lib/features/operations/data/transfer.server-repository.ts` — ขยาย
  `transition()` รองรับ `disputed`; `routes/api/back-office/transfer/[id]/transition/+server.ts` รองรับ
  `to: 'disputed' | 'requested'` (resume) พร้อม validate `driver_name`/`vehicle_plate` ตอน
  `to: 'shipped'`
- **Client:** `operations.remote.ts`, `application/queries.ts` เพิ่ม hook `useDisputeTransfer` /
  `useResumeTransfer`
- **UI:** `transfer-form.svelte` (เพิ่มช่อง driver/plate ที่ dispatch confirm เท่านั้น — ฟอร์ม create
  เดิมไม่เปลี่ยน), `transfer-list.svelte` (เพิ่มปุ่มคัดค้าน/ระงับ/resume ในแถวเดิม)
- **Test:** ทุกไฟล์ `*.test.ts` คู่ของไฟล์ข้างต้น (`operations.test.ts`,
  `transfer.authorization.test.ts`, `transfer.server-repository.test.ts`, `server.test.ts` ของ
  `api/back-office/transfer/[id]/transition/`)
- ปิด backlog note ที่ค้างใน CR-059 (§5.5 "ยังไม่ approve ในรอบนี้") บางส่วน — Delete/Detail-page อยู่ใน
  CR-090/CR-091; เรื่อง Lot ไม่ปิด — ยังเป็น ❌ ไม่มี CR ไหน cover ในรอบนี้ (ดู Decision log)

---

## Migration

`stock_transfer` schema_v 2 → 3 — additive ล้วน (`driver_name`/`vehicle_plate`/`cancel_reason`/
`dispute_reason` เป็น optional หรือมีค่าตอน transition ใหม่เกิดขึ้นเท่านั้น) ยกเว้น `TransferStatus`
enum ที่เพิ่มค่า `disputed` (additive, ไม่กระทบ enum เดิม) doc เดิมที่สร้างจาก `71fd0b35` (ถ้ามีใน
dev/seed) อ่านได้ปกติ — ไม่มี field ใหม่ = แสดงว่าง ไม่ throw · pre-prod ไม่มี production data จริง
ไม่ต้อง backfill

---

## Decision log

- 2026-08-25 — proposed — เปิดจากการเทียบ CR-059 Flow 1 spec กับโค้ดจริงใน `71fd0b35` แล้วพบว่า field
  ละเอียด 5 กลุ่มยังไม่ implement (Lot / Driver-Plate / Dispute / Delete / Detail-page) ตรงกับที่
  CR-059 เองระบุไว้ว่า "ยังไม่ approve ในรอบนี้" — เปิดเป็น CR เดียวครอบคลุมทั้ง 5 กลุ่มก่อน
- 2026-08-25 — เลือก tier ของแต่ละกลุ่มโดย project owner หลังเทียบข้อดี-ข้อเสียที่เสนอ: กลุ่ม Lot (ตอนนั้น
  ยังอยู่ใน CR นี้) → **Interim** (ใช้ lot metadata ที่มีอยู่ ไม่สร้าง `stock_lot` entity ใหม่) · กลุ่ม
  Dispute → **ใช้ `cancelled` เดิมแทนปฏิเสธ + เพิ่ม `disputed` ใหม่ 1 ตัวแทนระงับ** (schema surface เพิ่ม
  น้อยสุดเทียบกับแยก 2 state ใหม่ทั้งคู่) — กลุ่ม Delete/Detail-page ดู decision log ของ CR-090/CR-091
  แทน (แยกไฟล์แล้ว)
- 2026-08-25 — **แยก CR ออกเป็น 3 ไฟล์** หลัง project owner ถามว่าทำไมไม่แยก — เหตุผลทางเทคนิค: กลุ่มที่
  เปลี่ยน doc shape ของ `stock_transfer` จริงต้องเคาะ `schema_v` 2 → 3 ร่วมกันเป็นก้อนเดียว (กันปัญหาสอง
  CR ประกาศ "2 → 3" ชนกันถ้า approve ไม่พร้อมกัน) ส่วน delete+undo และหน้ารายละเอียดไม่แตะ `schema_v`
  เลย ไม่มีเหตุผลทางเทคนิคให้ผูกด้วยกัน ⇒ แยกเป็น **[CR-090](CR-090-t13-transfer-delete-undo.md)** และ
  **[CR-091](CR-091-t13-transfer-detail-page.md)**
- 2026-08-25 — พบว่ากลุ่ม Lot (ตอนนั้นยังอยู่ใน CR นี้) **ซ้ำกับ [CR-088](CR-088-stock-ledger-lot-storage-zone.md)**
  ซึ่ง approve ไปวันเดียวกัน — CR-088 เพิ่ม `lot_no` (`L-YYMMDD-XXX`, gen จริงฝั่ง server) และ
  `storage_zone` บน `StockLot` (ใช้กับ `stock_ledger.lot`) ไปแล้ว ขณะที่กลุ่ม Lot ของ CR นี้เสนอ workaround
  ด้วย `lot.note` เอง โดยให้เหตุผลว่า "ระบบยังไม่มี concept lot ที่มี `lot_id`/`storage_zone` เลย" — เหตุผล
  นั้นไม่จริงอีกต่อไปตั้งแต่ CR-088 approve เพิ่ม FR ใหม่ (แก้บั๊ก `assertSufficientStock` ที่กลุ่ม Lot
  เปิดออกมาผ่าน split allocation) ให้ด้วยตอนนั้น
- 2026-08-25 — **project owner ตัดสินใจตัดกลุ่ม Lot ออกจาก CR นี้ทั้งหมด** (ไม่ใช่แค่แก้ให้ reference
  CR-088) — เหตุผล: ถ้าต้องการให้ dispatch/receive form ของ transfer ใช้ `lot_no`/`storage_zone` จาก
  CR-088 จริง ต้องเพิ่ม field ใหม่บน `StockTransferItem` (ยังไม่มี `lot` เลยในปัจจุบัน) ซึ่งยังเปลี่ยน
  doc shape อยู่ดี — ตัดสินใจว่าไม่คุ้มจะรีบทำเป็น interim workaround อีกรอบในเมื่อ CR-088 แก้ปัญหาการ
  gen เลขล็อตที่ถูกต้องแล้วสำหรับ flow ตรวจรับบริจาค — เรื่อง Lot ของ T-13 transfer เก็บไว้เปิด CR ใหม่
  แยกทีหลัง (นอก scope ของ CR นี้) **ผลคือ CR-059 Flow 1 ข้อ "เลือก Lot สต็อกจริง", "Split Allocation",
  "Destination Lot ID", "Traceability (source lot)", "ตรวจสอบวันหมดอายุจริง" (5 ข้อ) กลับไปเป็น ❌ — ไม่มี
  CR ไหน cover ในรอบนี้เลย** ต้องเปิด CR ใหม่แยกภายหลังถ้าต้องการปิดข้อเหล่านี้ (แนะนำให้อ้างอิง CR-088
  ตั้งแต่ต้นตอนเปิด ไม่ต้อง reinvent เหมือนรอบนี้)
- 2026-08-25 — **ตัด FR ที่แก้บั๊ก `assertSufficientStock`** ออกจาก scope ของ CR นี้ด้วย (trigger เดิม
  คือ split allocation ของกลุ่ม Lot ที่เพิ่งถูกตัดออก) — บั๊กยังมีอยู่จริงใน `71fd0b35`
  (`transfer.server-repository.ts:148-170` เช็ค balance ทีละบรรทัดแยกกัน ไม่รวมยอดหลายบรรทัดของ
  `item_id` เดียวกัน) แต่ความเสี่ยงต่ำลงมากเพราะไม่มี UI ไหนชวนให้กรอก `item_id` ซ้ำในคำร้องเดียวอีกแล้ว
  — เป็น known issue ที่บันทึกไว้เฉยๆ ไม่ต้องเปิด CR แยก (เป็นการแก้บั๊กให้ตรงกับกฎเดิม ไม่ใช่การเปลี่ยน
  rule/schema ตาม `docs/change-management.md` §2) แต่ควรแก้เมื่อมีโอกาสเพราะ `items[]` ไม่เคยบังคับ
  unique `item_id` มาตั้งแต่ต้น
- **ยังไม่ตัดสินใจ (รอ owner เคาะจริงในไฟล์นี้ก่อนเริ่มโค้ด):** สถานะ CR นี้ยังเป็น `proposed` — การเลือก
  tier ข้างต้นเป็นข้อเสนอจาก session สนทนาวันนี้ ยังไม่ใช่ `approved` อย่างเป็นทางการตาม
  `docs/change-management.md` §5 ข้อ 4
