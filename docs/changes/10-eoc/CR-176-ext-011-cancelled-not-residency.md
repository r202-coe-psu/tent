---
id: CR-176
title: EXT-011 — booking ที่ยกเลิกก่อน check-in ไม่นับเป็นการเข้าพัก (404 residency_not_found แทน 200 CHECKED_OUT)
status: approved
date: 2026-10-20
requested_by: Dev Team (issue #710, พบจาก partner e2e suite)
decided_by: เจ้าของโครงการ
layer: volatile
extends: CR-154 (EXT-011 residency)
affects:
  - docs/data/api-contract.md §5.3 EXT-011 (แถว `/external/persons/shelter-residency`)
  - docs/data/couchdb-mongodb-sync.md (หมายเหตุสูตร `checked_in_at` ของ projector)
  - worker/src/worker/projectors/evacuee.py (`checked_in_at` = null เมื่อ `cancelled`)
  - worker/src/worker/projection_version.py (4 → 5)
  - backend/apiapp/modules/thirdparty_residency/{residency,use_case}.py (guard `cancelled`)
  - worker/tests/projectors/{test_projectors,test_occupant}.py, backend/tests/test_thirdparty_residency.py
why: partner อ่าน `CHECKED_OUT` ว่า "เคยพักแล้วออกไป" ทั้งที่ไม่เคยเข้าศูนย์
migration: N/A — ไม่เปลี่ยนรูป doc (ไม่ bump `schema_v`); `PROJECTION_VERSION` bump ทำให้ worker bootstrap ใหม่แล้วแก้ `public_person` เดิมเอง
---

# CR-176 — EXT-011: booking ที่ยกเลิกก่อน check-in ไม่นับเป็นการเข้าพัก

> **สรุป (TL;DR):**
>
> - **เปลี่ยนอะไร:** `evacuee` ที่ `current_stay.status = cancelled` ต้องไม่มี `checked_in_at` ใน `public_person` → EXT-011 ตอบ **404 `residency_not_found`**
> - **เพื่อใคร/ทำไม:** partner (M2) ได้ผลถูกต้องหลังยกเลิก booking (EXT-009); ก่อนหน้านี้ได้ **200 `CHECKED_OUT`**
> - **dev ต้อง build:** projector evacuee + guard ใน EXT-011 + `PROJECTION_VERSION` 4 → 5
> - **กระทบ schema:** ไม่มี (`schema_v` คงเดิม)

## Change (before → after)

| | Before | After |
| --- | --- | --- |
| `public_person.checked_in_at` เมื่อ `cancelled` | `current_stay.since` (= เวลา cancel) | `null` (เหมือน `pre_registered` / `kiosk_registered`) |
| EXT-011 เมื่อ `cancelled` | 200 `CHECKED_OUT` | 404 `residency_not_found` |

- `cancelled` เกิดได้จาก `pre_registered` / `kiosk_registered` เท่านั้น (EXT-009 cancel, staff `cancelPreRegistration`) — ไม่มี check-in จริงให้เก็บ; `cancelled` เป็น terminal (ไม่มี transition ออก)
- EXT-011 (นิยามใน CR-154 FR-40..45) เพิ่ม guard ตาม `status` (`pre_registered` / `kiosk_registered` / `cancelled` → 404) กัน row เก่าที่ยังไม่ถูก re-project
- EXT-011 กรอง row `cancelled` ออก **ก่อน** เลือก record (FR-43) — row `cancelled` ที่ใหม่กว่าในอีกศูนย์ต้องไม่บัง stay จริงที่ `checked_out` (ได้ 200 `CHECKED_OUT` ของ stay จริง); `pre_registered` / `kiosk_registered` ยังเลือกตามเดิม (ใหม่กว่าและไม่มี Present → 404) — **ไม่เปลี่ยน**
- access log `denied_residency_not_found` ยังเก็บ `location_code` ของ record ที่ match (ไม่เปลี่ยน)

## Impact

- EXT-011 `checkin_datetime` ของ `cancelled` ไม่ถูกส่งอีก; ผู้ที่ check-in จริงแล้ว (`active`, `checked_out`, …) ไม่เปลี่ยน
- EXT-007 occupant projector ไม่ต้องแก้ — project เฉพาะ `active`

## Decision log

- 2026-10-20 — เจ้าของโครงการตัดสิน: แก้ + track ด้วย CR ไฟล์สั้น (approved)
