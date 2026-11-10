---
id: draft
title: Referral — ส่งต่อผู้ป่วย medical-emergency ไปโรงพยาบาลผ่าน M5 (FastAPI outbound + health gate)
status: proposed
date: 2026-11-10
requested_by: project owner
decided_by: project owner (รอ approve)
layer: stable # เพิ่ม outbound integration plane ใหม่ใน FastAPI + worker inbound loop และแก้ invariant PDPA ของ T-34 — ต้อง review ก่อน
affects:
  - docs/data/schema.md §5.4 (referral — field ใหม่ `to_org.m5_facility_id`, `acuity`, `transport`, `requester_contact`, `external`; authorization ของ transition เมื่อมี `external`)
  - schema_v referral 2 → 3 (additive)
  - docs/data/schema.md §9 (Mongo collection ใหม่ `m5_transfers`, `m5_outbound_logs`)
  - docs/data/api-contract.md (BFF `/api/back-office/referral/m5/*`, FastAPI `/v1/integrations/m5/*`)
  - docs/task-breakdown/09-F-referral.md (T-34 DoD — กฎ "medical detail / national ID ไม่ออกนอกระบบ" และ scope R3 internal-only)
  - docs/adr/0002-partner-integration-architecture.md (เพิ่ม outbound plane — หรือแยกเป็น ADR ใหม่)
  - backend/apiapp/modules/integrations_m5 (ใหม่)
  - worker/src/worker/inbound (loop ใหม่ `m5_transfers` → `central_ops` referral)
  - frontend/src/lib/features/referrals (domain/schema, transitions, server repository, ui medical form/detail)
  - frontend/src/routes/api/back-office/referral (m5 status/facilities/start + guard ใน transition และ bulk-transition)
  - CR-167 bulk-transition และ CR-168 shelter-closure worker (ข้ามใบที่ M5 อนุมัติแล้ว)
source: M5_API_Patient_Referral_External.docx — "M5 Patient Referral API — Integration Guide" v1.0 (15 ต.ค. 2569, ทีม M5; ไม่ได้เก็บใน repo)
---

# Referral — ส่งต่อผู้ป่วยไปโรงพยาบาลผ่าน M5

## สรุป (TL;DR)

referral ประเภท `medical-emergency` จะส่งเป็นใบส่งต่อเข้า M5 ได้ M5 คือระบบส่งต่อผู้ป่วยของ สธ. ที่เจ้าหน้าที่ สธ. ใช้อนุมัติ และโรงพยาบาลใช้กดรับผู้ป่วย

- **การเรียก M5 อยู่ใน FastAPI ที่เดียว** credential ของ M5 ไม่อยู่ใน Node และไม่อยู่ใน browser
- **Browser เรียกผ่าน SvelteKit BFF เท่านั้น** ตาม CR-063
- **สถานะของใบมาจาก M5 เท่านั้น** worker เป็นตัวเขียนสถานะกลับเข้า CouchDB
- **Health gate:** client ต้องตรวจก่อนว่าเชื่อมต่อ FastAPI และ M5 ได้ ถ้าไม่ได้จะปิดการส่งไป M5 และแสดงว่า "เชื่อมต่อกับระบบกลางไม่ได้"
- **schema:** referral `schema_v` 2 → 3 แบบ additive

**ต้องตัดสินก่อน approve:** D1 (PDPA) และ D2 (scope R3/R4) ดูหัวข้อ "เรื่องที่ต้องตัดสิน"

## Why

- ตอนนี้ medical referral เก็บปลายทางเป็นข้อความพิมพ์เอง (`to_org.name`) ไม่มีกลไกส่งถึงโรงพยาบาลจริง และ `accepted`/`rejected` ต้องให้คนในระบบกดแทน
- M5 เปิด API ให้ระบบภายนอกส่งใบส่งต่อ ติดตามผลพิจารณาของ สธ. แจ้งรถออก และถอนใบ (AUTH-001, TRF-001 ถึง TRF-006)
- ความปลอดภัย: ต้องเก็บ `client_secret` ของ M5 ไว้ฝั่ง server ที่เดียว (FastAPI) และให้ FastAPI ยังไม่ถือ CouchDB credential ตาม ADR-0002
- M5 ไม่มี webhook ระบบเราต้อง poll เอง ควรทำที่ server ที่เดียว ไม่ให้ browser ทุกเครื่องยิงไป M5

## Change

### 1. สถาปัตยกรรม

```
Browser ──► SvelteKit BFF /api/back-office/referral/m5/*   (session `_session`, shelter_manager)
              │  Bearer EXTERNAL_API_SECRET
              ▼
           FastAPI /v1/integrations/m5/*   ── ถือ M5_CLIENT_ID / M5_CLIENT_SECRET (env backend เท่านั้น)
              │  · token cache (24 ชม., ขอใหม่ก่อนหมด ≥ 60 วินาที, ไม่ขอทุก request)
              │  · Mongo `m5_transfers` (mapping + snapshot สถานะล่าสุด, ไม่มีเลขบัตรเต็ม)
              │  · poller: TRF-003 ทุก 30–60 วินาที เฉพาะเมื่อมีใบที่ยังไม่จบ
              ▼
             M5  (staging-m5-api / onedata-dbh-api)

worker inbound loop ── อ่าน `m5_transfers` ที่เปลี่ยน ──► อัปเดต referral ใน `central_ops`
```

- **FastAPI ไม่ได้รับ CouchDB credential** การเขียนสถานะกลับเข้า CouchDB ใช้ pattern เดียวกับ `external_bookings` (ADR-0002 §7)
- **BFF ประกอบ payload ฝั่ง server:**
  - อ่าน evacuee ด้วยสิทธิ์ server แล้วดึง `national_id`, ชื่อ และอายุมาใส่ payload
  - browser ส่งแค่ `referral_id` กับค่าที่ staff กรอก ไม่ส่งเลขบัตร
- **FastAPI ถือเลขบัตรเต็มไว้ใน memory เท่านั้นระหว่างส่ง** `m5_transfers` เก็บเฉพาะ `national_id_masked` ที่ M5 ส่งกลับมา
- **env ใหม่** (เฉพาะ backend):
  - `M5_BASE_URL`, `M5_CLIENT_ID`, `M5_CLIENT_SECRET`
  - `M5_POLL_INTERVAL_S` (default 45)
  - ห้ามตั้งชื่อด้วย prefix `PUBLIC_` และห้ามใส่ใน `frontend/.env`

### 2. Health gate (client ต้องเชื่อมต่อได้ก่อนใช้งาน)

> **ใช้ร่วมกับ M6** ([draft-central-warehouse-m6-withdrawal](draft-central-warehouse-m6-withdrawal.md) §4): endpoint ตัวเดียวกันตอบสถานะแยกรายระบบ ไม่ทำ endpoint แยกของ M5

| ชั้น | Endpoint | พฤติกรรม |
|---|---|---|
| FastAPI | `GET /v1/integrations/status` | ตอบ `{m5: {configured, token_ok, reachable, checked_at, error}, m6: {…}}` และ cache ผลการตรวจ upstream ไว้ 30–60 วินาที เพื่อไม่ให้ยิง M5 ทุกครั้งที่ถูกถาม |
| BFF | `GET /api/back-office/integrations/status` | timeout 3 วินาที แล้วตอบ `state` ต่อระบบ ค่าใดค่าหนึ่งจากตารางถัดไป |
| UI | query `useIntegrationStatus('m5')` (refetch ทุก 30 วินาที, `retry: false`) | ถ้า `state ≠ ready` ปิดปุ่ม "ส่งไป M5", "แจ้งรถออก" และ "ถอนใบ" ของใบที่ผูก M5 แล้วแสดง alert พร้อมปุ่มลองใหม่ (pattern เดียวกับ `ConnectionBanner`) |

| `state` | เงื่อนไข | ข้อความที่ผู้ใช้เห็น |
|---|---|---|
| `ready` | FastAPI ตอบได้ และ M5 `token_ok && reachable` | — |
| `central_unreachable` | BFF เรียก FastAPI ไม่ได้ หรือ timeout | "เชื่อมต่อกับระบบกลางไม่ได้" |
| `m5_unavailable` | FastAPI ตอบได้ แต่ M5 timeout หรือตอบ 5xx | "เชื่อมต่อระบบส่งต่อผู้ป่วย (M5) ไม่ได้ ชั่วคราว" |
| `m5_not_configured` / `m5_credential_invalid` | ไม่มี env หรือ M5 ตอบ `invalid_client` / 403 | "ระบบส่งต่อผู้ป่วยยังไม่พร้อม ติดต่อผู้ดูแลระบบ" (FastAPI หยุด retry อัตโนมัติ) |

- **ด่านสุดท้าย:** ทุก BFF endpoint ที่เขียนไป M5 ตอบ `503 CENTRAL_UNAVAILABLE` หรือ `503 M5_UNAVAILABLE` เองเมื่อ upstream ล่ม UI ไม่ต้องเชื่อผล status ที่ cache ไว้เพียงอย่างเดียว
- **Edge mode** (fallback ไป LAN ตอน WAN ล่ม): FastAPI ส่วนกลางมักติดต่อไม่ได้ gate นี้จึงปิดฟีเจอร์ให้เองโดยไม่ต้องเขียนกรณีพิเศษ
- health feature เดิม (`$lib/features/health`, CouchDB `/_up`) ไม่เปลี่ยน gate นี้เป็นของ referral โดยเฉพาะ

### 3. Field ใหม่บน `referral` (§5.4) — schema_v 2 → 3

ใช้เฉพาะ `referral_type = medical-emergency` ที่ส่งผ่าน M5 ทุก field เป็น opt (additive)

| Field | ชนิด | req | หมายเหตุ |
|---|---|---|---|
| `to_org.m5_facility_id` | int | opt | `facility_id` จาก TRF-001 บังคับเมื่อส่งผ่าน M5 ส่วน `to_org.name` ยังคงเป็น snapshot ชื่อ |
| `acuity` | enum(`red`,`yellow`,`green`,`black`) | opt | บังคับเมื่อส่งผ่าน M5 UI ตั้งค่าเริ่มต้นจาก `medical_screening.triage_level` ล่าสุด (ไม่มี `black`) แล้วให้ staff ยืนยัน แยกจาก `urgency` |
| `transport` | {`vehicle_type`: enum(`ambulance`,`van`,`helicopter`,`other`), `note`: str?} | opt | บังคับเมื่อส่งผ่าน M5 พาหนะเป็นของศูนย์เสมอ |
| `requester_contact` | {`name`: str, `role`: str, `phone`: str} | opt | snapshot ผู้ติดต่อ ณ ตอนส่ง บังคับเมื่อส่งผ่าน M5 `phone` คือช่องทางเดียวที่ สธ. และโรงพยาบาลใช้ติดต่อกลับ |
| `external` | {`system`: `m5`, `external_ref`: str, `code`: str, `status`: enum M5, `original_m5_facility_id`: int?, `review`: {note, by, at}?, `last_synced_at`: ts} | sys | BFF เขียน `system`, `external_ref` และ `code` ตอนส่งสำเร็จ worker เขียนส่วนที่เหลือ |

**`external_ref`** ใช้รูปแบบ `TENT-{shelter_code}-{referral_ulid}`
- ได้ค่าเดิมทุกครั้งจาก `_id` จึงส่งซ้ำได้ปลอดภัยตามกฎ idempotency ของ M5 และไม่มีวันซ้ำกับใบอื่น
- ต้องไม่เกิน 64 ตัวอักษร

**ค่าใน payload ของ TRF-002 ที่ไม่ได้เก็บใน referral** (อ่านจาก evacuee หรือศูนย์ ณ ตอนส่ง):

| payload | แหล่ง | ถ้าไม่มี |
|---|---|---|
| `patients[0].name` | `first_name` + `last_name` | — |
| `patients[0].national_id` | `person_id.number` เมื่อ `cardType = national_id` | เว้นว่าง (ดู D1) |
| `patients[0].age` | `age` หรือคำนวณจาก `birth_year` | เว้นว่าง |
| `patients[0].condition` | `reason` | — |
| `origin.location_code` / `location_name` | `shelter_code` / ชื่อศูนย์ | — |
| `origin.latitude` / `longitude` | `shelter.location.lat` / `lng` | บล็อกการส่งพร้อมข้อความให้ไปตั้งพิกัดศูนย์ |

ใบ 1 ใบ = 1 referral = ผู้ป่วย 1 คน เพราะ referral ไม่มี `batch_id` (การรวมกลุ่มใน list เป็นแค่ heuristic) ยังไม่รวมหลายคนเข้าใบ M5 เดียว ดู D4

### 4. State mapping และ transition

| M5 `status` | referral `status` | ผู้ทำให้เกิด | หมายเหตุ |
|---|---|---|---|
| (TRF-002 สำเร็จ) | `draft → sent` | staff ต้นทาง ผ่าน BFF | BFF เรียก FastAPI ก่อน แล้วจึงเขียน `sent` + `external` |
| `awaiting_review` | `sent` | — | — |
| `pending` | `sent → accepted` | worker | `timeline.responded.by = "m5:{review.by}"` · `response_reason = review.note` · ถ้า สธ. เปลี่ยนโรงพยาบาล worker อัปเดต `to_org` และเก็บ `external.original_m5_facility_id` |
| `rejected` | `sent → rejected` | worker | `response_reason = review.note` |
| `in_transit` | คงเป็น `accepted` | staff ต้นทาง (TRF-005) | สะท้อนผ่าน `external.status` ไม่เพิ่มค่าใน enum `status` |
| `arrived` | `accepted → closed` | worker | `close_reason = "ผู้ป่วยถึงโรงพยาบาลปลายทางแล้ว (M5)"` |
| `cancelled` | `sent → closed` | staff (TRF-006) หรือ worker เมื่อ สธ. ยกเลิก | — |

**กฎที่เปลี่ยน (เฉพาะ referral ที่มี `external`):**

1. **`accepted` / `rejected` มาจาก worker เท่านั้น** BFF ปฏิเสธ transition เหล่านี้จากผู้ใช้ด้วย `409 EXTERNALLY_MANAGED`
2. **ถอนคำขอ `sent → closed`** BFF เรียก TRF-006 พร้อม `close_reason` ก่อน และเขียน `closed` เมื่อ M5 สำเร็จเท่านั้น
   - M5 ตอบ `cancel_needs_moph` → ตอบ `409 CANCEL_NEEDS_MOPH` และ UI แสดง "ใบนี้ สธ. อนุมัติแล้ว โทรประสาน สธ. เพื่อยกเลิก"
   - M5 ตอบ `already_closed` → ให้ worker sync สถานะจริงมาแทน
3. **ปิดรายการ `accepted → closed` ด้วยมือ** ทำได้หลัง `external.status ∈ {arrived, cancelled}` เท่านั้น
4. **แจ้งรถออก (action ใหม่)** `POST /api/back-office/referral/[id]/m5/start` เรียก TRF-005 ได้เฉพาะเมื่อ `external.status = pending` และไม่เปลี่ยน `status`
5. **bulk และปิดศูนย์:** `bulk-transition` (CR-167) และ shelter-closure worker (CR-168) ต้องใช้กฎข้อ 1–3 รายตัว ใบที่ได้ `CANCEL_NEEDS_MOPH` นับเป็นรายการที่ล้มเหลว พร้อมเหตุผลในผลลัพธ์ ไม่ทำให้ทั้งชุดล้ม

**การเขียนพร้อมกันใน `central_ops`:** BFF และ worker เขียน doc เดียวกันได้ ทั้งคู่ต้อง retry ด้วย `_rev` ใหม่เมื่อเจอ 409 (ใช้ `referral.transition-retry.ts` ที่มีอยู่)

### 5. API ใหม่

**FastAPI** (route ภายใน เรียกจาก BFF ด้วย Bearer `EXTERNAL_API_SECRET` เท่านั้น ไม่เปิดผ่าน nginx):

| Method | Path | เรียก M5 | หมายเหตุ |
|---|---|---|---|
| GET | `/v1/integrations/status` | AUTH-001 (ใช้ token ใน cache) | health gate ร่วมกับ M6 |
| GET | `/v1/integrations/m5/facilities?q=` | TRF-001 | cache 60 วินาที |
| POST | `/v1/integrations/m5/transfers` | TRF-002 | upsert `m5_transfers` ตาม `external_ref` และคืนค่า `code` |
| GET | `/v1/integrations/m5/transfers/{code}` | TRF-004 | อ่านสด ใช้ตอนเปิดหน้ารายละเอียด |
| POST | `/v1/integrations/m5/transfers/{code}/start` | TRF-005 | — |
| POST | `/v1/integrations/m5/transfers/{code}/cancel` | TRF-006 | body `{reason}` |

**BFF** (session + `shelter_manager` ของศูนย์ต้นทาง ตาม `_auth.ts` เดิม):
- `GET /api/back-office/integrations/status` (ร่วมกับ M6)
- `GET /api/back-office/referral/m5/facilities`
- `POST /api/back-office/referral/[id]/m5/start`
- การส่ง (`draft → sent`) และการถอน (`sent → closed`) ใช้ `transition` endpoint เดิม เมื่อ referral เป็น M5 BFF จะเรียก FastAPI ให้เอง

**การแปลง error ของ M5 ที่ FastAPI:**

| M5 | FastAPI ตอบ | หมายเหตุ |
|---|---|---|
| 400 validation | `422` + รายฟิลด์ | — |
| `destination_not_found` | `409 M5_DESTINATION_NOT_FOUND` | — |
| `external_ref_in_use` | `409 M5_EXTERNAL_REF_CONFLICT` | ไม่ควรเกิด เพราะ ref ได้ค่าเดิมทุกครั้ง |
| `not_pending` / `cancel_needs_moph` / `already_closed` | `409` + code เดิม | — |
| 401 token หมดอายุ | — | ขอ token ใหม่และลองซ้ำ 1 ครั้ง |
| `invalid_client` / 403 | `503 M5_CREDENTIAL_INVALID` | เปิด circuit และไม่ retry |
| timeout / 5xx | `503 M5_UNAVAILABLE` | — |

### 6. Mongo (FastAPI เป็นเจ้าของ)

- **`m5_transfers`** key = `external_ref`
  - เก็บ `referral_id`, `shelter_code`, `code`, `status`, `destination`, `original_destination`, `review`, `activity`, `patients[].national_id_masked`, `fetched_at`, `applied_rev`
  - ไม่มีเลขบัตรเต็ม
- **`m5_outbound_logs`**
  - เก็บทุกการเรียก M5: `endpoint`, `external_ref` / `code`, HTTP status, `error`, `at`, `actor`
  - ไม่เก็บ payload และไม่เก็บ PII

## เรื่องที่ต้องตัดสิน (ก่อน approve)

- **D1 — PDPA:** DoD ของ T-34 เขียนว่า "public/FAM/EOC/Open API ไม่ได้รับ medical detail หรือ national ID ทุกกรณี" แต่ M5 รับ `national_id` และ `condition`
  - (a) แก้ DoD ให้ยกเว้นการส่งต่อทางการแพทย์ไป สธ. ผ่าน M5 เพราะเป็นผู้ให้การรักษา พร้อม log ทุกการส่ง ← **แนะนำ**
  - (b) ส่งแค่ `name`, `age` และ `acuity` โดยไม่ส่ง `national_id` และ `condition`
  - (c) ให้ staff ติ๊กยืนยันการส่งเลขบัตรเป็นรายใบ
- **D2 — Scope:** T-34 กำหนด R3 เป็น referral ภายในเครือข่ายเท่านั้น และเลื่อนหน่วยงานภายนอกไป R4 งานนี้จะเข้า R3 (แก้ task-breakdown) หรือเป็น backlog R4
- **D3 — ระหว่างที่ gate ไม่ผ่าน:**
  - (a) สร้างและแก้ draft ใน CouchDB ได้ แต่ส่งไม่ได้ ← **แนะนำ**
  - (b) ปิดฟอร์ม medical referral ทั้งหมด
- **D4 — ผู้ป่วยหลายคน:** รอบนี้ทำ 1 referral = 1 ใบ M5 ถ้าต้องการรวมหลายคนในใบเดียว (รถคันเดียว) ต้องเพิ่ม `batch_id` ใน CR แยก
- **D5 — ผลการตรวจของทีม M5** (เอกสาร v1.0 ขัดกันเอง):
  - (1) TRF-004 ใช้ path `/transfers/{code}` หรือ query `?code=` และ response ห่อด้วย `{data, total, page, limit}` จริงหรือไม่
  - (2) ฟิลด์ผู้ป่วย `name`, `national_id`, `age`, `condition` บังคับหรือไม่
  - (3) `origin.latitude/longitude` เป็น Number หรือ Text
  - (4) M5 มีแผนทำ webhook หรือไม่ เพื่อแทน polling

## Impact

- **docs:**
  - `schema.md` §5.4: field ใหม่, กฎ transition ข้อ 1–5, `schema_v` 3
  - `schema.md` §9: `m5_transfers` และ `m5_outbound_logs`
  - `api-contract.md`: FastAPI และ BFF endpoints
  - `09-F-referral.md`: DoD (D1/D2)
  - ADR-0002: เพิ่มย่อหน้า outbound plane หรือเขียน ADR-0003 แยก
- **backend:**
  - module `integrations_m5` ประกอบด้วย client (httpx), token cache, poller, router และ schemas
  - tests ใช้ `respx` หรือ mock M5 ให้ครบ error ทุกตัวในข้อ 5
- **worker:** inbound loop `m5_transfers` → `central_ops` แบบ idempotent ตาม `applied_rev`
- **frontend:**
  - Zod v3 และ reader ที่รับ v1–v3
  - `referral.transitions` เพิ่ม guard `EXTERNALLY_MANAGED`
  - server repository และ BFF routes
  - UI: facility picker, acuity, transport, requester contact และ `useIntegrationStatus('m5')` gate
  - หน้า detail แสดง `external.status`, `review` และปุ่มแจ้งรถออก
- **ops:** credential staging และ production แยกกัน ต้องผ่านการทดสอบบน staging ก่อนขอ production ตามที่ M5 กำหนด

## Migration

- `schema_v` 2 → 3 เป็น additive เท่านั้น doc v1/v2 อ่านได้เหมือนเดิมโดยไม่ต้อง backfill
- referral ที่ไม่มี `external` ทำงานตามกฎเดิมทุกข้อ
- deploy สองขั้นแบบเดียวกับ CR-167:
  1. reader รับ v3 ก่อน
  2. จากนั้นเปิด writer v3 และ M5 env

## Decision log

- 2026-11-10 — proposed (ร่างจากการวิเคราะห์ M5 Integration Guide v1.0 เทียบกับ referral ปัจจุบัน; รอ D1–D5)
