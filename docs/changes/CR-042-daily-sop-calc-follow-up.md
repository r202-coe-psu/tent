---
id: CR-042
title: "Daily SOP follow-up — close CR-036 open decisions + Module B develop-ready spec"
status: approved
date: 2026-07-15
updated: 2026-07-23
requested_by: project owner
decided_by: project owner
layer: volatile
track: docs/changes (ไฟล์ CR อย่างเดียว)
affects:
  - docs/features/daily-sop-resource-calc-flow.md
  - docs/changes/CR-036-daily-calc-doc-type.md (open decisions #1–#2 → closed)
  - docs/data/schema.md §2.15 daily_calc
  - schema_v daily_calc 1 → 2
  - docs/task-breakdown/07-B-sop.md T-31 / T-32 DoD
  - docs/prd/phase-r3-operations.md FR-45 (clarity R3 runtime + feed defer)
  - frontend/src/lib/features/resource-calc/ (snapshot builder, resolveHave, Zod dailyCalcDocSchema)
  - frontend/src/lib/features/sop-ratios/ (dashboard อ่าน daily_calc; reconcile rice_g drift vs CR-021)
---

# CR-042 — Daily SOP follow-up (CR-036 open decisions + Module B spec)

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ปิดช่องว่างที่ทำให้ T-31/T-32 พัฒนาเต็มรูปไม่ได้หลัง [CR-036](CR-036-daily-calc-doc-type.md) — **ratio_source drill-down**, **`have` hardcode map**, **on-demand-only ใน R3**, **เลื่อน downstream feed**
- **เพื่อใคร/ทำไม:** Team D / SM ได้ dashboard gap ที่เชื่อถือได้; feature flow พัฒนาพร้อมที่ [`daily-sop-resource-calc-flow.md`](../features/daily-sop-resource-calc-flow.md)
- **dev ต้อง build:** bump `daily_calc` schema_v 2 · แทนที่ `resolveHave` ตามตาราง map ด้านล่าง · ผูก dashboard กับ snapshot + drill-down จาก field ใหม่ · ปุ่ม on-demand · ไม่ทำ scheduler / ไม่ทำ consumer feed ใน R3
- **กระทบ schema/scope:** schema.md §2.15 applied · 07-B DoD applied · feature flow = `active` · code/Zod ตาม stories ถัดไป

## Why

- CR-036 ตั้ง `daily_calc` และเลื่อน Open decision #1 (`ratio_source` / override id) + #2 (`have` mapping) เป็น follow-up — T-32 DoD ยังบังคับ drill-down ว่า ratio มาจาก master หรือ override ([CR-006](CR-006-sop-profile-master-override.md))
- Runtime ปัจจุบัน: `resolveHave` lookup stock ด้วยชื่อ ratio key → แถวส่วนใหญ่ `have=null` → `stock_unsynced`
- DoD T-31 ระบุทั้ง on-demand และรอบอัตโนมัติรายวัน แต่ยังไม่ล็อก runtime
- FR-45 ระบุ feed ไป Meal Plan / Donation / Volunteer แต่ยังไม่มี contract

## Decisions locked (จากงานก่อนหน้า — ไม่เปิดใหม่ใน CR นี้)

| ID | คำตัดสิน | ที่มา |
| --- | --- | --- |
| **B-TIER** | Master `sop_profile` (catalog) + `sop_override` (shelter) | CR-006 / CR-015 / CR-026 |
| **B-RESOLVE** | effective = override active ?? master | CR-018 |
| **B-KEYS** | 20 canonical keys; ไม่มี `rice_g_per_person_meal` ใน SOP | CR-021 |
| **B-OCC** | occupancy = `evacuee.current_stay.status = active` | CR-035 / CR-036 |
| **B-SNAP** | `_id = daily_calc:{date}` idempotent; overwrite → `audit.retro_edit` ก่อน | CR-036 |

## Decisions closed (OD-1..OD-4)

| ID | มติ | ผล |
| --- | --- | --- |
| **OD-1** | **A** | เพิ่ม `ratio_source` + `sop_override_id` + `sop_override_version` · `schema_v` 1→2 |
| **OD-2** | **B** | hardcode `have` map ใน code + ตารางด้านล่าง · เปลี่ยน map ภายหลัง = CR ใหม่ |
| **OD-3** | **A** | R3 = on-demand อย่างเดียว · เลื่อน auto scheduler ไป backlog |
| **OD-4** | **C** | เลื่อน feed Meal/Volunteer/Donation จนหลัง T-32 นิ่ง (สอดคล้อง CR-041 D-DEMAND) |

### OD-2 — Hardcode `have` map (R3)

`resolveHave` ต้องอ่านตามตารางนี้เท่านั้น (ไม่ lookup ด้วยชื่อ ratio key):

| # | key | have_source | path / id | หมายเหตุ |
| --- | --- | --- | --- | --- |
| 1 | `water_l_per_person_day` | stock | `item:water` | seed ปัจจุบันมี SKU เดียว; แยก SKU ทีหลัง = CR |
| 2 | `drinking_water_l_per_person_day` | stock | `item:water` | interim ใช้ SKU เดียวกับ #1 |
| 3 | `cooking_water_l_per_person_day` | stock | `item:water` | interim ใช้ SKU เดียวกับ #1 |
| 4 | `hygiene_water_l_per_person_day` | stock | `item:water` | interim ใช้ SKU เดียวกับ #1 |
| 5 | `kcal_per_adult_day` | none | — | `have=null` · `stock_unsynced` / need-only |
| 6 | `people_per_tap` | shelter | `facilities.water_points` | |
| 7 | `people_per_handpump` | none | — | ไม่มี field ใน shelter form |
| 8 | `people_per_open_well` | none | — | |
| 9 | `people_per_laundry` | none | — | |
| 10 | `people_per_bathing` | shelter | `facilities.showers` | |
| 11 | `people_per_toilet_female` | shelter | `facilities.toilets_female` | |
| 12 | `people_per_toilet_male` | shelter | `facilities.toilets_male` | |
| 13 | `people_per_dining_point_adult` | none | — | |
| 14 | `people_per_dining_point_child` | none | — | |
| 15 | `m2_per_person_living` | shelter | `area_m2` | |
| 16 | `m2_per_person_living_cold` | shelter | `area_m2` | ใช้ field เดียวกับ #15 ใน R3 |
| 17 | `m2_per_person_total` | shelter | `area_m2` | ใช้ field เดียวกับ #15 ใน R3 |
| 18 | `max_waterpoint_distance_m` | none | — | threshold — ไม่มี `have` |
| 19 | `max_queue_minutes` | none | — | threshold — ไม่มี `have` |
| 20 | `people_per_volunteer` | volunteer | Module A headcount barrel | ถ้ายังไม่มี API → `have=null` |

กฎ: `have_source = none` หรือค่า path เป็น `null`/ขาด → `have=null` (ไม่ใส่ 0 มั่ว) · `threshold` ไม่คำนวณ gap จาก stock

## Change

### A. Feature flow

| | Before | After |
| --- | --- | --- |
| Develop-ready Module B spec | กระจายใน PRD + 07-B + CR-036 | [`daily-sop-resource-calc-flow.md`](../features/daily-sop-resource-calc-flow.md) = **`active`** |
| CR-036 OD#1 / #2 | เปิดค้าง | ปิดที่ OD-1 / OD-2 ของ CR นี้ |

### B. `daily_calc` schema (OD-1 = A)

| | Before (schema_v 1) | After (schema_v 2) |
| --- | --- | --- |
| Trace ratio | มีแค่ `sop_profile_version` | + `ratio_source: enum(master, override)` · `sop_override_id: str\|null` · `sop_override_version: int\|null` |
| `schema_v` | 1 | **2** |

เมื่อ `ratio_source = master`: `sop_override_id` / `sop_override_version` = `null`  
เมื่อ `ratio_source = override`: ทั้งสอง field บังคับมีค่า

### C. `have` resolution (OD-2 = B)

| | Before | After |
| --- | --- | --- |
| `resolveHave` | lookup stock ด้วย ratio key name | ตามตาราง hardcode ด้านบน |

### D. Runtime & consumers

| ID | มติ | ผล |
| --- | --- | --- |
| OD-3-A | on-demand only | อัปเดต DoD T-31 — ตัดรอบอัตโนมัติออกจาก R3 |
| OD-4-C | เลื่อน feed | T-25 / T-29 / T-23 ไม่บังคับอ่าน `daily_calc` ใน R3; FR-45 consequence ระบุ defer |

### E. Drift cleanup (คู่กับ implement)

- ถอด `rice_g_per_person_meal` จาก runtime `SOP_RATIO_KEYS` ให้ตรง CR-021

## Impact

- **docs:** feature flow · schema §2.15 · 07-B DoD · FR-45 clarity · CR-036 decision log
- **code (stories ถัดไป):** `daily-calc.remote.ts` · Zod `dailyCalcDocSchema` + `DAILY_CALC_SCHEMA_VERSION=2` · dashboard drill-down · unit tests · `have` map module
- **peers:** operations (`item:water`) · shelters (facilities/area) · Module A volunteer count เมื่อพร้อม
- **ไม่แตะ:** stable core · T-42 · consumer Kitchen/Volunteer/Donation ใน R3

## Migration

- **bump → schema_v 2:** doc ที่มีอยู่ยังน้อย/ไม่มี production — **wipe หรือ re-run** on-demand หลัง deploy field ใหม่; ไม่มี lazy migration บังคับใน R3 pre-prod
- Mapping OD-2: ไม่ migrate ข้อมูลเก่า — recalc on-demand หลัง deploy

## Decision log

- 2026-07-15 — proposed โดย project owner; คู่กับ feature flow draft; open OD-1..OD-4
- 2026-07-23 — **approved** โดย project owner; track = **(ก) ไฟล์ CR ใน `docs/changes/` อย่างเดียว**. มติ: OD-1=A · OD-2=B · OD-3=A · OD-4=C. Applied: schema.md §2.15 v2 · feature flow `active` · 07-B DoD · FR-45 clarity · ปิด CR-036 OD#1/#2. Code/Zod sync = งาน implement ถัดไป (epic/stories). CR คง `approved` จน code+test ครบแล้วค่อย `done`
