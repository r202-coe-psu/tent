---
id: CR-169
title: EXT-008 รับหลาย CID ใน booking เดียว — group key ใน external_bookings + evacuee.booking_ref (schema_v 13→14), 1 คน = 1 household (รวม household เลื่อนไปก่อน)
status: approved
date: 2026-10-15
updated: 2026-10-17
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
  - docs/changes/10-eoc/CR-154-m2-partner-booking-residency.md (FR-33 superseded บางส่วน)
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
- **FR-6** `MAX_PERSONS` = **100** `[DECIDED 2026-10-16: 100]` (เดิม 20 ตอน approve 2026-10-15 — partner อาจส่งกลุ่มใหญ่กว่า 20; 100 คือเพดานของ request แบบ synchronous all-or-nothing, ปรับที่ const ตัวเดียวใน use case)

> **[DECIDED 2026-10-15 — D1]** **รับสอง shape**: ถ้า body มี `cid` ระดับบนแบบเดิมและไม่มี `persons` ให้ถือเป็น `persons` ยาว 1 (behavior เหมือนเดิมทุกประการ + `persons_count: 1`); ส่งทั้งสอง shape พร้อมกัน = 422

### C2 — Household: 1 คน = 1 household (รวมเป็นครัวเรือนเดียวเลื่อนไปก่อน)

- **FR-10** worker สร้าง `household` + `evacuee` **ต่อคน** แบบเดียวกับ CR-154 FR-51 ทุกประการ (`label = "ครอบครัว{first_name}"`, `head_evacuee_id` = evacuee คนนั้น, stay `pre_registered`, `registered_via = api`, `gender = null`) — **ไม่สร้าง household ร่วมกันทั้งกลุ่ม**
- **FR-11** ไม่มีหัวหน้าร่วม/`is_head` ใน request
- **FR-12** การรวมสมาชิกกลุ่มเป็น household เดียวทำโดย staff ด้วย `mergeHouseholds` (ระบบหลักเดิม) ถ้าจำเป็น; **ไม่อยู่ในขอบเขตงานนี้** และเลื่อนไปทำอัตโนมัติหลังจัดการ household ในระบบหลักดีขึ้น

> **[DECIDED 2026-10-15]** เจ้าของโครงการเลือกเลื่อนการรวม household เพราะการจัดการ household ในระบบหลักยังไม่ดีพอ. การเปลี่ยนเป็น "1 request = 1 household" ภายหลังไม่กระทบ contract ฝั่ง partner (household ไม่ปรากฏใน API)

### C3 — Atomicity (all-or-nothing) และ duplicate

- **FR-20** ตรวจ duplicate (CR-154 FR-17 a/b) ของ **ทุกคน** ก่อน insert; ถ้าคนใดคนหนึ่งซ้ำ → 409 `duplicate_booking` ทั้ง request ไม่สร้างอะไรเลย; `detail` ระบุ **ดัชนี** ของคนที่ซ้ำ (เช่น `"persons[1]"`) ห้ามใส่ CID/ชื่อ
- **FR-21** worker-time duplicate check (CR-154 FR-50) ตรวจ **ทุกแถวในกลุ่มก่อนเขียน CouchDB แถวใดแถวหนึ่ง**; พบซ้ำ ≥1 คน → ตั้ง `state = rejected`, `reject_reason = duplicate` **ทั้งกลุ่ม** และล้าง PII ทุกแถว · **ข้อยกเว้นตอน retry:** ถ้าบางคนของกลุ่มถูกเขียนลง CouchDB ไปแล้ว (worker ล่ม / `_bulk_docs` สำเร็จบางส่วน) การตรวจซ้ำรอบหลัง reject **เฉพาะคนที่ CID ซ้ำ** (`rejected` / `duplicate` + ล้าง PII) คนที่เขียนแล้วคงไว้ตามเดิม คนอื่นที่ยัง `pending` เขียนต่อ · ข้อยกเว้นนี้ครอบคลุมคนที่ doc เข้า CouchDB แล้วแต่แถวยัง `pending` ด้วย: ถ้า CID ของเขาซ้ำกับผู้ถือรายอื่นแล้ว ให้ reject แถวนั้น (`rejected` / `duplicate` + ล้าง PII) **และยกเลิก stay ใน CouchDB** (ไม่ให้มีผู้ถือ CID ซ้ำ — FR-50) เฉพาะเมื่อ stay ยังเป็น `pre_registered` เท่านั้น · ถ้า staff เช็กอินแล้ว (arriving / active ฯลฯ) แถวจองยัง reject แต่ไม่ยกเลิกคนนั้น (สอดคล้อง FR-53 `not_cancellable`) และ staff ต้องแก้ CID ซ้ำเอง · แถวที่ `written` แล้วคงไว้ตามเดิม

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
- **FR-33** worker sweeper: แถว `committed = false` ที่ `created_at` เก่ากว่า **60 วินาที** ถูกลบ (กัน PII ค้างกรณี API crash กลางทาง) `[DECIDED 2026-10-15: 60 วิ]` · พร้อมกันนั้นลบแถว `state = pending` ที่เหลือ**ทั้งกลุ่ม** (`booking_id` เดียวกัน) เพราะ `update_many` ใน FR-31 ไม่ atomic อาจเหลือแถว `committed = true` ที่มี PII ค้าง; **ไม่แตะแถว `written` / `cancelled` / `rejected`** `[DECIDED 2026-10-16]`
- **FR-34** worker ประมวลผลต่อแถวด้วย id ที่ reserve ไว้ (`household_id`/`evacuee_id` ต่อแถว — retry idempotent เหมือนเดิม) หลังผ่าน group pre-check (FR-21); เขียนสำเร็จ → `state = written` + ล้าง PII ต่อแถว

> ทางเลือกที่ตัดทิ้ง: เก็บทั้งกลุ่มเป็น doc เดียวมี `persons[]` + multikey unique index — unique ข้าม document ได้แต่ไม่กัน duplicate ภายใน doc เดียว และทำให้ state/cancel/reject รายคนซับซ้อน

### C5 — Cancel (EXT-009) / Status (EXT-010)

- ~~**FR-40** `POST /external/bookings/{booking_id}/cancel` ยกเลิก **ทั้งกลุ่ม**: ทุกแถวของ `booking_id` ที่ `client_id` ตรง token; กฎ CR-154 FR-31/32/33 ใช้ต่อแถว; ถ้ามีคนใดคนหนึ่งยกเลิกไม่ได้ (เช่น check-in แล้ว) → 409 `booking_not_cancellable` และ **ไม่เปลี่ยนแถวไหน**~~
  **Superseded by 2026-10-17 (#592):** `POST /external/bookings/{booking_id}/cancel` ยกเลิก **ทั้งกลุ่ม** เฉพาะแถวที่ `client_id` ตรง token ตามลำดับนี้
  - 1. ยกเลิกเฉพาะแถว **open** = `state = pending` หรือ `state = written` ที่ `cancel_requested = false` · แถว **finished** = `cancelled`, `rejected`, หรือ `written` ที่ `cancel_requested = true` → **ข้าม** และไม่เขียนทับ `cancel_reason` เดิม
  - 2. แถว open แต่ละแถวใช้ CR-154 FR-31/FR-32: `pending` → `cancelled`; `written` ที่ stay ยังเป็น `pre_registered` → `cancel_requested = true`
  - 3. ถ้ามีแถว open แถวใดยกเลิกไม่ได้ (stay ผ่าน `pre_registered` แล้ว เช่น check-in) → 409 `booking_not_cancellable` และ **ไม่เปลี่ยนแถวไหนเลย** (all-or-nothing คงเดิม)
  - 4. เมื่อไม่มีแถว open เหลือ: มีแถว `cancelled` หรือ `cancel_requested` อย่างน้อย 1 แถว → 200 (idempotent); ทุกแถวเป็น `rejected` → 409 `booking_not_cancellable`
  - กฎนี้ใช้กับ legacy single-person booking ด้วย — **partially supersede CR-154 FR-33** (ยกเลิกซ้ำ booking ที่ `cancelled` แล้วตอบ 200 แทน 409; `rejected` ยังตอบ 409)
  - ผลข้างเคียง: cancel กลุ่มที่ล้มกลาง phase 2 แล้ว retry สำเร็จได้ เพราะแถวที่ยกเลิกไปแล้วถูกข้าม (สถานการณ์ที่ 2 ของ #592)
- **FR-41** worker `_process_cancel` ยกเลิก evacuee แต่ละคนตามเดิม; `_cancel_household_if_empty` อ่าน `household_id` ปัจจุบันของ evacuee จึงทำงานถูกต้องแม้ staff รวม household ไปแล้ว
- **FR-42** `GET /external/bookings/{booking_id}` คง field เดิม (`booking_status` = aggregate: ~~ทุกแถว cancelled → `CANCELLED`, มี rejected → `REJECTED`, อื่น ๆ → `BOOKED`~~) และเพิ่ม `persons: [{index, booking_status, reject_reason}]` (additive; **ไม่มี CID/ชื่อ**) `[DECIDED 2026-10-15: คืน persons[] รายคน]`
  - **Superseded by 2026-10-17 (#592):** `booking_status` (aggregate) ประเมินตามลำดับนี้
    - 1. ไม่มีแถว open และมีแถว `cancelled` (รวม `cancel_requested`) อย่างน้อย 1 แถว → `CANCELLED`
    - 2. อื่น ๆ ถ้ามีแถว `rejected` อย่างน้อย 1 แถว → `REJECTED`
    - 3. อื่น ๆ → `BOOKED`
  - `persons[]` ไม่เปลี่ยนจากข้อความเดิม

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
- [ ] `cid` ซ้ำใน request เดียวกัน → 422 · `persons` ว่าง/เกิน cap (100) → 422
- [ ] คนใดคนหนึ่งซ้ำที่ศูนย์เดียวกัน → 409 `duplicate_booking` + `detail` ระบุดัชนี และ **ไม่มีแถวใดถูกสร้าง/ค้าง** ใน `external_bookings`
- [ ] ยิง 2 request พร้อมกันที่มี CID ทับกัน ได้ 201 หนึ่ง / 409 หนึ่ง และไม่มีแถว `committed=false` ค้าง
- [ ] API ล้มกลางการ insert (จำลอง) → worker ไม่หยิบกลุ่มนั้น และ sweeper ลบแถว `committed=false` ภายใน 60 วินาที
- [ ] worker พบ duplicate ตอนเขียน → ทั้งกลุ่ม `rejected`, ไม่มี doc ใน CouchDB, PII ถูกล้างทุกแถว
- [ ] cancel ตอน pending → ไม่มี doc ถูกเขียน · cancel หลัง written → evacuee ทุกคนและ household ของแต่ละคน `cancelled` · cancel หลังมีคน check-in (แถว open) → 409 และไม่เปลี่ยนแถวไหน · cancel หลัง staff รวม household แล้ว ยังยกเลิก evacuee ถูกต้อง
- [x] cancel กลุ่มที่มีแถว finished ปนอยู่ (เช่น `rejected` 1 คน + open 2 คน) → ยกเลิกเฉพาะแถว open · แถว finished ไม่ถูกแก้ไข และ `cancel_reason` เดิมไม่ถูกเขียนทับ · ตอบ 200 (#592)
- [x] cancel ซ้ำกลุ่มที่ยกเลิกแล้ว (ไม่มีแถว open และมี `cancelled`/`cancel_requested` ≥ 1) → 200 idempotent ไม่เขียน doc ซ้ำ · legacy single-person booking เช่นเดียวกัน (partially supersede CR-154 FR-33) (#592)
- [x] cancel กลุ่มที่ทุกแถวเป็น `rejected` → 409 `booking_not_cancellable` (#592)
- [x] cancel กลุ่มที่มีคน check-in แล้ว (แถว open ที่ stay ผ่าน `pre_registered`) → 409 `booking_not_cancellable` และ **ไม่เปลี่ยนแถวไหนเลย** แม้แถว open อื่นในกลุ่มจะยกเลิกได้ (#592)
- [x] retry cancel หลัง phase 2 ล้มกลางทาง (บางแถว `cancelled` แล้ว) → 200 สำเร็จ โดยข้ามแถวที่จบแล้ว (#592)
- [x] EXT-010 `booking_status`: ไม่มีแถว open และมี `cancelled`/`cancel_requested` ≥ 1 → `CANCELLED` (แม้มีแถว `rejected` ปนอยู่) · มี `rejected` และไม่เข้าเงื่อนไข `CANCELLED` → `REJECTED` · แถว open ล้วน → `BOOKED` (#592)
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
  - `docs/data/partner-api.md` เคยอ้างรายงาน as-built ที่ถูกลบออกจาก repo (commit `4374bcc20`) — **แก้แล้ว** (#579, owner decision): stub ระบุว่ารายงานถูกลบ และ `api-contract.md` §5.3 เป็นแหล่งอ้างอิงหลัก; ลิงก์ใน `api-contract.md` / ADR 0002 ถูกแทนด้วยการอ้าง §5.3 เช่นกัน
- **tent-model:** `ExternalBooking` (+ `person_seq`, `group_size`, `committed`, index)
- **Backend:** `thirdparty_bookings` schemas/use_case/router + 30 tests เดิม
- **Worker:** `external_bookings.py` (`build_evacuee_doc` + `booking_ref`, `EVACUEE_SCHEMA_V` 12→14, group pre-check, sweeper) + tests
- **Frontend:** `people` domain (type, Zod, `createEvacuee` v14) + tests
- **Scripts:** `smoke_test_partner_api.py`
- **ไม่กระทบ:** EXT-001–007, EXT-011 (ยังค้นตามรายคน), public pre-register flow, `public_*` projections
- **หมายเหตุ drift ที่มีอยู่เดิม (ไม่แก้ในงานนี้):** `backend/apiapp/modules/unassigned_registrations/couch_birth.py` เขียน evacuee `schema_v = 12` ทั้งที่ spec คือ 13

## Migration

- **evacuee schema_v worker 12 / staff 13 → 14:** worker เดิมเขียน evacuee `schema_v` **12** (ไม่ใช่ 13) และตอนนี้เขียน **14** ข้าม 13 · additive ล้วน (field optional ใหม่) doc เดิมไม่ต้อง backfill · Zod รับ `booking_ref` optional · reader ทุกจุดต้องไม่พังเมื่อไม่มี field นี้ · ไม่พบ `validate_doc_update` ที่ตรวจ field evacuee ใน code (พบเฉพาะในเอกสาร) — ตรวจซ้ำตอน implement
- **`external_bookings`:** field ใหม่มี default (`person_seq=0`, `group_size=1`, `committed=true`) → แถวเดิมคือกลุ่มขนาด 1 ไม่ต้อง backfill; index ใหม่สร้างตอน Beanie init
- **evacuee จาก booking เดิม (ก่อนงานนี้):** ไม่มี `booking_ref` — ยอมรับ (ไม่ backfill; ช่วงทดลองใช้)

## Decision log

- 2026-10-15 — proposed (draft)
- 2026-10-15 — เจ้าของโครงการเลือก: **track ด้วย CR ไฟล์** · D1 รับทั้ง body เดิมและ `persons[]` · D2 all-or-nothing · D3 cancel ทั้งกลุ่ม
- 2026-10-15 — เจ้าของโครงการ: **ไม่รวม household อัตโนมัติ** (ระบบหลักยังจัดการ household ไม่ดี) → 1 คน = 1 household; **เพิ่ม `evacuee.booking_ref` ใน Couch** (schema_v 13→14) เพราะอยู่ช่วงทดลองและไม่กระทบ partner
- ทางเลือกที่ตัดทิ้งสำหรับ `booking_ref`: ใส่ที่ `household` ด้วย — ตัดทิ้งเพราะหลัง staff รวม household จะกำกวม (หนึ่ง household มีหลายกลุ่ม); evacuee-level คงอยู่หลัง merge
- 2026-10-15 — **approved** โดยเจ้าของโครงการ ได้เลข CR-169; ข้อที่เคยค้างเคาะตามค่าที่แนะนำ: cap 20 · sweeper 60 วิ · EXT-010 คืน `persons[]` · access log 1 แถว/request
- 2026-10-16 — เจ้าของโครงการ: **`MAX_PERSONS` 20 → 100** (FR-6) — partner อาจส่งกลุ่มใหญ่กว่า 20 และ 100 เป็นเพดานของ synchronous atomic request; track ด้วยการแก้ FR-6 ใน CR นี้ · วัดเวลาแล้ว (2026-10-17, ดู entry ท้ายสุด): worker เขียน 100 คน ≈ 0.2–1.0 วิ → ไม่ต้องลด cap
- 2026-10-16 — เจ้าของโครงการ: **sweeper (FR-33) ลบแถว `pending` ทั้งกลุ่มของ `booking_id` ที่มีแถว `committed = false` ค้างเกิน 60 วิ** (ไม่ใช่เฉพาะแถว `committed = false`) — `update_many` commit ของ API (FR-31) ไม่ atomic บน Mongo standalone ถ้า process ถูก kill กลางทางอาจเหลือแถว `committed = true` ที่ยัง `pending` พร้อม PII plaintext และกินสิทธิ์ unique index; worker ไม่ประมวลผลกลุ่มที่ไม่ครบ (นับ `committed` ≠ `group_size`) จึงลบได้อย่างปลอดภัย และไม่แตะแถว terminal (`written` / `cancelled` / `rejected`) เพราะสคริปต์ e2e ใช้ `evacuee_id` / `household_id` จากแถวเหล่านั้น; track ด้วยการแก้ FR-33 ใน CR นี้
- 2026-10-17 — เจ้าของโครงการ (review รอบ 2 ของ PR #601, track ใน CR นี้): **D1** แก้ FR-21 — ถ้าบางคนของกลุ่มเข้า CouchDB แล้วและรอบ retry พบ CID ซ้ำ ให้ reject เฉพาะคนที่ซ้ำ คนที่เขียนแล้วคงไว้ คนอื่นเขียนต่อ (ไม่ reject ทั้งกลุ่ม เพราะจะทิ้งคนที่ pre-register ไปแล้วไว้ลอย) · **D2** กรณี API ยกเลิกทั้งกลุ่มหลัง worker ล่มกลางทาง → stay ค้าง `pre_registered` ไม่มีแถว `pending` เหลือให้ worker กลับมาจัดการ: **ยอมรับเป็นความเสี่ยง** ย้ายไป #595 (ต้องเคาะ Mango index `['type','booking_ref']` ร่วมกับ #603) · **D3** บันทึกผลวัดเวลา (local single-host, ไม่ใช่ production benchmark): `_persist_group` 100 คน ≈ 0.2 วิ ที่ ~1.6k docs ใน shelter DB และ ≈ 1.0 วิ ที่ ~31.6k docs (Mango duplicate `find` ใช้ index `['type','person_id.number']` = `evacuee-type-person-id-idx` เมื่อมี — index นี้นิยามใน `KIOSK_LOOKUP_MANGO_INDEXES` และ deploy ตอนสร้างศูนย์ / `redeploy-access` / seed; ตรวจ `_explain` ด้วย selector จริงของ worker บนฐานทดลองที่สร้าง index นี้แล้วเลือก `evacuee-type-person-id-idx` แต่ตรวจ local 2026-10-17 พบ `shelter_sh001`–`sh004` **ไม่มี index นี้** (`_explain` เลือก `_all_docs`) → ตัวเลขข้างต้นคือกรณี full scan; ยังไม่ได้วัดเวลาบนฐานที่ provision index ครบ — ต้อง `redeploy-access` ฐาน local/staging ก่อนวัดซ้ำ) → ไม่ลด `MAX_PERSONS`
- 2026-10-17 — เจ้าของโครงการ (review รอบ 3 ของ PR #601): **D4** แก้ FR-21 — แถวที่ยัง `pending` แต่ doc เข้า CouchDB แล้ว และรอบ retry พบว่า CID ของแถวนั้นซ้ำกับผู้ถือรายอื่น → reject แถวนั้นด้วย (`rejected` / `duplicate` + ล้าง PII) และยกเลิก stay ใน CouchDB (ไม่ให้มีผู้ถือ CID ซ้ำ — FR-50; แถวที่ `written` แล้วไม่แตะ) · **G5** (commit ack หายหลัง flip สำเร็จ → partner ได้ 500 แล้ว retry ได้ 409) ย้ายไป #595 · แก้ migration note (worker เดิมเขียน `schema_v` 12 ไม่ใช่ 13) และหมายเหตุเวลา D3 (index `['type','person_id.number']`) ตามข้างต้น
- 2026-10-17 — เจ้าของโครงการ (review รอบ 4 ของ PR #601): **H8** ยืนยันพฤติกรรม D4 — worker ยกเลิก stay เฉพาะตอนที่ยังเป็น `pre_registered`; ถ้า staff เช็กอินคนนั้นไปแล้ว แถวจองถูก reject แต่ไม่ยกเลิกคน (สอดคล้อง FR-53 `not_cancellable`) และ staff แก้ CID ซ้ำเอง · เพิ่มข้อความใน FR-21 (ไม่แก้โค้ด)
- 2026-10-17 — เจ้าของโครงการ (#592, track ใน CR นี้): แก้ FR-40/FR-42 ตรง ๆ — เหตุผล: หลัง D1/D4 worker อาจ reject บางคนในกลุ่ม ภายใต้ FR-40 เดิม partner ยกเลิกคนที่เหลือผ่าน API ไม่ได้เลย
  - **FR-40:** ยกเลิกเฉพาะแถว open (`pending`, `written` ที่ `cancel_requested = false`); ข้ามแถว finished (`cancelled`, `rejected`, `written` ที่ `cancel_requested = true`) และไม่เขียนทับ `cancel_reason`
  - **FR-40 all-or-nothing:** แถว open ที่ยกเลิกไม่ได้ → 409 `booking_not_cancellable` ไม่เปลี่ยนแถวไหน (คงเดิม)
  - **FR-40 ไม่เหลือแถว open:** มี `cancelled`/`cancel_requested` ≥ 1 → 200 idempotent; ทุกแถว `rejected` → 409 `booking_not_cancellable`
  - **FR-40 legacy single-person:** ใช้กฎเดียวกัน → partially supersede CR-154 FR-33 (ยกเลิกซ้ำ `cancelled` ตอบ 200 แทน 409; `rejected` ยัง 409)
  - **FR-42:** `booking_status` aggregate ตามลำดับ: ไม่มีแถว open และมี cancelled ≥ 1 → `CANCELLED`; มี `rejected` → `REJECTED`; อื่น → `BOOKED` · `persons[]` ไม่เปลี่ยน
  - **ผลข้างเคียง:** cancel ที่ล้มกลาง phase 2 แล้ว retry สำเร็จได้ (สถานการณ์ที่ 2 ของ #592)
  - **นอกขอบเขต:** ล้าง stay `pre_registered` ค้างของแถว rejected → #613 · cancel แบบ atomic (`update_many`) → #612
  - implementation ยังไม่ลงโค้ด: backend `thirdparty_bookings/use_case.py` + tests (ติดตามใน #592)
- 2026-10-17 — **decision sync** (#604; ไม่เปิด CR ใหม่ ตามที่เจ้าของโครงการเลือก) ต่อ D3: provision `evacuee-type-person-id-idx` บน `shelter_sh001`–`sh004` (local) แล้วด้วย `redeploy-access` — `_explain` ของ selector `$in` ของ worker เลือก index นี้ทุกฐาน · วัดเฉพาะ duplicate `find` 100 CID (3 รอบ/ฐาน): ≈ 0.023–0.029 วิ ที่ 1,455 docs · 0.017–0.024 วิ ที่ 925 · 0.012–0.015 วิ ที่ 536 · ≈ 0.002 วิ ที่ 22 docs · ตัวเลขนี้ **ไม่ใช่** เวลา `_persist_group` ทั้งกลุ่ม จึงเทียบตรงกับ 0.2 / 1.0 วิ ของ D3 ไม่ได้ — ยังไม่ได้วัด `_persist_group` ซ้ำบนฐานที่มี index; ข้อสรุป D3 (ไม่ลด `MAX_PERSONS`) คงเดิม · staging/production ได้ index เมื่อ deploy (Jenkins รัน `pnpm db:sync`) แต่ยังไม่ได้ตรวจ
- 2026-10-17 — **decision sync** (เจ้าของโครงการ, hardening หลัง CR-169 — #612–#616; ไม่เปิด CR ใหม่): รายละเอียด contract/schema แก้ใน PR ของแต่ละ issue ตามโค้ดจริง
  - **#612 (cancel กลุ่ม):** ไม่เปลี่ยนพฤติกรรม API (คง 409 all-or-nothing) — เขียนแถว `written` (`cancel_requested`) ก่อนด้วย `update_many` แบบมี guard → อ่าน stay ใหม่ ถ้ามีคน check-in ให้ย้อน flag เฉพาะที่ request นี้ตั้งแล้ว 409 → ค่อยยกเลิกแถว `pending`; exception หลังตั้ง flag ต้องย้อน flag ของตัวเองก่อนโยนต่อ · **คำชี้แจง FR-40:** แถว `written` ที่ `cancel_requested` ถูกตั้งโดย request อื่นที่ยังทำงานอยู่ **ยังไม่นับเป็น FINISHED** — ตอนตั้ง flag ให้ใส่ `cancel_flag_token` (id ของ request; field ใหม่ใน `external_bookings` §9.7) และลบเมื่อ request นั้นสำเร็จ; request ที่เจอแถวที่มี token ของคนอื่นให้รอสั้น ๆ (≤ 1 วิ) แล้วอ่านใหม่: token หาย → FINISHED (ข้าม) · flag ถูกย้อน → OPEN (ทำต่อ) · หมดเวลา → 409 `booking_not_cancellable`
  - **#613 (reconcile แถวที่จบแล้ว):** worker GET `evacuee_id` / `household_id` ที่จองไว้ในแถว `cancelled` / `rejected` ตรง ๆ (ไม่เพิ่ม Mango index) · stay `pre_registered` → `cancelled`, household ที่ไม่เหลือสมาชิก active → ยกเลิก · stay ที่เลย `pre_registered` แล้ว **ไม่แตะ** บันทึกผล + log warning ไม่มี PII · ติดตามด้วย field ใหม่ `reconciled_at` + `reconcile_outcome` (§9.7, additive; ไม่ bump `schema_v` ของ CouchDB) · แถวเก่าก่อน deploy ถือว่ายังไม่ reconcile · ทำทีละ batch ในรอบเดียวกับ sweeper (60 วิ) · error ชั่วคราว → ไม่ตั้ง `reconciled_at` ให้รอบหน้าทำซ้ำ
  - **#614 (create idempotent):** header `Idempotency-Key` (ไม่บังคับ, ≤ 255 ตัว; ไม่ส่ง = พฤติกรรมเดิม) · unique `(client_id, key)` อายุ 24 ชม. (TTL) เก็บ hash ของ request ไม่เก็บ PII ดิบ · key + payload เดิม → 201 body เดิม (`booking_id` เดิม) · key เดิม payload ต่าง → 409 `idempotency_key_reused` · request แรกยังไม่จบ → 409 `idempotency_in_progress` · **G5:** ก่อนตอบ 500 ตอน commit ให้นับแถว `committed: true` ของ `booking_id` ใหม่ ถ้าครบ `group_size` ตอบ 201 (ทำเสมอ ไม่ขึ้นกับ key)
  - **#615 (rate limit):** ไม่ทำใน app — ย้ายเป็นงาน infra (nginx `limit_req` บน host) ให้ DevOps ตัดสิน key/ค่าเอง · contract §5.3 คง "ไม่มี partner-plane rate limit ใน app"
  - **#616 (atomic group commit):** เลื่อน — ประเมินใหม่หลัง #612/#613/#614 merge; กลับมาทำถ้ายังพบแถวค้างหรือ commit ไม่ครบกลุ่มใน production
- 2026-10-17 — **decision sync (ต่อ, จาก code review ของ PR #635/#665/#666)**:
  - **#612:** ยอมรับ residual race — หลังยกเลิกแถว `pending` แบบ bulk แล้ว ถ้าแถวที่ worker เพิ่งเขียนกลางทางยกเลิกไม่ได้ (เช่น flag ของ request อื่นค้างเกิน 1 วิ) ยังตอบ 409 ทั้งที่แถว `pending` อื่นถูกยกเลิกไปแล้ว (ย้อนไม่ได้เพราะล้าง PII) · partner retry ได้ผลถูก · ปิดจริงต้อง #616 · หลังหมดเวลารอ flag ของ request อื่นต้องอ่านแถวซ้ำอีกครั้งก่อนตอบ 409
  - **#613:** household ที่ยังมีสมาชิกสถานะ `arriving` / `active` / `room_confirmed` / `temporary_leave` / `kiosk_registered` **ไม่ถูกยกเลิก** ทั้งใน reconcile และ path cancel ของ EXT-009 (ตาม `schema.md` §1.3; กฎเดิมที่ดูแค่ `pre_registered` เป็นบั๊ก) · reconcile: ยกเลิก stay/household สำเร็จแต่เขียน audit doc ล้ม = transient → ไม่ตั้ง `reconciled_at`; รอบหน้าเห็น doc ที่ยกเลิกแล้วแต่ไม่มี audit → เขียน audit (id คงที่ กันซ้ำ) แล้วบันทึก `cancelled` · เฉพาะ reconcile path (path cancel เดิมคง best-effort)
  - **#614:** record ของ `Idempotency-Key` เก็บ `booking_id` ตั้งแต่ตอนใส่ · `in_progress` ที่อายุเกิน 60 วิ ตัดสินจากแถวจริง: committed ครบกลุ่ม → 201 คืน booking เดิมและปิด record · ไม่มีแถว committed → ปลด key ทำใหม่ · committed ไม่ครบ → 409 `idempotency_in_progress` (sweeper กวาดแถว staged ที่ 60 วิ)
- 2026-10-17 — **decision sync (ต่อ, review รอบ 2 ของ PR #635/#665)**:
  - **#613:** ก่อน reconcile ยกเลิก stay/household ให้ตั้ง marker บนแถว (`reconcile_cancelled_at`; field เพิ่มใน §9.7) · รอบ retry เขียน audit ของ partner **เฉพาะแถวที่มี marker** · doc ที่ถูกยกเลิกโดยคนอื่น (เช่น staff) โดยไม่มี marker → outcome `noop` ไม่เขียน audit ของ partner
  - **#612:** ย้อน flag ล้ม (error) หรือ process ตายก่อนย้อน → **ไม่ล้าง `cancel_flag_token`** · worker ไม่ยกเลิกแถวที่ยังมี token · token ที่อายุเกิน 2 นาที = request ที่ตายไปแล้ว → worker ย้อน flag (`cancel_requested=false`, ล้าง token) เพราะ partner ไม่เคยได้ 200 · request ที่สำเร็จล้าง token ของตัวเองตามเดิม
- 2026-10-17 — **decision sync (ต่อ, review รอบ 3 ของ PR #635/#665)**:
  - **#613:** audit ของ partner ตอน retry ตัดสินราย doc ไม่ใช่รายแถว — doc ไม่มี `updated_by` จึงให้ worker บันทึก timestamp ที่ใช้เขียนตอนยกเลิกไว้ใน marker ของแต่ละ doc และเขียน audit เฉพาะเมื่อ `current_stay.since` (stay) / `updated_at` (household) ตรงกับ marker · ไม่ตรง (คนอื่นยกเลิก เช่น staff) → `noop` ไม่เขียน audit ของ partner
  - **#612:** **ไม่รับ**กฎ "ถือ flag ได้ไม่เกิน 60 วิ" — เอาออกจากโค้ดและ docs · ยอมรับ residual ที่เหลือ (ล้าง token ได้บางแถวแล้ว Mongo ล้ม, ล้าง token นานเกิน TTL 2 นาที, access log `granted` แต่ commit 500, client ตัดการเชื่อมต่อกลาง commit) — ทุกกรณีต้อง Mongo ล้มกลางคำสั่งหรือช้าเกิน 1 นาที · ปิดจริงที่ #616 (เกณฑ์: ถ้าพบใน production → replica set / transaction)
