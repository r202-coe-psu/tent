---
id: CR-182
title: Partner API — `accepts_booking` (EXT-002/003) + EXT-008 bookability rule + scope `booking-bypass`
status: approved
date: 2026-10-21
requested_by: Dev Team (issue #751; M2 ไม่มีทางรู้ล่วงหน้าว่าศูนย์ไหนรับจอง)
decided_by: เจ้าของโครงการ (ตัดสิน 7 ข้อใน issue #751 / plan 2026-10-21) — owner อนุมัติ CR นี้ 2026-10-21 (ระหว่างรีวิว PR #753)
layer: volatile
extends: CR-154 (FR-15/16 — EXT-008 bookability), CR-169 (EXT-008 group booking; Idempotency-Key #614)
affects:
  - docs/data/api-contract.md §5.3 (EXT-002/003 field + filter, EXT-008 rule + bypass, error codes, access log)
  - docs/data/schema.md §9.4 (`status` เพิ่ม `granted_bypass`), §9.6 (`allowed_scopes` เพิ่ม `booking-bypass`), §9.7 (`external_bookings.bypass`)
  - docs/adr/0002-partner-integration-architecture.md (scope list + bookability/bypass + sensitive scopes)
  - packages/tent-model (`THIRD_PARTY_SCOPES`, `ExternalBooking.bypass`, access-log status comment)
  - backend/apiapp/utils/shelter_booking.py (ใหม่), modules/{shelter,thirdparty_locations,thirdparty_bookings}
  - frontend/src/lib/features/third-party-clients/domain/third-party-client.ts, frontend/src/lib/api-specs/fastapi.json + api/openapi.d.ts
  - scripts/smoke_test_partner_api.py
  - tests: backend/tests/test_thirdparty_{locations,bookings,clients_admin}.py, test_shelter.py, frontend/e2e/partner-api.test.ts
why: partner (M2) จองผ่าน EXT-008 แต่รู้ว่าศูนย์ "รับจอง" ไหมได้จาก 409 เท่านั้น; และกติกาไม่ตรงกับ public plane (ศูนย์ที่ไม่มี flag หน้า public = ปิดรับ แต่ EXT-008 = จองได้); EOC ต้องจองเข้าศูนย์ที่ปิดรับได้เป็นกรณีพิเศษ
migration: N/A — ไม่ bump `schema_v` (`external_bookings` เป็น Beanie doc ไม่มี `schema_v`; เพิ่ม `bypass` แบบ additive default `false`), ไม่ bump `PROJECTION_VERSION` (อ่านจาก `raw_data`); breaking เชิงพฤติกรรมสำหรับ M2 — ดู Rollout
---

# CR-182 — `accepts_booking` + `booking-bypass`

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** (1) EXT-002/003 คืน `accepts_booking: bool` + EXT-002 filter `?accepts_booking=true|false`;
>   (2) EXT-008 ใช้กติกาเดียวกัน — **ไม่มี flag `accepts_pre_registration` = จองไม่ได้ (409)**;
>   (3) scope ใหม่ `booking-bypass` ให้ EOC จองข้ามกติกา (รวม `closed`) พร้อมบันทึกใน log
> - **Breaking สำหรับ M2:** ศูนย์ที่ staff ไม่เคยเปิด switch จะตอบ **409 `location_not_bookable`** หลัง deploy (เดิม 201)
> - **กระทบ schema:** `external_bookings.bypass` (additive), enum ใหม่ `granted_bypass` / `booking-bypass` — ไม่ bump `schema_v`

## Why

- M2 รู้ว่าศูนย์ไหนจองได้จาก 409 `location_not_bookable` เท่านั้น — EXT-002/003 มีแค่ `location_status`
- กติกาไม่สอดคล้อง: ศูนย์ที่ **ไม่มี** `feature_flags.accepts_pre_registration` (ส่วนใหญ่) หน้า public =
  ปิดรับ (`isShelterBookable`) แต่ EXT-008 (CR-154 FR-15/16) บล็อกเฉพาะ `closed` หรือ flag `false` → จองได้
- EOC ต้องมีทางจองเข้าศูนย์ที่ปิดรับ (รวม `closed`) เป็นกรณีพิเศษ โดยตรวจสอบย้อนหลังได้

## Change

ตัดสินโดย owner (issue #751, 2026-10-21):

| # | เรื่อง | Before → After |
| --- | --- | --- |
| 1 | Field | EXT-002/003 ไม่มี → เพิ่ม `accepts_booking: bool` ตามกติกาปกติ ค่าเดียวกันทุก partner (ไม่ขึ้นกับ token/scope) |
| 2 | กติกาปกติ | EXT-008 บล็อกเฉพาะ `closed` หรือ flag `=== false` → `accepts_booking = location_status != "closed" AND raw_data.feature_flags.accepts_pre_registration is True` (**ไม่มี flag = จองไม่ได้**; ตรงกับ public `isShelterBookable`); ศูนย์ `full` ยังจองได้ถ้า switch เปิด |
| 3 | Scope | `booking-bypass` ใหม่ — ใช้คู่ `booking-write` (ต้องมี `booking-write` ด้วย มิฉะนั้น 403 `insufficient_scope`); sensitive, ไม่อยู่ใน preset ใด (รวม M7), admin ติ๊กรายกรณี |
| 4 | ขอบเขต bypass | ข้ามทุกเงื่อนไขการรับจอง รวม `closed`; ยังได้ 404 `location_not_found` ถ้าศูนย์ไม่มี / `is_active=false` |
| 5 | วิธี bypass | อัตโนมัติเมื่อ token มี `booking-bypass` และศูนย์ไม่ผ่านกติกาปกติ (ไม่ส่ง field เพิ่ม); เฉพาะเมื่อใช้จริง: access log `status = "granted_bypass"` (`result_count = persons_count`) และ `external_bookings.bypass = true` ทุกแถวของกลุ่ม; ไม่ใช้จริง = `granted` / `bypass = false` |
| 6 | Filter | EXT-002 `?accepts_booking=true\|false` กรองใน Mongo (total/pagination ถูกต้อง; ใช้ร่วม `status` ได้); รับเฉพาะสตริงตัวพิมพ์เล็ก `true` / `false` เท่านั้น — ค่าอื่น (`yes`, `on`, `1`, `t`, `True`, ค่าว่าง ฯลฯ) → 422 `validation_error` |
| 7 | ไม่ทำ | EXT-006 ไม่เพิ่ม field; ไม่เพิ่มป้ายหน้า staff (ไม่แตะ evacuee schema) |

หมายเหตุ implementation:

- กติกา `accepts_booking` อยู่ที่เดียว `backend/apiapp/utils/shelter_booking.py`; public `accepts_pre_registration`
  (flag อย่างเดียว) ใช้ helper เดียวกัน — พฤติกรรม public ไม่เปลี่ยน (ศูนย์ `closed` + flag true ยังรายงาน `true` ที่ public)
- Idempotency replay (`Idempotency-Key` + body เดิม) คืน 201 เดิมโดยไม่ตรวจ bookability ซ้ำ และ log เป็น `granted`
  (ไม่ใช่ `granted_bypass`) — ตัว booking เดิมยังมี `bypass = true` ในแถว

## Impact

- Code/test/docs ตาม `affects:` ด้านบน; OpenAPI regenerate (`fastapi.json` + `openapi.d.ts`)
- แถว `external_bookings` เดิมไม่มี key `bypass` → อ่านเป็น `false` (worker ไม่อ่าน field นี้)
- **Seed data (`frontend/scripts/seed*`) ไม่ตั้ง `accepts_pre_registration`** → ศูนย์ seed (เช่น SH004) จะ **จองไม่ได้** ตามกติกาใหม่;
  smoke test (`scripts/smoke_test_partner_api.py`) เลือก candidate ด้วย `?accepts_booking=true` แต่ต้องเปิด switch ศูนย์เป้าหมายก่อนรัน

## Rollout (ต้องทำก่อน deploy production)

1. **แจ้ง M2** — ศูนย์ที่ไม่ได้เปิด switch "รับลงทะเบียนเข้าพักล่วงหน้า" จะได้ **409 `location_not_bookable`** (เดิม 201);
   M2 ควรใช้ `accepts_booking` / `?accepts_booking=true` จาก EXT-002/003 เลือกศูนย์
2. **Staff เปิด switch** ที่ศูนย์ที่รับจองจริง (staff UI → shelter feature flag `accepts_pre_registration`) ก่อน deploy
3. Deploy; ตรวจ EXT-002 `?accepts_booking=true` ว่ามีศูนย์ตามที่คาด
4. ให้ admin ติ๊ก `booking-bypass` เฉพาะ client ของ EOC รายกรณี (ไม่ preset); ตรวจ access log `granted_bypass` เป็นระยะ
5. As-Built §0 ระบุ breaking change นี้ (หลัง merge)

## Migration

N/A — ไม่ bump `schema_v`: `external_bookings` ไม่มี `schema_v` และ `bypass` เป็น additive field default `false`;
ไม่ bump `PROJECTION_VERSION` (กติกาอ่านจาก `raw_data`); `allowed_scopes` / access-log `status` เป็นค่า enum/ข้อความใหม่ ไม่แตะ record เดิม

## Decision log

- 2026-10-21 — owner ตัดสิน 7 ข้อ (issue #751 / plan); ทดสอบล็อกที่ commit `02ffa8266`
- 2026-10-21 — proposed เป็น draft CR (ก่อนได้เลข CR-182) (Dev เขียน CR ตาม memory "implementer writes the CR"; รอ owner อนุมัติเลข CR + ช่องทาง track)
- 2026-10-21 — owner อนุมัติ (approved) ระหว่างรีวิว PR #753
