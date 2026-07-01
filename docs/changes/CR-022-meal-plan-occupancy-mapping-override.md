---
id: CR-022
title: meal_plan occupancy→headcount mapping + override rule + T-26 handoff contract (T-25)
status: approved
date: 2026-07-01
requested_by: ทีม C (T-25 kitchen) — completion of T-25 DoD
decided_by: project owner (session 2026-07-01)
layer: volatile
affects:
  - docs/data/schema.md §2.5 (meal_plan — headcount source + override_reason rule)
  - frontend/src/lib/features/kitchen/{domain,application,ui}
  - refines CR-021 headcount sub-count invariant (sum→per-field)
---

# CR-022 — meal_plan occupancy→headcount mapping + override rule + T-26 handoff

## Why

T-25 DoD กำหนดให้สร้างแผนอาหาร **จาก occupancy จริง (T-06)** × SOP ratio, ปรับ manual ได้พร้อม
บันทึกเหตุผล, และส่งต่อเป็น input ให้ T-26. เดิม PR #48 ใช้ manual headcount ล้วน — CR นี้ปิด gap
โดยนิยาม **business rule** ที่ยังไม่มีใน spec: occupancy map เป็น headcount อย่างไร, เมื่อไรต้องมี
override_reason, และ contract การส่งต่อ T-26.

## Change

**1. Occupancy → headcount mapping (ใหม่)** — derive จาก evacuee ที่ `current_stay.status = 'checked_in'`:
- `total` = จำนวน evacuee ที่ checked_in ทั้งหมด
- `halal` = checked_in ที่ `religion = 'muslim'`
- `infant` = checked_in ที่ `special_needs` มี `'infant'`
- `soft_food` = checked_in ที่ `special_needs` มีอย่างน้อยหนึ่งใน `['bedridden','chronic_illness','elderly']`

**2. Sub-count invariant (refine CR-021)** — เปลี่ยนจาก "ผลรวม ≤ total" เป็น **"แต่ละช่อง ≤ total"**
(`halal ≤ total`, `soft_food ≤ total`, `infant ≤ total`). เหตุผล: sub-count เป็นมิติที่ตั้งฉากกัน
(orthogonal) — คนหนึ่งเป็นได้ทั้ง muslim และ infant → ผลรวมเกิน total ได้ตามปกติ จึงบวกกันไม่ได้

**3. Manual override rule (ใหม่)** — เมื่อ headcount ที่บันทึกต่างจาก occupancy snapshot ล่าสุด
→ `override_reason` (field เดิมใน schema) **บังคับกรอก**. `calc_source.headcount_as_of` เก็บ timestamp
ของยอดที่ใช้คำนวณอยู่แล้ว (audit trail)

**4. T-26 handoff contract (ใหม่)** — `toRequisitionInput(meal_plan)` แปลงแผนเป็น
`kitchen_requisition` input: แต่ละ `recipe` → stock item ผ่าน map `RECIPE_TO_STOCK_ITEM`
(`ingredient:rice` → `item:rice`, unit `g`), `qty_issued` เริ่มที่ 0 (T-26 กำหนดยอดจ่ายจริงตอน issue)

## Impact

- `schema.md §2.5` — เพิ่มหมายเหตุ headcount source (occupancy mapping) + override_reason rule +
  แก้ note sub-count invariant เป็น per-field
- code — kitchen `domain/occupancy.ts` (ใหม่), `domain/meal-calc.ts` (`toRequisitionInput`),
  `domain/kitchen.ts` (refine invariant), `application/queries.ts` (`useOccupancyHeadcount` +
  live-query watch evacuee/movement), `ui/meal-plan-form.svelte` (auto-fill + override),
  `ui/meal-plan-list.svelte` (LIVE COUNT badge + override indicator)
- test — occupancy.test.ts, meal-calc.test.ts (handoff), kitchen.test.ts (per-field invariant)
- ไม่ bump `schema_v` — ไม่มีการเปลี่ยน **รูปร่าง** persisted doc (headcount/override_reason/calc_source
  มีอยู่แล้วจาก CR-021); เปลี่ยนเฉพาะ business rule ที่มาของค่า

## Migration

N/A — ไม่มีการเปลี่ยนรูปร่าง persisted doc. แผนเดิมที่ไม่มี override_reason ถือว่าไม่ override

## Decision log

- 2026-07-01 — proposed จากการ complete T-25 DoD
- 2026-07-01 — approved โดย project owner; mapping = religion+special_needs, handoff = pure input
  adapter (T-26 UI แยก task), P-02 = เก็บ sub-count เป็น metadata (recipe calc ยังคิดข้าวรวม);
  tracking = CR file
