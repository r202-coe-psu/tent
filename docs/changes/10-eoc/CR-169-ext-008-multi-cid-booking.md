---
id: CR-169
title: EXT-008 รับหลาย CID ใน booking เดียว — group key ใน external_bookings + evacuee.booking_ref (schema_v 13→14), 1 คน = 1 household (รวม household เลื่อนไปก่อน)
status: approved
date: 2026-10-15
updated: 2026-10-15
requested_by: เจ้าของโครงการ
decided_by: เจ้าของโครงการ
layer: volatile
extends: CR-154 (C3/C4/C6)
affects:
  - docs/data/api-contract.md §5.3 (EXT-008/009/010 แถว + error detail)
  - docs/data/schema.md §1.1 evacuee (+ booking_ref) · schema_v 13 → 14
  - docs/data/schema.md §9.7 external_bookings (+ group fields, +index) · §9.4 third_party_access_logs (result_count = N)
  - docs/adr/0002-partner-integration-architecture.md บรรทัด EXT-008–010 (คำอธิบาย write path)
  - packages/tent-model/src/tent_model/external_booking.py
  - backend/apiapp/modules/thirdparty_bookings/{schemas.py, use_case.py, router.py}
  - backend/tests/test_thirdparty_bookings.py
  - worker/src/worker/inbound/external_bookings.py (build_evacuee_doc, EVACUEE_SCHEMA_V, group pre-check, sweeper)
  - worker/tests/test_external_bookings_inbound.py
  - frontend/src/lib/features/people/domain/people.ts (Evacuee type + evacueeInputSchema + createEvacuee schema_v 14) + people domain tests
  - scripts/smoke_test_partner_api.py (test_m2_bookings)
  - frontend/fastapi.json + openapi.d.ts (pnpm openapi:update)
---

# CR-169 — EXT-008 รับหลาย CID ใน booking เดียว

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** `POST /external/bookings` รับ `persons[]` หลายคนใน request เดียว (ยังรับ body เดิมได้) ได้ `booking_id` เดียวต่อกลุ่ม
- **เพื่อใคร/ทำไม:** M2 จองศูนย์ให้ครอบครัว/กลุ่มเดียวกันในครั้งเดียว และ cancel ทั้งกลุ่มได้ด้วย call เดียว
- **dev ต้อง build:** request/response ใหม่ · group key ใน `external_bookings` + insert แบบ all-or-nothing โดยไม่ใช้ transaction · worker เขียน evacuee ต่อคนพร้อม `booking_ref` · cancel/status ระดับกลุ่ม
- **กระทบ:** `evacuee.booking_ref` ใหม่ (opt, **schema_v 13→14**) · `schema.md` §9.7 · `api-contract.md` §5.3
- **ไม่ทำในงานนี้:** รวมสมาชิกกลุ่มเป็น `household` เดียวอัตโนมัติ — เลื่อนไปจนกว่าระบบหลักจัดการ household ได้ดีพอ; staff รวมเองได้ด้วย merge เดิม และ `booking_ref` ใช้บอกว่าใครมาจากกลุ่มเดียวกัน

> สถานะ: **approved 2026-10-15** — track ด้วย CR ไฟล์ · D1–D3, เรื่อง household/`booking_ref` และค่าที่เคยติด `[NEEDS DECISION]` เคาะแล้วโดยการ approve (ใช้ค่าที่แนะนำ)

---

## ข้อเท็จจริงของระบบปัจจุบัน (as-built ที่ draft นี้อ้างอิง)

| เรื่อง                       | ปัจจุบัน                                                                                                                                                                                                                                | ที่มา                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Request                      | `{location_code, cid, first_name, last_name, phone}` — 1 คน                                                                                                                                                                             | `thirdparty_bookings/schemas.py` |
| Storage                      | `external_bookings` 1 แถว/booking · `_id = booking_id = BK-{ulid}`                                                                                                                                                                      | `tent_model/external_booking.py` |
| กันซ้ำ                       | unique partial index `(shelter_code, cid_hash)` ที่ `state ∈ {pending, written}` (กัน race)                                                                                                                                             | `external_booking.py` Settings   |
| Worker                       | 1 แถว → `household` + 1 `evacuee` (`pre_registered`) เขียนด้วย id ที่ reserve ไว้ก่อน (retry idempotent)                                                                                                                                | `inbound/external_bookings.py`   |
| Cancel                       | `cancel_requested` ต่อแถว → evacuee `cancelled` + `_cancel_household_if_empty` (อ่าน `evacuee.household_id` ปัจจุบัน)                                                                                                                   | `_process_cancel`                |
| MongoDB                      | `mongo:8.0` **standalone ไม่มี `--replSet`** → **ใช้ multi-document transaction ไม่ได้**                                                                                                                                                | `docker-compose.yml`             |
| evacuee schema_v             | spec = **13** (`preferred_zone`, CR-159) · frontend `createEvacuee` เขียน 13 · worker `EVACUEE_SCHEMA_V` = 12 และ `backend/.../unassigned_registrations/couch_birth.py` = 12 (ค้างอยู่เดิม — ไม่กระทบเพราะ field ที่เพิ่มเป็น optional) | `people.ts`, `schema.md` §1.1    |
| staff edit / merge household | ใช้ `{...existingEvacuee, ...}` และ `{...latest, household_id}` จึง **คง field ที่ไม่รู้จักไว้** (`booking_ref` ไม่หายหลังแก้/รวม)                                                                                                      | `people.remote.ts`               |

## Change

### C1 — Request / Response (EXT-008)

**Request** (shape ใหม่)

```json
{
  "location_code": "SH014",
  "persons": [
    {
      "cid": "1909800123458",
      "first_name": "สมชาย",
      "last_name": "ใจดี",
      "phone": "0812345678"
    },
    {
      "cid": "1101700207030",
      "first_name": "สมหญิง",
      "last_name": "ใจดี",
      "phone": "0898765432"
    }
  ]
}
```

**Response 201** (additive — field เดิมคงไว้)

```json
{
  "status": 201,
  "message": "Booking accepted.",
  "result": {
    "booking_id": "BK-01J…",
    "location_code": "SH014",
    "booking_status": "BOOKED",
    "persons_count": 2
  }
}
```

- **FR-1** `persons` เป็น array ขนาด 1..`MAX_PERSONS` (ดู FR-6); ว่างหรือเกิน → 422 `validation_error`
- **FR-2** ทุก element ผ่านกติกาเดิมของ CR-154 ต่อคน **รวมถึง `phone` บังคับทุกคน**: `cid` 13 หลัก + checksum (FR-11), `phone` normalize แล้ว 9–10 หลัก (FR-12), `first_name`/`last_name` trim แล้วไม่ว่าง (FR-13)
- **FR-3** `location_code` อยู่ระดับ request (ทุกคนจองศูนย์เดียวกัน) · ตรวจ FR-14/15/16 ครั้งเดียวต่อ request
- **FR-4** `cid` ซ้ำกันภายใน request เดียว → 422 `validation_error` (ไม่ไปถึงขั้นตรวจ duplicate_booking)
- **FR-5** `booking_id` ใน response = **รหัสกลุ่ม** ที่ใช้กับ EXT-009/010 (1 request = 1 `booking_id`)
- **FR-6** `MAX_PERSONS` = **20** `[DECIDED 2026-10-15: 20]`

> **[DECIDED 2026-10-15 — D1]** **รับสอง shape**: ถ้า body มี `cid` ระดับบนแบบเดิมและไม่มี `persons` ให้ถือเป็น `persons` ยาว 1 (behavior เหมือนเดิมทุกประการ + `persons_count: 1`); ส่งทั้งสอง shape พร้อมกัน = 422

### C2 — Household: 1 คน = 1 household (รวมเป็นครัวเรือนเดียวเลื่อนไปก่อน)

- **FR-10** worker สร้าง `household` + `evacuee` **ต่อคน** แบบเดียวกับ CR-154 FR-51 ทุกประการ (`label = "ครอบครัว{first_name}"`, `head_evacuee_id` = evacuee คนนั้น, stay `pre_registered`, `registered_via = api`, `gender = null`) — **ไม่สร้าง household ร่วมกันทั้งกลุ่ม**
- **FR-11** ไม่มีหัวหน้าร่วม/`is_head` ใน request
- **FR-12** การรวมสมาชิกกลุ่มเป็น household เดียวทำโดย staff ด้วย `mergeHouseholds` (ระบบหลักเดิม) ถ้าจำเป็น; **ไม่อยู่ในขอบเขตงานนี้** และเลื่อนไปทำอัตโนมัติหลังจัดการ household ในระบบหลักดีขึ้น

> **[DECIDED 2026-10-15]** เจ้าของโครงการเลือกเลื่อนการรวม household เพราะการจัดการ household ในระบบหลักยังไม่ดีพอ. การเปลี่ยนเป็น "1 request = 1 household" ภายหลังไม่กระทบ contract ฝั่ง partner (household ไม่ปรากฏใน API)

### C3 — Atomicity (all-or-nothing) และ duplicate

- **FR-20** ตรวจ duplicate (CR-154 FR-17 a/b) ของ **ทุกคน** ก่อน insert; ถ้าคนใดคนหนึ่งซ้ำ → 409 `duplicate_booking` ทั้ง request ไม่สร้างอะไรเลย; `detail` ระบุ **ดัชนี** ของคนที่ซ้ำ (เช่น `"persons[1]"`) ห้ามใส่ CID/ชื่อ
- **FR-21** worker-time duplicate check (CR-154 FR-50) ตรวจ **ทุกแถวในกลุ่มก่อนเขียน CouchDB แถวใดแถวหนึ่ง**; พบซ้ำ ≥1 คน → ตั้ง `state = rejected`, `reject_reason = duplicate` **ทั้งกลุ่ม** และล้าง PII ทุกแถว

> **[DECIDED 2026-10-15 — D2]** **all-or-nothing**

### C4 — Storage model (`external_bookings`, schema.md §9.7)

คง **1 แถวต่อคน** เพราะ unique partial index `(shelter_code, cid_hash)` ที่กัน race ยังใช้ได้ตรง ๆ และ state/cancel/reject ต่อคนไม่ต้องคิดใหม่. เพิ่ม field:

| Field        | ชนิด | req | หมายเหตุ                                                                                                                       |
| ------------ | ---- | --- | ------------------------------------------------------------------------------------------------------------------------------ |
| `_id`        | str  | req | เปลี่ยนเป็น `BP-{ulid}` ต่อแถว (แถวเดิมที่ `_id = BK-…` ยังอ่านได้)                                                            |
| `booking_id` | str  | req | `BK-{ulid}` — **รหัสกลุ่ม** ร่วมกันทุกแถวใน request; แถวเดิมมี `booking_id = _id` อยู่แล้ว = กลุ่มขนาด 1 → **ไม่ต้อง migrate** |
| `person_seq` | int  | req | ลำดับใน `persons[]` เริ่ม 0 · default 0                                                                                        |
| `group_size` | int  | req | จำนวนคนทั้งกลุ่ม · default 1                                                                                                   |
| `committed`  | bool | req | `false` ระหว่างที่ API ยัง insert ไม่ครบกลุ่ม · default `true`                                                                 |

**Index ใหม่:** `(booking_id, person_seq)`

- **FR-30** unique partial index `uniq_open_booking_per_shelter` คงเดิม — เป็น race guard ของ duplicate
- **FR-31** **ไม่ใช้ Mongo transaction** (standalone, ไม่มี replica set) — insert แบบ staged:
  1. insert ทุกแถวด้วย `committed = false`
  2. ครบทุกแถว → `update_many({booking_id}, {$set: {committed: true}})` แล้วตอบ 201
  3. `DuplicateKeyError` กลางทาง → `delete_many({booking_id, committed: false})` (compensate) แล้วตอบ 409 `duplicate_booking`
- **FR-32** worker poll เฉพาะแถวที่ `committed != false`
- **FR-33** worker sweeper: แถว `committed = false` ที่ `created_at` เก่ากว่า **60 วินาที** ถูกลบ (กัน PII ค้างกรณี API crash กลางทาง) `[DECIDED 2026-10-15: 60 วิ]`
- **FR-34** worker ประมวลผลต่อแถวด้วย id ที่ reserve ไว้ (`household_id`/`evacuee_id` ต่อแถว — retry idempotent เหมือนเดิม) หลังผ่าน group pre-check (FR-21); เขียนสำเร็จ → `state = written` + ล้าง PII ต่อแถว

> ทางเลือกที่ตัดทิ้ง: เก็บทั้งกลุ่มเป็น doc เดียวมี `persons[]` + multikey unique index — unique ข้าม document ได้แต่ไม่กัน duplicate ภายใน doc เดียว และทำให้ state/cancel/reject รายคนซับซ้อน

### C5 — Cancel (EXT-009) / Status (EXT-010)

- **FR-40** `POST /external/bookings/{booking_id}/cancel` ยกเลิก **ทั้งกลุ่ม**: ทุกแถวของ `booking_id` ที่ `client_id` ตรง token; กฎ CR-154 FR-31/32/33 ใช้ต่อแถว; ถ้ามีคนใดคนหนึ่งยกเลิกไม่ได้ (เช่น check-in แล้ว) → 409 `booking_not_cancellable` และ **ไม่เปลี่ยนแถวไหน**
- **FR-41** worker `_process_cancel` ยกเลิก evacuee แต่ละคนตามเดิม; `_cancel_household_if_empty` อ่าน `household_id` ปัจจุบันของ evacuee จึงทำงานถูกต้องแม้ staff รวม household ไปแล้ว
- **FR-42** `GET /external/bookings/{booking_id}` คง field เดิม (`booking_status` = aggregate: ทุกแถว cancelled → `CANCELLED`, มี rejected → `REJECTED`, อื่น ๆ → `BOOKED`) และเพิ่ม `persons: [{index, booking_status, reject_reason}]` (additive; **ไม่มี CID/ชื่อ**) `[DECIDED 2026-10-15: คืน persons[] รายคน]`

> **[DECIDED 2026-10-15 — D3]** cancel ทั้งกลุ่ม; รายคน (`person_seq` ใน path/body) เป็น follow-up ถ้า M2 ต้องการ

### C6 — Access log

- **FR-50** 1 request = 1 แถวใน `third_party_access_logs` (`endpoint = "EXT-008"`, `result_count = persons_count` เมื่อ granted, `0` เมื่อ denied) · ห้ามเก็บ CID/ชื่อ/phone (CR-154 FR-20 คงเดิม) `[DECIDED 2026-10-15: 1 แถว/request]`

### C7 — Couch schema: `evacuee.booking_ref` (schema_v 13 → 14)

| Field         | ชนิด        | req | หมายเหตุ                                                                                                                                                                                     |
| ------------- | ----------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booking_ref` | str \| null | opt | `BK-{ulid}` = `external_bookings.booking_id` ของกลุ่มที่จองมา — ใช้บอกว่า evacuee หลายคนมาจาก booking เดียวกัน. ตั้งเฉพาะ evacuee ที่ `registered_via = api`; ไม่มี → ไม่ใส่ key หรือ `null` |

- **FR-60** worker ใส่ `booking_ref = booking_id` ให้ evacuee ที่สร้างจากทุก booking ใหม่ (รวมกลุ่มขนาด 1) และตั้ง `schema_v = 14`
- **FR-61** Zod/type ฝั่ง frontend (`Evacuee`, `evacueeInputSchema`) รับ `booking_ref` แบบ optional nullable; `createEvacuee` เขียน `schema_v 14`; ฟอร์ม staff/kiosk/public **ไม่ตั้งค่านี้**
- **FR-62** staff แก้ evacuee หรือรวม household ต้อง **คง** `booking_ref` เดิม (ปัจจุบันคงอยู่แล้วเพราะ spread doc เดิม — เพิ่ม test กัน regression)
- **FR-63** `booking_ref` เป็นรหัสทึบ ไม่ใช่ PII — **ไม่ project** ลง `public_*` และไม่ต้อง bump `PROJECTION_VERSION`
- **FR-64** ไม่ใช้ชื่อนี้ซ้อนกับ `donation.booking_ref` (คนละ doc type/ความหมาย) — ระบุในหมายเหตุของ field ใน `schema.md` §1.1
- **ไม่ทำ (follow-up):** UI แสดง "จองมาพร้อมกัน" ในโปรไฟล์/dialog รวม household · Mango index `['type','booking_ref']` — ทำเมื่อมี UI ที่ query

---

## Acceptance

- [ ] `persons` 3 คน → 201 `persons_count: 3` และภายใน ~10 วินาทีมี `household` 3 + `evacuee` 3 ใน `shelter_{code}` (`pre_registered`, `registered_via: api`, `gender: null`) ทุก evacuee มี `booking_ref` = `booking_id` เดียวกัน และ `schema_v = 14`; forecast occupancy +3
- [ ] body เดิม (single `cid`) ยังตอบ 201 พฤติกรรมเดิม และ evacuee ได้ `booking_ref`
- [ ] `cid` ซ้ำใน request เดียวกัน → 422 · `persons` ว่าง/เกิน cap → 422
- [ ] คนใดคนหนึ่งซ้ำที่ศูนย์เดียวกัน → 409 `duplicate_booking` + `detail` ระบุดัชนี และ **ไม่มีแถวใดถูกสร้าง/ค้าง** ใน `external_bookings`
- [ ] ยิง 2 request พร้อมกันที่มี CID ทับกัน ได้ 201 หนึ่ง / 409 หนึ่ง และไม่มีแถว `committed=false` ค้าง
- [ ] API ล้มกลางการ insert (จำลอง) → worker ไม่หยิบกลุ่มนั้น และ sweeper ลบแถว `committed=false` ภายใน 60 วินาที
- [ ] worker พบ duplicate ตอนเขียน → ทั้งกลุ่ม `rejected`, ไม่มี doc ใน CouchDB, PII ถูกล้างทุกแถว
- [ ] cancel ตอน pending → ไม่มี doc ถูกเขียน · cancel หลัง written → evacuee ทุกคนและ household ของแต่ละคน `cancelled` · cancel หลังมีคน check-in → 409 และไม่เปลี่ยนแถวไหน · cancel หลัง staff รวม household แล้ว ยังยกเลิก evacuee ถูกต้อง
- [ ] staff แก้ evacuee และรวม household แล้ว `booking_ref` ยังอยู่ (test)
- [ ] หลัง written/cancelled/rejected ไม่เหลือ `cid`/`phone`/`first_name`/`last_name` plaintext ในทุกแถวของกลุ่ม
- [ ] token ไม่มี `booking-write` → 403 `insufficient_scope` (เหมือนเดิม)
- [ ] `backend pytest`, worker tests, people domain tests, `pnpm openapi:update` (commit `fastapi.json` + `openapi.d.ts`), `scripts/smoke_test_partner_api.py` ครอบ multi-person
- [ ] ตรวจและบันทึกผลว่า kiosk / Station 1 (CR-149/151) ค้นหาและเช็กอิน evacuee `pre_registered` ที่มี household แยกกันหลายอันจากกลุ่มเดียวกันได้ปกติ (ยังไม่ได้ตรวจ ณ วันที่ร่าง)

## Why

- M2 จองให้ประชาชนทีละกลุ่ม การเรียก EXT-008 ทีละคนทำให้ได้ `booking_id` แยกกัน และ cancel ต้องเรียกทีละคน
- Mongo standalone ใช้ transaction ไม่ได้ → ออกแบบ staged-commit + compensate แทนการเปลี่ยน infra
- การจัดการ household ในระบบหลักยังไม่ดีพอ การสร้างครัวเรือนร่วมอัตโนมัติจะเพิ่มภาระให้ staff และ partner → เก็บแค่ `booking_ref` ให้สืบกลุ่มได้ แล้วเลื่อนการรวมไปก่อน
- ระบบอยู่ช่วงทดลองใช้ และ `booking_ref` ไม่กระทบ contract ฝั่ง partner จึงยอมรับ schema_v bump ได้ตอนนี้

## Impact

- **Docs:** `api-contract.md` §5.3 (EXT-008/009/010) · `schema.md` §1.1 (+ `booking_ref`, schema_v 14 note, frontmatter `updated:`), §9.7, §9.4 · ADR 0002 · handover M2
  - ⚠️ `docs/data/partner-api.md` ชี้ไป `docs/reports/2026-09-10/partner-api-as-built.md` ซึ่ง **ไม่มีอยู่จริงใน repo** — ลิงก์เสียอยู่แล้ว ไม่แก้ในงานนี้ (แจ้งเจ้าของโครงการแยกต่างหาก)
- **tent-model:** `ExternalBooking` (+ `person_seq`, `group_size`, `committed`, index)
- **Backend:** `thirdparty_bookings` schemas/use_case/router + 30 tests เดิม
- **Worker:** `external_bookings.py` (`build_evacuee_doc` + `booking_ref`, `EVACUEE_SCHEMA_V` 12→14, group pre-check, sweeper) + tests
- **Frontend:** `people` domain (type, Zod, `createEvacuee` v14) + tests
- **Scripts:** `smoke_test_partner_api.py`
- **ไม่กระทบ:** EXT-001–007, EXT-011 (ยังค้นตามรายคน), public pre-register flow, `public_*` projections
- **หมายเหตุ drift ที่มีอยู่เดิม (ไม่แก้ในงานนี้):** `backend/apiapp/modules/unassigned_registrations/couch_birth.py` เขียน evacuee `schema_v = 12` ทั้งที่ spec คือ 13

## Migration

- **evacuee schema_v 13 → 14:** additive ล้วน (field optional ใหม่) doc เดิมไม่ต้อง backfill · Zod รับ `booking_ref` optional · reader ทุกจุดต้องไม่พังเมื่อไม่มี field นี้ · ไม่พบ `validate_doc_update` ที่ตรวจ field evacuee ใน code (พบเฉพาะในเอกสาร) — ตรวจซ้ำตอน implement
- **`external_bookings`:** field ใหม่มี default (`person_seq=0`, `group_size=1`, `committed=true`) → แถวเดิมคือกลุ่มขนาด 1 ไม่ต้อง backfill; index ใหม่สร้างตอน Beanie init
- **evacuee จาก booking เดิม (ก่อนงานนี้):** ไม่มี `booking_ref` — ยอมรับ (ไม่ backfill; ช่วงทดลองใช้)

## Decision log

- 2026-10-15 — proposed (draft)
- 2026-10-15 — เจ้าของโครงการเลือก: **track ด้วย CR ไฟล์** · D1 รับทั้ง body เดิมและ `persons[]` · D2 all-or-nothing · D3 cancel ทั้งกลุ่ม
- 2026-10-15 — เจ้าของโครงการ: **ไม่รวม household อัตโนมัติ** (ระบบหลักยังจัดการ household ไม่ดี) → 1 คน = 1 household; **เพิ่ม `evacuee.booking_ref` ใน Couch** (schema_v 13→14) เพราะอยู่ช่วงทดลองและไม่กระทบ partner
- ทางเลือกที่ตัดทิ้งสำหรับ `booking_ref`: ใส่ที่ `household` ด้วย — ตัดทิ้งเพราะหลัง staff รวม household จะกำกวม (หนึ่ง household มีหลายกลุ่ม); evacuee-level คงอยู่หลัง merge
- 2026-10-15 — **approved** โดยเจ้าของโครงการ ได้เลข CR-169; ข้อที่เคยค้างเคาะตามค่าที่แนะนำ: cap 20 · sweeper 60 วิ · EXT-010 คืน `persons[]` · access log 1 แถว/request
