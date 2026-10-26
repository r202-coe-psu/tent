---
id: CR-189
title: Kiosk check-in claim ผู้ลงทะเบียนแบบไม่ระบุศูนย์ (Unassigned Registration) เข้าศูนย์ของ kiosk
status: approved
date: 2026-10-24
created: 2026-10-24
updated: 2026-10-24
requested_by: ทีม kiosk SaktanuthPeak
decided_by: Team Leader (Soravit) — approved 2026-10-24
layer: volatile
affects:
  - docs/data/schema.md §9.5 (Claim rule — actor staff → staff | kiosk; `claimed_by` = `kiosk:{device_id}`; Indexes + `by_member_evacuee_id`)
  - packages/tent-model/src/tent_model/unassigned_registration.py (index `members.reserved_evacuee_id`)
  - schema_v ไม่เปลี่ยน (unassigned_registrations คง schema_v 3; `claimed_by` ยังเป็น str)
  - backend/apiapp/modules/unassigned_registrations/{router,use_case,schemas}.py (service endpoints ใหม่)
  - frontend/src/lib/features/kiosk/server/kiosk-check-in.server.ts (lookup fallback + claim ก่อน check-in)
  - frontend/src/routes/api/v1/kiosk/check-in/+server.ts
  - frontend/src/lib/features/kiosk/ui/qr-identity-scan.svelte
  - frontend/src/lib/api-specs/fastapi.json + frontend/src/lib/api/openapi.d.ts
  - ไฟล์ใหม่ (สร้างใน PR โค้ด): frontend/src/lib/features/kiosk/server/kiosk-unassigned.server.ts, frontend/src/lib/features/kiosk/domain/kiosk-qr.ts, backend/tests/test_unassigned_registration_kiosk.py
---

# CR-189: Kiosk check-in claim ผู้ลงทะเบียนแบบไม่ระบุศูนย์

## สรุป (TL;DR)

- **เปลี่ยน:** kiosk ค้นเจอผู้ลงทะเบียนล่วงหน้าแบบไม่ระบุศูนย์ (Mongo `unassigned_registrations`) จาก QR ตั๋ว / บัตรประชาชน / ThaiD แล้ว claim สมาชิกที่เลือกเข้าศูนย์ของ kiosk และ check-in ต่อทันที
- **ทำไม:** ปัจจุบัน kiosk ค้นเฉพาะ `shelter_*` ผู้ลงทะเบียนกลุ่มนี้จึงต้องรอเจ้าหน้าที่ claim จากคิวกลาง และบัตร/ThaiD ถูกเสนอ walk-in → เกิดคนซ้ำ
- **Build:** FastAPI service endpoints 3 ตัว (lookup / prepare / revert) + kiosk BFF fallback + claim-then-check-in
- **กระทบ:** กฎ claim ใน `schema.md` §9.5 (เดิม staff-only) · ไม่ bump `schema_v`

## Requirements

### Lookup

- **FR-KUC-01** — เมื่อ kiosk lookup ไม่พบผู้ใดใน `shelter_*` ของศูนย์ kiosk ระบบต้องค้น Unassigned Registration ต่อ ก่อนตัดสินผล `not_found` / `can_register`
- **FR-KUC-02** — QR gate ต้องรับ payload เป็น ULID เปล่า (registration `_id` บนตั๋วแบบไม่ระบุศูนย์) เพิ่มจาก `evacuee:{ulid}`
- **FR-KUC-03** — Smart-card และ ThaiD ค้นสมาชิกที่ `status = open` ที่มี `person_id` ตรงกับ citizen id ที่ยืนยันแล้ว
- **FR-KUC-04** — Phone gate ไม่ค้น Unassigned Registration (phone gate = reprint เท่านั้น)
- **FR-KUC-05** — เมื่อพบ ให้แสดงสมาชิก **ทั้งครอบครัว** ในใบลงทะเบียน:
  - `open` → เลือกได้ (แสดงสถานะ `pre_registered`)
  - `claimed` เข้าศูนย์นี้ → สถานะตาม Couch `shelter_*`; เลือกได้ถ้ายัง `pre_registered`
  - `claimed` เข้าศูนย์นี้แต่ไม่มี doc ใน Couch (orphan claim) → แสดงเหมือน `open` เพื่อให้ check-in ซ่อม
  - `claimed` เข้าศูนย์อื่น / `cancelled` → **ไม่แสดง**
  - ไม่มีสมาชิกที่แสดงได้เลย → `not_found` (ไม่เสนอ walk-in)
- **FR-KUC-05a** — สมาชิกหลัก (primary) = สมาชิกที่ตรงกับ citizen id ที่สแกน; QR ตั๋ว = สมาชิกคนแรกที่แสดงได้
- **FR-KUC-06** — ชื่อสกุลใน lookup ต้อง mask เหมือน flow check-in เดิม; FastAPI lookup ไม่คืน PII อื่น (เบอร์, ที่อยู่, รูป)

### Claim + check-in

- **FR-KUC-07** — เมื่อยืนยัน: สมาชิกที่เลือกแต่ไม่มี doc ใน Couch ของศูนย์ → หาใบลงทะเบียนจาก `reserved_evacuee_id` → claim เฉพาะคนที่ `open` หรือ claimed เข้าศูนย์นี้ → check-in ทั้งหมดด้วย `checkInSelectedMembers` เดิม; client ไม่ต้องส่ง registration id (body ของ check-in ไม่เปลี่ยน)
- **FR-KUC-07a** — ถ้าสมาชิกหลัก (FR-KUC-05a) ไม่ได้ถูกเลือกและไม่มี doc ใน Couch ของศูนย์ → BFF ส่ง `primaryEvacueeId` เข้า `checkInSelectedMembers` เป็นสมาชิกที่เลือกคนแรกที่มี doc ใน Couch หลัง claim (มิฉะนั้น lookup primary ใน Couch ไม่เจอ → `not_eligible` ทั้งชุด)
  - การตรวจ citizen id ของ ThaiD / บัตร ใช้ FR-KUC-13 (`required_person_id` ตอน `prepare`) แทน `requiredPrimaryCitizenId` เพราะ primary ที่ส่งเข้าไปไม่ใช่คนที่สแกน
- **FR-KUC-08** — `shelter_code` ของ claim = ศูนย์ของ scanner ที่ authenticate (principal) เท่านั้น ห้ามรับจาก request body ของ kiosk
- **FR-KUC-09** — Claim ใช้ option B เดิม: mark claimed ใน Mongo ก่อน → birth Couch `household` (ถ้ายังไม่มี) + `evacuee` (+`image`) ที่ `pre_registered` → Couch ล้ม = revert Mongo
- **FR-KUC-10** — Couch birth ทำโดย kiosk BFF ด้วย `adminFetch` (FastAPI ไม่ถือ credential Couch); FastAPI `prepare` คืน doc ที่ build แล้ว + รูป (base64)
  - `household` เขียนเฉพาะเมื่อยังไม่มีใน Couch (ไม่ overwrite)
  - `_bulk_docs` เดียว: household? + evacuee + image (inline `_attachments` full/thumb) เฉพาะรูปที่ evacuee อ้างถึง
  - row `conflict` = เกิดแล้ว (OK); error อื่น = ล้ม → revert
  - ก่อน `_bulk_docs` ให้เช็ค evacuee id ที่มีอยู่แล้วใน Couch (`_all_docs?keys=`) แล้วตัด evacuee + image ของคนนั้นออก เพื่อไม่ให้เกิด `image:` doc ค้างตอนซ่อม orphan claim (FR-KUC-15)
- **FR-KUC-11** — สมาชิกที่ไม่ได้เลือกคง `open` ในคิวกลาง
- **FR-KUC-12** — สัตว์เลี้ยงไม่ถูก claim ผ่าน kiosk; คง `open` ให้เจ้าหน้าที่ claim ภายหลัง
- **FR-KUC-13** — Smart-card / ThaiD: citizen id ต้องตรงกับ `person_id` ของสมาชิกคนใดคนหนึ่งในใบลงทะเบียน มิฉะนั้น reject ก่อน mark claimed (`PERSON_MISMATCH`)
  - ThaiD ใช้ citizen id จาก session ที่ server ถือ; mismatch → `KIOSK_THAID_SESSION_INVALID` เดิม
  - Smart-card ใช้ `citizen_id` ใน body ของ check-in (ค่าจาก client)
- **FR-KUC-14** — Claim ล้มหรือสมาชิกถูก claim ไปก่อน → ไม่ check-in ใครเลย และแสดงข้อความภาษาไทยตามตาราง Error codes; ThaiD คืน session ให้สแกนใหม่ได้
- **FR-KUC-15** — `prepare` ซ้ำสำหรับสมาชิกที่ `claimed` เข้า **ศูนย์เดียวกัน** แล้วต้อง idempotent (rebuild docs; `_bulk_docs` conflict = OK) เพื่อซ่อม claim ที่ค้าง

### Audit + auth

- **FR-KUC-16** — `members[].claimed_by` = `kiosk:{device_id}` เมื่อ claim ผ่าน kiosk; Couch `created_by` ใช้ค่าเดียวกัน
- **FR-KUC-16a** — Revert ย้อนเฉพาะสมาชิกที่ `claimed_by = kiosk:{device_id}` และ `claimed_shelter_code` ตรงกับที่ส่งมา; คำนวณ `open_person_id_numbers` / `open_phones` ใหม่ และตั้งเอกสารกลับเป็น `open`; เรียกซ้ำได้ (idempotent)
  - ต้องเป็น atomic update ครั้งเดียว (`update_one` filter ด้วย `claimed_by` + `claimed_shelter_code`, ใช้ array filters / update pipeline คำนวณ `open_*`) — ห้ามอ่าน Beanie doc ทั้งฉบับแล้ว save ทับ
- **FR-KUC-17** — FastAPI endpoints ใหม่ป้องกันด้วย `verify_external_secret` (Bearer `EXTERNAL_API_SECRET`) — ไม่มี secret / env ใหม่ ทั้งฝั่ง FastAPI, BFF และเครื่อง kiosk
- **FR-KUC-18** — BFF ต้อง `authenticateScannerDevice` ก่อนเรียก FastAPI ทุกครั้ง; `device_id` และ `shelter_code` ที่ส่งให้ FastAPI มาจาก principal
- **FR-KUC-18a** — Mongo index `by_member_evacuee_id` บน `members.reserved_evacuee_id` (check-in หาใบจาก evacuee id); query ด้วย citizen id ต้องใส่ `open_person_id_numbers.0: {$exists: true}` เพื่อใช้ partial index `uniq_open_person_id_numbers`

### Availability

- **FR-KUC-19** — FastAPI/Mongo ไม่พร้อม (network error, 5xx, body ผิดรูป หรือ timeout) ระหว่าง lookup:
  - QR ULID → 503 `KIOSK_LOOKUP_UNAVAILABLE` (code เดิมของ lookup)
  - Smart-card / ThaiD → **fail open**: ทำเหมือนไม่พบในคิวกลาง (เสนอ walk-in ตาม config เดิม); log เตือนโดยไม่มี PII
- **FR-KUC-19a** — FastAPI/Mongo ไม่พร้อมระหว่าง check-in → 503 `KIOSK_QUEUE_UNAVAILABLE`, ไม่ check-in ใคร
- **FR-KUC-19b** — Timeout ฝั่ง BFF (ค่าคงที่ในโค้ด ต้องน้อยกว่า timeout 10 วินาทีของ kiosk client):

  | Call | Timeout |
  | --- | --- |
  | kiosk-lookup | 3 วินาที |
  | prepare | 6 วินาที (โหลดรูปจาก GridFS) |
  | revert | 3 วินาที |

- **FR-KUC-19c** — prepare ล้มแบบ network / timeout หลังส่ง request แล้ว → BFF เรียก revert แบบ best-effort ก่อนแจ้ง error (Mongo อาจ mark ไปแล้ว)
- **FR-KUC-20** — สมาชิกที่พบใน `shelter_*` แล้วไม่เรียก FastAPI (check-in เดิมไม่ขึ้นกับคิวกลาง)

### Error codes (kiosk BFF)

| Route | Status | Code | ข้อความ |
| --- | --- | --- | --- |
| check-in | 409 | `KIOSK_CLAIM_CONFLICT` | มีสมาชิกถูกรับเข้าศูนย์อื่นแล้วหรือถูกยกเลิก กรุณาติดต่อเจ้าหน้าที่ |
| check-in | 409 | `KIOSK_CLAIM_PERSON_MISMATCH` | บัตรนี้ไม่ตรงกับผู้ลงทะเบียน กรุณาติดต่อเจ้าหน้าที่ |
| check-in | 503 | `KIOSK_QUEUE_UNAVAILABLE` | ระบบคิวกลางไม่พร้อม กรุณาติดต่อเจ้าหน้าที่ |
| check-in | 503 | `KIOSK_CLAIM_FAILED` | รับเข้าศูนย์ไม่สำเร็จ กรุณาลองอีกครั้ง |
| lookup (QR ULID) | 503 | `KIOSK_LOOKUP_UNAVAILABLE` | (ข้อความเดิม) |

### FastAPI service endpoints

Prefix `/public/v1/unassigned-registrations` · Bearer `EXTERNAL_API_SECRET` ทุกตัว

| Endpoint | Body | ผล |
| --- | --- | --- |
| `POST /kiosk-lookup` | หนึ่งใน `registration_id` / `citizen_id` / `evacuee_id` | ทั้งครอบครัว: id, ชื่อ (ไม่ mask — BFF mask), gender, age, status, `claimed_shelter_code`, `matched` · 404 `NOT_FOUND` |
| `POST /{id}/kiosk-claim/prepare` | `shelter_code`, `device_id`, `member_ids` (1–20), `required_person_id?` | mark + คืน `household`, `evacuees[]`, `images[]` · 404 `NOT_FOUND`/`MEMBER_NOT_FOUND` · 403 `PERSON_MISMATCH` · 409 `ALREADY_CLAIMED` (claimed เข้าศูนย์อื่น) / `MEMBER_NOT_OPEN` (cancelled) · claimed เข้าศูนย์เดียวกันแล้ว → 200 idempotent คืน payload เดิม (FR-KUC-15) |
| `POST /{id}/kiosk-claim/revert` | `shelter_code`, `device_id`, `member_ids` | `{ reverted: [...] }` (FR-KUC-16a) |

## Out of scope

- ความจุศูนย์ (ศูนย์เต็ม) — Station 3 จัดการ
- Edge/LAN fallback (CR-064) — ทำรอบถัดไป; บน edge ไม่มี FastAPI/Mongo จึงเข้าเคส FR-KUC-19
- Claim สัตว์เลี้ยงที่ kiosk
- Rate limit แยกของ endpoint ใหม่ — ครอบด้วย zone `tent_kiosk` ของ nginx (`/api/v1/kiosk/*`) อยู่แล้ว; FastAPI endpoints เรียกได้เฉพาะ BFF ผ่าน docker network + service secret

## Acceptance

- [ ] สแกน QR ตั๋วไม่ระบุศูนย์ → เห็นทั้งครอบครัว → เลือก 2 จาก 3 → ทั้ง 2 คนเป็น `arriving` ใน `shelter_*` ของ kiosk, คนที่ 3 คง `open` ใน Mongo
- [ ] เสียบบัตรของสมาชิก `open` → ไม่ถูกเสนอ walk-in; ได้หน้าเลือกครอบครัว
- [ ] Couch birth ล้ม → สมาชิกกลับเป็น `open` ใน Mongo และไม่มีใครถูก check-in
- [ ] สมาชิกถูกเจ้าหน้าที่อีกศูนย์ claim ระหว่างนั้น → ข้อความภาษาไทย, ไม่ check-in ครึ่ง ๆ
- [ ] สแกน QR ตั๋วเดิมซ้ำหลัง claim → เห็นสถานะจริงจาก Couch
- [ ] Mongo ล่ม + เสียบบัตร → flow walk-in เดิม; Mongo ล่ม + QR ULID → 503
- [ ] FastAPI ไม่ตอบระหว่าง prepare → revert ถูกเรียก, ไม่มีใคร check-in, kiosk ได้ 503 ภายใน 10 วินาที
- [ ] ผู้ที่อยู่ใน `shelter_*` แล้ว check-in ได้โดยไม่เรียก FastAPI
- [ ] `explain()` ของ query ด้วย citizen id และ evacuee id เป็น `IXSCAN`
- [ ] `claimed_by` ใน Mongo = `kiosk:{device_id}`
- [ ] Claim ของเจ้าหน้าที่ (Station 1) ทำงานเหมือนเดิม — test เดิมผ่าน

## Why

- ผู้ลงทะเบียนแบบไม่ระบุศูนย์ถือตั๋ว QR แต่ kiosk ปฏิเสธ (regex บังคับ `evacuee:`) ต้องรอเจ้าหน้าที่ claim จากคิวกลาง
- บัตร/ThaiD ของคนกลุ่มนี้ได้ `not_found` + `can_register` → walk-in สร้าง evacuee ใหม่ซ้ำกับคิวกลาง
- Couch birth อยู่ที่ BFF เพราะ FastAPI claim ใช้ cookie ของเจ้าหน้าที่ (`HttpCouchBirth`) และ kiosk ไม่มี cookie; การให้ FastAPI ถือ credential Couch = เปลี่ยน trust boundary (stable core) — ตัดทิ้ง

## Change

| | Before | After |
| --- | --- | --- |
| ผู้ claim | staff (`require_registration_staff`) | staff **หรือ** kiosk (ผ่าน BFF + service secret) |
| `claimed_by` | `session.name` | `session.name` หรือ `kiosk:{device_id}` |
| Kiosk lookup scope | `shelter_*` ของ kiosk | `shelter_*` → Unassigned Registration |
| QR gate | `evacuee:{ulid}` | `evacuee:{ulid}` หรือ ULID เปล่า |

## Impact

- **FastAPI** (`backend/apiapp/modules/unassigned_registrations/`): 3 endpoints ตามตารางข้างบนใน `router.py`, `schemas.py`, `use_case.py`; claim ของเจ้าหน้าที่ใช้ helper รูปภาพร่วม (`_load_couch_image_payload`) พฤติกรรมเดิม
  - test ใหม่: `backend/tests/test_unassigned_registration_kiosk.py` (ใหม่)
- **tent-model** (`packages/tent-model/src/tent_model/unassigned_registration.py`): index `by_member_evacuee_id`
- **Frontend** (`frontend/src/`):
  - `lib/features/kiosk/server/kiosk-unassigned.server.ts` (ใหม่): เรียก FastAPI, เขียน Couch, revert
  - `lib/features/kiosk/server/kiosk-check-in.server.ts`: lookup fallback, gate schema รับ ULID เปล่า, `checkInSelectedMembers` options `deviceId` / `claimPersonId`
  - `routes/api/v1/kiosk/check-in/+server.ts`: ส่ง `deviceId` จาก principal + map error codes
  - `lib/features/kiosk/domain/kiosk-qr.ts` (ใหม่) + `lib/features/kiosk/ui/qr-identity-scan.svelte`: แยก QR evacuee / ตั๋วไม่ระบุศูนย์
  - `lib/api-specs/fastapi.json` + `lib/api/openapi.d.ts` regenerate
- **ไม่เปลี่ยน:** body ของ kiosk lookup/check-in, หน้าเลือกสมาชิก, env / secret
- **Docs (หลัง approve):** `schema.md` §9.5 Claim rule + `claimed_by`

## Risks

- **Orphan claim:** BFF ตายหลัง `prepare` ก่อน Couch write/revert → Mongo `claimed` แต่ไม่มี Couch doc. ลดด้วย FR-KUC-15 (prepare ซ้ำศูนย์เดิม idempotent) + log `registration_id`/`member_ids` เมื่อ revert ล้ม
- **Fail open → คนซ้ำ:** Mongo ล่มขณะเสียบบัตรของผู้ที่อยู่ในคิวกลาง → walk-in ซ้ำได้ (ยอมรับชั่วคราว; ทบทวนพร้อม edge)
- **Response size:** รูปสมาชิก base64 ใน `prepare`
- **Smart-card citizen id มาจาก client:** FR-KUC-13 สำหรับบัตรอ้างค่าที่ kiosk ส่งมา (ThaiD ใช้ค่าจาก server)
- **Stale identity keys:** revert คำนวณ `open_*` จากเอกสารที่อ่านก่อน update; kiosk อื่น claim สมาชิกในครอบครัวเดียวกันในช่วงสั้นนั้นอาจทิ้ง key ค้าง (ผล: ลงทะเบียน identity นั้นซ้ำไม่ได้จนกว่าจะแก้). ลดด้วย atomic update ใน FR-KUC-16a
- **Prepare ซ้ำสร้าง `image:` id ใหม่:** BFF เขียนรูปเฉพาะของ evacuee ที่อ้างถึง แต่ถ้า evacuee มีอยู่แล้ว (conflict) image doc ใหม่ยังถูกเขียน → อาจมี image ค้างในกรณีซ่อม orphan. ลดด้วยการตัด evacuee ที่มีอยู่แล้วออกก่อน `_bulk_docs` (FR-KUC-10)

## Migration

N/A — ไม่เปลี่ยนรูปร่าง doc; `claimed_by` ค่าใหม่เป็น str รูปแบบ `kiosk:{device_id}`

## Decision log

- 2026-10-24 — proposed (ทีม kiosk): ทั้งครอบครัว, pets คง open, ความจุ = Station 3, fail open, edge เลื่อนรอบหน้า, Couch birth ที่ BFF (ไม่เพิ่ม secret)
- 2026-10-24 — ทีม kiosk: client ไม่ส่ง registration id ตอน check-in (server หาจาก `reserved_evacuee_id`); ไม่แสดงสมาชิกศูนย์อื่น → ไม่ต้องแก้หน้าเลือกสมาชิก
- 2026-10-24 — ทีม kiosk: timeout เป็นค่าคงที่ในโค้ด (ไม่ใช่ env); เพิ่ม index evacuee id + ใช้ partial index ของ citizen id
- 2026-10-24 — ทีม kiosk (ตาม review PR #838): primary ไม่ถูกเลือก → ใช้สมาชิกที่เลือกคนแรก (FR-KUC-07a); prepare ศูนย์เดิมคืน 200 ไม่ใช่ 409; ตัด evacuee ที่มีแล้วก่อน bulk write; revert แบบ atomic; FR-KUC-21 → FR-KUC-18a
- 2026-10-24 — Team Leader (Soravit) approve CR-189: requested by ทีม kiosk SaktanuthPeak, รันเลข CR-189 จัดเข้าหมวด 14-kiosk
