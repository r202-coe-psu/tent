---
id: CR-042
title: "Daily SOP follow-up — close CR-036 open decisions + Module B develop-ready spec"
status: proposed
date: 2026-07-15
requested_by: project owner
decided_by: project owner
layer: volatile
affects:
  - docs/features/daily-sop-resource-calc-flow.md
  - docs/changes/CR-036-daily-calc-doc-type.md (open decisions #1–#2 → close via this CR)
  - docs/data/schema.md §2.15 daily_calc (ถ้า OD-1 เลือก bump)
  - schema_v daily_calc 1 → 2 (เฉพาะเมื่อ OD-1 = เพิ่ม field ใน doc)
  - docs/task-breakdown/07-B-sop.md T-31 / T-32 DoD (หลังเคาะ OD)
  - docs/prd/phase-r3-operations.md FR-45 / FR-46 (clarity เท่านั้นถ้าจำเป็น)
  - docs/sitemap.md §2.7 /resources (ถ้าควรระบุ run + dashboard ชัดขึ้น)
  - frontend/src/lib/features/resource-calc/ (snapshot builder, resolveHave, Zod dailyCalcDocSchema)
  - frontend/src/lib/features/sop-ratios/ (dashboard อ่าน daily_calc; reconcile rice_g drift vs CR-021)
---

# CR-042 — Daily SOP follow-up (CR-036 open decisions + Module B spec)

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ปิดช่องว่างที่ทำให้ T-31/T-32 ยังพัฒนาเต็มรูปไม่ได้หลัง [CR-036](CR-036-daily-calc-doc-type.md) approve baseline `daily_calc` schema_v 1 — โดยเฉพาะ **ratio_source drill-down**, **`have` mapping**, **scheduled run**, **downstream feed contract**
- **เพื่อใคร/ทำไม:** Team D / SM ต้องได้ dashboard gap ที่เชื่อถือได้ + meal/volunteer/donation อ่านผลเดียวกัน; feature flow พัฒนาพร้อมอยู่ใน [`docs/features/daily-sop-resource-calc-flow.md`](../features/daily-sop-resource-calc-flow.md)
- **dev ต้อง build อะไร (หลัง approve + ปิด OD):** ตามมติ OD-1..OD-4 — อาจ bump `daily_calc` · แทนที่ `resolveHave` · ผูก dashboard กับ snapshot · (opt) scheduler · (opt) consumer contract
- **กระทบ schema/scope:** **ยังไม่ apply** schema.md / task-breakdown / code จนกว่า CR = `approved` และปิด open decisions ที่บังคับ schema

## Why

- CR-036 ตั้ง `daily_calc` และเลื่อน Open decision #1 (`ratio_source` / override id) + #2 (`have` mapping) เป็น follow-up — T-32 DoD ยังบังคับ drill-down ว่า ratio มาจาก master หรือ override ([CR-006](CR-006-sop-profile-master-override.md))
- Runtime ปัจจุบัน: `resolveHave` lookup stock ด้วยชื่อ ratio key → แถวส่วนใหญ่ `have=null` → `stock_unsynced` — gap ยังไม่ meaningful สำหรับ facility / volunteer / area
- DoD T-31 ระบุทั้ง on-demand และรอบอัตโนมัติรายวัน แต่ยังไม่ล็อก runtime
- FR-45 ระบุ feed ไป Meal Plan / Donation redirect / Volunteer demand แต่ยังไม่มี contract อ่านจาก `daily_calc`
- มี feature flow draft รวม baseline ที่ locked (CR-006/015/018/021/026/036) — CR นี้เป็นประตูเข้าสู่การเคาะ OD แล้ว apply canonical docs

## Decisions locked (จากงานก่อนหน้า — ไม่เปิดใหม่ใน CR นี้)

| ID | คำตัดสิน | ที่มา |
| --- | --- | --- |
| **B-TIER** | Master `sop_profile` (catalog) + `sop_override` (shelter) | CR-006 / CR-015 / CR-026 |
| **B-RESOLVE** | effective = override active ?? master | CR-018 |
| **B-KEYS** | 20 canonical keys; ไม่มี `rice_g_per_person_meal` ใน SOP | CR-021 |
| **B-OCC** | occupancy = `evacuee.current_stay.status = active` | CR-035 / CR-036 |
| **B-SNAP** | `_id = daily_calc:{date}` idempotent; overwrite → `audit.retro_edit` ก่อน | CR-036 |

## Open decisions (ต้องปิดก่อน approve / apply)

อ้างตารางเดียวกันใน feature flow §9:

| ID | คำถาม | ทางเลือก | บล็อกอะไร |
| --- | --- | --- | --- |
| **OD-1** | เพิ่ม trace ratio ใน `daily_calc`? | **A)** `ratio_source` + `sop_override_id` + `sop_override_version` · **B)** คง schema_v1 — UI resolve สด · **C)** เก็บแค่ `ratio_source` | schema_v bump · T-32 DS-D5 |
| **OD-2** | `have` mapping ต่อ 20 keys? | **A)** ตาราง map (catalog/master_data) · **B)** hardcode + CR · **C)** R3 map เฉพาะ multiply + volunteer; facility/area = need-only (`have=null`) | ความถูกต้อง gap · `resolveHave` |
| **OD-3** | รอบอัตโนมัติรายวัน? | **A)** on-demand อย่างเดียวใน R3 · **B)** schedule ใน SPA · **C)** server/worker cron | DoD T-31 |
| **OD-4** | Downstream อ่านอะไร? | **A)** อ่าน `daily_calc.results[]` ตรง · **B)** view/projection แยก · **C)** เลื่อน feed หลัง T-32 นิ่ง | T-25 / T-29 / T-23 · CR-041 D-DEMAND |

> **ข้อเสนอแนะ (ยังไม่มติ):** OD-1 = **A** (snapshot-true drill-down) · OD-3 = **A** ใน R3 ถ้ายังไม่มี worker · OD-2 = **C** เพื่อปลดบล็อก dashboard เร็ว · OD-4 = **C** หรือ **A** บาง consumer ก่อน

## Change

### A. Feature flow (ตอน proposed)

| | Before | After |
| --- | --- | --- |
| Develop-ready Module B spec | กระจายใน PRD + 07-B + CR-036 | รวมที่ [`daily-sop-resource-calc-flow.md`](../features/daily-sop-resource-calc-flow.md) + CR นี้ |
| CR-036 OD#1 / #2 | เปิดค้าง | ย้ายมาปิดที่ OD-1 / OD-2 ของ CR-042 |

### B. `daily_calc` schema (หลัง approve — ขึ้นกับ OD-1)

| | Before (schema_v 1) | After ถ้า OD-1 = A |
| --- | --- | --- |
| Trace ratio | มีแค่ `sop_profile_version` | + `ratio_source: enum(master, override)` · `sop_override_id: str\|null` · `sop_override_version: int\|null` |
| `schema_v` | 1 | **2** + migration note |

ถ้า OD-1 = B หรือ C → ระบุ field set ให้ตรงทางเลือกใน Decision log ก่อน apply

### C. `have` resolution (หลัง approve — ขึ้นกับ OD-2)

| | Before | After (ทิศทาง) |
| --- | --- | --- |
| `resolveHave` | lookup stock ด้วย ratio key name | แทนที่ตามตาราง mapping ที่ล็อกใน OD-2 |
| Facility / area / volunteer | ส่วนใหญ่ `stock_unsynced` | มีแหล่ง `have` หรือยืนยัน need-only ตาม OD-2-C |

### D. Runtime & consumers (หลัง approve — ขึ้นกับ OD-3 / OD-4)

| ID | ผลที่คาดเมื่อเคาะ |
| --- | --- |
| OD-3-A | อัปเดต DoD T-31 ให้สอดคล้อง on-demand-only ใน R3; เลื่อน auto ไป backlog |
| OD-3-B/C | ระบุ scheduler owner + ความล้มเหลว/retry ใน 07-B |
| OD-4 | เขียน handoff shape ใน feature flow §4.4 + ลิงก์จาก Kitchen / Volunteer / Donation tasks |

### E. Drift cleanup (คู่กับ approve — ไม่เปลี่ยนผลิตภัณฑ์)

- ถอด `rice_g_per_person_meal` จาก runtime `SOP_RATIO_KEYS` ให้ตรง CR-021 (reconcile code ↔ schema)

## Impact

- **docs:** feature flow · schema §2.15 (ถ้า bump) · 07-B DoD · (opt) PRD consequences ชัดขึ้น · CR-036 decision log ชี้มา CR-042
- **code:** `daily-calc.remote.ts` snapshot builder · Zod `dailyCalcDocSchema` · dashboard provider สลับไป `daily_calc` · unit tests
- **peers:** operations (stock SKU) · shelters (facility/area ถ้า OD-2) · Module A volunteer count · kitchen/donation consumers ถ้า OD-4 ≠ C
- **ไม่แตะ:** stable core envelope/auth/sync · T-42 what-if

## Migration

- ถ้า **ไม่ bump** `daily_calc` (OD-1 B): N/A สำหรับ persisted docs
- ถ้า **bump → schema_v 2** (OD-1 A/C): doc ที่มีอยู่ยังน้อย/ไม่มี production — **wipe หรือ backfill** field ใหม่ตอน re-run; ไม่มี lazy migration บังคับใน R3 pre-prod
- Mapping OD-2: ไม่ migrate ข้อมูลเก่า — recalc on-demand หลัง deploy

## Decision log

- 2026-07-15 — proposed โดย project owner; คู่กับ feature flow draft; open OD-1..OD-4; **ยังไม่ approved** — ห้าม apply schema/DoD จนกว่าปิด OD ที่บังคับ
