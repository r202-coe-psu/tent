---
id: CR-127
title: อนุญาตให้ครัวแก้ไขตั๋วเบิกวัตถุดิบ (requisition_ticket ประเภท kitchen) และ meal_plan ที่ผูกกันได้ ขณะตั๋วยัง PENDING_PICK
status: approved
date: 2026-09-24
updated: 2026-09-24
requested_by: Project Owner (session ปรับ UI production-board)
decided_by: Project Owner
layer: volatile
supersedes: []
extends:
  - CR-121 (RequisitionTicket 4-in-1 — เพิ่ม transition ใหม่สำหรับ `requisition_type: 'kitchen'` เท่านั้น ไม่กระทบ food/supplies/transfer)
  - CR-126 (Kitchen ticket lifecycle carve-out — ยืนยันว่าการแก้ไขนี้ไม่ใช่ "self-approve/bypass" ตาม §2.2 เพราะยังไม่แตะ `allocated_qty`/สถานะอนุมัติ เป็นแค่การแก้ไขคำขอของตัวเองก่อนคลังเริ่มจัดของ)
affects:
  - frontend/src/lib/features/tickets/domain/ticket.ts (ฟังก์ชันใหม่ `updateTicketRequestedItems`)
  - frontend/src/lib/features/tickets/data/ticket.repository.ts + ticket.remote.ts (method ใหม่ `updateTicketItems`)
  - frontend/src/lib/features/tickets/application/queries.ts (hook ใหม่ `useUpdateTicketItems`)
  - frontend/src/lib/features/kitchen/data/kitchen.repository.ts + kitchen.remote.ts (method ใหม่สำหรับแก้ meal_plan ที่ status เป็น `confirmed` แล้ว — แยกจาก `updateMealPlanDraft` เดิมที่บังคับ `draft` เท่านั้น)
  - frontend/src/routes/(protected)/back-office/kitchen/production-board/[session_id]/+page.svelte (ปุ่ม "บันทึกการแก้ไข" ใน Stage A เมื่อ `activePlan` มีอยู่แล้ว)
---

# CR-127: แก้ไขตั๋วเบิกวัตถุดิบครัวและ meal_plan ที่ผูกกันได้ ขณะตั๋วยัง PENDING_PICK

## 1. Why

หน้า Production Board (`/back-office/kitchen/production-board/[session_id]`) กด "สร้างตั๋วเบิก" แล้ว
พา user เข้า Stage B ทันที แต่ 3-step stepper (Stage A/B/C) ยังปล่อยให้กลับมาที่ Stage A เพื่อแก้ไข
เมนู/กลุ่มเป้าหมาย/วัตถุดิบได้เสมอ (ไม่มี guard ปิดปุ่ม) — ก่อนหน้านี้กดกลับมาแล้วไม่มีปุ่มบันทึกอะไรเลย
เพราะ:

1. `meal_plan` ที่มีตั๋วอ้างอิงแล้วถูก confirm อัตโนมัติตอนสร้างตั๋ว (`ticket.remote.ts` createTicket)
   และ `updateMealPlanDraft` มี guard ชัดเจนว่า **"only draft plans can be edited"** — เรียกกับ plan
   ที่ confirmed แล้วจะ throw เสมอ
2. ตั๋ว (`requisition_ticket`) เองก็ไม่มี transition ไหนแก้ `requested_qty`/รายการ item ได้เลย —
   มีแค่ `allocateTicketItem` (คลังใส่ยอดที่จัดจริงตอน `allocated_qty`, ใช้ได้เฉพาะ `PENDING_PICK`)

ผลคือครัวพิมพ์จำนวน/รายการผิดตอนสร้างตั๋วแล้ว **แก้เองไม่ได้เลย** ต้องยกเลิกตั๋วทั้งใบแล้วสร้างใหม่
ซึ่งเสียเวลาและตัดขาดความต่อเนื่องของ session เดิม

## 2. Change

เพิ่ม transition ใหม่ **เฉพาะขณะตั๋วยัง `PENDING_PICK`** (คลังยังไม่เริ่มจัดของ/อนุมัติ):

### 2.1 `updateTicketRequestedItems` (ticket domain ใหม่)

แก้ `items[].requested_qty` (และเพิ่ม/ลบ/แก้ item ได้) ของ `requisition_ticket` ที่
`requisition_type: 'kitchen'` — throw ถ้า `ticket.status !== 'PENDING_PICK'` (เลียนแบบ guard เดียวกับ
`allocateTicketItem`) รายการเดิมที่ item_id ตรงกันคง `allocated_qty` เดิมไว้ (ยังไม่มีใครแตะ), item
ใหม่เริ่มที่ `allocated_qty: '0'` เหมือนตอนสร้างตั๋วครั้งแรก

**ไม่ใช่ self-approve/bypass ตาม CR-126 §2.2** — ฟังก์ชันนี้ไม่แตะ `status`/`approved_by`/
`allocated_qty` ของรายการเดิม เป็นแค่ครัวแก้คำขอของตัวเองก่อนคลังเริ่มทำงานกับตั๋วนั้น

### 2.2 แก้ `meal_plan` ที่ status เป็น `confirmed` แล้วได้ (จำกัดเงื่อนไข)

เพิ่ม repository method ใหม่ (ชื่อทำงานจริงกำหนดตอน implement — ไม่ใช่แก้ `updateMealPlanDraft` เดิม
เพราะ guard เดิมต้องคงไว้สำหรับ caller อื่น) ที่แก้ `label`/`target_tags`/`allocated_target`/
`headcount`/`recipes`/`gas_usage` ของ `meal_plan` ได้ **เมื่อตั๋วที่ผูกกันยัง `PENDING_PICK` เท่านั้น**
(เช็คที่ชั้น UI ก่อนเรียก + ปล่อยให้การเรียก `updateTicketRequestedItems` ควบคู่กันเป็นตัวบังคับจริง
ถ้าสถานะตั๋วเปลี่ยนไปแล้วระหว่างนั้น ฝั่งตั๋วจะ throw ก่อน ไม่กระทบ plan)

หน้า production-board บันทึกการแก้โดยเรียก **ตั๋วก่อน แผนทีหลัง** (ตั๋ว throw ได้เร็วกว่าถ้าสถานะไม่ตรง
กัน ป้องกันไม่ให้ plan ถูกแก้ไปโดยตั๋วไม่ sync ตาม)

## 3. Impact

- ไม่ bump `schema_v` ของ `requisition_ticket` หรือ `meal_plan` — ฟิลด์ที่แก้ (`requested_qty`,
  `label`, `target_tags`, `allocated_target`, `recipes`, `gas_usage`) มีอยู่ในสคีมาเดิมแล้วทั้งหมด
  เปลี่ยนแค่ "อนุญาตให้แก้เมื่อไร" ไม่ใช่รูปร่างของ doc
- ไม่กระทบตั๋วประเภท `food`/`supplies`/`transfer` (ยังใช้ 7 สถานะเต็มตาม CR-121/CR-126 เดิม)
- ถ้าตั๋วเลย `PENDING_PICK` ไปแล้ว (คลังเริ่มจัดของ/อนุมัติ) ปุ่ม "บันทึกการแก้ไข" ต้องซ่อนหรือ disable
  ที่ Stage A — ครัวต้องประสานงานนอกระบบ (โทร/วิทยุ) ให้คลังแก้ผ่าน "เติมของระหว่างแจก" (CR-121 §3.3)
  แทน ไม่เปิดช่องแก้ทับ `allocated_qty` จากฝั่งครัว
