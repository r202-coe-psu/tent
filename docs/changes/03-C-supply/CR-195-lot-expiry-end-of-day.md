---
id: CR-195 # renumbered from draft-lot-expiry-end-of-day
title: วันหมดอายุแบบวันที่ (`YYYY-MM-DD`) ใช้ได้ถึงสิ้นวันตามเวลาไทย — หมดอายุตั้งแต่ 00:00 Asia/Bangkok ของวันถัดไป
status: approved
date: 2026-10-25
requested_by: Dev Team B feedback — roleplay 23/10/69 (GitHub #824)
decided_by: kong
decision_date: 2026-10-26
updated: 2026-10-30 # approved (kong) · CR-216 FR-X3 ล็อตติดลบ
layer: volatile
amends: CR-143 (§A FR-A4)
affects:
  - docs/changes/03-C-supply/CR-143-stock-redesign-rules.md §A FR-A4 (นิยาม "หมดอายุ" ของ `lot.expiry`)
  - docs/changes/03-C-supply/CR-156-stock-redesign-amendment.md §A FR-A4a — อ้างอิง ไม่แก้ (D3-a คงนิยามล็อตที่หมดอายุตาม `shelf_life_days`)
  - docs/data/schema.md §2.1 stock_ledger `lot.expiry` (รูปแบบค่า + ความหมาย) และย่อหน้าลำดับล็อต (~บรรทัด 385–386) — ไม่เปลี่ยนรูป doc, ไม่ bump schema_v
  - frontend/src/lib/features/operations/domain/lot-priority.ts (parseMs, isLotExpired, scoreLot)
  - frontend/src/lib/features/operations/domain/lot-age.ts (timeUntilExpiryMs, nearest expiry)
  - frontend/src/lib/features/operations/domain/stock-summary.ts (earliest expiry, การ์ด "หมดอายุ")
  - frontend/src/lib/features/operations/ui/stock/stock-view.ts (byEarliestExpiry — เรียงด้วย expiryInstant)
  - frontend/src/lib/features/operations/ui/adjust-stock-form.svelte (isExpired)
  - frontend/src/lib/features/operations/ui/cycle-count-form.svelte (formatExpiry)
  - frontend/src/lib/features/distribution/domain/food-supplies/food-safety.ts (lotExpiryStatus, isLotExpired)
  - frontend/src/lib/features/distribution/ui/model/physical-lot.ts (isLotDateExpired)
  - frontend/src/lib/features/distribution/application/food-supplies/dispatch-workflow.ts (lotExpiryMs)
  - frontend/src/lib/features/donations/domain/back-office.ts (walkInIntakeInputSchema `lot.expiry`)
  - frontend/src/lib/utils/date.ts (มี bangkokToday / DISPLAY_TIME_ZONE อยู่แล้ว)
  - GitHub #824
why: ของที่วันหมดอายุ = วันนี้ ถูกแสดงว่าหมดอายุแล้วตั้งแต่ 07:00 เพราะ `Date.parse('YYYY-MM-DD')` ตีความเป็น 00:00 UTC และ CR-143 FR-A4 (`lot.expiry ≤ now`) ไม่ได้นิยามว่าวันหมดอายุแบบวันที่ใช้ได้ถึงเมื่อไร
migration: N/A — ไม่เพิ่ม/ลบ field, ไม่เปลี่ยนชนิด, ไม่ bump schema_v, ไม่ backfill; ค่าเดิมทุกแถวอ่านด้วยนิยามใหม่ทันที
---

# วันหมดอายุแบบวันที่ใช้ได้ถึงสิ้นวันตามเวลาไทย

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** `lot.expiry` ที่เป็นวันที่ล้วน (`YYYY-MM-DD`) หมายถึง "ใช้ได้ตลอดวันนั้นตามเวลาไทย" → หมดอายุเมื่อ `now ≥ 00:00 Asia/Bangkok ของวันถัดไป`; ค่าที่มีเวลา (เช่นอาหารปรุงสำเร็จ `cooking_completed_at + 4h`) หมดอายุ ณ เวลานั้นตามเดิม
- **เพื่อใคร/ทำไม:** เจ้าหน้าที่คลัง/แจกจ่าย — ปัจจุบันของที่หมดอายุวันนี้ถูกบล็อกจากการเบิกและถูกนับเป็น "หมดอายุ" ตั้งแต่ 07:00 (#824)
- **Dev ต้อง build:** ฟังก์ชันกลางเดียวแปลง `lot.expiry` → instant ที่หมดอายุ แล้วให้ทุกจุดใน `affects` ใช้ตัวนี้; ตรวจรูปแบบ `lot.expiry` ของ walk-in
- **กระทบ schema:** ไม่มี — แก้คำอธิบาย `lot.expiry` ใน `docs/data/schema.md` §2.1 เท่านั้น ไม่ bump `schema_v`

## Change

|                                              | Before                                                                                        | After                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| นิยามหมดอายุ (CR-143 FR-A4)                  | `lot.expiry ≤ now` โดยไม่ระบุว่าค่าแบบวันที่หมายถึงเวลาใด                                     | `now ≥ expiryInstant(lot.expiry)` ตาม FR-X2                        |
| `'2026-10-23'`                               | parse เป็น 2026-10-23T00:00Z = **07:00** เวลาไทยของวันที่ 23 → หมดอายุตั้งแต่ 07:00 วันที่ 23 | หมดอายุตั้งแต่ **00:00** เวลาไทยของวันที่ 24 (= 2026-10-23T17:00Z) |
| `'2026-10-23T14:30:00+07:00'` (meal_service) | หมดอายุ ณ 14:30                                                                               | ไม่เปลี่ยน — หมดอายุ ณ 14:30                                       |
| ตรรกะ                                        | กระจายอยู่ 6+ จุด แต่ละจุด `Date.parse` / `new Date` เอง                                      | ฟังก์ชันกลางเดียว (FR-X1)                                          |
| walk-in `lot.expiry`                         | `z.string().optional()` — ไม่ตรวจรูปแบบ                                                       | ตรวจรูปแบบตาม FR-X6                                                |

## Requirements

- **FR-X1** ระบบต้องมีฟังก์ชันกลาง **หนึ่งชุด** สำหรับ `lot.expiry` (ตำแหน่งแนะนำ: `operations/domain` export ผ่าน barrel `$lib/features/operations`; ใช้ `DISPLAY_TIME_ZONE` จาก `$lib/utils/date.ts`)
  - `expiryInstant(expiry): number` — epoch ms ของเวลาที่เริ่มหมดอายุ; `NaN` เมื่อว่าง/รูปแบบไม่ถูก
  - `isExpiryPassed(expiry, now): boolean` — `now ≥ expiryInstant(expiry)`; ค่าว่าง/ไม่ถูกรูปแบบ = `false`
- **FR-X2** `expiryInstant` แปลงค่าดังนี้:
  - วันที่ล้วน `YYYY-MM-DD` → 00:00 Asia/Bangkok ของ **วันถัดไป** (`Date.parse(\`${d}T00:00:00+07:00\`) + 1 วัน`)
  - ISO datetime ที่มี offset หรือ `Z` → instant นั้นตรง ๆ
  - ISO datetime ที่ไม่มี offset (ค่า legacy) → ตีความเป็นเวลา Asia/Bangkok
- **FR-X3** แทนที่ CR-143 FR-A4: ล็อตที่ `isExpiryPassed(lot.expiry, now)` ต้องไม่ถูกเลือกอัตโนมัติ และ UI ต้องแจ้งให้ปรับยอดออก — ยกเว้นล็อตที่ติดลบ ซึ่งแสดงคำเตือนล็อตติดลบแทน ([CR-216](CR-216-negative-stock-lots.md) FR-10) (พฤติกรรมอื่นของ FR-A4 คงเดิม)
- **FR-X4** ทุกจุดใน `affects` ที่ตัดสินว่า "หมดอายุหรือยัง" ต้องเรียก FR-X1 — ห้าม `Date.parse(lot.expiry)` / `new Date(lot.expiry)` เพื่อเทียบกับ `now` เอง ได้แก่ `isLotExpired` (operations + distribution), `isLotDateExpired`, `isExpired` ใน adjust-stock-form, `formatExpiry` ใน cycle-count-form, `lotExpiryStatus`
- **FR-X5** ตาม D1: `daysLeft`, `isUrgent`, ลำดับล็อต (FR-A1/A3), นาฬิกา "เหลือหมดอายุ" (`timeUntilExpiryMs`), earliest expiry ใน stock-summary, การเรียง `byEarliestExpiry` ใน stock-view และ `lotExpiryMs` ใน dispatch-workflow ต้องคำนวณ/เทียบ/เรียงจาก `expiryInstant` เดียวกัน — ห้าม `Date.parse` สตริง expiry เพื่อเรียงเอง (`earliestExpiry` ใน stock-summary มีทั้งวันที่ล้วนและ ISO instant ของล็อต `shelf_life_days` ปนกัน)
- **FR-X6** `walkInIntakeInputSchema.items[].lot.expiry` ต้องรับเฉพาะ `YYYY-MM-DD` ที่เป็นวันที่จริง (เช่น `2026-02-30` = reject) หรือว่าง; ค่าไม่ถูกรูปแบบ → validation error ภาษาไทยที่ช่องนั้น
- **FR-X7** การแสดงวันหมดอายุแบบวันที่ล้วนต้องแสดงวันตามที่บันทึก (`23 ต.ค.`) ไม่เลื่อนวันตาม timezone — ค่าที่ส่งไปแสดงผล (รวม `earliestExpiry`) ต้องเป็นสตริง `lot.expiry` เดิม ห้ามแปลง `expiryInstant` กลับเป็นสตริงเพื่อแสดง (`'2026-10-23'` → `2026-10-23T17:00Z` จะแสดงเป็น `24 ต.ค.`)

## Acceptance

`now` ทั้งหมดเป็นเวลา Asia/Bangkok; ใช้ฟังก์ชันกลาง + ทุก call site ใน FR-X4

- **AC-X1** `lot.expiry = '2026-10-23'`, now = 2026-10-23 07:30 → **ยังไม่หมดอายุ**; เลือกอัตโนมัติได้; ฟอร์มปรับยอดไม่แสดงป้าย "หมดอายุ"
- **AC-X2** `lot.expiry = '2026-10-23'`, now = 2026-10-23 23:59:59 → ยังไม่หมดอายุ
- **AC-X3** `lot.expiry = '2026-10-23'`, now = 2026-10-24 00:00:00 → หมดอายุ
- **AC-X4** `lot.expiry = '2026-10-23'`, now = 2026-10-24 03:00 (ช่วง 00:00–07:00 ที่วันที่ UTC ยังเป็นวันที่ 23) → หมดอายุ
- **AC-X5** `lot.expiry = '2026-10-22'` (เมื่อวาน), now = 2026-10-23 10:00 → หมดอายุ; ไม่อยู่ในแผนเบิกอัตโนมัติ; นับในการ์ด "หมดอายุ"
- **AC-X6** `lot.expiry = '2026-10-23T14:30:00+07:00'` → 14:29 ยังไม่หมด, 14:30 หมดอายุ (นาฬิกา 4 ชม. ของ CR-159 FR-MQW-06 ทำงานเหมือนเดิม)
- **AC-X7** `lot.expiry` ว่าง / `'abc'` → `isExpiryPassed = false`, `expiryInstant = NaN`
- **AC-X8** walk-in ส่ง `lot.expiry = '23/10/2026'` หรือ `'2026-02-30'` → validation error; `'2026-10-23'` หรือว่าง → ผ่าน
- **AC-X9** หน้าคลัง: สินค้า A มีล็อต `lot.expiry = '2026-10-23'`, สินค้า B มีล็อต `shelf_life_days` ที่หมดอายุ 2026-10-23T12:00:00+07:00, now = 2026-10-23 08:00, ระดับ urgency เท่ากัน → B เรียงก่อน A (`byEarliestExpiry`); A แสดงวันหมดอายุ `23 ต.ค.` (ไม่ใช่ `24 ต.ค.`)
- **AC-X10** regression: test ของ `operations/**` และ `distribution/**` (รวม CR-178 FR-3 ห้ามเลือก lot หมดอายุ) ผ่าน หลังปรับ expectation ที่เปลี่ยนตามนิยามใหม่

## Decisions (เคาะแล้ว 2026-10-26 — ตามที่ผู้เสนอ PR #868 (Hopewalk) เสนอ)

- **D1 = D1-a** — `daysLeft` / ลำดับล็อต / กลุ่มเร่งด่วน / ข้อความ "หมดอายุอีก N วัน" ใช้ instant สิ้นวันเดียวกับ "หมดอายุหรือยัง" (FR-X5)
- **D2 = D2-a** — ตรวจรูปแบบ `lot.expiry` เฉพาะ walk-in ตาม #824 (FR-X6); input อื่น (`operations.ts` lot schema, `public-donation.ts`) แยก CR ภายหลัง — `meal_service` เขียน datetime จึงต้องรับทั้งสองรูปแบบที่ระดับ ledger
- **D3 = D3-a** — ล็อตที่ไม่มี `lot.expiry` และหมดอายุตาม `shelf_life_days` (CR-156 FR-A4a) คงนิยามเดิม: instant แน่นอน `(produced_at ?? received_at) + shelf_life_days × 24h` (ไม่ปัดเป็นสิ้นวัน). ค่า `lot.expiry` ที่ UI เติมตอนรับเข้า (`suggestExpiry`) เป็นวันที่ล้วนอยู่แล้วจึงได้นิยามใหม่ผ่าน FR-X2

## Impact

- **docs (ตอน approve — ไม่แก้ใน draft นี้):**
  - `docs/data/schema.md` §2.1 — คำอธิบาย `lot.expiry`: ชนิด `date (YYYY-MM-DD) | ts`; วันที่ล้วน = ใช้ได้ถึงสิ้นวัน Asia/Bangkok; ts = หมดอายุ ณ เวลานั้น; อัปเดต `updated:`
  - CR-143 FR-A4 — เพิ่มหมายเหตุ "นิยามหมดอายุ: ดู CR-NNN FR-X2" (owner เป็นผู้ตัดสินว่าจะแก้ไฟล์ CR เดิมหรืออ้างอิงจาก CR นี้อย่างเดียว); CR-156 FR-A4a ไม่เปลี่ยน (D3-a)
- **code:** ตาม `affects`; ไม่มี worker/backend ที่เทียบ `lot.expiry` กับเวลา (ตรวจแล้ว `worker/src`, `backend/apiapp`) และ `validate_doc_update` ไม่ตรวจ `lot.expiry`
- **test:** unit test ฟังก์ชันกลางตาม AC-X1–X7 (fake `now` ที่ระบุ offset +07:00 ชัดเจน ไม่พึ่ง TZ ของเครื่องที่รัน), AC-X8 ใน test ของ `back-office.ts`, AC-X9 ใน test ของ `stock-view.ts` + `stock-summary.ts`, regression AC-X10

## Migration

N/A — ไม่เปลี่ยนรูป doc ไม่ bump `schema_v` ไม่ backfill. ทุกแถวที่มี `lot.expiry` แบบวันที่ล้วนจะ "ใช้ได้นานขึ้น 17 ชม." ทันทีที่ deploy (ล็อตที่เคยแสดงว่าหมดอายุตั้งแต่ 07:00 ของวันหมดอายุจะกลับมาเลือกได้จนถึงเที่ยงคืน). แถว datetime เดิมพฤติกรรมไม่เปลี่ยน

## Why

- **ที่มา:** roleplay 23/10/69 — รับของบริจาคเข้าคลังโดยกรอกวันหมดอายุ 23/10 (วันนี้) ระบบแสดงว่าหมดอายุแล้ว (#824)
- **สาเหตุทางเทคนิค:** ECMAScript ตีความสตริง date-only เป็น UTC → `'2026-10-23'` = 07:00 เวลาไทย; FR-A4 `lot.expiry ≤ now` จึงทำให้ของหมดอายุตั้งแต่ 07:00 ของวันหมดอายุ และช่วง 00:00–07:00 ทุกวันผลลัพธ์ไม่ตรงกับวันตามปฏิทินไทย
- **ทำไมสิ้นวัน:** ฉลาก "หมดอายุ/EXP 23/10" ตามการใช้งานทั่วไปหมายถึงใช้ได้ถึงสิ้นวันที่ 23; ศูนย์ทั้งหมดอยู่ในประเทศไทย จึงใช้ Asia/Bangkok คงที่ (ไม่ผูก timezone ต่อศูนย์)
- **ทำไมฟังก์ชันกลาง:** ปัญหาเดียวกันซ้ำอยู่ 6+ จุด ทำให้ผลลัพธ์ของหน้าคลัง ปรับยอด นับสต็อก และแจกจ่ายไม่ตรงกัน (ขัด CR-143 FR-A5 ที่ต้องใช้ตรรกะเดียวทั้งระบบ)

## Decision log

- 2026-10-25 — proposed (draft จาก GitHub #824) · รอ owner เคาะวิธี track, D1–D3 และการ approve
- 2026-10-26 — เคาะ D1-a, D2-a, D3-a ตามที่ผู้เสนอ PR #868 (Hopewalk) เสนอ · รอ approve
- 2026-10-26 — **approved** โดย kong → รันเลข CR-195 (หมวด 03-C-supply). แก้ CR-143 FR-A4 + `schema.md` §2.1 ใน PR implement ตามหลัง (#824)
- 2026-10-30 — แก้ FR-X3 ตาม [CR-216](CR-216-negative-stock-lots.md) (approved kong)
