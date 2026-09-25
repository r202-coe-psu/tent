---
id: CR-131
title: เพิ่มการปฏิเสธรับมอบ (ตีกลับโรงครัว) ให้ meal_service_receipt — คลังบันทึกผลผลิตใหม่ได้หลังถูกตีกลับ
status: approved
date: 2026-09-25
updated: 2026-09-25
requested_by: Project Owner (session ปรับ UI /back-office/tickets/kitchen)
decided_by: Project Owner
layer: stable
extends:
  - CR-129 (meal_service_receipt — เดิมมีแค่ "ยืนยันตรวจรับ" ทางเดียว)
affects:
  - docs/data/schema.md §2.7.3 (เพิ่ม field `outcome`, `reason` ใน meal_service_receipt)
  - frontend/src/lib/features/kitchen/domain/kitchen.ts (`MealServiceReceiptOutcome`,
    `createMealServiceReceipt` รับ outcome/reason)
  - frontend/src/lib/features/kitchen/data/kitchen.repository.ts + kitchen.remote.ts
    (`rejectMealServiceReceipt`; `recordMealService` ผ่อน invariant "1 แผน/1 ครั้ง" ให้บันทึก
    ใหม่ได้ถ้าครั้งก่อนถูกปฏิเสธ; `getMealServiceByPlanId` คืนตัวล่าสุดแทน "ตัวแรกที่เจอ")
  - frontend/src/lib/features/kitchen/application/queries.ts (hook `useRejectMealServiceReceipt`)
  - frontend/src/routes/(protected)/back-office/kitchen/production-board/[session_id]/+page.svelte
    (ปุ่มปฏิเสธ + เหตุผล, banner ตีกลับ, ฟอร์มบันทึกผลผลิตเปิดใหม่ได้)
  - frontend/src/lib/features/tickets/ui/ticket-list.svelte (แถวที่ถูกตีกลับกลับไปหมวด "ครัวกำลังปรุง";
    แสดงแค่ meal_service ล่าสุดต่อแผน; ปุ่มยืนยัน/ปฏิเสธแสดงเฉพาะเมื่อเข้าจากหน้านี้ผ่าน `role=warehouse`)
---

# CR-131: ปฏิเสธรับมอบ (ตีกลับโรงครัว)

## 1. Why

CR-129 ให้คลังกด "ยืนยันตรวจรับ" ได้ทางเดียว แต่ตัวอย่างหน้าจอที่เจ้าของโครงการอ้างอิงมี
"ปฏิเสธการรับมอบ / ตีกลับโรงครัว" ด้วย — กรณีจำนวนไม่ตรงหรือคุณภาพไม่ผ่าน คลังต้องตีกลับให้ครัวแก้ไข

## 2. Change

### 2.1 `meal_service_receipt` เพิ่ม `outcome`/`reason`

`outcome: 'confirmed' | 'rejected'`, `reason?: string` (บังคับเมื่อ `rejected`) — ยังเป็น
append-only doc เดียวกับ CR-129 หนึ่งใบต่อ `meal_service` (idempotent ทั้ง 2 ทาง)

### 2.2 ผ่อน invariant "1 แผน/1 ครั้ง" ของ `recordMealService`

เดิม: ห้ามบันทึก `meal_service` ซ้ำถ้าแผนนั้นมีอยู่แล้วไม่ว่ากรณีใด ตอนนี้: อนุญาตให้บันทึกใหม่ได้
**เฉพาะ**เมื่อ `meal_service` ล่าสุดของแผนนั้นถูกปฏิเสธแล้ว (`getMealServiceByPlanId` คืนตัวล่าสุด
ตามลำดับ ulid) — ของเดิม (ที่ถูกปฏิเสธ) ไม่ถูกลบ ยังอยู่เป็นประวัติ append-only ตามเดิม

### 2.3 UI

- Production-board (Stage C): ปุ่ม "ปฏิเสธการรับมอบ / ตีกลับโรงครัว" คู่กับปุ่มยืนยัน พร้อมช่องเหตุผล
  บังคับกรอก — เมื่อถูกตีกลับ ฟอร์มบันทึกผลผลิตเปิดให้กรอกใหม่ได้ทันที (ไม่ต้องกด "เริ่มปรุงอาหาร" ซ้ำ)
- ปุ่มยืนยัน/ปฏิเสธแสดง **เฉพาะ** เมื่อเข้าหน้านี้ผ่าน "จัดการ" จากหน้า `/back-office/tickets/kitchen`
  (โรงครัวและเสบียงอาหาร — มุมมองคลัง) ไม่แสดงเมื่อเข้าจาก `/back-office/kitchen` (มุมมองครัวกลาง)
  — ใช้ query param `role=warehouse` แยกมุมมอง
- ticket-list.svelte: แถว `meal_service` ที่ถูกตีกลับกลับไปแสดงในหมวด "ครัวกำลังปรุง" (สีส้ม) พร้อม
  label "ถูกตีกลับ - รอปรุงใหม่"; แสดงแค่ `meal_service` ล่าสุดต่อแผน (ตัวที่ถูกปฏิเสธไม่โผล่ซ้ำอีกแถว)

## 3. Impact

- ไม่ bump schema_v ของ `meal_service_receipt` (ยังเป็น 1) — เพิ่ม field ใหม่แบบ backward-compatible
  (0 record จริงอยู่แล้วตอนเปลี่ยน)
- `meal_service` อาจมีมากกว่า 1 doc ต่อ `meal_plan_id` ได้แล้ว (เดิมสมมติว่ามีแค่ 1) — จุดที่เคยใช้
  `.find()` (ตัวแรกที่เจอ) ต้องเปลี่ยนเป็นตัวล่าสุดทั้งหมด (แก้แล้วใน production-board + ticket-list)
