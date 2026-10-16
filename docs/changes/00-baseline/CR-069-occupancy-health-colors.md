---
id: CR-069
title: Occupancy health 5 สี — derived จาก occupancy/capacity (ไม่ persist)
status: approved
date: 2026-08-13
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ (IMPS, approved 2026-08-13)
layer: volatile
parent: CR-066
affects:
  - docs/data/schema.md (คำอธิบาย derived view — ไม่เพิ่ม field persist)
  - frontend/src/lib/features/shelters (occupancy bar)
  - frontend/src/lib/features/dashboard
  - frontend/src/lib/features/public-portal (map/card color)
  - docs/task-breakdown/07-B-sop.md (T-69)
  - docs/task-breakdown/10-eoc.md (T-70)
  - docs/task-breakdown/12-public.md (สีหมุด; ไอคอนอยู่ CR-067)
---

# CR-069 — Occupancy health 5 สี

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** เพิ่ม derived `occupancy_health` 5 ค่า (gray/blue/yellow/red/dark_red) จาก occupancy÷capacity + override จาก `operation_status`
- **เพื่อใคร/ทำไม:** เตือนคนล้นบน staff และ public ตอนนี้; เตรียมฟิลด์ EOC API โดยไม่สร้าง dashboard ในแอป (FD-14)
- **dev ต้อง build อะไร:** ฟังก์ชัน domain บริสุทธิ์ + แทนแถบ 3 สีด้วย 5 สีบน staff list/dashboard **และ** public map/card (T-69); ฟิลด์ EOC ทีหลัง (T-70 blocked T-37)
- **กระทบ schema/scope ไหน:** **ไม่ bump schema_v** — ไม่ persist health; `operation_status` คง staff-set 4 ค่า

## Why

เจ้าของโครงการต้องการเตือนใน EOC เมื่อคนล้น 5 สี. ปัจจุบัน `operation_status` เป็นธงที่ staff ตั้ง (standby/active/full_capacity/closed) ไม่ได้ derive จากจำนวนคน. แถบ occupancy staff มี 3 สี และไม่มีสถานะเกินจุ. FD-14 กำหนด EOC = aggregate API ไม่ใช่หน้าจอในแอป.

**ล็อกแล้ว:** คำนวณ health บน staff + public ตอนนี้; ส่ง field ใน EOC API เมื่อ T-37 เดิน. **ไม่สร้างหน้า EOC dashboard.**

## Change

### Before → After

| Area | Before | After |
| --- | --- | --- |
| สี occupancy staff | เขียว &lt;80 / amber ≥80 / rose ≥100 | 5 สีตามตาราง + status override |
| สี public map | ตาม `operation_status` (OPEN/FULL/PREPARE/CLOSED) | ตาม derived health (+ ไอคอน `site_kind` จาก CR-067) |
| `operation_status` | staff-set 4 ค่า | **คงเดิม** — ไม่ถูกแทนที่ด้วย health แต่ **override สีได้** |
| Persist | — | **ไม่เก็บ** health ใน CouchDB |

### สูตร (D-HEALTH-PCT + Wave 2 สี + Wave 3 ตัวเศษ)

```
occupancy = count(evacuee.current_stay.status ∈ {active, pre_registered})  // D-BOOK-OCC=C (Wave 3)
capacity  = shelter.capacity
ratio     = occupancy / capacity   // ใช้เมื่อถึงขั้น % และ capacity > 0
// Kitchen/SOP คนอยู่จริง (CR-022) ยังนับ active อย่างเดียว — คนละสูตร
```

ประเมินตามลำดับ (status ก่อน %):

1. `operation_status ∈ {standby, closed}` → `closed` / เทา — **ไม่เข้าสูตร %** (D-STANDBY=A)
2. `operation_status = full_capacity` → `full` / แดง — บังคับ แม้ occupancy &lt;100% (D-HEALTH-VS-STATUS=B)
3. นอกนั้น (`active`) → ตาม % (D-HEALTH-PCT) เมื่อ `capacity > 0`

ถ้า `capacity` หายหรือ `= 0` ในขั้นที่ 3 → แสดง «ไม่มีข้อมูลความจุ» — **ห้ามหารศูนย์**. Health **ไม่ persist**.

**เปิดอยู่** = `operation_status ∈ {active, full_capacity}` (enum 4 ค่าที่มีอยู่ — ห้ามเพิ่มสถานะ). `full_capacity` เป็นสถานะเปิดแต่สีบังคับแดง ไม่เดิน % ต่อ.

| id | สี | เงื่อนไข |
| --- | --- | --- |
| `closed` | เทา | `operation_status ∈ {closed, standby}` — **ไม่ใช่ %** |
| `open` | ฟ้า | `active` และ `ratio < 0.60` |
| `near_full` | เหลือง | `active` และ `0.60 ≤ ratio < 0.90` (60–89%; **90% เป็นแดง**) |
| `full` | แดง | `full_capacity` (บังคับ) **หรือ** `active` และ `0.90 ≤ ratio ≤ 1.00` |
| `over` | แดงเข้ม | `active` และ `ratio > 1.00` |

เกณฑ์ % เป็นค่าคงที่ domain ที่เปลี่ยนได้ที่เดียว (อย่า hardcode กระจายใน UI).

## Requirements

- **FR-66..FR-69** ตาม program spec
- Domain function บริสุทธิ์ (ไม่มี I/O) + unit test ครอบทุกแถบรวม `capacity=0`, occupancy=0, `standby` เทา, `full_capacity` บังคับแดงเมื่อ occupancy &lt;90%, **และ** hold `pre_registered` นับเข้า occupancy (D-BOOK-OCC=C)
- Permission: อ่านอย่างเดียว; ไม่มี write path ของ health
- Public: ไม่มี PII; ตัวเลข occupancy/capacity ตาม OP-9 (แสดงเป๊ะ)
- สูตรชุดเดียว staff / public / (ทีหลัง) EOC — ห้ามสูตรคนละชุด

### Acceptance (T-69) — Wave 2 ล็อกแล้ว

- Staff list/dashboard **และ** public map/card แสดง 5 สีตรงสูตรที่ล็อก (D-HEALTH-SURFACE=A)
- ศูนย์ occupancy 101/100 + `active` = แดงเข้ม; 90/100 + `active` = แดง; 89/100 + `active` = เหลือง; 59/100 + `active` = ฟ้า
- Hold `pre_registered` นับเข้า occupancy (D-BOOK-OCC=C) — เช่น 50 `active` + 10 `pre_registered` บน capacity 100 = ratio 0.60 → เหลือง (ไม่ใช่ฟ้า)
- `closed` = เทา แม้คนยังอยู่ในระบบ; `standby` = เทา แม้ occupancy สูง (ไม่เข้า %)
- `full_capacity` + occupancy 50/100 = **แดง** (ไม่ใช่ฟ้า)
- `capacity=0` + `active` ไม่หารศูนย์ — แสดงไม่มีข้อมูลความจุ
- demo 5 ศูนย์ครบ 5 สี
- **ไม่มี** หน้า EOC dashboard ในแอป (FD-14)

### Acceptance (T-70) — blocked T-37

- EOC aggregate มี field derived `occupancy_health` + `occupancy` + `capacity` + `as_of`
- ไม่มี person drill-down
- ทำหลัง T-37 (สูตรชุดเดียวกับ T-69)

## Impact

- UI staff + public ตอนนี้; ไม่แตะ envelope/auth
- FastAPI public shelter DTO อาจส่ง `occupancy_health` คำนวณฝั่ง projection หรือ BFF — เลือกที่เดียว ห้ามสูตรคนละชุด
- Team D เป็นเจ้าของสูตร; Lead รีวิว public plane + T-70
- T-69 พร้อมหลัง approve CR นี้ (Wave 2 ไม่ block แล้ว). T-70 ยัง blocked T-37

## Migration

N/A — derived. ไม่มี doc เดิมให้ migrate.

## Out of scope

- หน้า EOC ใน SPA (FD-14)
- Auto-set `operation_status=full_capacity` จากสูตร (ถ้าต้องการ ต้อง CR แยก)
- Block check-in เมื่อแดงเข้ม (คง warning-only)
- เพิ่มค่า enum `operation_status`

## Decision log

- 2026-08-13 — proposed. **ยังไม่ approve CR.** ไม่ bump schema_v.
- 2026-08-13 — **D-HEALTH-PCT ล็อก** โดยเจ้าของโครงการ: เทา=ปิด (ไม่ใช่ %) · ฟ้า &lt;60% · เหลือง 60–89% (90% เป็นแดง) · แดง 90–100% · แดงเข้ม &gt;100%. สูตร derived `occupancy/capacity` — ไม่ persist. `capacity=0` → ไม่มีข้อมูลความจุ. ตัวเศษ Wave 1 = `active`; **ถูกทับที่ Wave 3** (ดูด้านล่าง).
- 2026-08-13 — **Wave 2 ล็อก** โดยเจ้าของโครงการ: D-STANDBY=**A** (`standby` = เทา, ไม่เข้า %) · D-HEALTH-VS-STATUS=**B** (ทับคำแนะนำ A ของ John — `full_capacity` บังคับแดงแม้ occupancy &lt;100%) · D-HEALTH-SURFACE=**A** (staff + public ตอนนี้; EOC = ฟิลด์ API ทีหลัง T-70; ห้าม dashboard ในแอป).
- 2026-08-13 — **Wave 3 D-BOOK-OCC=C** ทับตัวเศษ occupancy ของสูตร health: นับ stay `active` **และ** `pre_registered` (กฎเดียวกันทั้งศูนย์และบ้านพี่เลี้ยง). ทับ T-04/T-06 ที่เคยไม่นับจอง — สำหรับสี health / public occupancy / การจองเท่านั้น. Kitchen/SOP คนอยู่จริง (CR-022) ยัง `active` only. CR นี้ยัง `proposed`. **ไม่ bump schema.md.**
- 2026-08-13 — **approved** โดยเจ้าของโครงการ (IMPS): D-HEALTH-PCT + D-STANDBY=A + D-HEALTH-VS-STATUS=B + D-HEALTH-SURFACE=A + ตัวเศษ D-BOOK-OCC=C. T-70 ยัง sequenced หลัง T-37 (ไม่ใช่ Wave 4). **ไม่ bump schema.md.**
