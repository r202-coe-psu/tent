---
id: CR-179
title: ให้ warehouse_staff / supply_coordinator อนุมัติตั๋วเบิกจ่ายพัสดุและอาหาร (Step 2) ได้
status: approved
date: 2026-10-21
requested_by: kong
decided_by: kong
layer: volatile
affects:
  - docs/changes/03-C-supply/CR-121-spec-ticket.md FR-SEC-01 Step 2
  - schema_v ไม่เปลี่ยน
  - frontend/src/lib/features/distribution/application/food-supplies/auth.ts (`canApproveTicket`)
  - frontend/src/lib/features/distribution/ui/back-office/TicketActionPanel.svelte
  - frontend/src/lib/server/shelter-access-design.ts (rule 12 `canApproveTicket`)
---

# ให้ warehouse_staff / supply_coordinator อนุมัติตั๋วเบิกจ่ายพัสดุและอาหารได้

**สรุป (TL;DR)**
- ตั๋วเบิกจ่าย `requisition_type` `food`/`supplies`/`transfer`: transition `PENDING_PICK→READY_FOR_DISPATCH` (Step 2 "อนุมัติให้ปล่อยของ") อนุญาตเพิ่ม `warehouse_staff` และ `supply_coordinator`
- ปุ่มยังแยก: "จัดสรรยอดสินค้า" แล้วค่อย "อนุมัติให้ปล่อยของ" — ไม่รวมคลิก
- แก้ทั้ง UI guard (`canApproveTicket`) และ VDU rule 12 แล้ว redeploy `_design/access`; ไม่เปลี่ยน schema

## Requirements

- **FR-1** — `canApproveTicket` (UI/application) คืน true สำหรับ `system_admin`, `shelter_manager`, `warehouse_staff`, `supply_coordinator` ของศูนย์ที่ active
- **FR-2** — VDU rule 12 (`requisition_ticket` non-kitchen) `PENDING_PICK→READY_FOR_DISPATCH`: อนุญาต role เดียวกับ FR-1; `approved_by` ต้องตรงกับผู้ใช้เหมือนเดิม; ข้อความ forbidden อัปเดตตาม
- **FR-3** — `TicketActionPanel` แสดงปุ่ม "อนุมัติให้ปล่อยของ" ให้ role ตาม FR-1; เงื่อนไขพร้อมอนุมัติ (`approvalReadiness`) ใช้เหมือนเดิม
- **FR-4** — ไม่เปลี่ยน Step อื่นของ FR-SEC-01 และไม่เปลี่ยน kitchen carve-out (§2.29 — กำหนดแยกแล้ว decision sync 2026-10-21)

## Acceptance

- ผู้ใช้ `warehouse_staff` จัดสรรยอดแล้วเห็นและกด "อนุมัติให้ปล่อยของ" ได้ → ตั๋วเป็น "พร้อมส่งออก"
- `kitchen_staff` / `registration_staff` ยังอนุมัติไม่ได้ (UI ซ่อน, VDU ปฏิเสธ)
- unit test `canApproveTicket` + VDU test ครอบ role ที่อนุญาต/ไม่อนุญาต

## Why

- หน้างาน: คลังจัดสรรยอดแล้วไปต่อไม่ได้ ต้องรอผู้จัดการศูนย์ ทั้งที่คนคลังเป็นคนปล่อยของ (Step 3) อยู่แล้ว — หน้าจอไม่มีปุ่มหรือข้อความบอกให้ไปต่อ
- ให้สอดคล้องกับตั๋วเบิกวัตถุดิบครัว ที่ `warehouse_staff` อนุมัติได้แล้ว (schema.md §2.29, decision sync 2026-10-21)

## Change

| | Before | After |
| --- | --- | --- |
| FR-SEC-01 Step 2 (CR-121) | `shelter_manager`, `system_admin` | + `warehouse_staff`, `supply_coordinator` |
| ปุ่ม | จัดสรร → อนุมัติ (แยก) | เหมือนเดิม |

## Impact

- CR-121 FR-SEC-01 Step 2 — เพิ่มหมายเหตุอ้าง CR-179
- code: distribution auth + UI panel, VDU rule 12 + tests; ต้อง redeploy `_design/access`
- การแยกหน้าที่ (คนจัดสรร ≠ คนอนุมัติ) ของตั๋วเบิกจ่ายไม่บังคับแล้ว — ยอมรับตามการตัดสินใจนี้

## Migration

N/A — ไม่มีการเปลี่ยนรูปร่างเอกสาร

## Decision log

- 2026-10-21 — proposed: คงปุ่มแยก (จัดสรร → อนุมัติ) ไม่รวมคลิกแบบครัว เพื่อเปลี่ยน workflow น้อยที่สุด
- 2026-10-21 — approved โดย kong
