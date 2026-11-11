---
id: draft
title: รายงานผู้พักพิงที่ยังไม่มีบันทึกรับอาหารครบ 2 มื้อ — แท็บใหม่ใน /back-office/distribution
status: proposed
date: 2026-11-12
requested_by: feedback หน้างาน — issue #1300
decided_by: project owner
layer: volatile
affects:
  - docs/sitemap.md (`/back-office/distribution` เพิ่มมุมมอง `?view=meal_coverage`)
  - docs/changes/03-C-supply/CR-121-spec-ticket.md (หน้า back-office distribution)
  - docs/changes/03-C-supply/CR-240-household-meal-pickup.md (อ้างอิง — ยังไม่ implement ใน code, ดู FR-MCR-22)
  - frontend/src/lib/server/shelter-access-design.ts (`DISTRIBUTION_LOG_DAY_MANGO_INDEX` — fields `type`, `distributed_at`)
  - frontend/scripts/redeploy-access.ts, frontend/src/lib/server/shelters.admin.ts, frontend/src/lib/features/shelters/server/provisioner.ts (deploy index: ศูนย์เดิม + ศูนย์ใหม่)
  - frontend/scripts/seed/distribution.ts (log ย้อนหลัง 1 วันสำหรับทดสอบ)
  - frontend/src/lib/features/distribution (domain `meal-coverage`, data `DistributionLogRepository.listByDistributedDay`, hook `useDistributionLogsByDay`, แท็บ `MealCoveragePanel`)
  - frontend/src/lib/features/shared (`wasInShelterAllDay`, `zoneOnDay`)
  - frontend/src/lib/features/kitchen (`cooking-ingredients.ts` สร้าง category id ตอนเรียกใช้ ไม่ใช่ตอน import; `mealServiceReceiptOutcome` รับ `Pick<…,'outcome'>` — พฤติกรรมเดิม)
  - frontend/src/lib/utils/download-csv.ts (ย้ายจาก features/operations เพื่อใช้ร่วม)
  - PR #1318 (implementation)
why: >
  เจ้าหน้าที่ตามตัวผู้พักพิงที่อาจตกหล่นไม่ได้ เพราะไม่มีหน้าไหนสรุปว่าใครมีบันทึกรับอาหารไม่ถึง 2 มื้อต่อวัน
migration: >
  N/A — อ่านอย่างเดียว ไม่เพิ่ม/แก้ field ใน doc ใด ไม่ bump `schema_v`.
  ศูนย์ที่มีอยู่แล้วต้องรัน `pnpm redeploy:access` หนึ่งครั้งเพื่อสร้าง Mango index ใหม่ (ถ้าไม่รัน query ยังทำงาน แต่ scan ทั้ง DB); ศูนย์ที่สร้างใหม่ได้ index จาก provisioner
---

# draft-meal-coverage-report — ผู้ยังไม่ได้รับอาหารครบ

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** แท็บที่ 3 ใน `/back-office/distribution` (`?view=meal_coverage`) แสดงผู้พักพิงที่ **ยังไม่มีบันทึกรับอาหารครบ 2 มื้อ** ของวันที่เลือก (ย้อนหลัง หรือวันนี้)
> - **เพื่อใคร:** เจ้าหน้าที่พัสดุ/ผู้จัดการศูนย์ ใช้ตามตัวผู้ที่อาจตกหล่น พร้อมตัวกรอง ค้นหา แบ่งหน้า และ export CSV
> - **ข้อมูล:** อ่าน `distribution_log` + `movement` + `evacuee` + `meal_service` เดิม ไม่มี schema ใหม่ ไม่ bump `schema_v`; เพิ่ม Mango index 1 ตัว
> - **รอ owner ยืนยัน:** ค่าเริ่มต้น 6 ข้อใน §5 (implement ตามค่าเริ่มต้นแล้วใน PR #1318)

---

## Why

- ไม่มีหน้าไหนบอกว่าผู้พักพิงคนไหนยังไม่มีบันทึกรับอาหารครบ 2 มื้อใน 1 วัน (issue #1300)
- รายชื่อเต็มศูนย์มีหลายร้อยคน จึงต้องกรอง ค้นหา และแบ่งหน้าได้ และต้องส่งต่อรายชื่อให้คนเดินตามตัวได้
- บันทึกการแจกไม่ครบเสมอ (แจกโดยไม่สแกน, รับแทนครัวเรือน) หน้าจึงต้องบอกข้อจำกัดของตัวเลขให้เห็น

## Change

### 1. การนับมื้อ

| ID | Requirement |
| --- | --- |
| FR-MCR-01 | นับ `meal` ที่ต่างกันของ `distribution_log` ต่อ `recipient_id` ต่อวันไทย (`distributed_at` ตามเวลา Asia/Bangkok) |
| FR-MCR-02 | นับเฉพาะ `breakfast` / `lunch` / `dinner`; `snack` ไม่นับ |
| FR-MCR-03 | ไม่นับ log ที่ `voided`, ของยืมคืน (`is_returnable`) และ log ที่ไม่มี `meal` ใช้ฟังก์ชันเดียวกับเช็คกินซ้ำ (`servedMealOfLog`) |
| FR-MCR-04 | มื้อเดียวกันซ้ำ (override) นับเป็น 1 มื้อ |
| FR-MCR-05 | นับที่ `recipient_id` เท่านั้น ไม่ให้เครดิตผู้มารับแทน (`collected_by_recipient_id`); log ของ `volunteer` / `staff` / `outside` ไม่สร้างแถว |
| FR-MCR-06 | เกณฑ์ 2 มื้อตายตัว (constant `MIN_MEALS_PER_DAY` ใน domain) |

### 2. ฐานคน

| ID | Requirement |
| --- | --- |
| FR-MCR-07 | แสดงเฉพาะผู้พักพิงที่อยู่ในศูนย์ **ตลอดช่วงของวันที่เลือก** โดยสร้างช่วงที่อยู่จาก `movement.occurred_at`: เข้า/ออก/ลาชั่วคราว/ย้ายออกระหว่างวัน → ไม่แสดง; `zone_change` ไม่กระทบ |
| FR-MCR-08 | evacuee ที่ไม่มี `movement` เลย → ใช้ `current_stay` (สถานะอยู่ในศูนย์ และ `since` ก่อนวันนั้น) |
| FR-MCR-09 | เฟสนี้ไม่รวมจิตอาสาและเจ้าหน้าที่ (ไม่มีฐาน "อยู่ทั้งวัน" ของกลุ่มนี้) |

### 3. วันที่และโหมดวันนี้

| ID | Requirement |
| --- | --- |
| FR-MCR-10 | เลือกวันได้ถึงวันนี้ ค่าเริ่มต้นคือเมื่อวาน วันอนาคตหรือค่าว่างแสดงข้อความให้เลือกวัน |
| FR-MCR-11 | วันที่ผ่านมา: แสดงผู้ที่มีบันทึกน้อยกว่า 2 มื้อ |
| FR-MCR-12 | วันนี้: "มื้อที่ให้บริการแล้ว" = มื้อที่มี `meal_service` ของ `date` + `meal` นั้นอย่างน้อย 1 ใบ ที่ไม่ถูก reject ตอนตรวจรับ (`meal_service_receipt.outcome = rejected`); ใบที่ยังไม่มี receipt นับว่าให้บริการแล้ว; ใบที่มีหลาย receipt ใช้ receipt ล่าสุดตาม `created_at` |
| FR-MCR-13 | วันนี้: แสดงผู้ที่มีบันทึกน้อยกว่า `min(2, จำนวนมื้อที่ให้บริการแล้ว)` ผู้ที่มีบันทึกครบทุกมื้อที่ให้บริการแล้วไม่ถูกแสดง; จำนวนบันทึกนับทุกมื้อหลักที่มี log ในวันนั้น รวมมื้อที่ยังไม่มี `meal_service` |
| FR-MCR-13a | วันนี้ และเกณฑ์เหลือ 1 มื้อ: หัวข้อเปลี่ยนเป็น "ผู้พักพิงที่ยังไม่มีบันทึกรับอาหารของมื้อที่ให้บริการแล้ว" และซ่อนการ์ด/ตัวเลือกสถานะ "มีบันทึก 1 มื้อ"; มื้อที่ยังไม่ให้บริการแสดง badge "ยังไม่ถึงมื้อ" |
| FR-MCR-14 | วันนี้ และยังไม่มีมื้อที่ให้บริการแล้ว → แสดงข้อความ "ยังไม่มีมื้อที่ให้บริการวันนี้" ไม่แสดงรายชื่อ |
| FR-MCR-15 | วันนี้: ฐานคนคือผู้ที่อยู่ในศูนย์ตั้งแต่ 00:00 ถึงเวลาปัจจุบัน; คอลัมน์ "มื้อที่ยังไม่มีบันทึก" แสดงเฉพาะมื้อที่ให้บริการแล้ว |

### 4. หน้าจอ

| ID | Requirement |
| --- | --- |
| FR-MCR-16 | การ์ดสรุป 3 ใบ: อยู่ในศูนย์ตลอดวัน, ยังไม่มีบันทึกเลย, มีบันทึก 1 มื้อ กดแล้วกรองตาราง |
| FR-MCR-17 | แถบตัวกรองบนหัวตาราง: ค้นหาชื่อ, สถานะ (ทุกสถานะ / ยังไม่มีบันทึกเลย / มีบันทึก 1 มื้อ), โซน และจำนวน "พบ n จาก m คน" |
| FR-MCR-18 | ตาราง: ชื่อ, โซน, มื้ออาหาร (badge ต่อมื้อ พร้อมไอคอนและข้อความ), สถานะ เรียงผู้ที่ไม่มีบันทึกเลยก่อน แล้วเรียงตามชื่อ |
| FR-MCR-19 | แบ่งหน้า 20 คนต่อหน้า ฝั่ง client; เปลี่ยนวัน/ตัวกรอง/คำค้นแล้วกลับหน้า 1 |
| FR-MCR-20 | โซน = โซนของผู้พักพิง ณ สิ้นวันที่เลือก (จาก `movement.zone` ล่าสุดก่อนสิ้นวัน; ไม่มีข้อมูลใช้ `current_stay.zone`) แสดงเป็นชื่อโซนของศูนย์ ไม่มีชื่อจึงแสดงรหัส |
| FR-MCR-21 | ข้อความบนหน้าใช้ "ยังไม่มีบันทึกรับอาหาร" ห้ามใช้ "ไม่ได้กิน" |
| FR-MCR-22 | แถวของผู้ที่สมาชิกคนอื่นใน `household_id` เดียวกันมีบันทึกรับมื้อที่ตนยังขาดในวันนั้น แสดงป้าย "ครัวเรือนมีบันทึกรับ" พร้อมชื่อมื้อ **ป้ายนี้ไม่เปลี่ยนจำนวนมื้อและไม่ตัดแถวออก**; สมาชิกที่ไม่ได้อยู่ในศูนย์ตลอดวันก็นับเป็นผู้มีบันทึกของครัวเรือน |
| FR-MCR-23 | มื้อ (เช้า/กลางวัน/เย็น) ที่ไม่มีบันทึกสแกนของผู้พักพิงเลยทั้งศูนย์ในวันนั้น แสดงคำเตือนสีเหลืองว่ามื้อนั้นอาจแจกโดยไม่สแกน (วันนี้: เฉพาะมื้อที่ให้บริการแล้ว) |
| FR-MCR-24 | มี log ที่อ่านไม่ได้ → เตือนว่าจำนวนมื้ออาจต่ำกว่าความจริง; query ล้มเหลว → แสดง error ไม่แสดงรายการว่าง |
| FR-MCR-25 | ปุ่ม "ส่งออก CSV" ส่งออกรายชื่อตามตัวกรองปัจจุบัน (ทุกหน้า) คอลัมน์: ชื่อ, โซน, มื้อที่มีบันทึก, มื้อที่ยังไม่มีบันทึก, สถานะ, ครัวเรือนมีบันทึกรับ; ไฟล์ UTF-8 มี BOM ชื่อ `meal-coverage-{shelter_code}-{YYYY-MM-DD}.csv`; ไม่มีเลขบัตรหรือเบอร์โทร; ทุก cell ใส่ quote และ cell ที่ขึ้นต้นด้วย `=` `+` `-` `@` ถูกนำหน้าด้วย `'` (กัน formula injection); ปุ่มกดไม่ได้เมื่อไม่มีแถว |

### 5. Data และสิทธิ์

| ID | Requirement |
| --- | --- |
| FR-MCR-26 | data layer มี query log ตามวันไทย (`listByDistributedDay`) คืนเฉพาะ log ที่ `distributed_at` อยู่ในช่วง `[00:00, 24:00)` เวลาไทยของวันที่ขอ ผ่าน Mango `_find` อ่านทีละ 200 ใบตาม `bookmark` จนหมด; request ล้มเหลว = reject |
| FR-MCR-27 | query ใช้ Mango index `distribution-log-type-distributed-at-idx` (fields `type`, `distributed_at`) ที่สร้างโดย `pnpm redeploy:access` (ศูนย์เดิม), provisioner (ศูนย์ใหม่) และ seed; ไม่ระบุ `use_index` — ไม่มี index ก็ยังตอบได้ด้วยการ scan |
| FR-MCR-28 | สิทธิ์เข้าแท็บ = guard เดิมของ `/back-office/distribution` (`requireWarehouseAccess`) ไม่เพิ่ม role; ขอบเขตข้อมูล = shelter DB ของศูนย์ที่เลือก |

## Acceptance

- [ ] AC-01 ได้ breakfast + lunch → ไม่แสดง; ได้มื้อเดียวหรือไม่มี log → แสดงพร้อมมื้อที่ขาด
- [ ] AC-02 มื้อซ้ำ, `voided`, ของยืมคืน, ไม่มี `meal`, `snack` → ไม่นับ
- [ ] AC-03 log `…T17:30Z` นับเป็นวันถัดไปตามเวลาไทย ทั้งใน domain และใน query รายวัน
- [ ] AC-04 นับที่ `recipient_id` ไม่ใช่ผู้มารับแทน
- [ ] AC-05 ผู้ที่ `checked_out` / `temporary_leave` หรือเข้า/ออกกลางวัน → ไม่แสดง
- [ ] AC-06 วันนี้ มี `meal_service` เฉพาะเช้า: ผู้มีบันทึกเช้าไม่แสดง ผู้ไม่มีบันทึกแสดง; `meal_service` ที่ถูก reject ไม่นับเป็นมื้อที่ให้บริการแล้ว
- [ ] AC-07 วันนี้ ไม่มี `meal_service` → ข้อความ "ยังไม่มีมื้อที่ให้บริการวันนี้"
- [ ] AC-08 รายชื่อเกิน 20 คนแสดง 20 คนต่อหน้า; ตัวกรองสถานะ/โซน/คำค้นทำงานร่วมกันและกลับหน้า 1
- [ ] AC-09 ผู้ที่ย้ายโซนหลังวันที่เลือกแสดงโซนของวันที่เลือก
- [ ] AC-10 ป้าย "ครัวเรือนมีบันทึกรับ" ขึ้นเมื่อสมาชิกครัวเรือนมี log ของมื้อที่ขาด และแถวยังอยู่ในรายการ
- [ ] AC-11 มื้อที่ไม่มีบันทึกสแกนเลยทั้งศูนย์ขึ้นคำเตือน
- [ ] AC-12 CSV มีแถวเท่ากับจำนวนตามตัวกรอง เปิดใน Excel อ่านภาษาไทยได้
- [ ] AC-13 query รายวันคืนเฉพาะวันไทยที่ขอ รวมขอบวัน; error ไม่ถูกกลืนเป็นรายการว่าง
- [ ] AC-14 มี unit test ของ domain, view-model, data adapter และ dom test ของแท็บ; ทุก `.svelte` ผ่าน `svelte-autofixer`

## Impact

- อ่านอย่างเดียว ไม่มี write ต่อ doc ใด ไม่กระทบ worker / public plane / FastAPI
- เพิ่ม Mango index 1 ตัวใน shelter DB ผ่าน `redeploy-access.ts` (deploy ต้องรัน `pnpm redeploy:access`)
- แท็บโหลด `evacuee`, `movement` ทั้งศูนย์ (hook เดิม) และ `distribution_log` เฉพาะวันที่เลือก; แบ่งหน้าฝั่ง client เพราะรายชื่อคือผลต่างของสองชุดข้อมูล
- อ่าน `meal_service` / `meal_service_receipt` ผ่าน barrel ของ feature `kitchen`; hook โหลดทุกครั้งที่เปิดแท็บ แต่ผลถูกใช้เฉพาะโหมดวันนี้
- CSV มีชื่อผู้พักพิง (PII ระดับชื่อ) ผู้ใช้ที่เข้าแท็บได้ทุกคน export ได้
- Seed: `scripts/seed/distribution.ts` เพิ่ม log ย้อนหลัง 1 วัน เพื่อให้แท็บมีข้อมูลบน seed ใหม่

## Migration

N/A — ไม่เปลี่ยนรูป doc ที่ persist ไม่ bump `schema_v`

## Decision log

- 2026-11-10 — proposed (เฟสแรก: วันที่ผ่านมา, เฉพาะผู้พักพิง)
- 2026-11-12 — ขยาย: โหมดวันนี้, ตัวกรอง/ค้นหา/แบ่งหน้า, โซนของวันที่เลือก, ป้ายครัวเรือน, คำเตือนมื้อที่ไม่สแกน, export CSV, query รายวัน ค่าเริ่มต้นด้านล่าง implement แล้วใน PR #1318 และรอ owner ยืนยัน

### ค่าเริ่มต้นที่รอ owner ยืนยัน

| # | คำถามใน #1300 | ค่าเริ่มต้นที่ใช้ | ทางเลือกที่ตัดทิ้ง |
| --- | --- | --- | --- |
| 1 | รวมจิตอาสา/เจ้าหน้าที่ไหม | ไม่รวม (FR-MCR-09) | รวมจาก `shift_assignment` — ยังไม่มีนิยาม "อยู่ทั้งวัน" ของกลุ่มนี้ |
| 2 | `meal_service` ที่ถูก reject นับว่าบริการแล้วไหม | ไม่นับ; ใบที่ยังไม่มี receipt นับ (FR-MCR-12) | นับทุกใบ — อาหารที่ถูก reject ไม่ได้ถูกแจก |
| 3 | บทบาทและ shelter scope | guard เดิมของหน้า ไม่เพิ่ม role (FR-MCR-28) | role เฉพาะแท็บ — ต้องแก้ role-permission-matrix |
| 4 | ทำอะไรต่อกับรายชื่อ | Export CSV ระดับชื่อ + โซน (FR-MCR-25) | ลิงก์ไปโปรไฟล์ — role ของหน้านี้เข้า evacuee-management ไม่ได้ทุก role |
| 5 | แจกโดยไม่สแกนรายคน | คำเตือนรายมื้อเมื่อไม่มี log เลยทั้งศูนย์ (FR-MCR-23) | ตัดมื้อนั้นออกจากการนับ — ซ่อนผู้ที่ตกหล่นจริง |
| 6 | ผลบวกลวงจากรับแทนครัวเรือนก่อน CR-240 implement | ป้าย "ครัวเรือนมีบันทึกรับ" ไม่ให้เครดิต (FR-MCR-22) | ให้เครดิตสมาชิกทั้งครัวเรือน — ขัด CR-240 ที่นับต่อสมาชิก |

> [NEEDS DECISION: export CSV ที่มีชื่อผู้พักพิงต้องบันทึก audit แบบ CR-232 หรือไม่ — ค่าเริ่มต้นคือไม่บันทึก]
