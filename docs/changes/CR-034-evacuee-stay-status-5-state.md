---
id: CR-034
title: Evacuee `current_stay.status` — เปลี่ยนเป็น 6 สถานะ (Pre-registered/Active/Temporary Leave/Transferred/Checked-out/Deceased) ตาม UI v5
status: proposed
date: 2026-07-07
requested_by: UI v5 design
decided_by: project owner
layer: volatile
affects:
  - docs/data/schema.md §1.1 (evacuee.current_stay.status)
  - docs/data/schema.md §1.4 (movement.action)
  - schema_v (evacuee) — bump ต้องรอเคาะ
  - frontend/src/lib/features/people/domain/people.ts (stayStatusSchema, MovementAction, statusByAction)
  - frontend/src/lib/features/people/ui/evacuee-profile-view.svelte (statusConfig)
  - frontend/src/lib/features/people/ui/evacuee-status-modal.svelte
  - frontend/src/lib/features/people/data/people.pouch.ts, people.repository.ts
  - frontend/src/lib/features/dashboard/domain/occupancy.schema.ts (headcount filter บน checked_in)
  - frontend/src/lib/features/kitchen/domain/occupancy.ts (headcount filter บน checked_in)
  - frontend/src/lib/features/shelters/domain/views.ts
---

# CR-034 — Evacuee stay status: 6-state model

> [!NOTE]
> **สรุป (TL;DR):** เปลี่ยน enum `evacuee.current_stay.status` จาก 4 ค่า
> (`registered`,`checked_in`,`checked_out`,`transferred`) เป็น 6 ค่าตาม UI v5:
> `pre_registered`,`active`,`temporary_leave`,`transferred`,`checked_out`,`deceased` · เพิ่มสถานะใหม่
> 3 ค่า (`temporary_leave`, `checked_out` ความหมายใหม่ = ย้ายออก/กลับภูมิลำเนา, `deceased`) · กระทบ
> headcount/occupancy ที่ filter ด้วย `checked_in` เดิมในหน้า dashboard และครัว ต้องแก้พร้อมกัน

## Why

UI v5 กำหนดสถานะการพักพิงของ evacuee เป็น 6 สถานะที่มีความหมายเฉพาะเจาะจงกว่าเดิม แทนสถานะทั่วไป
4 ค่าที่ใช้อยู่ปัจจุบัน — แยก "ออกชั่วคราว" (ยังนับเป็นสมาชิกศูนย์ คาดว่าจะกลับมา) ออกจาก "ส่งต่อ/
ย้ายศูนย์" (ไปศูนย์อื่น) ออกจาก "ย้ายออก/กลับภูมิลำเนา" (`checked_out` — ออกจากระบบศูนย์พักพิงถาวร
กลับที่พักอาศัยเดิม ไม่ใช่ไปศูนย์อื่น) และเพิ่ม "เสียชีวิต" ซึ่งไม่มีในสถานะเดิมเลย

## Change

**Before** (`docs/data/schema.md` §1.1, `stayStatusSchema` ปัจจุบัน):

| enum value | ป้ายที่ UI ใช้ตอนนี้ |
| --- | --- |
| `registered` | ลงทะเบียนแล้ว (Registered) |
| `checked_in` | พักพิงในศูนย์ (Active) |
| `checked_out` | ออกจากศูนย์แล้ว (Checked Out) |
| `transferred` | ส่งต่อแล้ว (Transferred) |

**After** (ตามคำขอ UI v5):

| enum value (เสนอ) | ป้ายไทย / อังกฤษ | ที่มา |
| --- | --- | --- |
| `pre_registered` | ลงทะเบียนล่วงหน้า (Pre-registered) / รอรายงานตัว | rename จาก `registered` |
| `active` | พักพิงในศูนย์ (Active / In-Shelter) | rename จาก `checked_in` |
| `temporary_leave` | ออกชั่วคราว (Temporary Leave) | **ใหม่** |
| `transferred` | ส่งต่อ / ย้ายศูนย์ (Transferred) | คงเดิม |
| `checked_out` | ย้ายออก / กลับภูมิลำเนา (Checked-out) | **ใหม่ความหมาย** — เดิม `checked_out` = ออกทั่วไป, ใหม่ = กลับที่พักอาศัยเดิม ไม่ผ่านศูนย์อื่น |
| `deceased` | เสียชีวิต (Deceased) | **ใหม่** |



### `MovementAction` — enum ใหม่ (schema.md §1.4 field `action`)

| action | ผลต่อ `current_stay.status` | หมายเหตุ |
| --- | --- | --- |
| `check_in` | → `active` | คงเดิม |
| `check_out` | → `checked_out` | คงชื่อเดิม — ความหมายใหม่ตรงกับ `checked_out` enum (กลับภูมิลำเนา) |
| `transfer_out` | → `transferred` | คงเดิม |
| `transfer_in` | → `active` | คงเดิม — เข้าศูนย์ (รับจากศูนย์อื่น หรือกลับจากศูนย์อื่น) |
| `leave_temporary` | → `temporary_leave` | **ใหม่** — ออกชั่วคราว |
| `return_from_leave` | → `active` | **ใหม่** — กลับจากออกชั่วคราว |
| `mark_deceased` | → `deceased` | **ใหม่** — บันทึกการเสียชีวิต; ไม่มี action ย้อนกลับ (append-only, terminal state) |

## Impact

- **Schema:** `docs/data/schema.md` §1.1 field `current_stay.status` — แก้ enum + ตัวอย่าง note;
  §1.4 field `movement.action` — เพิ่ม `leave_temporary`, `return_from_leave`, `mark_deceased`
- **Domain:** `stayStatusSchema` (`people.ts:49`), `movementActionSchema` (`people.ts:68-74`),
  `statusByAction` (`people.ts:482-486`) — เพิ่ม 3 action ใหม่ + mapping ตามตาราง `MovementAction` ด้านบน
- **UI:** `evacuee-profile-view.svelte` (`statusConfig`, `people.ts:42-67`),
  `evacuee-status-modal.svelte`, ทุกจุดที่ render label สถานะ (evacuee-list, evacuee-search,
  evacuee-zone-modal, evacuee-wristband-success, evacuee-qr-modal, household-form,
  household-form-page)
- **Occupancy/headcount:** `dashboard/domain/occupancy.schema.ts`,
  `kitchen/domain/occupancy.ts`, `shelters/domain/views.ts` — ทุกจุดที่ hardcode `'checked_in'`
- **Data seed:** evacuee doc ที่ persist อยู่แล้วมี `current_stay.status` เป็นค่าเก่า 4 ค่า —
  ต้อง migrate (ดู Migration)
- **Test:** `people.test.ts`, `people.pouch.test.ts`, `occupancy.schema.test.ts`,
  `occupancy.test.ts` (kitchen), `views.test.ts` (shelters)

## Migration

รอ schema_v ที่เคาะแล้ว — เสนอ additive/rename migration บน read:

- `registered` → `pre_registered`
- `checked_in` → `active`
- `checked_out` (ความหมายเดิม: ออกทั่วไป) → `checked_out` (ความหมายใหม่: กลับภูมิลำเนา) — **สมมติฐาน
  migration เท่านั้น**, doc เก่าที่ `checked_out` จริงๆ หมายถึง "ส่งต่อไปศูนย์อื่น" จะต้อง manual
  review แยกไป `transferred` แทน (ข้อมูลเดิมไม่ได้บอกความต่างนี้ไว้ — ไม่มีทาง auto-map ได้ 100%)
- `transferred` → `transferred` (ไม่เปลี่ยน)
- ไม่มี legacy value map ไป `temporary_leave` / `deceased` (ค่าใหม่ทั้งหมด ต้องเกิดจาก action ใหม่เท่านั้น)

## Decision log

- 2026-07-07 — proposed; ร่างจากคำขอ UI v5 (5 สถานะ) เทียบกับ enum เดิม 4 ค่าใน schema.md §1.1;
  track เป็น CR ไฟล์เต็มตามที่ owner เลือก (change-management §6); มี 4 จุด NEEDS DECISION ที่ต้อง
  เคาะก่อน implement — ยังไม่ approve, ยังไม่แก้ code/schema.md
- 2026-07-07 — owner เคาะ NEEDS DECISION #1: เพิ่มสถานะที่ 6 `checked_out` = "ย้ายออก/กลับภูมิลำเนา"
  (แยกจาก `transferred` = ไปศูนย์อื่น) → รุ่นนี้เป็น **6-state model**
- 2026-07-07 — owner เคาะ NEEDS DECISION #2: เพิ่ม `MovementAction` 3 ค่าใหม่ — `leave_temporary`,
  `return_from_leave`, `mark_deceased` (ดูตาราง `MovementAction` ด้านบน) — `mark_deceased` ไม่มี
  action ย้อนกลับ (terminal state); ทุก NEEDS DECISION เคาะครบแล้ว — พร้อมส่งให้ owner set
  `status: approved`
