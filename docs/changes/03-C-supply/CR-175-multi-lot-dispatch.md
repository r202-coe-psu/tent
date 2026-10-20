---
id: CR-175
title: "CR-175 — ปล่อยของตามตั๋วเบิกเลือกได้หลาย lot ต่อรายการ (multi-lot dispatch)"
status: approved
date: 2026-10-20
approved_at: 2026-10-20
requested_by: feedback ระบบคลัง & เบิกของ ข้อ 1 (GitHub #655)
decided_by: "kong"
layer: volatile
affects:
  - docs/changes/03-C-supply/CR-121-spec-ticket.md FR-TKT-04 / AC-TKT-04.1 (แถว ledger ต่อ item → ต่อ lot)
  - docs/changes/03-C-supply/CR-143-stock-redesign-rules.md §A FR-A7–FR-A11 (ขยายจากเบิกตรงหน้าคลังมาใช้กับเส้นทางตั๋ว)
  - schema_v — ไม่เปลี่ยน (ไม่มี persisted doc shape ใหม่)
  - frontend/src/lib/features/distribution/domain/food-supplies (dispatch-lots.ts ใหม่)
  - frontend/src/lib/features/distribution/application/food-supplies/dispatch-workflow.ts
  - frontend/src/lib/features/distribution/ui/back-office (PhysicalLotPicker.svelte, DispatchTicketDialog.svelte)
  - frontend/src/lib/features/distribution/ui/model/physical-lot.ts
---

# CR-175 — ปล่อยของตามตั๋วเบิกเลือกได้หลาย lot ต่อรายการ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** ขั้น "เลือก Physical Lot และปล่อยรถ" ของตั๋วเบิกเลือกได้หลาย lot ต่อรายการ
>   (กรอกจำนวนต่อ lot หรือกดจัดสรรอัตโนมัติ) แล้วบันทึกแถว `distribute` **หนึ่งแถวต่อ lot**
>   ภายใต้ `ref_id` (ตั๋ว) เดียวกัน
> - **กติกา:** ผลรวมทุก lot = `allocated_qty`; แต่ละ lot ไม่เกินยอดคงเหลือ; lot หมดอายุเลือกไม่ได้;
>   ไม่มี lot → ปฏิเสธ (เลิก fallback `lot_ref` = id ของแถวตัวเอง)
> - **schema:** ไม่เปลี่ยนรูป doc และไม่ bump `schema_v` — เปลี่ยนแค่จำนวนแถวและกติกาตรวจ
> - **อ้างอิง:** [#655](https://github.com/r202-coe-psu/tent/issues/655) (งานนี้),
>   [#569](https://github.com/r202-coe-psu/tent/issues/569) (ยอดต่อ lot ของปรับยอด/ตรวจนับ — เกี่ยวข้อง ไม่ได้แก้ในนี้)

---

## Context

- ปัจจุบัน `PhysicalLotPicker.svelte` เลือกได้ **lot เดียวต่อรายการ** และ lot นั้นต้องมีของ
  ≥ `allocated_qty` เช่น ต้องการ 5 แต่ lot 1 มี 3 และ lot 2 มี 2 → ปล่อยของไม่ได้เลย
- `dispatchTicket` (`distribution/application/food-supplies/dispatch-workflow.ts`) เขียนแถว
  `distribute` 1 แถว/รายการ และถ้าไม่ได้ส่ง lot มา จะตั้ง `lot_ref` เป็น `_id` ของแถวตัวเอง
  ซึ่งไม่ใช่ lot จริง และ workflow ไม่ตรวจยอดคงเหลือ / วันหมดอายุของ lot
- เบิกตรงจากหน้าคลังมีโหมดแบ่งหลาย lot แล้วตาม CR-143 §A (`planLotSplit`,
  `distributeAcrossLots`) แต่เส้นทางตั๋วยังไม่ได้ใช้
- #569: ฟอร์มปรับยอด/ตรวจนับจัดกลุ่มยอดต่อ lot จากฟิลด์ `lot` ของแต่ละแถวและไม่ดู `lot_ref`
  ส่วนแถว `distribute` ของตั๋วมี `lot_ref` แต่ไม่มี `lot` CR นี้**ไม่ทำให้แย่ลง**: ทุกแถวที่เขียนมี
  `lot_ref` ชี้ lot จริงเสมอ (ดู Open question Q4 เรื่องการคัดลอก `lot`)

## Why

- ของจริงในคลังมักกระจายหลาย lot — บังคับ lot เดียวทำให้ปล่อยของตามที่อนุมัติไม่ได้ ทั้งที่ยอดรวมพอ
- CR-143 FR-A5 กำหนดให้ distribution (dispatch) ใช้ลำดับ lot ชุดเดียวกับหน้าคลัง และ FR-A7–A11
  กำหนดการเบิกหลาย lot ไว้แล้วสำหรับเบิกตรง — เส้นทางตั๋วควรใช้กติกาเดียวกัน
- fallback `lot_ref` = id ตัวเอง สร้างแถวที่ `projectStockLotBalances` หา lot ไม่เจอ และเป็นที่มาของ
  ยอดต่อ lot ไม่ตรงกัน (เกี่ยวกับ #569)

## Change

**Before**

- เลือก 1 lot/รายการ, lot ต้องมี ≥ `allocated_qty`
- `item_lots: Record<item_id, lot_ref>`
- 1 แถว `distribute` ต่อรายการ, qty = `-allocated_qty`, `_id` = deterministic(`dispatch`, ticket, item)
- ไม่มี lot → `lot_ref` = `_id` ตัวเอง (ไม่ error)

**After**

1. **Picker หลาย lot:** ต่อรายการ กรอกจำนวนต่อ lot ได้หลาย lot; มีปุ่ม "จัดสรรอัตโนมัติ" ที่เรียง lot
   ด้วย `rankLotsForIssue` (CR-143 FR-A3, `excludeExpired`) แล้วแบ่งด้วย `planLotSplit`
   (reuse ผ่าน barrel `$lib/features/operations`) — ผู้ใช้แก้จำนวนหลังจัดสรรได้ (FR-A10)
2. **กติกาตรวจ** (ทั้ง UI และ workflow ใช้ฟังก์ชัน domain เดียวกัน `validateDispatchLotAllocations`):
   - มีอย่างน้อย 1 lot; `lot_ref` รูปแบบ `stock_ledger:…`; ไม่ซ้ำ lot ในรายการเดียวกัน
   - จำนวนต่อ lot > 0 และ ≤ ยอดคงเหลือของ lot (จาก `projectStockLotBalances`)
   - lot หมดอายุ (`isLotExpired`, CR-143 FR-A4/A4a) เลือกไม่ได้
   - ผลรวมทุก lot **เท่ากับ** `allocated_qty` พอดี — ขาดหรือเกิน → ปุ่มยืนยันกดไม่ได้ และ workflow ปฏิเสธ
3. **Ledger:** หนึ่งแถว `distribute` ต่อ lot, qty = `-qty ของ lot นั้น`, `ref_id` = ตั๋วเดียวกันทุกแถว,
   `lot_ref` = lot จริง
   - เรียงแถวตาม `lot.expiry` เร็วสุดก่อน (ไม่มี expiry ไว้ท้าย, เท่ากันเรียงตาม `lot_ref`)
   - แถวแรก (expiry เร็วสุด) ใช้ `_id` deterministic เดิม (`dispatch`, ticket, item) เพื่อให้
     `resolveDispatchedLotExpiry` (นาฬิกาความปลอดภัยอาหาร FR-MQW-06 B) ได้วันหมดอายุที่เร็วสุดโดยไม่ต้องแก้
   - แถวถัดไปใช้ deterministic(`dispatch`, ticket, item, lot_ref) — retry แล้วไม่เขียนซ้ำ
4. **ไม่มี lot → error:** ลบ fallback `lot_ref` = `ledgerId`; ตรวจทุกรายการก่อนเขียนแถวแรก
5. `item_lots` (payload ภายใน ไม่ persist) เปลี่ยนเป็น `Record<item_id, { lot_ref, qty }[]>`

## Amends — ข้อความเดิมที่ถูกแก้

- **CR-121 FR-TKT-04 ข้อ 1:** "บันทึกตัดสต็อกจริงออกจากคลังสินค้าใน `stock_ledger` ทันทีด้วย
  `qty: `-${allocated_qty}`` … และผูก `ref_id: ticket._id`"
  → ยอดรวมของทุกแถวต่อรายการ = `-allocated_qty` (แบ่งได้หลายแถวตาม lot)
- **CR-121 AC-TKT-04.1:** "การตัดสต็อกใน `stock_ledger` ต้องบันทึกแยกแถวตาม `item_id` และระบุจำนวนเป็นลบ
  ตรงกับ `allocated_qty` โดยมี `ref_id` ขึ้นต้นด้วย `requisition_ticket:` เสมอ"
  → แยกแถวตาม (`item_id`, `lot_ref`); ผลรวมจำนวนลบของแถวที่มี `item_id` เดียวกัน = `allocated_qty`
- **CR-143 §A FR-A7:** "เมื่อจำนวนที่เบิกเกินยอดในล็อตแรก ระบบต้องวางแผนแบ่งล็อตตามลำดับ FR-A3 จนครบจำนวน
  และต้องข้ามล็อตตาม FR-A4" → ใช้กับเส้นทางตั๋ว (ปุ่มจัดสรรอัตโนมัติ) ด้วย
- **CR-143 §A FR-A8:** "ทุกล็อตในแผนบันทึกเป็นแถว `distribute` แยกกัน (ผ่าน reservation claim ต่อล็อตตามเดิม)
  และใช้ `ref_id` (`requisition_ticket:direct-…`) **ค่าเดียวกัน**" → เส้นทางตั๋วใช้ `ref_id` = `_id` ของตั๋ว
  และกัน retry ซ้ำด้วย deterministic `_id` ต่อ lot (ไม่ใช่ reservation claim)
- **CR-143 §A FR-A10:** "ก่อนบันทึกต้องแสดงแผนการแบ่งล็อตให้ผู้ใช้เห็น และผู้ใช้ยังเลือกล็อตเองได้"
  → picker แสดงจำนวนต่อ lot ก่อนยืนยันเสมอ
- **CR-143 §A FR-A11:** "ถ้ายอดรวมทุกล็อตที่ใช้ได้ไม่พอ ต้องห้ามบันทึกและแสดงยอดที่มี"
  → เส้นทางตั๋วเข้มกว่า: ผลรวมต้อง**เท่ากับ** `allocated_qty` (ขาดหรือเกินก็ห้ามบันทึก)
- **CR-143 §A FR-A9** (ไม่ rollback แถวที่สำเร็จ): ยังคงเดิม — ดู Q2

## Affected files

- `frontend/src/lib/features/distribution/domain/food-supplies/dispatch-lots.ts` (+ test) — ใหม่
- `frontend/src/lib/features/distribution/application/food-supplies/dispatch-workflow.ts` (+ test)
- `frontend/src/lib/features/distribution/ui/back-office/PhysicalLotPicker.svelte`
- `frontend/src/lib/features/distribution/ui/back-office/DispatchTicketDialog.svelte`
- `frontend/src/lib/features/distribution/ui/model/physical-lot.ts` (+ test)
- ไม่แตะ `operations` (ใช้ `rankLotsForIssue`, `planLotSplit`, `projectStockLotBalances`,
  `isLotExpired` ผ่าน barrel ที่ export อยู่แล้ว) และไม่แตะ `validate_doc_update`
  (`shelter-access-design.ts` ไม่ได้บังคับจำนวนแถวต่อ item อยู่แล้ว)

## Data / schema impact

- **ไม่มี persisted doc shape ใหม่ และไม่ bump `schema_v`** (`stock_ledger` คงเดิม)
- แถว `distribute` ใช้ฟิลด์เดิมทั้งหมด (`item_id`, `qty`, `unit`, `reason`, `ref_id`, `lot_ref`,
  `occurred_at`); สิ่งที่เปลี่ยนคือ**จำนวนแถวต่อรายการ** (อาจ > 1) และ `_id` ของแถวที่ 2 เป็นต้นไป
- `requisition_ticket` ไม่เปลี่ยน (ไม่เก็บ lot ที่เลือกบนตั๋ว)
- ไม่ต้อง migrate; แถวเก่า (1 แถว/รายการ, บางแถวมี `lot_ref` = id ตัวเอง) อ่านได้ตามเดิม
  — `resolveDispatchedLotExpiry` ยังรองรับแถว self-reference เดิม

## Rollout / rollback

- **Rollout:** frontend-only; ไม่มี migration, ไม่ต้อง deploy worker/backend
  - ตั๋วที่ค้าง `READY_FOR_DISPATCH` อยู่แล้ว ใช้ picker ใหม่ได้ทันที
  - ตั๋วที่ dispatch ไปแล้วไม่ถูกแตะ
- **Rollback:** revert commit ได้ แต่แถว `distribute` หลาย lot ที่เขียนไปแล้วยังอยู่ใน ledger (append-only)
  - ยอดคลังยังถูกต้อง — แต่ละแถวมี `lot_ref` จริง
  - code เก่าที่อ่านแถวด้วย deterministic id เดิมจะเห็นเฉพาะแถวแรก — กระทบแค่ `resolveDispatchedLotExpiry`
    ซึ่งได้วันหมดอายุเร็วสุดอยู่แล้ว

## Open questions (สำหรับ owner)

- **Q1 — ผลรวมต้องเท่ากับพอดี?** issue กำหนด "ผลรวม = `allocated_qty`" จึงห้ามทั้งขาดและเกิน
  ถ้าของในคลังมีไม่พอ ต้องกลับไปแก้ `allocated_qty` ก่อน (ยังไม่มีการปล่อยของบางส่วน) — ยืนยันหรือไม่
- **Q2 — เขียนสำเร็จบางแถว:** workflow ตรวจทุกรายการก่อนเขียน แต่ถ้าเครือข่ายล่มระหว่างเขียน แถวที่สำเร็จ
  ไม่ถูก rollback (FR-A9) และตั๋วยังอยู่ `READY_FOR_DISPATCH` จนกว่าจะกดซ้ำ
  - กดซ้ำด้วย lot ชุดเดิม → เขียนต่อจนครบ (deterministic id)
  - **ถ้าเปลี่ยน lot ระหว่างกดซ้ำ** แถวเก่าจะค้างและยอดอาจถูกตัดเกิน — ต้องการให้ UI ล็อก lot ที่เขียนแล้ว
    หรือรายงานแบบ FR-A9 หรือไม่
- **Q3 — นาฬิกาความปลอดภัยอาหาร (FR-MQW-06 B):** รายการที่ปล่อยจากหลาย lot ใช้วันหมดอายุ**เร็วสุด**
  ของ lot ที่ปล่อย (แถวแรกเรียงตาม expiry) — ยืนยันว่าเป็นกติกาที่ต้องการ
- **Q4 — คัดลอก `lot` ของ lot ต้นทางลงแถว `distribute` (#569)?**
  - ถ้าคัดลอก storage/expiry ลงแถว `distribute` ฟอร์มปรับยอด/ตรวจนับที่จัดกลุ่มด้วยฟิลด์ `lot` จะหัก
    ถูกกลุ่มสำหรับแถวใหม่ ช่วยบรรเทาอาการ #569 ได้บางส่วน
  - แต่แถวเก่ายังผิด และ #569 Requirement 1 ให้แก้ที่ต้นเหตุ (ใช้ `projectStockLotBalances`) ซึ่งทำให้
    การคัดลอกไม่จำเป็น
  - การคัดลอกยังเปลี่ยนความหมายของ `lot` บนแถวขาออก ซึ่ง CR-143 §E ใช้ `lot.note` เป็นปลายทางของ
    `distribute` จากหน้าคลัง → **CR นี้ไม่คัดลอก** ให้ตัดสินใน #569 / CR ของมัน
- **Q5 — ยอดคงเหลือที่ใช้ตรวจ:** ใช้ `projectStockLotBalances` (ตัดตาม `lot_ref`) ณ ตอนกดยืนยัน ไม่มี
  reservation ต่อ lot แบบเบิกตรง — ถ้ามีคนเบิก lot เดียวกันพร้อมกัน อาจติดลบได้ ต้องการ reservation claim
  เหมือน FR-A8 หรือไม่

## Decision log

- 2026-10-20 — proposed (draft คู่กับ #655; รอ PM/lead กำหนดเลข CR และวิธี track)
- 2026-10-20 — approved by kong (รันเลข CR-175 ย้ายเข้าหมวด 03-C-supply)
