---
id: CR-154
title: M2 integration ย้ายเข้า Partner OAuth plane — booking (EXT-008/009/010) + residency (EXT-011), scope ใหม่, evacuee.gender nullable (schema_v 11→12)
status: approved
date: 2026-10-06
requested_by: เจ้าของโครงการ (สเปก M2 A_M2_API_SERVICES_SHELTER_V1.0)
decided_by: เจ้าของโครงการ
layer: volatile
supersedes_part_of: CR-098 (M2 endpoints บน /external/v1)
affects:
  - docs/data/api-contract.md §5.1 (ลบแถว M2), §5.3 (เพิ่ม EXT-008–011)
  - docs/data/schema.md §1.1 evacuee (gender nullable, registered_via += api) · schema_v 11 → 12
  - docs/data/schema.md §9.4 third_party_access_logs (endpoint += EXT-008–011)
  - docs/data/schema.md §9.6 third_party_clients (allowed_scopes += booking-write, residency-read; module_name += M2, req → opt nullable)
  - docs/data/schema.md §9.4 third_party_access_logs (module_name nullable)
  - CR-135 FR-4 (module radio บังคับ → ไม่บังคับ)
  - docs/data/schema.md §9.7 external_bookings (ใหม่, MongoDB)
  - docs/adr/0002-partner-integration-architecture.md (scope list)
  - packages/tent-model/src/tent_model/{third_party_client.py, external_booking.py}
  - backend/apiapp/modules/{thirdparty_bookings, thirdparty_residency}/** (ใหม่)
  - backend/apiapp/modules/external/{router.py, schemas.py, residency.py} (ลบ M2 endpoints)
  - worker/src/worker/inbound/external_bookings.py (ใหม่) · worker projectors occupancy/occupant/evacuee
  - frontend/src/lib/features/people/domain/** (Zod gender nullable, registered_via api) + people UI
  - frontend/src/lib/features/third-party-clients/** (scope ใหม่)
---

# CR-154 — M2 integration ย้ายเข้า Partner OAuth plane — booking + residency

## สรุป (TL;DR)

- **เปลี่ยนอะไร:** ให้บริการ M2 ทั้ง 3 ตัว (shelter list, booking, residency) ผ่าน **Partner OAuth plane `/external/*`**, ตัวเดียวกับที่ M6/M7 ใช้ (ADR 0002). ลบ endpoint M2 สองตัวบน legacy `/external/v1`
- **เพื่อใคร/ทำไม:** M2 (ระบบประเมินความพร้อมและจัดการกลุ่มเปราะบาง) จองศูนย์พักพิงแทนประชาชนและตรวจสถานะการเข้าพักได้ ใช้ auth, envelope และ error เดียวกับพันธมิตรรายอื่น
- **dev ต้อง build:**
  - `POST /external/bookings`, `POST /external/bookings/{id}/cancel`, `GET /external/bookings/{id}` และ `GET /external/persons/shelter-residency`
  - Mongo buffer `external_bookings` และ worker inbound → CouchDB
  - scope ใหม่ `booking-write` และ `residency-read`
- **กระทบ schema:** `evacuee.gender` nullable, `registered_via` เพิ่ม `api` (schema_v 11→12) · Mongo collection ใหม่ `external_bookings` · scope ใหม่ใน `third_party_clients`

---

## Change

### C1 — Mapping สเปก M2 → Partner plane

| สเปก M2 (PDF §3) | Before (CR-098) | After |
| --- | --- | --- |
| 3.1 get-list-shelter | `GET /external/v1/shelters` · API key | **`GET /external/locations?status=open`** (EXT-002 เดิม) · scope `location-read` |
| 3.2 booking-shelter | ยังไม่มี (deferred) | **`POST /external/bookings`** (EXT-008) · scope `booking-write` |
| — (ขยายเพิ่ม) | — | **`POST /external/bookings/{booking_id}/cancel`** (EXT-009) · `booking-write` |
| — (ขยายเพิ่ม) | — | **`GET /external/bookings/{booking_id}`** (EXT-010) · `booking-write` |
| 3.3 get-person-shelter-residency | `GET /external/v1/persons/shelter-residency` · API key | **`GET /external/persons/shelter-residency?cid=&purpose=`** (EXT-011) · scope `residency-read` |

**Field mapping ที่ส่งให้ M2**

| ชื่อในสเปก M2 | ชื่อในระบบเรา |
| --- | --- |
| `shelter_id` | `location_code` |
| `shelter_name` | `name_th` |
| `lat` | `latitude` |
| `long` | `longitude` |
| `status` (booking) | `booking_status` |
| `status` (residency) | `residency_status` |

### C2 — Conventions (ยึด Partner plane เดิม ไม่สร้างใหม่)

- **FR-01** auth ใช้ `POST /external/token` แบบ client_credentials ได้ JWT HS256 อายุ 3600s ที่ฝัง scope ไว้ ใช้ร่วมกับ EXT-001
- **FR-02** response ที่สำเร็จอยู่ในรูป `{status, message, result, pagination?}`
- **FR-03** error อยู่ในรูป `{status, message, code, detail?}` โดยผ่าน `_partner_error_body` เดิม
- **FR-04** วันเวลาเป็น ISO 8601 ที่ offset `+07:00`

**Error codes**

| HTTP | code | ใช้กับ | เงื่อนไข |
| --- | --- | --- | --- |
| 400 | `missing_purpose` | EXT-011 | ไม่ส่ง `purpose` หรือส่งเป็นค่าว่าง |
| 401 | `invalid_token` | ทุกตัว | ไม่มี token, token ผิด หรือหมดอายุ |
| 403 | `insufficient_scope` | ทุกตัว | token ไม่มี scope ที่ endpoint ต้องการ |
| 404 | `location_not_found` | EXT-008 | ไม่พบศูนย์ หรือ `is_active=false` |
| 404 | `booking_not_found` | EXT-009/010 | ไม่พบ booking หรือ booking เป็นของ client อื่น |
| 404 | `residency_not_found` | EXT-011 | ไม่พบการเข้าพัก (รวมกรณี `pre_registered`) |
| 409 | `location_not_bookable` | EXT-008 | ศูนย์ `closed` หรือ `feature_flags.accepts_pre_registration = false` |
| 409 | `duplicate_booking` | EXT-008 | CID นี้มี hold อยู่แล้วใน **ศูนย์เดียวกัน** |
| 409 | `booking_not_cancellable` | EXT-009 | booking ถูกยกเลิกไปแล้ว, ถูก reject ไปแล้ว หรือ stay ผ่าน `pre_registered` ไปแล้ว |
| 422 | `validation_error` | ทุกตัว | ข้อมูลไม่ผ่าน validation |
| 500 | `internal_error` | ทุกตัว | ข้อผิดพลาดภายในระบบ |

### C3 — EXT-008 สร้าง booking

**Request** `POST /external/bookings`

```json
{ "location_code": "SH014", "cid": "1909800123458", "first_name": "สมชาย", "last_name": "ใจดี", "phone": "0812345678" }
```

**Response 201**

```json
{ "status": 201, "message": "Booking accepted.", "result": { "booking_id": "BK-01J…", "location_code": "SH014", "booking_status": "BOOKED" } }
```

**Validation และลำดับการตรวจ**
- **FR-10** ทุกฟิลด์ต้องมี มิฉะนั้นตอบ 422 `validation_error`
- **FR-11** `cid` ต้องเป็นตัวเลข 13 หลักและผ่าน checksum mod-11 (กติกาเดียวกับ CR-148)
- **FR-12** `phone` normalize ด้วยกติกา CR-148 (`+66` → `0`) แล้วต้องเป็นตัวเลข 9–10 หลัก
- **FR-13** ตัดช่องว่างหัวท้ายของ `first_name` และ `last_name` แล้วต้องไม่เป็นค่าว่าง
- **FR-14** ต้องพบ `location_code` ใน `public_shelters` ที่ `is_active = true` มิฉะนั้นตอบ 404 `location_not_found`
- **FR-15** ศูนย์ที่ `status = closed` หรือ `raw_data.feature_flags.accepts_pre_registration = false` ต้องตอบ 409 `location_not_bookable`
- **FR-16** ศูนย์ `full` / `full_capacity` **ต้องจองได้** และไม่ตรวจ capacity
- **FR-17** ตรวจซ้ำ **เฉพาะศูนย์เดียวกัน** (อนุญาตให้ CID ซ้ำข้ามศูนย์ได้) ตอบ 409 `duplicate_booking` เมื่อเข้ากรณีใดกรณีหนึ่ง:
  - (a) `public_persons` มี `national_id_hash = sha256(cid)`, `shelter_code = location_code` และ `status ∈ {pre_registered, arriving, active, room_confirmed, temporary_leave}`
  - (b) `external_bookings` มี `(shelter_code, cid_hash)` ที่ `state ∈ {pending, written}`
- **FR-18** เมื่อผ่านทุกข้อ ให้ insert `external_bookings` ด้วย `state = pending` แล้วตอบ 201 พร้อม `booking_id = "BK-{ulid}"`
- **FR-19** `201 BOOKED` หมายถึง **รับเข้าคิวแล้ว** ระบบเขียน CouchDB แบบ asynchronous ภายในประมาณ 10 วินาที ส่วนสถานะสุดท้ายดูได้จาก EXT-010
- **FR-20** ทุก call ไม่ว่าสำเร็จหรือถูกปฏิเสธ ต้องเขียน `third_party_access_logs` โดยใช้ `endpoint = "EXT-008"`, `location_code`, `status` (`granted` หรือ `denied_<reason>`) และ **ห้ามเก็บ CID หรือ phone ใน log**

### C4 — EXT-009 ยกเลิก / EXT-010 ดูสถานะ

**EXT-009** `POST /external/bookings/{booking_id}/cancel` body `{ "reason": "<str?>" }` → 200 `result: {booking_id, booking_status: "CANCELLED"}`

- **FR-30** ยกเลิกได้เฉพาะ booking ที่ `client_id` ตรงกับ token มิฉะนั้นตอบ 404 `booking_not_found`
- **FR-31** `state = pending` → ตั้ง `state = cancelled` ทันที worker จะไม่เขียน CouchDB
- **FR-32** `state = written` และ `public_persons.status = pre_registered` → ตั้ง `cancel_requested = true` แล้วตอบ 200 จากนั้น worker เปลี่ยน `evacuee.current_stay.status` เป็น `cancelled`
- **FR-33** `state ∈ {cancelled, rejected}` หรือ stay ผ่าน `pre_registered` ไปแล้ว → ตอบ 409 `booking_not_cancellable`
- **FR-34** log `endpoint = "EXT-009"` ตาม FR-20

**EXT-010** `GET /external/bookings/{booking_id}` → 200 `result: {booking_id, location_code, booking_status, created_at, updated_at}`

- **FR-35** `booking_status` map จาก state ดังนี้:
  - `pending` / `written` → `BOOKED`
  - `cancelled` หรือมี `cancel_requested` → `CANCELLED`
  - `rejected` → `REJECTED` พร้อม `reject_reason`
- **FR-36** ใช้กติกาเจ้าของ booking เดียวกับ FR-30

### C5 — EXT-011 residency

**Request** `GET /external/persons/shelter-residency?cid=1909800123458&purpose=<str>` (scope `residency-read`)

**Response 200**

```json
{ "status": 200, "message": "Found Data.", "result": { "location_code": "SH014", "name_th": "…", "checkin_datetime": "2026-08-20T14:30:00+07:00", "residency_status": "CHECKED_IN", "stay_status": "active", "in_zone": false } }
```

- **FR-40** บังคับส่ง `purpose` มิฉะนั้นตอบ 400 `missing_purpose`
- **FR-41** ทุก call ต้อง log ลง `third_party_access_logs` โดยใช้ `endpoint = "EXT-011"` แบบเดียวกับ EXT-007
- **FR-42** `cid` ต้องเป็นตัวเลข 13 หลัก มิฉะนั้นตอบ 422 ระบบค้นด้วย `national_id_hash` และห้ามเก็บ CID ใน log
- **FR-43** เมื่อพบหลาย record (เพราะซ้ำข้ามศูนย์ได้ตาม FR-17) ให้เลือก record ที่ stay ∈ Present (`active`, `room_confirmed`, `temporary_leave`) ก่อน ถ้าไม่มีให้เลือก record ที่ `updated_at` ล่าสุด
- **FR-44** ตอบ 404 `residency_not_found` เมื่อไม่พบ record, `checked_in_at = null` หรือ stay เป็น `pre_registered`
- **FR-45** กติกา map สถานะคงไว้ตาม CR-098 / CR-112:
  - Present → `CHECKED_IN`
  - สถานะอื่น → `CHECKED_OUT`
  - `in_zone` เป็นจริงเฉพาะ `room_confirmed`

### C6 — Write path: `external_bookings` (MongoDB, ใหม่ — schema.md §9.7)

| Field | ชนิด | req | หมายเหตุ |
| --- | --- | --- | --- |
| `_id` / `booking_id` | str | req | `BK-{ulid}` |
| `client_id`, `module_name` | str | req | จาก JWT claims |
| `shelter_code` | str | req | |
| `cid` | str\|null | req | plaintext ใช้ระหว่างรอเขียน Couch **ต้องล้างเป็น `null` หลังเขียนสำเร็จ, cancel หรือ reject** |
| `cid_hash` | str | req | sha256 ใช้ในการตรวจซ้ำ |
| `first_name`, `last_name`, `phone` | str\|null | req | ล้างเป็น `null` พร้อม `cid` |
| `state` | enum(`pending`,`written`,`cancelled`,`rejected`) | req | |
| `cancel_requested` | bool | req | default `false` |
| `cancel_reason`, `reject_reason` | str\|null | opt | |
| `evacuee_id`, `household_id` | str\|null | opt | ใส่หลังเขียนลง Couch |
| `created_at`, `updated_at` | ts | req | |

**Index**
- unique partial `(shelter_code, cid_hash)` โดย `partialFilterExpression: {state: {$in: [pending, written]}}`
- `(state, updated_at)`

**Worker inbound** `worker/src/worker/inbound/external_bookings.py` poll ทุก 3 วินาทีแบบเดียวกับ `inbound/donations.py`

- **FR-50** สำหรับ `pending`: ใช้ `_find` ใน `shelter_{code}` ค้นตาม `person_id.number = cid` ที่ stay อยู่ใน hold set ถ้าพบ ให้ตั้ง `state = rejected`, `reject_reason = duplicate` และล้าง PII
- **FR-51** ถ้าไม่พบ ให้ `_bulk_docs` สร้าง `household` + `evacuee` 1 คนดังนี้:
  - household: `label = "ครอบครัว{first_name}"`, `head_evacuee_id = evacuee._id`
  - evacuee:
    - ชื่อ: `first_name`, `last_name`
    - ติดต่อและเอกสาร: `phone`, `person_id = {cardType: national_id, number: cid}`, `country = "THAILAND"`
    - ค่าที่ M2 ไม่ได้ส่ง: `gender = null`
    - stay: `current_stay = {status: pre_registered, zone: null, since: now}`
    - ที่มา: `registered_via = api`, `created_by = "partner:{module_name}"` (ถ้า client ไม่มี module → `"partner:{client_id}"`, FR-62)
    - privacy: `privacy.search_excluded = false`
- **FR-52** เมื่อเขียนสำเร็จ ให้ตั้ง `state = written`, ใส่ `evacuee_id`/`household_id` และล้าง PII ถ้าเขียนไม่สำเร็จให้ retry ในรอบถัดไป
- **FR-53** สำหรับ `cancel_requested`: ถ้า evacuee ยังเป็น `pre_registered` ให้เปลี่ยนเป็น `cancelled` แล้วตั้ง `state = cancelled` ถ้าไม่ใช่ ให้ล้าง flag แล้วบันทึก `reject_reason = not_cancellable`
- **FR-54** เขียน CouchDB ด้วย credential ของ worker เดิม (FastAPI ไม่ถือ credential ของ Couch)

### C7 — Scope ใหม่ (ADR 0002, schema.md §9.6)

| Scope | ใช้กับ | หมายเหตุ |
| --- | --- | --- |
| `booking-write` | EXT-008/009/010 | เขียน PII เข้าระบบ admin ต้องออก scope นี้ให้เป็นรายกรณี |
| `residency-read` | EXT-011 | อ่านสถานะรายบุคคล (PII) admin ต้องออก scope นี้ให้เป็นรายกรณี UI แสดงคำเตือนแบบ `occupancy-pii-read` |

- **FR-60** เพิ่ม scope ทั้งสองใน `THIRD_PARTY_SCOPES` และใน Zod enum / label ของ UI third-party-clients
- **FR-61** เพิ่ม partner module **`M2`** ใน `PARTNER_MODULES` (backend `thirdparty_clients_admin/schemas.py`, frontend `third-party-clients/domain`) และใน `schema.md` §9.6 `module_name`; preset scope ของ `M2` = `location-read` เท่านั้น (scope sensitive ไม่ preset)
- **FR-62** `module_name` เปลี่ยนเป็น **optional** (req → opt, nullable): module เป็นแค่ preset ของ scope ในฟอร์มสร้าง — admin เลือก scope เองได้โดยไม่ต้องเลือก module. ไม่เลือก/ว่าง → เก็บ `null` ทั้งใน `third_party_clients`, JWT claim `module_name`, `TokenResponse.module_name` และ `third_party_access_logs.module_name`; UI แสดง "ไม่ระบุ"; ค่าที่ส่งมาต้องอยู่ใน `PARTNER_MODULES` (ค่าอื่น = 422). supersede CR-135 FR-4 (radio บังคับ)

### C8 — Schema change `evacuee` (schema_v 11 → 12)

| Field | Before | After |
| --- | --- | --- |
| `gender` | enum(`male`,`female`,`other`) · req | enum(`male`,`female`,`other`) \| **null** · req (key ต้องมีเสมอ, ค่าเป็น `null` ได้ แปลว่ายังไม่ทราบ) |
| `registered_via` | enum(`kiosk`,`staff`,`backoffice`,`app`,`web`,`import`,`paper`) | **+ `api`** (partner booking, CR นี้) |

- **FR-70** ฟอร์มของ staff, kiosk และ public pre-register **ยังบังคับเลือกเพศเหมือนเดิม** ค่า `null` เกิดได้เฉพาะจาก `registered_via = api`
- **FR-71** UI ที่แสดงเพศต้องแสดงค่า `null` เป็น "ไม่ระบุ" และ Station 1 ต้องให้ staff เติมเพศได้
- **FR-72** worker `occupancy.py` (breakdown `male`/`female`) และ `occupant.py` ต้องรองรับ `gender = null` โดยไม่นับเข้า male หรือ female

### C9 — Legacy `/external/v1`

- **FR-80** ลบ `GET /external/v1/shelters`, `GET /external/v1/persons/shelter-residency`, schema `M2ShelterItem` / `M2PersonResidencyResponse` และ test ที่เกี่ยวข้อง
- **FR-81** endpoint อื่นใน `/external/v1` (needs, occupants, announcements, faqs) รวมถึง API Keys UI **ไม่เปลี่ยน**

---

## Acceptance

- [ ] token ที่ไม่มี `booking-write` เรียก EXT-008 แล้วได้ 403 `insufficient_scope`
- [ ] จองสำเร็จได้ 201 `BOOKED` และภายในประมาณ 10 วินาที มี evacuee `pre_registered` ที่ `gender = null`, `registered_via = api` ใน `shelter_{code}` และ forecast occupancy เพิ่มขึ้น
- [ ] จอง CID เดิมที่ศูนย์เดิมได้ 409 `duplicate_booking` ส่วน CID เดิมที่ **ศูนย์อื่น** ได้ 201
- [ ] จองศูนย์ `full_capacity` ได้ 201 ส่วนศูนย์ `closed` ได้ 409 `location_not_bookable`
- [ ] ยิง create พร้อมกัน 2 request ด้วย CID/ศูนย์เดียวกัน ได้ 201 หนึ่งครั้งและ 409 หนึ่งครั้ง (unique index)
- [ ] cancel ตอน pending ทำให้ไม่มี doc ถูกเขียน ส่วน cancel หลัง written ทำให้ evacuee เป็น `cancelled` และ cancel หลัง check-in ได้ 409
- [ ] หลังเขียน Couch, cancel หรือ reject แล้ว ใน `external_bookings` ไม่มี `cid`, `phone`, `first_name` หรือ `last_name` plaintext เหลืออยู่
- [ ] EXT-011 ที่ไม่ส่ง `purpose` ได้ 400 ทุก call มีแถวใน `third_party_access_logs` ที่ไม่มี CID และเมื่อมีหลาย record จะเลือก record ที่ Present ก่อน
- [ ] `/external/v1/shelters` และ `/external/v1/persons/shelter-residency` ตอบ 404 ส่วน endpoint `/external/v1` อื่นทำงานเหมือนเดิม
- [ ] `pnpm lint`, `pnpm check`, `pnpm test`, backend `pytest` และ worker tests ผ่าน

---

## Why

- สเปก M2 v1.0 (20 ส.ค. 2569) ต้องการบริการ 3 ตัว CR-098 ทำไปแล้ว 2 ตัวบน `/external/v1` ที่ใช้ API key ไม่มี scope และพักบริการ booking ไว้
- **M2 ยังไม่เริ่มใช้งานจริง** จึงกำหนด contract ใหม่ได้โดยไม่มี consumer ได้รับผลกระทบ
- `/external/v1` ถูก soft-deprecate แล้ว (api-contract §5.1) ส่วน Partner plane (ADR 0002) มี scope ราย endpoint, JWT อายุสั้น และ access log สำหรับ PII ซึ่งตรงกับความต้องการของ endpoint ที่ **เขียน PII** (booking) และ **อ่าน PII รายบุคคล** (residency)
- การใช้ plane เดียวกับ M6/M7 ช่วยลดจำนวน auth, envelope และ error format ที่ต้องดูแล

## Impact

- **Docs:**
  - `api-contract.md` §5.1/§5.3
  - `schema.md` §1.1, §9.4, §9.6, §9.7 (ใหม่)
  - ADR 0002 (scope list)
  - handover ฉบับใหม่ให้ M2 ใน `docs/reports/` และสำเนาสเปกต้นฉบับใน `docs/source/`
- **Backend:**
  - module ใหม่ `thirdparty_bookings`, `thirdparty_residency`
  - ลบส่วน M2 ใน `modules/external` และย้าย `residency.py` (status map) ไปไว้ใน module ใหม่
  - เพิ่ม Beanie init ของ model ใหม่
- **tent-model:** `third_party_client.py` (scopes), `external_booking.py` (ใหม่)
- **Worker:**
  - inbound ใหม่
  - projectors `occupancy`, `occupant`, `evacuee` รองรับ `gender = null`
- **Frontend:**
  - people domain (Zod, factory, type `Gender | null`) และ UI ที่แสดง/แก้เพศ
  - third-party-clients scope enum และ labels
  - `pnpm openapi:update`
- **Tests:**
  - `backend/tests/test_thirdparty_bookings.py`, `test_thirdparty_residency.py`
  - แก้ `test_external_m2.py` และ `test_external_residency_map.py`
  - worker inbound tests และ people domain tests
- **ไม่กระทบ:**
  - public pre-register BFF flow
  - `/external/v1` endpoint อื่น
  - EXT-001–007

## Migration

- **evacuee schema_v 11 → 12:**
  - เป็น additive / relaxing ล้วน doc เดิมทุกตัวมี `gender` ครบแล้ว ไม่ต้อง backfill
  - Zod `genderSchema.nullable()` และ `validate_doc_update` (ถ้าตรวจ gender) ต้องรับ `null`
  - reader ทุกจุดต้อง handle `null`
- **`external_bookings`:** เป็น collection ใหม่ สร้าง index ตอน Beanie init
- **`third_party_clients`:** ไม่ต้อง migrate client เดิมไม่มี scope ใหม่ admin ต้องเพิ่มให้เอง
- **CR-098:** ส่วน M2 (`/external/v1/shelters`, `/external/v1/persons/shelter-residency`) ถูก supersede โดย CR นี้ ให้ mark ไว้ใน `_index.md` ตอน approve

## Decision log

- 2026-10-06 — proposed แล้ว approve โดยเจ้าของโครงการ ได้เลข CR-154. ข้อตัดสินของ owner:
  - D1: M2 ยังไม่ใช้งานจริง กำหนด contract ใหม่ได้
  - D2: ยึด M6/M7 Partner plane เป็นหลัก
  - D3: track ด้วย CR
  - D4: ใช้ OAuth และเพิ่ม scope
  - D5: CID ซ้ำข้ามศูนย์ได้ กันซ้ำเฉพาะภายในศูนย์ เพราะ CouchDB แยก DB ต่อศูนย์ เพื่อให้หน้างานทำงานได้ลื่นและลดความซับซ้อน
  - D6: จองศูนย์ `full_capacity` ได้
  - D7: ฟิลด์ที่ M2 ไม่ส่งมาให้เป็น nullable (เฉพาะ `gender`; `country` และ `household.label` ระบบเติมให้)
  - D8: เพิ่ม endpoint ยกเลิก booking
- ทางเลือกที่ตัดทิ้ง: ให้ FastAPI เขียน CouchDB ตรงด้วย public-writer credential แบบ synchronous เพราะต้องเพิ่ม credential ให้ backend และไม่ทนต่อกรณี Couch ล่ม จึงเลือก Mongo buffer → worker inbound ตามแพทเทิร์น donations/volunteers
- 2026-10-06 — implementation note: เพิ่ม FR-61 (`module_name` += `M2`) — จำเป็นต่อ D2/D4 เพราะ `PARTNER_MODULES` เดิมรับแค่ `M6`/`M7` จึงออก client ให้ M2 ไม่ได้
- 2026-10-06 — owner เพิ่ม FR-62: `module_name` ไม่บังคับ (module = preset ของ scope เท่านั้น) เก็บ `null` เมื่อไม่เลือก; บันทึกใน CR-154 (ไม่แยก CR) และ supersede CR-135 FR-4
