---
id: draft                  # draft (ตอน proposed) -> เปลี่ยนเป็น CR-NNN เมื่อเจ้าของโครงการ approve
title: เพิ่ม meal_distribution log สำหรับแจกจ่ายอาหารหน้างาน + บังคับเพดาน Remaining Distribution Limit
status: proposed
date: 2026-09-02
requested_by: ทีมพัฒนา (พบช่องว่างระหว่างสร้าง mock UI `frontend/src/lib/features/meal-distribution/`)
decided_by: <รอ Project Owner>
layer: volatile
affects:
  - docs/data/schema.md §2 (DB shelter_{shelter_code} — Operations) — doc type ใหม่ `meal_distribution`
  - docs/data/schema.md §2.7 `meal_service` — เปลี่ยนความหมาย/แหล่งที่มาของ `served` (ถ้าเลือก Option B ด้านล่าง)
  - frontend/src/lib/features/meal-distribution/
  - frontend/src/lib/features/kitchen/ (อ่าน meal_plan/meal_service)
---

# เพิ่ม meal_distribution log สำหรับแจกจ่ายอาหารหน้างาน + บังคับเพดาน Remaining Distribution Limit

> **สรุป (TL;DR):** เพิ่ม doc type ใหม่ `meal_distribution` (`meal_distribution:{ulid}`) สำหรับบันทึก log การสแกนแจกอาหารรายบุคคลหน้างาน · บังคับเพดานยอดแจกจริงไม่เกินยอดผลิต (`sum(portions) ≤ actual_yield`) · กระทบ DB `shelter_{shelter_code}` §2 และ `frontend/src/lib/features/meal-distribution/`

## Why

`docs/data/schema.md` §2.7 (`meal_service`) พูดตรงๆ ไว้แล้วว่า:

> **`actual_yield` vs `served` (CR-084):** ... เพดาน `served ≤ actual_yield` **ยังไม่บังคับตอนเขียนรอบนี้**
> (แค่ soft warning ฝั่ง UI) — การบังคับเพดานจริง**เป็นงานของ flow แจกจ่าย/สแกนหน้างานที่ยังไม่มีในระบบ**

ตอนนี้ทีมกำลังสร้าง UI mock-first ของ `meal-distribution` (สแกน/บันทึกการแจกอาหารต่อคนหน้างาน,
ดู `frontend/src/lib/features/meal-distribution/domain/meal-distribution.ts` —
`MealDistributionTransaction`, `recordServe`/`undoServe` ผ่าน store) ซึ่งตรงกับ flow ที่ schema.md
ระบุว่ายังไม่มี doc รองรับ — ไม่มี CR ใดครอบคลุมเรื่องนี้มาก่อน (CR-058 ครอบคลุมแค่ planning
`meal_plan`/`meal_service` และปิดสถานะ `done` ไปแล้วโดยไม่รวมส่วนนี้; CR-059 ครอบคลุมของทั่วไป/NFI
ไม่ใช่อาหาร) จึงต้องเปิด Change Record ใหม่ก่อนแก้ `schema.md` ตาม `docs/change-management.md` §2/§6

## Change

**เพิ่ม doc type ใหม่ `meal_distribution` — `meal_distribution:{ulid}` · append-only** ใน DB
`shelter_{shelter_code}` §2 (Operations) — 1 doc ต่อ 1 ครั้งที่สแกน/บันทึกแจกอาหารให้ผู้รับ 1 คน:

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `meal_service_id` | str | req | → `meal_service:{ulid}` (§2.7) — บันทึกนี้ตัดยอดจากบริการมื้อไหน |
| `meal_plan_id` | str\|null | opt | denormalize จาก `meal_service.meal_plan_id` เพื่อ query ตรง ไม่ join |
| `recipe_id` | str\|null | opt | → รายการเมนูใน `meal_plan.recipes[].recipe_id` (§2.5) — ระบุว่าสแกนแจกเมนูไหน เมื่อมื้อนั้นมีหลายเมนู (มัค: `MealMenuItem.id`) |
| `recipient_type` | enum(`evacuee`,`volunteer`,`outside`) | req | จับคู่กับ `meal_service.external` (§2.7) ที่นับ `outside_evacuees`/`volunteers` แบบ aggregate อยู่แล้ว |
| `recipient_id` | str\|null | เมื่อ `recipient_type=evacuee` | → `evacuee:{ulid}` — `null` เมื่อ `volunteer`/`outside` (ยังไม่มี id ระบบ) |
| `portions` | qty_str>0 | req | จำนวนที่แจกในการสแกนครั้งนี้ |
| `scanned_by` | str | req | staff/user id ผู้บันทึก |
| `scanned_at` | ts | req | — |
| `status` | enum(`active`,`voided`) | req | default `active` — รองรับการกดยกเลิก/สแกนผิดหน้างาน (Undo/Void) |
| `voided_at` | ts\|null | opt | timestamp ตอนยกเลิกรายการ (เมื่อ `status=voided`) |
| `voided_by` | str\|null | opt | staff id ผู้กดยกเลิกรายการ |
| `override_reason` | str\|null | opt | บังคับกรอกเมื่อสแกนซ้ำคนเดิม+เมนูเดิมในมื้อเดียวกัน (ดู Open Question 2 — เสนอตัดออกใน V1) |

**Index:** `(meal_service_id)` · `(recipient_id, meal_service_id)` (เช็คสแกนซ้ำ) ·
`stock` (ยอดแจกจริง) = **client** sum ของ `portions` (เฉพาะ `status=active`) ต่อ `meal_service_id`

**บังคับเพดาน (แก้ §2.7 ให้ตรงกับ flow ที่มี doc รองรับแล้ว):**
`sum(meal_distribution.portions WHERE meal_service_id = X AND status = 'active') ≤ meal_service[X].actual_yield` —
เขียนไม่ผ่านถ้าเกิน (เปลี่ยนจาก soft warning เป็น hard block ที่ domain layer เหมือน pattern อื่นๆ
ที่บังคับที่ `createXxx` ก่อนเขียน CouchDB)

## Requirements & Acceptance Criteria

- **FR-MD-01 (Doc Creation):** ระบบต้องบันทึก `meal_distribution` doc (`meal_distribution:{ulid}`) 1 รายการทุกครั้งที่มีการสแกนหรือบันทึกการแจกอาหารสำเร็จ โดยผูกกับ `meal_service_id` ที่เกี่ยวข้อง
- **FR-MD-02 (Remaining Quota Hard-block):** Domain layer ต้องปฏิเสธ (Reject) การบันทึกแจกอาหาร หากผลรวม `sum(portions)` ของมื้อนั้น (เฉพาะ `status=active`) จะเกินกว่า `meal_service.actual_yield`
- **FR-MD-03 (Duplicate Scan Prevention):** หากผู้พักพิง (`recipient_id`) เคยรับเมนูเดิม (`recipe_id`) ในบริการมื้อเดียวกัน (`meal_service_id`) แล้ว ระบบต้องแจ้งเตือนและปฏิเสธการสแกนซ้ำ (Hard-block)
- **FR-MD-04 (Audit Trail Voiding):** การยกเลิกรายการแจกจ่ายผิดพลาด (Undo) ต้องเปลี่ยน `status` เป็น `'voided'` พร้อมบันทึก `voided_at` และ `voided_by` โดยห้าม Hard-delete doc ออกจาก CouchDB

## Open Questions (ต้องให้ Project Owner เคาะก่อน approve)

1. **ความหมายของ `meal_service.served` หลังมี log นี้** — เลือกได้ 2 ทาง:
   - **Option A (เก็บ manual entry เดิมไว้ - แนะนำสำหรับ V1):** `meal_service.served` ยังกรอกมือแบบเดิม (ยอดรวมท้ายมื้อ)
     ส่วน `meal_distribution` log เป็นแค่ audit trail/เพดานแยกจากกัน — ไม่กระทบ schema เดิม ไม่ต้อง bump `schema_v` ของ `meal_service`
   - **Option B (derive จาก log):** `meal_service.served` = คำนวณจาก `sum(meal_distribution.portions)`
     เสมอ (คล้าย `stock_ledger` derive `stock_balance`) — แม่นกว่าแต่เปลี่ยนความหมาย/แหล่งข้อมูลของ field
     ที่มีอยู่แล้ว อาจต้อง bump `schema_v` ของ `meal_service` (ปัจจุบัน v2) ตาม `change-management.md` §4
2. **`override_reason` ควรมีจริงไหม (Recommendation: ตัดออกใน V1)** — mock UI ปัจจุบัน (`meal-distribution` store)
   ทำเป็น hard block ห้ามแจกซ้ำเมนูเดิมในมื้อเดียวกันเด็ดขาด (`hasReceived` เตือนและบล็อกทันที)
   หาก business ยังไม่มี requirement ขอรับซ้ำพร้อมเหตุผลพิเศษ เสนอให้ตัด field นี้ออกเพื่อลดความซับซ้อนของ schema และ UI
3. **`recipe_id` optional หรือ req** — ขึ้นกับว่าโครงสร้าง "Meal Session → Production Batch" ที่พูดถึงใน
   CR-058 (§3 ของ spec ต้นทาง, ไม่ได้ persist เป็น doc แยกใน `schema.md` จริง — ปัจจุบัน `meal_plan.recipes[]`
   คือตัวที่ใกล้เคียงที่สุด) ควรผูกกับ log นี้แน่นแค่ไหน
4. **การยกเลิกรายการแจกผิด (Undo / Void)** — เสนอใช้ `status: 'voided'` + `voided_at` แทนการ hard delete doc ใน CouchDB
   เพื่อให้มี audit trail ตรวจสอบย้อนหลังได้ครบถ้วน

## Impact

- **Docs:** `docs/data/schema.md` — เพิ่ม §2.x `meal_distribution`; แก้ข้อความ §2.7 ที่บอกว่า flow นี้
  "ยังไม่มีในระบบ" ให้ชี้ไปที่ doc ใหม่แทน; ถ้าเลือก Option B ต้องบวก `schema_v` note ใน §2.7 ด้วย
- **Code:** `frontend/src/lib/features/meal-distribution/` (ปัจจุบันเป็น mock — ต้องมี `data/*.remote.ts`
  จริงเขียน CouchDB), `frontend/src/lib/features/kitchen/` (อ่าน `actual_yield` มาโชว์เพดาน)
- **Test:** ต้องมี unit test ของ domain function ที่บังคับเพดาน (`served ≤ actual_yield`) ตาม
  `frontend/CONTRIBUTING.md` §2 (definition of done)

## Migration

N/A — doc type ใหม่ทั้งหมด ไม่กระทบ doc ที่ persist อยู่แล้ว (ยกเว้นถ้าเลือก Option B ข้อ 1 ด้านบน
ซึ่งต้องเขียน migration note ของ `meal_service` แยกตอน approve)

## Decision log
- 2026-09-02 — proposed
