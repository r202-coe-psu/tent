---
id: CR-085
title: gas_ledger — ติดตามสต็อกแก๊สจริงต่อถัง (ใช้ไปแล้ว/เหลือ/สถานะ) + เติมแก๊ส + เช็คพอก่อนเบิก
status: proposed
date: 2026-08-22
requested_by: project owner
decided_by: project owner (อนุมัติให้เปิด CR 2026-08-22)
layer: volatile
affects:
  - docs/data/schema.md §2.5 (`meal_plan` เพิ่ม `gas_usage[]` optional — ไม่ bump schema_v)
  - docs/data/schema.md §2.7.2 (doc type ใหม่ `gas_ledger` — schema_v 1)
  - docs/task-breakdown/05-D-kitchen.md T-25/T-26
  - frontend/src/lib/features/kitchen/domain/gas-ledger.ts (ใหม่)
  - frontend/src/lib/features/kitchen/data/kitchen.repository.ts
  - frontend/src/lib/features/kitchen/data/kitchen.remote.ts
  - frontend/src/lib/features/kitchen/application/queries.ts
  - frontend/src/lib/features/kitchen/ui/meal-plan-form.svelte
  - frontend/src/lib/features/kitchen/ui/gas-management.svelte
---

# CR-085 — ติดตามสต็อกแก๊สจริงต่อถัง

> **สรุป (TL;DR):** `gas_cylinder_type` แต่ละ doc แทน **ถังจริง 1 ใบ** (ไม่ใช่ "รุ่น" ที่ใช้ร่วมกันหลาย
> ถัง) เพิ่ม doc ใหม่ append-only `gas_ledger` (เหมือน `stock_ledger` แต่แยกก้อน ไม่ผูกกับ
> `item_master`/`supply_item`) เก็บ signed delta ต่อถัง (`consumption` ลบ, `refill` บวก) · ยอดเหลือ =
> `capacity_kg + Σdelta` (compute ไม่เก็บ running total) · สถานะ (ยังไม่ใช้/กำลังใช้/หมดแล้ว) derive
> จากยอดเหลือ · เบิกจริง (issueRequisition) เขียน `gas_ledger` (reason=`consumption`) คู่กับ
> `stock_ledger` เดิม **throw บล็อกถ้าไม่พอ** (เหมือนอาหาร) · เติมแก๊สทำผ่านปุ่มในตาราง เขียน
> `gas_ledger` (reason=`refill`)

---

## Why

CR-058/059 ให้ครัวคำนวณแก๊สที่ต้องใช้ต่อมื้อ (T-25 ช่วง A) — งานรอบก่อน (ดู
`z-05-D/PR-kitchen-headcount-gas-variance-yield.md`) ทำแค่คำนวณ **display-only** ไม่มีที่เก็บสต็อก
แก๊สจริงเลย เมื่อใช้งานจริงหลายมื้อ/หลายวัน ครัวไม่มีทางรู้ว่าถังไหนใกล้หมด ต้องเปลี่ยนถังก่อนไหม —
ต้อง track สต็อกแก๊สแยกต่อถังจริง เหมือนที่คลังเสบียง track ด้วย `stock_ledger`

## Change

1. **`gas_cylinder_type` = ถังจริง 1 ใบ:** ยืนยัน mental model เดิมของ UI (แต่ละแถวที่สร้างในหน้า
   `/back-office/kitchen/gas` คือถังจริง ไม่ใช่ template ที่ใช้ร่วมกัน) — ไม่แก้ shape เดิม
2. **doc ใหม่ `gas_ledger`** (§2.7.2, schema_v 1, append-only):
   ```
   cylinder_id: str          -> gas_cylinder_type._id
   qty_kg: qty_str (signed, non-zero)   -- ลบ = ใช้ไป, บวก = เติมกลับ
   reason: enum('consumption', 'refill')
   ref_id: str | null        -- meal_plan_id เมื่อ reason='consumption'
   occurred_at: ts
   ```
3. **ยอดเหลือ = compute ไม่เก็บ running total** (ตาม CONVENTIONS.md — ห้ามเก็บ running total):
   `remaining_kg = capacity_kg + Σ(qty_kg ที่ cylinder_id ตรงกัน)`
4. **สถานะ derive จากยอดเหลือ** ไม่ใช่ field ที่เก็บแยก (กัน state ไม่ sync):
   - `unused` (ยังไม่ใช้) — `remaining_kg == capacity_kg`
   - `in_use` (กำลังใช้) — `0 < remaining_kg < capacity_kg`
   - `empty` (หมดแล้ว) — `remaining_kg <= 0`
5. **`meal_plan` เพิ่ม `gas_usage?: {cylinder_id, consumption_kg}[]`** (optional, ไม่ bump schema_v —
   precedent เดียวกับ CR-045/CR-031/CR-084) เก็บว่าแผนนี้เลือกถังไหน ใช้กี่ kg (คำนวณจากแผงแก๊สตอน
   สร้าง/แก้แผน)
6. **`issueRequisition` เขียน `gas_ledger` (reason=`consumption`) พร้อมกับ `stock_ledger` เดิม** ใน
   `bulkDocs` เดียว (atomic เหมือนอาหาร) — อ่าน `plan.gas_usage` ตอนเบิก, เช็คยอดเหลือของแต่ละถังก่อน
   **throw บล็อกทันทีถ้าไม่พอ** (เหมือน guard เดิมของอาหารที่ `kitchen.remote.ts:70-73`) ไม่ใช่ partial
   issue แบบอาหาร (ถังแก๊สแบ่งเบิกบางส่วนไม่มีความหมาย)
7. **เติมแก๊ส:** ปุ่มในตารางหน้า `/back-office/kitchen/gas` เขียน `gas_ledger` (reason=`refill`, qty_kg
   บวก) จำนวนเติมต้องไม่ทำให้ `remaining_kg` เกิน `capacity_kg` (validate ที่ domain)
8. **ฝั่งวางแผน (meal-plan-form):** เพิ่ม warning ต่อแถวถ้า `consumption_kg` ที่คำนวณ > ยอดเหลือของถัง
   ที่เลือก (soft warning ตอนวางแผน draft — ยังสร้าง/เบิกยังไม่ block ที่ตรงนี้ เพราะยอดอาจเปลี่ยนก่อน
   ถึงเวลาเบิกจริง) **ตัวบล็อกจริงอยู่ที่ข้อ 6 (issueRequisition)**
9. **ตัดเศษเหลือทิ้ง (`reason='adjust'`, เพิ่ม 2026-08-22 หลัง proposed):** เพราะเบิกแก๊สเป็น
   all-or-nothing (ข้อ 6) ถังที่เหลือเศษเล็กน้อย (เช่น 0.001 kg) จะไม่มีทางถูกเบิกจนหมดผ่าน flow ปกติ
   เลย ค้างเป็น `in_use` ตลอดไป — เพิ่ม `gasLedgerReasonSchema` enum ตัวที่ 3 `'adjust'` + action
   "ตัดเศษเหลือทิ้ง" (ปุ่มในตารางหน้า gas, ยืนยันผ่าน AlertDialog) เขียน `gas_ledger` หนึ่งรายการ
   `qty_kg = -remaining_kg` ให้ยอดเหลือเป็น 0 ทันที `ref_id: null` เสมอ (ไม่ผูกกับ requisition ใดๆ)
   ถ้าถังว่างอยู่แล้ว (`remaining_kg <= 0`) ให้ throw ปฏิเสธ (ไม่มีอะไรให้ตัด) — ยังเป็น doc type เดิม
   (`gas_ledger`, schema_v 1 คงเดิม) แค่ enum ค่าเพิ่ม ไม่กระทบ shape

## Acceptance

- [ ] `gas_ledger` เขียนที่ `issueRequisition` พร้อม `stock_ledger` ในการเรียกเดียว (atomic)
- [ ] เบิกเกินยอดเหลือ → throw บล็อก ไม่มีอะไรถูกเขียนเลย (all-or-nothing เหมือนอาหาร)
- [ ] ยอดเหลือ/สถานะ derive ถูกต้องจาก ledger ไม่มี field เก็บ running total
- [ ] ปุ่มเติมแก๊สเขียน ledger บวก และ validate ไม่ให้เกิน capacity
- [ ] ตารางหน้า gas แสดงคอลัมน์ สถานะ / ใช้ไปแล้ว / เหลือ ถูกต้องตาม ledger จริง
- [ ] `meal_plan.gas_usage` persist ได้ และ optional (ไม่ bump schema_v ของ `meal_plan`)
- [ ] ปุ่ม "ตัดเศษเหลือทิ้ง" เขียน `gas_ledger` (`reason='adjust'`) ปรับยอดเหลือเป็น 0 พอดี และปฏิเสธ
      (throw) ถ้าถังว่างอยู่แล้ว

## Impact

- **Docs:** schema.md §2.5, §2.7.2 (ใหม่); task-breakdown T-25/T-26
- **Code:** `domain/gas-ledger.ts` (ใหม่), `domain/kitchen.ts` (`meal_plan.gas_usage`),
  `data/kitchen.repository.ts` + `kitchen.remote.ts` (`issueRequisition` ต่อ gas, `listGasLedger`,
  `recordGasRefill`), `application/queries.ts` (`useGasLedger`, `useRefillGasCylinder`, live-query
  map เพิ่ม `gas_ledger`), `ui/meal-plan-form.svelte` (persist gas_usage + shortfall warning),
  `ui/gas-management.svelte` (คอลัมน์สถานะ/ใช้ไปแล้ว/เหลือ + ปุ่มเติมแก๊ส)
- **ไม่กระทบ:** `gas_cylinder_type` shape เดิม, `KitchenRequisitionInput`/`kitchenRequisitionInputSchema`
  (ไม่แก้ — gas อ่านจาก plan ตรงในชั้น data ไม่ผ่าน schema เบิกอาหาร)

## Migration

`N/A` — `gas_ledger` เป็น doc type ใหม่ (ไม่มีของเดิมต้อง migrate) `meal_plan.gas_usage` เป็น optional
additive (ไม่ bump schema_v ของ `meal_plan`) — แผนเก่าที่ไม่มี field นี้อ่านเป็น "ไม่มีการใช้แก๊ส"
local dev DB ต้องรัน `pnpm redeploy:access` เพิ่ม `gas_ledger` เข้า `allowed` list ของ
`_design/access` (เหมือนที่ทำกับ `meal_plan`/`kitchen_requisition`/`meal_service`/`gas_cylinder_type`
รอบก่อน — ดู `frontend/src/lib/server/shelter-access-design.ts`)

## Decision log

- 2026-08-22 — proposed (project owner อนุมัติ track สต็อกแก๊สต่อถังจริง, เติมแก๊ส, บล็อกเบิกถ้าไม่พอ)
- 2026-08-22 — project owner สังเกตเอง (ผ่านการทดสอบจริง) ว่าเศษเหลือเล็กน้อยไม่มีทางถึงสถานะ "หมด"
  ผ่าน flow ปกติ เพราะเบิกแก๊สเป็น all-or-nothing — เลือกทางแก้แบบ "ปุ่มตัดเศษเหลือทิ้งเดียว" (ไม่ใช่
  ช่องปรับยอดทั่วไป +/-) → เพิ่ม `reason='adjust'` ตามข้อ 9
- 2026-08-22 — renumbered จาก CR-080 → CR-085 ตอน merge `develop`: เลข CR-080 ถูก branch อื่นใช้ไป
  แล้วสำหรับคนละเรื่อง (donor edit reservation via token) ก่อนที่ branch นี้จะ merge เข้า — ไม่มีการ
  เปลี่ยนเนื้อหา แค่เลขไฟล์/รหัส CR
