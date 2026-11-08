---
id: draft
title: วันที่แจก (service_date) ของตั๋วอาหาร แทนการอนุมานจาก created_at
status: proposed
date: 2026-11-07
requested_by: feedback อบรมระบบ 2026-11-03 (#1222, แยกจาก #1183)
decided_by: kong
layer: volatile
affects:
  - docs/data/schema.md §2.29 (`requisition_ticket.service_date`, schema_v 1 → 2 สำหรับตั๋ว food/supplies)
  - docs/changes/03-C-supply/CR-159-onsite-distribution.md FR-MQW-03 (กลับคำตัดสิน A → อ่าน `service_date`)
  - frontend/src/lib/features/distribution/domain/food-supplies (Zod, factory, `ticketServiceDay`)
  - frontend/src/lib/features/distribution/ui (CreateTicketDialog, dropdown เลือกตั๋ว; การ์ดแท็บรับของมาจาก #1183)
  - frontend/src/lib/server/shelter-access-design.ts — VDU rule 12 (stable core → `pnpm redeploy:access` ก่อน client รุ่นใหม่สร้างตั๋ว)
why: >
  FR-MQW-03 A ใช้ thailandCalendarDay(created_at) เป็นวันของรอบแจก. ตั๋วที่เปิดล่วงหน้าข้ามวัน
  (เช่น เปิดตั๋วมื้อเช้าพรุ่งนี้ตอนเย็นวันนี้) จึงไปอยู่ผิดวันใน day filter ของแท็บอาหาร และการ์ดแท็บรับของ (#1183).
migration: >
  ตั๋ว schema_v 1 ไม่มี service_date — reader fallback เป็น thailandCalendarDay(created_at) ตาม FR-MQW-03 A เดิม.
  ไม่ backfill. Writer ตั๋ว food/supplies รุ่นใหม่ stamp schema_v 2; ตั๋ว food schema_v 2 ต้องมี service_date.
---

# draft-food-ticket-service-date — `requisition_ticket.service_date`

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** เพิ่ม `service_date` (`YYYY-MM-DD` วันปฏิทินไทย) ใน `requisition_ticket` —
>   **บังคับเฉพาะ `requisition_type = food`** (คู่กับ `meal`); ตั๋วพัสดุไม่มี
> - **วันของรอบแจก** (FR-MQW-03) = `service_date` ถ้ามี, ไม่มี (ตั๋วเก่า) → `thailandCalendarDay(created_at)`
> - **ฟอร์มสร้างตั๋ว:** ค่าเริ่มต้น = วันนี้; เลือกวันนี้หรืออนาคตได้ ไม่จำกัดว่าล่วงหน้าไกลแค่ไหน (ห้ามย้อนหลัง)
> - **ตัวกรองวันแท็บอาหาร:** เปลี่ยนจาก dropdown วันที่มีตั๋ว เป็นปฏิทินเลือกวัน + ตัวเลือก "ทุกวัน"
> - **แก้วัน:** ไม่ได้ — ตั้งตอนสร้างเท่านั้น (immutable); วันผิดให้ยกเลิกตั๋วแล้วเปิดใหม่
> - **Schema:** `schema_v` 1 → 2 สำหรับตั๋ว food/supplies; ตั๋วเก่าอ่านได้ ไม่ backfill
> - **VDU:** rule 12 รับ `schema_v` 1|2 + ตรวจ `service_date` → ต้อง `pnpm redeploy:access` **ก่อน** client รุ่นใหม่สร้างตั๋ว
>   (VDU เดิมปฏิเสธ `schema_v` ≠ 1 — client ใหม่บน VDU เก่าสร้างตั๋วไม่ได้)
> - **ไม่กระทบ:** กติการับซ้ำ FR-MQW-01/02, worker/projection (`requisition_ticket` ไม่ถูก project)

---

## 1. Spec delta — `docs/data/schema.md` §2.29

หัวข้อ: `requisition_ticket` · schema_v **ต่อประเภท**: `food`/`supplies` = **2** (draft นี้), `kitchen`/`transfer` = 1 (คงเดิม)

| Field          | ชนิด             | req                                                                        | หมายเหตุ                                                                              |
| -------------- | ---------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `service_date` | str `YYYY-MM-DD` | req เมื่อ `requisition_type = food` และ `schema_v ≥ 2`; ห้ามมีในประเภทอื่น | วันที่แจก ตามวันปฏิทิน Asia/Bangkok. ตอนสร้างต้อง ≥ วันนี้ (ไทย). immutable หลังสร้าง |

## 2. Rule delta — CR-159 FR-MQW-03

**Before (A, 2026-10-10):** วันของรอบแจก = `thailandCalendarDay(requisition_ticket.created_at)` — ไม่แก้ schema;
ข้อจำกัดที่รับไว้: ตั๋วเปิดล่วงหน้าข้ามวันจะอยู่ผิดวัน

**After:**

| #   | กติกา                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | วันของรอบแจก = `service_date` ถ้ามี; ไม่มี → `thailandCalendarDay(created_at)` (ตั๋ว schema_v 1)                                                                                                                                                         |
| R2  | ใช้ R1 ทุกจุดที่จัดกลุ่ม/กรองตั๋ว **ตามวันที่แจก**: day filter แท็บอาหาร, การ์ดแท็บรับของ (#1183), dropdown เลือกตั๋ว. ยกเว้นตัวกรอง "วันที่สร้าง" ของหน้า back-office (`createdFrom`/`createdTo`) ที่ยังกรองตาม `created_at` ตามชื่อ                    |
| R3  | ฟอร์มสร้างตั๋วอาหาร: ค่าเริ่มต้น = วันนี้ (ไทย); เลือกวันในอดีตไม่ได้; วันอนาคตไม่จำกัดระยะ                                                                                                                                                              |
| R4  | `service_date` แก้ไม่ได้หลังสร้าง (Zod + VDU). VDU เดิมให้ตั๋ว `PENDING_PICK` แก้ได้เฉพาะ `allocated_qty` อยู่แล้ว และยังไม่มีหน้าแก้ตั๋ว. วันผิด → ยกเลิกตั๋ว (`CANCELLED`, ทำได้ตอน `PENDING_PICK`/`READY_FOR_DISPATCH`) แล้วเปิดใบใหม่                |
| R5  | ตัวกรองวันแท็บอาหาร = ปฏิทินเลือกวันใดก็ได้ (date picker) + ตัวเลือก "ทุกวัน" แทน dropdown ที่แสดงเฉพาะวันที่มีตั๋ว — ตั๋วที่ตั้งล่วงหน้าไกลจึงหาเจอเสมอ. ค่าเริ่มต้นคงเดิม: วันนี้ถ้ามีตั๋ววันนี้ ไม่มี → ทุกวัน. เลือกวันที่ไม่มีตั๋ว → แสดงรายการว่าง |

FR-MQW-01/02 (รับซ้ำ = คนเดิม + มื้อเดิม + วันปฏิทินไทยเดียวกันของ `distributed_at`) **คงเดิม** —
การแจกเกิดในวันที่แจกจริงอยู่แล้ว จึงไม่ต้องอ่าน `service_date` ของตั๋วตอนเช็คซ้ำ.

## 3. คำถามที่ปิดแล้ว

| คำถาม (#1222)                      | ข้อสรุป                                                                                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ตั้งเป็นวันที่ผ่านมาแล้วได้ไหม     | ไม่ได้ — วันนี้หรืออนาคตเท่านั้น                                                                                                                                                               |
| แก้วันได้ถึงสถานะไหน               | dev ตอบ "`PENDING_PICK`" แต่ VDU ปัจจุบันไม่ให้แก้ field อื่นนอกจาก `allocated_qty` ตอน `PENDING_PICK` และไม่มีหน้าแก้ตั๋ว → immutable; วันผิดให้ยกเลิกแล้วเปิดใหม่ (R4; kong เคาะ 2026-11-08) |
| ต้อง bump `PROJECTION_VERSION` ไหม | ไม่ — worker ไม่ project `requisition_ticket`                                                                                                                                                  |
| เลือกล่วงหน้าได้ไกลแค่ไหน          | ไม่จำกัด — ตัวกรองวันแท็บอาหารเป็นปฏิทินแทน เพื่อให้หาตั๋วที่ตั้งไว้ไกลเจอ (R5; kong เคาะ 2026-11-08)                                                                                          |

## 4. ทางเลือกที่ตัด

| ทางเลือก                     | เหตุที่ตัด                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| คง FR-MQW-03 A               | ตั๋วเปิดล่วงหน้าอยู่ผิดวัน (ปัญหาตั้งต้น)                                                                                  |
| additive ไม่ bump `schema_v` | อ่านไม่ออกว่าตั๋วอาหารที่ไม่มี `service_date` เป็นตั๋วเก่า หรือ writer ลืมใส่ — bump ทำให้ Zod บังคับได้ตั้งแต่ schema_v 2 |
| ใส่ `service_date` ทุกประเภท | ตั๋วพัสดุไม่ผูกกับมื้อ/วัน ตามที่ issue ขอ                                                                                 |

## 5. Impact

- Zod `requisitionTicketDocSchema`: `schema_v` 1 | 2; `service_date` optional ระดับ field + invariant
  "food + schema_v 2 → ต้องมี", "ไม่ใช่ food → ห้ามมี".
- `requisitionTicketInputSchema` + `createFlow2RequisitionTicket`: รับ `service_date` (บังคับเมื่อ food, ≥ วันนี้), stamp `schema_v: 2`.
- `ticketServiceDay()` อ่าน `service_date` ก่อน แล้ว fallback `created_at`.
- `CreateTicketDialog`: ช่องเลือกวันที่แจก (food).
- ตัวกรองวันแท็บอาหาร (`FrontlineStationPage`, `ui/model/service-day.ts`): dropdown `serviceDayOptions` → ปฏิทินเลือกวัน + "ทุกวัน" (R5).
- ตั๋วครัว (`requisition_type = kitchen`, feature `tickets`) อยู่นอกขอบเขต — คง schema_v 1 ตาม carve-out §2.29.
- VDU rule 12 (food/supplies/transfer): รับ `schema_v` 1|2; food schema_v 2 ต้องมี `service_date` รูป `YYYY-MM-DD`;
  ประเภทอื่นห้ามมี; `service_date` อยู่ใน immutable fields; ตรวจแค่รูปแบบ `YYYY-MM-DD` (วันจริง/ห้ามย้อนหลังตรวจที่ Zod ฝั่ง client); `schema_v` 2 รับเฉพาะ food/supplies (transfer คง 1) **Deploy:** `pnpm redeploy:access` ก่อนปล่อย client รุ่นใหม่
- ตั๋วอาหารในหน้า back-office (ตาราง/รายละเอียด) ยังแสดงเฉพาะ `created_at` — แสดงวันที่แจกเป็นงานต่อ (ไม่อยู่ในรอบนี้)

## 6. Migration

ตั๋ว schema_v 1 คงไว้ ไม่ backfill; reader ใช้ R1 fallback. Writer ใหม่ stamp schema_v 2.
Transition ของตั๋วเดิม (spread doc เดิม) คง `schema_v` และ `service_date` ของ doc นั้น.

## Acceptance

- ตั๋วอาหารมื้อเช้าที่สร้างวันนี้ 20:00 สำหรับพรุ่งนี้ → อยู่ใน day filter "พรุ่งนี้" และการ์ดแท็บรับของแสดง "พรุ่งนี้" (การ์ดหลัง #1183 merge)
- ตั๋ว schema_v 1 ที่ไม่มี `service_date` → อยู่วันตาม `created_at` เหมือนเดิม
- สร้างตั๋วอาหารโดยไม่มี `service_date` หรือเป็นวันที่ผ่านมาแล้ว → Zod ปฏิเสธ
- ตั๋วพัสดุไม่มี `service_date`
- ตั๋วอาหารที่ตั้ง `service_date` ล่วงหน้า 30 วัน → สร้างได้ และเลือกวันนั้นในปฏิทินตัวกรองแท็บอาหารแล้วเห็นตั๋ว

## Decision log

- 2026-11-07 — proposed (dev ตอบคำถามเปิด: วันนี้/อนาคตเท่านั้น; เสนอ immutable แทน "แก้ได้ตอน `PENDING_PICK`" เพราะข้อจำกัด VDU)
- 2026-11-08 — เลือกล่วงหน้าได้ไม่จำกัด; ตัวกรองวันแท็บอาหารเปลี่ยนเป็นปฏิทิน + "ทุกวัน" (R5) (kong)
- 2026-11-08 — `service_date` แก้ไม่ได้หลังสร้าง; วันผิดให้ยกเลิกตั๋วแล้วเปิดใหม่ (R4) (kong)
