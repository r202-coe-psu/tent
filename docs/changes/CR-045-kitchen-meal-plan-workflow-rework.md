---
id: CR-045
title: Kitchen meal-plan rework — BOM/Custom modes, linear workflow, duplicate plans, meal_service↔plan link
status: proposed (implementation complete on branch team-c-05-D — pending owner sign-off)
date: 2026-07-22
requested_by: kitchen module owner (decisions made across several working sessions on branch team-c-05-D)
decided_by: project owner (session decisions, retroactively consolidated into this CR on 2026-07-22)
layer: stable
affects:
  - docs/data/schema.md §2.5 (meal_plan — _id ulid, + label, + recipes[].unit)
  - docs/data/schema.md §2.7 (meal_service — _id ulid, + meal_plan_id; schema_v 1 → 2)
  - schema_v meal_service 1 → 2
  - frontend/src/lib/features/kitchen/domain/kitchen.ts
  - frontend/src/lib/features/kitchen/domain/meal-calc.ts
  - frontend/src/lib/features/kitchen/data/kitchen.remote.ts
  - frontend/src/lib/features/kitchen/application/queries.ts
  - frontend/src/lib/features/kitchen/ui/meal-plan-form.svelte
  - frontend/src/lib/features/kitchen/ui/meal-plan-list.svelte
  - frontend/src/lib/features/kitchen/ui/meal-service-form.svelte
  - frontend/src/lib/features/kitchen/ui/meal-service-summary.svelte
  - frontend/src/lib/features/kitchen/ui/requisition-history.svelte
---

# CR-045 — Kitchen meal-plan rework — BOM/Custom modes, linear workflow, duplicate plans, meal_service↔plan link

## Why

ระหว่างทำ UI ของหน้า kitchen (T-25/T-26 ต่อยอด) พบช่องว่างของ spec เดิมหลายจุดที่ block งานจริง:

1. **BOM (catalog Recipe) เชื่อมสต็อกจริงไม่ได้** — ระบบสินค้ามี 2 ชุดที่ไม่เชื่อมกัน: `supply_item`
   (`item:*`, มี `stock_ledger` จริง) กับ catalog `item_master` (`item_master:*`, ไม่มี stock ผูก) —
   แผนที่สร้างจากสูตร BOM จึงเบิกสต็อกจริงไม่ได้เลย
2. **เบิกซ้ำได้ไม่จำกัด** — ของเดิมอนุญาตกด "เบิกวัตถุดิบ" ซ้ำได้เรื่อยๆ ต่อแผนเดียว เสี่ยงตัดสต็อก
   ซ้ำโดยไม่ตั้งใจ
3. **สร้างแผนซ้ำวัน+มื้อเดียวกันไม่ได้** — บล็อกการสร้างแผนแยกก้อนสำหรับเสบียงเสริม/เพิ่มเติมของมื้อ
   เดียวกัน (เช่น มีของมาบริจาคเพิ่มระหว่างวัน)
4. **`meal_service` ไม่ผูกกับแผนใดแผนหนึ่งเจาะจง** — พบตอนตรวจก่อน PR ของ branch นี้: เมื่ออนุญาตให้
   มีหลายแผนต่อวัน+มื้อ (ข้อ 3) แล้ว การบันทึกบริการของแผนหนึ่งกลับทำให้ **ทุกแผนที่ใช้วัน+มื้อเดียวกัน
   ถูกนับว่า "สำเร็จ" ไปด้วย** (ปุ่มหายหมด) ทั้งที่มีแค่แผนเดียวที่บันทึกจริง — เป็นบั๊กที่กระทบ
   workflow ตรงๆ ไม่ใช่แค่ backlog ที่ยอมรับได้

## Change

- **`meal_plan._id`**: deterministic `meal_plan:{date}:{meal}` → **ulid** `meal_plan:{ulid}` —
  อนุญาตให้มีหลายแผนต่อวัน+มื้อเดียวกัน (§2.5)
- **`meal_plan` เพิ่ม field (optional, ไม่ bump schema_v)**: `label` (ชื่อเมนูที่ตั้งเอง),
  `recipes[].unit` (หน่วยต่อรายการ สำหรับโหมด BOM/Custom)
- **`meal_service._id`**: deterministic `meal_service:{date}:{meal}` → **ulid**
  `meal_service:{ulid}`; เพิ่ม **`meal_plan_id: string|null`** ผูกบันทึกบริการเข้ากับแผนที่เจาะจง
  (schema_v **1 → 2**, §2.7)
- **Business rule — workflow เป็นเส้นตรง ทีละสถานะ**: รอยืนยัน → รอเบิก → รอบันทึก → สำเร็จ
  แต่ละสถานะมีปุ่มเดียว เบิก/บันทึกได้แผนละครั้งเดียว (ไม่มี "เบิกซ้ำ"/"บันทึกซ้ำ" อีกต่อไป — ถ้าต้อง
  เบิก/บันทึกเพิ่ม ต้องสร้างแผนใหม่แยกก้อน)
- **Business rule — กันยืนยันแผนที่เบิกไม่ได้จริง**: แผนจาก BOM ที่มีวัตถุดิบยังไม่เชื่อมสต็อกจริง
  (ชื่อในสูตรไม่ตรงชื่อในคลัง) จะกด "ยืนยันแผน" ไม่ผ่าน — ขึ้นข้อความเตือนแทนที่จะปล่อยให้ไปเจอปัญหา
  ตอนกดเบิก
- **New calc rule — BOM auto-resolve stock by name**: `resolveItemMasterStock()`
  (`meal-calc.ts`) จับคู่ `item_master` ↔ `supply_item` ด้วยชื่อ (trim + case-insensitive) ล้วนๆ
  ไม่มี field เชื่อมมือ (ทางเลือกที่เลือกแทนการเพิ่ม field เชื่อมโยงใน catalog เพราะ catalog อยู่นอก
  scope ของทีมนี้) — วัตถุดิบที่จับคู่ไม่ได้ยังคงใช้ `item_master_id` เป็น `recipe_id` (บล็อกการเบิก
  จนกว่าชื่อจะตรงกัน)
- **New "Custom" plan mode**: เลือกวัตถุดิบเองจาก `supply_item` จริงโดยตรง (ไม่ผ่าน catalog Recipe
  เลย) — เบิกได้ทันทีเพราะอ้างอิงสต็อกจริงอยู่แล้ว

## Impact

- `docs/data/schema.md` §2.5/§2.7 อัปเดตแล้ว (field ใหม่ + `_id` pattern + migration note)
- Test ที่ผูกกับ deterministic `_id` เดิมต้องแก้ตาม (`kitchen.test.ts`, `kitchen.remote.test.ts`,
  `meal-calc.test.ts`) — เปลี่ยนไปเช็ค ulid pattern แทน exact string, เพิ่มเทสต์
  `resolveItemMasterStock`/`calculateMealIngredientsFromRecipe`
- `getMealPlan(date, meal)` และ `getMealService(date, meal)` (ทั้งคู่ใน `kitchen.remote.ts`)
  เปลี่ยนจาก `repo.get` ตรงด้วย deterministic id เป็น scan + filter จาก `listMealPlans()`/
  `listMealServices()` — **ambiguous** ถ้ามีหลายแผน/บันทึกต่อมื้อ (คืนแค่ตัวแรกที่เจอ; มี comment
  เตือนไว้ในโค้ด, ปัจจุบันไม่มีจุดไหนในแอปเรียกใช้ 2 ฟังก์ชันนี้จริงนอกจาก test)
- ไม่กระทบ `kitchen_requisition` (§2.6) — ผูกกับ `meal_plan_id` มาตั้งแต่เดิมอยู่แล้ว เป็น pattern
  ต้นแบบที่ `meal_service` เอามาใช้ตาม CR นี้

## Migration

- **`meal_plan` `_id` (ไม่ bump schema_v)**: แผนเก่าที่มี `_id` แบบ deterministic ยังอ่าน/ใช้งานได้
  ปกติ ไม่ต้อง backfill — ไม่มีโค้ดจุดไหน parse รูปแบบ `_id` โดยตรง (อ้างอิงผ่าน field `date`/`meal`
  เสมอ)
- **`meal_service` schema_v 1 → 2**: `meal_plan_id` เป็น optional/default `null` — เอกสารเก่าที่สร้าง
  ก่อน CR นี้จะไม่มี field นี้ และจะไม่ถูกนับว่า "บันทึกแล้ว" สำหรับแผนใดอีกต่อไป (UI จับคู่ด้วย
  `meal_plan_id` ไม่ใช่ date+meal) — โปรเจกต์นี้อยู่ช่วง dev/test เท่านั้น (pre-prod, ยังไม่มีข้อมูล
  จริงในระบบ) แนะนำ unseed/reseed ข้อมูลทดสอบแทนการเขียน migration script ย้อนหลัง

## Decision log

- 2026-07-xx — พบว่า BOM กับ supply เป็นคนละระบบสต็อกกันระหว่างต่อ catalog Recipe เข้า meal plan —
  ตัดสินใจพัก BOM→เบิกไว้ก่อน ใช้โหมด Custom (ผูกสต็อกจริงอยู่แล้ว) แทนชั่วคราว
- 2026-07-xx — ตัดสินใจ redesign workflow เป็นเส้นตรง ทีละสถานะ (เบิกซ้ำไม่ได้) แทน AlertDialog
  ยืนยันเบิกซ้ำแบบเดิม
- 2026-07-xx — ตัดสินใจอนุญาตสร้างแผนซ้ำวัน+มื้อเดียวกันได้ (แยกก้อนแทน reissue) → เปลี่ยน
  `meal_plan._id` เป็น ulid
- 2026-07-xx — ทดลองเพิ่ม field เชื่อมมือ `ItemMaster.linked_supply_item_id` ในหน้า catalog ก่อน —
  **กลับคำ**: ถอนการแก้ไข catalog ทั้งหมดออก (นอก scope ทีมนี้) ใช้ name-match resolver
  (`resolveItemMasterStock`) แทน ซึ่งอยู่ใน domain ของ kitchen เองทั้งหมด
- 2026-07-22 — พบบั๊ก `meal_service` ไม่ผูกกับแผนเจาะจงระหว่างตรวจ branch ก่อน PR (21→22 commits) —
  แก้โดยเพิ่ม `meal_plan_id` + เปลี่ยน `_id` เป็น ulid ตาม pattern เดียวกับ `kitchen_requisition`
- 2026-07-22 — consolidate การตัดสินใจทั้งหมดข้างต้นเป็น CR-045 ไฟล์เดียว (retroactive) ก่อน PR
  branch `team-c-05-D` — สถานะ "proposed (implementation complete)" รอ project owner sign-off
