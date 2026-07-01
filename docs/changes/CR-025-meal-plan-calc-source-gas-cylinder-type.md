---
id: CR-025
title: meal_plan calc_source audit trail + gas_cylinder_type doc type (T-25 / T-56)
status: approved
date: 2026-07-01
requested_by: ทีม C (T-25 kitchen) — PR #48 review (net-lynx)
decided_by: project owner (session 2026-07-01)
layer: volatile
affects:
  - docs/data/schema.md §2.5 (meal_plan)
  - docs/data/schema.md §2.7.1 (gas_cylinder_type — ใหม่)
  - schema_v meal_plan 1 → 2
  - schema_v gas_cylinder_type 1 (ใหม่)
  - frontend/src/lib/features/kitchen/{domain,data,application,ui}
---

# CR-025 — meal_plan calc_source audit trail + gas_cylinder_type doc type

## Why

T-25 (meal plan จาก occupancy × SOP ratio) คำนวณ ingredient list อัตโนมัติจาก SOP profile ที่ active.
Requirement DoD ของ T-25 คือ "แสดง source/as-of ของตัวเลขที่ใช้คำนวณ" — ต้อง persist audit trail ว่าใช้
SOP profile ตัวไหน version อะไร และอ่าน headcount ณ เวลาใด เพื่อสืบย้อนได้เมื่อ ratio เปลี่ยน.

T-56 (LPG cylinder management, ต่อยอด CR-003) ต้องมี reference data ของประเภทถังแก๊ส/เตา สำหรับคำนวณ
เวลา/ปริมาณการใช้แก๊สต่อมื้อ.

PR #48 implement ทั้งสองไปแล้วในโค้ด (`meal_plan.calc_source`, doc type `gas_cylinder_type`) แต่
`docs/data/schema.md` ยังไม่มี — ต้องปิด gap ตาม change-management policy §2 ก่อน merge.

## Change

**meal_plan (§2.5): schema_v 1 → 2**
- เพิ่ม field `calc_source` (optional): `{sop_profile_id:str, sop_profile_version:int>0, headcount_as_of:ts} | null`
- เพิ่มกฎ invariant: `headcount` sub-count (halal + soft_food + infant) ≤ total
- ชี้แจงหน่วยของ `recipes[].planned_qty` = ปริมาณวัตถุดิบต่อมื้อ หน่วยตาม `recipe_id`
  (เช่น `ingredient:rice` = กรัม) — T-26 map เป็น stock `item_id`

**gas_cylinder_type (§2.7.1): schema_v 1 (ใหม่)** — reference data, shelter DB, mutable (LWW ผ่าน `touch()`)
- `name:str`, `capacity_kg:num>0`, `burn_rate_kg_per_hour:num>0`, `time_multiplier:num>0 (default 1)`

## Impact

- `docs/data/schema.md` — §2.5 (calc_source + migration note + schema_v 2), §2.7.1 (gas_cylinder_type ใหม่)
- code — kitchen feature domain/data/application/ui (มีอยู่แล้วใน PR #48; PR review round เพิ่ม persist
  `calc_source`, gas CRUD impl, live-query wiring)
- test — meal-calc + kitchen.pouch repository tests

## Migration

- **meal_plan 1 → 2:** `calc_source` optional → doc เดิมไม่ต้อง backfill; reader ถือว่าไม่มี
  `calc_source` = แผนที่สร้างก่อนมี audit trail. แผนใหม่ทุกใบเขียนเป็น schema_v 2 พร้อม `calc_source`.
- **gas_cylinder_type:** doc type ใหม่ ไม่มีข้อมูลเดิม → ไม่มี migration

## Decision log

- 2026-07-01 — proposed จาก PR #48 review (blocker: schema/change-management gap)
- 2026-07-01 — approved โดย project owner; tracking method = CR file
- 2026-07-01 — renumbered CR-021 → CR-025 (แก้เลขซ้ำกับ CR-021 SOP ratio scope)
