---
id: draft
title: ยอดคนในศูนย์ (in-shelter headcount) — นิยามเดียว active + room_confirmed ให้ทุกหน้าใช้ร่วมกัน
status: proposed
date: 2026-10-20
requested_by: ทีม dev (issue #593 — headcount 3 หน้าไม่นับ room_confirmed; พบระหว่างทำ CR-170)
decided_by: project owner (@Fishcanwalk — อนุมัติแนวทาง "in_shelter ทุกจุด + CR ใหม่ + PR เดียว" 2026-10-20)
layer: volatile
affects:
  - docs/data/schema.md §evacuee "Occupancy metrics (CR-112)" — แถว Kitchen / SOP
  - docs/data/schema.md §daily_calc `occupancy_snapshot`
  - docs/changes/05-D-kitchen/CR-022-meal-plan-occupancy-mapping-override.md §1 (headcount source)
  - docs/changes/01-core/CR-170-evacuee-dashboard-range-and-stay-counts.md FR-19 (consumer ของ `active`)
  - frontend/src/lib/features/shared/domain/in-shelter.ts (ใหม่ — นิยามกลาง)
  - frontend/src/lib/features/people/domain/intake-pipeline.ts (`isInShelterStatus`)
  - frontend/src/lib/features/dashboard/domain/occupancy.schema.ts (`in_shelter`)
  - frontend/src/lib/features/shelters/ui/shelter-occupancy-cell.svelte
  - frontend/src/routes/(protected)/back-office/supply/+page.svelte (→ `StockTable`)
  - frontend/src/lib/features/sop-ratios/ui/food-sphere-stock-tab.svelte
  - frontend/src/lib/features/kitchen/domain/occupancy.ts
  - frontend/src/lib/features/resource-calc/data/calculation-snapshot.ts (`daily_calc.occupancy_snapshot`)
  - no schema_v bump (ไม่เปลี่ยนรูปร่าง doc ที่ persist)
---

# ยอดคนในศูนย์ (in-shelter headcount) — นิยามเดียวให้ทุกหน้าใช้ร่วมกัน

> **สรุป (TL;DR):**
>
> - **ยอดคนในศูนย์** = evacuee ที่ `current_stay.status` ∈ {`active`, `room_confirmed`} — นิยามเดียว อยู่ที่
>   `$lib/features/shared` (`IN_SHELTER_STATUSES`, `isInShelterStayStatus`, `countInShelter`)
> - ทุก headcount ที่ใช้คำนวณความจุ / คลัง / อาหาร / SOP ต้องใช้นิยามนี้ (6 จุด ดู FR-3)
> - กลับคำตัดสินเดิม: CR-112 / CR-035 / CR-022 ให้ Kitchen / SOP นับ `active` อย่างเดียว
> - **ไม่เปลี่ยน:** `occupancy_total` ฝั่ง public (สัญญา partner EXT-005), Forecast / Present / In-zone ของ CR-112 ·
>   ไม่ bump `schema_v`

---

## Why

- `room_confirmed` (CR-112) = ยืนยันถึงโซนแล้ว — อยู่ในศูนย์จริง นอนและกินอาหารที่ศูนย์ แต่ 6 จุดนับเฉพาะ `active`
  ตัวเลขจึงต่ำกว่าความจริง: SH001 (dev data) นับได้ 236 จากจริง 287 (ขาด 51 คน)
- CR-170 แก้เฉพาะการ์ด "อยู่ในศูนย์อพยพ" ของ evacuee dashboard (`in_shelter`) และคง `active` ให้ consumer อื่น
  (FR-19) เพื่อรอการตัดสินใจ — ระบบจึงมีสองตัวเลข "คนในศูนย์" ที่ไม่ตรงกัน
- `food-sphere-stock-tab` แจกแจงกลุ่มอายุด้วยยอด `active` คูณสัดส่วนจาก demographics view ที่นับ
  `active` + `room_confirmed` แล้ว (CR-170) — ยอดรวมกับสัดส่วนมาจากคนละกลุ่มคน
- CR-022 เขียนนิยาม headcount (`checked_in`) ก่อนจะมีสถานะ `room_confirmed`; ตาราง Occupancy metrics ของ CR-112
  คง Kitchen / SOP เป็น `active` ไว้เพื่อไม่ให้ตัวเลขเปลี่ยนในรอบนั้น — ไม่ได้ตัดสินว่า `room_confirmed` ไม่ควรกินอาหาร

## Requirements

### นิยาม

- **FR-1** — "ยอดคนในศูนย์" (in-shelter headcount) = จำนวน evacuee ที่ `current_stay.status` ∈ {`active`,
  `room_confirmed`}
- **FR-2** — นิยามต้องมีที่เดียวใน frontend: `$lib/features/shared` export `IN_SHELTER_STATUSES`,
  `isInShelterStayStatus(status)`, `countInShelter(evacuees)`, `inShelterFromStatusCounts(counts)`;
  จุดที่นับยอดคนในศูนย์ต้องเรียกใช้ตัวนี้ ห้ามเขียนรายการสถานะซ้ำเอง

### จุดที่ต้องใช้นิยามนี้

- **FR-3** — 6 จุดต่อไปนี้ต้องใช้ยอดคนในศูนย์ตาม FR-1:

  | #   | จุด                                                 | ใช้ทำอะไร                                                            | เดิม                                 |
  | --- | --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------ |
  | 1   | `dashboard/domain/occupancy.schema.ts` `in_shelter` | การ์ด "อยู่ในศูนย์อพยพ" (CR-170)                                     | `active + room_confirmed` (เขียนตรง) |
  | 2   | `shelters/ui/shelter-occupancy-cell.svelte`         | แถบความจุ + สีเตือนใกล้เต็ม/เต็ม ในรายการศูนย์                       | `active`                             |
  | 3   | `back-office/supply/+page.svelte` → `StockTable`    | จุดสั่งเติม, ปริมาณใช้ต่อวัน, วันที่ของพอใช้                         | `active`                             |
  | 4   | `sop-ratios/ui/food-sphere-stock-tab.svelte`        | ปริมาณอาหารมาตรฐาน Sphere (ค่าตั้งต้นเมื่อไม่กรอกเอง)                | `active`                             |
  | 5   | `kitchen/domain/occupancy.ts`                       | headcount ของแผนอาหาร / รอบมื้อ (CR-022)                             | `active`                             |
  | 6   | `resource-calc/data/calculation-snapshot.ts`        | `daily_calc.occupancy_snapshot` (Daily SOP, CR-035) + SOP simulation | `active`                             |

- **FR-4** — Station 1 "พักในศูนย์แล้ว" (`people/domain/intake-pipeline.ts` `isInShelterStatus`) ต้องอ่านนิยามเดียวกัน
  (ความหมายเดิมตรงกับ FR-1 อยู่แล้ว)
- **FR-5** — field `active` ใน payload `GET …/dashboard/occupancy` คงอยู่และคงความหมายเดิม (`active` อย่างเดียว);
  consumer ใหม่ต้องอ่าน `in_shelter`

### ไม่อยู่ในนิยามนี้ (ไม่เปลี่ยน)

- **FR-6** — `public_shelters.occupancy_total` (worker `projectors/occupancy.py`) คง `active` อย่างเดียว — เป็นสัญญา
  partner EXT-005 ตาม CR-111; หน้า `/shelters` ฝั่ง public ใช้ `occupancy` (Forecast) และ `present` ของ CR-112 อยู่แล้ว
- **FR-7** — Forecast / Present / In-zone ของ CR-112 และ `presentFromCounts` ใน system overview คงเดิม
  (Present รวม `temporary_leave` โดยเจตนา — คนออกชั่วคราวยังจองที่นอน)
- **FR-8** — `distribution_request.active_headcount_snapshot` คงเดิม (เจ้าหน้าที่กรอกเองตอนสร้างคำขอ ไม่ได้คำนวณ)

## Acceptance

- [ ] ตัวเลขช่องจำนวนคนในรายการศูนย์ = การ์ด "อยู่ในศูนย์อพยพ" ของ evacuee dashboard ของศูนย์เดียวกัน
- [ ] หน้าคลังและแท็บ Sphere ใช้ยอดเดียวกับการ์ดนั้นเมื่อไม่ได้กรอกจำนวนคนเอง
- [ ] headcount ของแผนอาหารนับ `room_confirmed` (unit test)
- [ ] `daily_calc` ที่สร้างใหม่บันทึก `occupancy_snapshot` ตามนิยามใหม่; `daily_calc` เดิมไม่ถูกแก้ย้อนหลัง
- [ ] unit test ของ `$lib/features/shared` ครอบคลุมทุก stay status (10 ค่าใน `stayStatusSchema`)
- [ ] `occupancy_total` ของ public plane ไม่เปลี่ยน

## Impact

- **ตัวเลขที่ผู้ใช้เห็นจะสูงขึ้น** ตามจำนวนคนสถานะ `room_confirmed` ของแต่ละศูนย์ (SH001 dev data +51):
  - **คลัง:** ปริมาณใช้ต่อวันสูงขึ้น → สินค้าเข้าสถานะ "ใกล้หมด" เร็วขึ้น
  - **แท็บ Sphere และแผนอาหาร:** ปริมาณอาหารที่คำนวณเพิ่มขึ้น
  - **Daily SOP:** ทรัพยากรที่คำนวณในรอบถัดไปสูงขึ้น
  - **ต้องแจ้ง:** ฝ่ายคลังและฝ่ายครัวก่อน deploy
- **Docs:**
  - `schema.md` — แถว Kitchen / SOP ในตาราง Occupancy metrics และนิยาม `daily_calc.occupancy_snapshot` เปลี่ยนเป็นยอดคนในศูนย์
  - CR-022 §1 และ CR-170 FR-19 อ้างถึง CR นี้เมื่อ approve
- **Code:** ตาม `affects:` (ไม่มีการเปลี่ยน API path / payload shape / view manifest / worker)

## Migration

N/A — ไม่เปลี่ยนรูปร่าง doc ที่ persist, ไม่ bump `schema_v`. `daily_calc` เป็น snapshot-locked: doc ที่สร้างไปแล้วคงค่าเดิม
(ไม่ recalculation ย้อนหลัง); ค่าใหม่มีผลกับ `daily_calc` ที่สร้างหลัง deploy

## Decision log

- 2026-10-16 — CR-170 FR-19: คง `active` ให้ consumer อื่นจนกว่าจะตัดสิน; เปิด issue #593
- 2026-10-20 — owner (@Fishcanwalk) อนุมัติแนวทาง: นิยามเดียว `in_shelter` ทุกจุด, ทำ CR ใหม่, แก้ทุกจุดใน PR เดียว,
  แจ้งฝ่ายคลังและครัว
- 2026-10-20 — proposed (draft); ขอบเขตขยายจาก 3 จุดใน issue เป็น 6 จุด (เพิ่ม dashboard, แผนอาหาร, `daily_calc`);
  ตัด worker `occupancy_total` ออก — สัญญา partner EXT-005 (CR-111)
