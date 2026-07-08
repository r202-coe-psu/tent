---
id: CR-035
title: Evacuee stay status v3 + movement action expansion for scan check-in/out
status: done
date: 2026-07-08
requested_by: development team B
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §1.1, §1.4, §2.5
  - schema_v evacuee 2 -> 3
  - frontend/src/lib/features/people/{domain,data,application,ui}
  - frontend/src/lib/features/dashboard/domain/occupancy.schema.ts
---

# CR-035 — Evacuee stay status v3 + movement action expansion for scan check-in/out

## Why
ต้องรองรับ flow สแกนเข้า-ออกศูนย์ (T-51) และสถานะการพักพิงที่ละเอียดขึ้นใน UI v5 โดย enum เดิม
ของ `current_stay.status` มี 4 ค่า ไม่พอสำหรับกรณี "ลงทะเบียนล่วงหน้า", "ออกชั่วคราว" และ
"เสียชีวิต" รวมถึง movement action เดิมยังไม่ครอบคลุม transition ใหม่ ทำให้ dashboard occupancy
และ flow scan/check-in/out ไม่สอดคล้องกับพฤติกรรมจริง

## Change
- Evacuee `current_stay.status` เปลี่ยนเป็น 6 ค่า:
  `pre_registered`, `active`, `temporary_leave`, `transferred`, `checked_out`, `deceased`
- ขยาย `movement.action` เป็น:
  `check_in`, `check_out`, `transfer_out`, `transfer_in`, `leave_temporary`,
  `return_from_leave`, `mark_deceased`
- ปรับ mapping occupancy/headcount ให้ใช้ `active` แทน `checked_in`
- ระบุ migration note สำหรับการอ่านข้อมูลเก่า (`registered` -> `pre_registered`,
  `checked_in` -> `active`)

## Impact
- `docs/data/schema.md`:
  - อัปเดต `evacuee.current_stay.status` และ migration note (schema_v 3)
  - อัปเดต `movement.action` และผลต่อสถานะปลายทาง
  - อัปเดต occupancy mapping (CR-022) ให้ derive จาก `active`
- `frontend/src/lib/features/people/domain/people.ts`:
  - ปรับ `StayStatus`, `MovementAction`, และ transition mapping ใน `applyMovementToStay`
- `frontend/src/lib/features/people/ui/*`:
  - ปรับ label/สีสถานะและปุ่ม action ใน flow scan + profile + search
- `frontend/src/lib/features/dashboard/domain/occupancy.schema.ts` และ API/tests:
  - ปรับ payload เป็น 6 สถานะใหม่พร้อม total aggregation

## Migration
- Evacuee schema_v 2 -> 3:
  - read-time map: `registered` -> `pre_registered`, `checked_in` -> `active`
  - ค่าเดิม `checked_out` คงไว้ชั่วคราวจน manual review แยกเคสที่ควรเป็น `transferred`
  - ไม่มี legacy map ไป `temporary_leave`/`deceased` (เกิดจาก action ใหม่เท่านั้น)

## Decision log
- 2026-07-08 — proposed
- 2026-07-08 — done
