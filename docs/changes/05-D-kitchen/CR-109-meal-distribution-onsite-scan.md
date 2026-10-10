---
id: CR-109
title: เพิ่ม meal_distribution log สำหรับแจกจ่ายอาหารหน้างาน + คุมเพดาน Distribution Limit (Soft Warning)
status: approved
date: 2026-09-02
updated: 2026-09-06
requested_by: ทีมพัฒนา (พบช่องว่างระหว่างสร้าง mock UI `frontend/src/lib/features/meal-distribution/`)
decided_by: Project Owner
layer: volatile
affects:
  - docs/data/schema.md §2 (DB shelter_{shelter_code} — Operations) — doc type ใหม่ `meal_distribution`
  - frontend/src/lib/features/meal-distribution/
  - frontend/src/lib/features/kitchen/ (อ่าน meal_plan/meal_service)
---

# CR-109 — เพิ่ม meal_distribution log สำหรับแจกจ่ายอาหารหน้างาน + คุมเพดาน Distribution Limit (Soft Warning)

> **สรุป (TL;DR):** เพิ่ม doc type ใหม่ `meal_distribution` (`meal_distribution:{ulid}`) สำหรับบันทึก log การสแกนแจกอาหารรายบุคคลหน้างาน · ควบคุมเพดานยอดแจกจริงเทียบกับยอดผลิต (`sum(portions) ≤ actual_yield`) ด้วยกลไก Soft Warning พร้อมอนุโลมให้แจกต่อได้หากหน้างานประเมินยอดคลาดเคลื่อน · ได้รับการอนุมัติจาก Project Owner เมื่อ 2026-09-06 (เคาะ Option 1A, ตัด override_reason ออกใน V1)

## Why

`docs/data/schema.md` §2.7 (`meal_service`) ระบุไว้ว่า:

> **`actual_yield` vs `served` (CR-084):** ... เพดาน `served ≤ actual_yield` **ยังไม่บังคับตอนเขียนรอบนี้**
> (แค่ soft warning ฝั่ง UI) — การบังคับเพดานจริง**เป็นงานของ flow แจกจ่าย/สแกนหน้างานที่ยังไม่มีในระบบ**

ทีมพัฒนาได้สร้าง UI ของ `meal-distribution` (สแกน/บันทึกการแจกอาหารต่อคนหน้างานใน `frontend/src/lib/features/meal-distribution/domain/meal-distribution.ts`) ซึ่งตรงกับ flow ที่ `schema.md` ระบุว่ายังไม่มีเอกสารรองรับอย่างเป็นทางการ จึงเปิด Change Record ฉบับนี้ขึ้นและได้รับการอนุมัติเป็น CR-109

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

**Index:** `(meal_service_id)` · `(recipient_id, meal_service_id)` (เช็คสแกนซ้ำ) ·
`stock` (ยอดแจกจริง) = **client** sum ของ `portions` (เฉพาะ `status=active`) ต่อ `meal_service_id`

**การคุมเพดานและการอนุโลมหน้างาน (Soft Warning & Graceful Handling):**
`sum(meal_distribution.portions WHERE meal_service_id = X AND status = 'active') ≤ meal_service[X].actual_yield` —
ตามมติ Project Owner (2026-09-06) **ไม่ใช้ Hard-block เด็ดขาด** เนื่องจากหน้างานอาจมีการประเมินยอดผลผลิตคลาดเคลื่อน หากบล็อกการแจกจะทำให้ผู้ประสบภัยไม่ได้รับอาหารและระบบหยุดชะงัก ให้ระบบแจ้งเตือนแบบ **Soft Warning** แสดงกล่องเตือนยอดเกิน แต่ **อนุโลมให้เจ้าหน้าที่กดยืนยันบันทึกแจกต่อได้** โดยบันทึก Log ไว้ตรวจสอบย้อนหลัง

## Requirements & Acceptance Criteria

- **FR-MD-01 (Doc Creation):** ระบบต้องบันทึก `meal_distribution` doc (`meal_distribution:{ulid}`) 1 รายการทุกครั้งที่มีการสแกนหรือบันทึกการแจกอาหารสำเร็จ โดยผูกกับ `meal_service_id` ที่เกี่ยวข้อง
- **FR-MD-02 (Remaining Quota Soft-warning & Graceful Override):** หากผลรวม `sum(portions)` ของมื้อนั้น (เฉพาะ `status=active`) จะเกินกว่า `meal_service.actual_yield` ระบบต้องแสดงคำเตือน (Soft Warning) ให้เจ้าหน้าที่ทราบ แต่ยังคงอนุโลมให้ยืนยันการบันทึกแจกอาหารได้ เพื่อป้องกันไม่ให้การแจกจ่ายอาหารหน้างานหยุดชะงัก
- **FR-MD-03 (Duplicate Scan Prevention):** หากผู้พักพิง (`recipient_id`) เคยรับเมนูเดิม (`recipe_id`) ในบริการมื้อเดียวกัน (`meal_service_id`) แล้ว ระบบต้องแจ้งเตือนและปฏิเสธการสแกนซ้ำ (Hard-block ที่ระดับเมนู)
- **FR-MD-04 (Audit Trail Voiding):** การยกเลิกรายการแจกจ่ายผิดพลาด (Undo) ต้องเปลี่ยน `status` เป็น `'voided'` พร้อมบันทึก `voided_at` และ `voided_by` โดยห้าม Hard-delete doc ออกจาก CouchDB

## Decision Log & Resolution (มติ Project Owner 2026-09-06)

1. **ความหมายของ `meal_service.served`:** เลือก **Option A** — คงการกรอกมือ manual entry เดิมไว้สำหรับ V1 ไม่แตะ schema_v ของ `meal_service` ส่วน `meal_distribution` เป็น Audit trail แยกต่างหาก
2. **`override_reason`:** **ตัดออกใน V1** — เพื่อลดความซับซ้อนของ UI หน้างาน โดยใช้ Hard-block ป้องกันการรับซ้ำคนเดิม+เมนูเดิมในมื้อเดียวกัน
3. **การคุมเพดาน `actual_yield`:** ปรับเป็น **Soft Warning** พร้อมอนุโลมให้แจกต่อได้ เพื่อความยืดหยุ่นในสถานการณ์จริง

## Impact

- **Docs:** `docs/data/schema.md` — เตรียมเพิ่ม §2.x `meal_distribution` พร้อมระบุความสัมพันธ์กับ `meal_service`
- **Code:** `frontend/src/lib/features/meal-distribution/` (เชื่อมต่อ API Remote Repository จริงเขียนลง CouchDB)
- **Test:** เพิ่ม Unit Test ครอบคลุมการคำนวณยอดรวม, Soft Warning เมื่อเกินเพดาน และการ Void รายการ

## Decision log
- 2026-09-02 — proposed
- 2026-09-06 — approved by Project Owner (เคาะ Option 1A, ตัด override_reason, ปรับเพดาน actual_yield เป็น Soft warning อนุโลมให้แจกต่อได้, รันรหัส CR-109)
