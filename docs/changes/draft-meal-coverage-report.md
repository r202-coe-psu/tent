---
id: draft
title: รายงานผู้พักพิงที่ยังไม่มีบันทึกรับอาหารครบ 2 มื้อ — แท็บใหม่ใน /back-office/distribution
status: proposed
date: 2026-11-10
requested_by: feedback หน้างาน — issue #1300
decided_by: project owner
layer: volatile
affects:
  - docs/sitemap.md (`/back-office/distribution` เพิ่มมุมมอง `?view=meal_coverage`)
  - docs/changes/03-C-supply/CR-121-spec-ticket.md (หน้า back-office distribution)
  - frontend/src/lib/features/distribution (domain `meal-coverage`, hook `useDistributionLogsWithSkipped`, แท็บ `MealCoveragePanel`)
  - frontend/src/lib/features/shared (`wasInShelterAllDay`)
why: >
  เจ้าหน้าที่ตามตัวผู้พักพิงที่อาจตกหล่นไม่ได้ เพราะไม่มีหน้าไหนสรุปว่าใครมีบันทึกรับอาหารไม่ถึง 2 มื้อต่อวัน
migration: >
  N/A — อ่านอย่างเดียว ไม่เพิ่ม/แก้ field ใน doc ใด ไม่ bump `schema_v`
---

# draft-meal-coverage-report — ผู้ยังไม่ได้รับอาหารครบ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** แท็บที่ 3 ใน `/back-office/distribution` (`?view=meal_coverage`) แสดงผู้พักพิงที่ **ยังไม่มีบันทึกรับอาหารครบ 2 มื้อ** ของวันที่เลือก
> - **ข้อมูล:** อ่านจาก `distribution_log` + `movement` + `evacuee` เดิม ไม่มี schema ใหม่
> - **เฟสแรก:** เฉพาะผู้พักพิง และเฉพาะ "วันที่ผ่านมา" (เลือกย้อนหลังได้ ค่าเริ่มต้นเมื่อวาน)
> - **รอตัดสินใจ:** โหมด "วันนี้", จิตอาสา/เจ้าหน้าที่, สิทธิ์ของแท็บ (ดู §4)

---

## 1. กติกา

| # | กติกา |
| --- | --- |
| R1 | นับ `meal` ที่ต่างกันของ `distribution_log` ต่อ `recipient_id` ต่อวันไทย (`distributed_at` ตามเวลา Asia/Bangkok) |
| R2 | นับเฉพาะ `breakfast` / `lunch` / `dinner`; `snack` ไม่นับ |
| R3 | ไม่นับ log ที่ `voided`, ของยืมคืน (`is_returnable`) และ log ที่ไม่มี `meal` (กติกาเดียวกับเช็คกินซ้ำ `isDuplicateMealDistributionLog`) |
| R4 | มื้อเดียวกันซ้ำ (override) นับเป็น 1 มื้อ |
| R5 | นับที่ `recipient_id` (คนกิน) ไม่ใช่ `collected_by_recipient_id` (CR-240); log ของ `volunteer` / `staff` / `outside` ไม่สร้างแถว |
| R6 | แสดงเฉพาะผู้ที่อยู่ในศูนย์ **ตลอดทั้งวัน**: เช็คจาก `movement` ของวันนั้น — เข้า/ออก/ลาชั่วคราว/ย้ายออกระหว่างวัน → ไม่แสดง; `zone_change` ไม่กระทบ |
| R7 | evacuee ที่ไม่มี `movement` เลย (initial check-in เป็น best-effort) → ใช้ `current_stay` (สถานะอยู่ในศูนย์ และ `since` ก่อนวันนั้น) |
| R8 | เกณฑ์ 2 มื้อตายตัว (constant ใน domain) |
| R9 | ข้อความบนหน้า: "ยังไม่มีบันทึกรับอาหาร" ไม่ใช่ "ไม่ได้กิน"; ถ้ามี log ที่ parse ไม่ได้ ต้องเตือนว่าตัวเลขอาจต่ำกว่าจริง |

## 2. Impact

- อ่านอย่างเดียว ไม่มี write ไม่มี migration; ไม่กระทบ worker/public plane
- Query: ใช้ `_all_docs` scan ของ `distribution_log` (เหมือน `useDistributionLogs`) แล้วกรองวันฝั่ง client — **ไม่มี index ใหม่**; ต้นทุนโตตามจำนวน log ทั้งศูนย์ (ถ้าช้า ค่อยเพิ่ม query ตามช่วง `distributed_at`)
- สิทธิ์: ใช้ guard เดิมของ `/back-office/distribution` (`requireWarehouseAccess`)

## 3. Test

domain (`meal-coverage`, `in-shelter-day`), view-model, URL state, และ dom test ของแท็บ — ดู PR

## 4. คำถามที่ยังเปิด (นอกเฟสแรก)

1. รวมจิตอาสา/เจ้าหน้าที่ไหม (ยังไม่มีฐานคนของกลุ่มนั้น)
2. โหมด "วันนี้": ใช้ `meal_service` ของ date+meal เป็นตัวบอกมื้อที่ผ่านไปแล้ว และ `meal_service` ที่ถูก reject นับไหม
3. บทบาทไหนเห็นแท็บนี้ได้ (ตอนนี้ใครเข้า distribution back-office ได้ก็เห็น) และจำกัดตาม shelter scope อย่างไร
4. ต้องมี export หรือส่งต่อรายชื่อไหม
