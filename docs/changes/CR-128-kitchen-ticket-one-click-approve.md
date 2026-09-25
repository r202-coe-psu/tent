---
id: CR-128
title: ตั๋วเบิกวัตถุดิบครัว (requisition_ticket ประเภท kitchen) อนุมัติจบในคลิกเดียว — ยกเลิกการแยก 3 บทบาทของ CR-126 §2.2 เฉพาะตั๋วประเภทนี้
status: approved
date: 2026-09-25
updated: 2026-09-25
requested_by: Project Owner (session ปรับ UI ticket-detail)
decided_by: Project Owner
layer: volatile
supersedes:
  - CR-126 §2.2 ("Role แยกเต็มรูป ไม่มี self-approve/bypass") — เฉพาะส่วนที่บังคับ 3 บทบาทแยกกัน
    (ผจก.อนุมัติ / คลังปล่อยของ / ครัวยืนยันรับ) สำหรับ `requisition_type: 'kitchen'` เท่านั้น
    ส่วนอื่นของ CR-126 (lifecycle 4 สถานะยังมีอยู่ในข้อมูลเก่า, backward-compat union,
    fuel_cylinder migration) ไม่เปลี่ยน
extends:
  - CR-121 (RequisitionTicket 4-in-1 — ไม่กระทบ food/supplies/transfer ยังคง 7 สถานะเต็มและ role
    แยกตามเดิม)
affects:
  - frontend/src/lib/features/tickets/domain/ticket.ts (ฟังก์ชันใหม่ `oneStepApproveTicket`)
  - frontend/src/lib/features/tickets/data/ticket.repository.ts + ticket.remote.ts (method ใหม่
    `oneStepApproveTicket` — ใช้ stock-check/deduct logic เดียวกับ `dispatchTicket` เดิม)
  - frontend/src/lib/features/tickets/application/queries.ts (hook ใหม่ `useOneStepApproveTicket`)
  - frontend/src/lib/features/tickets/ui/ticket-detail.svelte (ปุ่มเดียว แทน 3 ปุ่มแยกขั้น)
---

# CR-128: ตั๋วเบิกวัตถุดิบครัว อนุมัติจบในคลิกเดียว

## 1. Why

CR-126 §2.2 ("Role แยกเต็มรูป ไม่มี self-approve/bypass") เคาะไว้ว่าตั๋วครัวต้องผ่าน 3 บทบาทแยกกัน
ตาม FR-SEC-01 ของ CR-121: ผู้จัดการอนุมัติ (`PENDING_PICK → READY_FOR_DISPATCH`) → คลังปล่อยของ
(`READY_FOR_DISPATCH → IN_TRANSIT`) → ครัวยืนยันรับ (`IN_TRANSIT → COMPLETED`) — เพื่อไม่ให้ครัวลัดขั้นตอนอนุมัติของตัวเอง

ตอนใช้งานจริงพบว่า 3 ขั้นตอนนี้ (พร้อมกับต้องกด "บันทึก" ทีละรายการวัตถุดิบก่อนจะอนุมัติได้)
ยืดเยื้อเกินความจำเป็นสำหรับศูนย์ขนาดเล็ก/กลางที่คนคนเดียวมีสิทธิ์ทำได้ทุกขั้นตอนอยู่แล้ว (system_admin/
shelter_manager) เจ้าของโครงการ (ผู้เคาะ CR-126 เดิม) ตัดสินใจกลับคำเฉพาะจุดนี้: ให้กดอนุมัติครั้งเดียว
จบเลย ไม่ต้องกดแยกทีละขั้น — ระบุชัดว่ายกเลิกเฉพาะข้อ 2.2 ของ CR-126 (ไม่แตะข้ออื่น)

## 2. Change

### 2.1 ตั๋วครัว (requisition_type: 'kitchen') อนุมัติจบในคลิกเดียว

เพิ่ม transition ใหม่ `oneStepApproveTicket`: จาก `PENDING_PICK` ตรงไป `COMPLETED` ในการเรียกครั้งเดียว
— ทำสิ่งที่ 3 transition เดิม (`approveTicket` + `markTicketDispatched` + `receiveTicket`) ทำรวมกัน:

1. Auto-allocate ทุกรายการเป็นยอดเท่ากับ `requested_qty` (ไม่ต้องกด "บันทึก" ทีละแถวอีกต่อไป)
2. ตรวจสต็อกคงเหลือพอหรือไม่ก่อนเขียนอะไรทั้งหมด (all-or-nothing เหมือน `dispatchTicket` เดิม)
3. เขียน `stock_ledger` ตัดสต็อกจริง (`reason: requisition`, `ref_id: ticket._id`) — **ไม่ข้ามขั้นตัดสต็อก**
   เพียงแค่รวมเข้าเป็น transaction เดียวกับการเปลี่ยนสถานะ
4. บันทึก `approved_by`, `dispatched_by`, `received_by` เป็นผู้กดคนเดียวกันทั้ง 3 ฟิลด์ (audit trail
   ยังคงอยู่ครบ รู้ว่าใครกดและกดเมื่อไร แค่ไม่ใช่ 3 คนแยกกัน)

### 2.2 ตั๋วเก่าที่ค้างอยู่ใน READY_FOR_DISPATCH/IN_TRANSIT ยังทำงานได้ตามเดิม

ตั๋วที่สร้างก่อน CR นี้ (ถ้ามีค้างอยู่คนละสถานะ) ยังใช้ปุ่ม "ปล่อยของ"/"ยืนยันรับ" เดิมได้ตามปกติ — ไม่
migrate/บังคับเปลี่ยนข้อมูลเก่า UI แสดงปุ่มตามสถานะจริงของตั๋วนั้นๆ (`PENDING_PICK` → ปุ่มใหม่คลิกเดียว,
สถานะอื่นที่ค้างอยู่ → ปุ่มเดิม)

### 2.3 ไม่กระทบตั๋วประเภทอื่น

`food`/`supplies`/`transfer` (ยังไม่ implement หรือ implement แยกใน CR อื่น) ไม่เปลี่ยน ยังคง 7/9
สถานะเต็มตาม CR-121 เดิมถ้าถูก implement ในอนาคต

## 3. Impact

- ไม่ bump `schema_v` — ฟิลด์ที่เขียน (`status`, `approved_by`, `dispatched_by`, `received_by`,
  `items[].allocated_qty`) มีอยู่ในสคีมาเดิมแล้วทั้งหมด เปลี่ยนแค่จำนวนคลิกที่ต้องใช้ ไม่ใช่รูปร่าง doc
- CR-127 (แก้ไขตั๋วขณะ PENDING_PICK) ยังใช้ได้ตามเดิม — ถ้าตั๋วเปลี่ยนเป็น COMPLETED ไปแล้วในคลิกเดียว
  จะแก้ไม่ได้เหมือนก่อนหน้านี้ (ตาม guard เดิมของ `updateTicketRequestedItems`/`updateConfirmedMealPlan`
  ที่ต้องเป็น PENDING_PICK) — ต้องแก้ก่อนกดอนุมัติ ไม่ใช่หลัง
