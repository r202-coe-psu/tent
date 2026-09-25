---
id: CR-126
title: เจาะจง lifecycle/role/backward-compat ของ RequisitionTicket ประเภท `kitchen` (ส่วนขยาย CR-121) + รวม CR-120 fuel_cylinder migration เข้าเป็นงานเดียวกัน
status: approved
date: 2026-09-21
updated: 2026-09-21
requested_by: Project Owner (session Implement Kitchen Ticket)
decided_by: Project Owner
layer: stable
supersedes: []
extends:
  - CR-121 (RequisitionTicket 4-in-1 — เจาะจงพฤติกรรมของ requisition_type: 'kitchen' โดยเฉพาะ ไม่กระทบ food/supplies/transfer)
  - CR-120 (fuel_cylinder — ระบุว่างานเบิกครัวรอบนี้ต้อง migrate `gas_cylinder_type`/`gas_ledger` ไปเป็น `fuel_cylinder` พร้อมกัน แทนที่จะปล่อยค้างไว้)
affects:
  - docs/changes/CR-121-spec-ticket.md (เพิ่มหมายเหตุ: lifecycle ของ `kitchen` เป็น subset 4 สถานะ)
  - docs/data/schema.md §2.29 (`requisition_ticket` — เพิ่มหมายเหตุ valid status ต่อ `requisition_type`)
  - docs/data/schema.md §2.6 (`kitchen_requisition` — ทำเครื่องหมาย deprecated, read-only หลัง cutover)
  - docs/data/schema.md §2.7.1/§2.7.2 (`fuel_cylinder` — ยืนยันเป็น target ของ migration รอบนี้)
  - frontend/src/lib/features/tickets/** (ใหม่)
  - frontend/src/lib/features/kitchen/** (cutover)
  - frontend/src/lib/features/operations/domain/operations.ts
  - frontend/src/lib/server/shelter-access-design.ts
---

# CR-126: เจาะจง lifecycle/role/backward-compat ของ RequisitionTicket ประเภท `kitchen` + รวม fuel_cylinder migration

## 1. Why

CR-121 (อนุมัติแล้ว) กำหนด `RequisitionTicket` แบบรวมศูนย์ 4 ประเภท (`kitchen`/`food`/`supplies`/`transfer`)
ด้วย status enum 9 ค่าเดียวกันทั้งหมด (รวม `DISTRIBUTING`/`SHIFT_CLOSED`/`RETURN_PENDING_RECEIPT`/`RETURN_COMPLETED`
ซึ่งออกแบบมาสำหรับ POS แจกจ่ายหน้างาน) แต่ตอนเริ่มพัฒนาจริงเฉพาะ slice `kitchen` (ดู
`_bmad-output/implementation-artifacts/spec-central-kitchen-use-item-master.md`) พบว่า 4 สถานะท้าย
ไม่มีความหมายกับครัว (ครัวไม่ได้ "แจกจ่ายหน้างาน" หรือ "ปิดรอบคืนของ") — ถ้าไม่เจาะจงไว้ก่อนจะทำให้
implementation แต่ละคนตีความ subset ต่างกัน

นอกจากนี้ยังมีการตัดสินใจ 3 เรื่องที่กระทบ business rule/schema ของ CR-121 และ CR-120 ที่ต้องบันทึกไว้
ก่อนเขียนโค้ด ตามนโยบาย `docs/change-management.md` §2

## 2. Change (ตัดสินใจ 4 เรื่อง)

### 2.1 Kitchen lifecycle เป็น subset 4 สถานะ (ไม่ใช่ 9 สถานะเต็ม)

สำหรับ `requisition_ticket` ที่ `requisition_type: 'kitchen'` เท่านั้น — สถานะที่ใช้ได้จริงมีแค่:

```
PENDING_PICK → READY_FOR_DISPATCH → IN_TRANSIT → COMPLETED
```

(บวก `CANCELLED` ได้ทุกจุดก่อน `IN_TRANSIT`) ห้าม transition ไป `DISTRIBUTING`/`SHIFT_CLOSED`/
`RETURN_PENDING_RECEIPT`/`RETURN_COMPLETED` สำหรับตั๋วประเภทนี้ — สถานะกลุ่มนั้นสงวนไว้เฉพาะ
`food`/`supplies` ตาม CR-121 เดิม `transfer` ยังคง 7 สถานะเต็มตาม CR-121 (ไม่เปลี่ยน)

UI หน้าตั๋วครัว (`/back-office/tickets/[id]` เมื่อ `requisition_type==='kitchen'`) แสดง stepper แบบย่อ
4 ขั้น ไม่ใช่ stepper 7 ขั้นเหมือนตั๋วอื่น (ต่างจาก prototype Google AI Studio ที่ใช้ stepper
7 ขั้นเดียวกันทุกประเภทเพื่อความง่ายในการทำ mockup — โค้ดจริงจะแยกตาม `requisition_type`)

"COMPLETED" ของ kitchen ตัวเดียว เทียบเท่ากับตอนที่ครัวกดยืนยันรับวัตถุดิบจากคลัง (`received_by` ถูกบันทึก)
ไม่มีขั้นตอนคืนวัตถุดิบเหลือกลับคลังใน scope นี้ (ถ้าจะทำ ต้องเปิด CR ใหม่ต่างหาก)

### 2.2 Role แยกเต็มรูป ไม่มี self-approve/bypass

`kitchen_staff` เปิดตั๋วได้อย่างเดียว (และยืนยันรับของตอน `IN_TRANSIT` + บันทึกผลผลิต) —
**ไม่มีสิทธิ์อนุมัติหรือ bypass เป็นของตัวเองอีกต่อไป** ต่างจาก production-board wizard ปัจจุบัน
(Stage B) ที่ครัวกดอนุมัติ/bypass เองในหน้าเดียวได้ ต้องรื้อ Stage B ออกจาก wizard และให้ครัวรอ
สถานะจาก `warehouse_staff` (จัดของ/ส่งของ) และ `shelter_manager`/`system_admin` (อนุมัติ) ตาม
FR-SEC-01 ของ CR-121 เป๊ะ ไม่มีทางลัดสำหรับศูนย์เล็ก

### 2.3 Backward-compat ของ `kitchen_requisition` เดิม — union read-only

หลัง cutover: **ห้ามสร้าง `kitchen_requisition` ใหม่อีก** (ตัด `issueRequisition`,
`createPendingRequisition`, `approveKitchenRequisition` ออกจาก write path ที่ยังเปิดใช้งาน)
แต่หน้า "ประวัติเบิก" (`requisition-history.svelte` หรือหน้าใหม่ที่แทนที่) ต้องแสดง**รวมกัน**
(union, read-only) ทั้งเอกสาร `kitchen_requisition` เก่ากับ `requisition_ticket`
(`requisition_type: 'kitchen'`) ใหม่ เรียงตามเวลาเดียวกัน — ตรงตาม FR-SEC-02/AC-SEC-02.1 ของ
CR-121 ที่บังคับว่าอ่านประวัติเก่าต้องสมบูรณ์ ไม่ใช่แยกหน้าไปคนละที่

### 2.4 รวม CR-120 fuel_cylinder migration เข้าเป็นงานเดียวกัน

CR-120 (อนุมัติแล้ว) กำหนด `fuel_cylinder` ไว้แทน `gas_cylinder_type`/`gas_ledger` เดิม แต่ยังไม่มี
โค้ดไหน migrate จริง (0 hit ทั้ง repo ณ วันที่เขียน CR นี้) เนื่องจากตั๋วครัวต้องมี `gas_drawdown`
snapshot ตอน dispatch และ schema.md §2.7.1 ผูกไว้กับ `fuel_cylinder` แล้ว — **ตัดสินใจ migrate
`gas_cylinder_type` → `fuel_cylinder` พร้อมกันในงานนี้** แทนที่จะสร้างตั๋วใหม่บนโมเดลแก๊สเก่าที่
กำลังจะถูกแทนที่อยู่ดี (ป้องกันการเขียนโค้ดซ้อนสองรอบ)

## 3. ผลกระทบ

- ไม่กระทบ `food`/`supplies`/`transfer` ticket type ของ CR-121 — สถานะ/role ของ 3 ประเภทนั้นยังเป็นไปตาม
  CR-121 เดิมทุกประการ (ยังไม่ implement ในรอบนี้)
- ไม่ bump `schema_v` ของ `requisition_ticket` (ยังคง 1 ตาม CR-121) — การจำกัด subset สถานะเป็นเพียง
  business-rule ระดับ application (validate ใน domain/repository) ไม่ใช่ shape เปลี่ยน
- `kitchen_requisition` เปลี่ยนจาก "active doc type" เป็น "deprecated, read-only" — schema.md §2.6
  ต้องอัปเดต note บอกสถานะนี้
- ขยายสโคปงานปัจจุบันให้รวม CR-120 gas migration (~18 ไฟล์) เข้าไปด้วย

## 4. Rollback

หากพบปัญหาหลัง merge — ตั๋วครัวเป็น additive doc type ใหม่ทั้งหมด (`requisition_ticket`) ไม่แตะ
`kitchen_requisition` เดิม (ยังอ่านได้) จึง rollback ได้โดยปิด feature flag/ไม่เปิดใช้เส้นทางใหม่ ข้อมูล
เก่าไม่เสียหาย ส่วน `fuel_cylinder` migration ต้องเตรียม data migration script คู่กัน (ยังไม่ระบุรายละเอียด
ในเอกสารนี้ — จะระบุใน implementation plan `z-05-D/kitchen-requisition-ticket-plan.md`)
