---
id: draft
title: หน้าจอ /onsite/meal-distribution และ /onsite/item-distribution — route, role และ action ที่ยังไม่อยู่ใน CR-121
status: proposed
date: 2026-10-06
requested_by: ทีม frontend (branch feat/meal-item-distribution)
decided_by: <เจ้าของโครงการ>
layer: volatile
affects:
  - docs/changes/CR-121-spec-ticket.md §5 ตาราง Screen/Role (หน้าจอ 6, 13–18)
  - docs/prd/ role matrix (ถ้ามีแถวของหน้าจอ onsite distribution)
  - schema_v — ไม่เปลี่ยน
  - frontend/src/routes/(protected)/onsite/meal-distribution/+page.ts (requireKitchen)
  - frontend/src/routes/(protected)/onsite/item-distribution/+page.ts (requireWarehouseAccess)
  - frontend/src/routes/(protected)/onsite/+page.svelte (tiles)
  - frontend/src/lib/features/item-distribution/application/item-distribution-store.svelte.ts (createRequisition, lost)
---

# หน้าจอแจกอาหาร / แจกสิ่งของหน้างาน

> **สรุป (TL;DR)**
> - **เปลี่ยนอะไร:** รับรองหรือปฏิเสธหน้าจอใหม่ 2 หน้า (`/onsite/meal-distribution`, `/onsite/item-distribution`) ที่ไม่มีในแผนผังหน้าจอ CR-121 พร้อม role และ action ที่หน้าจอทำได้
> - **ทำไม:** CR-121 กำหนดหน้าจอ frontline เป็น `/onsite/distribution{,/scan,/reconcile}`, `/onsite/loans`, `/onsite/returns`; 2 หน้าใหม่ซ้อนหน้าที่กับหน้าเหล่านั้นและใช้ role guard ต่างจาก CR-121
> - **dev ต้อง build:** ปรับ route/guard/action ตามข้อที่เคาะใน FR-OSD-01..05
> - **กระทบ:** scope + role/permission (change-management §2) — ไม่เปลี่ยน schema

## Change

**Before (CR-121 §5):**
| หน้าจอ | Route | Role |
| --- | --- | --- |
| 6 สร้างตั๋วเบิก | `/back-office/tickets/new` | `warehouse_staff`, `supply_coordinator`, `kitchen_staff`, `shelter_manager` |
| 13–15 จุดแจก (รับเข้า/สแกน/ปิดรอบ) | `/onsite/distribution/*` | `registration_staff`, `supply_coordinator`, `shelter_manager` (+ Volunteer Shift Pass) |
| 16 ยืมของ | `/onsite/loans` | `registration_staff`, `supply_coordinator`, `shelter_manager` (+ Volunteer Shift Pass) |
| 17 รับคืน | `/onsite/returns` | `warehouse_staff`, `supply_coordinator`, `registration_staff` |
| 18 Check-out ปลดภาระ (lost/waived) | `/onsite/scan-check-in-out` | `registration_staff`, `shelter_manager` |

**As-built (branch `feat/meal-item-distribution`, ยัง mock data):**
| หน้าจอ | Guard | Action ในหน้าเดียว |
| --- | --- | --- |
| `/onsite/meal-distribution` | `requireKitchen` | สแกน/ค้นหาผู้รับ, แจกอาหาร, void, ปิดรอบ (`DISTRIBUTING → SHIFT_CLOSED`) |
| `/onsite/item-distribution` | `requireWarehouseAccess` | **สร้างตั๋ว `supplies`**, แจก/ให้ยืม, รับคืน (ตรวจสภาพ), **ปิดภาระเป็น `lost`** |

### Requirements
- **FR-OSD-01** — สถานะของ 2 route > [NEEDS DECISION: (A) รับเป็นหน้าจอแยกตามประเภทของ (อาหาร / สิ่งของ+ของยืม) แทน `/onsite/distribution`, `/onsite/loans`, `/onsite/returns` → แก้ตาราง CR-121 §5, (B) รับเป็นหน้าเสริม แต่ต้องใช้ workflow/hook กลางของ `$lib/features/distribution` ร่วมกับ `/onsite/distribution` (ไม่ใช่ store แยก), (C) ไม่รับ → ย้าย UI เข้า `/onsite/distribution` (FrontlineStationPage) แล้วลบ 2 route]
- **FR-OSD-02** — role ของ `/onsite/meal-distribution` ต้องเท่ากับหน้าจอ 13–15 ของ CR-121 (`registration_staff`, `supply_coordinator`, `shelter_manager` + Volunteer Shift Pass) — **ไม่ใช่** `kitchen_staff` (ครัวจบที่ส่งมอบเข้าคลัง ตาม CR-147)
- **FR-OSD-03** — role ของ `/onsite/item-distribution` > [NEEDS DECISION: union ของหน้าจอ 16+17 (`registration_staff`, `warehouse_staff`, `supply_coordinator`, `shelter_manager`) หรือแยก action ตาม role (แจก/ยืม = 16, รับคืน = 17)]
- **FR-OSD-04** — การสร้างตั๋ว `supplies` จากหน้าจอ onsite > [NEEDS DECISION: (A) อนุญาต — เพิ่ม route นี้ในหน้าจอ 6 และกำหนด role, (B) ไม่อนุญาต — ตัดปุ่มออก ให้สร้างที่ `/back-office/tickets/new` เท่านั้นตาม CR-121]
- **FR-OSD-05** — การปิดภาระของยืมเป็น `lost` (และ `waived`) นอกด่าน Check-out > [NEEDS DECISION: (A) อนุญาตที่จุดรับคืนด้วย โดยใช้ `loan_return_reservation` mode `NON_PHYSICAL` (§2.33) และ role ตาม VDU Rule 16, (B) ไม่อนุญาต — lost/waived ทำที่ `/onsite/scan-check-in-out` เท่านั้นตาม FR-LON-04]

### Acceptance
- ตาราง CR-121 §5 (หรือ CR นี้) ระบุ route + role ของทั้ง 2 หน้าครบ
- `+page.ts` ของทั้ง 2 route ใช้ guard ที่ตรงกับตาราง; ผู้ใช้ role นอกตารางถูก redirect
- action ที่เคาะว่า "ไม่อนุญาต" ไม่ปรากฏบนหน้าจอ

## Why
- 2 หน้าถูกสร้างเป็น UI mock ก่อนมี spec; ตอนนี้ align data กับ schema กลางแล้ว (`requisition_ticket` / `distribution_log`) แต่ scope และ role ยังไม่ตรงกับ CR-121
- guard ปัจจุบัน (`requireKitchen`, `requireWarehouseAccess`) ไม่ให้ `registration_staff` เข้า ซึ่งเป็น role หลักของจุดแจกตาม CR-121

## Impact
- docs: CR-121 §5 ตาราง Screen/Role; `docs/prd/` role matrix (ถ้ามี)
- code: guard ใน `+page.ts` 2 ไฟล์; ปุ่ม/flow ใน `item-distribution` ตาม FR-OSD-04/05; tile ใน `/onsite/+page.svelte`
- ไม่กระทบ schema / VDU (นอกจาก FR-OSD-05 A ที่ใช้ VDU Rule 16 เดิม)

## Migration
N/A

## Decision log
- 2026-10-06 — proposed
