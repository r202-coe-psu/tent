---
id: CR-250
title: meal_service — actual_yield/served/waste เป็น int (จำนวนจาน) ตามโค้ด และคำนวณ shortfall กับยอดคงคลังด้วย Decimal
status: approved
date: 2026-11-11
updated: 2026-11-13
requested_by: "PO decision (#794) — จำนวนจานเป็น int ถูกแล้ว ให้แก้ schema.md; issue #937"
decided_by: "Soravit Sukkarn (Team Lead)"
decision_date: 2026-11-12
layer: volatile
affects:
  - docs/data/schema.md §2.7 (meal_service — ชนิด field + Migration note CR-084/CR-121)
  - schema_v 2 → 2 (ไม่ bump)
  - frontend/src/lib/features/kitchen/domain (helper shortfall ใหม่ + test)
  - frontend/src/lib/features/kitchen/ui/meal-plan-list.svelte
  - frontend/src/lib/features/kitchen/ui/meal-plan-form.svelte
  - frontend/src/lib/features/kitchen/ui/yield-receipt-lines.svelte
why: schema.md บอกว่า meal_service.actual_yield/served/waste เป็น qty_str แต่โค้ดและ doc ที่ persist เป็น int มาตลอด; หน้าแผนครัวคำนวณ shortfall และเทียบยอดผลผลิตด้วย float ทำให้ได้ 1.14e-13 แทน 0
migration: ไม่ bump schema_v — doc ที่ persist เป็น JSON integer อยู่แล้ว ไม่มี backfill
---

# CR-250 — meal_service — actual_yield/served/waste เป็น int และคำนวณ shortfall ด้วย Decimal

อ้างอิง: [CR-038](01-core/CR-038-decimal-qty-strings.md) (qty_str),
[CR-084](03-C-supply/CR-084-catalog-schema-reconciliation.md) (`actual_yield`),
[CR-121](03-C-supply/CR-121-spec-ticket.md) (`yield_items`), issue #937, parent #794

> **สรุป (TL;DR)**
>
> - **Spec:** `meal_service.actual_yield` / `served` / `waste` เปลี่ยนจาก `qty_str≥0` เป็น `int≥0` (จำนวนจาน) ให้ตรงโค้ด; `yield_items[].actual_yield` คง `qty_str`
> - **Code:** shortfall ในหน้าแผนครัว และการเทียบยอดรวมบรรทัดผลผลิต ต้องคำนวณด้วย Decimal แปลงเป็น number ตอนแสดงผลเท่านั้น
> - **กระทบ:** schema.md §2.7, ฟีเจอร์ `kitchen` (domain helper ใหม่ + 3 ไฟล์ `.svelte`) · ไม่ bump `schema_v` · ไม่มี migration

## Why

- schema.md §2.7 เขียน `actual_yield` เป็น `qty_str≥0 | legacy number` และ `served` / `waste` เป็น
  `qty_str≥0` พร้อมหมายเหตุ "legacy number ถูกแปลงตอนอ่าน" แต่ Zod schema
  (`features/kitchen/domain/kitchen.ts` ~364-366) เป็น `z.number().int().min(0)` และ**ไม่มี reader coercion**
  ใด ๆ — spec อธิบายพฤติกรรมที่ไม่มีอยู่จริง
- ค่าทั้งสามเป็น "จำนวนจาน" (portion) ซึ่งเป็นจำนวนนับ ไม่ใช่ปริมาณที่มีเศษ PO ตัดสิน (#794) ว่า int ถูกต้อง
  ให้แก้ spec ตามโค้ด แทนการย้ายโค้ดไป `qty_str`
- ยอดคงคลัง (`stockBalance`) เป็น `qty_str` แต่หน้าแผนครัวแปลงด้วย `Number()` แล้วลบ/คูณเป็น float
  → stock `"1.001"` kg เทียบแผน 1001 g (ratio 1000) ได้ shortfall `1.14e-13` แทน `0`; ยอดรวมบรรทัดผลผลิต
  `"0.1" + "0.2"` เทียบกับ expected `"0.3"` แล้วขึ้นว่าไม่ตรง

## Change

### Before → after (spec)

| Field (`meal_service`, §2.7) | Before                                                                                      | After                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `actual_yield`               | `qty_str≥0 \| legacy number` · "อ่านเลขเดิมโดยแปลงเป็น `qty_str`"                              | `int≥0` (จำนวนจาน) · ไม่มีค่า = ยังไม่บันทึกผลผลิต (ไม่ใช่ 0)     |
| `served`                     | `qty_str≥0` · "legacy number ถูกแปลงตอนอ่าน"                                                  | `int≥0` (จำนวนจาน)                                      |
| `waste`                      | `qty_str≥0` · "legacy number ถูกแปลงตอนอ่าน"                                                  | `int≥0` (จำนวนจาน)                                      |
| `yield_items[].actual_yield` | `qty_str>0`                                                                                 | **คงเดิม** `qty_str>0`                                   |
| Migration note CR-084/CR-121 | "`actual_yield`/`served`/`waste` ที่เป็น JSON number ให้ reader coercion เป็น string ตาม CR-038" | ตัดประโยคนี้ — ทั้งสาม field เป็น JSON integer ไม่ต้อง coercion |

### Requirements

- **FR-1** — schema.md §2.7 ต้องระบุ `actual_yield`, `served`, `waste` เป็น `int≥0` และตัดข้อความเรื่อง legacy number / reader coercion ของสาม field นี้ทั้งในตารางและใน Migration note CR-084/CR-121
- **FR-2** — schema.md §2.7 ต้องคง `yield_items[].actual_yield` เป็น `qty_str>0` และระบุว่า `actual_yield` ระดับบน (int) คือผลรวมของ `yield_items[].actual_yield`
- **FR-3** — การคำนวณ shortfall (`planned_qty − onHand × recipe_per_stock_unit`, ไม่ต่ำกว่า 0) ต้องอยู่ใน helper เดียวใน `features/kitchen/domain/` ที่คำนวณด้วย `parseQty` / Decimal และคืน number ตอนท้ายเท่านั้น
- **FR-4** — `meal-plan-list.svelte` และ `meal-plan-form.svelte` ต้องเรียก helper ของ FR-3 แทนการคำนวณด้วย `Number()` ในไฟล์
- **FR-5** — `yield-receipt-lines.svelte` ต้องเทียบยอดรวมกับ expected ด้วย Decimal (`qtyIsZero(subQty(total, expected))`) แทน `Number(total) !== Number(expected)`
- **FR-6** — ไม่เปลี่ยน Zod schema ของ `meal_service` และไม่เปลี่ยนรูปของ doc ที่เขียนลง CouchDB

หมายเหตุ FR-3: `meal-plan-form.svelte` เดิมไม่ clamp ที่ 0 แต่แสดงคำเตือนเฉพาะเมื่อ `shortfall > 0`
จึงไม่เคยแสดงค่าติดลบ — การ clamp ใน helper ไม่เปลี่ยนสิ่งที่ผู้ใช้เห็น

### คงเดิม / นอกขอบเขต

- `qty_per_person` × headcount ใน `meal-calc.ts` — อยู่ใน sub issue ของ catalog (#794)
- `meal-calc.ts` scaling (Decimal แล้ว `.toNumber()` ที่ขอบ int กรัม — ตั้งใจ), `meal-variance.ts` (int),
  `kitchen-yield-receipt.ts` (`addQty`) — ถูกต้องอยู่แล้ว ไม่แก้

## Acceptance

- **AC-1** — stock `"1.001"` kg เทียบแผน 1001 g (ratio 1000) → shortfall = `0` (ไม่ใช่ `1.14e-13`); stock `"0.3"` kg เทียบแผน 300 g → shortfall = `0`
- **AC-2** — ยอดรวมบรรทัดผลผลิต `"0.1" + "0.2"` เทียบ expected `"0.3"` → ไม่ขึ้นว่าไม่ตรง
- **AC-3** — มี unit test ของ helper shortfall ครอบ AC-1, กรณีของพอ (= 0) และกรณีขาดจริง
- **AC-4** — ทุก `.svelte` ที่แก้ผ่าน `svelte-autofixer`; `pnpm check` ผ่าน
- **AC-5** — schema.md §2.7 ไม่มีคำว่า `qty_str` / legacy number กำกับ `actual_yield` / `served` / `waste` ระดับบน และ `updated:` เป็นวันที่แก้

## Impact

- Spec: `docs/data/schema.md` §2.7 (ตาราง field + Migration note CR-084/CR-121) + frontmatter `updated:`
- Code: `features/kitchen/domain/meal-calc.ts` (`shortfallQty` ใหม่), `ui/meal-plan-list.svelte` (~228-234),
  `ui/meal-plan-form.svelte` (~615), `ui/yield-receipt-lines.svelte` (~77)
- Test: `features/kitchen/domain/meal-calc.test.ts` (`describe('shortfallQty')`) — เคส stock `"1.001"` kg vs 1001 g ที่ float เดิมได้ `1.14e-13`
- ไม่กระทบ: worker / backend / Mongo projection (ไม่มี projector อ่าน `meal_service`), OpenAPI,
  `distribution` (ไม่อ่าน `actual_yield` / `served` / `waste`)

## Migration

N/A — ไม่ bump `schema_v` (คง 2). doc `meal_service` ที่ persist แล้วเก็บสาม field เป็น JSON integer
ตาม Zod schema มาตลอด การเปลี่ยนนี้แก้ spec ให้ตรงข้อมูลจริง ไม่เปลี่ยนรูป doc จึงไม่มี backfill

## Amendment — 2026-11-13 (review PR #1351)

แก้ข้อเท็จจริงเรื่องหน้ารับผลผลิต ข้อความเดิมด้านบนคงไว้เป็นประวัติ — **section นี้มีผลเหนือข้อความเดิม** ในข้อที่ระบุ

### Amends — ข้อความเดิมที่ถูกแก้

- **Why:** "ยอดรวมบรรทัดผลผลิต `"0.1" + "0.2"` เทียบกับ expected `"0.3"` แล้วขึ้นว่าไม่ตรง"
  → ไม่เคยเกิด `yieldTotal()` บวกด้วย Decimal (`addQty`) อยู่แล้วก่อน CR นี้ จึงได้สตริง `"0.3"` และ
  `Number("0.3") === 0.3` ส่วนค่า `qty_str` มีทศนิยมไม่เกิน 4 ตำแหน่ง (`QTY_DECIMALS`) สองค่าที่ต่างกันจึงแปลงเป็น
  number ได้ค่าต่างกันในช่วงค่าที่ใช้จริง ทำให้การเทียบด้วย `Number()` แบบเดิมถูกต้องอยู่แล้ว บั๊ก float ของ CR นี้มีเฉพาะ shortfall ในหน้าแผนครัว
- **FR-5:** ยังทำตามเดิม แต่เป็นการทำให้ทุกจุดคำนวณด้วย Decimal เหมือนกัน ไม่ใช่การแก้บั๊ก เงื่อนไขย้ายไปอยู่ใน
  `yieldTotalMismatch(total, expected)` ใน `features/kitchen/domain/kitchen-yield-receipt.ts` และ
  `yield-receipt-lines.svelte` เรียกฟังก์ชันนี้
- **AC-2:** "ยอดรวมบรรทัดผลผลิต `"0.1" + "0.2"` เทียบ expected `"0.3"` → ไม่ขึ้นว่าไม่ตรง"
  → `yieldTotalMismatch` มี unit test ใน `kitchen-yield-receipt.test.ts` ครอบสามกรณี: ยอดรวม `"0.1" + "0.2"`
  เทียบ expected `"0.3"` → ไม่ mismatch, เทียบ `"0.4"` → mismatch, และไม่มี expected (`undefined` / `''`)
  → ไม่ mismatch AC นี้ยืนยันพฤติกรรมเท่านั้น ไม่ได้ยืนยันว่าแก้บั๊ก เพราะการเทียบด้วย `Number()` แบบเดิมก็ผ่าน test เดียวกัน

## Decision log

- PO (#794, ไม่ระบุวันใน issue): จำนวนจานเป็น int ถูกแล้ว ให้แก้ schema.md ตามโค้ด
- 2026-11-11 — proposed (draft, issue #937) · implement พร้อม draft ใน PR เดียว
- 2026-11-12 — Approved โดย Soravit Sukkarn (Team Lead) กำหนดหมายเลข CR-250 (ต่อจาก CR-249)
