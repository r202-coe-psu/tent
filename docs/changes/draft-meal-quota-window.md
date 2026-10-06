---
id: draft
title: นิยาม "รับซ้ำในมื้อเดียวกัน" + วันของรอบแจกอาหาร + ห้ามแจกเกินยอดในมือ
status: proposed
date: 2026-10-06
requested_by: ทีม frontend (onsite meal distribution)
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/data/schema.md §2.29 requisition_ticket, §2.30 distribution_log (เพิ่มกติกา — ไม่เปลี่ยนรูป doc ในทางเลือก A)
  - docs/changes/CR-121-spec-ticket.md §2 (ข้อ 77) vs FR-DST-02 — ขัดกันเอง
  - schema_v — ไม่เปลี่ยน (ทางเลือก A) / requisition_ticket 1 → 2 (ทางเลือก B ของ FR-MQW-03)
  - frontend/src/lib/features/distribution/domain/food-supplies/distribution-log.ts (isDuplicateMealDistributionLog)
  - frontend/src/lib/features/distribution/application/food-supplies/distribution-workflow.ts (CapacityExceededError)
  - frontend/src/lib/features/meal-distribution/domain/meal-distribution.ts
---

# นิยามโควตามื้อ, วันของรอบแจก และเพดานการแจก

> **สรุป (TL;DR)**
> - **เปลี่ยนอะไร:** ระบุให้ชัดว่า "รับซ้ำ" นับต่อ *มื้อ* หรือต่อ *เมนู*, ขอบเขต "วัน" ใช้เขตเวลาไหน, รอบแจกอาหารผูกกับวันไหน และห้ามแจกเกินยอดในมือ
> - **ทำไม:** CR-121 ขัดกันเอง (ข้อ 77 "เมนูเดิมในมื้อเดียวกัน" vs FR-DST-02 "1 คน ต่อ 1 มื้อ"); `requisition_ticket` ไม่มี field วันที่ให้บริการ
> - **dev ต้อง build:** duplicate check + capacity guard ตาม FR-MQW-01..04 (ส่วนใหญ่มีในโค้ดแล้ว — CR นี้ทำให้ doc ตามทัน)
> - **กระทบ:** schema.md §2.29/§2.30 (กติกา); `schema_v` ขึ้นกับ FR-MQW-03

## Change

**Before:**
- CR-121 §2 ข้อ 77: "ตรวจจับการรับซ้ำ (คนเดิม + **เมนูเดิม** ในมื้อเดียวกัน)"
- CR-121 FR-DST-02 / หน้าจอ 14: "โควตา **1 คน/มื้อ**"
- ไม่มีนิยาม "มื้อเดียวกัน" เชิงเวลา (วันไหน, เขตเวลาไหน)
- `requisition_ticket` (food) มี `meal` แต่ไม่มีวันที่ให้บริการ
- AC-DST-02.2 นิยาม In-Hand = `allocated_qty − Σ distribution_log.qty` แต่ไม่ระบุว่าแจกเกิน In-Hand ได้หรือไม่
- โค้ดกลาง (`isDuplicateMealDistributionLog`) ใช้: ซ้ำ = log ไม่ voided, ไม่ returnable, `meal` เดียวกัน, `thailandCalendarDay(distributed_at)` เดียวกัน (ไม่ดูเมนู)

**After (เสนอ):**

### Requirements
- **FR-MQW-01** — "รับซ้ำ" > [NEEDS DECISION: (A) ต่อ **มื้อ**: ผู้รับคนเดิม + `meal` เดียวกัน + วันเดียวกัน ไม่ว่าเมนูใด — ตรง FR-DST-02 และโค้ดกลางปัจจุบัน, (B) ต่อ **เมนู**: + `item_id` เดียวกัน — ตรง CR-121 ข้อ 77]
- **FR-MQW-02** — "วันเดียวกัน" = วันปฏิทิน Asia/Bangkok (UTC+7) ของ `distribution_log.distributed_at`; log ที่ `status='voided'` ไม่นับ
- **FR-MQW-03** — วันของรอบแจก (ใช้จัดกลุ่มบนหน้าจอและ filter ตามวัน) > [NEEDS DECISION: (A) derive = `thailandCalendarDay(requisition_ticket.created_at)` — ไม่เปลี่ยน schema, implementation ปัจจุบัน; ข้อเสีย: ตั๋วที่เปิดล่วงหน้าข้ามวันจะไปอยู่ผิดวัน, (B) เพิ่ม `service_date` (str `YYYY-MM-DD`, req เมื่อ `requisition_type='food'`) ใน `requisition_ticket` → bump schema_v 1→2, (C) derive จาก `meal_service` / `meal_plan.date` ที่ผูกผ่าน `distribution_log.meal_service_id`]
- **FR-MQW-04** — ห้ามบันทึก `distribution_log` ที่ทำให้ `Σ qty (non-voided)` ของ ticket+item เกิน `allocated_qty` (รวม amendments). ระบบต้องปฏิเสธพร้อมข้อความ; เติมของต้องใช้ amendment (FR-DST-04) เท่านั้น
- **FR-MQW-05** — การรับซ้ำตาม FR-MQW-01 ไม่บล็อก แต่ต้อง override พร้อมเหตุผล (`is_override: true`, `override_reason`) — ตาม FR-DST-02 เดิม (ยืนยันซ้ำเพื่อความชัด)

### Acceptance
- ผู้รับรับ lunch เมนู X แล้ว สแกน lunch เมนู Y วันเดียวกัน → ผลตาม FR-MQW-01 ที่เคาะ
- log ที่ `distributed_at` 23:30 (UTC+7) กับ 00:10 วันถัดไป → ไม่นับซ้ำ
- log ที่ voided → ไม่นับซ้ำ และคืน In-Hand
- แจก qty ที่ทำให้เกิน `allocated_qty` → ถูกปฏิเสธ ไม่มี doc ถูกเขียน

## Why
- CR-121 มีข้อความขัดกันสองที่ — dev แต่ละคนเลือกต่างกันได้
- ไม่มีขอบเขตวัน → แจกมื้อเย็นดึกข้ามเที่ยงคืนอาจนับผิด
- โค้ดกลางบังคับ capacity (`CapacityExceededError`) อยู่แล้วแต่ doc ไม่ระบุ → spec ต้องนำ code

## Impact
- docs: schema.md §2.30 เพิ่มกติกา quota/capacity; §2.29 (ถ้าเลือก FR-MQW-03 B) เพิ่ม field; แก้ CR-121 ข้อ 77 ให้ชี้มาที่ CR นี้
- code: `isDuplicateMealDistributionLog` (ถ้าเลือก FR-MQW-01 B ต้องเพิ่ม `item_id`); `meal-distribution` session grouping (ถ้าเลือก FR-MQW-03 B/C)
- VDU: ไม่กระทบ (cross-doc rule — application layer)

## Migration
- ทางเลือก A ทุกข้อ: N/A
- FR-MQW-03 B: `service_date` อ่าน default = `thailandCalendarDay(created_at)` สำหรับ doc schema_v 1; ไม่ต้อง backfill; เขียนใหม่ stamp schema_v 2

## Decision log
- 2026-10-06 — proposed (จากการ align `meal-distribution` เข้ากับ schema กลาง)
