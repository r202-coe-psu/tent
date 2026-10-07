---
id: draft
title: กติกาแจกอาหารปรุงสุกที่จุดแจก — รับซ้ำในมื้อ, วันของรอบ, เพดาน In-Hand, นาฬิกา 4 ชม.
status: proposed
date: 2026-10-06
updated: 2026-10-07
requested_by: ทีม frontend (Distribution Desk / Station 4 — `/onsite/distribution` ขั้น 2–3)
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/data/schema.md §2.29 requisition_ticket, §2.30 distribution_log (เพิ่มกติกา — ไม่เปลี่ยนรูป doc ในทางเลือก A)
  - docs/changes/CR-121-spec-ticket.md §1.2 ข้อ 2 (บรรทัด 76–77), FR-DST-02, FR-DST-03 — ขัดกันเอง / ขัดกับ CR-109
  - docs/task-breakdown/03-C-supply.md T-12 ("แจกเกิน on-hand → เตือน/ปฏิเสธ — ห้ามทำให้ stock ติดลบ")
  - schema_v — ไม่เปลี่ยน (ทางเลือก A ทุกข้อ) / requisition_ticket 1 → 2 (FR-MQW-03 B)
  - frontend/src/lib/features/distribution/domain/food-supplies/distribution-log.ts (isDuplicateMealDistributionLog)
  - frontend/src/lib/features/distribution/application/food-supplies/distribution-workflow.ts (CapacityExceededError, cooking_completed_at)
  - frontend/src/lib/features/distribution/ui/frontline/FoodDistributionCard.svelte (FOOD_4H_TIMESTAMP_BLOCKER)
---

# กติกาแจกอาหารปรุงสุกที่จุดแจก

> **สรุป (TL;DR)**
> - **เปลี่ยนอะไร:** นิยามให้ชัด 4 เรื่องของขั้น "แจกอาหารปรุงสุก": (1) รับซ้ำนับต่อมื้อหรือต่อเมนู + บล็อกแข็งหรือ override ได้, (2) "วันเดียวกัน", (3) แจกเกิน In-Hand ได้ไหม, (4) นาฬิกา 4 ชม. เริ่มนับจาก field ไหน
> - **ทำไม:** CR-121 ขัดกันเองและอ้างมติ CR-109 ผิดเรื่อง; โค้ดบน `develop` เลือกไปแล้วโดยไม่มี doc รองรับ และนาฬิกา 4 ชม. ถูกปิดไว้ (`FOOD_4H_TIMESTAMP_BLOCKER`) เพราะไม่มีแหล่ง timestamp
> - **dev ต้อง build:** ส่วนใหญ่มีแล้ว — CR นี้ทำให้ doc ตามโค้ด; งานใหม่จริงคือ FR-MQW-06 (เปิดนาฬิกา 4 ชม.)
> - **กระทบ:** schema.md §2.29/§2.30 (กติกา); `schema_v` ขึ้นกับ FR-MQW-03

## Why

| เรื่อง | ฝั่ง A | ฝั่ง B | โค้ดปัจจุบัน (`develop`) |
| --- | --- | --- | --- |
| รับซ้ำ | CR-121 §1.2 ข้อ 2 (บรรทัด 77) คงกติกา CR-109: "คนเดิม + **เมนูเดิม** ในมื้อเดียวกัน" — CR-109 FR-MD-03 = **hard-block**, ตัด `override_reason` ใน V1 | CR-121 FR-DST-02 / หน้าจอ 14: "โควตา **1 คน/มื้อ**" + ปุ่ม `[กรณีพิเศษ Override]` บังคับเหตุผล | ต่อ **มื้อ** (ไม่ดูเมนู) + วันปฏิทินไทย, **override ได้**พร้อมเหตุผล (`isDuplicateMealDistributionLog`) |
| Soft warning ของ CR-109 | CR-121 §1.2 ข้อ 2 (บรรทัด 76) บอกว่าคงมติ "Soft Warning 4 ชม." ของ CR-109 | CR-109 จริง ๆ คือ soft warning ของ **เพดานยอดผลิต** `Σ portions ≤ actual_yield` — ไม่มีเรื่อง 4 ชม. | — |
| แจกเกินยอด | CR-109: เกิน `actual_yield` ได้ (soft) | T-12 (03-C-supply.md): "แจกเกิน on-hand → เตือน/ปฏิเสธ — ห้ามทำให้ stock ติดลบ" (สต็อกคลัง) | **ปฏิเสธ** เมื่อเกิน `allocated_qty` (`CapacityExceededError`) |
| วันของรอบ | `requisition_ticket` (food) มี `meal` แต่ไม่มีวันที่ให้บริการ | — | derive จาก `thailandCalendarDay(distributed_at)` ตอนเช็คซ้ำ |
| นาฬิกา 4 ชม. | FR-DST-03 "นับจากเวลาปรุงเสร็จ" | ตั๋วไม่มี lot/เวลาปรุง; 1 ตั๋วอาจมีหลาย lot | workflow รองรับ `cooking_completed_at` แต่ UI ส่งไม่ได้ → ปิดไว้ |

## Change

### Requirements
- **FR-MQW-01** — "รับซ้ำ" > [NEEDS DECISION: (A) ต่อ **มื้อ**: ผู้รับคนเดิม + `meal` เดียวกัน + วันเดียวกัน ไม่ว่าเมนูใด — ตรง FR-DST-02 และโค้ดปัจจุบัน, (B) ต่อ **เมนู**: + `item_id` เดียวกัน — ตรง CR-121 §1.2 ข้อ 2 / CR-109]
- **FR-MQW-02** — "วันเดียวกัน" = วันปฏิทิน Asia/Bangkok (UTC+7) ของ `distribution_log.distributed_at`; log ที่ `status='voided'` หรือ `is_returnable=true` ไม่นับ
- **FR-MQW-03** — วันของรอบแจก (จัดกลุ่ม/filter ตั๋วอาหารตามวัน) > [NEEDS DECISION: (A) derive = `thailandCalendarDay(requisition_ticket.created_at)` — ไม่เปลี่ยน schema; ข้อเสีย: ตั๋วเปิดล่วงหน้าข้ามวันจะอยู่ผิดวัน, (B) เพิ่ม `service_date` (str `YYYY-MM-DD`, req เมื่อ `requisition_type='food'`) → bump schema_v 1→2, (C) derive จาก `meal_plan.date` ผ่าน `distribution_log.meal_service_id`]
- **FR-MQW-04** — ห้ามบันทึก `distribution_log` ที่ทำให้ `Σ qty (non-voided)` ของ ticket+item เกิน `allocated_qty` (รวม amendments) — ระบบปฏิเสธพร้อมข้อความ; เติมของใช้ amendment (FR-DST-04) เท่านั้น. **ยกเลิก** soft warning `Σ portions ≤ actual_yield` ของ CR-109 (ถูก cap ด้วย `allocated_qty` แทนแล้ว เพราะของออกจากคลังได้ไม่เกินที่ผลิตเข้า)
- **FR-MQW-05** — รับซ้ำตาม FR-MQW-01 > [NEEDS DECISION: (A) ไม่บล็อก — override พร้อมเหตุผล (`is_override: true`, `override_reason` req) ตาม FR-DST-02 และโค้ดปัจจุบัน, (B) บล็อกแข็งตาม CR-109 FR-MD-03]. role ที่ override ได้ = ทุก role ที่แจกได้ (ไม่ต้องยกระดับ)
- **FR-MQW-06** — เวลาเริ่มนาฬิกา 4 ชม. ของ `item_category:ready_meal` > [NEEDS DECISION: (A) `meal_service.cooking_completed_at` ของ `meal_service_id` ที่ผูกกับตั๋ว — ต้องให้ตั๋ว food ระบุ `meal_service_id` (ยังไม่มีใน §2.29 → field ใหม่ + bump schema_v), (B) `lot.produced_at`/`lot.expiry` ของ lot ที่ถูก `distribute` ออกให้ตั๋วนี้ (ผ่าน `stock_ledger.lot_ref`) — ไม่เปลี่ยน schema ticket; หลาย lot ใช้ lot **ที่เก่าที่สุด** (ดู `draft-lot-produced-at`), (C) เลื่อนออกจาก V1 — ไม่แสดงนาฬิกา, ไม่ stamp `is_expired_warning`]

### Acceptance
- ผู้รับรับ lunch เมนู X แล้ว สแกน lunch เมนู Y วันเดียวกัน → ผลตาม FR-MQW-01/05 ที่เคาะ
- log `distributed_at` 23:30 (UTC+7) กับ 00:10 วันถัดไป → ไม่นับซ้ำ
- log ที่ voided → ไม่นับซ้ำ และคืน In-Hand
- แจก qty ที่ทำให้เกิน `allocated_qty` → ถูกปฏิเสธ ไม่มี doc ถูกเขียน
- (ถ้า FR-MQW-06 ≠ C) อาหารเกิน 4 ชม. → แบนเนอร์แดง, ยืนยันได้, log มี `is_expired_warning: true`

## Impact
- docs: schema.md §2.30 เพิ่มกติกา quota/capacity/4h; §2.29 ถ้าเลือก FR-MQW-03 B หรือ FR-MQW-06 A; แก้ CR-121 §1.2 ข้อ 2 (บรรทัด 76–77) ให้ชี้มาที่ CR นี้; T-12 ไม่ต้องแก้ (ตรงกับ FR-MQW-04); การปิดสถานะ CR-109 (ถูก CR-121 แทนแล้ว) ติดตามใน `draft-cr-109-superseded-by-cr-121`
- code: `isDuplicateMealDistributionLog` (ถ้า FR-MQW-01 B เพิ่ม `item_id`); `FoodDistributionCard` เปิดนาฬิกา 4 ชม. ตาม FR-MQW-06; frontline filter ตามวัน (FR-MQW-03)
- VDU: ไม่กระทบ (กติกา cross-doc อยู่ใน application layer)

## Migration
- ทางเลือก A ทุกข้อ: N/A
- FR-MQW-03 B: อ่าน default `service_date = thailandCalendarDay(created_at)` สำหรับ doc schema_v 1; ไม่ backfill; เขียนใหม่ stamp schema_v 2
- FR-MQW-06 A: ตั๋ว food เดิมไม่มี `meal_service_id` → ไม่แสดงนาฬิกา (เท่ากับ C สำหรับ doc เก่า)

## Decision log
- 2026-10-06 — proposed (จากการ align `meal-distribution` เข้ากับ schema กลาง)
- 2026-10-06 — rescoped ให้ชี้ที่ `/onsite/distribution` (`FrontlineStationPage`) แทน `features/meal-distribution` ที่เลิกใช้; เพิ่ม FR-MQW-05 (hard/soft), FR-MQW-06 (นาฬิกา 4 ชม.) และตารางความขัดแย้ง CR-121 ↔ CR-109 ↔ T-12
- 2026-10-07 — แก้การอ้างอิง: CR-121 "ข้อ 76–77" → §1.2 ข้อ 2 (เป็นเลขบรรทัด), อ้างข้อความ T-12 ตามต้นฉบับ, เพิ่ม cross-ref `draft-cr-109-superseded-by-cr-121`
