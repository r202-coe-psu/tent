---
id: CR-029
title: Kitchen requisition ledger unit must match item_master.base_unit (T-26)
status: approved
date: 2026-07-03
requested_by: T-26 DoD verification (agent review session) — stock balance found to zero out incorrectly
decided_by: project owner (session 2026-07-03)
layer: volatile
affects:
  - docs/data/schema.md §2.5 (แก้โน้ต "unit g" ให้ตรงกฎ §2.6)
  - docs/data/schema.md §2.6 (ยืนยันกฎเดิม: stock_ledger.unit ต้องตรง item_master.base_unit)
  - frontend/src/lib/features/kitchen/domain/meal-calc.ts (RECIPE_TO_STOCK_ITEM, toRequisitionInput)
  - frontend/src/lib/features/kitchen/data/kitchen.pouch.ts (issueRequisition ledger write)
---

# CR-029 — Kitchen requisition ledger unit must match item_master.base_unit

## Why

พบตอนตรวจ DoD ของ T-26: `stock_ledger` ของ `item:rice` มีทั้ง entry หน่วย `kg` (จาก seed —
`receive`/`distribute`, ตรงกับ `item_master.base_unit: 'kg'`) ปนกับ entry หน่วย `g` (จาก T-26
`requisition` — ตาม `RECIPE_TO_STOCK_ITEM` ที่ hardcode `unit: 'g'`). `stockBalance` (operations
feature) รวม `qty` ดิบต่อ `item_id` โดยไม่แปลงหน่วย → ยอดคงคลังที่คำนวณได้ผิด (ตัวอย่างจริงที่เจอ:
+200kg +200kg -30kg -30kg -150g -150g -40g รวมดิบ = 0 ทั้งที่มีข้าวเหลือจริงหลายร้อย kg)

ต้นตอคือ `docs/data/schema.md` เขียนขัดกันเอง: §2.6 (กฎทั่วไปของ `stock_ledger`) บอกว่า `unit`
ต้องตรง `item_master.base_unit` เสมอ แต่ §2.5 (โน้ตอธิบาย T-26 handoff) เขียนไว้ว่า mapping
`ingredient:rice → item:rice` ใช้ `unit: 'g'` — ไม่ได้เช็คกับ `item_master.base_unit` จริง (`kg`)
ตอนเขียน spec นั้น. โค้ด T-26 ทำตาม §2.5 ตรงๆ จึงกลายเป็นบั๊ก

## Change

- ยึด §2.6 (กฎทั่วไป, base_unit เป็น single source of truth) เป็นตัวตัดสิน — **ไม่แก้**
  `item_master.base_unit` ของ `item:rice` (ยังเป็น `kg` เหมือนเดิม กระทบ recipe/needs ที่ผูก kg
  อยู่แล้วน้อยกว่าการแก้ไปทาง g)
- แก้โค้ด T-26 แทน: คำนวณข้าวเป็นกรัมตาม SOP ratio เหมือนเดิม (ความละเอียดที่จำเป็นสำหรับสูตร)
  แต่ **แปลงเป็น kg ก่อนเขียนเข้า `kitchen_requisition.items[].unit`/`qty_issued` และ
  `stock_ledger`** ให้ตรง `item_master.base_unit`
- แก้ §2.5 ใน `schema.md` ให้ตรงพฤติกรรมใหม่ (unit ที่ใช้จริงคือ `kg` ไม่ใช่ `g`)

## Impact

- `frontend/src/lib/features/kitchen/domain/meal-calc.ts`: `RECIPE_TO_STOCK_ITEM['ingredient:rice'].unit`
  เปลี่ยนจาก `'g'` → `'kg'`; `toRequisitionInput` ต้องหาร 1000 ตอนแปลง `planned_qty` (กรัม) →
  `qty_requested` (kg)
- `assessRequisition`/UI (`requisition-dialog.svelte`) แสดงหน่วยตาม `unit` ที่ส่งมา — ไม่ต้องแก้ไข
  เพิ่ม (component เป็น unit-agnostic อยู่แล้ว)
- ไม่กระทบ `MealPlanRecipe.planned_qty` (ยังเป็นกรัมเหมือนเดิม ตาม §2.5 การคำนวณ SOP) — แปลงหน่วย
  เกิดที่จุดเดียวคือ `toRequisitionInput` (ขอบเขตรอยต่อ T-25→T-26)
- ไม่ bump `schema_v` — ไม่เปลี่ยนรูปร่าง field แค่เปลี่ยนค่า `unit` ที่เก็บ + วิธีคำนวณ `qty`
- ต้องลบ/เพิกเฉย `kitchen_requisition`/`stock_ledger` เก่าที่เขียนด้วย unit `g` ผิด (ทำความสะอาดข้อมูล
  ทดสอบใน `shelter_sh001` ไปแล้วระหว่าง session นี้)

## Migration

N/A ต่อ schema_v — เป็นการแก้ค่าที่คำนวณ/หน่วยที่บันทึก ไม่ใช่โครงสร้าง field เอกสารเก่าที่เขียน
ด้วย unit ผิด (ก่อน commit นี้) ต้องพิจารณาเป็นรายกรณี (ในโปรเจกต์นี้ยังอยู่ระหว่าง dev/testing —
ลบ test data ที่ผิดทิ้งแทนการ migrate)

## Decision log

- 2026-07-03 — proposed จากการตรวจ T-26 DoD (พบ unit mismatch ทำให้ยอดคงคลังผิด)
- 2026-07-03 — approved โดย project owner; เลือกแก้โค้ด T-26 (แปลง g→kg ก่อนเขียน ledger) แทนแก้
  seed/base_unit; tracking = CR file
