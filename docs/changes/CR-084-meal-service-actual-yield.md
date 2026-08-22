---
id: CR-084
title: meal_service — เพิ่ม actual_yield (จำนวนเสิร์ฟที่ทำได้จริง, optional) เป็นเพดานการแจกอาหาร
status: proposed
date: 2026-08-22
requested_by: CR-058 / CR-059 ช่วง C (project owner)
decided_by: project owner (อนุมัติให้เปิด CR 2026-08-22)
layer: volatile
affects:
  - docs/data/schema.md §2.7 (field ใหม่ optional — ไม่ bump schema_v, คงที่ 2)
  - docs/task-breakdown/05-D-kitchen.md §T-27 (เพิ่ม 1 ข้อใน DoD)
  - frontend/src/lib/features/kitchen/domain/kitchen.ts
  - frontend/src/lib/features/kitchen/domain/meal-variance.ts
  - frontend/src/lib/features/kitchen/ui/meal-service-form.svelte
  - frontend/src/lib/features/kitchen/ui/meal-service-summary.svelte
---

# CR-084 — meal_service: เพิ่ม `actual_yield`

> **สรุป (TL;DR):** field ใหม่ `actual_yield` (int≥0, optional) บน `meal_service` · คนละความหมายกับ
> `served` · `schema_v` คงที่ **2** · เพดานยังไม่บังคับตอนเขียน (soft warning เท่านั้น) ·
> `MealVariance` เพิ่ม `actual_yield` + `yield_variance` โดย `variance`/`variance_pct`/`status`/
> `produced` เดิม**ไม่เปลี่ยนความหมาย**

---

## Why

CR-058/059 ช่วง C ต้องให้ครัวรายงาน "ผลผลิตที่ทำได้จริง (Actual Yield)" เป็นเพดานการแจกอาหาร
ปัจจุบัน `meal_service` มีแต่ `served` (จำนวนที่แจกออกไปจริง) ซึ่งตอบไม่ได้ว่าครัวปรุงได้เท่าไร —
ถ้าปรุงได้ 90 ที่แต่แจกได้ 85 ที่ กับปรุงได้ 85 ที่แล้วแจกหมด 85 ที่ มีความหมายทางปฏิบัติการต่างกัน
สิ้นเชิง (เคสแรกมีของเหลือ/พลาดแจก เคสหลังผลิตพอดี) แต่บันทึกออกมาเหมือนกันในปัจจุบัน `produced`
ใน `MealVariance` (= `served + waste`) เป็นเพียงค่าประมาณจากผลลัพธ์ ไม่ใช่ค่าที่ครัวกรอกจริงตอนออก
จากเตา

**ขอบเขตของ PR ที่แนบ CR นี้มาด้วย:** รอบนี้ทำ 4 งานจาก CR-058/059 ที่ตรงกับ T-17/T-25/T-26/T-27
— `actual_yield` เป็นงานเดียวที่ต้องเปิด CR เพราะแตะรูปร่าง doc ที่ persist แล้ว อีก 3 งาน
(Unified Headcount ใช้ `active` แทน `checked_in`, สูตรแก๊ส LPG, variance status badge) **ไม่ต้อง
CR** เพราะ:
1. Headcount เป็น bug fix ให้ตรงกับสเปกที่ approve แล้ว — CR-035 (`status: done`, 2026-07-08) สั่ง
   เปลี่ยน `checked_in` → `active` ไปแล้ว โค้ด kitchen เพียงยังไม่ตาม
2. สูตรแก๊สเป็นการคำนวณตามหน้าที่ที่ `docs/data/schema.md` §2.7.1 นิยาม `gas_cylinder_type` ไว้แล้ว
   ("reference data สำหรับคำนวณเวลา/ปริมาณการใช้แก๊สหุงต้ม") ไม่แก้ field/enum/workflow ใด — ผล
   คำนวณเป็น display-only ไม่ persist
3. Variance badge เป็นการแสดงผลของค่าที่ `computeMealVariance` คำนวณอยู่แล้ว ไม่ใช่ตรรกะใหม่

## Change

1. **Field ใหม่:** `meal_service.actual_yield?: number` — `int().min(0)`, optional
2. **ความหมายต่างจาก `served`:** `actual_yield` = จำนวนที่ครัว**ปรุงได้จริง** (ผลผลิต), `served` =
   จำนวนที่**แจกออกไปจริง** สองค่านี้ต่างกันได้ตามสภาพจริงหน้างาน
3. **ไม่มีค่า ≠ 0:** doc ที่ไม่มี field นี้ (รวมทุก doc ที่เขียนก่อน CR-084) หมายถึง "ยังไม่บันทึก
   ผลผลิต" ไม่ใช่ "ผลผลิตเป็นศูนย์" — ต้องแยกกันตอน render (`—` vs `0`)
4. **`schema_v` คงที่ 2 ไม่ bump เป็น 3** — field เป็น optional additive ไม่ทำให้ doc เดิมผิดรูป
   อ้าง precedent ในไฟล์เดียวกัน 2 จุด: `docs/data/schema.md` §2.5 (CR-045 เพิ่ม `label` +
   `recipes[].unit` optional "ไม่ bump schema_v") และ §4.2 (CR-031 เพิ่ม `category` opt "schema_v 2
   คงเดิม")
5. **ไม่บังคับเพดานด้วย `.refine()`:** `served > actual_yield` เป็นแค่ **soft warning ฝั่ง UI**
   ไม่ block การบันทึก เหตุผล — (ก) เพดานจริงเป็นหน้าที่ของ flow แจกจ่าย/สแกนหน้างานที่ยังไม่มีใน
   ระบบ (ข) `meal_service` เป็น append-only การ refine จะทำให้ record จริงที่เกินเพดานบันทึกไม่ได้
   เลย (ค) field เป็น optional การ refine จะบังคับไม่สม่ำเสมอ (ง) ฟอร์มนี้มี policy "soft warning
   only" อยู่แล้วสำหรับตัวเลขเกินแผนทุกช่องในปัจจุบัน
6. **`MealVariance` เพิ่ม 2 field อ่านอย่างเดียว:** `actual_yield: number | null`,
   `yield_variance: number | null` (= `actual_yield - planned`) — `variance`, `variance_pct`,
   `status`, `produced` ที่มีอยู่เดิม**ไม่เปลี่ยนความหมายหรือการคำนวณแม้แต่จุดเดียว**

## Acceptance

- [ ] `meal_service` doc เขียน `actual_yield` ได้เมื่อระบุ, ไม่มี key นี้เลยเมื่อไม่ระบุ
- [ ] `actual_yield: 0` ถูกบันทึกจริง ไม่หายเป็นค่าไม่มี (ต้องใช้ `!= null` ไม่ใช่ truthy check)
- [ ] `schema_v` ของ `meal_service` ที่เขียนใหม่ยังเป็น `2`
- [ ] `MealVariance.actual_yield`/`yield_variance` คำนวณถูกต้อง และไม่กระทบ `variance`/
      `variance_pct`/`status`/`produced` เดิม (มี test ล็อกพฤติกรรมนี้โดยเฉพาะ)
- [ ] UI ฟอร์มบันทึกบริการมีช่อง Actual Yield ไม่บังคับกรอก + soft warning เมื่อ served เกิน
- [ ] หน้าสรุปบริการแสดง `—` เมื่อไม่มีค่า และแสดง `0` เมื่อบันทึกเป็นศูนย์จริง (ไม่ใช่ค่าเดียวกัน)

## Impact

- **Docs:** `docs/data/schema.md` §2.7 (field + migration note, ไม่ bump schema_v),
  `docs/task-breakdown/05-D-kitchen.md` T-27 DoD (เพิ่ม 1 บูลเล็ต)
- **Code:** `kitchen/domain/kitchen.ts` (interface + schema + factory),
  `kitchen/domain/meal-variance.ts` (2 field ใหม่), `kitchen/ui/meal-service-form.svelte`,
  `kitchen/ui/meal-service-summary.svelte`
- **Tests:** `domain/kitchen.test.ts`, `domain/meal-variance.test.ts`, `data/kitchen.remote.test.ts`
- **ไม่กระทบ:** `KitchenRepository` interface, `application/queries.ts`, append-only guard,
  one-shot-per-`meal_plan_id` guard, worker/Mongo projection, `docs/data/couchdb-mongodb-sync.md`

## Migration

`N/A — ไม่ bump schema_v (คงที่ 2)`. `actual_yield` เป็น field optional เพิ่มใหม่ — doc เดิมที่ไม่มี
field นี้ยังอ่าน/ใช้งานได้ปกติ อ่านเป็น "ยังไม่บันทึกผลผลิต" ไม่ต้อง backfill ไม่มี seed script ที่
เขียน `meal_service` (`pnpm seed` ไม่ seed ครัว) จึงไม่ต้องแก้ seed

## Decision log

- 2026-08-22 — proposed (project owner อนุมัติให้เปิด CR สำหรับ field ใหม่นี้ พร้อมยืนยันการไม่
  bump schema_v และใช้ soft-warning ไม่ใช่ hard refine)
- 2026-08-22 — renumbered จาก CR-079 → CR-084 ตอน merge `develop`: เลข CR-079 ถูก branch อื่นใช้ไป
  แล้วสำหรับคนละเรื่อง (SOP what-if simulation) ก่อนที่ branch นี้จะ merge เข้า — ไม่มีการเปลี่ยน
  เนื้อหา แค่เลขไฟล์/รหัส CR
