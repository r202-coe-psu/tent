---
id: CR-240
title: รับอาหารแทนสมาชิกครัวเรือน — distribution_log รายสมาชิก + collected_by_recipient_id
status: approved
date: 2026-11-05
updated: 2026-11-11
requested_by: feedback อบรมระบบ 2026-11-03 (#1154)
decided_by: kong
layer: volatile
affects:
  - docs/data/schema.md §2.30 (`distribution_log.collected_by_recipient_id`, additive, ไม่ bump `schema_v`)
  - docs/changes/03-C-supply/CR-121-spec-ticket.md FR-DST-02 (stepper → เลือกสมาชิก) + AC-DST-02.1 (log ต่อสมาชิก) + ตาราง Screen/Role หน้าจอ 14 (stepper ยังคงที่ FR-LON-02 `/onsite/loans`)
  - docs/changes/03-C-supply/CR-159-onsite-distribution.md FR-MQW-01/02/05 (ใช้ตามเดิม ไม่แก้)
  - frontend/src/lib/features/distribution/domain/food-supplies
  - frontend/src/lib/features/distribution/application/food-supplies
  - frontend/src/lib/features/distribution/ui (FoodDistributionCard)
  - VDU `_design/access` shelter DB (ถ้าตรวจ field ใหม่ → `pnpm redeploy:access`)
why: >
  FR-DST-02 ให้หัวหน้ารับแทนด้วย stepper ได้ log ใบเดียวของคนที่สแกน (qty = จำนวนสมาชิก).
  สมาชิกคนอื่นไม่มีประวัติ จึงสแกนรับมื้อเดียวกันซ้ำได้โดยไม่ขึ้นเตือน (FR-MQW-01 เช็คราย recipient_id).
migration: >
  N/A — field ใหม่เป็น optional; log เดิมอ่านได้ตามปกติ ไม่ backfill. log stepper เดิม (qty > 1) คงไว้ตามเดิม.
---

# CR-240 — รับอาหารแทนสมาชิกครัวเรือน

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** การแจกอาหารที่ผู้รับมี `household_id` → บันทึก `distribution_log` **1 ใบต่อสมาชิก**
>   (`qty: "1"`) แทน log ใบเดียว qty = จำนวนสมาชิก. เพิ่ม `collected_by_recipient_id` (opt) = ผู้มารับ.
> - **UI:** เลิกใช้ stepper ของ FR-DST-02 → รายการเลือกสมาชิกที่อยู่ในศูนย์ พร้อมสถานะรับแล้ว/ยังไม่รับต่อคน.
> - **ผล:** สมาชิกที่ถูกรับแทนแล้วมาสแกนเอง → ขึ้นเตือนรับซ้ำตามกฎเดิม (FR-MQW-01) โดยไม่ต้องแก้ index.
> - **Schema:** additive, ไม่ bump `schema_v`.
> - **นอกขอบเขต:** โควตา "1 ชิ้นต่อครัวเรือน" ของใช้, โต๊ะแจกของใช้, กันรับซ้ำฝั่ง server
>   (ยัง client-advisory ตาม CR-211 R2), QR ระดับครัวเรือน (ไม่มีตาม CR-051 — ใช้ QR สมาชิกคนใดก็ได้ตาม PRD FR-23).

---

## 1. Spec delta — `docs/data/schema.md` §2.30

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `collected_by_recipient_id` | str | opt | ผู้มารับแทน (`evacuee:{ulid}`) เมื่อสมาชิกครัวเรือนรับแทน. ใส่ได้เฉพาะ `recipient_type = evacuee` และต้อง ≠ `recipient_id`; ไม่ใส่เมื่อผู้รับมารับเอง; **immutable หลังออก log** (ตรวจ Zod; VDU ตามข้อ 4). การที่ผู้มารับอยู่ครัวเรือนเดียวกับ `recipient_id` (R3) บังคับที่ workflow `recordHouseholdMealPickup` — Zod/VDU เช็ค household ไม่ได้ |

## 2. Rule delta — CR-121 FR-DST-02

**Before:** Default จำนวนจ่าย `"1"` + ปุ่ม Stepper `[-] 1 [+]` ให้ปรับจำนวนตามสมาชิกครอบครัว → log ใบเดียว.

**After:**

| # | กติกา |
| --- | --- |
| R1 | ผู้รับไม่มี `household_id` → แจกรายคนแบบเดิม (`qty: "1"`) |
| R2 | ผู้รับมี `household_id` → แสดงรายการสมาชิกครัวเรือนที่ "อยู่ในศูนย์" (`IN_SHELTER_STATUSES`: `active`, `room_confirmed`). สมาชิก `checked_out` / `temporary_leave` / `arriving` ไม่อยู่ในรายการ |
| R3 | ผู้มารับ = สมาชิกคนใดก็ได้ในครัวเรือน (ไม่จำกัดหัวหน้า) |
| R4 | สมาชิกที่ยังไม่รับมื้อนี้ (วันเดียวกันตามเวลาไทย, ไม่นับ log `voided`) ถูกเลือกไว้ล่วงหน้า — ยกเว้นสมาชิกที่ต้อง override อยู่แล้ว (รับแล้วตาม R5, แพ้ตาม R7, เมนูไม่ตรงกลุ่ม) ที่ไม่ถูกเลือกไว้ และแสดงเหตุผลรายคน |
| R5 | สมาชิกที่รับมื้อนี้แล้ว ไม่ถูกเลือกไว้ + แสดงเวลาที่รับ; เลือกได้โดย override พร้อมเหตุผลรายคน (ไม่บล็อก — FR-MQW-05) |
| R6 | ยืนยัน → `distribution_log` 1 ใบต่อสมาชิกที่เลือก, `qty: "1"`, `recipient_id` = สมาชิก, `household_id` = ครัวเรือนนั้น, `collected_by_recipient_id` = ผู้มารับ (เฉพาะเมื่อสมาชิก ≠ ผู้มารับ) |
| R7 | เตือนแพ้อาหาร (CR-191) ประเมินรายสมาชิก |
| R8 | บันทึกได้ไม่ครบ (CouchDB ไม่ atomic ข้ามหลาย doc) → แสดงรายชื่อที่สำเร็จ/ไม่สำเร็จ; ลองใหม่เฉพาะคนที่ไม่สำเร็จ โดยไม่สร้าง log ซ้ำของคนที่สำเร็จแล้ว — ก่อน retry อ่าน log ของแต่ละคนซ้ำ (กติกาเดียวกับ FR-MQW-01/02) แล้วข้ามคนที่มี log มื้อนี้ที่ไม่ `voided` อยู่แล้ว (`_id` เป็น ULID สุ่ม จึงกันซ้ำด้วย `_id` ไม่ได้) |
| R9 | In-Hand ของตั๋ว = `allocated_qty - sum(distribution_log.qty)` เท่าเดิม → ลดตามจำนวนสมาชิกที่บันทึกสำเร็จ |
| R10 | ผู้มารับสแกน QR หมดอายุแล้วกดยอมรับความเสี่ยง (CR-233 A1, FR-EQR-44..50) → `recipient_qr_override` บันทึกเฉพาะ log ของผู้มารับเอง (`recipient_id` = ผู้ที่สแกน); log ของสมาชิกคนอื่นที่ถูกรับแทนไม่มี field นี้ เพราะไม่ได้ใช้ QR ของเขา |

**AC:** AC-DST-02.2 คงเดิม. AC-DST-02.1 ปรับจาก "ทุกการกดยืนยัน → `distribution_log` หนึ่งใบ" เป็น "ทุกการกดยืนยัน → `distribution_log` หนึ่งใบต่อสมาชิกที่เลือก" (field อื่นของ AC เดิม — `is_returnable: false`, `status: 'fulfilled'` — เท่าเดิม).

## 3. ทางเลือกที่ตัด

| ทางเลือก | เหตุที่ตัด |
| --- | --- |
| log ใบเดียว + `member_ids[]` | ต้องแก้ทุกจุดที่เช็ครับซ้ำและเพิ่ม index; log รายคนใช้กฎและ index `(recipient_id, status)` เดิมได้ |
| คง stepper | สมาชิกที่ถูกรับแทนไม่มีประวัติ → รับซ้ำได้โดยไม่เตือน (ปัญหาตั้งต้น) |

## 4. Impact

- Zod `distribution_log` + input schema ของ workflow แจกอาหาร: เพิ่ม `collected_by_recipient_id` + invariant ข้อ 1.
- VDU shelter DB: ตรวจ field ใหม่ + เพิ่ม `collected_by_recipient_id` ใน `immutableLogFields` → `pnpm redeploy:access`. ลำดับ deploy ไม่สำคัญ: VDU ใหม่เพิ่มแค่ข้อห้าม (client เดิมไม่เขียน field นี้, client ใหม่เขียนบน VDU เดิมได้).
- Workflow ใหม่ `recordHouseholdMealPickup` เรียก `recordFoodDistribution` ทีละสมาชิก.
- UI `FoodDistributionCard`: stepper → รายการเลือกสมาชิก (`useHouseholdMembers`).
- Worker/projection: ไม่กระทบ (`distribution_log` ไม่ project ไป public plane).

## Migration

N/A — additive optional field, ไม่ bump `schema_v`, ไม่ backfill.

## Decision log

- 2026-11-05 — grill สรุปใน #1154 (D1–D8); owner เลือก track แบบไฟล์ CR
- 2026-11-05 — proposed
- 2026-11-08 — approved (kong); รันเลข CR-240, ย้ายไป `03-C-supply/`; เพิ่มแถวใน `_index.md`; แก้ schema.md §2.30 กับ CR-121 FR-DST-02/AC-DST-02.1/หน้าจอ 14; ปรับ AC-DST-02.1, immutable, R6 `household_id`, R8 วิธี retry ตามรีวิว PR #1184
- 2026-11-11 — เพิ่ม R10 (ร่องรอย QR หมดอายุลงเฉพาะ log ของผู้สแกน ตาม CR-233 A1) ตามรีวิว PR #1208; ยืนยันการตีความ (จดเฉพาะ log ของผู้สแกน) แล้วเมื่อ 2026-11-11; ไม่เปลี่ยนพฤติกรรมโค้ด
