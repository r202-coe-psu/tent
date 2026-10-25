---
id: CR-177
title: เลขรันอ้างอิง RCV-KITCHEN-NNNN ให้ meal_service (รับอาหารปรุงเสร็จเข้าคลัง)
status: done
date: 2026-10-21
requested_by: kong (UI review หน้าคิวตั๋วครัว)
decided_by: kong
layer: volatile
affects:
  - docs/data/schema.md §2.7 (`meal_service` — field ใหม่ `receipt_no`, optional/additive)
  - schema_v คง 2 (ไม่ bump — additive ตาม precedent CR-084/CR-121)
  - frontend/src/lib/features/kitchen/domain/kitchen.ts (`MealService`, `createMealService`)
  - frontend/src/lib/features/kitchen/domain/ (ฟังก์ชันออกเลขใหม่ คู่กับ tickets/domain/ticket-no.ts)
  - frontend/src/lib/features/kitchen/data/kitchen.remote.ts (`recordMealService`)
  - frontend/src/lib/features/tickets/ui/ticket-list.svelte (คอลัมน์ "รหัส")
  - frontend/src/routes/(protected)/back-office/kitchen/receive-stock/[session_id]/+page.svelte (ถ้าแสดงรหัส)
  - tests: kitchen domain/remote tests
---

# เลขรันอ้างอิง RCV-KITCHEN-NNNN ให้ meal_service

**สรุป (TL;DR)**
- เพิ่ม field `receipt_no` (opt) ใน `meal_service` เป็นเลขรันต่อศูนย์ รูปแบบ `RCV-KITCHEN-0001` ออกตอนบันทึกผลผลิต
- เพื่อให้ครัวและคลังอ้างอิงรายการรับอาหารปรุงเสร็จเข้าคลังได้ตรงกัน แทนรหัสที่หน้าจอประกอบจาก ULID (`RCV-MASNS4`)
- dev สร้างฟังก์ชันออกเลข, ใส่ใน `createMealService`/`recordMealService`, ให้ UI ใช้ `receipt_no` และ fallback เป็นรหัสเดิมเมื่อไม่มี
- schema: additive optional field ใน §2.7, ไม่ backfill doc เดิม

## Requirements

- **FR-1** — `meal_service` มี field `receipt_no: str` (opt) รูปแบบ `RCV-KITCHEN-` + เลข 4 หลัก zero-pad (`RCV-KITCHEN-0001`); เกิน 9999 ให้ขยายหลักตามธรรมชาติ (`RCV-KITCHEN-10000`)
- **FR-2** — `recordMealService` ต้องออก `receipt_no` = (เลขสูงสุดของ `receipt_no` ที่ขึ้นต้น `RCV-KITCHEN-` ใน `meal_service` ทั้งหมดของ `shelter_{code}`) + 1; ไม่มีเลยเริ่มที่ `0001`
- **FR-3** — การออกเลขใช้วิธีเดียวกับ `nextTicketNo` (scan + max + 1, ไม่ atomic): ชนกันได้เมื่อบันทึกพร้อมกัน — ยอมรับได้ เพราะ `receipt_no` เป็นป้ายแสดงผล ไม่ใช้เป็น identity/lookup/ยอดคงเหลือ (`_id` ยังเป็น identity)
- **FR-4** — บันทึกใหม่หลังถูกคลังตีกลับ (CR-145) เป็น `meal_service` doc ใหม่ จึงได้ `receipt_no` ใหม่ ไม่ใช้เลขเดิมซ้ำ
- **FR-5** — `meal_service` ยังเป็น append-only: ห้ามเขียน `receipt_no` ภายหลังให้ doc ที่สร้างไปแล้ว
- **FR-6** — UI ที่แสดงรหัสรายการรับเข้า (คอลัมน์ "รหัส" ใน `ticket-list.svelte` และหน้าที่แสดงรหัสเดียวกัน) แสดง `receipt_no` เมื่อมี; ไม่มีให้แสดงรหัสเดิม `RCV-{6 ตัวท้ายของ _id ตัวพิมพ์ใหญ่}`
- **FR-7** — Zod/type ของ `MealService` รับ `receipt_no` เป็น optional string; doc ที่ไม่มี field ยัง parse ผ่าน

## Acceptance

- บันทึกผลผลิตครั้งแรกของศูนย์ได้ `receipt_no = RCV-KITCHEN-0001`; ครั้งถัดไป `0002`
- มี doc เก่าไม่มี `receipt_no` ปนอยู่ → เลขใหม่นับจากเลขสูงสุดที่มี ไม่สนใจ doc เก่า
- doc เก่าแสดง `RCV-XXXXXX` ตามเดิม, doc ใหม่แสดง `RCV-KITCHEN-NNNN`
- บันทึกใหม่หลังถูกตีกลับได้เลขถัดไป ไม่ซ้ำเลขเดิม
- unit test ครอบ: ฟังก์ชันออกเลข (ว่าง, มีเลข, มี prefix อื่นปน, เลขเสีย), `createMealService` ใส่ `receipt_no`, remote `recordMealService` ส่งเลขถูก

## Why

- หน้าคิวตั๋วครัวแสดงรายการรับอาหารเข้าคลังเป็น `RCV-` + 6 ตัวท้ายของ ULID ซึ่งประกอบขึ้นตอนแสดงผล: ไม่เรียงลำดับ, ค้นในฐานข้อมูลไม่ได้, ไม่มีใน spec
- ฝั่งเบิกวัตถุดิบมีเลขรัน `TKT-KITCHEN-NNNN` อยู่แล้ว (§2.29 `ticket_no`) — ฝั่งรับเข้าควรอ้างอิงได้แบบเดียวกัน

## Change

| | Before | After |
| --- | --- | --- |
| `meal_service.receipt_no` | ไม่มี | `str` opt, `RCV-KITCHEN-NNNN` ออกตอนสร้าง |
| รหัสใน UI | `RCV-{_id[-6:]}` เสมอ | `receipt_no` ถ้ามี, ไม่มีใช้แบบเดิม |
| `validate_doc_update` | — | ไม่เปลี่ยน (ไม่มี rule ราย field ของ `meal_service`) |

## Impact

- **Docs:** `docs/data/schema.md` §2.7 เพิ่มแถว `receipt_no` + หมายเหตุ CR นี้; อัปเดต `updated:`
- **Code:** kitchen domain (type, factory, ฟังก์ชันออกเลข), kitchen data (`recordMealService`), tickets UI (`ticket-list.svelte`), หน้า receive-stock ถ้าแสดงรหัส
- **Public plane / worker:** ไม่กระทบ — `meal_service` ไม่ถูก project ไป Mongo
- **e2e:** `frontend/e2e/kitchen-meal.test.ts` ไม่ assert รหัส RCV — ไม่กระทบ

## Migration

- Additive optional field — doc เดิมไม่มี `receipt_no` ยังอ่านได้, **ไม่ backfill** (append-only; UI fallback เป็นรหัสเดิมตาม FR-6)
- `schema_v` คง 2 ตาม precedent CR-084/CR-121 ของ §2.7 (field optional ไม่ bump)

## Decision log

- 2026-10-21 — proposed. เลือก: track ด้วย CR ไฟล์, รูปแบบ `RCV-KITCHEN-0001`, doc เดิมแสดงรหัสแบบเดิม (ไม่ backfill)
- 2026-10-21 — approved โดย kong
- 2026-10-21 — done: implement ใน frontend kitchen (`nextReceiptNo`, `mealServiceRef`) + tickets ticket-list
- 2026-10-21 — `schema_v` ไม่ bump: §2.7 เคยเพิ่ม field optional (`actual_yield` CR-084, `yield_items` CR-121) โดยไม่ bump — คงแนวเดียวกัน
